import { Server } from 'boardgame.io/server';
import { ZutomayoCard } from './game/Game';
import path from 'path';
import serve from 'koa-static';

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
