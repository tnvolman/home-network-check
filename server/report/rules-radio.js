'use strict';

const { bufferbloatFix } = require('./fixes');
const { ratio, fmtMbps } = require('./context');

const radioRules = [
  {
    id: 'bufferbloat',
    matches: (ctx) => ctx.speed.some((row) => {
      if (row.responsiveness_band !== 'low') return false;
      if (!(ctx.planDown > 0)) return true;
      const r = ratio(row.down_mbps, ctx.planDown);
      return r != null && r >= 0.8;
    }),
    bottleneck: (ctx) => {
      const row = ctx.speed.find((item) => item.responsiveness_band === 'low');
      return {
        id: 'bufferbloat',
        title: 'Bufferbloat: latency under load is poor',
        detail: `Responsiveness is ${row.responsiveness_rpm} RPM (low) while downlink ${fmtMbps(row.down_mbps)} still meets the plan.`
      };
    },
    cheapestFix: (ctx) => bufferbloatFix(ctx.vendor),
    nextOptions: () => ([
      {
        action: 'Pause large uploads during calls if the router has no shaper.',
        reason: 'An upload filling the plan is the usual way an unshaped home link adds delay.'
      },
      {
        action: 'Retest after the setting change and compare RPM, not just megabits.',
        reason: 'A shaper that is working moves RPM out of the low band.'
      }
    ])
  },
  {
    id: 'roaming',
    matches: (ctx) => Boolean(ctx.wifi && (ctx.wifi.roaming === true || ctx.wifi.band_changes === true)),
    bottleneck: (ctx) => ({
      id: 'roaming',
      title: ctx.wifi.band_changes
        ? 'The client changed bands during the sample'
        : 'The client roamed during the sample',
      detail: ctx.wifi.band_changes
        ? `Bands seen: ${ctx.wifi.bands_seen.join(', ')}. ${ctx.wifi.roaming_detail}`
        : ctx.wifi.roaming_detail
    }),
    cheapestFix: () => ({
      action: 'Stay in one place and rerun the sample; if it still roams, prefer the closer node.',
      reason: 'A BSSID or band change mid-sample drops throughput and adds latency.'
    }),
    nextOptions: (ctx) => ([
      {
        action: ctx.wifi.mesh_nodes_estimate > 1
          ? `This sample grouped about ${ctx.wifi.mesh_nodes_estimate} nodes. Leave nodes where they are until a wired test says the WAN is fine.`
          : 'Treat the node count as an estimate only.',
        reason: 'Backhaul is unknown/inferred in v0.1, so buying another node is not the first step.'
      }
    ])
  },
  {
    id: 'weak-signal',
    matches: (ctx) => Boolean(ctx.wifi && ctx.wifi.weak_signal),
    bottleneck: (ctx) => ({
      id: 'weak-signal',
      title: 'Weak Wi-Fi at this spot',
      detail: `${ctx.wifi.weak_reasons.join('; ')}.`
    }),
    cheapestFix: () => ({
      action: 'Use this computer closer to a node you already have, or move that node closer.',
      reason: 'RSSI is below -70 dBm or SNR is below 20 dB, so this spot has little margin even if a short test looked fine.'
    }),
    nextOptions: () => ([
      {
        action: 'Add a node only if a closer seat and a moved node still leave the room weak.',
        reason: 'A new node costs more than moving the one you have, and its backhaul is unknown until you wire it.'
      }
    ])
  },
  {
    id: 'healthy',
    matches: () => true,
    bottleneck: () => ({
      id: 'healthy',
      title: 'No bottleneck showed up in this run',
      detail: 'Throughput, responsiveness, and the Wi-Fi sample are inside the checks this version knows.'
    }),
    cheapestFix: () => ({
      action: 'None. Nothing in this run needs a change.',
      reason: 'The measured path met the plan and the Wi-Fi sample was stable and strong enough.'
    }),
    nextOptions: () => ([
      {
        action: 'Rerun during a busy hour and from a far room.',
        reason: 'A quiet spot next to the router hides both bufferbloat and a weak room.'
      },
      {
        action: 'Treat mesh backhaul as unknown until a node is wired and retested.',
        reason: 'v0.1 does not observe the hop between nodes.'
      }
    ])
  }
];

module.exports = { radioRules };
