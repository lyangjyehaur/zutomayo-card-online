import { ZutomayoCard } from './game/Game';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import type { DefaultContext, Next } from 'koa';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Server, FlatFile } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const koaBody = require('koa-body') as typeof import('koa-body');

// 擴充 Koa context 以涵蓋 koa-body（request.body）與 @koa/router（params）注入的屬性。
interface KoaContext extends DefaultContext {
  params: Record<string, string>;
  request: DefaultContext['request'] & { body?: unknown };
}

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean) ?? [];

// 官方 QA P0-1：boardgame.io 配置 FlatFile DB adapter，解決線上房間重啟即滅。
// 生產環境（Docker）使用 DB_DIR=/data（掛載 game-data volume）；
// 開發環境 fallback 到項目根目錄下的 .data。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dbDir = process.env.DB_DIR || path.join(root, '.data');
fs.mkdirSync(dbDir, { recursive: true });

const server = Server({
  games: [ZutomayoCard],
  db: new FlatFile({
    dir: dbDir,
    logging: process.env.NODE_ENV !== 'production',
  }),
  origins: [
    'http://localhost:3000',
    /localhost:\d+/,
    /127\.0\.0\.1:\d+/,
    ...configuredOrigins,
  ],
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
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
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

  return new Promise<void>((resolve) => {
    const proxyReq = http.request(url, {
      method: ctx.method,
      headers: { ...ctx.request.headers, host: url.host },
    }, (proxyRes) => {
      ctx.status = proxyRes.statusCode || 200;
      ctx.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        ctx.body = Buffer.concat(chunks);
        resolve();
      });
    });

    proxyReq.on('error', () => {
      ctx.status = 502;
      ctx.body = JSON.stringify({ error: 'API server unavailable' });
      resolve();
    });

    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      const body = typeof ctx.request.body === 'string' ? ctx.request.body : JSON.stringify(ctx.request.body || {});
      proxyReq.write(body);
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

// Stale room cleanup
async function cleanupStaleMatches() {
  try {
    const matchIDs = await server.db.listMatches({});
    if (!matchIDs || !Array.isArray(matchIDs)) return;
    let cleaned = 0;
    for (const matchID of matchIDs) {
      try {
        const { metadata } = await server.db.fetch(matchID, { metadata: true });
        if (!metadata) continue;
        const updatedAt = metadata.updatedAt ? new Date(metadata.updatedAt).getTime() : 0;
        const createdAt = metadata.createdAt ? new Date(metadata.createdAt).getTime() : 0;
        const age = Date.now() - Math.max(createdAt, updatedAt);
        if (age > STALE_MATCH_TTL_MS) {
          await server.db.wipe(matchID);
          cleaned++;
        }
      } catch { /* skip */ }
    }
    if (cleaned > 0) console.log(`[cleanup] Removed ${cleaned} stale matches`);
  } catch (err) {
    console.error('[cleanup] Error:', err);
  }
}

setInterval(cleanupStaleMatches, CLEANUP_INTERVAL_MS);
console.log(`Stale match cleanup: TTL=${STALE_MATCH_TTL_MS / 60000}min, interval=${CLEANUP_INTERVAL_MS / 60000}min`);

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
