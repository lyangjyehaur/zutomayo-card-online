import crypto from 'node:crypto';
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { platformLogger as logger } from './logger';
import { platformAuthTokenFromCookieHeader, verifyPlatformJwtUserIdAsync } from './rooms/jwt';

const DEFAULT_WINDOW_SECONDS = 60;
const ADMISSION_SCRIPT = `
local globalCount = redis.call('INCR', KEYS[3])
if globalCount == 1 then redis.call('EXPIRE', KEYS[3], ARGV[1]) end
if globalCount > tonumber(ARGV[2]) then return { -1, -1, globalCount } end
local ipCount = redis.call('INCR', KEYS[1])
if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if ipCount > tonumber(ARGV[3]) then
  redis.call('DECR', KEYS[3])
  return { ipCount, -1, globalCount - 1 }
end
local userCount = redis.call('INCR', KEYS[2])
if userCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
if userCount > tonumber(ARGV[4]) then
  redis.call('DECR', KEYS[3])
  return { ipCount, userCount, globalCount - 1 }
end
return { ipCount, userCount, globalCount }
`;

export interface PlatformAdmissionRedis {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface PlatformAdmissionLimits {
  ipLimit: number;
  userLimit: number;
  globalLimit: number;
  windowSeconds: number;
  timeoutMs: number;
}

export interface PlatformAdmissionIdentity {
  ip: string;
  userId?: string;
}

export interface PlatformAdmissionLimiter {
  check(identity: PlatformAdmissionIdentity, nowMs?: number): Promise<boolean>;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export function platformAdmissionLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): PlatformAdmissionLimits {
  return {
    ipLimit: boundedInteger(env.PLATFORM_ADMISSION_IP_LIMIT, 30, 1, 100_000),
    userLimit: boundedInteger(env.PLATFORM_ADMISSION_USER_LIMIT, 10, 1, 100_000),
    globalLimit: boundedInteger(env.PLATFORM_ADMISSION_GLOBAL_LIMIT, 2_000, 1, 1_000_000),
    windowSeconds: boundedInteger(env.PLATFORM_ADMISSION_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 10, 3_600),
    timeoutMs: boundedInteger(env.PLATFORM_ADMISSION_REDIS_TIMEOUT_MS, 750, 50, 5_000),
  };
}

export function platformPendingInviteDiscoveryLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PlatformAdmissionLimits {
  return {
    ipLimit: boundedInteger(env.PLATFORM_INVITE_DISCOVERY_IP_LIMIT, 600, 1, 100_000),
    userLimit: boundedInteger(env.PLATFORM_INVITE_DISCOVERY_USER_LIMIT, 30, 1, 100_000),
    globalLimit: boundedInteger(env.PLATFORM_INVITE_DISCOVERY_GLOBAL_LIMIT, 20_000, 1, 1_000_000),
    windowSeconds: boundedInteger(env.PLATFORM_INVITE_DISCOVERY_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 10, 3_600),
    timeoutMs: boundedInteger(env.PLATFORM_INVITE_DISCOVERY_REDIS_TIMEOUT_MS, 750, 50, 5_000),
  };
}

function identityHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function countTuple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const counts = value.map(Number);
  return counts.every((count) => Number.isFinite(count) && count > 0) ? (counts as [number, number, number]) : null;
}

export class RedisPlatformAdmissionLimiter implements PlatformAdmissionLimiter {
  constructor(
    private readonly redis: PlatformAdmissionRedis,
    private readonly limits: PlatformAdmissionLimits,
    private readonly namespacePrefix = 'platform:admission',
  ) {}

  async check(identity: PlatformAdmissionIdentity, nowMs = Date.now()): Promise<boolean> {
    if (!identity.ip) return false;
    const window = Math.floor(nowMs / (this.limits.windowSeconds * 1_000));
    const userIdentity = identity.userId || `guest-ip:${identity.ip}`;
    const namespace = `${this.namespacePrefix}:{v1:${window}}`;
    const keys = [
      `${namespace}:ip:${identityHash(identity.ip)}`,
      `${namespace}:user:${identityHash(userIdentity)}`,
      `${namespace}:global`,
    ];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        this.redis.eval(
          ADMISSION_SCRIPT,
          keys.length,
          ...keys,
          this.limits.windowSeconds * 2,
          this.limits.globalLimit,
          this.limits.ipLimit,
          this.limits.userLimit,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('platform admission Redis timeout')), this.limits.timeoutMs);
        }),
      ]);
      const counts = countTuple(reply);
      return Boolean(
        counts &&
        counts[0] <= this.limits.ipLimit &&
        counts[1] <= this.limits.userLimit &&
        counts[2] <= this.limits.globalLimit,
      );
    } catch (err) {
      logger.error({ err }, 'platform admission limiter unavailable; failing closed');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

const allowLocalAdmission: PlatformAdmissionLimiter = {
  async check() {
    return true;
  },
};

const rejectAdmission: PlatformAdmissionLimiter = {
  async check() {
    return false;
  },
};

export function createPlatformAdmissionLimiter(
  redis: PlatformAdmissionRedis | null,
  options: { nodeEnv?: string; limits?: PlatformAdmissionLimits; namespacePrefix?: string } = {},
): PlatformAdmissionLimiter {
  if (redis)
    return new RedisPlatformAdmissionLimiter(
      redis,
      options.limits ?? platformAdmissionLimitsFromEnv(),
      options.namespacePrefix,
    );
  return options.nodeEnv === 'production' ? rejectAdmission : allowLocalAdmission;
}

export function createPlatformPendingInviteDiscoveryLimiter(
  redis: PlatformAdmissionRedis | null,
  options: { nodeEnv?: string; limits?: PlatformAdmissionLimits } = {},
): PlatformAdmissionLimiter {
  return createPlatformAdmissionLimiter(redis, {
    nodeEnv: options.nodeEnv,
    limits: options.limits ?? platformPendingInviteDiscoveryLimitsFromEnv(),
    namespacePrefix: 'platform:invite-discovery',
  });
}

function normalizeIp(value: string): string {
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%', 1)[0]
    .toLowerCase();
}

function ipv6Bytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) !== 6) return null;
  let source = ip;
  if (source.includes('.')) {
    const suffix = source.slice(source.lastIndexOf(':') + 1);
    const parts = suffix.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${source.slice(0, source.lastIndexOf(':'))}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const part = Number.parseInt(group, 16);
    bytes[index * 2] = part >>> 8;
    bytes[index * 2 + 1] = part & 0xff;
  });
  return bytes;
}

function ipBytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) === 4) return Uint8Array.from(ip.split('.').map(Number));
  const bytes = ipv6Bytes(ip);
  if (!bytes) return null;
  const mapped = bytes.slice(0, 10).every((part) => part === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? bytes.slice(12) : bytes;
}

function ipMatchesRange(ip: string, range: string): boolean {
  const normalizedRange = normalizeIp(range);
  const slashIndex = normalizedRange.indexOf('/');
  const base = slashIndex >= 0 ? normalizedRange.slice(0, slashIndex) : normalizedRange;
  const candidateBytes = ipBytes(ip);
  const baseBytes = ipBytes(base);
  if (!candidateBytes || !baseBytes || candidateBytes.length !== baseBytes.length) return false;
  if (slashIndex < 0) return candidateBytes.every((part, index) => part === baseBytes[index]);
  const prefixLength = Number(normalizedRange.slice(slashIndex + 1));
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > candidateBytes.length * 8) return false;
  const wholeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (candidateBytes[index] !== baseBytes[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (candidateBytes[wholeBytes] & mask) === (baseBytes[wholeBytes] & mask);
}

export function platformAdmissionClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyValue = process.env.TRUSTED_PROXY || '',
): string {
  const remoteIp = normalizeIp(remoteAddress || '');
  const trustedProxies = trustedProxyValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const trusted = (ip: string) => trustedProxies.some((range) => ipMatchesRange(ip, range));
  if (!remoteIp || isIP(remoteIp) === 0) return '';
  if (!trusted(remoteIp) || !forwardedFor) return remoteIp;
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const chain = value
    .split(',')
    .map(normalizeIp)
    .filter((ip) => isIP(ip) > 0);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trusted(chain[index])) return chain[index];
  }
  return chain[0] || remoteIp;
}

function isMatchmakeRequest(method: string, path: string): boolean {
  // Limit the whole namespace so URL-encoded room names or invalid methods
  // cannot bypass admission and still reach Colyseus route parsing.
  return method === 'POST' && path.startsWith('/matchmake/');
}

export function createPlatformAdmissionMiddleware(options: {
  limiter: PlatformAdmissionLimiter;
  trustedProxy?: string;
  verifyUserId?: (token: string) => Promise<string>;
}): RequestHandler {
  const verifyUserId = options.verifyUserId ?? ((token) => verifyPlatformJwtUserIdAsync(token));
  return async (req, res, next) => {
    if (!isMatchmakeRequest(req.method, req.path)) {
      next();
      return;
    }
    const ip = platformAdmissionClientIp(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? req.headers['x-client-ip'],
      options.trustedProxy,
    );
    if (!ip) {
      res.status(429).set('Retry-After', '60').json({ error: 'Platform admission capacity is unavailable' });
      return;
    }

    // Colyseus otherwise trusts X-Forwarded-For verbatim when building AuthContext.
    req.headers['x-forwarded-for'] = ip;
    const cookieHeader = req.headers.cookie;
    const hasAuthCookie = /(?:^|;\s*)zutomayo_session=/.test(cookieHeader || '');
    const token = platformAuthTokenFromCookieHeader(cookieHeader);
    let userId = '';
    try {
      if (token) userId = await verifyUserId(token);
    } catch (err) {
      logger.error({ err }, 'platform admission authentication unavailable; failing closed');
      res.status(503).json({ error: 'Platform authentication is temporarily unavailable' });
      return;
    }
    if (hasAuthCookie && (!token || !userId)) {
      res.status(401).json({ error: 'Invalid or revoked authentication' });
      return;
    }
    let admitted = false;
    try {
      admitted = await options.limiter.check({ ip, ...(userId ? { userId } : {}) });
    } catch (err) {
      logger.error({ err }, 'platform admission check failed; failing closed');
    }
    if (!admitted) {
      res.status(429).set('Retry-After', '60').json({ error: 'Platform admission capacity is unavailable' });
      return;
    }
    next();
  };
}
