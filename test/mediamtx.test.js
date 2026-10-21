const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { MediaMtxManager } = require('../lib/mediamtx');

test('MediaMtxManager generates valid configuration with ICE candidate hosts', () => {
  const mgr = new MediaMtxManager();
  const testIp = '192.168.1.100';
  const testHost = 'argus.local';

  const config = mgr.generateConfig(testIp, testHost);

  assert.ok(config.webrtcAdditionalHosts.includes(testIp));
  assert.ok(config.webrtcAdditionalHosts.includes(testHost));
  assert.equal(config.api, true);
  assert.equal(config.apiAddress, ':9997');
  assert.equal(config.rtsp, true);
  assert.equal(config.webrtc, true);
  assert.equal(config.hls, true);

  const fileContent = fs.readFileSync(path.join(__dirname, '..', 'mediamtx.yml'), 'utf-8');
  const parsed = YAML.parse(fileContent);
  assert.ok(parsed.webrtcAdditionalHosts.includes(testIp));
});

test('MediaMtxManager endpoint probes verify RTSP, WebRTC, HLS, API', async () => {
  const mgr = new MediaMtxManager();
  const probe = await mgr.probeEndpoints();

  assert.equal(probe.endpoints.rtsp, true, 'RTSP port 8554 should be open');
  assert.equal(probe.endpoints.webrtc, true, 'WebRTC port 8889 should be reachable');
  assert.equal(probe.endpoints.hls, true, 'HLS port 8888 should be reachable');
  assert.equal(probe.endpoints.api, true, 'API port 9997 should be reachable');
  assert.equal(probe.healthy, true, 'Overall health should be true');
});
