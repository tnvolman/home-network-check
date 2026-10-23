'use strict';

const schemas = require('./schemas');
const { speedTest } = require('./tools/speed-test');
const { discover } = require('./tools/discover');
const { wifiSample } = require('./tools/wifi-sample');
const { routerDetect } = require('./tools/router-detect');
const { report } = require('./tools/report');

const tools = [
  Object.assign({}, schemas.speedTest, { handler: speedTest }),
  Object.assign({}, schemas.discover, { handler: discover }),
  Object.assign({}, schemas.wifiSample, { handler: wifiSample }),
  Object.assign({}, schemas.routerDetect, { handler: routerDetect }),
  Object.assign({}, schemas.report, { handler: report })
];

module.exports = { tools };
