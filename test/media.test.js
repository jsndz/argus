const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MediaLibrary } = require('../lib/media');

test('MediaLibrary registers and manages video files', (t) => {
  const testDir = path.join(os.tmpdir(), `argus-media-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  const lib = new MediaLibrary(testDir);

  const testId = `test-video-${Date.now()}`;
  const testPath = path.join(testDir, `${testId}.mp4`);
  fs.writeFileSync(testPath, 'fake-video-content');

  t.after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {}
  });

  const registered = lib.registerFile({
    filename: `${testId}.mp4`,
    originalname: 'Sample Video.mp4',
    path: testPath,
    size: 18,
    mimetype: 'video/mp4'
  });

  assert.equal(registered.originalName, 'Sample Video.mp4');
  assert.equal(registered.size, 18);

  const found = lib.getById(registered.id);
  assert.ok(found);
  assert.equal(found.originalName, 'Sample Video.mp4');

  const all = lib.getAll();
  assert.ok(Array.isArray(all));
  assert.ok(all.some((f) => f.id === registered.id));

  const deleted = lib.delete(registered.id);
  assert.equal(deleted, true);
  assert.equal(lib.getById(registered.id), null);
});
