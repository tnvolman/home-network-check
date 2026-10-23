'use strict';

class ParamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParamError';
    this.rpcCode = -32602;
  }
}

function optionalMbps(value, name) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000) {
    throw new ParamError(`${name} must be a positive number of Mbps up to 100000`);
  }
  return value;
}

function optionalEnum(value, name, allowed, fallback) {
  if (value == null || value === '') return fallback;
  if (!allowed.includes(value)) {
    throw new ParamError(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value;
}

function optionalInt(value, name, { min, max, fallback }) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ParamError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

module.exports = { ParamError, optionalMbps, optionalEnum, optionalInt };
