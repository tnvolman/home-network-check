'use strict';

const dgram = require('dgram');
const { parseSsdpMessage } = require('../parsers/ssdp');

const SEARCH = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\n' +
  'HOST: 239.255.255.250:1900\r\n' +
  'MAN: "ssdp:discover"\r\n' +
  'MX: 1\r\n' +
  'ST: ssdp:all\r\n' +
  '\r\n'
);

// One link-local multicast query. Callers decide which responders may be fetched.
function ssdpSearch(options = {}) {
  const timeoutMs = options.timeoutMs == null ? 2500 : options.timeoutMs;
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];
    const seen = new Set();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* already closed */ }
      resolve(found);
    };
    socket.on('error', () => finish());
    socket.on('message', (msg, rinfo) => {
      const parsed = parseSsdpMessage(msg.toString('utf8'), rinfo);
      const key = `${parsed.usn || ''}|${parsed.location || ''}|${parsed.address || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push(parsed);
    });
    socket.bind(0, () => {
      try {
        socket.send(SEARCH, 0, SEARCH.length, 1900, '239.255.255.250', (error) => {
          if (error) finish();
        });
      } catch {
        finish();
      }
    });
    setTimeout(finish, timeoutMs);
  });
}

module.exports = { ssdpSearch };
