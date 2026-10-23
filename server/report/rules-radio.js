'use strict';

const { bufferbloatFix } = require('./fixes');
const { findSplitNetwork, splitNetworkFix } = require('./split');
const { ratio, fmtMbps } = require('./context');

function linkName(kind) {
  if (kind === 'wifi') return 'Wi-Fi';
  if (kind === 'ethernet') return 'Ethernet';
  return 'Link';
}

function rankedSpeed(ctx) {
  return ctx.speed
    .filter((row) => typeof row.responsiveness_rpm === 'number')
    .slice()
    .sort((a, b) => a.responsiveness_rpm - b.responsiveness_rpm);
}

function lowResponsiveness(ctx) {
  return rankedSpeed(ctx).find((row) => row.responsiveness_band === 'low') || null;
}

function contrastRow(ranked, worst) {
  return ranked.find((row) => row !== worst && row.kind !== worst.kind)
    || ranked.find((row) => row !== worst)
    || null;
}

function bufferbloatDetail(ctx) {
  const ranked = rankedSpeed(ctx);
  const worst = lowResponsiveness(ctx) || ranked[0];
  const other = contrastRow(ranked, worst);
  if (worst && other) {
    return `${linkName(worst.kind)} responsiveness of ${worst.responsiveness_rpm} RPM (${worst.responsiveness_band}) against ${linkName(other.kind)}'s ${other.responsiveness_rpm} RPM.`;
  }
  return `Responsiveness is ${worst.responsiveness_rpm} RPM (${worst.responsiveness_band}) while downlink ${fmtMbps(worst.down_mbps)} still meets the plan.`;
}

function vendorForRow(ctx, row) {
  const list = (ctx.router && ctx.router.gateways) || [];
  const match = list.find((item) => item && row && (item.interface === row.device || item.device === row.device));
  if (match && match.vendor && match.vendor !== 'unknown' && match.vendor !== 'isp-openwrt') return match.vendor;
  if (ctx.vendor && ctx.vendor !== 'isp-openwrt') return ctx.vendor;
  return (match && match.vendor) || ctx.vendor;
}

function bufferbloatMatches(ctx) {
  return ctx.speed.some((row) => {
    if (row.responsiveness_band !== 'low') return false;
    if (!(ctx.planDown > 0)) return true;
    const measured = ratio(row.down_mbps, ctx.planDown);
    return measured != null && measured >= 0.8;
  });
}

const radioRules = [
  {
    id: 'bufferbloat',
    matches: bufferbloatMatches,
    bottleneck: (ctx) => ({
      id: 'bufferbloat',
      title: 'Bufferbloat: latency under load is poor',
      detail: bufferbloatDetail(ctx)
    }),
    cheapestFix: (ctx) => bufferbloatFix(vendorForRow(ctx, lowResponsiveness(ctx))),
    nextOptions: (ctx) => {
      const options = [];
      const split = findSplitNetwork(ctx);
      if (split) options.push(splitNetworkFix(split));
      options.push({
        action: 'Pause large uploads during calls if the router has no shaper.',
        reason: 'An upload filling the plan is the usual way an unshaped home link adds delay.'
      });
      options.push({
        action: 'Retest after the setting change and compare RPM, not just megabits.',
        reason: 'A shaper that is working moves RPM out of the low band.'
      });
      return options;
    }
  },
  {
    id: 'double-nat',
    matches: (ctx) => Boolean(findSplitNetwork(ctx)),
    bottleneck: (ctx) => {
      const split = findSplitNetwork(ctx);
      return {
        id: 'double-nat',
        title: 'double NAT or split networks',
        detail: `Ethernet (${split.isp.ip}) and Wi-Fi (${split.mesh.ip}) are different private subnets. One router is ${split.isp.label || 'an ISP gateway'} and the other is ${split.mesh.label || split.mesh.vendor}.`
      };
    },
    cheapestFix: (ctx) => splitNetworkFix(findSplitNetwork(ctx)),
    nextOptions: () => ([
      {
        action: 'Retest after the ISP gateway is bridged, with the Mac joined only to the mesh subnet.',
        reason: 'One private subnet means the speed test and the gateway probe are looking at the same router.'
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
