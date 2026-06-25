import { ZutomayoCard } from './game/Game';
import path from 'path';
import fs from 'fs';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Server } = require('boardgame.io/server') as typeof import('boardgame.io/server');

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

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Serve dist (frontend)
server.app.use(serve(path.join(root, 'dist')));

// Serve admin panel at /admin/
server.app.use(async (ctx: any, next: () => any) => {
  if (ctx.path.startsWith('/admin')) {
    const filePath = path.join(root, ctx.path === '/admin' ? '/admin/index.html' : ctx.path);
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

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
