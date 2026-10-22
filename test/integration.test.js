const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.ARGUS_CONFIG_PATH = path.join(os.tmpdir(), `argus-test-int-${Date.now()}.json`);
const express = require('express');

const { networkManager } = require('../lib/network');
const { mdnsManager } = require('../lib/mdns');
const { mediaMtxManager } = require('../lib/mediamtx');

test('Integration: Express API serves network interfaces and updates configuration', async (t) => {
  const app = express();
  app.use(express.json());

  app.get('/api/status', (req, res) => {
    res.json({
      network: networkManager.getNetworkInfo(),
      mdns: mdnsManager.getStatus(),
      mediamtx: mediaMtxManager.getStatus()
    });
  });

  app.get('/api/network/interfaces', (req, res) => {
    res.json(networkManager.getNetworkInfo());
  });

  app.post('/api/network/select', async (req, res) => {
    const { address } = req.body;
    try {
      const updatedNetwork = networkManager.select(address);
      const selectedIp = updatedNetwork.selected.address;
      const mdnsStatus = await mdnsManager.update(selectedIp);
      mediaMtxManager.generateConfig(selectedIp, mdnsStatus.hostname);
      res.json({
        success: true,
        network: updatedNetwork,
        mdns: mdnsStatus
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  t.after(async () => {
    server.close();
    await mdnsManager.stop();
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Test GET /api/network/interfaces
  const ifacesRes = await fetch(`${baseUrl}/api/network/interfaces`);
  assert.equal(ifacesRes.status, 200);
  const ifacesData = await ifacesRes.json();
  assert.ok(Array.isArray(ifacesData.interfaces));
  assert.ok(ifacesData.recommended);
  assert.ok(ifacesData.selected);

  // 2. Test GET /api/status
  const statusRes = await fetch(`${baseUrl}/api/status`);
  assert.equal(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.ok(statusData.network);
  assert.ok(statusData.mediamtx);

  // 3. Test POST /api/network/select
  const selectRes = await fetch(`${baseUrl}/api/network/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: ifacesData.selected.address })
  });
  assert.equal(selectRes.status, 200);
  const selectData = await selectRes.json();
  assert.equal(selectData.success, true);
  assert.equal(selectData.network.selected.address, ifacesData.selected.address);

  // 4. Test GET /watch (Viewer Page)
  app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'watch.html'));
  });
  const watchRes = await fetch(`${baseUrl}/watch`);
  assert.equal(watchRes.status, 200);
  const watchHtml = await watchRes.text();
  assert.ok(watchHtml.includes('Argus Stream'));
  assert.ok(watchHtml.includes('liveVideo'));

  // 5. Test GET /api/qr
  const QRCode = require('qrcode');
  app.get('/api/qr', async (req, res) => {
    const qrDataUrl = await QRCode.toDataURL('http://localhost:5000/watch');
    res.json({ qr: qrDataUrl });
  });
  const qrRes = await fetch(`${baseUrl}/api/qr`);
  assert.equal(qrRes.status, 200);
  const qrData = await qrRes.json();
  assert.ok(qrData.qr.startsWith('data:image/png;base64,'));

  // 6. Test GET /api/media
  const { mediaLibrary } = require('../lib/media');
  app.get('/api/media', (req, res) => {
    res.json({ media: mediaLibrary.getAll() });
  });
  const mediaRes = await fetch(`${baseUrl}/api/media`);
  assert.equal(mediaRes.status, 200);
  const mediaData = await mediaRes.json();
  assert.ok(Array.isArray(mediaData.media));

  // 7. Test GET /api/streams & POST /api/streams/stop-all
  const { streamManager } = require('../lib/stream');
  app.get('/api/streams', (req, res) => {
    res.json({ streams: streamManager.getAllStreams(), activeCount: streamManager.getActiveStreams().length });
  });
  app.post('/api/streams/stop-all', (req, res) => {
    streamManager.stopAll();
    res.json({ success: true });
  });
  const streamsRes = await fetch(`${baseUrl}/api/streams`);
  assert.equal(streamsRes.status, 200);
  const streamsData = await streamsRes.json();
  assert.ok(Array.isArray(streamsData.streams));

  const stopAllRes = await fetch(`${baseUrl}/api/streams/stop-all`, { method: 'POST' });
  assert.equal(stopAllRes.status, 200);
  const stopAllData = await stopAllRes.json();
  assert.equal(stopAllData.success, true);
});
