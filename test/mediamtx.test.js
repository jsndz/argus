const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { MediaMtxManager } = require('../lib/mediamtx');

test('MediaMtxManager generates valid configuration with HLS enabled', () => {
  const mgr = new MediaMtxManager();
  const testIp = '192.168.1.100';
  const testHost = 'argus.local';

  const config = mgr.generateConfig(testIp, testHost);

  assert.equal(config.api, true);
  assert.equal(config.apiAddress, ':9997');
  assert.equal(config.rtsp, true);
  assert.equal(config.rtspAddress, ':8554');
  assert.equal(config.webrtc, false);
  assert.equal(config.hls, true);
  assert.equal(config.hlsAddress, ':8888');

  const fileContent = fs.readFileSync(path.join(__dirname, '..', 'mediamtx.yml'), 'utf-8');
  const parsed = YAML.parse(fileContent);
  assert.equal(parsed.hls, true);
  assert.equal(parsed.webrtc, false);
});

test('MediaMtxManager endpoint probes verify RTSP, HLS, API', async () => {
  const mgr = new MediaMtxManager();
  const probe = await mgr.probeEndpoints();

  assert.equal(probe.endpoints.rtsp, true, 'RTSP port 8554 should be open');
  assert.equal(probe.endpoints.hls, true, 'HLS port 8888 should be reachable');
  assert.equal(probe.endpoints.api, true, 'API port 9997 should be reachable');
  assert.equal(probe.healthy, true, 'Overall health should be true');
});
