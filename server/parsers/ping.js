'use strict';

const { round2 } = require('../plan');

function parsePing(stdout) {
  const text = String(stdout || '');
  const tx = /(\d+) packets transmitted/.exec(text);
  const rx = /(\d+) packets received/.exec(text);
  const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(text);
  const rtt = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/.exec(text);
  return {
    transmitted: tx ? Number(tx[1]) : null,
    received: rx ? Number(rx[1]) : null,
    loss_pct: loss ? Number(loss[1]) : null,
    min_ms: rtt ? round2(Number(rtt[1])) : null,
    avg_ms: rtt ? round2(Number(rtt[2])) : null,
    max_ms: rtt ? round2(Number(rtt[3])) : null,
    jitter_ms: rtt ? round2(Number(rtt[4])) : null
  };
}

module.exports = { parsePing };
