const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.ARGUS_CONFIG_PATH = path.join(os.tmpdir(), `argus-test-net-${Date.now()}.json`);
const { classifyInterface, detectAllInterfaces, NetworkManager } = require('../lib/network');

test('classifyInterface correctly identifies loopback', () => {
  const result = classifyInterface('lo', {
    address: '127.0.0.1',
    internal: true,
    family: 'IPv4'
  });
  assert.equal(result.type, 'loopback');
  assert.equal(result.isSuitable, false);
  assert.equal(result.score, 0);
});

test('classifyInterface correctly filters Docker bridges', () => {
  const result = classifyInterface('br-a81d736c31b6', {
    address: '172.19.0.1',
    internal: false,
    family: 'IPv4'
  });
  assert.equal(result.type, 'docker-bridge');
  assert.equal(result.isSuitable, false);
});

test('classifyInterface correctly categorizes WiFi interface with LAN IP', () => {
  const result = classifyInterface('wlan0', {
    address: '192.168.1.50',
    internal: false,
    family: 'IPv4'
  });
  assert.equal(result.type, 'wifi');
  assert.equal(result.isSuitable, true);
  assert.equal(result.score, 90);
});

test('classifyInterface correctly categorizes Ethernet interface with LAN IP', () => {
  const result = classifyInterface('eth0', {
    address: '10.0.0.12',
    internal: false,
    family: 'IPv4'
  });
  assert.equal(result.type, 'ethernet');
  assert.equal(result.isSuitable, true);
  assert.equal(result.score, 100);
});

test('detectAllInterfaces returns IPv4 interfaces and selects a recommended LAN IP', () => {
  const ifaces = detectAllInterfaces();
  assert.ok(Array.isArray(ifaces));
  assert.ok(ifaces.length > 0);

  // All returned should be IPv4
  for (const iface of ifaces) {
    assert.ok(iface.address);
    assert.ok(iface.name);
  }

  // Find recommended interface if any suitable exist
  const suitable = ifaces.filter(i => i.isSuitable);
  if (suitable.length > 0) {
    const recommended = ifaces.find(i => i.isRecommended);
    assert.ok(recommended, 'Should have a recommended interface');
    assert.equal(recommended.isSuitable, true);
  }
});

test('NetworkManager allows selecting preferred interface/IP', () => {
  const mgr = new NetworkManager();
  const info = mgr.getNetworkInfo();
  assert.ok(info.selected);

  // Test selecting by IP
  const target = info.interfaces[0];
  const updated = mgr.select(target.address);
  assert.equal(updated.selected.address, target.address);
  assert.equal(mgr.getSelectedIp(), target.address);
});
