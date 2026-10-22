const express = require('express');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');

const { networkManager } = require('./lib/network');
const { mdnsManager } = require('./lib/mdns');
const { mediaMtxManager } = require('./lib/mediamtx');
const { firewallDetector } = require('./lib/firewall');
const { mediaLibrary, UPLOADS_DIR } = require('./lib/media');
const { streamManager } = require('./lib/stream');

const QRCode = require('qrcode');
const fs = require('fs');

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Configure Multer storage to preserve original filenames safely
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const unique = `${Date.now()}_${base}${ext}`;
    cb(null, unique);
  }
});

// Configure Multer with 100 GB limit to support large 4K/1080p video files
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 * 1024, // 100 Gigabytes per file
    files: 50 // Up to 50 simultaneous files
  }
});

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

// HLS Stream Proxy (serves all HLS streams dynamically via port 5000)
app.use('/hls', async (req, res) => {
  try {
    let subPath = req.url;

    // If request is legacy root /index.m3u8, route to first active stream or 'live'
    if (subPath === '/index.m3u8' || subPath.startsWith('/index.m3u8?')) {
      const active = streamManager.getActiveStreams();
      const targetChannel = active.length > 0 ? active[0].id : 'live';
      subPath = `/${targetChannel}${subPath}`;
    }

    const upstreamUrl = `http://127.0.0.1:8888${subPath}`;
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
  const streams = streamManager.getAllStreams();
  const activeStreams = streamManager.getActiveStreams();
  const latestMedia = mediaLibrary.getLatest();

  res.json({
    network,
    mdns,
    mediamtx,
    firewall,
    media: mediaLibrary.getAll(),
    streams,
    activeStreams,
    stream: {
      isStreaming: activeStreams.length > 0,
      filePath: activeStreams.length > 0 ? activeStreams[0].fileName : (latestMedia ? latestMedia.originalName : null)
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

// Multi-Video Upload (supports single or multiple files with unlimited size up to 100GB)
app.post('/upload', (req, res) => {
  // Prevent socket timeout during large video file transfers
  if (req.setTimeout) req.setTimeout(0);

  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[Upload Error]', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File size exceeds maximum allowable limit (100 GB).' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(500).json({ error: `Server error during upload: ${err.message}` });
    }

    const files = req.files || (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No video files were received.' });
    }

    const registered = mediaLibrary.registerFiles(files);
    const count = registered.length;
    res.json({
      success: true,
      message: `Successfully uploaded ${count} video file${count > 1 ? 's' : ''}!`,
      files: registered
    });
  });
});

// Media Library API
app.get('/api/media', (req, res) => {
  res.json({ media: mediaLibrary.getAll() });
});

app.delete('/api/media/:id', (req, res) => {
  const { id } = req.params;
  const item = mediaLibrary.getById(id);
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  // If any active stream is using this file, stop it
  const activeStreams = streamManager.getActiveStreams();
  for (const s of activeStreams) {
    if (s.fileId === id || s.filePath === item.path) {
      streamManager.stopStream(s.id);
    }
  }

  const deleted = mediaLibrary.delete(id);
  res.json({ success: deleted, id });
});

// Multi-Stream Management API
app.get('/api/streams', (req, res) => {
  res.json({
    streams: streamManager.getAllStreams(),
    activeCount: streamManager.getActiveStreams().length
  });
});

app.post('/api/streams/start', (req, res) => {
  const { fileId, streamId, name } = req.body;
  let targetFile = null;

  if (fileId) {
    targetFile = mediaLibrary.getById(fileId);
  }
  if (!targetFile) {
    targetFile = mediaLibrary.getLatest();
  }

  if (!targetFile) {
    return res.status(400).json({ error: 'No video files available in media library. Upload a video first.' });
  }

  try {
    const channelSlug = (streamId && streamId.trim()) ? streamId.trim() : streamManager.getNextChannelId();
    const stream = streamManager.startStream({
      id: channelSlug,
      name: name || targetFile.originalName,
      fileId: targetFile.id,
      filePath: targetFile.path,
      fileName: targetFile.originalName
    });

    const selectedIp = networkManager.getSelectedIp();
    const hostname = mdnsManager.hostname || 'argus.local';

    res.json({
      success: true,
      stream,
      watchUrl: `http://${selectedIp}:5000/watch?stream=${stream.id}`,
      mdnsWatchUrl: `http://${hostname}:5000/watch?stream=${stream.id}`,
      hlsUrl: `http://${selectedIp}:5000/hls/${stream.id}/index.m3u8`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/streams/:id/stop', (req, res) => {
  const { id } = req.params;
  const stopped = streamManager.stopStream(id);
  res.json({ success: stopped, id });
});

app.post('/api/streams/stop-all', (req, res) => {
  streamManager.stopAll();
  res.json({ success: true, message: 'All streams stopped.' });
});

// Backward compatibility stream controls
app.post('/start-stream', (req, res) => {
  const latest = mediaLibrary.getLatest();
  if (!latest) {
    return res.status(400).send('No video uploaded.');
  }

  try {
    const stream = streamManager.startStream({
      id: 'live',
      name: latest.originalName,
      fileId: latest.id,
      filePath: latest.path,
      fileName: latest.originalName
    });

    const selectedIp = networkManager.getSelectedIp();
    const hostname = mdnsManager.hostname || 'argus.local';
    res.send(`Streaming started! View at http://${hostname}:5000/watch or http://${selectedIp}:5000/watch`);
  } catch (err) {
    res.status(500).send(`Failed to start stream: ${err.message}`);
  }
});

app.get('/stop', (req, res) => {
  streamManager.stopAll();
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
  streamManager.stopAll();
  await mdnsManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Argus] Shutting down gracefully...');
  streamManager.stopAll();
  await mdnsManager.stop();
  process.exit(0);
});

startServer().catch((err) => {
  console.error('[Argus] Fatal startup error:', err);
  process.exit(1);
});