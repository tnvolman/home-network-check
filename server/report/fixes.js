'use strict';

function bufferbloatFix(vendor) {
  switch (vendor) {
    case 'eero':
      return {
        action: 'In the eero app, turn on Optimize for Conferencing and Gaming.',
        reason: 'Throughput meets the plan but responsiveness RPM is low, and that eero toggle is the free SQM-style control.'
      };
    case 'google-nest-wifi':
      return {
        action: 'Plug the latency-sensitive device into the Google/Nest Wifi puck with Ethernet.',
        reason: 'Throughput meets the plan but RPM is low, and Google/Nest Wifi has no local SQM switch.'
      };
    case 'netgear-orbi':
      return {
        action: 'In the Orbi web page or app, turn on QoS and set it just under the plan speeds.',
        reason: 'Throughput meets the plan but RPM is low, so the free Orbi QoS cap is the cheapest queue fix.'
      };
    case 'tp-link-deco':
      return {
        action: 'In the Deco app, turn on QoS and set it just under the plan speeds.',
        reason: 'Throughput meets the plan but RPM is low, and Deco exposes QoS only in its app.'
      };
    case 'asus-merlin':
      return {
        action: 'In the ASUS web UI, enable Adaptive QoS or Cake on Merlin and set it just under the plan.',
        reason: 'Throughput meets the plan but RPM is low, and that QoS control is already on the router.'
      };
    case 'unifi':
      return {
        action: 'In UniFi Network, enable Smart Queues on the WAN and set them just under the plan.',
        reason: 'Throughput meets the plan but RPM is low; Smart Queues are the free shaper and they do cap top speed.'
      };
    case 'openwrt':
      return {
        action: 'In LuCI, enable SQM with cake and set download and upload to about 90% of the plan.',
        reason: 'Throughput meets the plan but RPM is low, and cake SQM on OpenWrt is the free fix.'
      };
    default:
      return {
        action: "Turn on the router's SQM or QoS feature and set it just under the plan speeds.",
        reason: 'Throughput meets the plan but RPM is low, which points at a queue rather than a slow plan.'
      };
  }
}

module.exports = { bufferbloatFix };
