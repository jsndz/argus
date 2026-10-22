const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StreamManager } = require('../lib/stream');

test('StreamManager manages stream state and sanitizes channel IDs', (t) => {
  const mgr = new StreamManager();
  const testId = `test-video-${Date.now()}`;
  const testPath = path.join(os.tmpdir(), `${testId}.mp4`);
  fs.writeFileSync(testPath, 'dummy video');

  t.after(() => {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    mgr.stopAll();
  });

  // Verify stream state tracking
  assert.equal(mgr.isStreaming(), false);
  assert.equal(mgr.getActiveStreams().length, 0);

  // Test startStream throws when file doesn't exist
  assert.throws(() => {
    mgr.startStream({ id: 'bad-stream', filePath: '/non/existent/video.mp4' });
  });

  // Test sanitizeStreamId
  assert.equal(mgr._sanitizeStreamId('My Stream #1!'), 'my-stream--1');
  assert.equal(mgr._sanitizeStreamId('  CHANNEL_A  '), 'channel_a');
  assert.equal(mgr._sanitizeStreamId(''), 'live');
});
