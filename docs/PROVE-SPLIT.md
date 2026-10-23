# `scripts/prove.js` layout

`node scripts/prove.js` is the only entry point. It prints one `ok` line per check, then `---`, `passed`, and `failed`. A failure exits non-zero. The runner does not send traffic and does not run a live `networkQuality`.

`scripts/prove.js` requires the modules below. Synchronous modules register their checks on load. Asynchronous modules export `run()`, and the runner awaits them in the order listed. The harness owns the pass/fail counters.

| File | Checks |
| --- | --- |
| `scripts/prove/harness.js` | `check`, `checkAsync`, counters, and the `passed` / `failed` summary. |
| `scripts/prove/fixtures.js` | `LAN`, `host`, `sample`, `speed`, `wifiResult`, `lanHost`, and the `PORTS`, `IFCONFIG`, `QUALITY`, `PING`, and `UPNP` strings. |
| `scripts/prove/subnet.js` | "public and non-subnet addresses are refused", "probe urls stay on literal in-subnet addresses", and "vpn tunnels and non-default interfaces are not local". |
| `scripts/prove/parsers.js` | "parsers read fixture output". |
| `scripts/prove/wifi.js` | "wifi fixtures, redacted BSSID, roaming, and mesh estimate". |
| `scripts/prove/vendors.js` | "vendor detection is detect-only". |
| `scripts/prove/report.js` | "report rules are ordered and deterministic". |
| `scripts/prove/hygiene.js` | "server modules stay under 300 lines and hold no credentials". |
| `scripts/prove/tools-speed.js` | "speed_test skips a down interface and will not ping a public gateway", "speed_test all includes Wi-Fi and pings each interface gateway", "loadHost keeps each interface gateway and drops tunnels", and "virtual interfaces get no probe targets". |
| `scripts/prove/tools-discover.js` | "discover fetches only in-subnet UPnP descriptions" and "discover ignores a VPN 10/8 and caps location fetches". |
| `scripts/prove/tools-rest.js` | "router_detect GETs only a probeable gateway", "router_detect treats a catch-all ISP gateway as weak and an eero by OUI", and "wifi_sample and report do not touch the network when injected or unsupported". |
| `scripts/prove/mcp.js` | "mcp initialize and tools/list handshake". The child is spawned with `HNC_SKIP_NETWORK=1`, so `speed_test` does not run `networkQuality`. Off macOS the call is still `unsupported OS`. |

## Rules

- Keep fixture data in one module so tool tests do not copy the LAN or UPnP strings.
- Keep the harness responsible for counting. A thrown assertion still fails that check and the process still exits non-zero.
- Do not add a network call, a timer that waits on a real socket, or a live `networkQuality` run.
- Do not change the check names. The governor log diffs those lines.
- Keep each test file small. A check stays in one file.
- The line-count check covers `server/**/*.js` only.
