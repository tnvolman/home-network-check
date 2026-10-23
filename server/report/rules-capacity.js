'use strict';

const { MEETS, ratio, fmtMbps, pct, lowRpmNote } = require('./context');

const capacityRules = [
  {
    id: 'unsupported-os',
    matches: (ctx) => ctx.unsupported,
    bottleneck: () => ({
      id: 'unsupported-os',
      title: 'This machine is not running the macOS collectors',
      detail: 'v0.1 returns unsupported OS on other systems and does not send probes.'
    }),
    cheapestFix: () => ({
      action: 'Run Home Network Check on the Mac that is joined to the home network.',
      reason: 'The collectors shell out to macOS tools, so another OS cannot see this network.'
    }),
    nextOptions: () => []
  },
  {
    id: 'no-data',
    matches: (ctx) => !ctx.speed.length && !ctx.wifi && !ctx.discover && !ctx.router,
    bottleneck: () => ({
      id: 'no-data',
      title: 'No measurements were provided',
      detail: 'The report had no usable speed test, Wi-Fi sample, discovery, or router detection.'
    }),
    cheapestFix: () => ({
      action: 'Run discover, wifi_sample, and speed_test on this Mac, then run report again.',
      reason: 'The rules only rank a bottleneck that shows up in collected measurements.'
    }),
    nextOptions: () => []
  },
  {
    id: 'no-uplink',
    matches: (ctx) => {
      const noGateway = ctx.discover && (!ctx.discover.gateway || !ctx.discover.gateway.ip);
      const interfaces = ctx.speedRaw && ctx.speedRaw.interfaces;
      const allSkipped = Array.isArray(interfaces) && interfaces.length > 0 && ctx.speed.length === 0;
      if (noGateway && ctx.speed.length === 0) return true;
      if (allSkipped && !ctx.wifi) return true;
      return false;
    },
    bottleneck: (ctx) => ({
      id: 'no-uplink',
      title: 'No working uplink was found',
      detail: ctx.discover && (!ctx.discover.gateway || !ctx.discover.gateway.ip)
        ? 'The routing table has no default gateway to test.'
        : 'Every requested interface was down or had no IPv4 address.'
    }),
    cheapestFix: () => ({
      action: 'Confirm Wi-Fi is on or the Ethernet cable is seated, then rerun the check.',
      reason: 'Without an up interface and a default route, later speed and Wi-Fi advice would be a guess.'
    }),
    nextOptions: () => ([
      {
        action: 'Power-cycle the modem, wait for its online light, then power-cycle the router.',
        reason: 'A dead WAN link looks the same as a down interface from the computer.'
      }
    ])
  },
  {
    id: 'wired-below-plan',
    matches: (ctx) => {
      const eth = ctx.speed.find((row) => row.kind === 'ethernet');
      const r = eth && ratio(eth.down_mbps, ctx.planDown);
      return r != null && r < MEETS;
    },
    bottleneck: (ctx) => {
      const eth = ctx.speed.find((row) => row.kind === 'ethernet');
      const r = ratio(eth.down_mbps, ctx.planDown);
      return {
        id: 'wired-below-plan',
        title: 'Wired throughput is below the plan',
        detail: `Ethernet downlink ${fmtMbps(eth.down_mbps)} is ${pct(r)} of the ${ctx.planDown} Mbps plan.`
      };
    },
    cheapestFix: () => ({
      action: 'Reseat or replace the Ethernet cable and check that the modem link light is up.',
      reason: 'A cabled test already removes Wi-Fi, and the result is still under 80% of the plan.'
    }),
    nextOptions: (ctx) => {
      const options = [{
        action: 'Run the router or modem speed test from its own admin page.',
        reason: 'If that test is also low, the limit is the modem or the ISP rather than this computer.'
      }];
      const note = lowRpmNote(ctx.speed);
      if (note) options.push(note);
      if (ctx.wifi && ctx.wifi.weak_signal) {
        options.push({
          action: 'Move the Wi-Fi client closer after the wired path is fixed.',
          reason: 'The Wi-Fi sample at this spot was also weak, which is a separate hop.'
        });
      }
      return options;
    }
  },
  {
    id: 'wifi-weak-link',
    matches: (ctx) => {
      if (!ctx.wifi || !ctx.wifi.weak_signal) return false;
      const wifi = ctx.speed.find((row) => row.kind === 'wifi');
      const r = wifi && ratio(wifi.down_mbps, ctx.planDown);
      return r != null && r < MEETS;
    },
    bottleneck: (ctx) => {
      const wifi = ctx.speed.find((row) => row.kind === 'wifi');
      return {
        id: 'wifi-weak-link',
        title: 'Wi-Fi at this spot is the limit',
        detail: `Downlink ${fmtMbps(wifi.down_mbps)} is ${pct(ratio(wifi.down_mbps, ctx.planDown))} of the ${ctx.planDown} Mbps plan. ${ctx.wifi.weak_reasons.join('; ')}.`
      };
    },
    cheapestFix: () => ({
      action: 'Move this computer a few meters closer to the nearest node, or plug it in with Ethernet, and rerun.',
      reason: 'Signal is under the weak line and throughput is under 80% of the plan, so the last wireless hop is the constraint.'
    }),
    nextOptions: () => ([
      {
        action: 'If the whole home is weak, move an existing node before buying another one.',
        reason: 'v0.1 cannot see mesh backhaul, so a new node is a later option, not the cheapest one.'
      },
      {
        action: 'Retest with Ethernet to learn whether the ISP path is fine.',
        reason: 'A wired result separates a weak room from a slow WAN.'
      }
    ])
  },
  {
    id: 'band-24',
    matches: (ctx) => {
      if (!ctx.wifi || ctx.wifi.weak_signal) return false;
      if (!(ctx.wifi.bands_seen.length === 1 && ctx.wifi.bands_seen[0] === '2.4')) return false;
      if (!(ctx.planDown > 100)) return false;
      const wifi = ctx.speed.find((row) => row.kind === 'wifi');
      if (!wifi) return true;
      const r = ratio(wifi.down_mbps, ctx.planDown);
      return r == null || r < MEETS;
    },
    bottleneck: (ctx) => ({
      id: 'band-24',
      title: 'This client is on 2.4 GHz',
      detail: `The sample stayed on 2.4 GHz against a ${ctx.planDown} Mbps plan. 2.4 GHz cannot carry that plan.`
    }),
    cheapestFix: () => ({
      action: 'Join the 5 GHz or 6 GHz network from this spot and rerun.',
      reason: 'A plan over 100 Mbps needs a wider band, and the signal was not in the weak range.'
    }),
    nextOptions: () => ([
      {
        action: 'If the client falls back to 2.4 GHz again, move closer to a node.',
        reason: '5 GHz and 6 GHz fade sooner, so distance is the usual reason a client stays on 2.4.'
      }
    ])
  },
  {
    id: 'wifi-below-plan',
    matches: (ctx) => {
      const wifi = ctx.speed.find((row) => row.kind === 'wifi');
      if (!wifi) return false;
      if (ctx.wifi && ctx.wifi.weak_signal) return false;
      const r = ratio(wifi.down_mbps, ctx.planDown);
      return r != null && r < MEETS;
    },
    bottleneck: (ctx) => {
      const wifi = ctx.speed.find((row) => row.kind === 'wifi');
      return {
        id: 'wifi-below-plan',
        title: 'Wi-Fi throughput is below the plan',
        detail: `Downlink ${fmtMbps(wifi.down_mbps)} is ${pct(ratio(wifi.down_mbps, ctx.planDown))} of the ${ctx.planDown} Mbps plan, and the signal was not flagged as weak.`
      };
    },
    cheapestFix: () => ({
      action: 'Connect this computer with Ethernet once and rerun the speed test.',
      reason: 'Signal looks usable, so one cabled test shows whether the gap is the air or the WAN.'
    }),
    nextOptions: (ctx) => {
      const options = [{
        action: 'Retest while standing next to the gateway.',
        reason: 'If speed recovers there, the far hop or the mesh hop is the limit. Backhaul is unknown in v0.1.'
      }];
      const note = lowRpmNote(ctx.speed);
      if (note) options.push(note);
      return options;
    }
  },
  {
    id: 'upload-below-plan',
    matches: (ctx) => {
      if (!(ctx.planUp > 0)) return false;
      return ctx.speed.some((row) => {
        const downOk = !(ctx.planDown > 0) || ratio(row.down_mbps, ctx.planDown) >= MEETS;
        const up = ratio(row.up_mbps, ctx.planUp);
        return downOk && up != null && up < MEETS;
      });
    },
    bottleneck: (ctx) => {
      const row = ctx.speed.find((item) => ratio(item.up_mbps, ctx.planUp) < MEETS);
      return {
        id: 'upload-below-plan',
        title: 'Upload is below the plan',
        detail: `Uplink ${fmtMbps(row.up_mbps)} is ${pct(ratio(row.up_mbps, ctx.planUp))} of the ${ctx.planUp} Mbps upload plan while download met the plan.`
      };
    },
    cheapestFix: () => ({
      action: 'Pause cloud backups and camera uploads, then rerun the speed test.',
      reason: 'Download met the plan and upload did not, which is often a busy uplink rather than a Wi-Fi fault.'
    }),
    nextOptions: () => ([
      {
        action: 'If upload stays low with other devices paused, check the plan’s upload cap with the ISP.',
        reason: 'Many home plans advertise a much smaller upload than download.'
      }
    ])
  }
];

module.exports = { capacityRules };
