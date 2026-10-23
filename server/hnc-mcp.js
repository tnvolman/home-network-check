#!/usr/bin/env node
'use strict';

const { createServer } = require('./jsonrpc');
const { tools } = require('./tools');

const major = Number(String(process.versions.node).split('.')[0]);
if (!Number.isInteger(major) || major < 20) {
  process.stderr.write('home-network-check requires Node.js >= 20\n');
  process.exit(1);
}

if (require.main === module) {
  createServer(tools).start(process.stdin, process.stdout);
}

module.exports = { tools };
