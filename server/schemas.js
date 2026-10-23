'use strict';

const bool = { type: 'boolean' };
const str = { type: 'string' };
const num = { type: 'number' };
const stamp = {
  ok: bool,
  version: str,
  suggest_only: { type: 'boolean', enum: [true] },
  read_only: { type: 'boolean', enum: [true] },
  error: str,
  platform: str,
  detail: str
};

const errorShape = {
  type: 'object',
  required: ['ok', 'error', 'suggest_only', 'read_only'],
  properties: stamp
};

function toolOutput(properties, required) {
  return {
    oneOf: [
      errorShape,
      {
        type: 'object',
        required: required.concat(['ok', 'suggest_only', 'read_only']),
        properties: Object.assign({}, stamp, properties)
      }
    ]
  };
}

const interfaceChoice = { type: 'string', enum: ['wifi', 'ethernet', 'all'] };

const speedTest = {
  name: 'speed_test',
  description: 'Read-only macOS speed and latency check on this computer. Runs networkQuality -I <iface> -c, maps Wi-Fi and Ethernet with networksetup, skips a down interface, and pings the gateway only when that gateway is inside the local subnet. Compares throughput with optional plan speeds. Sends speed-test traffic off the LAN. Does not change settings.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      interface: interfaceChoice,
      plan_down_mbps: num,
      plan_up_mbps: num
    }
  },
  outputSchema: toolOutput({
    interface_choice: str,
    interfaces: { type: 'array' }
  }, ['interfaces'])
};

const discover = {
  name: 'discover',
  description: 'Read-only inventory of this Mac\'s own subnet. Reads the default route, interface prefixes, and ARP table, browses mDNS service types with dns-sd for a few seconds, and sends one SSDP M-SEARCH. Fetches UPnP description XML only from literal addresses that pass isInLocalSubnet. Does not sweep the subnet, does not log in, and does not change settings.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', properties: {} },
  outputSchema: toolOutput({
    gateway: { type: 'object' },
    host: { type: 'object' },
    arp: { type: 'array' },
    mdns: { type: 'object' },
    ssdp: { type: 'array' },
    upnp: { type: 'array' },
    devices: { type: 'array' },
    probes: { type: 'array' },
    skipped_probes: { type: 'array' }
  }, ['gateway', 'probes', 'skipped_probes'])
};

const wifiSample = {
  name: 'wifi_sample',
  description: 'Read-only Wi-Fi samples on macOS using system_profiler SPAirPortDataType -json and ipconfig getsummary. The airport command is not used. Reports SSID, channel, band, RSSI, noise, SNR, and tx rate. A redacted BSSID is reported as unknown rather than as a roam. Flags roaming, band changes, and weak signal (RSSI below -70 dBm or SNR below 20 dB). Groups BSSIDs only to estimate mesh nodes. Backhaul is unknown/inferred. Does not change settings.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      samples: { type: 'integer', minimum: 1, maximum: 30, default: 6 },
      interval_s: { type: 'integer', minimum: 1, maximum: 60, default: 10 }
    }
  },
  outputSchema: toolOutput({
    samples_requested: num,
    interval_s: num,
    samples: { type: 'array' },
    findings: { type: 'object' },
    note: str
  }, ['samples', 'findings'])
};

const routerDetect = {
  name: 'router_detect',
  description: 'Detect-only identification of the gateway vendor on this subnet: eero, Google/Nest Wifi, NETGEAR Orbi, TP-Link Deco, ASUS/Merlin, UniFi, or OpenWrt. Uses discovery evidence and safe GETs of the gateway\'s own web root and a short allowlist of known paths. No login, no credentials, no writes. local_api is documented, unofficial, or none (app/cloud only). v0.2 read adapters for UniFi, OpenWrt, and ASUS plug into the same adapter interface and are not called.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', properties: {} },
  outputSchema: toolOutput({
    vendor: str,
    label: str,
    confidence: str,
    evidence: { type: 'array' },
    local_api: { type: ['string', 'null'] },
    adjustable_settings: { type: 'array' },
    how_to_change: str,
    read_adapter: { type: ['string', 'null'] },
    gateway_ip: { type: ['string', 'null'] },
    fingerprint_paths: { type: 'array' },
    skipped_probes: { type: 'array' }
  }, ['vendor', 'confidence', 'evidence', 'adjustable_settings', 'how_to_change'])
};

const report = {
  name: 'report',
  description: 'Deterministic, suggest-only home-network report. Runs the other checks when their results are not passed in collected, or judges the results you pass. Outputs the bottleneck first, then the cheapest fix with a one-line reason, then the next options. Does not change settings and does not ask for credentials.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      interface: interfaceChoice,
      plan_down_mbps: num,
      plan_up_mbps: num,
      collected: {
        type: 'object',
        description: 'Optional results from speed_test, discover, wifi_sample, and router_detect. Sections present here are not run again.',
        properties: {
          speed_test: { type: 'object' },
          discover: { type: 'object' },
          wifi_sample: { type: 'object' },
          router_detect: { type: 'object' }
        }
      }
    }
  },
  outputSchema: toolOutput({
    bottleneck: { type: 'object' },
    cheapest_fix: { type: 'object' },
    next_options: { type: 'array' },
    rule_id: str
  }, ['bottleneck', 'cheapest_fix', 'next_options', 'rule_id'])
};

module.exports = { speedTest, discover, wifiSample, routerDetect, report };
