const { Server } = require('boardgame.io/server');
const { ZutomayoCard } = require('./game/Game.cjs');
const path = require('path');
const serve = require('koa-static');

const server = Server({
  games: [ZutomayoCard],
});

// Serve frontend static files
const staticPath = path.join(__dirname, '..', 'dist');
server.app.use(serve(staticPath));

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
