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
| `discover` | Default route, each active Wi-Fi and Ethernet prefix from `networksetup -listallhardwareports` (or `en*` when that list is unavailable) and that interface's gateway, ARP table, a few seconds of mDNS service-type browsing, one SSDP M-SEARCH, then at most 16 UPnP descriptions inside an overall time budget | mDNS and SSDP stay on the local link. UPnP HTTP goes only to a literal address on one of those interface prefixes. |
| `wifi_sample` | `system_profiler` and `ipconfig getsummary` | No network traffic from this tool. |
| `speed_test` | Apple's `networkQuality`, the hardware-port list, and a short ping per up interface | `speed_test` uses Apple's `networkQuality`, which sends traffic to Apple's servers. That is the only off-LAN traffic in v0.1. Each up interface is pinged at its own gateway, and only when that address is on that interface's subnet. A down interface is not pinged. |
| `router_detect` | Discovery results, plus one random-path GET and then HTTP GET of each gateway's `/`, `/cgi-bin/luci/`, and `/Main_Login.asp` | Those GETs go to that interface's gateway only when it is a literal address inside that interface's prefix. A catch-all 200 is not treated as vendor evidence. TLS certificates are verified. Redirects that leave that address are dropped. Response bodies are used as short fingerprints, not stored. |
| `report` | The results above | No extra traffic when those results are already in hand. |

## What it will not probe

Every unicast address is checked with `isInLocalSubnet` before a ping or an HTTP fetch:

- The address must be RFC1918 (`10/8`, `172.16/12`, `192.168/16`) or IPv4 link-local (`169.254/16`).
- It must also fall inside the prefix of an allowed physical interface (prefix length 8 through 30). Each interface guards only its own prefix.
- Allowed interfaces are the Wi-Fi and Ethernet devices from `networksetup -listallhardwareports`. When that list is missing, only `en` plus digits qualify. Virtual interfaces (`feth*`, `tap*`, `utun*`, `ipsec*`, `ppp*`, `tun*`, `wg*`) are not local, even when one of them holds the default route. Physical Wi-Fi and Ethernet prefixes stay open in that case.
- Public addresses, CGNAT (`100.64/10`), loopback, multicast, and the subnet's network and broadcast addresses are refused.
- At most 16 SSDP description URLs are fetched, and `discover` stops new fetches when its overall time budget is spent.
- Hostnames are refused. Only literal IPv4 is fetched, so a description URL cannot redirect the tool through DNS to the public internet.
- There is no subnet sweep, no port scan, and no fetch of UPnP control URLs.

`scripts/prove.js` checks that refusal with fixtures. It does not send traffic.

## Suggest only

The report names settings you can change yourself in the vendor's app or web page. v0.1 does not log in and does not change them. Read adapters for UniFi, OpenWrt, and ASUS are interface placeholders with `read` set to `null`.
