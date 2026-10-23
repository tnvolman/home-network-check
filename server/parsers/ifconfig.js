'use strict';

function hexMaskToDotted(hex) {
  const n = Number(hex);
  if (!Number.isFinite(n)) return null;
  const value = n >>> 0;
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function parseIfconfig(text) {
  const ifaces = [];
  let current = null;
  for (const line of String(text || '').split(/\n/)) {
    const head = /^([a-z][a-z0-9]{0,15}):\s+flags=\d+<([^>]*)>/i.exec(line);
    if (head) {
      current = {
        device: head[1],
        flags: head[2].split(',').map((f) => f.trim()).filter(Boolean),
        addresses: [],
        status: null
      };
      ifaces.push(current);
      continue;
    }
    if (!current) continue;
    const inet = /^\s+inet (\d+\.\d+\.\d+\.\d+) netmask (0x[0-9a-fA-F]+)/.exec(line);
    if (inet) {
      current.addresses.push({
        address: inet[1],
        netmask: hexMaskToDotted(inet[2]),
        family: 'inet'
      });
    }
    const status = /^\s+status:\s+(\S+)/.exec(line);
    if (status) current.status = status[1].toLowerCase();
  }
  return ifaces;
}

function interfaceIsUp(iface) {
  if (!iface) return false;
  if (iface.device === 'lo0') return false;
  if (iface.status === 'inactive') return false;
  const flags = iface.flags || [];
  if (!flags.includes('UP') || !flags.includes('RUNNING')) return false;
  return (iface.addresses || []).some((a) => a.family === 'inet' && a.address && a.netmask);
}

function hostSubnets(ifaces) {
  const subnets = [];
  for (const iface of ifaces || []) {
    if (iface.device === 'lo0') continue;
    for (const addr of iface.addresses || []) {
      if (addr.family !== 'inet' || !addr.address || !addr.netmask) continue;
      subnets.push({
        device: iface.device,
        address: addr.address,
        netmask: addr.netmask,
        up: interfaceIsUp(iface)
      });
    }
  }
  return subnets;
}

module.exports = { parseIfconfig, hexMaskToDotted, interfaceIsUp, hostSubnets };
