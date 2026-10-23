'use strict';

const { adapters, READ_ADAPTER_IDS } = require('./adapters');
const { lookupOui } = require('../oui');

function confidenceFor(points, sourceCount) {
  if (points >= 6) return 'high';
  if (sourceCount >= 2 && points >= 5) return 'high';
  if (points >= 5) return 'medium';
  if (points >= 2) return 'low';
  return 'none';
}

function signalsFrom(input) {
  const signals = [];
  const push = (source, detail, extra) => {
    if (!detail) return;
    signals.push(Object.assign({ source, detail: String(detail).slice(0, 240) }, extra || {}));
  };
  for (const device of input.upnp || []) {
    push('upnp', [device.manufacturer, device.model, device.model_description, device.friendly_name].filter(Boolean).join(' '));
  }
  for (const reply of input.ssdp || []) {
    push('ssdp', [reply.server, reply.st].filter(Boolean).join(' '));
  }
  for (const type of input.mdns_service_types || []) {
    if (/eero|ubnt|unifi|openwrt/i.test(type)) push('mdns', type);
  }
  for (const page of input.http_pages || []) {
    const blob = [page.title, page.server, page.body_excerpt].filter(Boolean).join(' ');
    push('http', blob, { path: page.path || '/' });
  }
  if (input.gateway_mac) {
    const oui = lookupOui(input.gateway_mac);
    if (oui.vendor) push('oui', oui.vendor, { vendor: oui.vendor });
  }
  for (const name of input.hostnames || []) push('hostname', name);
  return signals;
}

function pageExcerpt(body) {
  const text = String(body || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body || '');
  return {
    title: title ? title[1].replace(/\s+/g, ' ').trim().slice(0, 120) : null,
    body_excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 240)
  };
}

function detectVendor(input) {
  for (const adapter of adapters) {
    if (adapter.read != null) {
      throw new Error(`adapter ${adapter.id} is not detect-only`);
    }
  }
  const signals = signalsFrom(input || {});
  const ranked = [];
  for (const adapter of adapters) {
    const hit = adapter.match(signals);
    if (!hit || hit.points < 2) continue;
    ranked.push({ adapter, hit });
  }
  ranked.sort((a, b) => b.hit.points - a.hit.points);
  if (!ranked.length) {
    return {
      vendor: 'unknown',
      label: 'unknown',
      confidence: 'none',
      evidence: signals.slice(0, 6).map((item) => ({
        source: item.source,
        detail: item.detail,
        path: item.path || null
      })),
      local_api: null,
      adjustable_settings: [],
      how_to_change: 'Vendor was not identified, so this tool will not guess which settings to change.',
      read_adapter: null,
      suggest_only: true
    };
  }
  const best = ranked[0];
  const tied = ranked.filter((row) => row.hit.points === best.hit.points);
  let confidence = confidenceFor(best.hit.points, best.hit.sources.length);
  const evidence = best.hit.evidence.map((item) => ({
    source: item.source,
    detail: item.detail,
    path: item.path || null
  }));
  if (tied.length > 1) {
    confidence = 'low';
    evidence.push({
      source: 'tie',
      detail: `Tied with ${tied.slice(1).map((row) => row.adapter.id).join(', ')}.`,
      path: null
    });
  }
  return {
    vendor: best.adapter.id,
    label: best.adapter.label,
    confidence,
    evidence,
    local_api: best.adapter.localApi,
    adjustable_settings: best.adapter.adjustableSettings.slice(),
    how_to_change: best.adapter.howToChange,
    read_adapter: READ_ADAPTER_IDS.includes(best.adapter.id) ? best.adapter.id : null,
    suggest_only: true
  };
}

module.exports = { detectVendor, signalsFrom, pageExcerpt, confidenceFor };
