import { ZutomayoCard, resetParsedEffects } from './game/Game';
import { initCards } from './game/cards/loader';
import { initEffectI18n } from './game/cards/i18n';
import type { CardDef } from './game/types';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import type { DefaultContext, Next } from 'koa';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { PostgresAdapter } from './server/db/postgres-adapter';
import { RedisPubSub } from './server/transport/redis-pubsub';

const require = createRequire(import.meta.url);
const { Server, SocketIO } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const koaBody = require('koa-body') as typeof import('koa-body');

// 擴充 Koa context 以涵蓋 koa-body（request.body）與 @koa/router（params）注入的屬性。
interface KoaContext extends DefaultContext {
  params: Record<string, string>;
  request: DefaultContext['request'] & { body?: unknown };
}

const configuredOrigins =
  process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

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

// === 卡牌資料初始化 ===
// 遊戲伺服器從檔案系統載入卡牌數據供 boardgame.io server-side 遊戲邏輯使用。
// 瀏覽器端則透過 API 動態載入（參見 App.tsx refreshCards）。
try {
  const cardsPath = path.join(root, 'cards.json');
  if (fs.existsSync(cardsPath)) {
    const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8')) as CardDef[];
    initCards(cards);
    // 卡片載入後重建 parsed effects cache
    resetParsedEffects();
    console.log(`[server] Loaded ${cards.length} cards from cards.json`);
  }
} catch (err) {
  console.error('[server] Failed to load cards.json:', err);
}
try {
  const i18nPath = path.join(root, 'data', 'card-effects-i18n.json');
  if (fs.existsSync(i18nPath)) {
    const i18n = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
    initEffectI18n(i18n);
  }
} catch { /* translations are optional on server */ }

const server = Server({
  games: [ZutomayoCard],
  db: db as unknown as NonNullable<ServerOpts['db']>,
  transport,
  origins: ['http://localhost:3000', /localhost:\d+/, /127\.0\.0\.1:\d+/, ...configuredOrigins],
});

server.router.post('/games/zutomayo-card/:id/resume', koaBody(), async (ctx: KoaContext) => {
  const matchID = ctx.params.id;
  const body = (ctx.request.body ?? {}) as { playerID?: unknown; credentials?: unknown };
  const playerID = body.playerID;
  const credentials = body.credentials;

  if (playerID !== '0' && playerID !== '1') ctx.throw(403, 'playerID is required');
  if (typeof credentials !== 'string') ctx.throw(403, 'credentials are required');

  // 通過檢查後收窄型別：playerID 為 '0' | '1'，credentials 為 string。
  const typedPlayerID = playerID as '0' | '1';
  const typedCredentials = credentials as string;

  const { metadata } = await server.db.fetch(matchID, { metadata: true });
  if (!metadata) ctx.throw(404, 'Match ' + matchID + ' not found');

  const player = metadata.players[typedPlayerID];
  if (!player) ctx.throw(404, 'Player ' + typedPlayerID + ' not found');
  if (!player.name || !player.credentials) ctx.throw(409, 'Player ' + typedPlayerID + ' not reserved');

  const isAuthorized = await server.auth.authenticateCredentials({
    playerID: typedPlayerID,
    credentials: typedCredentials,
    metadata,
  });
  if (!isAuthorized) ctx.throw(409, 'Player ' + typedPlayerID + ' not available');

  ctx.body = { matchID, playerID: typedPlayerID };
});

// Serve dist (frontend)
server.app.use(serve(path.join(root, 'dist')));

// Serve admin panel assets for the React /admin iframe.
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/admin/index.html' || ctx.path.startsWith('/admin/')) {
    const filePath = path.join(root, ctx.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
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

// Serve data (card JSON)
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path.startsWith('/data/')) {
    const filePath = path.join(root, ctx.path);
    if (fs.existsSync(filePath)) {
      ctx.type = 'application/json';
      ctx.body = fs.readFileSync(filePath);
      return;
    }
  }
  await next();
});

// Serve cards.json at root
server.app.use(async (ctx: KoaContext, next: Next) => {
  if (ctx.path === '/cards.json') {
    ctx.type = 'application/json';
    ctx.body = fs.readFileSync(path.join(root, 'cards.json'));
    return;
  }
  await next();
});

// API proxy — forward /api/* to the API server
const API_SERVER = process.env.API_URL || 'http://api:3001';

server.app.use(async (ctx: KoaContext, next: Next) => {
  if (!ctx.path.startsWith('/api/')) return next();

  const http = await import('http');
  const url = new URL(ctx.path, API_SERVER);
  url.search = ctx.search;

  // Read raw body from stream (koa-body may not be applied globally)
  let rawBody = '';
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of ctx.req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    rawBody = Buffer.concat(chunks).toString('utf-8');
  }

  return new Promise<void>((resolve) => {
    const proxyReq = http.request(
      url,
      {
        method: ctx.method,
        headers: {
          'content-type': ctx.request.headers['content-type'] || 'application/json',
          'content-length': rawBody ? String(Buffer.byteLength(rawBody)) : '0',
          host: url.host,
        },
        timeout: 10000,
      },
      (proxyRes) => {
        ctx.status = proxyRes.statusCode || 200;
        ctx.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
        const resChunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => resChunks.push(chunk));
        proxyRes.on('end', () => {
          ctx.body = Buffer.concat(resChunks);
          resolve();
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      ctx.status = 504;
      ctx.body = JSON.stringify({ error: 'API server timeout' });
      resolve();
    });

    proxyReq.on('error', () => {
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
server.app.use(async (ctx: KoaContext) => {
  if (ctx.status === 404 && !ctx.path.startsWith('/games/')) {
    ctx.type = 'html';
    ctx.body = fs.readFileSync(path.join(root, 'dist', 'index.html'));
  }
});

const PORT = Number(process.env.PORT) || 3000;
const STALE_MATCH_TTL_MS = Number(process.env.STALE_MATCH_TTL_MS) || 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 5 * 60 * 1000; // every 5 min

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
    if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} stale matches`);
  } catch (err) {
    console.error('[cleanup] Error:', err);
  }
}

setInterval(cleanupStaleMatches, CLEANUP_INTERVAL_MS);
console.log(`Stale match cleanup: TTL=${STALE_MATCH_TTL_MS / 60000}min, interval=${CLEANUP_INTERVAL_MS / 60000}min`);

// Graceful shutdown：關閉 PG pool 與 Redis 連線，避免重啟時連線洩漏。
async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received, closing connections...`);
  try {
    await Promise.all([db.close(), redisPubSub.close(), redisPubClient.quit(), redisAdapterSubClient.quit()]);
  } catch (err) {
    console.error('[shutdown] error:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
