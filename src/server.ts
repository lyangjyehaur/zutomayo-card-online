import { ZutomayoCard } from './game/Game';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Server } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const koaBody = require('koa-body') as typeof import('koa-body');

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean) ?? [];

const server = Server({
  games: [ZutomayoCard],
  origins: [
    'http://localhost:3000',
    /localhost:\d+/,
    /127\.0\.0\.1:\d+/,
    /\d+\.\d+\.\d+\.\d+:\d+/,
    ...configuredOrigins,
  ],
});

server.router.post('/games/zutomayo-card/:id/resume', koaBody(), async (ctx: any) => {
  const matchID = ctx.params.id;
  const playerID = ctx.request.body?.playerID;
  const credentials = ctx.request.body?.credentials;

  if (playerID !== '0' && playerID !== '1') ctx.throw(403, 'playerID is required');
  if (typeof credentials !== 'string') ctx.throw(403, 'credentials are required');

  const { metadata } = await server.db.fetch(matchID, { metadata: true });
  if (!metadata) ctx.throw(404, 'Match ' + matchID + ' not found');

  const player = metadata.players[playerID];
  if (!player) ctx.throw(404, 'Player ' + playerID + ' not found');
  if (!player.name || !player.credentials) ctx.throw(409, 'Player ' + playerID + ' not reserved');

  const isAuthorized = await server.auth.authenticateCredentials({
    playerID,
    credentials,
    metadata,
  });
  if (!isAuthorized) ctx.throw(409, 'Player ' + playerID + ' not available');

  ctx.body = { matchID, playerID };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Serve dist (frontend)
server.app.use(serve(path.join(root, 'dist')));

// Serve admin panel assets for the React /admin iframe.
server.app.use(async (ctx: any, next: () => any) => {
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
server.app.use(async (ctx: any, next: () => any) => {
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
server.app.use(async (ctx: any, next: () => any) => {
  if (ctx.path === '/cards.json') {
    ctx.type = 'application/json';
    ctx.body = fs.readFileSync(path.join(root, 'cards.json'));
    return;
  }
  await next();
});

// API proxy — forward /api/* to the API server
const API_SERVER = process.env.API_URL || 'http://api:3001';

server.app.use(async (ctx: any, next: () => any) => {
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
server.app.use(async (ctx: any) => {
  if (ctx.status === 404 && !ctx.path.startsWith('/games/')) {
    ctx.type = 'html';
    ctx.body = fs.readFileSync(path.join(root, 'dist', 'index.html'));
  }
});

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
