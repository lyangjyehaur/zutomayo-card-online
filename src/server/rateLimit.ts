import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
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

function normalizeIp(ip: string): string {
  if (!ip) return '';
  return ip
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%', 1)[0]
    .toLowerCase();
}

function ipv6Bytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) !== 6) return null;
  let source = ip;
  if (ip.includes('.')) {
    const suffix = ip.slice(ip.lastIndexOf(':') + 1);
    const parts = suffix.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${ip.slice(0, ip.lastIndexOf(':'))}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value16 = parseInt(group, 16);
    bytes[index * 2] = value16 >>> 8;
    bytes[index * 2 + 1] = value16 & 0xff;
  });
  return bytes;
}

function ipBytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) === 4) return Uint8Array.from(ip.split('.').map(Number));
  const bytes = ipv6Bytes(ip);
  if (!bytes) return null;
  let mapped = true;
  for (let index = 0; index < 10; index += 1) if (bytes[index] !== 0) mapped = false;
  if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12);
  return bytes;
}

function ipMatch(ip: string, range: string): boolean {
  const normalizedRange = normalizeIp(range);
  const slash = normalizedRange.indexOf('/');
  const base = slash >= 0 ? normalizedRange.slice(0, slash) : normalizedRange;
  const a = ipBytes(ip);
  const b = ipBytes(base);
  if (!a || !b || a.length !== b.length) return false;
  if (slash < 0) return a.every((value, index) => value === b[index]);
  const prefixLen = Number(normalizedRange.slice(slash + 1));
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > a.length * 8) return false;
  const full = Math.floor(prefixLen / 8);
  const bits = prefixLen % 8;
  for (let index = 0; index < full; index += 1) if (a[index] !== b[index]) return false;
  if (!bits) return true;
  const mask = (0xff << (8 - bits)) & 0xff;
  return (a[full] & mask) === (b[full] & mask);
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
      const chain = first
        .split(',')
        .map((value) => value.trim())
        .filter((value) => isIP(normalizeIp(value)) > 0);
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        if (!isTrustedProxy(chain[index])) return normalizeIp(chain[index]);
      }
      if (chain.length > 0) return normalizeIp(chain[0]);
    }
  }
  return normalizeIp(remoteAddress);
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
      // A limiter outage must fail closed. Failing open turns a dependency
      // incident into an unbounded connection/match flood.
      getRequestLogger().error({ key }, 'rate limit check failed (redis unavailable), failing closed');
      allowed = false;
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
