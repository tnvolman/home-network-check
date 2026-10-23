'use strict';

// Offline subset of public OUIs for home gear. Unknown and locally
// administered MACs return null. This table is never updated over the network.
const OUI = {
  '00156D': 'Ubiquiti',
  '245A4C': 'Ubiquiti',
  '788A20': 'Ubiquiti',
  'FCECDA': 'Ubiquiti',
  'B827EB': 'Raspberry Pi',
  'DCA632': 'Raspberry Pi',
  'E45F01': 'Raspberry Pi',
  '28CDC1': 'Raspberry Pi',
  '240AC4': 'Espressif',
  '30AEA4': 'Espressif',
  'A4CF12': 'Espressif',
  '84CCA8': 'Espressif',
  'ECFABC': 'Espressif',
  '001A11': 'Google',
  '3C5AB4': 'Google',
  'F4F5E8': 'Google',
  '546009': 'Google',
  '18B430': 'Nest',
  '6854FD': 'Amazon',
  '00FC8B': 'Amazon',
  'FC65DE': 'Amazon',
  '74C246': 'Amazon',
  '40B4CD': 'Amazon',
  '04D9F5': 'ASUSTek',
  '2C4D54': 'ASUSTek',
  'AC9E17': 'ASUSTek',
  '000C6E': 'ASUSTek',
  '50C7BF': 'TP-Link',
  '14CC20': 'TP-Link',
  'A0F3C1': 'TP-Link',
  '98DAC4': 'TP-Link',
  '00095B': 'NETGEAR',
  '000FB5': 'NETGEAR',
  '20E52A': 'NETGEAR',
  'A021B7': 'NETGEAR',
  '001788': 'Philips Lighting',
  'B0A737': 'Roku',
  'CC6DA0': 'Roku',
  '3C22FB': 'Apple',
  'A483E7': 'Apple',
  'F01898': 'Apple'
};

function normalizeMac(mac) {
  if (typeof mac !== 'string') return null;
  const parts = mac.trim().toLowerCase().replace(/-/g, ':').split(':');
  if (parts.length !== 6) return null;
  if (!parts.every((part) => /^[0-9a-f]{1,2}$/.test(part))) return null;
  return parts.map((part) => part.padStart(2, '0')).join(':');
}

function isLocallyAdministered(mac) {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const first = parseInt(norm.slice(0, 2), 16);
  return (first & 0x02) === 0x02;
}

function isMulticastMac(mac) {
  const norm = normalizeMac(mac);
  if (!norm) return false;
  const first = parseInt(norm.slice(0, 2), 16);
  return (first & 0x01) === 0x01;
}

function lookupOui(mac) {
  const norm = normalizeMac(mac);
  if (!norm || isLocallyAdministered(norm) || isMulticastMac(norm)) {
    return { vendor: null, locally_administered: isLocallyAdministered(norm), mac: norm };
  }
  const key = norm.replace(/:/g, '').slice(0, 6).toUpperCase();
  return {
    vendor: OUI[key] || null,
    locally_administered: false,
    mac: norm
  };
}

module.exports = {
  OUI,
  normalizeMac,
  isLocallyAdministered,
  lookupOui
};
