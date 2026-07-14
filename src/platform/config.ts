export type PlatformRedisMode = 'memory' | 'redis';

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
