import type { IncomingMessage } from 'node:http';
import type Redis from 'ioredis';
import type { ObsMiddleware } from './observability/logger';
import { getRequestLogger } from './observability/logger';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// E10：信任代理 IP/CIDR 列表。僅當請求來自信任代理時才使用 X-Forwarded-For，
// 防止攻擊者偽造 header 繞過 rate limit。未設定時固定使用 TCP 連線 IP。
const TRUSTED_PROXIES = (process.env.TRUSTED_PROXY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function normalizeIp(ip: string): string {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '');
}

function ipMatch(ip: string, range: string): boolean {
  const normalizedIp = normalizeIp(ip);
  const normalizedRange = normalizeIp(range);
  if (normalizedRange.includes('/')) {
    const [base, prefixStr] = normalizedRange.split('/');
    const prefixLen = parseInt(prefixStr, 10);
    if (isNaN(prefixLen) || prefixLen < 0) return false;
    if (base.includes('.') && normalizedIp.includes('.')) {
      const ipInt = ipv4ToInt(normalizedIp);
      const baseInt = ipv4ToInt(base);
      if (ipInt === null || baseInt === null) return false;
      if (prefixLen > 32) return false;
      const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    }
    return false;
  }
  return normalizedIp === normalizedRange;
}

function isTrustedProxy(ip: string): boolean {
  if (!ip || TRUSTED_PROXIES.length === 0) return false;
  return TRUSTED_PROXIES.some((range) => ipMatch(ip, range));
}

export function getClientIpFromRequest(req: IncomingMessage): string {
  const remoteAddress = req.socket.remoteAddress || '';
  if (isTrustedProxy(remoteAddress)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = Array.isArray(xff) ? xff[0] : xff;
      return first.split(',')[0].trim();
    }
  }
  return remoteAddress;
}

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
    const ip = getClientIpFromRequest(ctx.req) || 'unknown';
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
