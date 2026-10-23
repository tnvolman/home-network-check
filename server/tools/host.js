'use strict';

const { runCommand } = require('../proc');
const { parseIfconfig, hostSubnets } = require('../parsers/ifconfig');
const { parseDefaultRoute } = require('../parsers/route');
const { isIpv4 } = require('../subnet');

async function loadHost(deps = {}) {
  const run = deps.runCommand || runCommand;
  const [routeResult, ifconfigResult] = await Promise.all([
    run('route', ['-n', 'get', 'default'], { timeoutMs: 4000 }),
    run('ifconfig', ['-a'], { timeoutMs: 4000 })
  ]);
  const route = parseDefaultRoute(routeResult.stdout || '');
  const interfaces = hostSubnets(parseIfconfig(ifconfigResult.stdout || ''))
    .filter((row) => row.up)
    .map((row) => ({ device: row.device, address: row.address, netmask: row.netmask }));
  const gateway = isIpv4(route.gateway) ? route.gateway : null;
  return {
    interfaces,
    route: {
      gateway,
      interface: route.interface || null,
      raw_gateway: route.gateway || null
    },
    route_error: routeResult.spawnError ? routeResult.stderr : null,
    ifconfig_error: ifconfigResult.spawnError ? ifconfigResult.stderr : null
  };
}

module.exports = { loadHost };
