import http from 'http';
import { Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { NextFunction, Request, Response } from 'express';
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

  LobbyRoom.configureFriendStore(friendStore);
  InviteRoom.configureFriendStore(friendStore, { enforceFriendship: friendStoreMode === 'postgres' });
  CustomRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureParticipantStore(matchParticipantStore);
  MatchShellRoom.configureChatPreviewStore(chatPreviewStore);

  const closeStores = async () => {
    await Promise.all([friendStore.close?.(), matchParticipantStore.close?.(), chatPreviewStore.close?.()]);
  };

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => {
      app.use((req: Request, res: Response, next: NextFunction) => {
        const corsOrigin = resolvePlatformCorsOrigin(req.headers.origin, corsOrigins);
        if (corsOrigin) {
          res.set('Access-Control-Allow-Origin', corsOrigin);
          res.set('Vary', 'Origin');
          res.set('Access-Control-Allow-Credentials', 'true');
        }
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
          return;
        }
        next();
      });
      app.get('/health', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ ok: true, service: 'platform' });
      });
      app.get('/ready', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ ok: true });
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
