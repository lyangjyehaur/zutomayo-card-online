const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== Config =====
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || '/data/zutomayo.db';
// Serve frontend static files
const STATIC_DIR = path.join(__dirname, 'dist');

// ===== In-memory DB (JSON file persistence) =====
let db = {
  users: {},
  matches: [],
  elo: {},
};

const DB_FILE = path.join(path.dirname(DB_PATH), 'db.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(db.users).length} users, ${db.matches.length} matches`);
    }
  } catch (e) {
    console.log('Fresh DB');
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

// ===== Auth =====
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function createToken(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  return Buffer.from(payload).toString('base64');
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    if (payload.exp < Date.now()) return null;
    return payload.userId;
  } catch { return null; }
}

// ===== ELO =====
function calculateElo(ratingA, ratingB, scoreA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

// ===== HTTP Handler =====
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Helper
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });

  const getAuth = () => {
    const auth = req.headers.authorization;
    if (!auth) return null;
    return verifyToken(auth.replace('Bearer ', ''));
  };

  // ===== API Routes =====
  const apiPath = url.pathname;

  // Register
  if (apiPath === '/api/register' && method === 'POST') {
    readBody().then(({ email, password, nickname }) => {
      if (!email || !password) return json({ error: 'Email and password required' }, 400);
      const existing = Object.values(db.users).find(u => u.email === email);
      if (existing) return json({ error: 'Email already registered' }, 409);

      const id = 'u_' + crypto.randomBytes(8).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      db.users[id] = {
        id, email, nickname: nickname || email.split('@')[0],
        passwordHash: hash, salt,
        createdAt: new Date().toISOString(),
        matchCount: 0, wins: 0,
      };
      db.elo[id] = 1000;
      saveDB();

      const token = createToken(id);
      json({ token, user: { id, email, nickname: db.users[id].nickname, elo: 1000 } });
    });
    return;
  }

  // Login
  if (apiPath === '/api/login' && method === 'POST') {
    readBody().then(({ email, password }) => {
      const user = Object.values(db.users).find(u => u.email === email);
      if (!user) return json({ error: 'Invalid credentials' }, 401);

      const hash = hashPassword(password, user.salt);
      if (hash !== user.passwordHash) return json({ error: 'Invalid credentials' }, 401);

      const token = createToken(user.id);
      json({
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, elo: db.elo[user.id] || 1000 },
      });
    });
    return;
  }

  // Get profile
  if (apiPath === '/api/profile' && method === 'GET') {
    const userId = getAuth();
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const user = db.users[userId];
    if (!user) return json({ error: 'User not found' }, 404);
    json({
      id: user.id, email: user.email, nickname: user.nickname,
      elo: db.elo[userId] || 1000,
      matchCount: user.matchCount, wins: user.wins,
      winRate: user.matchCount > 0 ? Math.round((user.wins / user.matchCount) * 100) : 0,
      createdAt: user.createdAt,
    });
    return;
  }

  // Submit match result
  if (apiPath === '/api/match' && method === 'POST') {
    readBody().then(({ winner, loser, turns, duration }) => {
      // Update ELO
      const winnerElo = db.elo[winner] || 1000;
      const loserElo = db.elo[loser] || 1000;
      const newWinnerElo = calculateElo(winnerElo, loserElo, 1);
      const newLoserElo = calculateElo(loserElo, winnerElo, 0);

      if (db.users[winner]) {
        db.users[winner].matchCount++;
        db.users[winner].wins++;
      }
      if (db.users[loser]) {
        db.users[loser].matchCount++;
      }
      db.elo[winner] = newWinnerElo;
      db.elo[loser] = newLoserElo;

      db.matches.push({
        id: 'm_' + crypto.randomBytes(8).toString('hex'),
        winner, loser,
        winnerEloChange: newWinnerElo - winnerElo,
        loserEloChange: newLoserElo - loserElo,
        turns, duration,
        date: new Date().toISOString(),
      });
      saveDB();

      json({
        winnerElo: newWinnerElo, loserElo: newLoserElo,
        winnerChange: newWinnerElo - winnerElo,
        loserChange: newLoserElo - loserElo,
      });
    });
    return;
  }

  // Leaderboard
  if (apiPath === '/api/leaderboard' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit')) || 100;
    const entries = Object.entries(db.elo)
      .map(([id, elo]) => {
        const user = db.users[id];
        if (!user) return null;
        return {
          id, nickname: user.nickname, elo,
          matchCount: user.matchCount, wins: user.wins,
          winRate: user.matchCount > 0 ? Math.round((user.wins / user.matchCount) * 100) : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.elo - a.elo)
      .slice(0, limit);

    json({ leaderboard: entries });
    return;
  }

  // Anonymous merge
  if (apiPath === '/api/merge' && method === 'POST') {
    const userId = getAuth();
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    readBody().then(({ anonymousMatches }) => {
      if (!Array.isArray(anonymousMatches)) return json({ error: 'Invalid data' }, 400);
      let mergedCount = 0;
      for (const m of anonymousMatches) {
        if (m.winner === '0') db.users[userId].wins++;
        db.users[userId].matchCount++;
        mergedCount++;
      }
      saveDB();
      json({ merged: mergedCount });
    });
    return;
  }

  // ===== Static Files =====
  let filePath = path.join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);

  // SPA fallback
  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html');
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

// ===== Start =====
loadDB();
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Zutomayo Card server running on port ${PORT}`);
  console.log(`Users: ${Object.keys(db.users).length}, Matches: ${db.matches.length}`);
});
