import http from 'http';
import { createRequire } from 'node:module';
import { matchMaker, Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { createServiceReadiness } from '../operational/serviceLifecycle';
import { APP_VERSION_INFO } from '../version';
import {
  createPlatformAdmissionLimiter,
  createPlatformAdmissionMiddleware,
  platformAdmissionClientIp,
  platformAdmissionLimitsFromEnv,
} from './admission';
import { createPlatformBlockStoreFromEnv, resolvePlatformBlockStoreMode } from './blockStore';
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
import {
  configurePlatformJwtAccountStore,
  configurePlatformJwtRevocationStore,
  createPostgresPlatformJwtAccountStore,
} from './rooms/jwt';
import { CustomRoom, InviteRoom, LobbyRoom, MatchShellRoom, QuickMatchRoom } from './rooms';

const require = createRequire(import.meta.url);
const { assertRuntimeSchema } = require('../../api/schemaGate.cjs') as {
  assertRuntimeSchema: (options: {
    pool: Pick<Pool, 'query'>;
    expectedMigration: string | undefined;
    expectedChecksum: string | undefined;
  }) => Promise<{ expectedMigration: string; expectedChecksum: string }>;
};

interface CreatePlatformRuntimeOptions {
  gracefullyShutdown?: boolean;
}

export interface PlatformRuntime {
  gameServer: Server;
  httpServer: http.Server;
  port: number;
  redisMode: ReturnType<typeof resolvePlatformRedisMode>;
  friendStoreMode: ReturnType<typeof resolvePlatformFriendStoreMode>;
  blockStoreMode: ReturnType<typeof resolvePlatformBlockStoreMode>;
  matchParticipantStoreMode: ReturnType<typeof resolvePlatformMatchParticipantStoreMode>;
  chatPreviewStoreMode: ReturnType<typeof resolvePlatformChatPreviewStoreMode>;
  closeStores: () => Promise<void>;
  schemaReady: Promise<void>;
  beginDrain: () => boolean;
  isDraining: () => boolean;
  versionInfo: typeof APP_VERSION_INFO;
}

export function platformRequiresRuntimeSchema(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.RUNTIME_SCHEMA_DDL === 'false';
}

export async function assertPlatformRuntimeSchema(
  pool: Pick<Pool, 'query'> | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!platformRequiresRuntimeSchema(env)) return;
  if (!pool) throw new Error('Platform production schema gate requires PostgreSQL');
  await assertRuntimeSchema({
    pool,
    expectedMigration: env.EXPECTED_SCHEMA_MIGRATION,
    expectedChecksum: env.EXPECTED_SCHEMA_CHECKSUM,
  });
}

export function createPlatformRuntime(options: CreatePlatformRuntimeOptions = {}): PlatformRuntime {
  const port = Number(process.env.PLATFORM_PORT) || 3002;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redisDb = Number(process.env.REDIS_DB) || 0;
  const configuredRedisMode = process.env.PLATFORM_REDIS_MODE;
  const redisMode = resolvePlatformRedisMode(configuredRedisMode, process.env.NODE_ENV);
  const corsOrigins = resolvePlatformCorsOrigins(process.env.ALLOWED_ORIGINS);
  const versionInfo = Object.freeze({
    appVersion: process.env.APP_VERSION || APP_VERSION_INFO.appVersion,
    buildId: process.env.APP_BUILD_ID || APP_VERSION_INFO.buildId,
    rulesVersion: process.env.GAME_RULES_VERSION || APP_VERSION_INFO.rulesVersion,
  });

  if (configuredRedisMode?.trim() && !isPlatformRedisMode(configuredRedisMode)) {
    logger.warn({ mode: configuredRedisMode }, 'unknown PLATFORM_REDIS_MODE, falling back to environment default');
  }

  const httpServer = http.createServer();
  const trustedProxy = process.env.TRUSTED_PROXY;
  // WebSocketTransport handles upgrade events outside Express. Canonicalize
  // forwarding headers before its listener runs so room AuthContext never
  // receives an attacker-controlled X-Forwarded-For/X-Real-IP value.
  httpServer.prependListener('upgrade', (request) => {
    const ip = platformAdmissionClientIp(
      request.socket.remoteAddress,
      request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'] ?? request.headers['x-client-ip'],
      trustedProxy,
    );
    if (ip) {
      request.headers['x-forwarded-for'] = ip;
      request.headers['x-real-ip'] = ip;
    }
  });
  const colyseusRedisUrl = redisUrlWithDb(redisUrl, redisDb);
  const friendStore = createPlatformFriendStoreFromEnv();
  const blockStore = createPlatformBlockStoreFromEnv();
  const matchParticipantStore = createPlatformMatchParticipantStoreFromEnv();
  const chatPreviewStore = createPlatformChatPreviewStoreFromEnv();
  const friendStoreMode = resolvePlatformFriendStoreMode();
  const blockStoreMode = resolvePlatformBlockStoreMode();
  const matchParticipantStoreMode = resolvePlatformMatchParticipantStoreMode();
  const chatPreviewStoreMode = resolvePlatformChatPreviewStoreMode();

  // PostgreSQL is also the durable JWT revocation authority. Production must
  // keep this pool even if an operator accidentally disables every PG-backed store.
  const usesPostgres =
    friendStoreMode === 'postgres' ||
    blockStoreMode === 'postgres' ||
    matchParticipantStoreMode === 'postgres' ||
    chatPreviewStoreMode === 'postgres';
  const requiresPostgres = usesPostgres || process.env.NODE_ENV === 'production';
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    `postgres://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || ''}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE || 'postgres'}`;
  const authPoolMax = Math.min(20, Math.max(1, Number(process.env.PLATFORM_AUTH_DB_POOL_MAX) || 8));
  const authQueryTimeoutMs = Math.min(
    5_000,
    Math.max(100, Number(process.env.PLATFORM_AUTH_DB_QUERY_TIMEOUT_MS) || 1_500),
  );
  const healthPool = requiresPostgres
    ? new Pool({
        connectionString: databaseUrl,
        max: authPoolMax,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 3_000,
        query_timeout: authQueryTimeoutMs,
        statement_timeout: authQueryTimeoutMs,
      })
    : null;
  const healthRedis =
    redisMode === 'redis' ? new Redis(colyseusRedisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true }) : null;
  // The API service writes access-token revocation markers to this shared DB.
  // Keep a dedicated command connection so health checks/Colyseus presence do
  // not starve authentication reads, and make the verifier fail closed when
  // this dependency is unavailable.
  const admissionLimits = platformAdmissionLimitsFromEnv();
  const authRevocationRedis =
    redisMode === 'redis'
      ? new Redis(colyseusRedisUrl, {
          maxRetriesPerRequest: 1,
          enableReadyCheck: true,
          commandTimeout: admissionLimits.timeoutMs,
        })
      : null;
  const runtimeSchemaRequired = platformRequiresRuntimeSchema();
  const schemaReady = assertPlatformRuntimeSchema(healthPool);
  // server.ts awaits this before listen; attach a handler immediately so a
  // synchronous configuration rejection cannot become an unhandled promise.
  void schemaReady.catch(() => undefined);
  healthRedis?.on('error', (err) => logger.warn({ err }, 'platform health Redis connection error'));
  authRevocationRedis?.on('error', (err) => logger.warn({ err }, 'platform auth Redis connection error'));
  configurePlatformJwtRevocationStore(authRevocationRedis, { timeoutMs: admissionLimits.timeoutMs });
  configurePlatformJwtAccountStore(healthPool ? createPostgresPlatformJwtAccountStore(healthPool) : null, {
    required: requiresPostgres,
  });
  const admissionLimiter = createPlatformAdmissionLimiter(authRevocationRedis, {
    nodeEnv: process.env.NODE_ENV,
    limits: admissionLimits,
  });

  async function checkHealth(): Promise<{ ok: boolean; errors: string[]; checks: Record<string, string> }> {
    const checks: { name: string; promise: Promise<unknown> }[] = [];
    if (healthPool) {
      checks.push({
        name: 'postgres',
        promise: healthPool.query('SELECT auth_version, deleted_at FROM users LIMIT 1'),
      });
    }
    if (runtimeSchemaRequired) checks.push({ name: 'schema', promise: schemaReady });
    if (healthRedis) checks.push({ name: 'redis', promise: healthRedis.ping() });
    if (checks.length === 0) return { ok: true, errors: [], checks: {} };

    const results = await Promise.allSettled(checks.map((c) => c.promise));
    const errors: string[] = [];
    const statuses: Record<string, string> = {};
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        recordPlatformDependencyFailure(checks[i].name);
        statuses[checks[i].name] = 'down';
        errors.push(`${checks[i].name}: ${reason}`);
      } else {
        statuses[checks[i].name] = 'up';
      }
    });
    return { ok: errors.length === 0, errors, checks: statuses };
  }

  const readiness = createServiceReadiness(async () => {
    const result = await checkHealth();
    return { ok: result.ok, checks: result.checks };
  });

  LobbyRoom.configureFriendStore(friendStore);
  InviteRoom.configureFriendStore(friendStore, { enforceFriendship: friendStoreMode === 'postgres' });
  QuickMatchRoom.configureBlockStore(blockStore);
  CustomRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureChatPreviewStore(chatPreviewStore);

  const closeStores = async () => {
    await Promise.all([
      friendStore.close?.(),
      blockStore.close?.(),
      matchParticipantStore.close?.(),
      chatPreviewStore.close?.(),
      healthPool?.end(),
      healthRedis?.quit(),
      authRevocationRedis?.quit(),
    ]);
    configurePlatformJwtRevocationStore(null);
    configurePlatformJwtAccountStore(null);
    QuickMatchRoom.configureBlockStore(null);
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
      app.use(
        createPlatformAdmissionMiddleware({
          limiter: admissionLimiter,
          trustedProxy,
        }),
      );
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
      app.get('/ready', async (_req, res) => {
        const result = await readiness.check();
        res
          .status(result.ok ? 200 : 503)
          .set('Cache-Control', 'no-store')
          .json({ ok: result.ok, status: result.status, checks: result.checks });
      });
      app.get('/api/version', (_req, res) => {
        res.set('Cache-Control', 'no-store').json(versionInfo);
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

  const configuredDrainGraceMs = Number(process.env.PLATFORM_DRAIN_GRACE_MS);
  const drainGraceMs = Number.isFinite(configuredDrainGraceMs) ? Math.max(0, configuredDrainGraceMs) : 5_000;
  gameServer.onBeforeShutdown(async () => {
    if (!readiness.beginDrain() || drainGraceMs === 0) return;
    await new Promise((resolve) => setTimeout(resolve, drainGraceMs));
  });

  return {
    gameServer,
    httpServer,
    port,
    redisMode,
    friendStoreMode,
    blockStoreMode,
    matchParticipantStoreMode,
    chatPreviewStoreMode,
    closeStores,
    schemaReady,
    beginDrain: readiness.beginDrain,
    isDraining: readiness.isDraining,
    versionInfo,
  };
}
