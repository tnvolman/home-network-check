'use strict';

const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { evaluateTarget, isProbeable } = require('../subnet');
const { safeGet } = require('../net/safe-get');
const { detectVendor, pageExcerpt } = require('../vendors/detect');
const { loadHost } = require('./host');
const { discover } = require('./discover');

const FINGERPRINT_PATHS = ['/', '/cgi-bin/luci/', '/Main_Login.asp'];

function gatewayReplies(found, gatewayIp, interfaces) {
  const ssdp = [];
  const upnp = [];
  for (const reply of (found && found.ssdp) || []) {
    const target = reply.location ? evaluateTarget(reply.location, interfaces) : null;
    const addressOk = reply.address === gatewayIp;
    const locationOk = Boolean(target && target.ok && target.ip === gatewayIp);
    if (addressOk || locationOk) ssdp.push(reply);
  }
  for (const device of (found && found.upnp) || []) {
    if (device.ip === gatewayIp) upnp.push(device);
  }
  return { ssdp, upnp };
}

async function routerDetect(_args = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  const httpGet = deps.httpGet || safeGet;
  const host = deps.loadHost ? await deps.loadHost(deps) : await loadHost(deps);
  const found = deps.discoverResult || await discover({}, deps);
  const interfaces = host.interfaces;
  const gatewayIp = host.route && host.route.gateway;
  const pages = [];
  const skipped = [];
  if (!gatewayIp || !isProbeable(gatewayIp, interfaces)) {
    skipped.push({
      target: gatewayIp || 'gateway',
      reason: gatewayIp ? 'gateway is outside the local subnet' : 'no IPv4 default gateway'
    });
  } else {
    for (const path of FINGERPRINT_PATHS) {
      const location = `http://${gatewayIp}${path}`;
      const response = await httpGet(location, interfaces);
      if (response && response.refused) {
        skipped.push({ target: location, reason: response.reason || 'refused' });
        continue;
      }
      const excerpt = pageExcerpt(response && response.body);
      pages.push({
        path,
        status: response ? response.status : null,
        server: response && response.headers ? response.headers.server || null : null,
        title: excerpt.title,
        body_excerpt: excerpt.body_excerpt,
        error: response && response.error ? response.error : null
      });
    }
  }
  const related = gatewayReplies(found, gatewayIp, interfaces);
  const gatewayMac = found && found.gateway ? found.gateway.mac : null;
  const detected = detectVendor({
    upnp: related.upnp,
    ssdp: related.ssdp,
    mdns_service_types: found && found.mdns ? found.mdns.service_types : [],
    http_pages: pages,
    gateway_mac: gatewayMac
  });
  return Object.assign({
    ok: true,
    version: VERSION,
    platform,
    gateway_ip: gatewayIp || null,
    fingerprint_paths: FINGERPRINT_PATHS.slice(),
    http_pages: pages.map((page) => ({ path: page.path, status: page.status, server: page.server, title: page.title })),
    skipped_probes: skipped,
    read_only: true
  }, detected);
}

module.exports = { routerDetect, FINGERPRINT_PATHS };
