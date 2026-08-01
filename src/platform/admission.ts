import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { resolveClientIp } from '../clientIp';
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

export interface PlatformAdmissionDecision {
  allowed: boolean;
  status?: 401 | 429 | 503;
  error?: string;
  retryAfter?: string;
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
  ) {}

  async check(identity: PlatformAdmissionIdentity, nowMs = Date.now()): Promise<boolean> {
    if (!identity.ip) return false;
    const window = Math.floor(nowMs / (this.limits.windowSeconds * 1_000));
    const userIdentity = identity.userId || `guest-ip:${identity.ip}`;
    const namespace = `platform:admission:{v1:${window}}`;
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
  options: { nodeEnv?: string; limits?: PlatformAdmissionLimits } = {},
): PlatformAdmissionLimiter {
  if (redis) return new RedisPlatformAdmissionLimiter(redis, options.limits ?? platformAdmissionLimitsFromEnv());
  return options.nodeEnv === 'production' ? rejectAdmission : allowLocalAdmission;
}

export function platformAdmissionClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyValue = process.env.TRUSTED_PROXY || '',
): string {
  return resolveClientIp(remoteAddress, forwardedFor, trustedProxyValue);
}

export function isPlatformMatchmakeRequest(method: string, path: string): boolean {
  // Limit the whole namespace so URL-encoded room names or invalid methods
  // cannot bypass admission and still reach Colyseus route parsing.
  return method === 'POST' && path.startsWith('/matchmake/');
}

export async function checkPlatformAdmission(options: {
  limiter: PlatformAdmissionLimiter;
  ip: string;
  cookieHeader?: string;
  verifyUserId?: (token: string) => Promise<string>;
}): Promise<PlatformAdmissionDecision> {
  if (!options.ip) {
    return {
      allowed: false,
      status: 429,
      error: 'Platform admission capacity is unavailable',
      retryAfter: '60',
    };
  }

  const verifyUserId = options.verifyUserId ?? ((token: string) => verifyPlatformJwtUserIdAsync(token));
  const hasAuthCookie = /(?:^|;\s*)zutomayo_session=/.test(options.cookieHeader || '');
  const token = platformAuthTokenFromCookieHeader(options.cookieHeader);
  let userId = '';
  try {
    if (token) userId = await verifyUserId(token);
  } catch (err) {
    logger.error({ err }, 'platform admission authentication unavailable; failing closed');
    return { allowed: false, status: 503, error: 'Platform authentication is temporarily unavailable' };
  }
  if (hasAuthCookie && (!token || !userId)) {
    return { allowed: false, status: 401, error: 'Invalid or revoked authentication' };
  }

  let admitted = false;
  try {
    admitted = await options.limiter.check({ ip: options.ip, ...(userId ? { userId } : {}) });
  } catch (err) {
    logger.error({ err }, 'platform admission check failed; failing closed');
  }
  return admitted
    ? { allowed: true }
    : {
        allowed: false,
        status: 429,
        error: 'Platform admission capacity is unavailable',
        retryAfter: '60',
      };
}

export function createPlatformAdmissionMiddleware(options: {
  limiter: PlatformAdmissionLimiter;
  trustedProxy?: string;
  verifyUserId?: (token: string) => Promise<string>;
}): RequestHandler {
  return async (req, res, next) => {
    if (!isPlatformMatchmakeRequest(req.method, req.path)) {
      next();
      return;
    }
    const ip = platformAdmissionClientIp(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? req.headers['x-client-ip'],
      options.trustedProxy,
    );
    // Colyseus otherwise trusts X-Forwarded-For verbatim when building AuthContext.
    if (ip) req.headers['x-forwarded-for'] = ip;
    const decision = await checkPlatformAdmission({
      limiter: options.limiter,
      ip,
      cookieHeader: req.headers.cookie,
      verifyUserId: options.verifyUserId,
    });
    if (!decision.allowed) {
      if (decision.retryAfter) res.set('Retry-After', decision.retryAfter);
      res.status(decision.status ?? 503).json({ error: decision.error });
      return;
    }
    next();
  };
}
