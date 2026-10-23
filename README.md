# Home Network Check

v0.1 is a local, read-only look at the home network the computer is already on. It is a Node.js stdio MCP server with no npm dependencies, plus a Cursor Agent plugin wrapper. It runs on macOS. On any other OS every tool returns `unsupported OS` and sends nothing.

Suggest only. It does not log into the router and it does not change settings.

## Run

Node.js 20 or newer. From this directory:

```bash
node server/hnc-mcp.js
```

Cursor loads `mcp.json`:

```json
{
  "mcpServers": {
    "home-network-check": {
      "command": "node",
      "args": ["server/hnc-mcp.js"]
    }
  }
}
```

The working directory is the plugin root. `plugin.json` is at the repo root, and `.cursor-plugin/plugin.json` mirrors it for Cursor. The agent skill is `skills/home-network-check/SKILL.md`.

```bash
node scripts/prove.js
```

`prove.js` uses fixture parsers and a live `initialize` / `tools/list` handshake. It does not send traffic.

## Tools

| Tool | What it does |
| --- | --- |
| `speed_test` | Uses Apple's `networkQuality`, which sends traffic to Apple's servers. The command is `networkQuality -I <iface> -c` for Wi-Fi, Ethernet, or every up Wi-Fi and Ethernet port (`all` keeps Wi-Fi even when several adapters are down). Skips an interface that is down and does not ping it. Pings each up interface at that interface's own gateway. Compares throughput with optional plan speeds. |
| `discover` | Default route, each active Wi-Fi and Ethernet prefix from `networksetup -listallhardwareports` (or `en*` when that list is unavailable) and that interface's gateway, ARP, `dns-sd -B _services._dns-sd._udp` with a timeout, one SSDP M-SEARCH, then at most 16 UPnP description fetches inside an overall time budget. |
| `wifi_sample` | SSID, BSSID, channel, band, RSSI, noise, tx rate from `system_profiler SPAirPortDataType -json` and `ipconfig getsummary`. The `airport` command is not used. Flags roaming, band changes, and weak signal (RSSI below -70 dBm or SNR below 20 dB). Groups nearby BSSIDs as a mesh-node estimate. Backhaul is `unknown/inferred`. |
| `router_detect` | Detect-only vendor guess for eero (OUI `68:4a:76` and the other bundled eero OUIs; a `192.168.4.1` gateway alone stays low confidence), Google/Nest Wifi, NETGEAR Orbi, TP-Link Deco, ASUS/Merlin, UniFi, and OpenWrt. A catch-all HTTP 200 is not evidence. MiniUPnPd that merely mentions OpenWrt is labeled `ISP gateway (OpenWrt-based firmware)` at low confidence. Returns confidence, evidence, `local_api`, adjustable settings, and how to change them. |
| `report` | Bottleneck first, then the cheapest fix with a one-line reason, then the next options. Same inputs always produce the same rule. |

`router_detect` adapters expose `read: null`. v0.2 can attach read adapters for UniFi, OpenWrt, and ASUS on that field. v0.1 never calls it.

## Safety

- Unicast probes must pass `isInLocalSubnet`: RFC1918 or link-local, and inside the prefix of an allowed physical interface (/8 through /30). Each interface is its own guard, so a Wi-Fi gateway is not probed as if it lived on the Ethernet subnet.
- Allowed interfaces are the Wi-Fi and Ethernet devices from `networksetup -listallhardwareports`. When that list is missing, only `en` plus digits (`en0`, `en1`, …) qualify. Virtual interfaces (`feth*`, `tap*`, `utun*`, `ipsec*`, `ppp*`, `tun*`, `wg*`) are not probe targets, even when one of them holds the default route. Physical prefixes stay open in that case. `prove.js` covers that, and it covers public addresses.
- `speed_test` uses Apple's `networkQuality`, which sends traffic to Apple's servers. That is the only off-LAN traffic.
- HTTP is GET only, to literal IPv4, size-capped, with verified TLS. A random path is fetched first. If that path and the fingerprint paths all return the same 200, the body is not vendor evidence. The fingerprint paths are `/`, `/cgi-bin/luci/`, and `/Main_Login.asp`.
- No telemetry, no credentials, no subnet sweep. See [PRIVACY.md](PRIVACY.md).

Responsiveness RPM is Apple's bufferbloat signal from `networkQuality` (higher is better). This tool calls RPM below 500 low, 500–1999 medium, and 2000 or more high when the tool did not print Low/Medium/High itself. A download under 80% of the plan you entered is below plan.

## What a real Mac still has to show

`prove.js` does not run `networkQuality`, `dns-sd`, SSDP, or a gateway GET. On a Mac you still need to confirm:

- `networkQuality -c` emits `dl_throughput` and `ul_throughput` in bits per second, plus `base_rtt` and `responsiveness`.
- `system_profiler SPAirPortDataType -json` key names, and whether the BSSID is redacted until Location permission is granted.
- `ipconfig getsummary` field names for BSSID, RSSI, noise, and channel.
- `networksetup -listallhardwareports` names for your Wi-Fi and Ethernet adapters.
- Which SSDP responders answer, and whether their UPnP description is on an in-subnet literal IP.
- Whether the gateway's unauthenticated HTTP page matches one of the vendor fingerprints. A vendor with no local web UI (eero, Deco, Google/Nest Wifi) is expected to be identified from banners, mDNS, or the gateway OUI instead.
- The OUI table is a small subset. An unknown MAC stays unknown; it is not a failed check.
