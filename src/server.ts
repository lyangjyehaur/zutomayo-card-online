import { Server } from 'boardgame.io/server';
import { ZutomayoCard } from './game/Game';

const server = Server({
  games: [ZutomayoCard],
});

const PORT = Number(process.env.PORT) || 8000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
});
