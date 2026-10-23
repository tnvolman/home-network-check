'use strict';

const path = require('path');

const root = path.join(__dirname, '..', '..');
const LAN = [{ address: '192.168.1.42', netmask: '255.255.255.0', device: 'en0' }];

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
  return {
    ok: true,
    findings: Object.assign({
      no_reading: false,
      weak_reasons: [],
      bands_seen: ['5'],
      roaming: false,
      band_changes: false
    }, findings)
  };
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

module.exports = {
  root,
  LAN,
  host,
  sample,
  speed,
  wifiResult,
  PORTS,
  IFCONFIG,
  QUALITY,
  PING,
  UPNP,
  lanHost
};
