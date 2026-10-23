'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('../../server/jsonrpc');
const { tools } = require('../../server/tools');
const { checkAsync } = require('./harness');
const { root } = require('./fixtures');

async function run() {
  await checkAsync('mcp initialize and tools/list handshake', async () => {
    const server = createServer(tools);
    const init = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prove', version: '0.1.0' } }
    });
    assert.strictEqual(init.result.serverInfo.name, 'home-network-check');
    assert.strictEqual(init.result.protocolVersion, '2024-11-05');
    const bad = await server.handle({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'wifi_sample', arguments: { samples: 0 } }
    });
    assert.strictEqual(bad.error.code, -32602);
    const child = spawn(process.execPath, [path.join(root, 'server/hnc-mcp.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { HNC_SKIP_NETWORK: '1' })
    });
    let buffer = '';
    const messages = [];
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) messages.push(JSON.parse(line));
      }
    });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const waitFor = (id) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for id ${id}`)), 4000);
      const poll = setInterval(() => {
        const found = messages.find((message) => message.id === id);
        if (!found) return;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(found);
      }, 15);
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prove', version: '0.1.0' } }
    });
    const initialized = await waitFor(1);
    assert.strictEqual(initialized.result.protocolVersion, '2025-03-26');
    assert.ok(initialized.result.capabilities.tools);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = await waitFor(2);
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepStrictEqual(names, ['speed_test', 'discover', 'wifi_sample', 'router_detect', 'report']);
    for (const tool of listed.result.tools) {
      assert.ok(tool.inputSchema && tool.inputSchema.type === 'object', tool.name);
      assert.ok(tool.outputSchema, tool.name);
      assert.strictEqual(tool.annotations.readOnlyHint, true);
    }
    try {
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'speed_test', arguments: {} } });
      const called = await waitFor(3);
      assert.strictEqual(called.result.isError, false);
      if (process.platform === 'darwin') {
        assert.strictEqual(called.result.structuredContent.skipped_network, true);
        assert.ok(!called.result.structuredContent.error);
      } else {
        assert.strictEqual(called.result.structuredContent.error, 'unsupported OS');
      }
    } finally {
      child.kill('SIGTERM');
    }
  });
}

module.exports = { run };
