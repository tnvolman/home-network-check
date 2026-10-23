'use strict';

const { normalize, MEETS } = require('./context');
const { capacityRules } = require('./rules-capacity');
const { radioRules } = require('./rules-radio');

const RULES = capacityRules.concat(radioRules);

function result(rule, ctx) {
  return {
    ok: true,
    suggest_only: true,
    read_only: true,
    bottleneck: rule.bottleneck(ctx),
    cheapest_fix: rule.cheapestFix(ctx),
    next_options: rule.nextOptions(ctx),
    rule_id: rule.id
  };
}

function buildReport(input) {
  const ctx = normalize(input || {});
  for (const rule of RULES) {
    if (rule.matches(ctx)) return result(rule, ctx);
  }
  return result(RULES[RULES.length - 1], ctx);
}

module.exports = { buildReport, RULES, MEETS };
