const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ===== Config =====
const PORT = Number(process.env.API_PORT) || 3001;
const DB_PATH = process.env.DB_PATH || '/data/zutomayo.db';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ===== Database =====
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nickname TEXT NOT NULL,
    elo INTEGER DEFAULT 1000,
    match_count INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    card_ids TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    player0_id TEXT,
    player1_id TEXT,
    winner_id TEXT,
    loser_id TEXT,
    winner_elo_change INTEGER DEFAULT 0,
    loser_elo_change INTEGER DEFAULT 0,
    turns INTEGER,
    duration_seconds INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (player0_id) REFERENCES users(id),
    FOREIGN KEY (player1_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
`);

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

function getAuthUserId(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  return verifyToken(auth.replace('Bearer ', ''));
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
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });

  // ===== Auth Routes =====

  // Register
  if (pathname === '/api/register' && method === 'POST') {
    readBody().then(({ email, password, nickname }) => {
      if (!email || !password) return json({ error: 'Email and password required' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return json({ error: 'Email already registered' }, 409);

      const id = 'u_' + crypto.randomBytes(8).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      db.prepare('INSERT INTO users (id, email, password_hash, salt, nickname) VALUES (?, ?, ?, ?, ?)')
        .run(id, email, hash, salt, nickname || email.split('@')[0]);

      const token = createToken(id);
      json({ token, user: { id, email, nickname: nickname || email.split('@')[0], elo: 1000 } });
    });
    return;
  }

  // Login
  if (pathname === '/api/login' && method === 'POST') {
    readBody().then(({ email, password }) => {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) return json({ error: 'Invalid credentials' }, 401);

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) return json({ error: 'Invalid credentials' }, 401);

      const token = createToken(user.id);
      json({
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, elo: user.elo },
      });
    });
    return;
  }

  // Get profile
  if (pathname === '/api/profile' && method === 'GET') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return json({ error: 'User not found' }, 404);
    json({
      id: user.id, email: user.email, nickname: user.nickname, elo: user.elo,
      matchCount: user.match_count, wins: user.wins,
      winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
      createdAt: user.created_at,
    });
    return;
  }

  // ===== Deck Routes =====

  // List user's decks
  if (pathname === '/api/decks' && method === 'GET') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const decks = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    json({ decks: decks.map(d => ({ ...d, cardIds: JSON.parse(d.card_ids) })) });
    return;
  }

  // Create deck
  if (pathname === '/api/decks' && method === 'POST') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    readBody().then(({ name, cardIds }) => {
      if (!name || !Array.isArray(cardIds) || cardIds.length !== 20) {
        return json({ error: 'Name and 20 card IDs required' }, 400);
      }
      // Validate deck
      const counts = {};
      for (const id of cardIds) {
        counts[id] = (counts[id] || 0) + 1;
        if (counts[id] > 2) return json({ error: `Card ${id} appears more than twice` }, 400);
      }

      const id = 'd_' + crypto.randomBytes(8).toString('hex');
      db.prepare('INSERT INTO decks (id, user_id, name, card_ids) VALUES (?, ?, ?, ?)')
        .run(id, userId, name, JSON.stringify(cardIds));
      json({ id, name, cardIds });
    });
    return;
  }

  // Delete deck
  if (pathname.match(/^\/api\/decks\/d_/) && method === 'DELETE') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const deckId = pathname.split('/').pop();
    const result = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(deckId, userId);
    if (result.changes === 0) return json({ error: 'Deck not found' }, 404);
    json({ deleted: true });
    return;
  }

  // ===== Match Routes =====

  // Submit match result
  if (pathname === '/api/matches' && method === 'POST') {
    readBody().then(({ winnerId, loserId, turns, duration }) => {
      if (!winnerId || !loserId) return json({ error: 'Winner and loser IDs required' }, 400);

      const winner = db.prepare('SELECT * FROM users WHERE id = ?').get(winnerId);
      const loser = db.prepare('SELECT * FROM users WHERE id = ?').get(loserId);

      let winnerEloChange = 0;
      let loserEloChange = 0;

      if (winner && loser) {
        const newWinnerElo = calculateElo(winner.elo, loser.elo, 1);
        const newLoserElo = calculateElo(loser.elo, winner.elo, 0);
        winnerEloChange = newWinnerElo - winner.elo;
        loserEloChange = newLoserElo - loser.elo;

        db.prepare('UPDATE users SET elo = ?, match_count = match_count + 1, wins = wins + 1 WHERE id = ?')
          .run(newWinnerElo, winnerId);
        db.prepare('UPDATE users SET elo = ?, match_count = match_count + 1 WHERE id = ?')
          .run(newLoserElo, loserId);
      }

      const matchId = 'm_' + crypto.randomBytes(8).toString('hex');
      db.prepare('INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(matchId, winnerId, loserId, winnerId, loserId, winnerEloChange, loserEloChange, turns || 0, duration || 0);

      json({
        matchId, winnerEloChange, loserEloChange,
        winnerNewElo: (winner?.elo || 1000) + winnerEloChange,
        loserNewElo: (loser?.elo || 1000) + loserEloChange,
      });
    });
    return;
  }

  // Leaderboard
  if (pathname === '/api/leaderboard' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    const entries = db.prepare('SELECT id, nickname, elo, match_count, wins FROM users WHERE match_count > 0 ORDER BY elo DESC LIMIT ?').all(limit);
    json({
      leaderboard: entries.map(e => ({
        id: e.id, nickname: e.nickname, elo: e.elo,
        matchCount: e.match_count, wins: e.wins,
        winRate: e.match_count > 0 ? Math.round((e.wins / e.match_count) * 100) : 0,
      })),
    });
    return;
  }

  // ===== Default =====
  res.writeHead(404);
  res.end('Not Found');
}

// ===== Start =====
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Zutomayo API server running on port ${PORT}`);
});
