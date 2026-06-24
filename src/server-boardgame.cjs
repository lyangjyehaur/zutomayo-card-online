const { Server } = require('boardgame.io/server');
const path = require('path');
const fs = require('fs');

// Load game definition from compiled JS
// We'll compile the game module separately
let ZutomayoCard;

try {
  // Try loading compiled game module
  ZutomayoCard = require('./dist-server/game/Game').ZutomayoCard;
} catch (e) {
  console.error('Failed to load game module:', e.message);
  try {
    // Try alternative path
    ZutomayoCard = require('./dist-server/src/game/Game').ZutomayoCard;
  } catch (e2) {
    console.error('Also failed:', e2.message);
    console.error('Files in dist-server:');
    try {
      const fs = require('fs');
      const files = fs.readdirSync('./dist-server', { recursive: true });
      console.error(files.join('\n'));
    } catch(e3) {}
    process.exit(1);
  }
}

const server = Server({
  games: [ZutomayoCard],
});

// Serve frontend static files
const STATIC_DIR = path.join(__dirname, 'dist');

function serveStatic(req, res) {
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html'); // SPA fallback
  }
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// Patch the server to also serve static files
const origApp = server.app;
if (origApp && origApp.use) {
  const koaStatic = require('koa-static');
  origApp.use(koaStatic(STATIC_DIR));
}

const PORT = Number(process.env.PORT) || 3000;

server.run(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
  console.log(`Static files: ${STATIC_DIR}`);
});
