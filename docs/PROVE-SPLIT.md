# Plan: split `scripts/prove.js`

This is a plan only. `scripts/prove.js` stays one file until a later change does the split. Do not move assertions as part of the license or probe-limit work.

`node scripts/prove.js` is the only entry point. It must stay free of network writes. The printed `ok` lines and the `passed` / `failed` summary should stay comparable with the current run.

Today the file is one script of roughly 700 lines: helpers and fixtures, seven synchronous checks, then five asynchronous checks inside `main`. Each future file should stay under about 300 lines. A check should not be split across files.

## Proposed layout

| File | What moves |
| --- | --- |
| `scripts/prove/harness.js` | `check`, `checkAsync`, the pass/fail counters, and `main`'s runner. `scripts/prove.js` requires this and prints the summary. |
| `scripts/prove/fixtures.js` | `LAN`, `host`, `sample`, `speed`, `wifiResult`, and the `PORTS`, `IFCONFIG`, `QUALITY`, `PING`, and `UPNP` strings. |
| `scripts/prove/subnet.js` | "public and non-subnet addresses are refused", "probe urls stay on literal in-subnet addresses", and "vpn tunnels and non-default interfaces are not local". |
| `scripts/prove/parsers.js` | "parsers read fixture output". |
| `scripts/prove/wifi.js` | "wifi fixtures, redacted BSSID, roaming, and mesh estimate". |
| `scripts/prove/vendors.js` | "vendor detection is detect-only". |
| `scripts/prove/report.js` | "report rules are ordered and deterministic". |
| `scripts/prove/hygiene.js` | "server modules stay under 300 lines and hold no credentials". |
| `scripts/prove/tools-speed.js` | "speed_test skips a down interface and will not ping a public gateway". |
| `scripts/prove/tools-discover.js` | "discover fetches only in-subnet UPnP descriptions" and "discover ignores a VPN 10/8 and caps location fetches". |
| `scripts/prove/tools-rest.js` | "router_detect GETs only a probeable gateway" and "wifi_sample and report do not touch the network when injected or unsupported". |
| `scripts/prove/mcp.js` | "mcp initialize and tools/list handshake". The child is spawned with `HNC_SKIP_NETWORK=1`, so `speed_test` does not run `networkQuality`. Off macOS the call is still `unsupported OS`. |

`scripts/prove.js` would only require those modules, run the sync checks, then `await` the async checks in the same order, then print `passed` and `failed`.

## Rules for that refactor

- Keep fixture data in one module so tool tests do not copy the LAN or UPnP strings.
- Keep the harness responsible for counting. A thrown assertion still fails that check and the process still exits non-zero.
- Do not add a network call, a timer that waits on a real socket, or a live `networkQuality` run.
- Do not change the check names. The governor log diffs those lines.
- Leave server code alone. The split is a test-layout change.
