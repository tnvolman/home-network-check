'use strict';

function classifyPort(name) {
  const n = String(name || '').toLowerCase();
  if (/wi-?fi|airport|wireless/.test(n)) return 'wifi';
  if (/bridge|bluetooth|firewire|vpn|phone|modem/.test(n)) return 'other';
  if (/ethernet|\blan\b|10\/100|gigabit|usb/.test(n) && !/bluetooth/.test(n)) return 'ethernet';
  return 'other';
}

function parseHardwarePorts(text) {
  const ports = [];
  let current = null;
  for (const line of String(text || '').split(/\n/)) {
    const port = /^Hardware Port:\s*(.*)$/.exec(line);
    if (port) {
      current = { hardware_port: port[1].trim(), device: null, ethernet_address: null };
      ports.push(current);
      continue;
    }
    if (!current) continue;
    const device = /^Device:\s*(\S+)/.exec(line);
    if (device) current.device = device[1];
    const mac = /^Ethernet Address:\s*(\S+)/.exec(line);
    if (mac) current.ethernet_address = mac[1].toLowerCase();
  }
  return ports
    .filter((p) => p.device)
    .map((p) => Object.assign({ kind: classifyPort(p.hardware_port) }, p));
}

function deviceNameOk(device) {
  return typeof device === 'string' && /^[a-z][a-z0-9]{0,15}$/.test(device);
}

module.exports = { parseHardwarePorts, classifyPort, deviceNameOk };
