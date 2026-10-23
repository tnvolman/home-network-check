'use strict';

const { MIN_PREFIX, MAX_PREFIX } = require('./constants');

// Known VPN device names. Probe selection does not use this denylist:
// ZeroTier feth* and OpenVPN tap* are virtual too, so eligibility is an allowlist.
function isTunnelDevice(device) {
  return /^(utun|ipsec|ppp|tun|wg)/i.test(String(device || ''));
}

// Wi-Fi and Ethernet from `networksetup -listallhardwareports` when that list
// is present. Otherwise only en0, en1, … — never feth, tap, utun, or bridge.
function deviceAllowed(device, allowlist) {
  const name = String(device || '');
  if (Array.isArray(allowlist) && allowlist.length > 0) return allowlist.includes(name);
  return /^en\d+$/.test(name);
}

// Active physical interfaces. Each prefix is its own probe guard.
// A missing default route probes nothing. A virtual default route does not
// hide Wi-Fi or Ethernet; those prefixes stay open.
function probeInterfaces(interfaces, routeInterface, allowlist) {
  if (!routeInterface) return [];
  return (interfaces || []).filter((iface) => {
    if (!iface || !deviceAllowed(iface.device, allowlist)) return false;
    if (iface.up === false) return false;
    return Boolean(iface.address && iface.netmask);
  }).map((iface) => ({
    device: iface.device,
    address: iface.address,
    netmask: iface.netmask,
    gateway: iface.gateway || null
  }));
}

function isIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    if (!Number.isInteger(n) || n > 255) return false;
  }
  return true;
}

function ipv4ToInt(ip) {
  if (!isIpv4(ip)) return null;
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

function masked(n, mask) {
  return (n & mask) >>> 0;
}

function isRfc1918OrLinkLocal(ip) {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  if (masked(n, 0xff000000) === 0x0a000000) return true;
  if (masked(n, 0xfff00000) === 0xac100000) return true;
  if (masked(n, 0xffff0000) === 0xc0a80000) return true;
  if (masked(n, 0xffff0000) === 0xa9fe0000) return true;
  return false;
}

function prefixLength(mask) {
  const n = ipv4ToInt(mask);
  if (n == null) return -1;
  let ones = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (n >>> i) & 1;
    if (bit === 1) {
      if (seenZero) return -1;
      ones++;
    } else {
      seenZero = true;
    }
  }
  return ones;
}

function sameSubnet(ip, address, netmask) {
  const ipn = ipv4ToInt(ip);
  const an = ipv4ToInt(address);
  const mn = ipv4ToInt(netmask);
  if (ipn == null || an == null || mn == null) return false;
  return ((ipn & mn) >>> 0) === ((an & mn) >>> 0);
}

function isNetworkOrBroadcast(ip, address, netmask) {
  const ipn = ipv4ToInt(ip);
  const an = ipv4ToInt(address);
  const mn = ipv4ToInt(netmask);
  if (ipn == null || an == null || mn == null) return false;
  const network = (an & mn) >>> 0;
  const broadcast = (network | (~mn >>> 0)) >>> 0;
  return ipn === network || ipn === broadcast;
}

// True only for RFC1918 or link-local addresses that also sit inside one of
// the host's own interface prefixes. Public addresses never pass.
function isInLocalSubnet(ip, interfaces) {
  if (!isRfc1918OrLinkLocal(ip) || !Array.isArray(interfaces)) return false;
  const ipn = ipv4ToInt(ip);
  const targetLinkLocal = masked(ipn, 0xffff0000) === 0xa9fe0000;
  for (const iface of interfaces) {
    if (!iface || !deviceAllowed(iface.device) || !isRfc1918OrLinkLocal(iface.address)) continue;
    const prefix = prefixLength(iface.netmask);
    if (prefix < MIN_PREFIX || prefix > MAX_PREFIX) continue;
    const an = ipv4ToInt(iface.address);
    const ifaceLinkLocal = masked(an, 0xffff0000) === 0xa9fe0000;
    if (targetLinkLocal !== ifaceLinkLocal) continue;
    if (targetLinkLocal && prefix < 16) continue;
    if (sameSubnet(ip, iface.address, iface.netmask)) return true;
  }
  return false;
}

// Unicast probe gate. Broadcast, network address, and multicast never pass.
function isProbeable(ip, interfaces) {
  if (!isInLocalSubnet(ip, interfaces)) return false;
  const n = ipv4ToInt(ip);
  if (masked(n, 0xf0000000) === 0xe0000000) return false;
  let matched = false;
  for (const iface of interfaces || []) {
    if (!iface || !sameSubnet(ip, iface.address, iface.netmask)) continue;
    matched = true;
    if (isNetworkOrBroadcast(ip, iface.address, iface.netmask)) return false;
  }
  return matched;
}

function evaluateTarget(location, interfaces) {
  let url;
  try {
    url = new URL(location);
  } catch {
    return { ok: false, reason: 'bad url' };
  }
  if (url.username || url.password) return { ok: false, reason: 'url has userinfo' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme not http(s)' };
  }
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!isIpv4(host)) return { ok: false, reason: 'not a literal ipv4 address' };
  if (!isProbeable(host, interfaces)) {
    return {
      ok: false,
      reason: isInLocalSubnet(host, interfaces)
        ? 'not a unicast host address'
        : 'outside local subnet'
    };
  }
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'bad port' };
  }
  return {
    ok: true,
    ip: host,
    port,
    https: url.protocol === 'https:',
    path: `${url.pathname || '/'}${url.search}`
  };
}

module.exports = {
  isIpv4,
  ipv4ToInt,
  isRfc1918OrLinkLocal,
  isTunnelDevice,
  deviceAllowed,
  probeInterfaces,
  prefixLength,
  isInLocalSubnet,
  isProbeable,
  evaluateTarget
};
