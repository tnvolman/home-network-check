'use strict';

const { runCommand } = require('../proc');
const { parseIfconfig, hostSubnets } = require('../parsers/ifconfig');
const { parseDefaultRoute } = require('../parsers/route');
const { deviceNameOk, parseHardwarePorts, physicalDeviceNames } = require('../parsers/hardware-ports');
const { isIpv4, probeInterfaces } = require('../subnet');
const { resolveInterfaceGateway } = require('../gateways');

// Separate from the route/ifconfig pair. A thrown or empty networksetup
// falls back to ^en\d+$ and those earlier results are still used.
async function readPhysicalAllowlist(run) {
  try {
    const result = await run('networksetup', ['-listallhardwareports'], { timeoutMs: 4000 });
    if (!result || result.spawnError) return null;
    const names = physicalDeviceNames(parseHardwarePorts(result.stdout || ''));
    return names.length ? names : null;
  } catch {
    return null;
  }
}

async function loadHost(deps = {}) {
  const run = deps.runCommand || runCommand;
  const [routeResult, ifconfigResult] = await Promise.all([
    run('route', ['-n', 'get', 'default'], { timeoutMs: 4000 }),
    run('ifconfig', ['-a'], { timeoutMs: 4000 })
  ]);
  const allowlist = await readPhysicalAllowlist(run);
  const route = parseDefaultRoute(routeResult.stdout || '');
  const up = hostSubnets(parseIfconfig(ifconfigResult.stdout || '')).filter((row) => row.up);
  const interfaces = probeInterfaces(up, route.interface, allowlist);
  const gateway = isIpv4(route.gateway) ? route.gateway : null;
  const routeInfo = {
    gateway,
    interface: route.interface || null,
    raw_gateway: route.gateway || null
  };
  for (const iface of interfaces) {
    if (!deviceNameOk(iface.device)) continue;
    const found = await resolveInterfaceGateway(iface, routeInfo, run);
    iface.gateway = found.gateway;
    iface.gateway_source = found.source;
  }
  return {
    interfaces,
    route: routeInfo,
    route_error: routeResult.spawnError ? routeResult.stderr : null,
    ifconfig_error: ifconfigResult.spawnError ? ifconfigResult.stderr : null
  };
}

module.exports = { loadHost };
