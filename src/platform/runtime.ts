import http from 'http';
import { matchMaker, Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { createPlatformChatPreviewStoreFromEnv, resolvePlatformChatPreviewStoreMode } from './chatPreviewStore';
import {
  isPlatformRedisMode,
  redisUrlWithDb,
  resolvePlatformCorsOrigin,
  resolvePlatformCorsOrigins,
  resolvePlatformRedisMode,
} from './config';
import { createPlatformFriendStoreFromEnv, resolvePlatformFriendStoreMode } from './friendStore';
import { platformLogger as logger } from './logger';
import {
  createPlatformMatchParticipantStoreFromEnv,
  resolvePlatformMatchParticipantStoreMode,
} from './matchParticipantStore';
import {
  platformMetricsAuthorized,
  platformMetricsMiddleware,
  platformMetricsText,
  recordPlatformDependencyFailure,
  setPlatformRuntimeMetrics,
} from './metrics';
import { configurePlatformJwtRevocationStore } from './rooms/jwt';
import { CustomRoom, InviteRoom, LobbyRoom, MatchShellRoom, QuickMatchRoom } from './rooms';

interface CreatePlatformRuntimeOptions {
  gracefullyShutdown?: boolean;
}

export interface PlatformRuntime {
  gameServer: Server;
  httpServer: http.Server;
  port: number;
  redisMode: ReturnType<typeof resolvePlatformRedisMode>;
  friendStoreMode: ReturnType<typeof resolvePlatformFriendStoreMode>;
  matchParticipantStoreMode: ReturnType<typeof resolvePlatformMatchParticipantStoreMode>;
  chatPreviewStoreMode: ReturnType<typeof resolvePlatformChatPreviewStoreMode>;
  closeStores: () => Promise<void>;
}

export function createPlatformRuntime(options: CreatePlatformRuntimeOptions = {}): PlatformRuntime {
  const port = Number(process.env.PLATFORM_PORT) || 3002;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redisDb = Number(process.env.REDIS_DB) || 0;
  const configuredRedisMode = process.env.PLATFORM_REDIS_MODE;
  const redisMode = resolvePlatformRedisMode(configuredRedisMode, process.env.NODE_ENV);
  const corsOrigins = resolvePlatformCorsOrigins(process.env.ALLOWED_ORIGINS);

  if (configuredRedisMode?.trim() && !isPlatformRedisMode(configuredRedisMode)) {
    logger.warn({ mode: configuredRedisMode }, 'unknown PLATFORM_REDIS_MODE, falling back to environment default');
  }

  const httpServer = http.createServer();
  const colyseusRedisUrl = redisUrlWithDb(redisUrl, redisDb);
  const friendStore = createPlatformFriendStoreFromEnv();
  const matchParticipantStore = createPlatformMatchParticipantStoreFromEnv();
  const chatPreviewStore = createPlatformChatPreviewStoreFromEnv();
  const friendStoreMode = resolvePlatformFriendStoreMode();
  const matchParticipantStoreMode = resolvePlatformMatchParticipantStoreMode();
  const chatPreviewStoreMode = resolvePlatformChatPreviewStoreMode();

  // 為 /health 端點建立輕量級 PG pool 與 Redis client，僅用於依賴檢查。
  // 僅在實際使用 PG（任一 store 為 postgres）或 Redis（redisMode === 'redis'）時建立。
  const usesPostgres =
    friendStoreMode === 'postgres' || matchParticipantStoreMode === 'postgres' || chatPreviewStoreMode === 'postgres';
  const databaseUrl =
    process.env.DATABASE_URL ??
    `postgres://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || ''}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE || 'postgres'}`;
  const healthPool = usesPostgres
    ? new Pool({
        connectionString: databaseUrl,
        max: 1,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 3_000,
      })
    : null;
  const healthRedis =
    redisMode === 'redis' ? new Redis(colyseusRedisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true }) : null;
  // The API service writes access-token revocation markers to this shared DB.
  // Keep a dedicated command connection so health checks/Colyseus presence do
  // not starve authentication reads, and make the verifier fail closed when
  // this dependency is unavailable.
  const authRevocationRedis =
    redisMode === 'redis' ? new Redis(colyseusRedisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true }) : null;
  healthRedis?.on('error', (err) => logger.warn({ err }, 'platform health Redis connection error'));
  authRevocationRedis?.on('error', (err) => logger.warn({ err }, 'platform auth Redis connection error'));
  configurePlatformJwtRevocationStore(authRevocationRedis);

  async function checkHealth(): Promise<{ ok: boolean; errors: string[] }> {
    const checks: { name: string; promise: Promise<unknown> }[] = [];
    if (healthPool) checks.push({ name: 'postgres', promise: healthPool.query('SELECT 1') });
    if (healthRedis) checks.push({ name: 'redis', promise: healthRedis.ping() });
    if (checks.length === 0) return { ok: true, errors: [] };

    const results = await Promise.allSettled(checks.map((c) => c.promise));
    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        recordPlatformDependencyFailure(checks[i].name);
        errors.push(`${checks[i].name}: ${reason}`);
      }
    });
    return { ok: errors.length === 0, errors };
  }

  LobbyRoom.configureFriendStore(friendStore);
  InviteRoom.configureFriendStore(friendStore, { enforceFriendship: friendStoreMode === 'postgres' });
  CustomRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureChatPreviewStore(chatPreviewStore);

  const closeStores = async () => {
    await Promise.all([
      friendStore.close?.(),
      matchParticipantStore.close?.(),
      chatPreviewStore.close?.(),
      healthPool?.end(),
      healthRedis?.quit(),
      authRevocationRedis?.quit(),
    ]);
    configurePlatformJwtRevocationStore(null);
  };

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => {
      app.use(platformMetricsMiddleware);
      app.use((req: Request, res: Response, next: NextFunction) => {
        const corsOrigin = resolvePlatformCorsOrigin(req.headers.origin, corsOrigins);
        if (corsOrigin) {
          res.set('Access-Control-Allow-Origin', corsOrigin);
          res.set('Vary', 'Origin');
          res.set('Access-Control-Allow-Credentials', 'true');
        }
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
          return;
        }
        next();
      });
      app.get('/health', async (_req, res) => {
        const result = await checkHealth();
        if (result.ok) {
          res.set('Cache-Control', 'no-store').json({ ok: true, service: 'platform' });
        } else {
          res
            .status(503)
            .set('Cache-Control', 'no-store')
            .json({ ok: false, service: 'platform', errors: result.errors });
        }
      });
      app.get('/ready', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ ok: true });
      });
      app.get('/metrics', async (req, res) => {
        if (!platformMetricsAuthorized(req.headers.authorization)) {
          res.status(401).set('Cache-Control', 'no-store').json({ error: 'Unauthorized' });
          return;
        }
        setPlatformRuntimeMetrics({ all: matchMaker.stats.local.roomCount }, matchMaker.stats.local.ccu);
        const metrics = await platformMetricsText();
        res.set('Cache-Control', 'no-store').type(metrics.contentType).send(metrics.body);
      });
    },
    ...(redisMode === 'redis'
      ? {
          presence: new RedisPresence(colyseusRedisUrl),
          driver: new RedisDriver(colyseusRedisUrl),
        }
      : {}),
    gracefullyShutdown: options.gracefullyShutdown ?? true,
    greet: false,
  });

  gameServer.define('lobby', LobbyRoom);
  gameServer.define('match_shell', MatchShellRoom).filterBy(['boardgameMatchID', 'status']);
  gameServer.define('quick_match', QuickMatchRoom).filterBy(['status']);
  gameServer.define('custom_room', CustomRoom).filterBy(['roomCode', 'status']);
  gameServer.define('invite', InviteRoom).filterBy(['inviteId', 'status', 'targetUserId']);

  gameServer.onShutdown(async () => {
    logger.info('platform server shutting down');
    await closeStores();
  });

  return {
    gameServer,
    httpServer,
    port,
    redisMode,
    friendStoreMode,
    matchParticipantStoreMode,
    chatPreviewStoreMode,
    closeStores,
  };
}
