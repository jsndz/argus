const test = require('node:test');
const assert = require('node:assert/strict');
const { MdnsManager } = require('../lib/mdns');

test('MdnsManager starts advertising and cleans up cleanly', async () => {
  const mdns = new MdnsManager();
  const testIp = '10.99.90.197';

  const status = await mdns.start(testIp);
  assert.equal(status.ip, testIp);
  assert.ok(status.hostname.startsWith('argus'));
  assert.ok(['active', 'conflict_resolved'].includes(status.status));

  await mdns.stop();
  assert.equal(mdns.status, 'idle');
});
