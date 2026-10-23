'use strict';

const assert = require('assert');
const subnet = require('../../server/subnet');
const { check } = require('./harness');
const { LAN, host } = require('./fixtures');

check('public and non-subnet addresses are refused', () => {
  const refused = [
    '8.8.8.8', '1.1.1.1', '9.9.9.9', '1.0.0.1', '208.67.222.222',
    '192.0.2.1', '198.51.100.1', '203.0.113.5', '172.32.0.1', '172.15.255.255',
    '11.0.0.1', '100.64.0.1', '127.0.0.1', '0.0.0.0', '255.255.255.255',
    '224.0.0.1', '239.255.255.250', '192.168.2.1', '10.0.0.1', '169.254.1.1',
    '192.168.001.1', '2001:4860:4860::8888', 'not-an-ip', '', null, 8
  ];
  for (const ip of refused) {
    assert.strictEqual(subnet.isInLocalSubnet(ip, LAN), false, `accepted ${ip}`);
    assert.strictEqual(subnet.isProbeable(ip, LAN), false, `probeable ${ip}`);
  }
  assert.strictEqual(subnet.isInLocalSubnet('192.168.1.1', LAN), true);
  assert.strictEqual(subnet.isInLocalSubnet('192.168.1.255', LAN), true);
  assert.strictEqual(subnet.isProbeable('192.168.1.255', LAN), false);
  assert.strictEqual(subnet.isProbeable('192.168.1.0', LAN), false);
  assert.strictEqual(subnet.isProbeable('192.168.1.1', LAN), true);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.2.3', host('10.1.2.1', '255.255.0.0')), true);
  assert.strictEqual(subnet.isInLocalSubnet('10.2.0.1', host('10.1.2.1', '255.255.0.0')), false);
  assert.strictEqual(subnet.isInLocalSubnet('172.16.5.9', host('172.16.5.1', '255.255.255.0')), true);
  assert.strictEqual(subnet.isInLocalSubnet('172.31.1.1', host('172.31.1.2', '255.255.255.0')), true);
  assert.strictEqual(subnet.isInLocalSubnet('169.254.1.5', host('169.254.1.2', '255.255.0.0')), true);
  assert.strictEqual(subnet.isInLocalSubnet('169.254.1.5', LAN), false);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.1.1', host('10.0.0.1', '0.0.0.0')), false);
  assert.strictEqual(subnet.isInLocalSubnet('8.8.8.8', host('8.8.8.8', '255.255.255.0')), false);
});

check('probe urls stay on literal in-subnet addresses', () => {
  const ok = subnet.evaluateTarget('http://192.168.1.1:5000/rootDesc.xml', LAN);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.ip, '192.168.1.1');
  assert.strictEqual(ok.port, 5000);
  for (const bad of [
    'http://8.8.8.8/rootDesc.xml',
    'http://192.168.2.5/rootDesc.xml',
    'http://user:pass@192.168.1.1/rootDesc.xml',
    'http://router.local/rootDesc.xml',
    'file:///etc/passwd',
    'http://192.168.1.255/x'
  ]) {
    assert.strictEqual(subnet.evaluateTarget(bad, LAN).ok, false, bad);
  }
});

check('vpn tunnels and non-default interfaces are not local', () => {
  const raw = [
    { device: 'en0', address: '192.168.1.42', netmask: '255.255.255.0', up: true },
    { device: 'en5', address: '192.168.50.20', netmask: '255.255.255.0', up: true },
    { device: 'utun3', address: '10.0.0.2', netmask: '255.0.0.0', up: true },
    { device: 'ipsec0', address: '10.8.0.2', netmask: '255.255.255.0', up: true },
    { device: 'ppp0', address: '10.9.0.2', netmask: '255.255.255.0', up: true },
    { device: 'tun0', address: '10.10.0.2', netmask: '255.255.255.0', up: true },
    { device: 'wg0', address: '10.11.0.2', netmask: '255.255.255.0', up: true }
  ];
  for (const row of raw.slice(2)) assert.strictEqual(subnet.isTunnelDevice(row.device), true, row.device);
  assert.strictEqual(subnet.isTunnelDevice('en0'), false);
  const probes = subnet.probeInterfaces(raw, 'en0');
  assert.deepStrictEqual(probes.map((item) => item.device), ['en0', 'en5']);
  assert.strictEqual(subnet.isInLocalSubnet('192.168.1.1', probes), true);
  assert.strictEqual(subnet.isInLocalSubnet('192.168.50.2', probes), true);
  assert.strictEqual(subnet.isProbeable('192.168.50.2', probes.filter((item) => item.device === 'en0')), false);
  assert.strictEqual(subnet.isProbeable('192.168.1.1', probes.filter((item) => item.device === 'en5')), false);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.2.3', probes), false);
  assert.strictEqual(subnet.isInLocalSubnet('10.8.0.9', probes), false);
  const mini = subnet.probeInterfaces([
    { device: 'en0', address: '192.168.90.50', netmask: '255.255.255.0', up: true },
    { device: 'en1', address: '192.168.4.20', netmask: '255.255.255.0', up: true },
    { device: 'utun4', address: '10.0.0.8', netmask: '255.255.255.0', up: true }
  ], 'en0');
  assert.deepStrictEqual(mini.map((item) => item.device), ['en0', 'en1']);
  assert.strictEqual(subnet.isProbeable('192.168.90.1', mini), true);
  assert.strictEqual(subnet.isProbeable('192.168.4.1', mini), true);
  assert.strictEqual(subnet.isProbeable('192.168.4.1', mini.filter((item) => item.device === 'en0')), false);
  assert.strictEqual(subnet.isProbeable('10.0.0.1', mini), false);
  const whileVirtual = subnet.probeInterfaces(raw, 'utun3');
  assert.deepStrictEqual(whileVirtual.map((item) => item.device), ['en0', 'en5']);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.2.3', whileVirtual), false);
  const virtual = [
    { device: 'en0', address: '192.168.90.50', netmask: '255.255.255.0', up: true },
    { device: 'en1', address: '192.168.4.20', netmask: '255.255.255.0', up: true },
    { device: 'en9', address: '10.99.0.8', netmask: '255.255.255.0', up: true },
    { device: 'feth1234', address: '10.147.17.5', netmask: '255.255.255.0', up: true },
    { device: 'tap0', address: '10.8.0.6', netmask: '255.255.255.0', up: true }
  ];
  const listed = subnet.probeInterfaces(virtual, 'feth1234', ['en0', 'en1']);
  assert.deepStrictEqual(listed.map((item) => item.device), ['en0', 'en1']);
  assert.strictEqual(subnet.isProbeable('10.147.17.1', listed), false);
  assert.strictEqual(subnet.isProbeable('10.8.0.1', listed), false);
  assert.strictEqual(subnet.isProbeable('10.99.0.1', listed), false);
  assert.deepStrictEqual(subnet.probeInterfaces(virtual, 'feth1234').map((item) => item.device), ['en0', 'en1', 'en9']);
  assert.strictEqual(subnet.deviceAllowed('feth1234'), false);
  assert.strictEqual(subnet.deviceAllowed('tap0'), false);
  assert.strictEqual(subnet.deviceAllowed('en9', ['en0', 'en1']), false);
  assert.strictEqual(subnet.deviceAllowed('en0', ['en0', 'en1']), true);
  assert.strictEqual(subnet.isProbeable('10.1.2.3', raw), false);
  assert.strictEqual(subnet.isProbeable('10.9.0.9', raw), false);
  assert.strictEqual(subnet.isProbeable('10.10.0.9', raw), false);
  assert.strictEqual(subnet.isProbeable('10.11.0.9', raw), false);
  assert.strictEqual(subnet.evaluateTarget('http://10.1.2.3/rootDesc.xml', probes).ok, false);
});
