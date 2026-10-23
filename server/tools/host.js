'use strict';

const { runCommand } = require('../proc');
const { parseIfconfig, hostSubnets } = require('../parsers/ifconfig');
const { parseDefaultRoute } = require('../parsers/route');
const { deviceNameOk } = require('../parsers/hardware-ports');
const { isIpv4, probeInterfaces } = require('../subnet');
const { resolveInterfaceGateway } = require('../gateways');

async function loadHost(deps = {}) {
  const run = deps.runCommand || runCommand;
  const [routeResult, ifconfigResult] = await Promise.all([
    run('route', ['-n', 'get', 'default'], { timeoutMs: 4000 }),
    run('ifconfig', ['-a'], { timeoutMs: 4000 })
  ]);
  const route = parseDefaultRoute(routeResult.stdout || '');
  const up = hostSubnets(parseIfconfig(ifconfigResult.stdout || '')).filter((row) => row.up);
  const interfaces = probeInterfaces(up, route.interface);
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
