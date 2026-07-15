/* global module */

const fs = require('node:fs');
const net = require('node:net');

const MIN_SECRET_BYTES = 32;
const POSTGRES_SSL_QUERY_KEYS = new Set([
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslpassword',
  'sslnegotiation',
  'uselibpqcompat',
]);

function secretByteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

function requireSecret(name, value, { minBytes = MIN_SECRET_BYTES } = {}) {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) throw new Error(`${name} is required`);
  if (secretByteLength(secret) < minBytes) throw new Error(`${name} must be at least ${minBytes} bytes`);
  return secret;
}

function secretEntropyBits(value) {
  const secret = typeof value === 'string' ? value : '';
  if (!secret) return 0;
  const counts = new Map();
  for (const character of secret) counts.set(character, (counts.get(character) || 0) + 1);
  let entropyPerCharacter = 0;
  for (const count of counts.values()) {
    const probability = count / secret.length;
    entropyPerCharacter -= probability * Math.log2(probability);
  }
  return entropyPerCharacter * secret.length;
}

function requireStrongSecret(name, value, { minBytes = MIN_SECRET_BYTES, minEntropyBits = 128 } = {}) {
  const secret = requireSecret(name, value, { minBytes });
  if (secretEntropyBits(secret) < minEntropyBits) {
    throw new Error(`${name} must have at least ${minEntropyBits} bits of estimated entropy`);
  }
  return secret;
}

function production(env) {
  return env.NODE_ENV === 'production';
}

function isLocalRedisHost(hostname) {
  const rawHost = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  let host = rawHost;
  try {
    const parsed = new URL(`http://${rawHost.includes(':') ? `[${rawHost}]` : rawHost}`);
    host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    // Keep the raw host for a conservative literal check below.
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  )
    return true;
  return net.isIP(host) === 6 && (host.startsWith('::ffff:127.') || host.startsWith('::ffff:7f'));
}

function resolveRedisConnectionConfig(env = process.env) {
  const isProduction = production(env);
  const rawUrl = String(env.REDIS_URL || '').trim();
  if (!rawUrl) {
    if (isProduction) throw new Error('REDIS_URL is required in production');
    return { url: 'redis://localhost:6379', tls: false, authenticated: false };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('REDIS_URL must be an absolute redis:// or rediss:// URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isProduction && isLocalRedisHost(hostname)) {
    throw new Error('production REDIS_URL must not point to localhost');
  }
  // Consumers receive only the URL, so credentials must be embedded in it.
  // A standalone REDIS_PASSWORD would otherwise pass validation without ever
  // being sent by ioredis.
  const authenticated = Boolean(parsed.password);
  if (isProduction && parsed.protocol !== 'rediss:') {
    throw new Error('production REDIS_URL must use rediss:// (TLS)');
  }
  if (isProduction) {
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'tls' && String(value).trim().toLowerCase() !== 'true') {
        throw new Error('production REDIS_URL cannot disable TLS');
      }
      if (normalizedKey === 'username' || normalizedKey === 'password') {
        throw new Error('production REDIS_URL credentials must be in the URL authority');
      }
    }
    parsed.search = '';
    parsed.hash = '';
  }
  if (isProduction && !authenticated) {
    throw new Error('production Redis requires a password in REDIS_URL');
  }
  return { url: isProduction ? parsed.toString() : rawUrl, tls: parsed.protocol === 'rediss:', authenticated };
}

function postgresSslConfig(env = process.env) {
  postgresConnectionString(env);
  const mode = String(env.PGSSLMODE || '')
    .trim()
    .toLowerCase();
  if (!production(env) && (!mode || mode === 'disable')) return false;
  if (!mode || mode === 'disable' || mode === 'allow' || mode === 'prefer') {
    if (production(env)) throw new Error('PGSSLMODE must be verify-full in production');
    return false;
  }
  if (!['verify-full', 'verify-ca', 'require'].includes(mode)) throw new Error(`unsupported PGSSLMODE: ${mode}`);
  const caPath = String(env.PG_SSLROOTCERT || env.PGSSLROOTCERT || env.NODE_EXTRA_CA_CERTS || '').trim();
  if (caPath && !fs.existsSync(caPath)) throw new Error(`PostgreSQL CA file does not exist: ${caPath}`);
  if (production(env) && mode !== 'verify-full') {
    throw new Error('production PostgreSQL requires hostname verification (PGSSLMODE=verify-full)');
  }
  return { rejectUnauthorized: true, ...(caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : {}) };
}

function postgresConnectionString(env = process.env) {
  const raw = String(env.DATABASE_URL || '').trim();
  if (!raw || !production(env)) return raw || undefined;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key.toLowerCase() === 'ssl') {
      if (!['true', '1'].includes(String(value).trim().toLowerCase())) {
        throw new Error('production DATABASE_URL ssl must not disable verification');
      }
      continue;
    }
    if (key.toLowerCase() !== 'sslmode') continue;
    const mode = String(value).trim().toLowerCase();
    if (mode !== 'verify-full') {
      throw new Error('production DATABASE_URL sslmode must be verify-full');
    }
  }
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (POSTGRES_SSL_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function postgresUrlUsername(connectionString) {
  if (!connectionString) return '';
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  try {
    return decodeURIComponent(parsed.username || '').trim();
  } catch {
    throw new Error('DATABASE_URL username must use valid percent encoding');
  }
}

function assertPostgresExpectedRole(env = process.env, expectedRoleVariable) {
  const variable = String(expectedRoleVariable || '').trim();
  if (!/^PG_[A-Z0-9_]+_USER$/.test(variable)) throw new Error('expected PostgreSQL role variable is invalid');
  const expectedRole = String(env[variable] || '').trim();
  if (!expectedRole) {
    if (production(env)) throw new Error(`${variable} is required in production`);
    return '';
  }

  const pgUser = String(env.PG_USER || '').trim();
  if (pgUser && pgUser !== expectedRole) {
    throw new Error(`PG_USER must match ${variable}`);
  }

  const connectionString = postgresConnectionString(env);
  if (connectionString) {
    const urlUser = postgresUrlUsername(connectionString);
    if (!urlUser) throw new Error(`DATABASE_URL username must match ${variable}`);
    if (urlUser !== expectedRole) throw new Error(`DATABASE_URL username must match ${variable}`);
  } else if (production(env) && !pgUser) {
    throw new Error(`PG_USER must match ${variable} in production`);
  }
  return expectedRole;
}

function resolveOAuthPublicBaseUrl(env = process.env) {
  const raw = String(env.OAUTH_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '').trim();
  if (!raw) {
    if (production(env)) throw new Error('OAUTH_PUBLIC_BASE_URL or PUBLIC_BASE_URL is required in production');
    return '';
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('OAuth public base URL must be an absolute URL');
  }
  if (production(env) && parsed.protocol !== 'https:') {
    throw new Error('production OAuth public base URL must use HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('OAuth public base URL must not include credentials, query, or fragment');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path) throw new Error('OAuth public base URL must be an origin without a path');
  return parsed.origin;
}

function validateProductionRuntimeSecurity(env = process.env) {
  if (!production(env)) return true;
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED || '').trim() === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden in production');
  }
  requireStrongSecret('JWT_SECRET', env.JWT_SECRET);
  requireStrongSecret('PLATFORM_SEAT_TOKEN_SECRET or JWT_SECRET', env.PLATFORM_SEAT_TOKEN_SECRET || env.JWT_SECRET);
  resolveRedisConnectionConfig(env);
  postgresSslConfig(env);
  resolveOAuthPublicBaseUrl(env);
  return true;
}

module.exports = {
  MIN_SECRET_BYTES,
  secretByteLength,
  secretEntropyBits,
  requireSecret,
  requireStrongSecret,
  resolveRedisConnectionConfig,
  postgresSslConfig,
  postgresConnectionString,
  assertPostgresExpectedRole,
  resolveOAuthPublicBaseUrl,
  validateProductionRuntimeSecurity,
};
