import { matchMaker } from '@colyseus/core';
import type { RequestHandler } from 'express';
import {
  PLATFORM_PENDING_INVITE_DISCOVERY_PATH,
  type PlatformPendingInviteDiscovery,
  isPlatformInviteRoomId,
} from '../platformInviteDiscovery';
import { platformAdmissionClientIp, type PlatformAdmissionLimiter } from './admission';
import { platformLogger as logger } from './logger';
import { platformAuthTokenFromCookieHeader, verifyPlatformJwtUserIdAsync } from './rooms/jwt';

interface PendingInviteRoomListing {
  name?: unknown;
  roomId?: unknown;
  locked?: unknown;
  createdAt?: unknown;
  metadata?: {
    kind?: unknown;
    status?: unknown;
    targetUserId?: unknown;
  };
}

export interface PendingInviteRoomCacheRedis {
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface PendingInviteDiscoveryDependencies {
  verifyUserId?: (token: string) => Promise<string>;
  limiter?: PlatformAdmissionLimiter;
  trustedProxy?: string;
  queryTimeoutMs?: number;
  queryRooms?: (
    conditions: Record<string, unknown>,
    sortOptions: Record<string, 1 | -1>,
  ) => Promise<PendingInviteRoomListing[]>;
}

const rejectDiscovery: PlatformAdmissionLimiter = {
  async check() {
    return false;
  },
};

export interface PlatformPendingInviteTimeouts {
  queryTimeoutMs: number;
  redisCommandTimeoutMs: number;
}

function strictTimeout(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer between 100 and 5000`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 5_000) {
    throw new Error(`${name} must be an integer between 100 and 5000`);
  }
  return parsed;
}

export function platformPendingInviteTimeoutsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PlatformPendingInviteTimeouts {
  return {
    queryTimeoutMs: strictTimeout(
      env.PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS,
      'PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS',
      2_000,
    ),
    redisCommandTimeoutMs: strictTimeout(
      env.PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS,
      'PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS',
      1_500,
    ),
  };
}

const COLYSEUS_ROOMCACHES_KEY = 'roomcaches';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function redisPendingInviteListing(value: string): { listing: PendingInviteRoomListing; createdAtMs: number } | null {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = record(JSON.parse(value));
  } catch {
    return null;
  }
  if (!parsed || parsed.name !== 'invite' || parsed.locked !== false || !isPlatformInviteRoomId(parsed.roomId)) {
    return null;
  }
  const metadata = record(parsed.metadata);
  if (
    !metadata ||
    metadata.kind !== 'invite' ||
    metadata.status !== 'pending' ||
    typeof metadata.targetUserId !== 'string' ||
    !metadata.targetUserId
  ) {
    return null;
  }
  const createdAtMs =
    typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)
      ? parsed.createdAt
      : typeof parsed.createdAt === 'string'
        ? Date.parse(parsed.createdAt)
        : Number.NaN;
  if (!Number.isFinite(createdAtMs)) return null;
  return {
    listing: {
      name: 'invite',
      roomId: parsed.roomId,
      locked: false,
      createdAt: createdAtMs,
      metadata: {
        kind: 'invite',
        status: 'pending',
        targetUserId: metadata.targetUserId,
      },
    },
    createdAtMs,
  };
}

export function createRedisPendingInviteRoomQuery(
  redis: PendingInviteRoomCacheRedis,
): NonNullable<PendingInviteDiscoveryDependencies['queryRooms']> {
  return async (conditions, sortOptions) => {
    if (
      Object.keys(conditions).length !== 4 ||
      conditions.name !== 'invite' ||
      conditions.status !== 'pending' ||
      conditions.locked !== false ||
      typeof conditions.targetUserId !== 'string' ||
      !conditions.targetUserId ||
      Object.keys(sortOptions).length !== 1 ||
      sortOptions.createdAt !== 1
    ) {
      throw new Error('Unsupported pending invite Redis room query');
    }
    const targetUserId = conditions.targetUserId;
    const roomcaches = await redis.hgetall(COLYSEUS_ROOMCACHES_KEY);
    return Object.values(roomcaches)
      .map((value) => redisPendingInviteListing(value))
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null && candidate.listing.metadata?.targetUserId === targetUserId,
      )
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map(({ listing }) => listing);
  };
}

async function boundedRoomQuery<T>(query: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('pending invite room query timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export { PLATFORM_PENDING_INVITE_DISCOVERY_PATH };

export function createPendingInviteDiscoveryHandler(
  dependencies: PendingInviteDiscoveryDependencies = {},
): RequestHandler {
  const verifyUserId = dependencies.verifyUserId ?? ((token: string) => verifyPlatformJwtUserIdAsync(token));
  const limiter = dependencies.limiter ?? rejectDiscovery;
  const queryTimeoutMs =
    dependencies.queryTimeoutMs === undefined
      ? platformPendingInviteTimeoutsFromEnv().queryTimeoutMs
      : Math.min(5_000, Math.max(1, Math.floor(dependencies.queryTimeoutMs)));
  const queryRooms =
    dependencies.queryRooms ??
    (async (conditions, sortOptions) =>
      (await matchMaker.query(conditions, sortOptions)) as PendingInviteRoomListing[]);

  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = platformAuthTokenFromCookieHeader(req.headers.cookie);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    let userId = '';
    try {
      userId = await verifyUserId(token);
    } catch (err) {
      logger.error({ err }, 'pending invite authentication unavailable; failing closed');
      res.status(503).json({ error: 'Platform authentication is temporarily unavailable' });
      return;
    }
    if (!userId) {
      res.status(401).json({ error: 'Invalid or revoked authentication' });
      return;
    }

    const ip = platformAdmissionClientIp(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? req.headers['x-client-ip'],
      dependencies.trustedProxy,
    );
    let admitted = false;
    try {
      if (ip) admitted = await limiter.check({ ip, userId });
    } catch (err) {
      logger.error({ err }, 'pending invite discovery limiter unavailable; failing closed');
    }
    if (!admitted) {
      res.status(429).set('Retry-After', '60').json({ error: 'Pending invite discovery capacity is unavailable' });
      return;
    }

    try {
      const listings = await boundedRoomQuery(
        queryRooms({ name: 'invite', status: 'pending', targetUserId: userId, locked: false }, { createdAt: 1 }),
        queryTimeoutMs,
      );
      const listing = listings.find(
        (candidate) =>
          candidate.name === 'invite' &&
          candidate.locked !== true &&
          candidate.metadata?.kind === 'invite' &&
          candidate.metadata.status === 'pending' &&
          candidate.metadata.targetUserId === userId &&
          isPlatformInviteRoomId(candidate.roomId),
      );
      const body: PlatformPendingInviteDiscovery = {
        pendingInvite: listing && isPlatformInviteRoomId(listing.roomId) ? { roomId: listing.roomId } : null,
      };
      res.json(body);
    } catch (err) {
      logger.error({ err }, 'pending invite discovery unavailable; failing closed');
      res.status(503).json({ error: 'Pending invite discovery is temporarily unavailable' });
    }
  };
}
