'use strict';

const { VERSION } = require('../constants');
const { unsupportedResult, isSupportedPlatform } = require('../platform');
const { optionalMbps, optionalEnum } = require('../errors');
const { buildReport } = require('../report/rules');
const { speedTest } = require('./speed-test');
const { discover } = require('./discover');
const { wifiSample } = require('./wifi-sample');
const { routerDetect } = require('./router-detect');

function provided(collected, key) {
  return Boolean(collected && collected[key] && typeof collected[key] === 'object');
}

async function report(args = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  const planDown = optionalMbps(args.plan_down_mbps, 'plan_down_mbps');
  const planUp = optionalMbps(args.plan_up_mbps, 'plan_up_mbps');
  const collected = args.collected && typeof args.collected === 'object' && !Array.isArray(args.collected)
    ? args.collected
    : {};
  const hasAny = ['speed_test', 'discover', 'wifi_sample', 'router_detect'].some((key) => provided(collected, key));
  if (!isSupportedPlatform(platform) && !hasAny) return unsupportedResult(platform);

  const missing = () => (isSupportedPlatform(platform) ? null : unsupportedResult(platform));
  const speed = provided(collected, 'speed_test')
    ? collected.speed_test
    : (missing() || await speedTest({
      interface: optionalEnum(args.interface, 'interface', ['wifi', 'ethernet', 'all'], undefined),
      plan_down_mbps: planDown,
      plan_up_mbps: planUp
    }, deps));
  const found = provided(collected, 'discover')
    ? collected.discover
    : (missing() || await discover({}, deps));
  const wifi = provided(collected, 'wifi_sample')
    ? collected.wifi_sample
    : (missing() || await wifiSample({}, deps));
  const router = provided(collected, 'router_detect')
    ? collected.router_detect
    : (missing() || await routerDetect({}, Object.assign({}, deps, { discoverResult: found })));

  const built = buildReport({
    plan_down_mbps: planDown,
    plan_up_mbps: planUp,
    speed_test: speed,
    discover: found,
    wifi_sample: wifi,
    router_detect: router
  });
  return Object.assign({ version: VERSION }, built, {
    sections_ran: {
      speed_test: !provided(collected, 'speed_test'),
      discover: !provided(collected, 'discover'),
      wifi_sample: !provided(collected, 'wifi_sample'),
      router_detect: !provided(collected, 'router_detect')
    }
  });
}

module.exports = { report };
