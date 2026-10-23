'use strict';

const assert = require('assert');
const { buildReport, RULES } = require('../../server/report/rules');
const { check } = require('./harness');
const { speed, wifiResult } = require('./fixtures');

check('report rules are ordered and deterministic', () => {
  assert.deepStrictEqual(RULES.map((rule) => rule.id), [
    'unsupported-os', 'no-data', 'no-uplink', 'wired-below-plan', 'wifi-weak-link',
    'band-24', 'wifi-below-plan', 'upload-below-plan', 'bufferbloat', 'double-nat',
    'roaming', 'weak-signal', 'healthy'
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
  const splitHost = {
    ok: true,
    gateway: { ip: '192.168.90.1', interface: 'en0' },
    host: {
      interfaces: [
        { device: 'en0', address: '192.168.90.50', netmask: '255.255.255.0' },
        { device: 'en1', address: '192.168.4.20', netmask: '255.255.255.0' }
      ]
    }
  };
  const splitRouters = {
    ok: true,
    vendor: 'isp-openwrt',
    label: 'ISP gateway (OpenWrt-based firmware)',
    confidence: 'low',
    gateways: [
      { ip: '192.168.90.1', interface: 'en0', vendor: 'isp-openwrt', label: 'ISP gateway (OpenWrt-based firmware)', confidence: 'low' },
      { ip: '192.168.4.1', interface: 'en1', vendor: 'eero', label: 'eero', confidence: 'high', local_api: 'none (app/cloud only)' }
    ]
  };
  const ranked = buildReport({
    discover: splitHost,
    router_detect: splitRouters,
    speed_test: speed([
      { kind: 'ethernet', device: 'en0', status: 'tested', down_mbps: 900, up_mbps: 40, responsiveness_band: 'medium', responsiveness_rpm: 840 },
      { kind: 'wifi', device: 'en1', status: 'tested', down_mbps: 400, up_mbps: 40, responsiveness_band: 'low', responsiveness_rpm: 126 }
    ])
  });
  assert.strictEqual(ranked.rule_id, 'bufferbloat');
  assert.strictEqual(ranked.bottleneck.detail, 'Wi-Fi responsiveness of 126 RPM (low) against Ethernet\'s 840 RPM.');
  assert.ok(/Optimize for Conferencing and Gaming/.test(ranked.cheapest_fix.action));
  assert.ok(ranked.next_options.some((item) => /bridge\/passthrough/.test(item.action) && /plug the Mini into the eero/.test(item.action) && /double NAT or split networks/.test(item.reason)));
  const splitOnly = buildReport({
    discover: splitHost,
    router_detect: splitRouters,
    speed_test: speed([
      { kind: 'ethernet', device: 'en0', status: 'tested', down_mbps: 900, up_mbps: 40, responsiveness_band: 'high', responsiveness_rpm: 2200 },
      { kind: 'wifi', device: 'en1', status: 'tested', down_mbps: 400, up_mbps: 40, responsiveness_band: 'high', responsiveness_rpm: 2000 }
    ])
  });
  assert.strictEqual(splitOnly.rule_id, 'double-nat');
  assert.strictEqual(splitOnly.bottleneck.title, 'double NAT or split networks');
  assert.ok(/bridge\/passthrough/.test(splitOnly.cheapest_fix.action));
  assert.ok(/plug the Mini into the eero/.test(splitOnly.cheapest_fix.action));
  assert.strictEqual(buildReport({
    discover: {
      ok: true,
      host: { interfaces: [
        { device: 'en0', address: '192.168.1.10', netmask: '255.255.255.0' },
        { device: 'en1', address: '192.168.1.20', netmask: '255.255.255.0' }
      ] }
    },
    router_detect: {
      ok: true,
      gateways: [
        { ip: '192.168.1.1', interface: 'en0', vendor: 'isp-openwrt', label: 'ISP gateway (OpenWrt-based firmware)' },
        { ip: '192.168.1.1', interface: 'en1', vendor: 'eero', label: 'eero' }
      ]
    },
    speed_test: speed([{ kind: 'ethernet', status: 'tested', down_mbps: 100, up_mbps: 10, responsiveness_band: 'high', responsiveness_rpm: 2000 }])
  }).rule_id, 'healthy');
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
