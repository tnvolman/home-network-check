'use strict';

function parseMdnsServiceTypes(text) {
  const found = new Set();
  const re = /(_[A-Za-z0-9-]+(?:\._[A-Za-z0-9-]+)*)\./g;
  let match;
  const body = String(text || '');
  while ((match = re.exec(body))) {
    const type = match[1].toLowerCase();
    if (type === '_services' || type.includes('_dns-sd') || type === '_udp' || type === '_tcp') continue;
    found.add(type);
  }
  return [...found].sort();
}

module.exports = { parseMdnsServiceTypes };
