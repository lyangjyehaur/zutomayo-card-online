export type PlatformRedisMode = 'memory' | 'redis';

export function isPlatformRedisMode(value: string | undefined): value is PlatformRedisMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'memory' || normalized === 'redis';
}

export function resolvePlatformRedisMode(value: string | undefined, nodeEnv: string | undefined): PlatformRedisMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'memory' || normalized === 'redis') return normalized;
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
