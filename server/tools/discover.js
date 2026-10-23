'use strict';

const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { runCommand } = require('../proc');
const { parseArp } = require('../parsers/arp');
const { parseMdnsServiceTypes } = require('../parsers/mdns');
const { parseUpnpDescription } = require('../parsers/upnp');
const { evaluateTarget, isInLocalSubnet, isProbeable } = require('../subnet');
const { lookupOui } = require('../oui');
const { ssdpSearch } = require('../net/ssdp-search');
const { safeGet } = require('../net/safe-get');
const { loadHost } = require('./host');

const MAX_LOCATION_FETCHES = 16;
const DISCOVER_BUDGET_MS = 12000;

function bannerVendor(text) {
  const value = String(text || '').toLowerCase();
  if (/\beero\b/.test(value)) return 'eero';
  if (/orbi/.test(value)) return 'NETGEAR Orbi';
  if (/\bdeco\b/.test(value)) return 'TP-Link Deco';
  if (/ubiquiti|unifi|\bubnt\b/.test(value)) return 'Ubiquiti';
  if (/openwrt|\bluci\b/.test(value)) return 'OpenWrt';
  if (/asuswrt|\basus\b/.test(value)) return 'ASUSTek';
  if (/nest wifi|google wifi/.test(value)) return 'Google/Nest Wifi';
  if (/netgear/.test(value)) return 'NETGEAR';
  if (/tp-?link/.test(value)) return 'TP-Link';
  return null;
}

function guessVendor(parts) {
  const banner = bannerVendor(parts.banners.join(' '));
  if (banner) return { vendor: banner, source: 'banner', locally_administered: false };
  const oui = parts.mac ? lookupOui(parts.mac) : { vendor: null, locally_administered: false };
  if (oui.vendor) return { vendor: oui.vendor, source: 'oui', locally_administered: false };
  return { vendor: null, source: null, locally_administered: Boolean(oui.locally_administered) };
}

function mergeDevices({ arp, ssdp, upnp, interfaces }) {
  const byIp = new Map();
  const slot = (ip) => {
    if (!byIp.has(ip)) {
      byIp.set(ip, {
        ip,
        mac: null,
        sources: [],
        banners: [],
        in_local_subnet: isInLocalSubnet(ip, interfaces),
        probed: false
      });
    }
    return byIp.get(ip);
  };
  for (const row of arp || []) {
    if (!row.ip || row.incomplete) continue;
    const item = slot(row.ip);
    item.mac = row.mac || item.mac;
    item.sources.push('arp');
  }
  for (const reply of ssdp || []) {
    const target = reply.location ? evaluateTarget(reply.location, interfaces) : null;
    const ip = (target && target.ok && target.ip) || (isInLocalSubnet(reply.address, interfaces) ? reply.address : null);
    if (!ip) continue;
    const item = slot(ip);
    item.sources.push('ssdp');
    if (reply.server) item.banners.push(reply.server);
  }
  for (const device of upnp || []) {
    if (!device.ip) continue;
    const item = slot(device.ip);
    item.sources.push('upnp');
    item.probed = true;
    item.friendly_name = device.friendly_name || null;
    for (const part of [device.manufacturer, device.model, device.model_description]) {
      if (part) item.banners.push(part);
    }
  }
  return [...byIp.values()].map((item) => {
    const guess = guessVendor(item);
    return Object.assign(item, {
      vendor_guess: guess.vendor,
      vendor_source: guess.source,
      locally_administered: guess.locally_administered,
      sources: [...new Set(item.sources)]
    });
  }).sort((a, b) => (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0));
}

async function discover(_args = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  const run = deps.runCommand || runCommand;
  const search = deps.ssdpSearch || ssdpSearch;
  const httpGet = deps.httpGet || safeGet;
  const budgetMs = Number.isFinite(deps.budgetMs) ? deps.budgetMs : DISCOVER_BUDGET_MS;
  const clock = typeof deps.now === 'function' ? deps.now : Date.now;
  const started = clock();
  const remaining = () => budgetMs - (clock() - started);
  const host = deps.loadHost ? await deps.loadHost(deps) : await loadHost({ runCommand: run });
  const interfaces = host.interfaces;

  const within = Math.max(0, remaining());
  const [arpResult, mdnsResult] = await Promise.all([
    run('arp', ['-an'], { timeoutMs: Math.min(4000, within) }),
    run('dns-sd', ['-B', '_services._dns-sd._udp'], { timeoutMs: Math.min(3000, within) })
  ]);
  const arp = parseArp(arpResult.stdout || '');
  const mdnsTypes = parseMdnsServiceTypes(mdnsResult.stdout || '');
  const ssdpLeft = remaining();
  const ssdp = ssdpLeft > 0 ? await search({ timeoutMs: Math.min(2500, ssdpLeft) }) : [];

  const probes = [{
    target: '239.255.255.250:1900',
    kind: 'ssdp-multicast',
    allowed: true,
    note: 'one link-local M-SEARCH, not a subnet sweep'
  }];
  const skipped = [];
  const upnp = [];
  const seen = new Set();
  let fetches = 0;
  for (const reply of ssdp || []) {
    if (!reply.location || seen.has(reply.location)) continue;
    seen.add(reply.location);
    if (remaining() <= 0) {
      skipped.push({ target: reply.location, reason: 'discover time budget exhausted' });
      probes.push({ target: reply.location, kind: 'upnp-description', allowed: false, reason: 'discover time budget exhausted' });
      continue;
    }
    const target = evaluateTarget(reply.location, interfaces);
    if (!target.ok) {
      skipped.push({ target: reply.location, reason: target.reason });
      probes.push({ target: reply.location, kind: 'upnp-description', allowed: false, reason: target.reason });
      continue;
    }
    if (fetches >= MAX_LOCATION_FETCHES) {
      skipped.push({ target: reply.location, reason: 'location fetch cap' });
      probes.push({ target: reply.location, kind: 'upnp-description', allowed: false, reason: 'location fetch cap' });
      continue;
    }
    fetches += 1;
    const response = await httpGet(reply.location, interfaces, {
      timeoutMs: Math.min(2500, Math.max(1, remaining()))
    });
    if (response && response.refused) {
      skipped.push({ target: reply.location, reason: response.reason || 'refused' });
      continue;
    }
    const parsed = parseUpnpDescription(response && response.body);
    if (parsed) upnp.push(Object.assign({ location: reply.location, ip: target.ip }, parsed));
  }

  const gatewayIp = host.route.gateway;
  const gatewayMac = (arp.find((row) => row.ip === gatewayIp && row.mac) || {}).mac || null;
  const devices = mergeDevices({ arp, ssdp, upnp, interfaces });

  return {
    ok: true,
    version: VERSION,
    platform,
    suggest_only: true,
    read_only: true,
    gateway: {
      ip: gatewayIp,
      interface: host.route.interface,
      mac: gatewayMac,
      in_local_subnet: Boolean(gatewayIp && isInLocalSubnet(gatewayIp, interfaces)),
      probeable: Boolean(gatewayIp && isProbeable(gatewayIp, interfaces)),
      note: host.route.raw_gateway && !gatewayIp
        ? 'default gateway is not an IPv4 address; v0.1 does not probe it'
        : null
    },
    host: { interfaces },
    arp: arp.map((row) => Object.assign({}, row, {
      in_local_subnet: isInLocalSubnet(row.ip, interfaces),
      vendor_guess: row.mac ? lookupOui(row.mac).vendor : null
    })),
    mdns: {
      service_types: mdnsTypes,
      timed_out: Boolean(mdnsResult.timedOut)
    },
    ssdp: (ssdp || []).map((reply) => ({
      server: reply.server || null,
      st: reply.st || null,
      usn: reply.usn || null,
      location: reply.location || null,
      address: reply.address || null
    })),
    upnp,
    devices,
    probes,
    skipped_probes: skipped
  };
}

module.exports = {
  discover,
  mergeDevices,
  bannerVendor,
  MAX_LOCATION_FETCHES,
  DISCOVER_BUDGET_MS
};
