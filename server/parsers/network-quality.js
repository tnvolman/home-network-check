'use strict';

const { round2 } = require('../plan');

// Practical Low/Medium/High cuts used when networkQuality does not print the word.
// High >= 2000 RPM, medium >= 500, low below that. Higher RPM means less bufferbloat.
function rpmBand(rpm) {
  if (typeof rpm !== 'number' || !Number.isFinite(rpm)) return null;
  if (rpm >= 2000) return 'high';
  if (rpm >= 500) return 'medium';
  return 'low';
}

function bandFromWord(word) {
  if (!word) return null;
  const w = String(word).toLowerCase();
  if (w === 'low' || w === 'medium' || w === 'high') return w;
  return null;
}

function bpsToMbps(bps) {
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) return null;
  return round2(bps / 1e6);
}

function fromJson(json) {
  const responsiveness = typeof json.responsiveness === 'number' ? json.responsiveness : null;
  const dlRpm = typeof json.dl_responsiveness === 'number' ? json.dl_responsiveness : null;
  const ulRpm = typeof json.ul_responsiveness === 'number' ? json.ul_responsiveness : null;
  const rpm = responsiveness != null ? responsiveness : (dlRpm != null && ulRpm != null ? Math.min(dlRpm, ulRpm) : (dlRpm != null ? dlRpm : ulRpm));
  return {
    source: 'json',
    down_mbps: bpsToMbps(json.dl_throughput),
    up_mbps: bpsToMbps(json.ul_throughput),
    base_rtt_ms: typeof json.base_rtt === 'number' ? round2(json.base_rtt) : null,
    responsiveness_rpm: rpm == null ? null : round2(rpm),
    responsiveness_band: rpmBand(rpm),
    dl_responsiveness_rpm: dlRpm == null ? null : round2(dlRpm),
    ul_responsiveness_rpm: ulRpm == null ? null : round2(ulRpm),
    interface_name: json.interface_name || null
  };
}

function rpmNear(text, label) {
  const re = new RegExp(label + '[^\\n]*?\\b(Low|Medium|High)\\b[^\\n]*?([\\d.]+)\\s*RPM', 'i');
  const labeled = re.exec(text);
  if (labeled) {
    return { rpm: round2(Number(labeled[2])), band: bandFromWord(labeled[1]) };
  }
  const plain = new RegExp(label + '[^\\n]*?([\\d.]+)\\s*RPM', 'i').exec(text);
  if (!plain) return { rpm: null, band: null };
  const rpm = round2(Number(plain[1]));
  return { rpm, band: rpmBand(rpm) };
}

function fromText(text) {
  const down = /Downlink capacity:\s*([\d.]+)\s*Mbps/i.exec(text);
  const up = /Uplink capacity:\s*([\d.]+)\s*Mbps/i.exec(text);
  const idle = /Idle Latency:\s*([\d.]+)\s*milliseconds/i.exec(text);
  const combined = rpmNear(text, 'Responsiveness');
  const dl = rpmNear(text, 'Downlink Responsiveness');
  const ul = rpmNear(text, 'Uplink Responsiveness');
  let rpm = combined.rpm;
  let band = combined.band;
  if (rpm == null && dl.rpm != null && ul.rpm != null) {
    rpm = Math.min(dl.rpm, ul.rpm);
    band = rpmBand(rpm);
  }
  return {
    source: 'text',
    down_mbps: down ? round2(Number(down[1])) : null,
    up_mbps: up ? round2(Number(up[1])) : null,
    base_rtt_ms: idle ? round2(Number(idle[1])) : null,
    responsiveness_rpm: rpm,
    responsiveness_band: band,
    dl_responsiveness_rpm: dl.rpm,
    ul_responsiveness_rpm: ul.rpm,
    interface_name: null
  };
}

function parseNetworkQuality(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      if (json && (json.dl_throughput != null || json.ul_throughput != null || json.base_rtt != null || json.responsiveness != null)) {
        return fromJson(json);
      }
    } catch {
      // Human-readable summary is the fallback.
    }
  }
  return fromText(text);
}

module.exports = { parseNetworkQuality, rpmBand, bpsToMbps };
