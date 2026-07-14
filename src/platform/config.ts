import {
  resolveRedisConnectionConfig,
  type RedisConnectionConfig,
  type RuntimeEnvironment,
} from '../runtimeSecurityConfig';

export type PlatformRedisMode = 'memory' | 'redis';

export interface PlatformRedisRoleConnections {
  /** Shared application Redis used for auth, admission, and relationship events. */
  shared: RedisConnectionConfig;
  /** Isolated Colyseus room discovery, presence, and driver Redis. */
  colyseus: RedisConnectionConfig;
}

export interface PlatformRedisPingClient {
  ping: () => Promise<unknown>;
}

export interface PlatformRedisHealthCheck {
  name: 'redis-shared' | 'redis-colyseus';
  promise: Promise<unknown>;
}

export interface PlatformPublicAddress {
  /** Canonical operator-facing absolute WebSocket URL. */
  url: string;
  /**
   * Colyseus 0.16 browser clients prepend ws:// or wss:// themselves, so the
   * server reservation must advertise only the authority and optional base path.
   */
  colyseusAddress: string;
}

const DEFAULT_PLATFORM_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const DEFAULT_PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS = ['colyseus-redis'];

function normalizeRedisHostname(hostname: string): string {
  return hostname
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isInternalRedisHostname(hostname: string): boolean {
  const normalized = normalizeRedisHostname(hostname);
  const dnsLabel = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  if (new RegExp(`^${dnsLabel}$`).test(normalized)) return true;
  return (
    new RegExp(`^(?:${dnsLabel}\\.)+internal$`).test(normalized) ||
    new RegExp(`^(?:${dnsLabel}\\.)+svc(?:\\.cluster\\.local)?$`).test(normalized)
  );
}

function resolvePlatformColyseusRedisInternalHosts(value: string | undefined): Set<string> {
  const configured = value?.split(',').map(normalizeRedisHostname).filter(Boolean) ?? [];
  const hosts = configured.length > 0 ? configured : DEFAULT_PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS;
  const invalid = hosts.find((hostname) => !isInternalRedisHostname(hostname));
  if (invalid) {
    throw new Error(
      `PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS may contain only internal DNS hostnames; received ${invalid}`,
    );
  }
  return new Set(hosts);
}

function parsePlatformColyseusRedisUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('PLATFORM_COLYSEUS_REDIS_URL must be an absolute redis:// or rediss:// URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('PLATFORM_COLYSEUS_REDIS_URL must use redis:// or rediss://');
  }
  if (!parsed.hostname) throw new Error('PLATFORM_COLYSEUS_REDIS_URL must include a hostname');
  return parsed;
}

function redisServerIdentity(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  // ioredis uses 6379 for both redis:// and rediss:// when the URI omits a
  // port. Keep the isolation comparison aligned with the actual client.
  const port = parsed.port || '6379';
  return `${normalizeRedisHostname(parsed.hostname)}:${port}`;
}

export function resolvePlatformColyseusRedisConnectionConfig(
  env: RuntimeEnvironment = process.env,
  fallbackConnection?: RedisConnectionConfig,
): RedisConnectionConfig {
  const rawUrl = String(env.PLATFORM_COLYSEUS_REDIS_URL || '').trim();
  const isolationSetting = String(env.PLATFORM_REQUIRE_ISOLATED_REDIS || '')
    .trim()
    .toLowerCase();
  if (isolationSetting && isolationSetting !== 'true' && isolationSetting !== 'false') {
    throw new Error('PLATFORM_REQUIRE_ISOLATED_REDIS must be either true or false');
  }
  if (!rawUrl) {
    if (isolationSetting === 'true') {
      throw new Error('PLATFORM_COLYSEUS_REDIS_URL is required when PLATFORM_REQUIRE_ISOLATED_REDIS=true');
    }
    return fallbackConnection ?? resolveRedisConnectionConfig(env);
  }

  const parsed = parsePlatformColyseusRedisUrl(rawUrl);
  if (!parsed.password) {
    throw new Error('PLATFORM_COLYSEUS_REDIS_URL requires a password in the URL authority');
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'tls' && value.trim().toLowerCase() !== 'true') {
      throw new Error('PLATFORM_COLYSEUS_REDIS_URL cannot disable TLS');
    }
    if (normalizedKey === 'username' || normalizedKey === 'password') {
      throw new Error('PLATFORM_COLYSEUS_REDIS_URL credentials must be in the URL authority');
    }
    if (normalizedKey !== 'tls') {
      throw new Error(`PLATFORM_COLYSEUS_REDIS_URL contains unsupported query option: ${key}`);
    }
  }

  if (parsed.protocol === 'redis:') {
    const internalHosts = resolvePlatformColyseusRedisInternalHosts(env.PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS);
    const hostname = normalizeRedisHostname(parsed.hostname);
    if (!internalHosts.has(hostname)) {
      throw new Error(
        'plaintext PLATFORM_COLYSEUS_REDIS_URL must target a hostname explicitly allowed by PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS',
      );
    }
  }

  // Apply TLS explicitly in ioredis health clients and prevent URL query
  // options from weakening the scheme used by Colyseus Redis adapters.
  parsed.search = '';
  parsed.hash = '';
  return {
    url: parsed.toString(),
    tls: parsed.protocol === 'rediss:',
    authenticated: true,
  };
}

export function resolvePlatformRedisRoleConnections(
  env: RuntimeEnvironment = process.env,
): PlatformRedisRoleConnections {
  const shared = resolveRedisConnectionConfig(env);
  const colyseus = resolvePlatformColyseusRedisConnectionConfig(env, shared);
  if (
    String(env.PLATFORM_REQUIRE_ISOLATED_REDIS || '')
      .trim()
      .toLowerCase() === 'true' &&
    redisServerIdentity(shared.url) === redisServerIdentity(colyseus.url)
  ) {
    throw new Error('PLATFORM_COLYSEUS_REDIS_URL must use a different Redis server when isolation is required');
  }
  return {
    shared,
    colyseus,
  };
}

export function platformRedisHealthChecks(
  shared: PlatformRedisPingClient | null,
  colyseus: PlatformRedisPingClient | null,
): PlatformRedisHealthCheck[] {
  const checks: PlatformRedisHealthCheck[] = [];
  if (shared) checks.push({ name: 'redis-shared', promise: shared.ping() });
  if (colyseus) checks.push({ name: 'redis-colyseus', promise: colyseus.ping() });
  return checks;
}

export function isPlatformRedisMode(value: string | undefined): value is PlatformRedisMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'memory' || normalized === 'redis';
}

export function resolvePlatformRedisMode(value: string | undefined, nodeEnv: string | undefined): PlatformRedisMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'redis') return 'redis';
  if (normalized === 'memory' && nodeEnv !== 'production') return 'memory';
  return nodeEnv === 'production' ? 'redis' : 'memory';
}

export function resolvePlatformPublicAddress(
  value: string | undefined,
  nodeEnv: string | undefined,
): PlatformPublicAddress | undefined {
  const configured = value?.trim();
  if (!configured) {
    if (nodeEnv === 'production') {
      throw new Error('PLATFORM_PUBLIC_ADDRESS is required in production');
    }
    return undefined;
  }

  if (!/^wss?:\/\//i.test(configured)) {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must be an absolute ws:// or wss:// URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must be an absolute ws:// or wss:// URL');
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must be an absolute ws:// or wss:// URL');
  }
  if (!parsed.hostname) {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must include a hostname');
  }
  if (parsed.username || parsed.password) {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must not include credentials');
  }
  if (configured.includes('?') || configured.includes('#')) {
    throw new Error('PLATFORM_PUBLIC_ADDRESS must not include a query string or hash');
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (nodeEnv === 'production' && parsed.protocol === 'ws:' && !isLoopback) {
    throw new Error('production PLATFORM_PUBLIC_ADDRESS must use wss:// unless it targets a loopback host');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return {
    url: `${parsed.protocol}//${parsed.host}${pathname}`,
    colyseusAddress: `${parsed.host}${pathname}`,
  };
}

export function redisUrlWithDb(url: string, db: number): string {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = `/${db}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolvePlatformCorsOrigins(value: string | undefined): string[] {
  const configured =
    value
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  return configured.length > 0 ? configured : DEFAULT_PLATFORM_CORS_ORIGINS;
}

export function resolvePlatformCorsOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!origin) return null;
  return allowedOrigins.includes(origin) ? origin : null;
}
