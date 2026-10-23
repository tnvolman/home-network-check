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
const { conventionalGateway } = require('../gateways');
const { comparePlan } = require('../plan');
const { loadHost } = require('./host');

function selectPorts(ports, upDevices, routeInterface, choice) {
  const usable = ports.filter((port) => (port.kind === 'wifi' || port.kind === 'ethernet') && deviceNameOk(port.device));
  const tagged = usable.map((port) => Object.assign({}, port, { up: upDevices.has(port.device) }));
  if (choice === 'wifi' || choice === 'ethernet') {
    return tagged.filter((port) => port.kind === choice).slice(0, 4);
  }
  if (choice === 'all') {
    const upWifi = tagged.filter((port) => port.kind === 'wifi' && port.up);
    const upEth = tagged.filter((port) => port.kind === 'ethernet' && port.up);
    const downWifi = tagged.filter((port) => port.kind === 'wifi' && !port.up);
    const downEth = tagged.filter((port) => port.kind === 'ethernet' && !port.up);
    const up = upWifi.concat(upEth).slice(0, 4);
    return up.concat(downWifi, downEth).slice(0, Math.max(4, up.length));
  }
  const onRoute = tagged.find((port) => port.device === routeInterface);
  if (onRoute) return [onRoute];
  const up = tagged.find((port) => port.up);
  return up ? [up] : tagged.slice(0, 1);
}

function defined(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function emptySpeed(fields, planDown, planUp, ping) {
  return defined(Object.assign({
    down_mbps: null,
    up_mbps: null,
    base_rtt_ms: null,
    responsiveness_rpm: null,
    responsiveness_band: null,
    ping_gateway: ping,
    vs_plan: comparePlan(null, null, planDown, planUp)
  }, fields));
}

function interfaceRow(host, device) {
  return (host.interfaces || []).find((iface) => iface && iface.device === device) || null;
}

function pingTarget(port, host) {
  if (!port.up) return { gateway: null, ping: false, reason: 'interface is down' };
  const row = interfaceRow(host, port.device);
  const guard = row ? [row] : (host.interfaces || []);
  let gateway = row && row.gateway ? row.gateway : null;
  let explicit = Boolean(gateway);
  if (!gateway && host.route && host.route.interface === port.device) {
    gateway = host.route.gateway || null;
    explicit = Boolean(gateway);
  }
  if (gateway && isProbeable(gateway, guard)) return { gateway, ping: true, reason: null };
  if (!explicit && row) {
    const guessed = conventionalGateway(row);
    if (guessed) return { gateway: guessed, ping: true, reason: null };
  }
  return {
    gateway: gateway || null,
    ping: false,
    reason: gateway ? 'gateway is outside the local subnet' : 'no IPv4 gateway on this interface'
  };
}

function skippedPing(target) {
  return { host: target.gateway, skipped: true, reason: target.reason };
}

async function measurePing(run, target) {
  if (!target.ping) return skippedPing(target);
  const pingResult = await run('ping', ['-c', '5', '-i', '0.2', target.gateway], { timeoutMs: 8000 });
  return Object.assign({ host: target.gateway, skipped: false }, parsePing(pingResult.stdout || ''));
}

function skippedNetworkResult(platform, choice) {
  return {
    ok: true,
    version: VERSION,
    platform,
    suggest_only: true,
    read_only: true,
    skipped_network: true,
    interface_choice: choice,
    interfaces: [],
    note: 'HNC_SKIP_NETWORK is set, so networkQuality was not run'
  };
}

async function speedTest(args = {}, deps = {}) {
  const choice = optionalEnum(args.interface, 'interface', ['wifi', 'ethernet', 'all'], 'default');
  const planDown = optionalMbps(args.plan_down_mbps, 'plan_down_mbps');
  const planUp = optionalMbps(args.plan_up_mbps, 'plan_up_mbps');
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  if (deps.skipNetwork || process.env.HNC_SKIP_NETWORK === '1') return skippedNetworkResult(platform, choice);
  const run = deps.runCommand || runCommand;
  const host = deps.loadHost ? await deps.loadHost(deps) : await loadHost({ runCommand: run });
  const routeInterface = host.route && host.route.interface;

  const [portsResult, ifconfigResult] = await Promise.all([
    run('networksetup', ['-listallhardwareports'], { timeoutMs: 4000 }),
    run('ifconfig', ['-a'], { timeoutMs: 4000 })
  ]);
  const ports = parseHardwarePorts(portsResult.stdout || '');
  const upDevices = new Set(parseIfconfig(ifconfigResult.stdout || '').filter(interfaceIsUp).map((iface) => iface.device));
  const selected = selectPorts(ports, upDevices, routeInterface, choice);
  const interfaces = [];
  if (!selected.length) {
    interfaces.push(emptySpeed({
      kind: choice === 'default' ? 'unknown' : choice,
      device: null,
      hardware_port: null,
      status: 'skipped',
      skip_reason: 'no matching Wi-Fi or Ethernet hardware port'
    }, planDown, planUp, { host: null, skipped: true, reason: 'no matching Wi-Fi or Ethernet hardware port' }));
  }

  for (const port of selected) {
    const target = pingTarget(port, host);
    if (!port.up) {
      interfaces.push(emptySpeed({
        kind: port.kind,
        device: port.device,
        hardware_port: port.hardware_port,
        status: 'skipped',
        skip_reason: 'interface is down'
      }, planDown, planUp, skippedPing(target)));
      continue;
    }
    const ping = await measurePing(run, target);
    const quality = await run('networkQuality', ['-I', port.device, '-c'], { timeoutMs: 60000 });
    if (quality.spawnError || (!quality.stdout && quality.code !== 0)) {
      interfaces.push(emptySpeed({
        kind: port.kind,
        device: port.device,
        hardware_port: port.hardware_port,
        status: 'error',
        error: quality.spawnError ? 'networkQuality is not available' : 'networkQuality failed'
      }, planDown, planUp, ping));
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

module.exports = { speedTest, selectPorts, pingTarget };
