export type PlatformRedisMode = 'memory' | 'redis';

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
