'use strict';

// Detect-only adapters. `read` stays null in v0.1.
// v0.2 can set `read` on unifi, openwrt, and asus-merlin without changing callers.

function textHit(signals, re, points, label) {
  const hits = signals.filter((s) => s.source !== 'oui' && re.test(String(s.detail)));
  if (!hits.length) return null;
  return { points, label, evidence: hits };
}

function ouiHit(signals, vendors, points, label) {
  const hits = signals.filter((s) => s.source === 'oui' && vendors.includes(s.vendor));
  if (!hits.length) return null;
  return { points, label, evidence: hits };
}

function scoreOf(parts) {
  const present = parts.filter(Boolean);
  if (!present.length) return null;
  const evidence = [];
  let points = 0;
  const sources = new Set();
  for (const part of present) {
    points += part.points;
    for (const item of part.evidence) {
      sources.add(item.source);
      if (evidence.length < 6) evidence.push(item);
    }
  }
  return { points, evidence, sources: [...sources] };
}

const adapters = [
  {
    id: 'openwrt',
    label: 'OpenWrt',
    localApi: 'documented',
    adjustableSettings: [
      'SQM with cake, set just under the plan',
      'Wi-Fi channel, width, and transmit power',
      '802.11r roaming',
      'DNS and DHCP'
    ],
    howToChange: 'Change these in LuCI at the gateway, or over SSH. This tool does not log in and does not change them.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /openwrt|luci/i, 5, 'openwrt')
      ]);
    }
  },
  {
    id: 'asus-merlin',
    label: 'ASUS (stock or Merlin)',
    localApi: 'unofficial',
    adjustableSettings: [
      'Adaptive QoS, or Cake on Merlin',
      'Wireless channel and bandwidth',
      'AiMesh node backhaul preference',
      'DNS and DHCP reservations'
    ],
    howToChange: 'Change these in the ASUS web UI on the gateway. Merlin builds show an extra firmware string there. This tool does not log in.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /asuswrt-merlin|\bmerlin\b/i, 6, 'merlin'),
        textHit(signals, /\basus\b|asuswrt|\brt-a[cxbe]\d/i, 5, 'asus'),
        ouiHit(signals, ['ASUSTek'], 2, 'oui')
      ]);
    }
  },
  {
    id: 'unifi',
    label: 'UniFi',
    localApi: 'documented',
    adjustableSettings: [
      'Wi-Fi channel, width, and transmit power',
      'Band steering and minimum RSSI',
      'Meshing',
      'Smart Queues on the WAN'
    ],
    howToChange: 'Change these in the UniFi Network application on the local controller or at unifi.ui.com. A documented local API exists for a future read adapter. This tool does not log in.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /unifi|ubiquiti|\bubnt\b/i, 5, 'unifi'),
        ouiHit(signals, ['Ubiquiti'], 3, 'oui')
      ]);
    }
  },
  {
    id: 'eero',
    label: 'eero',
    localApi: 'none (app/cloud only)',
    adjustableSettings: [
      'Optimize for Conferencing and Gaming',
      'DNS',
      'IP reservations',
      'Guest network',
      'WPA3'
    ],
    howToChange: 'Change these in the eero app. eero has no local web admin. Channel choice is automatic. This tool cannot change them.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /\beero\b/i, 5, 'eero')
      ]);
    }
  },
  {
    id: 'google-nest-wifi',
    label: 'Google/Nest Wifi',
    localApi: 'none (app/cloud only)',
    adjustableSettings: [
      'WAN DNS',
      'Guest network',
      'Preferred WAN activities in the Google Home app'
    ],
    howToChange: 'Change these in the Google Home app. Google Wifi and Nest Wifi do not offer a local API or a manual channel picker. This tool cannot change them.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /nest wifi|google wifi|nest-wifi|google-wifi|\bonhub\b/i, 5, 'name'),
        ouiHit(signals, ['Google', 'Nest'], 3, 'oui')
      ]);
    }
  },
  {
    id: 'netgear-orbi',
    label: 'NETGEAR Orbi',
    localApi: 'unofficial',
    adjustableSettings: [
      'QoS',
      'Wireless channel',
      'Guest network',
      'DNS'
    ],
    howToChange: 'Change these in the Orbi web page or the Orbi app. There is no documented local read API. This tool does not log in.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /\borbi\b|\brbr\d|\brbs\d|\bcbk\d/i, 5, 'orbi')
      ]);
    }
  },
  {
    id: 'tp-link-deco',
    label: 'TP-Link Deco',
    localApi: 'none (app/cloud only)',
    adjustableSettings: [
      'QoS',
      'Fast roaming',
      'Guest network',
      'DNS'
    ],
    howToChange: 'Change these in the Deco app. Deco is app-managed and has no documented local API. This tool does not log in.',
    read: null,
    match(signals) {
      return scoreOf([
        textHit(signals, /\bdeco\b/i, 5, 'deco')
      ]);
    }
  }
];

const READ_ADAPTER_IDS = ['unifi', 'openwrt', 'asus-merlin'];

module.exports = { adapters, READ_ADAPTER_IDS };
