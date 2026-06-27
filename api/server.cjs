const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadDatabase() {
  try {
    return require('better-sqlite3');
  } catch (nativeError) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      return class NodeSqliteDatabase {
        constructor(filename) {
          this.db = new DatabaseSync(filename);
        }

        pragma(statement) {
          this.db.exec(`PRAGMA ${statement}`);
        }

        exec(sql) {
          return this.db.exec(sql);
        }

        prepare(sql) {
          return this.db.prepare(sql);
        }

        close() {
          this.db.close();
        }
      };
    } catch {
      throw nativeError;
    }
  }
}

const Database = loadDatabase();

// ===== Config =====
const PORT = Number(process.env.API_PORT) || 3001;
const DB_PATH = process.env.DB_PATH || '/data/zutomayo.db';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
// P0-3：Admin 密碼改為後端環境變數，移除前端硬編碼。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// ===== Database =====
if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
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
    action_log TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (player0_id) REFERENCES users(id),
    FOREIGN KEY (player1_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
`);

const matchColumns = db.prepare('PRAGMA table_info(matches)').all().map(column => column.name);
if (!matchColumns.includes('action_log')) {
  db.prepare('ALTER TABLE matches ADD COLUMN action_log TEXT').run();
}

// ===== Auth =====
// P0-4：PBKDF2 迭代數從 10000 提升至 100000（現代安全標準）。
const PBKDF2_ITERATIONS = 100000;
// 向後相容：舊用戶的密碼仍用舊迭代數驗證，登入成功後自動升級。
const PBKDF2_LEGACY_ITERATIONS = 10000;

function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signTokenInput(input) {
  return crypto.createHmac('sha256', JWT_SECRET).update(input).digest('base64url');
}

function createToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signTokenInput(input)}`;
}

function verifyToken(token) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expected = signTokenInput(input);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null;
    }

    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    return typeof userId === 'string' ? userId : null;
  } catch { return null; }
}

function getAuthUserId(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  return verifyToken(auth.replace('Bearer ', ''));
}

// P0-3：Admin token 機制（payload 含 admin: true）。
function createAdminToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    admin: true,
    iat: now,
    exp: now + 24 * 60 * 60,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signTokenInput(input)}`;
}

function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return false;
  try {
    const token = auth.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expected = signTokenInput(input);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (!payload.admin) return false;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch { return false; }
}

// 輸入 sanitization（P0-4：防範 XSS）。
function sanitizeText(value, maxLen = 60) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen).replace(/[<>]/g, '');
}

// ===== ELO =====
function calculateElo(ratingA, ratingB, scoreA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

// ===== Action Log Sanitization =====
function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function optionalString(value) {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}

function sanitizePayload(action, payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  if (action === 'janken') {
    return ['rock', 'paper', 'scissors'].includes(data.choice) ? { choice: data.choice } : {};
  }
  if (action === 'mulligan') {
    const count = Math.max(0, Math.trunc(finiteNumber(data.redrawnCount, 0)));
    return { redrawnCount: count };
  }
  if (action === 'setInitialCard') {
    return { slot: 'A', faceDown: true };
  }
  if (action === 'setTurnCard') {
    return { slot: data.slot === 'B' ? 'B' : 'A', faceDown: true };
  }
  if (action === 'confirmReady') {
    return { confirmed: true };
  }
  if (action === 'chooseEffectOrder' || action === 'resolvePendingEffect') {
    const clean = { index: Math.max(0, Math.trunc(finiteNumber(data.index, 0))) };
    for (const key of ['effectId', 'cardDefId', 'source', 'trigger', 'actionType']) {
      const value = optionalString(data[key]);
      if (value) clean[key] = value;
    }
    return clean;
  }
  if (action === 'submitPendingChoice') {
    const clean = {
      selectedCount: Math.max(0, Math.trunc(finiteNumber(data.selectedCount, 0))),
      min: Math.max(0, Math.trunc(finiteNumber(data.min, 0))),
      max: Math.max(0, Math.trunc(finiteNumber(data.max, 0))),
    };
    for (const key of ['choiceId', 'choiceType', 'sourceZone', 'destinationZone', 'destinationPosition', 'effectLabel']) {
      const value = optionalString(data[key]);
      if (value) clean[key] = value;
    }
    for (const key of ['sourcePlayer', 'destinationPlayer', 'targetPlayer', 'drawCount', 'followUpDrawCount']) {
      if (data[key] !== undefined) clean[key] = Math.max(0, Math.trunc(finiteNumber(data[key], 0)));
    }
    if (data.faceDown !== undefined) clean.faceDown = Boolean(data.faceDown);
    if (data.shuffle !== undefined) clean.shuffle = Boolean(data.shuffle);
    return clean;
  }
  if (action === 'gameOver') {
    const clean = { draw: Boolean(data.draw) };
    if (data.winner === 0 || data.winner === 1 || data.winner === null) clean.winner = data.winner;
    const reason = optionalString(data.reason);
    if (reason) clean.reason = reason;
    return clean;
  }
  return {};
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return undefined;
  const clean = { ok: Boolean(result.ok) };
  const message = optionalString(result.message);
  if (message) clean.message = message;
  return clean;
}

function sanitizeHp(value) {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  return [Math.trunc(finiteNumber(value[0], 0)), Math.trunc(finiteNumber(value[1], 0))];
}

function sanitizeActionLog(actionLog) {
  if (!Array.isArray(actionLog)) return [];
  return actionLog
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => {
      const action = optionalString(entry.action) || 'unknown';
      const player = Number(entry.player) === 1 ? 1 : 0;
      const clean = {
        turn: Math.max(0, Math.trunc(finiteNumber(entry.turn, 0))),
        step: optionalString(entry.step) || 'unknown',
        player,
        action,
        timestamp: Math.max(0, Math.trunc(finiteNumber(entry.timestamp, Date.now()))),
      };
      if (entry.id !== undefined) clean.id = Math.max(0, Math.trunc(finiteNumber(entry.id, 0)));
      if (entry.chronosPosition !== undefined) clean.chronosPosition = Math.max(0, Math.trunc(finiteNumber(entry.chronosPosition, 0)));
      const hp = sanitizeHp(entry.hp);
      if (hp) clean.hp = hp;
      const pendingEffectCardDefId = optionalString(entry.pendingEffectCardDefId);
      if (pendingEffectCardDefId) clean.pendingEffectCardDefId = pendingEffectCardDefId;
      const pendingChoiceType = optionalString(entry.pendingChoiceType);
      if (pendingChoiceType) clean.pendingChoiceType = pendingChoiceType;
      const result = sanitizeResult(entry.result);
      if (result) clean.result = result;
      const payload = sanitizePayload(action, entry.payload);
      if (Object.keys(payload).length > 0) clean.payload = payload;
      return clean;
    });
}

// ===== Rate Limiting (P0-4) =====
const rateLimitBuckets = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_AUTH = 10;
const RATE_LIMIT_DEFAULT = 120;

function checkRateLimit(ip, limit) {
  const now = Date.now();
  const key = `${ip}:${Math.floor(now / RATE_LIMIT_WINDOW_MS)}`;
  const count = rateLimitBuckets.get(key) || 0;
  if (count >= limit) return false;
  rateLimitBuckets.set(key, count + 1);
  // 清理過期條目
  if (rateLimitBuckets.size > 10000) {
    for (const [k] of rateLimitBuckets) {
      if (k !== key && rateLimitBuckets.get(k) === undefined) rateLimitBuckets.delete(k);
    }
  }
  return true;
}

// ===== CORS (P0-4 收緊為白名單) =====
const corsAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
// 開發環境 fallback：允許 localhost
const devOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];
const effectiveCorsOrigins = corsAllowedOrigins.length > 0 ? corsAllowedOrigins : devOrigins;

function getCorsOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (effectiveCorsOrigins.includes(reqOrigin)) return reqOrigin;
  return null;
}

// ===== Matchmaking Queue (in-memory) =====
// Map<userId, { queueId, joinedAt, deckName?, deckIds?, status, matchId?, opponentId?, role?, realMatchId?, timeoutAt? }>
const matchmakingQueue = new Map();
const MATCHMAKING_TIMEOUT_MS = 60 * 1000;
const MATCHMAKING_TIMEOUT_GRACE_MS = 10 * 1000;

function generateMatchmakingId() {
  return 'mm_' + crypto.randomBytes(8).toString('hex');
}

function cleanExpiredMatchmakingEntries() {
  const now = Date.now();
  for (const [uid, entry] of matchmakingQueue) {
    // 未配對且超過 60 秒未配對成功 -> 標記 timeout
    if (entry.status === 'queued' && now - entry.joinedAt > MATCHMAKING_TIMEOUT_MS) {
      entry.status = 'timeout';
      entry.timeoutAt = now;
    }
    // 已標記 timeout 且超過寬限期 -> 刪除
    if (entry.status === 'timeout' && entry.timeoutAt && now - entry.timeoutAt > MATCHMAKING_TIMEOUT_GRACE_MS) {
      matchmakingQueue.delete(uid);
    }
  }
}

function tryMatchUser(userId) {
  const now = Date.now();
  for (const [otherId, other] of matchmakingQueue) {
    if (otherId === userId) continue;
    if (other.status !== 'queued') continue;
    if (now - other.joinedAt > MATCHMAKING_TIMEOUT_MS) continue;

    const matchId = generateMatchmakingId();
    // userId 字串較小者為 host（player '0'），確保雙方決定一致
    const [hostId, guestId] = userId < otherId ? [userId, otherId] : [otherId, userId];

    const userEntry = matchmakingQueue.get(userId);
    const otherEntry = matchmakingQueue.get(otherId);

    userEntry.status = 'matched';
    userEntry.matchId = matchId;
    userEntry.opponentId = otherId;
    userEntry.role = userId === hostId ? 'host' : 'guest';

    otherEntry.status = 'matched';
    otherEntry.matchId = matchId;
    otherEntry.opponentId = userId;
    otherEntry.role = otherId === hostId ? 'host' : 'guest';

    return matchId;
  }
  return null;
}

// ===== HTTP Handler =====
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS (P0-4：白名單制)
  const corsOrigin = getCorsOrigin(req.headers.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Rate limiting (P0-4)
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const isAuthEndpoint = pathname === '/api/login' || pathname === '/api/register' || pathname === '/api/admin/login';
  if (!checkRateLimit(clientIp, isAuthEndpoint ? RATE_LIMIT_AUTH : RATE_LIMIT_DEFAULT)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }));
    return;
  }

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

      const cleanEmail = String(email).slice(0, 120).toLowerCase();
      const cleanNickname = sanitizeText(nickname || String(cleanEmail).split('@')[0], 30) || 'player';

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
      if (existing) return json({ error: 'Email already registered' }, 409);

      const id = 'u_' + crypto.randomBytes(8).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      db.prepare('INSERT INTO users (id, email, password_hash, salt, nickname) VALUES (?, ?, ?, ?, ?)')
        .run(id, cleanEmail, hash, salt, cleanNickname);

      const token = createToken(id);
      json({ token, user: { id, email: cleanEmail, nickname: cleanNickname, elo: 1000 } });
    });
    return;
  }

  // Login
  if (pathname === '/api/login' && method === 'POST') {
    readBody().then(({ email, password }) => {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) return json({ error: 'Invalid credentials' }, 401);

      // P0-4：先用新迭代數驗證，失敗再用舊迭代數驗證（向後相容）。
      const newHash = hashPassword(password, user.salt, PBKDF2_ITERATIONS);
      const legacyHash = hashPassword(password, user.salt, PBKDF2_LEGACY_ITERATIONS);
      if (newHash !== user.password_hash && legacyHash !== user.password_hash) {
        return json({ error: 'Invalid credentials' }, 401);
      }

      // 若密碼仍用舊迭代數，登入成功後自動升級到新迭代數。
      if (newHash !== user.password_hash) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
      }

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

  // Get match action log
  const matchLogRoute = pathname.match(/^\/api\/matches\/([^/]+)\/log$/);
  if (matchLogRoute && method === 'GET') {
    const matchId = matchLogRoute[1];
    const match = db.prepare('SELECT id, action_log FROM matches WHERE id = ?').get(matchId);
    if (!match) return json({ error: 'Match not found' }, 404);
    let actionLog = [];
    try {
      actionLog = match.action_log ? JSON.parse(match.action_log) : [];
    } catch {
      actionLog = [];
    }
    json({ matchId: match.id, actionLog: sanitizeActionLog(actionLog) });
    return;
  }

  // Submit match result
  if (pathname === '/api/matches' && method === 'POST') {
    // P0-2：強制 JWT 認證，只有贏家可以提交自己的勝利。
    const authUserId = getAuthUserId(req);
    if (!authUserId) return json({ error: 'Unauthorized' }, 401);

    readBody().then(({ winnerId, loserId, turns, duration, actionLog, action_log }) => {
      if (!winnerId || !loserId) return json({ error: 'Winner and loser IDs required' }, 400);
      // P0-2：認證使用者必須是贏家，杜絕偽造勝負。
      if (winnerId !== authUserId) return json({ error: 'Forbidden: winner must match authenticated user' }, 403);

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
      const sanitizedActionLog = sanitizeActionLog(actionLog ?? action_log);
      const player0Id = winner ? winnerId : null;
      const player1Id = loser ? loserId : null;
      db.prepare('INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, action_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          matchId,
          player0Id,
          player1Id,
          winnerId,
          loserId,
          winnerEloChange,
          loserEloChange,
          turns || 0,
          duration || 0,
          JSON.stringify(sanitizedActionLog),
        );

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
        id: e.id, nickname: sanitizeText(e.nickname, 60), elo: e.elo,
        matchCount: e.match_count, wins: e.wins,
        winRate: e.match_count > 0 ? Math.round((e.wins / e.match_count) * 100) : 0,
      })),
    });
    return;
  }

  // P2-10：使用者對戰歷史（跨裝置同步）。
  if (pathname === '/api/matches' && method === 'GET') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const matches = db.prepare(
      `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       WHERE m.player0_id = ? OR m.player1_id = ?
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
    ).all(userId, userId, limit, offset);
    json({
      matches: matches.map(m => ({
        id: m.id,
        winnerId: m.winner_id,
        loserId: m.loser_id,
        winnerNickname: m.winner_nickname,
        loserNickname: m.loser_nickname,
        winnerEloChange: m.winner_elo_change,
        loserEloChange: m.loser_elo_change,
        turns: m.turns,
        duration: m.duration_seconds,
        createdAt: m.created_at,
      })),
    });
    return;
  }

  // PUT /api/profile — 修改暱稱（P2 補齊）。
  if (pathname === '/api/profile' && method === 'PUT') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    readBody().then(({ nickname }) => {
      const clean = sanitizeText(nickname, 30);
      if (!clean) return json({ error: 'Nickname required' }, 400);
      db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(clean, userId);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      json({
        id: user.id, email: user.email, nickname: user.nickname, elo: user.elo,
        matchCount: user.match_count, wins: user.wins,
        winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
      });
    });
    return;
  }

  // ===== Admin API (P0-3 + P2-12) =====

  // Admin 登入
  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!ADMIN_PASSWORD) return json({ error: 'Admin not configured' }, 503);
    readBody().then(({ password }) => {
      if (password !== ADMIN_PASSWORD) return json({ error: 'Invalid password' }, 401);
      json({ token: createAdminToken() });
    });
    return;
  }

  // Admin：使用者列表
  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    const users = db.prepare('SELECT id, email, nickname, elo, match_count, wins, created_at FROM users ORDER BY created_at DESC LIMIT ?').all(limit);
    json({
      users: users.map(u => ({
        id: u.id, email: u.email, nickname: u.nickname, elo: u.elo,
        matchCount: u.match_count, wins: u.wins, createdAt: u.created_at,
        winRate: u.match_count > 0 ? Math.round((u.wins / u.match_count) * 100) : 0,
      })),
    });
    return;
  }

  // Admin：對戰列表
  if (pathname === '/api/admin/matches' && method === 'GET') {
    if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const matches = db.prepare(
      `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       ORDER BY m.created_at DESC LIMIT ?`
    ).all(limit);
    json({
      matches: matches.map(m => ({
        id: m.id, winnerId: m.winner_id, loserId: m.loser_id,
        winnerNickname: m.winner_nickname, loserNickname: m.loser_nickname,
        winnerEloChange: m.winner_elo_change, loserEloChange: m.loser_elo_change,
        turns: m.turns, duration: m.duration_seconds, createdAt: m.created_at,
      })),
    });
    return;
  }

  // Admin：重置使用者 ELO
  if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/elo') && method === 'PUT') {
    if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
    const targetUserId = pathname.split('/')[4];
    readBody().then(({ elo }) => {
      const newElo = Math.max(0, Math.min(9999, Math.trunc(Number(elo) || 1000)));
      db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(newElo, targetUserId);
      json({ id: targetUserId, elo: newElo });
    });
    return;
  }

  // ===== Matchmaking Routes =====

  // POST /api/matchmaking/queue — 加入配對佇列
  if (pathname === '/api/matchmaking/queue' && method === 'POST') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    readBody().then(({ deckName, deckIds }) => {
      cleanExpiredMatchmakingEntries();
      const existing = matchmakingQueue.get(userId);
      // 若已在佇列且已配對，不重複加入
      if (existing && existing.status === 'matched') {
        return json({ queueId: existing.queueId, status: 'matched' });
      }
      const queueId = (existing && existing.queueId) || ('q_' + crypto.randomBytes(8).toString('hex'));
      const entry = {
        queueId,
        joinedAt: Date.now(),
        deckName: typeof deckName === 'string' ? sanitizeText(deckName, 60) : undefined,
        deckIds: Array.isArray(deckIds) ? deckIds.filter(id => typeof id === 'string').slice(0, 20) : undefined,
        status: 'queued',
        matchId: undefined,
        opponentId: undefined,
        role: undefined,
        realMatchId: undefined,
        timeoutAt: undefined,
      };
      matchmakingQueue.set(userId, entry);

      // 嘗試立即配對
      tryMatchUser(userId);

      const current = matchmakingQueue.get(userId);
      json({ queueId: current.queueId, status: current.status });
    });
    return;
  }

  // GET /api/matchmaking/status — 查詢配對狀態
  if (pathname === '/api/matchmaking/status' && method === 'GET') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    cleanExpiredMatchmakingEntries();
    const entry = matchmakingQueue.get(userId);
    if (!entry) return json({ status: 'timeout' });
    json({
      status: entry.status,
      matchId: entry.matchId,
      opponentId: entry.opponentId,
      role: entry.role,
      realMatchId: entry.realMatchId,
    });
    return;
  }

  // DELETE /api/matchmaking/queue — 離開佇列
  if (pathname === '/api/matchmaking/queue' && method === 'DELETE') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const entry = matchmakingQueue.get(userId);
    if (entry && entry.opponentId && matchmakingQueue.has(entry.opponentId)) {
      // 已配對情況下離開，標記對手為 timeout 讓對手能即時知道
      const opponent = matchmakingQueue.get(entry.opponentId);
      opponent.status = 'timeout';
      opponent.timeoutAt = Date.now();
    }
    matchmakingQueue.delete(userId);
    json({ deleted: true });
    return;
  }

  // PUT /api/matchmaking/match — host 回報真實 boardgame.io matchID
  if (pathname === '/api/matchmaking/match' && method === 'PUT') {
    const userId = getAuthUserId(req);
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    readBody().then(({ matchId }) => {
      if (typeof matchId !== 'string' || !matchId) {
        return json({ error: 'matchId required' }, 400);
      }
      const entry = matchmakingQueue.get(userId);
      if (!entry || entry.status !== 'matched') {
        return json({ error: 'Not in a matched queue' }, 400);
      }
      entry.realMatchId = matchId;
      json({ ok: true });
    });
    return;
  }

  // ===== Default =====
  res.writeHead(404);
  res.end('Not Found');
}

// ===== Start =====
const server = http.createServer(handleRequest);
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Zutomayo API server running on port ${PORT}`);
  });
}

module.exports = {
  handleRequest,
  server,
  closeDatabase: () => {
    if (typeof db.close === 'function') db.close();
  },
};
