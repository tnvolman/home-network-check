# Home Network Check

Read-only check of the home network this Mac is connected to. v0.1 is a local stdio MCP server with no npm dependencies and no telemetry. It suggests router settings. It does not log in, and it does not change them.

Collectors run on macOS. On any other OS every tool returns `unsupported OS` and sends no packets.

Michael McClanahan ([@tnvolman](https://github.com/tnvolman)). MIT License; see [LICENSE](LICENSE).

## Install

Node.js 20 or newer. There are no npm dependencies.

Cursor loads `.cursor-plugin/plugin.json` (the root `plugin.json` matches it) and starts the server from `mcp.json`. From the Marketplace, open Customize, select Home Network Check, and choose Install. To load this repository before it is listed, copy it to `~/.cursor/plugins/local/home-network-check`. Cursor sets `CURSOR_PLUGIN_ROOT` to that directory.

```json
{
  "mcpServers": {
    "home-network-check": {
      "command": "node",
      "args": ["${CURSOR_PLUGIN_ROOT}/server/hnc-mcp.js"]
    }
  }
}
```

The agent skill is `skills/home-network-check/SKILL.md`.

## Usage

Start the server on stdin and stdout:

```bash
node server/hnc-mcp.js
```

`npm start` runs the same command. The process speaks JSON-RPC 2.0 (`initialize`, then `tools/list` and `tools/call`).

Use it when asking why Wi-Fi is slow, whether bufferbloat is the problem, what is on the LAN, or which router setting to change. Call the tools in this order: `discover`, `wifi_sample`, `speed_test`, `router_detect`, then `report`. Lead with the bottleneck, then the cheapest fix and its one-line reason, then the next options.

| Tool | Arguments | What you get |
| --- | --- | --- |
| `discover` | none | Default route, each active Wi-Fi and Ethernet prefix and its own gateway, the ARP table, a short mDNS service-type browse (`dns-sd`), one SSDP M-SEARCH, and at most 16 in-subnet UPnP descriptions. Virtual interfaces are not probe targets. |
| `wifi_sample` | `samples` (1–30, default 6), `interval_s` (1–60 seconds, default 10) | SSID, channel, band, RSSI, noise, SNR, and tx rate from `system_profiler SPAirPortDataType -json` and `ipconfig getsummary`. Flags roaming, band changes, and weak signal (RSSI below -70 dBm or SNR below 20 dB). A redacted BSSID stays unknown. Backhaul is `unknown/inferred`. |
| `speed_test` | `interface`: `wifi`, `ethernet`, or `all`. Optional `plan_down_mbps` and `plan_up_mbps`. | Apple's `networkQuality -I <iface> -c` on each up Wi-Fi or Ethernet port, plus a ping of that interface's own gateway. A down interface is skipped and not pinged. This is the only tool that sends traffic off the LAN. |
| `router_detect` | none | Vendor guess for each active gateway: eero, Google/Nest Wifi, NETGEAR Orbi, TP-Link Deco, ASUS/Merlin, UniFi, OpenWrt, or an ISP gateway. Returns confidence, evidence, `local_api`, adjustable settings, and how to change them. No password is requested. Read adapters are not called. |
| `report` | Optional `interface`, plan speeds, and `collected` results from the tools above. Sections present in `collected` are not run again. | The same inputs always produce the same rule: bottleneck, cheapest fix, then the next options. |

Unicast probes run only when the address is inside that interface's own prefix (RFC1918 or link-local, length 8 through 30). Allowed interfaces are the Wi-Fi and Ethernet devices from `networksetup -listallhardwareports`. Limits are in [PRIVACY.md](PRIVACY.md).

Check the fixture parsers and a live `initialize` / `tools/list` handshake without sending traffic:

```bash
node scripts/prove.js
```

`npm run prove` is the same command.

## Configuration

No API keys, plugin variables, or required environment variables. The manifest `variables` field is unset, and `mcp.json` does not read a secret.

`HNC_SKIP_NETWORK=1` is optional. When it is set, `speed_test` does not run Apple's `networkQuality` and returns a skipped result. `scripts/prove.js` sets it. Leave it unset for a real check.
