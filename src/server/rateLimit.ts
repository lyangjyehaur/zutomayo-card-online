import type Redis from 'ioredis';
import type { ObsMiddleware } from './observability/logger';
import { getRequestLogger } from './observability/logger';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RateLimitOptions {
  /** Redis client used for cross-instance counter. */
  redis: Redis;
  /** Max requests per window. */
  limit: number;
  /** Key namespace to isolate different route groups. */
  namespace?: string;
}

/** Koa middleware: Redis-backed fixed-window rate limit per client IP. */
export function createRateLimit({ redis, limit, namespace = 'game' }: RateLimitOptions): ObsMiddleware {
  return async (ctx, next) => {
    const ip = (ctx.get('x-forwarded-for') || ctx.ip || '').toString().split(',')[0].trim() || 'unknown';
    const minuteWindow = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    const key = `ratelimit:${namespace}:${ip}:${minuteWindow}`;
    let allowed = true;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 120);
      allowed = count <= limit;
    } catch {
      // Redis 斷線時 fail open，避免擋掉全部流量。
      getRequestLogger().warn({ key }, 'rate limit check failed (redis unavailable), failing open');
    }
    if (!allowed) {
      ctx.status = 429;
      ctx.set('Retry-After', '60');
      ctx.body = { error: 'Too many requests. Please try again later.' };
      return;
    }
    await next();
  };
}
