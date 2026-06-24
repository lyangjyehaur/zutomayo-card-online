import { Server } from 'boardgame.io/server';
import { ZutomayoCard } from './game/Game';
import path from 'path';
import serve from 'koa-static';

const server = Server({
  games: [ZutomayoCard],
  origins: [
    // Allow connections from anywhere in development
    'http://localhost:3000',
    'http://149.104.6.238:3000',
    'http://149.104.6.238',
    // Also allow the same origin
    /localhost:\d+/,
    /\d+\.\d+\.\d+\.\d+:\d+/,
  ],
});

const STATIC_DIR = path.join(__dirname, '..', 'dist');
server.app.use(serve(STATIC_DIR));

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
