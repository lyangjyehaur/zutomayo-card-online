const { Server } = require('boardgame.io/server');
const path = require('path');
const fs = require('fs');

let ZutomayoCard;
try {
  ZutomayoCard = require('./dist-server/src/game/Game').ZutomayoCard;
} catch (e) {
  console.error('Failed to load game module:', e.message);
  try {
    const files = fs.readdirSync('./dist-server', { recursive: true });
    console.error('dist-server contents:', files.join('\n'));
  } catch(e2) {}
  process.exit(1);
}

const koaStatic = require('koa-static');

const server = Server({
  games: [ZutomayoCard],
  origins: [
    'http://localhost:3000',
    /localhost:\d+/,
    /\d+\.\d+\.\d+\.\d+:\d+/,
  ],
});

const STATIC_DIR = path.join(__dirname, 'dist');
server.app.use(koaStatic(STATIC_DIR));

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
