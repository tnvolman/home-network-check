'use strict';

function round2(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function classifyRatio(measured, plan) {
  if (typeof measured !== 'number' || !Number.isFinite(measured)) {
    return { ratio: null, label: 'not_measured' };
  }
  if (typeof plan !== 'number' || !Number.isFinite(plan) || plan <= 0) {
    return { ratio: null, label: 'not_provided' };
  }
  const ratio = measured / plan;
  let label = 'meets_plan';
  if (ratio < 0.5) label = 'well_below_plan';
  else if (ratio < 0.8) label = 'below_plan';
  return { ratio: Math.round(ratio * 1000) / 1000, label };
}

function comparePlan(downMbps, upMbps, planDown, planUp) {
  const down = classifyRatio(downMbps, planDown);
  const up = classifyRatio(upMbps, planUp);
  return {
    plan_down_mbps: planDown == null ? null : planDown,
    plan_up_mbps: planUp == null ? null : planUp,
    down_ratio: down.ratio,
    up_ratio: up.ratio,
    down_vs_plan: down.label,
    up_vs_plan: up.label
  };
}

module.exports = { round2, classifyRatio, comparePlan };
