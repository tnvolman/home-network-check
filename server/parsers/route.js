'use strict';

function parseDefaultRoute(text) {
  const body = String(text || '');
  const gateway = /^\s*gateway:\s*(\S+)/m.exec(body);
  const iface = /^\s*interface:\s*(\S+)/m.exec(body);
  return {
    gateway: gateway ? gateway[1] : null,
    interface: iface ? iface[1] : null
  };
}

module.exports = { parseDefaultRoute };
