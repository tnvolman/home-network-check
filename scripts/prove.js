#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const subnet = require('../server/subnet');
const oui = require('../server/oui');
const nq = require('../server/parsers/network-quality');
const ping = require('../server/parsers/ping');
const ports = require('../server/parsers/hardware-ports');
const ifconfig = require('../server/parsers/ifconfig');
const route = require('../server/parsers/route');
const arp = require('../server/parsers/arp');
const mdns = require('../server/parsers/mdns');
const ssdp = require('../server/parsers/ssdp');
const upnp = require('../server/parsers/upnp');
const wifi = require('../server/parsers/wifi');
const { detectVendor } = require('../server/vendors/detect');
const { adapters, READ_ADAPTER_IDS } = require('../server/vendors/adapters');
const { buildReport, RULES } = require('../server/report/rules');
const { speedTest } = require('../server/tools/speed-test');
const { discover, MAX_LOCATION_FETCHES, DISCOVER_BUDGET_MS } = require('../server/tools/discover');
const { wifiSample } = require('../server/tools/wifi-sample');
const { routerDetect, FINGERPRINT_PATHS } = require('../server/tools/router-detect');
const { report } = require('../server/tools/report');
const { createServer } = require('../server/jsonrpc');
const { tools } = require('../server/tools');

const failures = [];
let passed = 0;
const LAN = [{ address: '192.168.1.42', netmask: '255.255.255.0', device: 'en0' }];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`);
  }
}

function host(address, netmask, device) {
  return [{ address, netmask, device: device || 'en0' }];
}

function sample(fields) {
  return Object.assign({
    ssid: 'Home',
    bssid: null,
    bssid_redacted: true,
    channel: 36,
    band: '5',
    rssi_dbm: -50,
    noise_dbm: -92,
    snr_db: 42,
    tx_rate_mbps: 800
  }, fields);
}

function speed(rows) {
  return { ok: true, interfaces: rows };
}

function wifiResult(findings) {
  return { ok: true, findings: Object.assign({ no_reading: false, weak_reasons: [], bands_seen: ['5'], roaming: false, band_changes: false }, findings) };
}

const PORTS = [
  'Hardware Port: Wi-Fi',
  'Device: en0',
  'Ethernet Address: aa:bb:cc:dd:ee:ff',
  '',
  'Hardware Port: USB 10/100/1000 LAN',
  'Device: en5',
  'Ethernet Address: 11:22:33:44:55:66',
  '',
  'Hardware Port: Thunderbolt Bridge',
  'Device: bridge0',
  'Ethernet Address: 22:22:33:44:55:66'
].join('\n');

const IFCONFIG = [
  'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
  '\tinet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255',
  '\tstatus: active',
  'en5: flags=8822<UP,BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500',
  '\tstatus: inactive',
  'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384',
  '\tinet 127.0.0.1 netmask 0xff000000'
].join('\n');

const QUALITY = JSON.stringify({
  base_rtt: 12.5,
  dl_throughput: 240000000,
  ul_throughput: 40000000,
  responsiveness: 1800,
  dl_responsiveness: 2100,
  ul_responsiveness: 1600,
  interface_name: 'en0'
});

const PING = [
  'PING 192.168.1.1 (192.168.1.1): 56 data bytes',
  '64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=2.100 ms',
  '--- 192.168.1.1 ping statistics ---',
  '5 packets transmitted, 5 packets received, 0.0% packet loss',
  'round-trip min/avg/max/stddev = 1.200/2.400/4.100/0.800 ms'
].join('\n');

const UPNP = [
  '<?xml version="1.0"?>',
  '<root><device>',
  '<friendlyName>Living Room</friendlyName>',
  '<manufacturer>eero</manufacturer>',
  '<modelName>eero Pro</modelName>',
  '<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>',
  '</device></root>'
].join('');

function lanHost() {
  return {
    interfaces: LAN,
    route: { gateway: '192.168.1.1', interface: 'en0', raw_gateway: '192.168.1.1' }
  };
}

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
  assert.deepStrictEqual(probes.map((item) => item.device), ['en0']);
  assert.strictEqual(subnet.isInLocalSubnet('192.168.1.1', probes), true);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.2.3', probes), false);
  assert.strictEqual(subnet.isInLocalSubnet('10.8.0.9', probes), false);
  assert.strictEqual(subnet.isInLocalSubnet('192.168.50.2', probes), false);
  assert.deepStrictEqual(subnet.probeInterfaces(raw, 'utun3'), []);
  assert.strictEqual(subnet.isInLocalSubnet('10.1.2.3', subnet.probeInterfaces(raw, 'utun3')), false);
  assert.strictEqual(subnet.isProbeable('10.1.2.3', raw), false);
  assert.strictEqual(subnet.isProbeable('10.9.0.9', raw), false);
  assert.strictEqual(subnet.isProbeable('10.10.0.9', raw), false);
  assert.strictEqual(subnet.isProbeable('10.11.0.9', raw), false);
  assert.strictEqual(subnet.evaluateTarget('http://10.1.2.3/rootDesc.xml', probes).ok, false);
});

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

check('wifi fixtures, redacted BSSID, roaming, and mesh estimate', () => {
  const profiler = wifi.parseSystemProfiler(JSON.stringify({
    SPAirPortDataType: [{
      spairport_airport_interfaces: [{
        _name: 'en0',
        spairport_current_network_information: {
          _name: 'Home',
          spairport_network_channel: '36 (5GHz, 80MHz)',
          spairport_signal_noise: '-48 dBm / -92 dBm',
          spairport_network_rate: '1200',
          spairport_network_bssid: '<redacted>'
        }
      }]
    }]
  }));
  assert.strictEqual(profiler.ssid, 'Home');
  assert.strictEqual(profiler.band, '5');
  assert.strictEqual(profiler.rssi_dbm, -48);
  assert.strictEqual(profiler.snr_db, 44);
  assert.strictEqual(profiler.bssid_redacted, true);
  const summary = wifi.parseGetsummary('BSSID : aa:bb:cc:dd:ee:10\nSSID : Home\nRSSI : -49\nNOISE : -90\nCHANNEL : 36\nLINKRATE : 800\n');
  const merged = wifi.mergeWifiReading(profiler, summary);
  assert.strictEqual(merged.bssid, 'aa:bb:cc:dd:ee:10');
  assert.strictEqual(merged.bssid_redacted, false);
  const redacted = wifi.analyzeWifiSamples([
    sample({ bssid: null, bssid_redacted: true }),
    sample({ bssid: null, bssid_redacted: true, rssi_dbm: -52 })
  ]);
  assert.strictEqual(redacted.roaming, 'unknown');
  assert.strictEqual(redacted.weak_signal, false);
  assert.strictEqual(redacted.backhaul, 'unknown/inferred');
  const roamed = wifi.analyzeWifiSamples([
    sample({ bssid: 'aa:bb:cc:dd:ee:01', rssi_dbm: -48, snr_db: 40 }),
    sample({ bssid: 'aa:bb:cc:dd:ee:20', rssi_dbm: -49, snr_db: 40, band: '2.4', channel: 6 })
  ]);
  assert.strictEqual(roamed.roaming, true);
  assert.strictEqual(roamed.band_changes, true);
  assert.strictEqual(roamed.mesh_nodes_estimate, 2);
  const sameNode = wifi.analyzeWifiSamples([
    sample({ bssid: 'aa:bb:cc:dd:ee:01' }),
    sample({ bssid: 'aa:bb:cc:dd:ee:04' })
  ]);
  assert.strictEqual(sameNode.roaming, true);
  assert.strictEqual(sameNode.mesh_nodes_estimate, 1);
  const weakRssi = wifi.analyzeWifiSamples([sample({ rssi_dbm: -71, snr_db: 25 })]);
  const boundary = wifi.analyzeWifiSamples([sample({ rssi_dbm: -70, snr_db: 20 })]);
  const weakSnr = wifi.analyzeWifiSamples([sample({ rssi_dbm: -60, snr_db: 19 })]);
  assert.strictEqual(weakRssi.weak_signal, true);
  assert.strictEqual(boundary.weak_signal, false);
  assert.strictEqual(weakSnr.weak_signal, true);
  assert.strictEqual(oui.lookupOui('00:15:6d:aa:bb:cc').vendor, 'Ubiquiti');
  assert.strictEqual(oui.lookupOui('ae:00:00:00:00:01').vendor, null);
  assert.strictEqual(oui.lookupOui('b8:27:eb:00:00:01').vendor, 'Raspberry Pi');
});

check('vendor detection is detect-only', () => {
  for (const adapter of adapters) assert.strictEqual(adapter.read, null, adapter.id);
  assert.deepStrictEqual(READ_ADAPTER_IDS, ['unifi', 'openwrt', 'asus-merlin']);
  assert.deepStrictEqual(FINGERPRINT_PATHS, ['/', '/cgi-bin/luci/', '/Main_Login.asp']);
  assert.ok(FINGERPRINT_PATHS.every((item) => !/reboot|apply|start|passwd/i.test(item)));
  const eero = detectVendor({
    upnp: [{ manufacturer: 'eero', model: 'eero Pro' }],
    mdns_service_types: ['_eero._tcp', '_googlecast._tcp'],
    ssdp: [{ server: 'eero/1.0' }]
  });
  assert.strictEqual(eero.vendor, 'eero');
  assert.strictEqual(eero.confidence, 'high');
  assert.strictEqual(eero.local_api, 'none (app/cloud only)');
  assert.strictEqual(eero.read_adapter, null);
  const unifi = detectVendor({
    upnp: [{ manufacturer: 'Ubiquiti', model: 'UniFi Dream Machine' }],
    gateway_mac: '00:15:6d:11:22:33',
    mdns_service_types: ['_ubnt._tcp', '_googlecast._tcp']
  });
  assert.strictEqual(unifi.vendor, 'unifi');
  assert.strictEqual(unifi.local_api, 'documented');
  assert.strictEqual(unifi.read_adapter, 'unifi');
  assert.strictEqual(detectVendor({ http_pages: [{ title: 'LuCI', body_excerpt: 'OpenWrt' }] }).vendor, 'openwrt');
  assert.strictEqual(detectVendor({ http_pages: [{ title: 'ASUSWRT-Merlin' }] }).vendor, 'asus-merlin');
  assert.strictEqual(detectVendor({ http_pages: [{ body_excerpt: 'NETGEAR Orbi RBR850' }] }).vendor, 'netgear-orbi');
  assert.strictEqual(detectVendor({ upnp: [{ model: 'Deco X50' }] }).vendor, 'tp-link-deco');
  assert.strictEqual(detectVendor({ http_pages: [{ body_excerpt: 'Google Wifi' }], gateway_mac: '54:60:09:aa:bb:cc' }).vendor, 'google-nest-wifi');
  assert.strictEqual(detectVendor({ gateway_mac: '20:e5:2a:aa:bb:cc' }).vendor, 'unknown');
  assert.strictEqual(detectVendor({ gateway_mac: '68:54:fd:aa:bb:cc' }).vendor, 'unknown');
  assert.strictEqual(detectVendor({ mdns_service_types: ['_googlecast._tcp'] }).vendor, 'unknown');
});

check('report rules are ordered and deterministic', () => {
  assert.deepStrictEqual(RULES.map((rule) => rule.id), [
    'unsupported-os', 'no-data', 'no-uplink', 'wired-below-plan', 'wifi-weak-link',
    'band-24', 'wifi-below-plan', 'upload-below-plan', 'bufferbloat', 'roaming',
    'weak-signal', 'healthy'
  ]);
  const weak = buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 40, up_mbps: 20, responsiveness_band: 'medium', responsiveness_rpm: 900 }]),
    wifi_sample: wifiResult({ weak_signal: true, weak_reasons: ['median RSSI -78 dBm is below -70'] })
  });
  assert.strictEqual(weak.rule_id, 'wifi-weak-link');
  assert.strictEqual(weak.bottleneck.id, 'wifi-weak-link');
  assert.ok(weak.cheapest_fix.reason.length > 0);
  const band = buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 70, up_mbps: 20, responsiveness_band: 'high', responsiveness_rpm: 2200 }]),
    wifi_sample: wifiResult({ bands_seen: ['2.4'], weak_signal: false })
  });
  assert.strictEqual(band.rule_id, 'band-24');
  const wired = buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'ethernet', status: 'tested', down_mbps: 40, up_mbps: 40, responsiveness_band: 'low', responsiveness_rpm: 100 }])
  });
  assert.strictEqual(wired.rule_id, 'wired-below-plan');
  const upload = buildReport({
    plan_down_mbps: 300,
    plan_up_mbps: 40,
    speed_test: speed([{ kind: 'ethernet', status: 'tested', down_mbps: 290, up_mbps: 5, responsiveness_band: 'high', responsiveness_rpm: 2200 }])
  });
  assert.strictEqual(upload.rule_id, 'upload-below-plan');
  const bloat = buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 280, up_mbps: 40, responsiveness_band: 'low', responsiveness_rpm: 80 }]),
    wifi_sample: wifiResult({ weak_signal: false, roaming: false }),
    router_detect: { ok: true, vendor: 'eero', confidence: 'high' }
  });
  assert.strictEqual(bloat.rule_id, 'bufferbloat');
  assert.ok(/Optimize for Conferencing and Gaming/.test(bloat.cheapest_fix.action));
  const roam = buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 280, up_mbps: 40, responsiveness_band: 'high', responsiveness_rpm: 2200 }]),
    wifi_sample: wifiResult({ roaming: true, roaming_detail: 'BSSID changed across 2 addresses.', mesh_nodes_estimate: 2 })
  });
  assert.strictEqual(roam.rule_id, 'roaming');
  const healthy = buildReport({
    plan_down_mbps: 300,
    plan_up_mbps: 40,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 280, up_mbps: 40, responsiveness_band: 'high', responsiveness_rpm: 2200 }]),
    wifi_sample: wifiResult({ roaming: 'unknown', weak_signal: false })
  });
  assert.strictEqual(healthy.rule_id, 'healthy');
  assert.deepStrictEqual(buildReport({
    plan_down_mbps: 300,
    speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 40, up_mbps: 10, responsiveness_band: 'medium', responsiveness_rpm: 800 }]),
    wifi_sample: wifiResult({ weak_signal: true, weak_reasons: ['median RSSI -78 dBm is below -70'] })
  }), weak);
  assert.strictEqual(buildReport({ discover: { ok: true, gateway: { ip: null } } }).rule_id, 'no-uplink');
  assert.strictEqual(buildReport({}).rule_id, 'no-data');
  assert.strictEqual(buildReport({ speed_test: { ok: false, error: 'unsupported OS' } }).rule_id, 'unsupported-os');
});

check('server modules stay under 300 lines and hold no credentials', () => {
  const stack = [path.join(root, 'server')];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (name.endsWith('.js')) {
        const text = fs.readFileSync(full, 'utf8');
        const lines = text.split('\n').length;
        assert.ok(lines <= 300, `${path.relative(root, full)} has ${lines} lines`);
        assert.ok(!/api[_-]?key|secret|BEGIN [A-Z ]*PRIVATE|password\s*[:=]/i.test(text), full);
      }
    }
  }
});

async function main() {
  await checkAsync('speed_test skips a down interface and will not ping a public gateway', async () => {
    const calls = [];
    const runCommand = async (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
      if (file === 'networksetup') return { stdout: PORTS, ok: true, spawnError: false };
      if (file === 'ifconfig') return { stdout: IFCONFIG, ok: true, spawnError: false };
      if (file === 'ping') return { stdout: PING, ok: true, spawnError: false };
      if (file === 'networkQuality') return { stdout: QUALITY, ok: true, spawnError: false };
      throw new Error(`unexpected ${file}`);
    };
    const skipped = await speedTest({ interface: 'ethernet' }, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand
    });
    assert.strictEqual(skipped.interfaces[0].status, 'skipped');
    assert.ok(!calls.some((call) => call.startsWith('networkQuality')));
    calls.length = 0;
    const blocked = await speedTest({ interface: 'wifi', plan_down_mbps: 300, plan_up_mbps: 40 }, {
      platform: 'darwin',
      loadHost: async () => ({
        interfaces: LAN,
        route: { gateway: '8.8.8.8', interface: 'en0', raw_gateway: '8.8.8.8' }
      }),
      runCommand
    });
    assert.ok(!calls.some((call) => call.startsWith('ping')));
    assert.strictEqual(blocked.interfaces[0].status, 'tested');
    assert.strictEqual(blocked.interfaces[0].down_mbps, 240);
    assert.strictEqual(blocked.interfaces[0].vs_plan.down_vs_plan, 'meets_plan');
    assert.strictEqual(blocked.interfaces[0].ping_gateway.skipped, true);
    const linux = await speedTest({}, {
      platform: 'linux',
      runCommand: () => { throw new Error('spawned'); }
    });
    assert.strictEqual(linux.error, 'unsupported OS');
  });

  await checkAsync('discover fetches only in-subnet UPnP descriptions', async () => {
    const fetched = [];
    let searched = false;
    const result = await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand: async (file) => {
        if (file === 'arp') {
          return {
            stdout: '? (192.168.1.1) at 00:15:6d:aa:bb:cc on en0 ifscope [ethernet]\n? (8.8.8.8) at aa:bb:cc:dd:ee:01 on en0 ifscope [ethernet]\n',
            ok: true,
            spawnError: false,
            timedOut: false
          };
        }
        if (file === 'dns-sd') {
          return { stdout: 'Add 3 11 local. _eero._tcp. _eero._tcp\n', ok: false, spawnError: false, timedOut: true };
        }
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => {
        searched = true;
        return [
          { server: 'eero/1.0', location: 'http://8.8.8.8/rootDesc.xml', st: 'ssdp:all', usn: 'pub', address: '8.8.8.8' },
          { server: 'eero/1.0', location: 'http://192.168.1.1:5000/rootDesc.xml', st: 'ssdp:all', usn: 'gw', address: '192.168.1.1' },
          { server: 'x', location: 'http://user:pass@192.168.1.1/rootDesc.xml', st: 'x', usn: 'auth', address: '192.168.1.1' },
          { server: 'x', location: 'http://router.local/rootDesc.xml', st: 'x', usn: 'name', address: '192.168.1.9' },
          { server: 'x', location: 'http://192.168.2.1/rootDesc.xml', st: 'x', usn: 'other', address: '192.168.2.1' }
        ];
      },
      httpGet: async (location) => {
        fetched.push(location);
        assert.strictEqual(subnet.evaluateTarget(location, LAN).ok, true);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.strictEqual(searched, true);
    assert.deepStrictEqual(fetched, ['http://192.168.1.1:5000/rootDesc.xml']);
    assert.ok(result.skipped_probes.some((item) => item.target.includes('8.8.8.8')));
    assert.ok(result.probes.filter((item) => item.allowed && item.kind === 'upnp-description').every((item) => item.target.startsWith('192.168.1.1')));
    const gateway = result.devices.find((item) => item.ip === '192.168.1.1');
    assert.strictEqual(gateway.vendor_guess, 'eero');
    assert.strictEqual(gateway.probed, true);
    const outsider = result.arp.find((item) => item.ip === '8.8.8.8');
    assert.strictEqual(outsider.in_local_subnet, false);
    let ssdpCalled = false;
    const blocked = await discover({}, {
      platform: 'linux',
      ssdpSearch: async () => { ssdpCalled = true; return []; },
      httpGet: async () => { ssdpCalled = true; return {}; },
      runCommand: async () => { throw new Error('spawned'); }
    });
    assert.strictEqual(blocked.error, 'unsupported OS');
    assert.strictEqual(ssdpCalled, false);
  });

  await checkAsync('discover ignores a VPN 10/8 and caps location fetches', async () => {
    assert.strictEqual(MAX_LOCATION_FETCHES, 16);
    assert.ok(DISCOVER_BUDGET_MS > 0);
    const ifconfigText = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255',
      '\tstatus: active',
      'en5: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.50.20 netmask 0xffffff00 broadcast 192.168.50.255',
      '\tstatus: active',
      'utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380',
      '\tinet 10.0.0.2 --> 10.0.0.1 netmask 0xff000000'
    ].join('\n');
    const parsedUtun = ifconfig.parseIfconfig(ifconfigText).find((item) => item.device === 'utun3');
    assert.strictEqual(parsedUtun.addresses[0].address, '10.0.0.2');
    assert.strictEqual(parsedUtun.addresses[0].netmask, '255.0.0.0');
    const fetched = [];
    const result = await discover({}, {
      platform: 'darwin',
      runCommand: async (file) => {
        if (file === 'route') {
          return { stdout: 'gateway: 192.168.1.1\ninterface: en0\n', ok: true, spawnError: false };
        }
        if (file === 'ifconfig') return { stdout: ifconfigText, ok: true, spawnError: false };
        if (file === 'arp') return { stdout: '', ok: true, spawnError: false };
        if (file === 'dns-sd') return { stdout: '', ok: false, spawnError: false, timedOut: true };
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => ([
        { server: 'vpn', location: 'http://10.1.2.3/rootDesc.xml', st: 'ssdp:all', usn: 'vpn', address: '10.1.2.3' },
        { server: 'other', location: 'http://192.168.50.2/rootDesc.xml', st: 'ssdp:all', usn: 'other', address: '192.168.50.2' },
        { server: 'gw', location: 'http://192.168.1.1/rootDesc.xml', st: 'ssdp:all', usn: 'gw', address: '192.168.1.1' }
      ]),
      httpGet: async (location) => {
        fetched.push(location);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.deepStrictEqual(result.host.interfaces.map((item) => item.device), ['en0']);
    assert.deepStrictEqual(fetched, ['http://192.168.1.1/rootDesc.xml']);
    assert.ok(result.skipped_probes.some((item) => item.target.includes('10.1.2.3')));
    assert.ok(result.skipped_probes.some((item) => item.target.includes('192.168.50.2')));

    const many = [];
    const capped = await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand: async (file) => {
        if (file === 'arp' || file === 'dns-sd') return { stdout: '', ok: true, spawnError: false, timedOut: false };
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => Array.from({ length: 20 }, (_, index) => ({
        server: 'dev',
        location: `http://192.168.1.1:${8000 + index}/desc.xml`,
        st: 'ssdp:all',
        usn: `u${index}`,
        address: '192.168.1.1'
      })),
      httpGet: async (location) => {
        many.push(location);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.strictEqual(many.length, 16);
    assert.ok(capped.skipped_probes.filter((item) => item.reason === 'location fetch cap').length >= 4);

    let clock = 0;
    const timed = [];
    await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      now: () => clock,
      runCommand: async () => ({ stdout: '', ok: true, spawnError: false, timedOut: false }),
      ssdpSearch: async () => ([
        { server: 'a', location: 'http://192.168.1.1/a.xml', st: 'ssdp:all', usn: 'a', address: '192.168.1.1' },
        { server: 'b', location: 'http://192.168.1.1/b.xml', st: 'ssdp:all', usn: 'b', address: '192.168.1.1' },
        { server: 'c', location: 'http://192.168.1.1/c.xml', st: 'ssdp:all', usn: 'c', address: '192.168.1.1' }
      ]),
      httpGet: async (location) => {
        timed.push(location);
        clock = DISCOVER_BUDGET_MS + 1;
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.deepStrictEqual(timed, ['http://192.168.1.1/a.xml']);
  });

  await checkAsync('router_detect GETs only a probeable gateway', async () => {
    const fetched = [];
    const found = await routerDetect({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      discoverResult: {
        ok: true,
        gateway: { ip: '192.168.1.1', mac: '00:15:6d:aa:bb:cc' },
        mdns: { service_types: ['_ubnt._tcp', '_googlecast._tcp'] },
        ssdp: [{ server: 'Ubiquiti UniFi', location: 'http://192.168.1.1/desc.xml', address: '192.168.1.1', st: 'upnp' }],
        upnp: [{ ip: '192.168.1.1', manufacturer: 'Ubiquiti', model: 'UniFi Dream Machine' }, { ip: '8.8.8.8', manufacturer: 'Ignore' }]
      },
      httpGet: async (location) => {
        fetched.push(location);
        return { ok: true, status: 200, headers: { server: 'ubnt' }, body: '<title>UniFi OS</title><p>UniFi</p>' };
      }
    });
    assert.deepStrictEqual(fetched, FINGERPRINT_PATHS.map((item) => `http://192.168.1.1${item}`));
    assert.strictEqual(found.vendor, 'unifi');
    assert.strictEqual(found.read_adapter, 'unifi');
    const refused = [];
    const hidden = await routerDetect({}, {
      platform: 'darwin',
      loadHost: async () => ({ interfaces: LAN, route: { gateway: '8.8.8.8', interface: 'en0', raw_gateway: '8.8.8.8' } }),
      discoverResult: { ok: true, gateway: { ip: '8.8.8.8' }, ssdp: [], upnp: [], mdns: { service_types: [] } },
      httpGet: async (location) => { refused.push(location); return { body: '' }; }
    });
    assert.deepStrictEqual(refused, []);
    assert.strictEqual(hidden.vendor, 'unknown');
    const linux = await routerDetect({}, {
      platform: 'linux',
      httpGet: async () => { throw new Error('fetched'); },
      ssdpSearch: async () => { throw new Error('searched'); }
    });
    assert.strictEqual(linux.error, 'unsupported OS');
  });

  await checkAsync('wifi_sample and report do not touch the network when injected or unsupported', async () => {
    let sleeps = 0;
    const sampled = await wifiSample({ samples: 2, interval_s: 10 }, {
      platform: 'darwin',
      sleep: async () => { sleeps += 1; },
      readSample: async () => sample({ bssid: 'aa:bb:cc:dd:ee:01', bssid_redacted: false, rssi_dbm: -55, snr_db: 35 })
    });
    assert.strictEqual(sleeps, 1);
    assert.strictEqual(sampled.samples.length, 2);
    assert.strictEqual(sampled.findings.roaming, false);
    const linux = await wifiSample({}, { platform: 'linux', readSample: async () => { throw new Error('read'); } });
    assert.strictEqual(linux.error, 'unsupported OS');
    let spawned = false;
    const judged = await report({
      plan_down_mbps: 300,
      collected: {
        speed_test: speed([{ kind: 'wifi', status: 'tested', down_mbps: 40, up_mbps: 10, responsiveness_band: 'medium', responsiveness_rpm: 800 }]),
        wifi_sample: wifiResult({ weak_signal: true, weak_reasons: ['median RSSI -78 dBm is below -70'] }),
        discover: { ok: true, gateway: { ip: '192.168.1.1' } },
        router_detect: { ok: true, vendor: 'unknown' }
      }
    }, {
      platform: 'linux',
      runCommand: async () => { spawned = true; throw new Error('spawned'); },
      ssdpSearch: async () => { spawned = true; return []; },
      httpGet: async () => { spawned = true; return {}; }
    });
    assert.strictEqual(spawned, false);
    assert.strictEqual(judged.rule_id, 'wifi-weak-link');
    assert.ok(judged.bottleneck.title);
    assert.ok(judged.cheapest_fix.reason);
  });

  await checkAsync('mcp initialize and tools/list handshake', async () => {
    const server = createServer(tools);
    const init = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prove', version: '0.1.0' } }
    });
    assert.strictEqual(init.result.serverInfo.name, 'home-network-check');
    assert.strictEqual(init.result.protocolVersion, '2024-11-05');
    const bad = await server.handle({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'wifi_sample', arguments: { samples: 0 } }
    });
    assert.strictEqual(bad.error.code, -32602);
    const child = spawn(process.execPath, [path.join(root, 'server/hnc-mcp.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    const messages = [];
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) messages.push(JSON.parse(line));
      }
    });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const waitFor = (id) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for id ${id}`)), 4000);
      const poll = setInterval(() => {
        const found = messages.find((message) => message.id === id);
        if (!found) return;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(found);
      }, 15);
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prove', version: '0.1.0' } }
    });
    const initialized = await waitFor(1);
    assert.strictEqual(initialized.result.protocolVersion, '2025-03-26');
    assert.ok(initialized.result.capabilities.tools);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = await waitFor(2);
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepStrictEqual(names, ['speed_test', 'discover', 'wifi_sample', 'router_detect', 'report']);
    for (const tool of listed.result.tools) {
      assert.ok(tool.inputSchema && tool.inputSchema.type === 'object', tool.name);
      assert.ok(tool.outputSchema, tool.name);
      assert.strictEqual(tool.annotations.readOnlyHint, true);
    }
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'speed_test', arguments: {} } });
    const called = await waitFor(3);
    assert.strictEqual(called.result.isError, false);
    assert.strictEqual(called.result.structuredContent.error, 'unsupported OS');
    child.kill('SIGTERM');
  });

  console.log('---');
  console.log(`passed ${passed}`);
  console.log(`failed ${failures.length}${failures.length ? `: ${failures.join(', ')}` : ''}`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
