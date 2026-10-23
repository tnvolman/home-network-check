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
| `discover` | Default route, the prefix on that interface, ARP table, a few seconds of mDNS service-type browsing, one SSDP M-SEARCH, then at most 16 UPnP descriptions inside an overall time budget | mDNS and SSDP stay on the local link. UPnP HTTP goes only to a literal address on the default-route subnet. |
| `wifi_sample` | `system_profiler` and `ipconfig getsummary` | No network traffic from this tool. |
| `speed_test` | Apple's `networkQuality`, the hardware-port list, and a short ping | `speed_test` uses Apple's `networkQuality`, which sends traffic to Apple's servers. That is the only off-LAN traffic in v0.1. The ping goes only to your IPv4 gateway, and only when that address is on the default-route subnet. |
| `router_detect` | Discovery results, plus HTTP GET of the gateway `/`, `/cgi-bin/luci/`, and `/Main_Login.asp` | Those GETs go to the gateway only when it is a literal address inside the subnet. TLS certificates are verified. Redirects that leave that address are dropped. Response bodies are used as short fingerprints, not stored. |
| `report` | The results above | No extra traffic when those results are already in hand. |

## What it will not probe

Every unicast address is checked with `isInLocalSubnet` before a ping or an HTTP fetch:

- The address must be RFC1918 (`10/8`, `172.16/12`, `192.168/16`) or IPv4 link-local (`169.254/16`).
- It must also fall inside the prefix of the interface that holds the default route (prefix length 8 through 30). Other up interfaces are not probe targets.
- Tunnel interfaces (`utun*`, `ipsec*`, `ppp*`, `tun*`, `wg*`) are dropped. A VPN that puts `10/8` on `utun` does not count as local, even when that tunnel holds the default route.
- Public addresses, CGNAT (`100.64/10`), loopback, multicast, and the subnet's network and broadcast addresses are refused.
- At most 16 SSDP description URLs are fetched, and `discover` stops new fetches when its overall time budget is spent.
- Hostnames are refused. Only literal IPv4 is fetched, so a description URL cannot redirect the tool through DNS to the public internet.
- There is no subnet sweep, no port scan, and no fetch of UPnP control URLs.

`scripts/prove.js` checks that refusal with fixtures. It does not send traffic.

## Suggest only

The report names settings you can change yourself in the vendor's app or web page. v0.1 does not log in and does not change them. Read adapters for UniFi, OpenWrt, and ASUS are interface placeholders with `read` set to `null`.
