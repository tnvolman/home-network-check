'use strict';

const { spawn } = require('child_process');

function runCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs == null ? 10000 : options.timeoutMs;
  const maxBytes = options.maxBytes == null ? 512 * 1024 : options.maxBytes;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { LANG: 'C', LC_ALL: 'C' }),
        windowsHide: true
      });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: String(error && error.message ? error.message : error),
        timedOut: false,
        spawnError: true
      });
      return;
    }

    const out = [];
    const err = [];
    let outLen = 0;
    let timedOut = false;
    let settled = false;
    let killTimer = null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8').slice(0, 2000),
        timedOut,
        spawnError: false
      });
    };

    const termTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 400);
      if (killTimer.unref) killTimer.unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outLen += chunk.length;
      if (outLen <= maxBytes) out.push(chunk);
      else if (!timedOut) {
        timedOut = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      if (err.length < 8) err.push(chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: String(error && error.message ? error.message : error),
        timedOut: false,
        spawnError: true
      });
    });
    child.on('close', (code) => finish(code));
  });
}

module.exports = { runCommand };
