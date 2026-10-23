'use strict';

module.exports = {
  VERSION: '0.1.0',
  SERVER_NAME: 'home-network-check',
  USER_AGENT: 'home-network-check/0.1 (local read-only)',
  // Home subnets this version will consider. Wider or non-contiguous masks are ignored.
  MIN_PREFIX: 8,
  MAX_PREFIX: 30
};
