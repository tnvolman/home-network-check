'use strict';

const assert = require('assert');
const oui = require('../../server/oui');
const wifi = require('../../server/parsers/wifi');
const { check } = require('./harness');
const { sample } = require('./fixtures');

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
