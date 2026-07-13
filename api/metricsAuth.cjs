/* global module, process, Buffer, require */

const crypto = require('crypto');

function metricsRequestAuthorized(
  authorization,
  { token = process.env.METRICS_TOKEN || '', nodeEnv = process.env.NODE_ENV } = {},
) {
  if (!token) return nodeEnv !== 'production';
  const prefix = 'Bearer ';
  if (typeof authorization !== 'string' || !authorization.startsWith(prefix)) return false;
  const expected = Buffer.from(token);
  const received = Buffer.from(authorization.slice(prefix.length));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = { metricsRequestAuthorized };
