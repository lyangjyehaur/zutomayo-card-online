import { ZutomayoCard } from './game/Game';
import path from 'path';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Server } = require('boardgame.io/server') as typeof import('boardgame.io/server');

const server = Server({
  games: [ZutomayoCard],
  origins: ['http://localhost:3000', /localhost:\d+/, /127\.0\.0\.1:\d+/, /149\.104\.6\.238:\d+/, /\d+\.\d+\.\d+\.\d+:\d+/],
});

const here = path.dirname(fileURLToPath(import.meta.url));
const staticPath = path.join(here, '..', 'dist');
server.app.use(serve(staticPath));

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
