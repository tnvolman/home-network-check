'use strict';

const { round2 } = require('../plan');

function parseBssid(value) {
  if (value == null || value === '') return { bssid: null, redacted: false, missing: true };
  const text = String(value).trim();
  if (/redact|unavailable|unknown|^n\/a$/i.test(text) || text === '<redacted>') {
    return { bssid: null, redacted: true, missing: false };
  }
  const mac = text.match(/([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
  if (!mac) return { bssid: null, redacted: true, missing: false };
  return { bssid: mac[1].toLowerCase(), redacted: false, missing: false };
}

function parseChannel(value) {
  if (value == null || value === '') {
    return { channel: null, band: null, width_mhz: null, band_inferred: false };
  }
  const text = String(value);
  const channelMatch = /(\d+)/.exec(text);
  const channel = channelMatch ? Number(channelMatch[1]) : null;
  const widthMatch = /(\d+)\s*MHz/i.exec(text);
  const width = widthMatch ? Number(widthMatch[1]) : null;
  let band = null;
  let inferred = false;
  if (/6\s*GHz/i.test(text)) band = '6';
  else if (/5\s*GHz/i.test(text)) band = '5';
  else if (/2(?:\.4)?\s*GHz/i.test(text)) band = '2.4';
  else if (channel != null && channel >= 1 && channel <= 14 && (width == null || width <= 40)) {
    band = '2.4';
    inferred = true;
  }
  return { channel, band, width_mhz: width, band_inferred: inferred };
}

function parseSignalNoise(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { rssi: value, noise: null };
  if (typeof value !== 'string') return { rssi: null, noise: null };
  const nums = value.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return { rssi: null, noise: null };
  return {
    rssi: Number(nums[0]),
    noise: nums.length > 1 ? Number(nums[1]) : null
  };
}

function snrOf(rssi, noise, explicit) {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return round2(explicit);
  if (typeof rssi === 'number' && typeof noise === 'number') return round2(rssi - noise);
  return null;
}

function numberish(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function currentNetwork(iface) {
  return iface && (iface.spairport_current_network_information || iface.spairport_current_network || null);
}

function parseSystemProfiler(jsonText) {
  let data;
  try {
    data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    return null;
  }
  const roots = data && data.SPAirPortDataType;
  if (!Array.isArray(roots)) return null;
  for (const root of roots) {
    const ifaces = root && root.spairport_airport_interfaces;
    if (!Array.isArray(ifaces)) continue;
    for (const iface of ifaces) {
      const net = currentNetwork(iface);
      if (!net) continue;
      const signal = parseSignalNoise(net.spairport_signal_noise);
      const channel = parseChannel(net.spairport_network_channel || net.spairport_channel);
      const bssid = parseBssid(net.spairport_network_bssid || net.spairport_bssid || net.BSSID);
      const rssi = signal.rssi != null ? signal.rssi : numberish(net.spairport_signal_strength);
      const noise = signal.noise != null ? signal.noise : numberish(net.spairport_noise);
      return {
        device: iface._name || null,
        ssid: net._name || net.spairport_network_name || net.spairport_ssid || null,
        bssid: bssid.bssid,
        bssid_redacted: bssid.redacted,
        channel: channel.channel,
        band: channel.band,
        band_inferred: channel.band_inferred,
        width_mhz: channel.width_mhz,
        rssi_dbm: rssi == null ? null : round2(rssi),
        noise_dbm: noise == null ? null : round2(noise),
        snr_db: snrOf(rssi, noise, numberish(net.spairport_signal_noise_ratio)),
        tx_rate_mbps: numberish(net.spairport_network_rate || net.spairport_network_maxrate),
        source: 'system_profiler'
      };
    }
  }
  return null;
}

function parseGetsummary(text) {
  const map = {};
  const body = String(text || '');
  const kv = /^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/gm;
  let match;
  while ((match = kv.exec(body))) map[match[1].toUpperCase()] = match[2].trim();
  const keyRe = /<key>([^<]+)<\/key>\s*<(?:string|integer|real)>([^<]*)<\//gi;
  while ((match = keyRe.exec(body))) map[match[1].toUpperCase()] = match[2].trim();
  if (!Object.keys(map).length) return null;
  const bssid = parseBssid(map.BSSID);
  const channel = parseChannel(map.CHANNEL);
  let band = channel.band;
  let bandInferred = channel.band_inferred;
  if (map.BAND) {
    const parsed = parseChannel(map.BAND);
    if (parsed.band) {
      band = parsed.band;
      bandInferred = false;
    }
  }
  const rssi = numberish(map.RSSI);
  const noise = numberish(map.NOISE);
  const ssid = map.SSID_STR || map.SSID || null;
  return {
    ssid: ssid && !/^<|>$/.test(ssid) ? ssid : (ssid && /redact/i.test(ssid) ? null : ssid),
    bssid: bssid.bssid,
    bssid_redacted: bssid.redacted,
    channel: channel.channel,
    band,
    band_inferred: bandInferred,
    width_mhz: channel.width_mhz,
    rssi_dbm: rssi == null ? null : round2(rssi),
    noise_dbm: noise == null ? null : round2(noise),
    snr_db: snrOf(rssi, noise, null),
    tx_rate_mbps: numberish(map.LINKRATE || map.TXRATE || map.MAXRATE),
    source: 'ipconfig_getsummary'
  };
}

function prefer(primary, fallback) {
  return primary == null || primary === '' ? fallback : primary;
}

function mergeWifiReading(profiler, summary) {
  const a = profiler || {};
  const b = summary || {};
  const bssid = a.bssid || b.bssid || null;
  const band = a.band && !a.band_inferred ? a.band : (b.band && !b.band_inferred ? b.band : prefer(a.band, b.band));
  const rssi = prefer(a.rssi_dbm, b.rssi_dbm);
  const noise = prefer(a.noise_dbm, b.noise_dbm);
  return {
    ssid: prefer(a.ssid, b.ssid),
    bssid,
    bssid_redacted: !bssid && Boolean(a.bssid_redacted || b.bssid_redacted || a.bssid == null || b.bssid == null),
    channel: prefer(a.channel, b.channel),
    band: band || null,
    width_mhz: prefer(a.width_mhz, b.width_mhz),
    rssi_dbm: rssi == null ? null : rssi,
    noise_dbm: noise == null ? null : noise,
    snr_db: snrOf(rssi, noise, prefer(a.snr_db, b.snr_db)),
    tx_rate_mbps: prefer(a.tx_rate_mbps, b.tx_rate_mbps),
    sources: [a.source, b.source].filter(Boolean)
  };
}

function median(values) {
  const nums = values.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return round2((nums[mid - 1] + nums[mid]) / 2);
}

function macToBigInt(mac) {
  return BigInt(`0x${mac.replace(/:/g, '')}`);
}

function clusterBssids(bssids) {
  const items = [...new Set(bssids.filter(Boolean))].map((b) => ({ b, n: macToBigInt(b) }));
  items.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  const clusters = [];
  for (const item of items) {
    const last = clusters[clusters.length - 1];
    if (last && item.n - last[last.length - 1].n <= 16n) last.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

function analyzeWifiSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const bssids = list.map((s) => s.bssid).filter(Boolean);
  const uniqueBssid = [...new Set(bssids)];
  const bands = [...new Set(list.map((s) => s.band).filter(Boolean))];
  const anyRealBssid = uniqueBssid.length > 0;
  const allMissingBssid = list.length > 0 && list.every((s) => !s.bssid);
  let roaming = 'unknown';
  let roamingDetail = 'No Wi-Fi samples.';
  if (list.length) {
    if (!anyRealBssid || allMissingBssid) {
      roaming = 'unknown';
      roamingDetail = 'BSSID was redacted or missing, so roaming cannot be judged. macOS hides it without Location permission. The airport command is not used.';
    } else if (uniqueBssid.length > 1) {
      roaming = true;
      roamingDetail = `BSSID changed across ${uniqueBssid.length} addresses.`;
    } else {
      roaming = false;
      roamingDetail = 'BSSID stayed the same across samples.';
    }
  }
  const rssi = median(list.map((s) => s.rssi_dbm));
  const snr = median(list.map((s) => s.snr_db));
  const weakReasons = [];
  if (rssi != null && rssi < -70) weakReasons.push(`median RSSI ${rssi} dBm is below -70`);
  if (snr != null && snr < 20) weakReasons.push(`median SNR ${snr} dB is below 20`);
  const clusters = clusterBssids(uniqueBssid);
  const meshEstimate = anyRealBssid ? clusters.length : null;
  const noReading = list.length === 0 || list.every((s) => s.ssid == null && s.rssi_dbm == null && s.band == null);
  return {
    ssid: (list.find((s) => s.ssid) || {}).ssid || null,
    no_reading: noReading,
    roaming,
    roaming_detail: roamingDetail,
    band_changes: bands.length > 1,
    bands_seen: bands,
    median_rssi_dbm: rssi,
    median_noise_dbm: median(list.map((s) => s.noise_dbm)),
    median_snr_db: snr,
    median_tx_rate_mbps: median(list.map((s) => s.tx_rate_mbps)),
    weak_signal: weakReasons.length > 0,
    weak_reasons: weakReasons,
    bssids: uniqueBssid,
    mesh_nodes_estimate: meshEstimate,
    mesh_detail: meshEstimate == null
      ? 'No BSSID was available, so mesh nodes were not estimated.'
      : (meshEstimate === 1
        ? 'One BSSID group in this sample. Nearby MACs would count as one node. This does not prove the home has only one node.'
        : `${meshEstimate} BSSID groups in this sample. MACs within 16 of each other count as one node.`),
    backhaul: 'unknown/inferred'
  };
}

module.exports = {
  parseBssid,
  parseChannel,
  parseSystemProfiler,
  parseGetsummary,
  mergeWifiReading,
  analyzeWifiSamples
};
