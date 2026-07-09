import http from 'http';
import { Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import * as Sentry from '@sentry/node';
import { LobbyRoom, MatchShellRoom } from './rooms';
import { platformLogger as logger } from './logger';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: `${process.env.APP_VERSION || '0.0.0'}@${process.env.APP_BUILD_ID || 'local'}`,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
    initialScope: {
      tags: {
        service: 'platform',
        app: 'zutomayo-card',
      },
    },
  });
}

const PLATFORM_PORT = Number(process.env.PLATFORM_PORT) || 3002;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const REDIS_DB = Number(process.env.REDIS_DB) || 0;
const PLATFORM_REDIS_MODE = resolveRedisMode(process.env.PLATFORM_REDIS_MODE, process.env.NODE_ENV);

function resolveRedisMode(value: string | undefined, nodeEnv: string | undefined): 'memory' | 'redis' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'memory' || normalized === 'redis') return normalized;
  if (normalized) {
    logger.warn({ mode: value }, 'unknown PLATFORM_REDIS_MODE, falling back to environment default');
  }
  return nodeEnv === 'production' ? 'redis' : 'memory';
}

function redisUrlWithDb(url: string, db: number): string {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = `/${db}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

const httpServer = http.createServer();

const colyseusRedisUrl = redisUrlWithDb(REDIS_URL, REDIS_DB);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: (app) => {
    app.get('/health', (_req, res) => {
      res.set('Cache-Control', 'no-store').json({ ok: true, service: 'platform' });
    });
    app.get('/ready', (_req, res) => {
      res.set('Cache-Control', 'no-store').json({ ok: true });
    });
  },
  ...(PLATFORM_REDIS_MODE === 'redis'
    ? {
        presence: new RedisPresence(colyseusRedisUrl),
        driver: new RedisDriver(colyseusRedisUrl),
      }
    : {}),
  greet: false,
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('match_shell', MatchShellRoom).filterBy(['boardgameMatchID', 'status']);

gameServer.onShutdown(() => {
  logger.info('platform server shutting down');
});

process.on('uncaughtException', (err) => {
  Sentry.captureException(err, { tags: { layer: 'platform-process', type: 'uncaughtException' } });
  logger.fatal({ err }, 'uncaught platform exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason, { tags: { layer: 'platform-process', type: 'unhandledRejection' } });
  logger.error({ err: reason }, 'unhandled platform rejection');
});

await gameServer.listen(PLATFORM_PORT);
logger.info({ port: PLATFORM_PORT, redisMode: PLATFORM_REDIS_MODE }, 'Zutomayo platform server running');
