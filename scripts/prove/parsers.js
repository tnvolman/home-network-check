'use strict';

const assert = require('assert');
const nq = require('../../server/parsers/network-quality');
const ping = require('../../server/parsers/ping');
const ports = require('../../server/parsers/hardware-ports');
const ifconfig = require('../../server/parsers/ifconfig');
const route = require('../../server/parsers/route');
const arp = require('../../server/parsers/arp');
const mdns = require('../../server/parsers/mdns');
const ssdp = require('../../server/parsers/ssdp');
const upnp = require('../../server/parsers/upnp');
const { check } = require('./harness');
const { PORTS, IFCONFIG, QUALITY, PING, UPNP } = require('./fixtures');

check('parsers read fixture output', () => {
  const quality = nq.parseNetworkQuality(QUALITY);
  assert.strictEqual(quality.down_mbps, 240);
  assert.strictEqual(quality.up_mbps, 40);
  assert.strictEqual(quality.base_rtt_ms, 12.5);
  assert.strictEqual(quality.responsiveness_rpm, 1800);
  assert.strictEqual(quality.responsiveness_band, 'medium');
  const text = nq.parseNetworkQuality([
    'Downlink capacity: 20.5 Mbps',
    'Uplink capacity: 5.5 Mbps',
    'Idle Latency: 18.2 milliseconds',
    'Responsiveness: Low (80 RPM)'
  ].join('\n'));
  assert.strictEqual(text.down_mbps, 20.5);
  assert.strictEqual(text.responsiveness_band, 'low');
  assert.strictEqual(text.responsiveness_rpm, 80);
  const latency = ping.parsePing(PING);
  assert.strictEqual(latency.jitter_ms, 0.8);
  assert.strictEqual(latency.loss_pct, 0);
  const mapped = ports.parseHardwarePorts(PORTS);
  assert.strictEqual(mapped.find((item) => item.device === 'en0').kind, 'wifi');
  assert.strictEqual(mapped.find((item) => item.device === 'en5').kind, 'ethernet');
  assert.strictEqual(mapped.find((item) => item.device === 'bridge0').kind, 'other');
  assert.deepStrictEqual(ports.physicalDeviceNames(mapped), ['en0', 'en5']);
  const ifaces = ifconfig.parseIfconfig(IFCONFIG);
  assert.strictEqual(ifconfig.interfaceIsUp(ifaces.find((item) => item.device === 'en0')), true);
  assert.strictEqual(ifconfig.interfaceIsUp(ifaces.find((item) => item.device === 'en5')), false);
  assert.strictEqual(ifconfig.interfaceIsUp(ifaces.find((item) => item.device === 'lo0')), false);
  assert.strictEqual(ifconfig.hostSubnets(ifaces).find((item) => item.device === 'en0').netmask, '255.255.255.0');
  const gateway = route.parseDefaultRoute('    gateway: 192.168.1.1\n  interface: en0\n');
  assert.strictEqual(gateway.gateway, '192.168.1.1');
  const rows = arp.parseArp('? (192.168.1.1) at 0:15:6d:aa:bb:cc on en0 ifscope [ethernet]\n? (192.168.1.9) at (incomplete) on en0 ifscope [ethernet]\n');
  assert.strictEqual(rows[0].mac, '00:15:6d:aa:bb:cc');
  assert.strictEqual(rows[1].incomplete, true);
  const types = mdns.parseMdnsServiceTypes('Add 3 11 local. _eero._tcp. _eero._tcp\nAdd 2 11 local. _http._tcp. _http._tcp\n');
  assert.ok(types.includes('_eero._tcp'));
  assert.ok(!types.some((type) => type.includes('_dns-sd')));
  const reply = ssdp.parseSsdpMessage('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.1/rootDesc.xml\r\nSERVER: eero/1.0\r\nST: ssdp:all\r\nUSN: uuid:abc\r\n\r\n', { address: '192.168.1.1' });
  assert.strictEqual(reply.location, 'http://192.168.1.1/rootDesc.xml');
  const described = upnp.parseUpnpDescription(`<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://8.8.8.8/x">]>${UPNP}`);
  assert.strictEqual(described.manufacturer, 'eero');
  assert.ok(!JSON.stringify(described).includes('8.8.8.8'));
});
