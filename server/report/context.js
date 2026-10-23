'use strict';

const MEETS = 0.8;

function ratio(measured, plan) {
  if (typeof measured !== 'number' || typeof plan !== 'number' || !(plan > 0)) return null;
  return measured / plan;
}

function sectionOk(section) {
  return Boolean(section && section.ok !== false && section.error !== 'unsupported OS');
}

function testedRows(speed) {
  if (!sectionOk(speed)) return [];
  return (speed.interfaces || []).filter((row) => row.status === 'tested' && typeof row.down_mbps === 'number');
}

function wifiOf(wifi) {
  if (!sectionOk(wifi) || !wifi.findings || wifi.findings.no_reading) return null;
  return wifi.findings;
}

function discoverOf(discover) {
  return sectionOk(discover) ? discover : null;
}

function routerOf(router) {
  return sectionOk(router) ? router : null;
}

function fmtMbps(n) {
  return typeof n === 'number' ? `${n} Mbps` : 'unmeasured';
}

function pct(r) {
  return r == null ? 'n/a' : `${Math.round(r * 100)}%`;
}

function lowRpmNote(rows) {
  const low = rows.find((row) => row.responsiveness_band === 'low');
  if (!low) return null;
  return {
    action: 'After the link is fixed, retest responsiveness; low RPM means the queue is still adding delay.',
    reason: `Responsiveness was ${low.responsiveness_rpm} RPM (${low.responsiveness_band}).`
  };
}

function normalize(input) {
  const speed = input.speed_test || null;
  const wifi = wifiOf(input.wifi_sample);
  const discover = discoverOf(input.discover);
  const router = routerOf(input.router_detect);
  const unsupported = [input.speed_test, input.wifi_sample, input.discover, input.router_detect]
    .some((section) => section && section.error === 'unsupported OS')
    && !testedRows(speed).length && !wifi && !discover && !router;
  return {
    planDown: typeof input.plan_down_mbps === 'number' ? input.plan_down_mbps : null,
    planUp: typeof input.plan_up_mbps === 'number' ? input.plan_up_mbps : null,
    speed: testedRows(speed),
    speedRaw: sectionOk(speed) ? speed : null,
    wifi,
    discover,
    router,
    vendor: router && router.vendor && router.vendor !== 'unknown' ? router.vendor : null,
    unsupported
  };
}

module.exports = {
  MEETS,
  ratio,
  fmtMbps,
  pct,
  lowRpmNote,
  normalize
};
