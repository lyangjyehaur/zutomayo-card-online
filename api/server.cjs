const http = require('http');
const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { getAccountProfile, loginAccount, registerAccount, updateAccountProfile } = require('./accountService.cjs');
const { upsertCard, upsertCardI18n, upsertGameConfig } = require('./adminCardService.cjs');
const { adminLogin, listAdminUsers, resetUserElo } = require('./adminService.cjs');
const {
  getAllCardI18n,
  getCardI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
} = require('./cardDataService.cjs');
const { createUserDeck, deleteUserDeck, listUserDecks } = require('./deckService.cjs');
const {
  getMatchmakingStatus,
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  reportRealMatch,
} = require('./matchmakingService.cjs');
const { getAdminMatches, getLeaderboard, getMatchActionLog, getUserMatches } = require('./matchQueries.cjs');
const { submitMatchResult } = require('./matchSubmission.cjs');
let staticCards = [];
try { staticCards = require('../cards.json'); } catch (_) { /* API container may not have cards.json */ }
let staticCardI18n = {};
try { staticCardI18n = require('../data/card-effects-i18n.json'); } catch (_) { /* API container may not have i18n data */ }

const pbkdf2 = util.promisify(crypto.pbkdf2);

// ===== Config =====
const PORT = Number(process.env.API_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
// P0-3：Admin 密碼改為後端環境變數，移除前端硬編碼。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// PostgreSQL 設定（水平擴展：以 PG 取代 SQLite）
const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = Number(process.env.PG_PORT) || 5432;
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';
const PG_DATABASE = process.env.PG_DATABASE || 'postgres';

// Redis 設定（matchmaking 佇列 + rate limit）
// 復用服務器既有 Redis 時用 REDIS_DB 切到獨立 DB index（0-15）避免與其他服務的 key 衝突。
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_DB = Number(process.env.REDIS_DB) || 0;

// ===== Database (PG + Redis) =====
const pool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
  max: Number(process.env.PG_POOL_MAX) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const redis = new Redis(REDIS_URL, {
  db: REDIS_DB,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
// 連線層錯誤（如 Redis 暫時斷線）不應變成 unhandled error event；
// query 層錯誤仍會 reject promise 由各 handler 的 safe() 接住。
redis.on('error', () => {});

const staticCardMap = new Map(staticCards.map((card) => [card.id, card]));

async function initSchema() {
  // 啟動時建立 schema（CREATE TABLE IF NOT EXISTS），移除原本 SQLite PRAGMA migration 邏輯。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      nickname TEXT NOT NULL,
      elo INTEGER NOT NULL DEFAULT 1000,
      match_count INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC);

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      card_ids JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      source_match_id TEXT,
      player0_id TEXT REFERENCES users(id),
      player1_id TEXT REFERENCES users(id),
      winner_id TEXT,
      loser_id TEXT,
      winner_elo_change INTEGER NOT NULL DEFAULT 0,
      loser_elo_change INTEGER NOT NULL DEFAULT 0,
      turns INTEGER,
      duration_seconds INTEGER,
      action_log JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id);
    CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
    CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
    CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id);
    CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_match_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_match_id
      ON matches(source_match_id)
      WHERE source_match_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS bjg_matches (
      match_id TEXT PRIMARY KEY,
      state JSONB,
      initial_state JSONB,
      metadata JSONB NOT NULL,
      log JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bjg_matches_updated_at ON bjg_matches (updated_at);
    CREATE INDEX IF NOT EXISTS idx_bjg_matches_game_name ON bjg_matches ((metadata->>'gameName'));

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pack TEXT NOT NULL,
      song TEXT DEFAULT '',
      illustrator TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      element TEXT NOT NULL,
      type TEXT NOT NULL,
      clock INTEGER DEFAULT 0,
      attack_night INTEGER,
      attack_day INTEGER,
      power_cost INTEGER DEFAULT 0,
      send_to_power INTEGER DEFAULT 0,
      effect TEXT DEFAULT '',
      image TEXT DEFAULT '',
      errata TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS card_effects_i18n (
      card_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      effect_text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (card_id, lang)
    );

    CREATE TABLE IF NOT EXISTS game_config (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS preset_decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      card_ids JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// 啟動時嘗試初始化 schema，連不上 PG 也允許載入（語法檢查用）。
// 匯出 schemaReady 供測試 await，避免載入後立即發 request 造成 race condition。
const schemaReady = initSchema().catch((err) => {
  console.error('Schema init failed:', err.message);
});

// ===== Auth =====
// P0-4：PBKDF2 迭代數從 10000 提升至 100000（現代安全標準）。
const PBKDF2_ITERATIONS = 100000;
// 向後相容：舊用戶的密碼仍用舊迭代數驗證，登入成功後自動升級。
const PBKDF2_LEGACY_ITERATIONS = 10000;

// 非同步 pbkdf2（避免事件迴圈阻塞，水平擴展下不可擋迴圈）。
async function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const buf = await pbkdf2(password, salt, iterations, 64, 'sha512');
  return buf.toString('hex');
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
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
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
  } catch {
    return false;
  }
}

// 輸入 sanitization（P0-4：防範 XSS）。
function sanitizeText(value, maxLen = 60) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen).replace(/[<>]/g, '');
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
    for (const key of [
      'choiceId',
      'choiceType',
      'sourceZone',
      'destinationZone',
      'destinationPosition',
      'effectLabel',
    ]) {
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
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
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
      if (entry.chronosPosition !== undefined)
        clean.chronosPosition = Math.max(0, Math.trunc(finiteNumber(entry.chronosPosition, 0)));
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

// ===== Rate Limiting (P0-4, Redis INCR + TTL) =====
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_AUTH = 10;
const RATE_LIMIT_DEFAULT = 120;

async function checkRateLimit(ip, limit) {
  const minuteWindow = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const key = `ratelimit:${ip}:${minuteWindow}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 120);
  }
  return count <= limit;
}

// ===== CORS (P0-4 收緊為白名單) =====
const corsAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
// 開發環境 fallback：允許 localhost
const devOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];
const effectiveCorsOrigins = corsAllowedOrigins.length > 0 ? corsAllowedOrigins : devOrigins;

function getCorsOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (effectiveCorsOrigins.includes(reqOrigin)) return reqOrigin;
  return null;
}

// ===== Matchmaking (Redis Hash + Sorted Set + Lua 原子配對) =====
// 結構：
//   mm:queue      sorted set，score = joinedAt(ms)，member = userId
//   mm:{userId}   hash，欄位：queueId/joinedAt/deckName/deckIds/status/matchId/opponentId/role/realMatchId
const MATCHMAKING_TIMEOUT_MS = 60 * 1000;
const MATCHMAKING_TIMEOUT_GRACE_MS = 10 * 1000;
// entry TTL = timeout + grace（70 秒）
const MM_TTL_SECONDS = Math.ceil((MATCHMAKING_TIMEOUT_MS + MATCHMAKING_TIMEOUT_GRACE_MS) / 1000);

function generateMatchmakingId() {
  return 'mm_' + crypto.randomBytes(8).toString('hex');
}

// Lua：原子配對（多實例下不會把同一人配給兩人）。
// KEYS[1] = mm:queue
// ARGV[1] = userId, ARGV[2] = now(ms), ARGV[3] = matchId, ARGV[4] = timeoutMs
const MATCH_LUA = `
local userId = ARGV[1]
local now = tonumber(ARGV[2])
local matchId = ARGV[3]
local timeoutMs = tonumber(ARGV[4])

-- 清掉過期的 queued 玩家（轉 timeout）
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], 0, now - timeoutMs)
for i, uid in ipairs(expired) do
  redis.call('HSET', 'mm:' .. uid, 'status', 'timeout')
  redis.call('ZREM', KEYS[1], uid)
end

-- 找最早的 waiting 對手
local opponents = redis.call('ZRANGE', KEYS[1], 0, 0)
if #opponents == 0 or opponents[1] == userId then
  return ''
end
local opponentId = opponents[1]

-- 原子移除對手
redis.call('ZREM', KEYS[1], opponentId)
redis.call('ZREM', KEYS[1], userId)

-- userId 字串較小者為 host
local hostId, guestId
if userId < opponentId then
  hostId = userId; guestId = opponentId
else
  hostId = opponentId; guestId = userId
end

redis.call('HSET', 'mm:' .. userId, 'status', 'matched', 'matchId', matchId, 'opponentId', opponentId, 'role', userId == hostId and 'host' or 'guest')
redis.call('HSET', 'mm:' .. opponentId, 'status', 'matched', 'matchId', matchId, 'opponentId', userId, 'role', opponentId == hostId and 'host' or 'guest')

return opponentId
`;

// Lua：清理過期 queued 玩家（status endpoint 用）。
// KEYS[1] = mm:queue, ARGV[1] = now(ms), ARGV[2] = timeoutMs
const CLEAN_LUA = `
local now = tonumber(ARGV[1])
local timeoutMs = tonumber(ARGV[2])
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], 0, now - timeoutMs)
for i, uid in ipairs(expired) do
  redis.call('HSET', 'mm:' .. uid, 'status', 'timeout')
  redis.call('ZREM', KEYS[1], uid)
end
return #expired
`;

redis.defineCommand('mmTryMatch', { numberOfKeys: 1, lua: MATCH_LUA });
redis.defineCommand('mmCleanExpired', { numberOfKeys: 1, lua: CLEAN_LUA });

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
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Rate limiting (P0-4, Redis)
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const isAuthEndpoint = pathname === '/api/login' || pathname === '/api/register' || pathname === '/api/admin/login';

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = () =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
    });

  // 統一 async handler 錯誤處理：PG/Redis 丟錯時回 500，避免 unhandled rejection 崩潰。
  const safe = (fn) => {
    Promise.resolve()
      .then(fn)
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
  };

  // 先做 rate limit（async），其餘邏輯在 callback 內繼續。
  safe(async () => {
    if (!(await checkRateLimit(clientIp, isAuthEndpoint ? RATE_LIMIT_AUTH : RATE_LIMIT_DEFAULT))) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }));
      return;
    }

    // ===== Auth Routes =====

    // Register
    if (pathname === '/api/register' && method === 'POST') {
      const result = await registerAccount({
        pool,
        body: await readBody(),
        sanitizeText,
        hashPassword,
        createToken,
        generateUserId: () => 'u_' + crypto.randomBytes(8).toString('hex'),
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Login
    if (pathname === '/api/login' && method === 'POST') {
      const result = await loginAccount({
        pool,
        body: await readBody(),
        hashPassword,
        createToken,
        currentIterations: PBKDF2_ITERATIONS,
        legacyIterations: PBKDF2_LEGACY_ITERATIONS,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Get profile
    if (pathname === '/api/profile' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await getAccountProfile(pool, userId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Deck Routes =====

    // List user's decks
    if (pathname === '/api/decks' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await listUserDecks(pool, userId));
      return;
    }

    // Create deck
    if (pathname === '/api/decks' && method === 'POST') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await createUserDeck(pool, userId, await readBody());
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Delete deck
    if (pathname.match(/^\/api\/decks\/d_/) && method === 'DELETE') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const deckId = pathname.split('/').pop();
      const result = await deleteUserDeck(pool, userId, deckId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Match Routes =====

    // Get match action log
    const matchLogRoute = pathname.match(/^\/api\/matches\/([^/]+)\/log$/);
    if (matchLogRoute && method === 'GET') {
      const matchId = matchLogRoute[1];
      const result = await getMatchActionLog(pool, matchId, sanitizeActionLog);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Submit match result
    if (pathname === '/api/matches' && method === 'POST') {
      // P0-2：強制 JWT 認證，只有贏家可以提交自己的勝利。
      const authUserId = getAuthUserId(req);
      if (!authUserId) return json({ error: 'Unauthorized' }, 401);

      const body = await readBody();
      const result = await submitMatchResult({
        pool,
        authUserId,
        body,
        sanitizeActionLog,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Leaderboard
    if (pathname === '/api/leaderboard' && method === 'GET') {
      json(await getLeaderboard(pool, url.searchParams.get('limit'), sanitizeText));
      return;
    }

    // P2-10：使用者對戰歷史（跨裝置同步）。
    if (pathname === '/api/matches' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await getUserMatches(pool, userId, url.searchParams.get('limit'), url.searchParams.get('offset')));
      return;
    }

    // PUT /api/profile — 修改暱稱（P2 補齊）。
    if (pathname === '/api/profile' && method === 'PUT') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await updateAccountProfile({ pool, userId, body: await readBody(), sanitizeText });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Admin API (P0-3 + P2-12) =====

    // Admin 登入
    if (pathname === '/api/admin/login' && method === 'POST') {
      const result = await adminLogin(await readBody(), ADMIN_PASSWORD, createAdminToken);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：使用者列表
    if (pathname === '/api/admin/users' && method === 'GET') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      json(await listAdminUsers(pool, url.searchParams.get('limit')));
      return;
    }

    // Admin：對戰列表
    if (pathname === '/api/admin/matches' && method === 'GET') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      json(await getAdminMatches(pool, url.searchParams.get('limit')));
      return;
    }

    // Admin：重置使用者 ELO
    if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/elo') && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const targetUserId = pathname.split('/')[4];
      const { elo } = await readBody();
      json(await resetUserElo(pool, targetUserId, elo));
      return;
    }

    // ===== Card Data Routes =====

    // Public: list card definitions from PG, falling back to static cards.json when cards are not seeded.
    if (pathname === '/api/cards' && method === 'GET') {
      res.setHeader('Cache-Control', 'public, max-age=300');
      json(await getPublicCards(pool, url.searchParams, staticCards));
      return;
    }

    // 批次 i18n 端點：回傳所有卡牌的所有語言翻譯（與 data/card-effects-i18n.json 結構相同）
    if (pathname === '/api/cards/i18n' && method === 'GET') {
      json(await getAllCardI18n(pool, staticCardI18n));
      return;
    }

    const publicCardI18nRoute = pathname.match(/^\/api\/cards\/([^/]+)\/i18n$/);
    if (publicCardI18nRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardI18nRoute[1]);
      json(await getCardI18n(pool, staticCardI18n, cardId));
      return;
    }

    const publicCardRoute = pathname.match(/^\/api\/cards\/([^/]+)$/);
    if (publicCardRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardRoute[1]);
      const result = await getPublicCard(pool, staticCardMap, cardId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/config' && method === 'GET') {
      json(await getGameConfig(pool));
      return;
    }

    if (pathname === '/api/preset-decks' && method === 'GET') {
      json(await getPresetDecks(pool));
      return;
    }

    // Admin: no-op reload signal for clients that refetch card data after edits.
    if (pathname === '/api/admin/cards/reload' && method === 'POST') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      json({ ok: true });
      return;
    }

    const adminCardI18nRoute = pathname.match(/^\/api\/admin\/cards\/([^/]+)\/i18n$/);
    if (adminCardI18nRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const cardId = decodeURIComponent(adminCardI18nRoute[1]);
      const result = await upsertCardI18n(pool, cardId, await readBody());
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const adminCardRoute = pathname.match(/^\/api\/admin\/cards\/([^/]+)$/);
    if (adminCardRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const cardId = decodeURIComponent(adminCardRoute[1]);
      const result = await upsertCard(pool, staticCardMap, cardId, await readBody());
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const adminConfigRoute = pathname.match(/^\/api\/admin\/config\/([^/]+)$/);
    if (adminConfigRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const key = decodeURIComponent(adminConfigRoute[1]);
      const result = await upsertGameConfig(pool, key, await readBody());
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Matchmaking Routes =====

    // POST /api/matchmaking/queue — 加入配對佇列
    if (pathname === '/api/matchmaking/queue' && method === 'POST') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(
        await joinMatchmakingQueue({
          redis,
          userId,
          body: await readBody(),
          sanitizeText,
          generateQueueId: () => 'q_' + crypto.randomBytes(8).toString('hex'),
          generateMatchId: generateMatchmakingId,
          ttlSeconds: MM_TTL_SECONDS,
          timeoutMs: MATCHMAKING_TIMEOUT_MS,
        }),
      );
      return;
    }

    // GET /api/matchmaking/status — 查詢配對狀態
    if (pathname === '/api/matchmaking/status' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await getMatchmakingStatus(redis, userId, Date.now(), MATCHMAKING_TIMEOUT_MS));
      return;
    }

    // DELETE /api/matchmaking/queue — 離開佇列
    if (pathname === '/api/matchmaking/queue' && method === 'DELETE') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await leaveMatchmakingQueue(redis, userId));
      return;
    }

    // PUT /api/matchmaking/match — host 回報真實 boardgame.io matchID
    if (pathname === '/api/matchmaking/match' && method === 'PUT') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { matchId } = await readBody();
      const result = await reportRealMatch(redis, userId, matchId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Default =====
    res.writeHead(404);
    res.end('Not Found');
  });
}

// ===== Start =====
const server = http.createServer(handleRequest);

async function closeDatabase() {
  await pool.end();
  await redis.quit();
}

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await closeDatabase();
  } catch {}
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  initSchema()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`Zutomayo API server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize schema, starting anyway:', err.message);
      server.listen(PORT, () => {
        console.log(`Zutomayo API server running on port ${PORT}`);
      });
    });
}

module.exports = {
  handleRequest,
  server,
  closeDatabase,
  schemaReady,
};
