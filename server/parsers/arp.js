'use strict';

const { normalizeMac } = require('../oui');

function parseArp(text) {
  const rows = [];
  const re = /\((\d+\.\d+\.\d+\.\d+)\) at (\S+) on (\S+)/g;
  let match;
  const body = String(text || '');
  while ((match = re.exec(body))) {
    const raw = match[2];
    const incomplete = raw === '(incomplete)';
    rows.push({
      ip: match[1],
      mac: incomplete ? null : normalizeMac(raw),
      interface: match[3],
      incomplete
    });
  }
  return rows;
}

module.exports = { parseArp };
