---
name: home-network-check
description: Read-only check of the user's own home network from the Mac they are using. Use when they ask why Wi-Fi is slow, whether bufferbloat is the problem, what is on their LAN, or which router setting to change. macOS only. Suggest settings; never log in or change them.
---

# Home Network Check

Run this on the user's own Mac. The MCP server is `home-network-check`. If a tool returns `unsupported OS`, say so and stop.

## Order

1. `discover` — each Wi-Fi and Ethernet hardware port's gateway and subnet, ARP, mDNS service types, SSDP, in-subnet UPnP. Virtual interfaces (ZeroTier, OpenVPN, utun) are not subnets.
2. `wifi_sample` — default 6 samples, 10 seconds apart. A redacted BSSID means roaming is unknown.
3. `speed_test` — pass `plan_down_mbps` and `plan_up_mbps` when the user knows them. `all` includes Wi-Fi. Skip a down interface and do not ping it. This is the only tool that sends traffic off the LAN.
4. `router_detect` — vendor guess only. Do not ask for a password.
5. `report` — pass the results in `collected` plus the plan speeds.

## How to answer

Lead with the report's bottleneck, then the cheapest fix and its one-line reason, then the next options. Repeat that the tool did not change anything.

When Ethernet and Wi-Fi are on different private subnets, one behind a mesh and one behind an ISP gateway, say `double NAT or split networks` and suggest bridge/passthrough mode or plugging the computer into the mesh. Rank bufferbloat by interface: a low Wi-Fi RPM against a higher Ethernet RPM means the Wi-Fi path is the queue.

Backhaul is `unknown/inferred` in v0.1. Do not claim a mesh hop is wired or wireless.

Do not invent a vendor when `vendor` is `unknown`. Do not suggest buying hardware when the cheapest fix is a move, a cable, or a free setting.
