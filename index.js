const express = require('express');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');

const { networkManager } = require('./lib/network');
const { mdnsManager } = require('./lib/mdns');
const { mediaMtxManager } = require('./lib/mediamtx');
const { firewallDetector } = require('./lib/firewall');

const QRCode = require('qrcode');

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/whep', express.text({ type: ['application/sdp', 'text/plain', '*/*'] }));
app.use(express.static(path.join(__dirname, 'public')));

const fs = require('fs');

function getLatestUpload() {
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir)
        .filter((f) => !f.startsWith('.'))
        .map((f) => ({
          path: path.join('uploads', f),
          time: fs.statSync(path.join(uploadDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
      if (files.length > 0) {
        return files[0].path;
      }
    }
  } catch (e) {}
  return null;
}

let ffmpegProcess = null;
let filePath = getLatestUpload();

const upload = multer({ dest: 'uploads/' });

// Dedicated user / watch routes
app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// HLS Stream Proxy (serves HLS stream directly via port 5000)
app.use('/hls', async (req, res) => {
  try {
    const upstreamUrl = 'http://127.0.0.1:8888/live' + req.url;
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).send('Stream not available');
    }
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).send('MediaMTX HLS unavailable');
  }
});

// QR Code generation API
app.get('/api/qr', async (req, res) => {
  try {
    const selectedIp = networkManager.getSelectedIp();
    const targetUrl = req.query.text || `http://${selectedIp}:5000/watch`;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#0b0f19', light: '#ffffff' }
    });
    res.json({ qr: qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// System status API
app.get('/api/status', async (req, res) => {
  const network = networkManager.getNetworkInfo();
  const mdns = mdnsManager.getStatus();
  const mediamtx = mediaMtxManager.getStatus();

  const PORT = process.env.PORT || 5000;
  const firewall = firewallDetector.checkStatus(PORT);

  res.json({
    network,
    mdns,
    mediamtx,
    firewall,
    stream: {
      isStreaming: !!ffmpegProcess,
      filePath: filePath ? path.basename(filePath) : null
    }
  });
});

// List all detected IPv4 network interfaces
app.get('/api/network/interfaces', (req, res) => {
  const networkInfo = networkManager.getNetworkInfo();
  res.json(networkInfo);
});

// Allow admin to select preferred IP / interface
app.post('/api/network/select', async (req, res) => {
  const { address, name } = req.body;
  const target = address || name;

  if (!target) {
    return res.status(400).json({ error: 'Missing address or interface name' });
  }

  try {
    const updatedNetwork = networkManager.select(target);
    const selectedIp = updatedNetwork.selected.address;

    // Update mDNS advertisement
    const mdnsStatus = await mdnsManager.update(selectedIp);

    // Regenerate MediaMTX configuration
    mediaMtxManager.generateConfig(selectedIp, mdnsStatus.hostname);

    // Restart MediaMTX and verify health
    const mtxResult = await mediaMtxManager.startOrRestart();

    res.json({
      success: true,
      network: updatedNetwork,
      mdns: mdnsStatus,
      mediamtx: mediaMtxManager.getStatus(),
      mtxRestart: mtxResult
    });
  } catch (err) {
    console.error('[API /api/network/select] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manually restart & re-verify MediaMTX
app.post('/api/mediamtx/restart', async (req, res) => {
  try {
    const selectedIp = networkManager.getSelectedIp();
    mediaMtxManager.generateConfig(selectedIp, mdnsManager.hostname);
    const result = await mediaMtxManager.startOrRestart();
    res.json({
      success: result.success,
      mediamtx: mediaMtxManager.getStatus(),
      error: result.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Video upload
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  filePath = req.file.path;
  res.send('File uploaded successfully!');
});

// Start RTSP stream to MediaMTX
app.post('/start-stream', (req, res) => {
  if (!filePath) {
    return res.status(400).send('No video uploaded.');
  }

  if (ffmpegProcess) {
    try {
      ffmpegProcess.kill('SIGINT');
    } catch (e) {
      ffmpegProcess.kill('SIGKILL');
    }
    ffmpegProcess = null;
  }

  ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-stream_loop', '-1',
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-c:a', 'libopus',
    '-ar', '48000',
    '-ac', '2',
    '-rtsp_transport', 'tcp',
    '-f', 'rtsp',
    'rtsp://localhost:8554/live'
  ]);

  ffmpegProcess.stderr.on('data', (data) => {
    // Keep internal stream logs
  });

  ffmpegProcess.on('exit', (code) => {
    console.log(`[FFmpeg] Stream exited with code ${code}`);
    ffmpegProcess = null;
  });

  const selectedIp = networkManager.getSelectedIp();
  const hostname = mdnsManager.hostname || 'argus.local';

  res.send(`Streaming started! View at http://${hostname}:5000/watch or http://${selectedIp}:5000/watch`);
});

// Stop stream
app.get('/stop', (req, res) => {
  if (ffmpegProcess) {
    try {
      ffmpegProcess.kill('SIGINT');
    } catch (e) {
      ffmpegProcess.kill('SIGKILL');
    }
    ffmpegProcess = null;
  }
  res.send('Streaming stopped!');
});

// Startup Orchestration
async function startServer() {
  console.log('==============================================');
  console.log('       ARGUS VIDEO STREAMING PLATFORM         ');
  console.log('       Phase 1: Discovery & MediaMTX Init     ');
  console.log('==============================================');

  // 1. Auto IP / NIC Detection
  const netInfo = networkManager.refresh();
  const selectedIp = netInfo.selected ? netInfo.selected.address : '127.0.0.1';
  const ifaceName = netInfo.selected ? netInfo.selected.name : 'unknown';

  console.log(`[Network] Detected ${netInfo.interfaces.length} IPv4 network interfaces.`);
  if (netInfo.recommended) {
    console.log(`[Network] Recommended LAN IP: ${netInfo.recommended.address} (${netInfo.recommended.name})`);
  }
  console.log(`[Network] Selected active IP: ${selectedIp} (${ifaceName})`);

  // 2. mDNS Configuration
  console.log(`[mDNS] Initializing mDNS broadcast for argus.local...`);
  const mdnsStatus = await mdnsManager.start(selectedIp, 'argus.local');
  console.log(`[mDNS] Broadcasting ${mdnsStatus.hostname} -> ${selectedIp} (provider: ${mdnsStatus.provider})`);

  // 3. MediaMTX Configuration
  console.log('[MediaMTX] Generating configuration with HLS streaming enabled...');
  mediaMtxManager.generateConfig(selectedIp, mdnsStatus.hostname);

  // 4. Start MediaMTX & Verify Health
  console.log('[MediaMTX] Starting MediaMTX service...');
  const mtxResult = await mediaMtxManager.startOrRestart();
  if (mtxResult.success) {
    console.log('[MediaMTX] MediaMTX initialized and healthy.');
  } else {
    console.error(`[MediaMTX] WARNING: MediaMTX initialization encountered errors: ${mtxResult.error}`);
  }

  // 5. Start Express Admin Interface
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('==============================================');
    console.log(`Argus Server running on:`);
    console.log(`- Viewer Page: http://${mdnsStatus.hostname}:${PORT}/watch`);
    console.log(`- Admin Room:  http://${mdnsStatus.hostname}:${PORT}/admin`);
    console.log(`- Direct IP:   http://${selectedIp}:${PORT}/watch`);
    console.log('Stream Output:');
    console.log(`- HLS Portal:  http://${selectedIp}:${PORT}/hls/index.m3u8`);
    console.log(`- HLS Direct:  http://${selectedIp}:8888/live/index.m3u8`);
    console.log(`- RTSP Ingest: rtsp://127.0.0.1:8554/live`);
    console.log('==============================================');

    // 6. Check Linux Firewall status & notify admin
    const fwStatus = firewallDetector.checkStatus(PORT);
    if (fwStatus.blocked || fwStatus.warning) {
      console.warn('\n==============================================');
      console.warn('⚠️  [FIREWALL WARNING] ACTION REQUIRED FOR LAN:');
      console.warn(`   ${fwStatus.warning}`);
      if (fwStatus.remedyCommand) {
        console.warn(`   👉 Run this command in your terminal to fix:`);
        console.warn(`      ${fwStatus.remedyCommand}`);
      }
      console.warn('==============================================\n');
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Argus] Shutting down gracefully...');
  if (ffmpegProcess) {
    try { ffmpegProcess.kill('SIGINT'); } catch (e) {}
  }
  await mdnsManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Argus] Shutting down gracefully...');
  if (ffmpegProcess) {
    try { ffmpegProcess.kill('SIGINT'); } catch (e) {}
  }
  await mdnsManager.stop();
  process.exit(0);
});

startServer().catch((err) => {
  console.error('[Argus] Fatal startup error:', err);
  process.exit(1);
});