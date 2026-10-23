'use strict';

const assert = require('assert');
const oui = require('../../server/oui');
const { detectVendor } = require('../../server/vendors/detect');
const { adapters, READ_ADAPTER_IDS } = require('../../server/vendors/adapters');
const { FINGERPRINT_PATHS } = require('../../server/tools/router-detect');
const { check } = require('./harness');

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
  assert.strictEqual(oui.lookupOui('68:4a:76:10:20:30').vendor, 'eero');
  assert.strictEqual(oui.lookupOui('14:22:db:10:20:30').vendor, 'eero');
  assert.strictEqual(oui.lookupOui('48:dd:0c:10:20:30').vendor, 'eero');
  const byOui = detectVendor({ gateway_mac: '68:4a:76:10:20:30' });
  assert.strictEqual(byOui.vendor, 'eero');
  assert.strictEqual(byOui.confidence, 'medium');
  assert.strictEqual(byOui.local_api, 'none (app/cloud only)');
  const byLan = detectVendor({ gateway_ip: '192.168.4.1' });
  assert.strictEqual(byLan.vendor, 'eero');
  assert.strictEqual(byLan.confidence, 'low');
  assert.deepStrictEqual(byLan.evidence.map((item) => item.source), ['gateway']);
  assert.strictEqual(byLan.local_api, 'none (app/cloud only)');
  const byBoth = detectVendor({ gateway_mac: '68:4a:76:10:20:30', gateway_ip: '192.168.4.1' });
  assert.strictEqual(byBoth.vendor, 'eero');
  assert.strictEqual(byBoth.confidence, 'high');
  assert.strictEqual(byBoth.local_api, 'none (app/cloud only)');
  const isp = detectVendor({ ssdp: [{ server: 'EXOS/OpenWrt MiniUPnPd', st: 'upnp:rootdevice' }] });
  assert.strictEqual(isp.vendor, 'isp-openwrt');
  assert.strictEqual(isp.label, 'ISP gateway (OpenWrt-based firmware)');
  assert.strictEqual(isp.confidence, 'low');
  assert.strictEqual(detectVendor({
    http_pages: [{ title: 'LuCI', body_excerpt: 'OpenWrt' }],
    ssdp: [{ server: 'EXOS/OpenWrt MiniUPnPd' }]
  }).vendor, 'openwrt');
});
