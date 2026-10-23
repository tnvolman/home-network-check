'use strict';

const crypto = require('crypto');
const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { evaluateTarget, isProbeable } = require('../subnet');
const { conventionalGateway } = require('../gateways');
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

function macFor(ip, found) {
  if (!found || !ip) return null;
  if (found.gateway && found.gateway.ip === ip && found.gateway.mac) return found.gateway.mac;
  const listed = (found.gateways || []).find((item) => item && item.ip === ip && item.mac);
  if (listed) return listed.mac;
  const row = (found.arp || []).find((item) => item && item.ip === ip && item.mac);
  return row ? row.mac : null;
}

function headerServer(response) {
  const value = response && response.headers && response.headers.server;
  return value ? String(value).toLowerCase() : '';
}

function genericSame(probe, page) {
  if (!probe || probe.status !== 200 || !page || page.status !== 200) return false;
  if (probe.body && page.body && probe.body === page.body) return true;
  const left = headerServer(probe);
  const right = headerServer(page);
  if (!left || left !== right) return false;
  const probeTitle = pageExcerpt(probe.body).title;
  const pageTitle = pageExcerpt(page.body).title;
  if (probeTitle && pageTitle && probeTitle !== pageTitle) return false;
  return true;
}

// A random path that returns the same 200 as the fingerprint paths is a catch-all.
function isCatchAll(probe, pages) {
  return Boolean(probe && probe.status === 200 && pages.length && pages.every((page) => genericSame(probe, page)));
}

function targetsFrom(host) {
  const out = [];
  const seen = new Set();
  const route = (host && host.route) || {};
  const add = (ip, device, guard) => {
    if (!ip || seen.has(ip) || !isProbeable(ip, guard)) return;
    seen.add(ip);
    out.push({ ip, device: device || null, guard });
  };
  for (const iface of (host && host.interfaces) || []) {
    const guard = [iface];
    if (iface.gateway) {
      add(iface.gateway, iface.device, guard);
      continue;
    }
    if (route.interface === iface.device && route.gateway) {
      add(route.gateway, iface.device, guard);
      continue;
    }
    add(conventionalGateway(iface), iface.device, guard);
  }
  return out;
}

function pageRecord(path, response) {
  const excerpt = pageExcerpt(response && response.body);
  return {
    path,
    status: response ? response.status : null,
    server: response && response.headers ? response.headers.server || null : null,
    title: excerpt.title,
    body_excerpt: excerpt.body_excerpt,
    error: response && response.error ? response.error : null
  };
}

async function readGateway(target, found, interfaces, httpGet, skipped, useMdns) {
  const probePath = `/hnc-probe-${crypto.randomBytes(8).toString('hex')}`;
  const guard = target.guard || interfaces;
  const probe = await httpGet(`http://${target.ip}${probePath}`, guard);
  const pages = [];
  const rawPages = [];
  for (const path of FINGERPRINT_PATHS) {
    const location = `http://${target.ip}${path}`;
    const response = await httpGet(location, guard);
    if (response && response.refused) {
      skipped.push({ target: location, reason: response.reason || 'refused' });
      continue;
    }
    rawPages.push(response);
    pages.push(pageRecord(path, response));
  }
  const catchAll = isCatchAll(probe, rawPages);
  const related = gatewayReplies(found, target.ip, interfaces);
  const detected = detectVendor({
    upnp: related.upnp,
    ssdp: related.ssdp,
    mdns_service_types: useMdns && found && found.mdns ? found.mdns.service_types : [],
    http_pages: catchAll ? [] : pages,
    gateway_mac: macFor(target.ip, found),
    gateway_ip: target.ip
  });
  return {
    ip: target.ip,
    interface: target.device,
    catch_all: catchAll,
    http_pages: pages.map((page) => ({
      path: page.path,
      status: page.status,
      server: page.server,
      title: page.title,
      catch_all: catchAll
    })),
    detected
  };
}

async function routerDetect(_args = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  const httpGet = deps.httpGet || safeGet;
  const host = deps.loadHost ? await deps.loadHost(deps) : await loadHost(deps);
  const found = deps.discoverResult || await discover({}, deps);
  const interfaces = host.interfaces || [];
  const gatewayIp = host.route && host.route.gateway;
  const skipped = [];
  const targets = targetsFrom(host);
  if (!targets.length) {
    skipped.push({
      target: gatewayIp || 'gateway',
      reason: gatewayIp ? 'gateway is outside the local subnet' : 'no IPv4 default gateway'
    });
  }
  const readings = [];
  for (const target of targets) {
    readings.push(await readGateway(target, found, interfaces, httpGet, skipped, targets.length === 1));
  }
  const primary = readings.find((item) => item.ip === gatewayIp) || readings[0] || null;
  const related = gatewayReplies(found, gatewayIp, interfaces);
  const detected = primary ? primary.detected : detectVendor({
    upnp: related.upnp,
    ssdp: related.ssdp,
    mdns_service_types: found && found.mdns ? found.mdns.service_types : [],
    http_pages: [],
    gateway_mac: macFor(gatewayIp, found),
    gateway_ip: gatewayIp || null
  });
  return Object.assign({
    ok: true,
    version: VERSION,
    platform,
    gateway_ip: gatewayIp || null,
    fingerprint_paths: FINGERPRINT_PATHS.slice(),
    http_pages: primary ? primary.http_pages : [],
    catch_all: primary ? primary.catch_all : false,
    gateways: readings.map((item) => Object.assign({
      ip: item.ip,
      interface: item.interface,
      catch_all: item.catch_all,
      http_pages: item.http_pages
    }, item.detected)),
    skipped_probes: skipped,
    read_only: true
  }, detected);
}

module.exports = { routerDetect, FINGERPRINT_PATHS, isCatchAll, targetsFrom };
