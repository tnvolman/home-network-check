#!/usr/bin/env node
'use strict';

require('./prove/subnet');
require('./prove/parsers');
require('./prove/wifi');
require('./prove/vendors');
require('./prove/report');
require('./prove/hygiene');

const speed = require('./prove/tools-speed');
const discoverChecks = require('./prove/tools-discover');
const rest = require('./prove/tools-rest');
const mcp = require('./prove/mcp');
const { finish } = require('./prove/harness');

async function main() {
  await speed.run();
  await discoverChecks.run();
  await rest.run();
  await mcp.run();
  finish();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
