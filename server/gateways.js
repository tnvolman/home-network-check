'use strict';

const { isIpv4, isProbeable, ipv4ToInt, prefixLength } = require('./subnet');
const { parseDefaultRoute } = require('./parsers/route');

function intToDotted(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function acceptGateway(gateway, iface) {
  if (!isIpv4(gateway)) return null;
  return isProbeable(gateway, [iface]) ? gateway : null;
}

// Home routers often sit at the first host of the interface prefix.
// 192.168.4.20/24 -> 192.168.4.1. Used only when DHCP and the route table
// did not name a gateway on this interface.
function conventionalGateway(iface) {
  if (!iface || !iface.address || !iface.netmask) return null;
  const addr = ipv4ToInt(iface.address);
  const mask = ipv4ToInt(iface.netmask);
  if (addr == null || mask == null || prefixLength(iface.netmask) < 0) return null;
  const dotted = intToDotted(((addr & mask) + 1) >>> 0);
  if (dotted === iface.address) return null;
  return acceptGateway(dotted, iface);
}

function firstToken(text) {
  const token = String(text || '').trim().split(/\s+/)[0];
  return token || '';
}

async function quietly(run, file, args) {
  try {
    return await run(file, args, { timeoutMs: 2000 });
  } catch {
    return null;
  }
}

async function resolveInterfaceGateway(iface, route, run) {
  const dhcp = await quietly(run, 'ipconfig', ['getoption', iface.device, 'router']);
  const fromDhcp = dhcp && acceptGateway(firstToken(dhcp.stdout), iface);
  if (fromDhcp) return { gateway: fromDhcp, source: 'dhcp' };

  const scoped = await quietly(run, 'route', ['-n', 'get', '-ifscope', iface.device, 'default']);
  const scopedGateway = scoped && parseDefaultRoute(scoped.stdout || '').gateway;
  const fromScoped = acceptGateway(scopedGateway, iface);
  if (fromScoped) return { gateway: fromScoped, source: 'ifscope' };

  if (route && route.interface === iface.device) {
    const fromDefault = acceptGateway(route.gateway, iface);
    if (fromDefault) return { gateway: fromDefault, source: 'default-route' };
  }

  const guessed = conventionalGateway(iface);
  if (guessed) return { gateway: guessed, source: 'subnet-gateway' };
  return { gateway: null, source: null };
}

module.exports = { conventionalGateway, resolveInterfaceGateway, acceptGateway };
