'use strict';

const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { runCommand } = require('../proc');
const { optionalMbps, optionalEnum } = require('../errors');
const { parseHardwarePorts, deviceNameOk } = require('../parsers/hardware-ports');
const { parseIfconfig, interfaceIsUp } = require('../parsers/ifconfig');
const { parseNetworkQuality } = require('../parsers/network-quality');
const { parsePing } = require('../parsers/ping');
const { isProbeable } = require('../subnet');
const { comparePlan } = require('../plan');
const { loadHost } = require('./host');

function selectPorts(ports, upDevices, routeInterface, choice) {
  const usable = ports.filter((port) => (port.kind === 'wifi' || port.kind === 'ethernet') && deviceNameOk(port.device));
  const tagged = usable.map((port) => Object.assign({}, port, { up: upDevices.has(port.device) }));
  if (choice === 'all') return tagged.slice(0, 4);
  if (choice === 'wifi' || choice === 'ethernet') return tagged.filter((port) => port.kind === choice).slice(0, 4);
  const onRoute = tagged.find((port) => port.device === routeInterface);
  if (onRoute) return [onRoute];
  const up = tagged.find((port) => port.up);
  return up ? [up] : tagged.slice(0, 1);
}

async function speedTest(args = {}, deps = {}) {
  const choice = optionalEnum(args.interface, 'interface', ['wifi', 'ethernet', 'all'], 'default');
  const planDown = optionalMbps(args.plan_down_mbps, 'plan_down_mbps');
  const planUp = optionalMbps(args.plan_up_mbps, 'plan_up_mbps');
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  const run = deps.runCommand || runCommand;
  const host = deps.loadHost ? await deps.loadHost(deps) : await loadHost({ runCommand: run });

  const [portsResult, ifconfigResult] = await Promise.all([
    run('networksetup', ['-listallhardwareports'], { timeoutMs: 4000 }),
    run('ifconfig', ['-a'], { timeoutMs: 4000 })
  ]);
  const ports = parseHardwarePorts(portsResult.stdout || '');
  const upDevices = new Set(parseIfconfig(ifconfigResult.stdout || '').filter(interfaceIsUp).map((iface) => iface.device));
  const selected = selectPorts(ports, upDevices, host.route.interface, choice);
  const gateway = host.route.gateway;
  const probeGateway = Boolean(gateway && isProbeable(gateway, host.interfaces));
  let ping = null;
  if (probeGateway) {
    const pingResult = await run('ping', ['-c', '5', '-i', '0.2', gateway], { timeoutMs: 8000 });
    ping = Object.assign({ host: gateway, skipped: false }, parsePing(pingResult.stdout || ''));
  } else {
    ping = {
      host: gateway,
      skipped: true,
      reason: gateway ? 'gateway is outside the local subnet' : 'no IPv4 default gateway'
    };
  }

  const interfaces = [];
  if (!selected.length) {
    interfaces.push({
      kind: choice === 'default' ? 'unknown' : choice,
      device: null,
      hardware_port: null,
      status: 'skipped',
      skip_reason: 'no matching Wi-Fi or Ethernet hardware port',
      down_mbps: null,
      up_mbps: null,
      base_rtt_ms: null,
      responsiveness_rpm: null,
      responsiveness_band: null,
      ping_gateway: ping,
      vs_plan: comparePlan(null, null, planDown, planUp)
    });
  }

  for (const port of selected) {
    if (!port.up) {
      interfaces.push({
        kind: port.kind,
        device: port.device,
        hardware_port: port.hardware_port,
        status: 'skipped',
        skip_reason: 'interface is down',
        down_mbps: null,
        up_mbps: null,
        base_rtt_ms: null,
        responsiveness_rpm: null,
        responsiveness_band: null,
        ping_gateway: ping,
        vs_plan: comparePlan(null, null, planDown, planUp)
      });
      continue;
    }
    const quality = await run('networkQuality', ['-I', port.device, '-c'], { timeoutMs: 60000 });
    if (quality.spawnError || (!quality.stdout && quality.code !== 0)) {
      interfaces.push({
        kind: port.kind,
        device: port.device,
        hardware_port: port.hardware_port,
        status: 'error',
        error: quality.spawnError ? 'networkQuality is not available' : 'networkQuality failed',
        down_mbps: null,
        up_mbps: null,
        base_rtt_ms: null,
        responsiveness_rpm: null,
        responsiveness_band: null,
        ping_gateway: ping,
        vs_plan: comparePlan(null, null, planDown, planUp)
      });
      continue;
    }
    const parsed = parseNetworkQuality(quality.stdout || '');
    interfaces.push({
      kind: port.kind,
      device: port.device,
      hardware_port: port.hardware_port,
      status: 'tested',
      down_mbps: parsed.down_mbps,
      up_mbps: parsed.up_mbps,
      base_rtt_ms: parsed.base_rtt_ms,
      responsiveness_rpm: parsed.responsiveness_rpm,
      responsiveness_band: parsed.responsiveness_band,
      dl_responsiveness_rpm: parsed.dl_responsiveness_rpm,
      ul_responsiveness_rpm: parsed.ul_responsiveness_rpm,
      ping_gateway: ping,
      vs_plan: comparePlan(parsed.down_mbps, parsed.up_mbps, planDown, planUp)
    });
  }

  return {
    ok: true,
    version: VERSION,
    platform,
    suggest_only: true,
    read_only: true,
    interface_choice: choice,
    interfaces
  };
}

module.exports = { speedTest, selectPorts };
