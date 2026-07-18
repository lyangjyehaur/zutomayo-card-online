'use strict';

const MAX_RATE_LIMIT = 1_000_000;

function positiveInteger(env, name, fallback) {
  const raw = String(env[name] ?? '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RATE_LIMIT) {
    throw new Error(`${name} must be between 1 and ${MAX_RATE_LIMIT}`);
  }
  return value;
}

function apiRateLimitConfig(env = process.env) {
  return Object.freeze({
    windowMs: 60_000,
    auth: positiveInteger(env, 'RATE_LIMIT_AUTH', 10),
    default: positiveInteger(env, 'RATE_LIMIT_DEFAULT', 120),
    imgproxy: positiveInteger(env, 'RATE_LIMIT_IMGPROXY', 600),
    upload: positiveInteger(env, 'RATE_LIMIT_UPLOAD', 10),
  });
}

module.exports = { MAX_RATE_LIMIT, apiRateLimitConfig };
