'use strict';

function parseSsdpMessage(text, rinfo) {
  const lines = String(text || '').split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!key || key.includes(' ')) continue;
    headers[key] = line.slice(idx + 1).trim();
  }
  return {
    server: headers.server || null,
    location: headers.location || null,
    st: headers.st || null,
    usn: headers.usn || null,
    address: rinfo && rinfo.address ? rinfo.address : null
  };
}

module.exports = { parseSsdpMessage };
