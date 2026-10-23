'use strict';

const { VERSION, SERVER_NAME } = require('./constants');

const INSTRUCTIONS = [
  'Home Network Check v0.1 looks at the user\'s own home network from this Mac.',
  'It is read-only and suggest-only. Do not ask for router passwords, API tokens, or admin logins. Do not change settings.',
  'If a tool returns error "unsupported OS", say so and stop. Collectors run on macOS only.',
  'Call discover, wifi_sample, and speed_test, then router_detect, then report.',
  'Lead the answer with the bottleneck, then the cheapest fix and its one-line reason, then the next options.',
  'speed_test sends measurement traffic off the LAN. Other tools stay on the local link.',
  'Unicast fetches and gateway pings run only when the address is inside that interface\'s own subnet. Only Wi-Fi and Ethernet hardware ports are guards. Virtual interfaces are not probe targets. Down interfaces are not pinged.'
].join(' ');

const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

function writeMessage(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } };
}

function render(tool, structured) {
  if (tool === 'report' && structured && structured.bottleneck && structured.cheapest_fix) {
    const lines = [
      `Bottleneck: ${structured.bottleneck.title}`,
      `Detail: ${structured.bottleneck.detail}`,
      `Cheapest fix: ${structured.cheapest_fix.action}`,
      `Reason: ${structured.cheapest_fix.reason}`,
      'Next options:'
    ];
    const options = structured.next_options || [];
    if (!options.length) lines.push('None.');
    options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.action}`);
      lines.push(`   Reason: ${option.reason}`);
    });
    lines.push('Suggest only. This check did not change any router setting.');
    return lines.join('\n');
  }
  return JSON.stringify(structured, null, 2);
}

function createServer(tools) {
  let ready = false;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return rpcError(message && message.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = message;
    const isNotification = id == null && !Object.prototype.hasOwnProperty.call(message, 'id');
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
    if (method === 'initialize') {
      ready = true;
      const requested = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions: INSTRUCTIONS
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (!ready && (method === 'tools/list' || method === 'tools/call')) {
      return rpcError(id, -32600, 'Server not initialized');
    }
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations
        }))
      });
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const tool = byName.get(name);
      if (!tool) return rpcError(id, -32602, 'Unknown tool');
      const args = params && params.arguments != null ? params.arguments : {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return rpcError(id, -32602, 'arguments must be an object');
      }
      try {
        const structured = await tool.handler(args);
        return rpcResult(id, {
          content: [{ type: 'text', text: render(name, structured) }],
          structuredContent: structured,
          isError: false
        });
      } catch (error) {
        if (error && error.rpcCode === -32602) return rpcError(id, -32602, error.message);
        process.stderr.write(`hnc: ${name} failed\n`);
        return rpcResult(id, {
          content: [{ type: 'text', text: 'The tool failed before it could finish.' }],
          isError: true
        });
      }
    }
    if (isNotification) return null;
    return rpcError(id, -32601, 'Method not found');
  }

  function start(input, output) {
    let buffer = Buffer.alloc(0);
    const onMessage = (message) => {
      Promise.resolve(handle(message)).then((response) => {
        if (response) writeMessage(output, response);
      }).catch(() => {
        writeMessage(output, rpcError(message && message.id, -32603, 'Internal error'));
      });
    };
    const drain = () => {
      while (buffer.length) {
        const head = buffer.slice(0, 20).toString('utf8').toLowerCase();
        if (head.startsWith('content-length')) {
          const split = buffer.indexOf('\r\n\r\n');
          if (split < 0) return;
          const header = buffer.slice(0, split).toString('utf8');
          const match = /content-length:\s*(\d+)/i.exec(header);
          if (!match) {
            buffer = buffer.slice(split + 4);
            continue;
          }
          const length = Number(match[1]);
          const startAt = split + 4;
          if (buffer.length < startAt + length) return;
          const body = buffer.slice(startAt, startAt + length).toString('utf8');
          buffer = buffer.slice(startAt + length);
          try { onMessage(JSON.parse(body)); } catch { writeMessage(output, rpcError(null, -32700, 'Parse error')); }
          continue;
        }
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        const line = buffer.slice(0, newline).toString('utf8').replace(/\r$/, '').trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { onMessage(JSON.parse(line)); } catch { writeMessage(output, rpcError(null, -32700, 'Parse error')); }
      }
    };
    input.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    });
    input.on('end', () => process.exit(0));
  }

  return { start, handle };
}

module.exports = { createServer, INSTRUCTIONS };
