'use strict';

const http = require('http');
const https = require('https');
const { USER_AGENT } = require('../constants');
const { evaluateTarget } = require('../subnet');

function pickHeaders(headers) {
  const out = {};
  for (const name of ['server', 'x-powered-by', 'www-authenticate']) {
    if (headers && headers[name]) out[name] = String(headers[name]).slice(0, 180);
  }
  return out;
}

function requestOnce(target, { timeoutMs, maxBytes }) {
  const lib = target.https ? https : http;
  return new Promise((resolve) => {
    const req = lib.request({
      host: target.ip,
      port: target.port,
      method: 'GET',
      path: target.path || '/',
      timeout: timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xml,text/xml,*/*;q=0.1',
        Connection: 'close'
      }
    }, (res) => {
      const chunks = [];
      let len = 0;
      res.on('data', (chunk) => {
        len += chunk.length;
        if (len <= maxBytes) chunks.push(chunk);
        else res.destroy();
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || null,
          headers: pickHeaders(res.headers),
          body: Buffer.concat(chunks).toString('utf8'),
          location: res.headers.location ? String(res.headers.location) : null
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => {
      resolve({
        ok: false,
        status: null,
        headers: {},
        body: '',
        location: null,
        error: String(error && error.message ? error.message : error)
      });
    });
    req.end();
  });
}

// GET only. TLS certificates are verified. Redirects stay on the same literal IP.
async function safeGet(location, interfaces, options = {}) {
  const timeoutMs = options.timeoutMs == null ? 2500 : options.timeoutMs;
  const maxBytes = options.maxBytes == null ? 32768 : options.maxBytes;
  const target = evaluateTarget(location, interfaces);
  if (!target.ok) return { ok: false, refused: true, reason: target.reason, target: location };

  let current = target;
  let hops = 0;
  let response = null;
  while (hops < 3) {
    response = await requestOnce(current, { timeoutMs, maxBytes });
    response.ip = current.ip;
    response.port = current.port;
    const redirect = [301, 302, 303, 307, 308].includes(response.status) && response.location;
    if (!redirect) return response;
    const next = evaluateTarget(response.location, interfaces);
    if (!next.ok || next.ip !== current.ip) {
      return Object.assign(response, {
        redirect_blocked: next.ok ? 'redirect left the gateway address' : next.reason,
        body: ''
      });
    }
    current = next;
    hops += 1;
  }
  return response;
}

module.exports = { safeGet };
