const test = require('node:test');
const assert = require('node:assert/strict');
const { FirewallDetector, firewallDetector } = require('../lib/firewall');

test('FirewallDetector instantiates and returns structured status', () => {
  const detector = new FirewallDetector();
  const status = detector.checkStatus(5000);

  assert.equal(typeof status.detected, 'boolean');
  assert.equal(typeof status.blocked, 'boolean');
  assert.equal(typeof status.portAllowed, 'boolean');
  assert.equal(typeof status.mdnsAllowed, 'boolean');
});

test('FirewallDetector detects active UFW policy and generates remedy command when port 5000 is blocked', () => {
  const status = firewallDetector.checkStatus(5000);
  if (status.detected && status.blocked) {
    assert.ok(status.warning.includes('5000'));
    assert.ok(status.remedyCommand.includes('ufw allow 5000/tcp'));
  }
});
