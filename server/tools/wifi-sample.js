'use strict';

const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { runCommand } = require('../proc');
const { optionalInt } = require('../errors');
const { parseHardwarePorts, deviceNameOk } = require('../parsers/hardware-ports');
const {
  parseSystemProfiler,
  parseGetsummary,
  mergeWifiReading,
  analyzeWifiSamples
} = require('../parsers/wifi');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readWifiSample(deps = {}) {
  const run = deps.runCommand || runCommand;
  const ports = parseHardwarePorts((await run('networksetup', ['-listallhardwareports'], { timeoutMs: 4000 })).stdout || '');
  const wifi = ports.find((port) => port.kind === 'wifi' && deviceNameOk(port.device));
  if (!wifi) {
    return mergeWifiReading(null, null);
  }
  const [profiler, summary] = await Promise.all([
    run('system_profiler', ['SPAirPortDataType', '-json'], { timeoutMs: 25000 }),
    run('ipconfig', ['getsummary', wifi.device], { timeoutMs: 5000 })
  ]);
  const merged = mergeWifiReading(
    parseSystemProfiler(profiler.stdout || ''),
    parseGetsummary(summary.stdout || '')
  );
  merged.device = wifi.device;
  return merged;
}

async function wifiSample(args = {}, deps = {}) {
  const samples = optionalInt(args.samples, 'samples', { min: 1, max: 30, fallback: 6 });
  const intervalS = optionalInt(args.interval_s, 'interval_s', { min: 1, max: 60, fallback: 10 });
  const platform = deps.platform || process.platform;
  if (!isSupportedPlatform(platform)) return unsupportedResult(platform);
  const pause = deps.sleep || sleep;
  const read = deps.readSample || readWifiSample;
  const taken = [];
  for (let index = 0; index < samples; index += 1) {
    if (index > 0) await pause(intervalS * 1000);
    const reading = await read(deps);
    taken.push(Object.assign({ index, t_offset_s: index * intervalS }, reading));
  }
  return {
    ok: true,
    version: VERSION,
    platform,
    suggest_only: true,
    read_only: true,
    samples_requested: samples,
    interval_s: intervalS,
    samples: taken,
    findings: analyzeWifiSamples(taken),
    note: 'The airport command is not used. Backhaul is unknown/inferred in v0.1.'
  };
}

module.exports = { wifiSample, readWifiSample };
