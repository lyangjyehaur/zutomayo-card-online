import fs from 'node:fs';
import net from 'node:net';

export const MIN_SECRET_BYTES = 32;

export interface RuntimeEnvironment {
  NODE_ENV?: string;
  JWT_SECRET?: string;
  PLATFORM_SEAT_TOKEN_SECRET?: string;
  REDIS_URL?: string;
  REDIS_USERNAME?: string;
  REDIS_PASSWORD?: string;
  PGSSLMODE?: string;
  PGSSLROOTCERT?: string;
  PG_SSLROOTCERT?: string;
  NODE_EXTRA_CA_CERTS?: string;
  NODE_TLS_REJECT_UNAUTHORIZED?: string;
  [key: string]: string | undefined;
}

export interface RedisConnectionConfig {
  url: string;
  tls: boolean;
  authenticated: boolean;
}

export type PostgresSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

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

function isProduction(env: RuntimeEnvironment): boolean {
  return env.NODE_ENV === 'production';
}

export function shouldUpgradeInsecureRequests(env: RuntimeEnvironment = process.env): boolean {
  return isProduction(env);
}

function isLocalRedisHost(hostname: string): boolean {
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

export function secretByteLength(value: unknown): number {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

export function requireSecret(name: string, value: unknown, options: { minBytes?: number } = {}): string {
  const minBytes = options.minBytes ?? MIN_SECRET_BYTES;
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) throw new Error(`${name} is required`);
  if (secretByteLength(secret) < minBytes) {
    throw new Error(`${name} must be at least ${minBytes} bytes`);
  }
  return secret;
}

export function secretEntropyBits(value: unknown): number {
  const secret = typeof value === 'string' ? value : '';
  if (!secret) return 0;
  const counts = new Map<string, number>();
  for (const character of secret) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropyPerCharacter = 0;
  for (const count of counts.values()) {
    const probability = count / secret.length;
    entropyPerCharacter -= probability * Math.log2(probability);
  }
  return entropyPerCharacter * secret.length;
}

export function requireStrongSecret(
  name: string,
  value: unknown,
  options: { minBytes?: number; minEntropyBits?: number } = {},
): string {
  const secret = requireSecret(name, value, options);
  const minEntropyBits = options.minEntropyBits ?? 128;
  if (secretEntropyBits(secret) < minEntropyBits) {
    throw new Error(`${name} must have at least ${minEntropyBits} bits of estimated entropy`);
  }
  return secret;
}

function parseRedisUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('REDIS_URL must be an absolute redis:// or rediss:// URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  if (!parsed.hostname) throw new Error('REDIS_URL must include a hostname');
  return parsed;
}

export function resolveRedisConnectionConfig(env: RuntimeEnvironment = process.env): RedisConnectionConfig {
  const production = isProduction(env);
  const rawUrl = String(env.REDIS_URL || '').trim();
  if (!rawUrl) {
    if (production) throw new Error('REDIS_URL is required in production');
    return { url: 'redis://localhost:6379', tls: false, authenticated: false };
  }

  const parsed = parseRedisUrl(rawUrl);
  if (production && isLocalRedisHost(parsed.hostname)) {
    throw new Error('production REDIS_URL must not point to localhost');
  }
  // Consumers receive only the URL, so credentials must be embedded in it.
  // Treating a separate REDIS_PASSWORD as authenticated would let startup pass
  // while ioredis still connects without AUTH.
  const authenticated = Boolean(parsed.password);
  if (production && parsed.protocol !== 'rediss:') {
    throw new Error('production REDIS_URL must use rediss:// (TLS)');
  }
  if (production) {
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'tls' && value.trim().toLowerCase() !== 'true') {
        throw new Error('production REDIS_URL cannot disable TLS');
      }
      if (normalizedKey === 'username' || normalizedKey === 'password') {
        throw new Error('production REDIS_URL credentials must be in the URL authority');
      }
    }
    // ioredis accepts URL query options that can override the rediss scheme.
    // Strip benign query options and apply DB/TLS through explicit options.
    parsed.search = '';
    parsed.hash = '';
  }
  if (production && !authenticated) {
    throw new Error('production Redis requires a password in REDIS_URL');
  }
  return { url: production ? parsed.toString() : rawUrl, tls: parsed.protocol === 'rediss:', authenticated };
}

function normalizeSslMode(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function postgresSslConfig(env: RuntimeEnvironment = process.env): PostgresSslConfig {
  postgresConnectionString(env);
  const mode = normalizeSslMode(env.PGSSLMODE);
  if (!isProduction(env) && (!mode || mode === 'disable')) return false;
  if (!mode || mode === 'disable' || mode === 'allow' || mode === 'prefer') {
    if (isProduction(env)) throw new Error('PGSSLMODE must be verify-full in production');
    return false;
  }
  if (!['verify-full', 'verify-ca', 'require'].includes(mode)) {
    throw new Error(`unsupported PGSSLMODE: ${mode}`);
  }
  const caPath = String(env.PG_SSLROOTCERT || env.PGSSLROOTCERT || env.NODE_EXTRA_CA_CERTS || '').trim();
  if (caPath && !fs.existsSync(caPath)) {
    throw new Error(`PostgreSQL CA file does not exist: ${caPath}`);
  }
  // `require` encrypts the connection but does not verify the server. Keep it
  // available for explicitly configured non-production environments only.
  if (isProduction(env) && mode !== 'verify-full') {
    throw new Error('production PostgreSQL requires hostname verification (PGSSLMODE=verify-full)');
  }
  return { rejectUnauthorized: true, ...(caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : {}) };
}

/**
 * Return a PostgreSQL URL that cannot override the explicit `pg` ssl object.
 * node-postgres lets URL ssl query parameters replace `Pool({ ssl })`, so a
 * production URL carrying `sslmode=disable` would otherwise bypass the gate.
 */
export function postgresConnectionString(env: RuntimeEnvironment = process.env): string | undefined {
  const raw = env.DATABASE_URL?.trim();
  if (!raw || !isProduction(env)) return raw || undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key.toLowerCase() === 'ssl') {
      if (!['true', '1'].includes(value.trim().toLowerCase())) {
        throw new Error('production DATABASE_URL ssl must not disable verification');
      }
      continue;
    }
    if (key.toLowerCase() !== 'sslmode') continue;
    const mode = value.trim().toLowerCase();
    if (mode !== 'verify-full') {
      throw new Error('production DATABASE_URL sslmode must be verify-full');
    }
  }
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (POSTGRES_SSL_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

export function validateProductionRuntimeSecurity(env: RuntimeEnvironment = process.env): true {
  if (!isProduction(env)) return true;
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED || '').trim() === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden in production');
  }
  const jwtSecret = requireStrongSecret('JWT_SECRET', env.JWT_SECRET);
  const seatSecret = env.PLATFORM_SEAT_TOKEN_SECRET || env.JWT_SECRET;
  const validatedSeatSecret = requireStrongSecret('PLATFORM_SEAT_TOKEN_SECRET or JWT_SECRET', seatSecret);
  if (env.PLATFORM_SEAT_TOKEN_SECRET && validatedSeatSecret === jwtSecret) {
    throw new Error('PLATFORM_SEAT_TOKEN_SECRET must be distinct from JWT_SECRET');
  }
  resolveRedisConnectionConfig(env);
  postgresSslConfig(env);
  return true;
}
