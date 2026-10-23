'use strict';

const { VERSION } = require('./constants');

function unsupportedResult(platform = process.platform) {
  return {
    ok: false,
    error: 'unsupported OS',
    platform,
    version: VERSION,
    detail: 'Home Network Check v0.1 collects data on macOS only. No packets were sent.',
    suggest_only: true,
    read_only: true
  };
}

function isSupportedPlatform(platform = process.platform) {
  return platform === 'darwin';
}

module.exports = { unsupportedResult, isSupportedPlatform };
