# Privacy

Home Network Check v0.1 runs on your own computer. It is a local stdio process. It does not have an account, a cloud backend, or telemetry.

## What stays on this machine

- The MCP server writes results only to the local agent over stdin/stdout. It does not save a report file and it does not phone home.
- Vendor names come from a small OUI table bundled in the source. MAC addresses are not sent to a lookup service.
- Router passwords, API tokens, and cookies are neither requested nor stored. The server never sends an `Authorization` header and never POSTs a login form.
- stderr, if you watch it, names the tool that failed. It does not print your ARP table or your Wi-Fi name.

## What the tools read

| Tool | Reads | Where the packets go |
| --- | --- | --- |
| `discover` | Default route, interface addresses, ARP table, a few seconds of mDNS service-type browsing, one SSDP M-SEARCH, then UPnP description XML | mDNS and SSDP stay on the local link. UPnP HTTP goes only to a literal address inside your interface subnet. |
| `wifi_sample` | `system_profiler` and `ipconfig getsummary` | No network traffic from this tool. |
| `speed_test` | `networkQuality`, hardware-port list, and a short ping | The ping goes only to your IPv4 gateway, and only when that address is inside the local subnet. `networkQuality` is Apple's speed test: it sends measurement traffic off your LAN to Apple's service. That is the only off-LAN traffic in v0.1. |
| `router_detect` | Discovery results, plus HTTP GET of the gateway `/`, `/cgi-bin/luci/`, and `/Main_Login.asp` | Those GETs go to the gateway only when it is a literal address inside the subnet. TLS certificates are verified. Redirects that leave that address are dropped. Response bodies are used as short fingerprints, not stored. |
| `report` | The results above | No extra traffic when those results are already in hand. |

## What it will not probe

Every unicast address is checked with `isInLocalSubnet` before a ping or an HTTP fetch:

- The address must be RFC1918 (`10/8`, `172.16/12`, `192.168/16`) or IPv4 link-local (`169.254/16`).
- It must also fall inside one of this computer's own up-interface prefixes (prefix length 8 through 30).
- Public addresses, CGNAT (`100.64/10`), loopback, multicast, and the subnet's network and broadcast addresses are refused.
- Hostnames are refused. Only literal IPv4 is fetched, so a description URL cannot redirect the tool through DNS to the public internet.
- There is no subnet sweep, no port scan, and no fetch of UPnP control URLs.

`scripts/prove.js` checks that refusal with fixtures. It does not send traffic.

## Suggest only

The report names settings you can change yourself in the vendor's app or web page. v0.1 does not log in and does not change them. Read adapters for UniFi, OpenWrt, and ASUS are interface placeholders with `read` set to `null`.
