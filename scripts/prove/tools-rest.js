'use strict';

const assert = require('assert');
const { routerDetect, FINGERPRINT_PATHS } = require('../../server/tools/router-detect');
const { wifiSample } = require('../../server/tools/wifi-sample');
const { report } = require('../../server/tools/report');
const { checkAsync } = require('./harness');
const { LAN, speed, wifiResult, sample, lanHost } = require('./fixtures');

async function run() {
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
        const pathName = new URL(location).pathname;
        if (!FINGERPRINT_PATHS.includes(pathName)) {
          return { ok: false, status: 404, headers: { server: 'ubnt' }, body: 'missing' };
        }
        return { ok: true, status: 200, headers: { server: 'ubnt' }, body: '<title>UniFi OS</title><p>UniFi</p>' };
      }
    });
    assert.ok(fetched[0].includes('/hnc-probe-'));
    assert.deepStrictEqual(fetched.slice(1), FINGERPRINT_PATHS.map((item) => `http://192.168.1.1${item}`));
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

  await checkAsync('router_detect treats a catch-all ISP gateway as weak and an eero by OUI', async () => {
    const fetched = [];
    const body = '<html><title></title>OK</html>';
    const found = await routerDetect({}, {
      platform: 'darwin',
      loadHost: async () => ({
        interfaces: [
          { device: 'en0', address: '192.168.90.50', netmask: '255.255.255.0', gateway: '192.168.90.1' },
          { device: 'en1', address: '192.168.4.20', netmask: '255.255.255.0', gateway: '192.168.4.1' }
        ],
        route: { gateway: '192.168.90.1', interface: 'en0', raw_gateway: '192.168.90.1' }
      }),
      discoverResult: {
        ok: true,
        gateway: { ip: '192.168.90.1', mac: 'c0:ff:ee:00:00:01', interface: 'en0' },
        gateways: [
          { ip: '192.168.90.1', interface: 'en0', mac: 'c0:ff:ee:00:00:01' },
          { ip: '192.168.4.1', interface: 'en1', mac: '68:4a:76:11:22:33' }
        ],
        mdns: { service_types: [] },
        ssdp: [{ server: 'EXOS/OpenWrt MiniUPnPd', location: 'http://192.168.90.1/rootDesc.xml', address: '192.168.90.1', st: 'upnp:rootdevice' }],
        upnp: [],
        arp: [
          { ip: '192.168.90.1', mac: 'c0:ff:ee:00:00:01' },
          { ip: '192.168.4.1', mac: '68:4a:76:11:22:33' }
        ]
      },
      httpGet: async (location) => {
        fetched.push(location);
        const url = new URL(location);
        if (url.hostname === '192.168.90.1') {
          return { ok: true, status: 200, headers: { server: 'micro_httpd' }, body };
        }
        return { ok: false, status: 404, headers: {}, body: '' };
      }
    });
    const ispFetches = fetched.filter((item) => item.includes('192.168.90.1'));
    assert.ok(ispFetches[0].includes('/hnc-probe-'));
    assert.deepStrictEqual(ispFetches.slice(1), FINGERPRINT_PATHS.map((item) => `http://192.168.90.1${item}`));
    assert.strictEqual(found.vendor, 'isp-openwrt');
    assert.strictEqual(found.label, 'ISP gateway (OpenWrt-based firmware)');
    assert.strictEqual(found.confidence, 'low');
    assert.strictEqual(found.catch_all, true);
    assert.ok(found.evidence.some((item) => /miniupnpd/i.test(item.detail)));
    assert.ok(!found.evidence.some((item) => item.source === 'http'));
    const eeroGw = found.gateways.find((item) => item.ip === '192.168.4.1');
    assert.strictEqual(eeroGw.vendor, 'eero');
    assert.strictEqual(eeroGw.local_api, 'none (app/cloud only)');
    assert.strictEqual(eeroGw.interface, 'en1');
    const ispGw = found.gateways.find((item) => item.ip === '192.168.90.1');
    assert.strictEqual(ispGw.vendor, 'isp-openwrt');
    assert.strictEqual(ispGw.confidence, 'low');
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
}

module.exports = { run };
