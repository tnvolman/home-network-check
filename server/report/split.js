'use strict';

const { isTunnelDevice, isProbeable } = require('../subnet');

const MESH_VENDORS = ['eero', 'google-nest-wifi', 'netgear-orbi', 'tp-link-deco'];

function subnetDevice(ip, interfaces) {
  for (const iface of interfaces || []) {
    if (!iface || isTunnelDevice(iface.device)) continue;
    if (isProbeable(ip, [iface])) return iface.device || null;
  }
  return null;
}

function findSplitNetwork(ctx) {
  const list = ctx && ctx.router && Array.isArray(ctx.router.gateways) ? ctx.router.gateways : [];
  const mesh = list.find((item) => item && MESH_VENDORS.includes(item.vendor));
  const isp = list.find((item) => item && item.vendor === 'isp-openwrt');
  if (!mesh || !isp || !mesh.ip || !isp.ip || mesh.ip === isp.ip) return null;
  const interfaces = ctx.discover && ctx.discover.host && ctx.discover.host.interfaces;
  const meshDevice = subnetDevice(mesh.ip, interfaces);
  const ispDevice = subnetDevice(isp.ip, interfaces);
  if (!meshDevice || !ispDevice || meshDevice === ispDevice) return null;
  return { mesh, isp };
}

function splitNetworkFix(split) {
  const meshName = split.mesh.vendor === 'eero' ? 'the eero' : (split.mesh.label || 'the mesh');
  return {
    action: `Put the ISP gateway in bridge/passthrough mode, or plug the Mini into ${meshName}.`,
    reason: 'Ethernet and Wi-Fi are on different private subnets whose routers are a mesh and an ISP gateway (double NAT or split networks).'
  };
}

module.exports = { findSplitNetwork, splitNetworkFix, MESH_VENDORS };
