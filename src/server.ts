import { ZutomayoOnlineCard, resetParsedEffects } from './game/Game';
import { initCards } from './game/cards/loader';
import { initEffectI18n } from './game/cards/i18n';
import type { CardDef } from './game/types';
import { APP_VERSION_INFO, isCompatibleVersion, normalizeVersionInfo, type AppVersionInfo } from './version';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import type { Next, ParameterizedContext } from 'koa';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { Pool } from 'pg';
import { PostgresAdapter } from './server/db/postgres-adapter';
import { RedisPubSub } from './server/transport/redis-pubsub';
import * as Sentry from '@sentry/node';
import helmet from 'koa-helmet';
import { logger, requestLoggingMiddleware } from './server/observability/logger';
import { metricsMiddleware, metricsEndpoint, activeSocketConnections } from './server/observability/metrics';
import { createRateLimit } from './server/rateLimit';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import { createPlatformSeatToken } from './platform/seatToken';

const require = createRequire(import.meta.url);
const { Server, SocketIO } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const koaBody = require('koa-body') as typeof import('koa-body');

// 擴充 Koa context 以涵蓋 koa-body（request.body）與 @koa/router（params）注入的屬性。
interface KoaContext extends ParameterizedContext {
  params: Record<string, string>;
  request: ParameterizedContext['request'] & { body?: unknown };
}

type VersionedPlayerData = Record<string, unknown> & { clientVersion?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function versionFromData(value: unknown): AppVersionInfo | null {
  return normalizeVersionInfo(isRecord(value) ? value.clientVersion : null);
}

function setupVersion(metadata: { setupData?: unknown } | undefined): AppVersionInfo | null {
  return versionFromData(isRecord(metadata?.setupData) ? metadata.setupData : null);
}

function compatibleClientVersion(value: unknown): AppVersionInfo | null {
  const version = normalizeVersionInfo(value);
  return version && isCompatibleVersion(version) ? version : null;
}

function playerDataWithVersion(data: unknown, version: AppVersionInfo): VersionedPlayerData {
  return {
    ...(isRecord(data) ? data : {}),
    clientVersion: version,
  };
}

function firstAvailablePlayerID(players: Record<string | number, { name?: string } | undefined>): string | undefined {
  return Object.keys(players)
    .sort((a, b) => Number(a) - Number(b))
    .find((id) => !players[id]?.name);
}

function authenticateVersionedCredentials(
  credentials: string,
  playerMetadata?: { credentials?: string; data?: VersionedPlayerData },
): boolean {
  if (!credentials || !playerMetadata?.credentials || credentials !== playerMetadata.credentials) return false;
  return Boolean(compatibleClientVersion(playerMetadata.data?.clientVersion));
}

// GlitchTip/Sentry error tracking — no-op when SENTRY_DSN is unset.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // 支援 staging/preview 等環境：若顯式設定 SENTRY_ENVIRONMENT 則優先使用。
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: `${APP_VERSION_INFO.appVersion}@${APP_VERSION_INFO.buildId}`,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    // GlitchTip 不支援 session replay；@sentry/node 10.x 不再支援 autoSessionTracking 選項。
    normalizeDepth: 5,
    sendDefaultPii: false,
    beforeSend(event) {
      // 移除 request 中的敏感 header / cookie / body，避免 token / 密碼外洩。
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
    initialScope: {
      tags: {
        service: 'game',
        app: 'zutomayo-card',
      },
    },
  });
}

const configuredOrigins =
  process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

// /metrics 端點 bearer token 認證：未設定 METRICS_TOKEN 時 warn 但允許存取（開發模式）；
// 已設定則檢查 Authorization: Bearer <token>，不符回 401。
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';
let metricsTokenWarned = false;
function checkMetricsAuth(authorization: string | undefined): boolean {
  if (!METRICS_TOKEN) {
    if (!metricsTokenWarned && process.env.NODE_ENV === 'production') {
      logger.warn('METRICS_TOKEN not set - /metrics accessible without auth');
      metricsTokenWarned = true;
    }
    return true;
  }
  return authorization === `Bearer ${METRICS_TOKEN}`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const adminRoot = path.join(root, 'admin');

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// 復用服務器既有 Redis 時用 REDIS_DB 切到獨立 DB index（0-15）避免與其他服務的 key 衝突。
// duplicate() 會繼承此選項，因此 redisAdapterSubClient / redisPubSubSubClient 也用同一 DB。
const REDIS_DB = Number(process.env.REDIS_DB) || 0;

// === 水平擴展基礎建設 ===
// boardgame.io 多實例需要兩個獨立的跨節點層：
//   1. Socket.IO adapter（@socket.io/redis-adapter）：連線層 rooms/sockets 同步
//   2. boardgame.io PubSub（RedisPubSub）：應用層 sendAll payload 廣播
// 兩者皆透過 transport 注入，缺一不可。
// DB 改用 PostgresAdapter（自實作 StorageAPI.Async），解決 FlatFile 每次 move 寫整個 state 到磁碟的 I/O 瓶頸。

// 共用 publish 連線（publish 不會進入 subscribe 模式，可安全共用）。
const redisPubClient = new Redis(REDIS_URL, { db: REDIS_DB });
// Socket.IO adapter 專屬 subscribe 連線。
const redisAdapterSubClient = redisPubClient.duplicate();
// boardgame.io PubSub 專屬 subscribe 連線。
const redisPubSubSubClient = redisPubClient.duplicate();

const socketIoAdapter = createAdapter(redisPubClient, redisAdapterSubClient);
const redisPubSub = new RedisPubSub<unknown>({
  pubClient: redisPubClient,
  subClient: redisPubSubSubClient,
});

// PostgresAdapter duck-type 相容於 StorageAPI.Async（type()=1 + 6 方法齊全），
// RedisPubSub 結構相容於 GenericPubSub<IntermediateTransportData>，
// 但兩者因不繼承 boardgame.io 內部抽象類別 / 泛型不公開，TS 無法自動判定相容，
// 用結構化斷言注入。
type ServerOpts = NonNullable<Parameters<typeof Server>[0]>;
type SocketOpts = NonNullable<ConstructorParameters<typeof SocketIO>[0]>;

const transport = new SocketIO({
  socketAdapter: socketIoAdapter,
  pubSub: redisPubSub,
} as SocketOpts);

const db = new PostgresAdapter();

// === 卡牌資料初始化（從 PostgreSQL 載入）===
// 卡牌資料的 source of truth 是 PG 的 cards / card_effects_i18n 表（由 api 服務
// 的 seed-cards-pg.ts 或 admin 上傳寫入）。game 服務的 boardgame.io server-side
// 邏輯需要卡牌定義來初始化牌組，啟動時直接從 PG 讀取，不依賴檔案系統靜態卡表。
// 瀏覽器端則透過 /api/cards 動態載入（參見 App.tsx refreshCards）。
const cardPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'postgres',
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const CARD_SELECT_SQL = `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata FROM cards ORDER BY id`;

function cardRowToDef(row: Record<string, unknown>): CardDef {
  const def: CardDef = {
    id: row.id as string,
    name: row.name as string,
    pack: row.pack as string,
    song: (row.song as string) || '',
    illustrator: (row.illustrator as string) || '',
    rarity: (row.rarity as string) || '',
    element: row.element as CardDef['element'],
    type: row.type as CardDef['type'],
    clock: (row.clock as number) ?? 0,
    attack:
      row.attack_night === null ||
      row.attack_night === undefined ||
      row.attack_day === null ||
      row.attack_day === undefined
        ? null
        : { night: row.attack_night as number, day: row.attack_day as number },
    powerCost: (row.power_cost as number) ?? 0,
    sendToPower: (row.send_to_power as number) ?? 0,
    effect: (row.effect as string) || '',
    image: (row.image as string) || '',
    errata: (row.errata as string) || '',
  };
  if (row.en_name_official) def.enNameOfficial = row.en_name_official as string;
  if (row.en_effect_official) def.enEffectOfficial = row.en_effect_official as string;
  return def;
}

async function loadCardsFromPG(): Promise<void> {
  const { rows } = await cardPool.query(CARD_SELECT_SQL);
  if (rows.length === 0) throw new Error('PG cards table is empty — run npm run seed:cards first');
  const cards = rows.map((row) => cardRowToDef(row as Record<string, unknown>));
  initCards(cards);
  resetParsedEffects();
  logger.info({ count: cards.length }, 'loaded cards from PostgreSQL');

  const i18nRows = await cardPool.query(
    'SELECT card_id, lang, effect_text FROM card_effects_i18n ORDER BY card_id, lang',
  );
  const i18n: Record<string, Record<string, string>> = {};
  for (const row of i18nRows.rows) {
    const r = row as { card_id: string; lang: string; effect_text: string };
    if (!i18n[r.card_id]) i18n[r.card_id] = {};
    i18n[r.card_id][r.lang] = typeof r.effect_text === 'string' ? r.effect_text : '';
  }
  initEffectI18n(i18n);
  logger.info({ count: Object.keys(i18n).length }, 'loaded card i18n entries from PostgreSQL');
}

const API_SERVER = process.env.API_URL || 'http://api:3001';

async function verifyAdminReloadToken(authorization: string | undefined): Promise<boolean> {
  if (!authorization) return false;
  try {
    const response = await fetch(new URL('/api/admin/cards/reload', API_SERVER), {
      method: 'POST',
      headers: { Authorization: authorization },
    });
    return response.ok;
  } catch {
    return false;
  }
}

const server = Server({
  games: [ZutomayoOnlineCard],
  db: db as unknown as NonNullable<ServerOpts['db']>,
  transport,
  origins: ['http://localhost:3000', /localhost:\d+/, /127\.0\.0\.1:\d+/, ...configuredOrigins],
  authenticateCredentials: authenticateVersionedCredentials,
});

function safeStaticFile(baseDir: string, requestPath: string, routePrefix: string): string | null {
  const relativePath = requestPath.slice(routePrefix.length).replace(/^\/+/, '');
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBase, relativePath);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) return null;
  return resolvedPath;
}

server.app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: [
          "'self'",
          'https://r2.dan.tw',
          'https://www.gravatar.com',
          'https://cravatar.cn',
          'https://q1.qlogo.cn',
          'data:',
          'blob:',
        ],
        connectSrc: ["'self'", 'wss:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// Structured request logging + Prometheus metrics (before route handlers).
server.app.use(requestLoggingMiddleware());
server.app.use(metricsMiddleware());
// Rate limit boardgame.io lobby routes (/games/*) to prevent match flooding. /api/* is
// proxied to the API server which has its own rate limiter; static assets are exempt.
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path.startsWith('/games/')) {
    return createRateLimit({ redis: redisPubClient, limit: 120, namespace: 'game' })(ctx, next);
  }
  await next();
});

server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/metrics' && ctx.method === 'GET') {
    if (!checkMetricsAuth(ctx.request.headers.authorization)) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }
    return metricsEndpoint()(ctx, next);
  }
  await next();
});

server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/health') {
    const checks: Record<string, string> = {};
    let allOk = true;
    try {
      await cardPool.query('SELECT 1');
      checks.postgres = 'up';
    } catch {
      checks.postgres = 'down';
      allOk = false;
    }
    try {
      await redisPubClient.ping();
      checks.redis = 'up';
    } catch {
      checks.redis = 'down';
      allOk = false;
    }
    ctx.status = allOk ? 200 : 503;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { status: allOk ? 'ok' : 'degraded', checks };
    return;
  }
  await next();
});

server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/api/app-version') {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = APP_VERSION_INFO;
    return;
  }
  if (ctx.path === '/api/admin/cards/reload' && ctx.method === 'POST') {
    const authorization = firstHeaderValue(ctx.request.headers.authorization);
    if (!(await verifyAdminReloadToken(authorization))) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }
    await loadCardsFromPG();
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { ok: true, version: APP_VERSION_INFO };
    return;
  }
  await next();
});

server.router.post('/games/zutomayo-card/:id/resume', koaBody(), async (ctx: KoaContext) => {
  const matchID = ctx.params.id;
  const body = (ctx.request.body ?? {}) as { playerID?: unknown; credentials?: unknown; clientVersion?: unknown };
  const playerID = body.playerID;
  const credentials = body.credentials;
  const clientVersion = compatibleClientVersion(body.clientVersion);

  if (playerID !== '0' && playerID !== '1') ctx.throw(403, 'playerID is required');
  if (typeof credentials !== 'string') ctx.throw(403, 'credentials are required');
  if (!clientVersion) ctx.throw(426, 'Client version does not match server game version');

  // 通過檢查後收窄型別：playerID 為 '0' | '1'，credentials 為 string。
  const typedPlayerID = playerID as '0' | '1';
  const typedCredentials = credentials as string;

  const { metadata } = await server.db.fetch(matchID, { metadata: true });
  if (!metadata) ctx.throw(404, 'Match ' + matchID + ' not found');
  if (!isCompatibleVersion(setupVersion(metadata))) ctx.throw(426, 'Room version does not match server game version');

  const player = metadata.players[typedPlayerID];
  if (!player) ctx.throw(404, 'Player ' + typedPlayerID + ' not found');
  if (!player.name || !player.credentials) ctx.throw(409, 'Player ' + typedPlayerID + ' not reserved');
  if (!isCompatibleVersion(versionFromData(player.data)))
    ctx.throw(426, 'Seat version does not match server game version');

  const isAuthorized = await server.auth.authenticateCredentials({
    playerID: typedPlayerID,
    credentials: typedCredentials,
    metadata,
  });
  if (!isAuthorized) ctx.throw(409, 'Player ' + typedPlayerID + ' not available');

  ctx.body = {
    matchID,
    playerID: typedPlayerID,
    platformSeatToken: createPlatformSeatToken({ matchID, playerID: typedPlayerID }),
  };
});

server.router.post('/games/zutomayo-card/:id/join', koaBody(), async (ctx: KoaContext) => {
  const matchID = ctx.params.id;
  const body = (ctx.request.body ?? {}) as {
    playerID?: unknown;
    playerName?: unknown;
    data?: unknown;
    clientVersion?: unknown;
  };
  let playerID = body.playerID;
  const playerName = body.playerName;
  const clientVersion = compatibleClientVersion(
    body.clientVersion ?? (isRecord(body.data) ? body.data.clientVersion : null),
  );

  if (typeof playerName !== 'string' || !playerName) ctx.throw(403, 'playerName is required');
  if (!clientVersion) ctx.throw(426, 'Client version does not match server game version');
  const typedPlayerName = playerName as string;
  const typedClientVersion = clientVersion as AppVersionInfo;

  const { metadata } = await server.db.fetch(matchID, { metadata: true });
  if (!metadata) ctx.throw(404, 'Match ' + matchID + ' not found');
  if (!isCompatibleVersion(setupVersion(metadata))) ctx.throw(426, 'Room version does not match server game version');

  const existingPlayers = Object.values(metadata.players);
  const existingMismatch = existingPlayers.some(
    (player) => player?.name && !isCompatibleVersion(versionFromData(player.data)),
  );
  if (existingMismatch) ctx.throw(426, 'Opponent version does not match server game version');

  if (playerID === undefined || playerID === null) {
    playerID = firstAvailablePlayerID(metadata.players);
    if (playerID === undefined) {
      ctx.throw(409, `Match ${matchID} reached maximum number of players (${existingPlayers.length})`);
    }
  }

  if (playerID !== '0' && playerID !== '1' && playerID !== 0 && playerID !== 1) {
    ctx.throw(404, 'Player ' + String(playerID) + ' not found');
  }

  const typedPlayerID = String(playerID) as '0' | '1';
  const player = metadata.players[typedPlayerID];
  if (!player) ctx.throw(404, 'Player ' + typedPlayerID + ' not found');
  if (player.name) ctx.throw(409, 'Player ' + typedPlayerID + ' not available');

  player.data = playerDataWithVersion(body.data, typedClientVersion);
  player.name = typedPlayerName;
  const playerCredentials = await server.auth.generateCredentials(ctx);
  player.credentials = playerCredentials;

  await server.db.setMetadata(matchID, metadata);

  ctx.body = {
    playerID: typedPlayerID,
    playerCredentials,
    platformSeatToken: createPlatformSeatToken({ matchID, playerID: typedPlayerID }),
  };
});

// Serve dist (frontend)
server.app.use(serve(path.join(root, 'dist')));

// Serve admin panel assets for the React /admin iframe.
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/admin/index.html' || ctx.path.startsWith('/admin/')) {
    const filePath = safeStaticFile(adminRoot, ctx.path, '/admin');
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
      };
      ctx.type = types[ext] || 'application/octet-stream';
      ctx.body = fs.readFileSync(filePath);
      return;
    }
  }
  await next();
});

// API proxy — forward /api/* to the API server
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const HOP_BY_HOP_PROXY_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const IMGPROXY_PROXY_FORWARD_HEADERS = ['accept', 'if-none-match', 'if-modified-since', 'if-range', 'range'];

function setProxyResponseHeaders(ctx: KoaContext, responseHeaders: IncomingHttpHeaders): void {
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (value === undefined || HOP_BY_HOP_PROXY_HEADERS.has(name.toLowerCase())) continue;
    ctx.set(name, value);
  }
}

function forwardOptionalRequestHeader(
  requestHeaders: Record<string, string>,
  sourceHeaders: IncomingHttpHeaders,
  name: string,
): void {
  const value = firstHeaderValue(sourceHeaders[name]);
  if (value) requestHeaders[name] = value;
}

server.app.use(async (ctx: KoaContext, next: Next) => {
  if (!ctx.path.startsWith('/api/')) return next();

  const http = await import('http');
  const url = new URL(ctx.path, API_SERVER);
  url.search = ctx.search;
  const shouldStreamImageProxy =
    ctx.path.startsWith('/api/imgproxy/') && (ctx.method === 'GET' || ctx.method === 'HEAD');

  // Read raw body from stream (koa-body may not be applied globally)
  let rawBody = '';
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    rawBody = Buffer.concat(chunks).toString('utf-8');
  }

  const authorization = firstHeaderValue(ctx.request.headers.authorization);
  const forwardedFor = [firstHeaderValue(ctx.request.headers['x-forwarded-for']), ctx.ip]
    .filter((value): value is string => Boolean(value))
    .join(', ');
  const requestHeaders: Record<string, string> = {
    host: url.host,
    'x-forwarded-for': forwardedFor,
    'x-forwarded-host': firstHeaderValue(ctx.request.headers.host) || ctx.host,
    'x-forwarded-proto': ctx.protocol,
  };
  const contentType = firstHeaderValue(ctx.request.headers['content-type']);
  if (contentType) {
    requestHeaders['content-type'] = contentType;
  } else if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    requestHeaders['content-type'] = 'application/json';
  }
  if (authorization) requestHeaders.authorization = authorization;
  const cookie = firstHeaderValue(ctx.request.headers.cookie);
  if (cookie) requestHeaders.cookie = cookie;
  if (shouldStreamImageProxy) {
    for (const name of IMGPROXY_PROXY_FORWARD_HEADERS) {
      forwardOptionalRequestHeader(requestHeaders, ctx.request.headers, name);
    }
  }
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    requestHeaders['content-length'] = rawBody ? String(Buffer.byteLength(rawBody)) : '0';
  }

  return new Promise<void>((resolve) => {
    let responseStarted = false;
    let proxyResStream: IncomingMessage | null = null;
    const proxyReq = http.request(
      url,
      {
        method: ctx.method,
        headers: requestHeaders,
        timeout: 10000,
      },
      (proxyRes) => {
        responseStarted = true;
        proxyResStream = proxyRes;
        ctx.status = proxyRes.statusCode || 200;
        const responseHeaders = proxyRes.headers;
        setProxyResponseHeaders(ctx, responseHeaders);
        if (!responseHeaders['content-type'])
          ctx.set('Content-Type', shouldStreamImageProxy ? 'application/octet-stream' : 'application/json');
        if (shouldStreamImageProxy) {
          if (ctx.method === 'HEAD') {
            proxyRes.resume();
            ctx.body = null;
          } else {
            proxyRes.on('error', (err: Error) => {
              Sentry.captureException(err, { tags: { layer: 'api-proxy', route: ctx.path } });
            });
            ctx.body = proxyRes;
          }
          resolve();
          return;
        }

        const resChunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => resChunks.push(chunk));
        proxyRes.on('end', () => {
          ctx.body = Buffer.concat(resChunks);
          resolve();
        });
      },
    );

    const abortProxyRequest = () => {
      if (ctx.res.writableEnded) return;
      proxyReq.destroy();
      proxyResStream?.destroy();
    };
    ctx.req.on('aborted', abortProxyRequest);
    ctx.res.on('close', abortProxyRequest);

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      ctx.status = 504;
      ctx.body = JSON.stringify({ error: 'API server timeout' });
      resolve();
    });

    proxyReq.on('error', (err: Error) => {
      if (responseStarted) return;
      Sentry.captureException(err, { tags: { layer: 'api-proxy', route: ctx.path } });
      ctx.status = 502;
      ctx.body = JSON.stringify({ error: 'API server unavailable' });
      resolve();
    });

    if (rawBody) {
      proxyReq.write(rawBody);
    }
    proxyReq.end();
  });
});

// Serve the Vite app for client-side routes.
// boardgame.io 的 lobby API 路由（/games/:name/create 等）在 server.run() 時才透過
// configureApp 掛載到 app，位於此中間件之後。因此 /games/ 路徑必須 await next()
// 讓請求繼續到 boardgame.io router，否則 createMatch/join 等都會被擋成 404。
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.status === 404 && !ctx.path.startsWith('/games/')) {
    ctx.type = 'html';
    ctx.body = fs.readFileSync(path.join(root, 'dist', 'index.html'));
    return;
  }
  await next();
});

const PORT = Number(process.env.PORT) || 3000;
const STALE_MATCH_TTL_MS = Number(process.env.STALE_MATCH_TTL_MS) || 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 5 * 60 * 1000; // every 5 min
const JWT_SECRET = process.env.JWT_SECRET;

// 安全性驗證：JWT_SECRET 必須在生產環境設定
function validateSecurityConfig(): void {
  if (!JWT_SECRET) {
    logger.fatal('JWT_SECRET environment variable is required');
    logger.fatal('Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  if (JWT_SECRET.length < 32) {
    logger.warn('JWT_SECRET should be at least 32 characters for security');
  }
}

// Stale room cleanup — 直接使用 PostgresAdapter instance（server.db 型別因斷言後不夠精確）。
async function cleanupStaleMatches() {
  try {
    const matchIDs = await db.listMatches({});
    if (!matchIDs || !Array.isArray(matchIDs)) return;
    let cleaned = 0;
    for (const matchID of matchIDs) {
      try {
        const { metadata } = await db.fetch(matchID, { metadata: true });
        if (!metadata) continue;
        const updatedAt = metadata.updatedAt ? new Date(metadata.updatedAt).getTime() : 0;
        const createdAt = metadata.createdAt ? new Date(metadata.createdAt).getTime() : 0;
        const age = Date.now() - Math.max(createdAt, updatedAt);
        if (age > STALE_MATCH_TTL_MS) {
          await db.wipe(matchID);
          cleaned++;
        }
      } catch {
        /* skip */
      }
    }
    if (cleaned > 0) logger.info({ count: cleaned }, 'removed stale matches');
  } catch (err) {
    logger.error({ err }, 'cleanup error');
    Sentry.captureException(err);
  }
}

setInterval(cleanupStaleMatches, CLEANUP_INTERVAL_MS);
logger.info(
  { ttlMin: STALE_MATCH_TTL_MS / 60000, intervalMin: CLEANUP_INTERVAL_MS / 60000 },
  'stale match cleanup configured',
);

// Graceful shutdown：關閉 PG pool 與 Redis 連線，避免重啟時連線洩漏。
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown received, closing connections');
  try {
    await Promise.all([
      db.close(),
      cardPool.end(),
      redisPubSub.close(),
      redisPubClient.quit(),
      redisAdapterSubClient.quit(),
      Sentry.close(2000),
    ]);
  } catch (err) {
    logger.error({ err }, 'shutdown error');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// 啟動流程：先從 PG 載入卡牌資料（boardgame.io setup 需要卡牌定義），再啟動伺服器。
// PG 不可用時重試 5 次（間隔 2 秒），仍失敗則退出 — 卡牌未載入時 createMatch 會崩潰。
async function bootstrap(): Promise<void> {
  validateSecurityConfig();

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await loadCardsFromPG();
      break;
    } catch (err) {
      logger.error({ err, attempt }, 'failed to load cards from PG');
      if (attempt === 5) {
        logger.fatal('giving up — cards are required for game logic. Exiting.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  server.run(PORT, () => {
    logger.info({ port: PORT }, 'Zutomayo Card server running');

    // Best-effort Socket.IO per-IP connection limiting to mitigate connection floods.
    // boardgame.io transport structure is not part of the public API; access defensively.
    try {
      type SocketLike = {
        id: string;
        handshake: { address: string };
        on: (event: string, cb: (err?: Error) => void) => void;
        disconnect: (close?: boolean) => void;
      };
      const transport = server.transport as unknown as {
        io?: {
          on: (event: string, cb: (socket: SocketLike) => void) => void;
        };
      };
      const io = transport.io;
      if (io) {
        const MAX_CONN_PER_IP = 10;
        const connectionsPerIp = new Map<string, number>();
        io.on('connection', (socket: SocketLike) => {
          const ip = socket.handshake.address;
          const current = connectionsPerIp.get(ip) ?? 0;
          if (current >= MAX_CONN_PER_IP) {
            socket.disconnect(true);
            return;
          }
          connectionsPerIp.set(ip, current + 1);
          activeSocketConnections.inc();
          socket.on('disconnect', () => {
            const c = connectionsPerIp.get(ip) ?? 0;
            if (c <= 1) connectionsPerIp.delete(ip);
            else connectionsPerIp.set(ip, c - 1);
            activeSocketConnections.dec();
          });
          // Socket 層錯誤上報 Sentry，帶 socket_id tag 便於追蹤單一連線問題。
          socket.on('error', (err?: Error) => {
            if (err) {
              Sentry.captureException(err, {
                tags: { layer: 'socket.io', socket_id: socket.id },
              });
            }
          });
        });
        logger.info({ maxPerIp: MAX_CONN_PER_IP }, 'socket.io per-IP connection limiter attached');
      } else {
        logger.warn('socket.io instance not accessible on transport; connection limiter skipped');
      }
    } catch (err) {
      logger.warn({ err }, 'failed to attach socket.io connection limiter');
    }
  });
}

void bootstrap();
