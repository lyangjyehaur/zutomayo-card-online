const http = require('http');
const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const Redis = require('ioredis');
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
const I18N_LANGS = ['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'];
const I18N_LANG_ALIASES = new Map([
  ['zhTW', 'zh-TW'],
  ['zhCN', 'zh-CN'],
  ['zhHK', 'zh-HK'],
]);

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

// ===== ELO =====
function calculateElo(ratingA, ratingB, scoreA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

function normalizeWinnerPlayer(value) {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  return null;
}

function boardgameWinnerFromState(state) {
  if (!state || typeof state !== 'object') return null;
  const gameover = state.ctx && typeof state.ctx === 'object' ? state.ctx.gameover : null;
  if (gameover && typeof gameover === 'object') {
    if (gameover.draw) return null;
    const winner = normalizeWinnerPlayer(gameover.winner);
    if (winner !== null) return winner;
  }
  const G = state.G && typeof state.G === 'object' ? state.G : null;
  return normalizeWinnerPlayer(G?.winner);
}

function isBoardgameFinished(state) {
  if (!state || typeof state !== 'object') return false;
  const G = state.G && typeof state.G === 'object' ? state.G : null;
  return Boolean(state.ctx?.gameover) || G?.step === 'gameOver';
}

function playerDataUserId(metadata, player) {
  const seat = metadata?.players?.[String(player)] || metadata?.players?.[player];
  const userId = seat?.data?.userId;
  return typeof userId === 'string' ? userId : '';
}

async function verifyBoardgameMatchResult(sourceMatchId, winnerPlayer, authUserId) {
  if (!sourceMatchId) return { ok: true };
  if (winnerPlayer !== 0 && winnerPlayer !== 1) {
    return { ok: false, status: 400, error: 'winnerPlayer required for source match verification' };
  }
  const match = (await pool.query('SELECT state, metadata FROM bjg_matches WHERE match_id = $1', [sourceMatchId])).rows[0];
  if (!match) return { ok: false, status: 404, error: 'Source match not found' };
  if (!isBoardgameFinished(match.state)) return { ok: false, status: 409, error: 'Source match is not finished' };
  const authoritativeWinner = boardgameWinnerFromState(match.state);
  if (authoritativeWinner === null) return { ok: false, status: 409, error: 'Source match has no winner' };
  if (authoritativeWinner !== winnerPlayer) {
    return { ok: false, status: 403, error: 'Winner does not match source match' };
  }
  if (playerDataUserId(match.metadata, winnerPlayer) !== authUserId) {
    return { ok: false, status: 403, error: 'Winner seat is not bound to authenticated user' };
  }
  return { ok: true };
}

// ===== Action Log Sanitization =====
function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function optionalString(value) {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}

function cardRowToDef(row) {
  const def = {
    id: row.id,
    name: row.name,
    pack: row.pack,
    song: row.song || '',
    illustrator: row.illustrator || '',
    rarity: row.rarity || '',
    element: row.element,
    type: row.type,
    clock: row.clock ?? 0,
    attack:
      row.attack_night === null ||
      row.attack_night === undefined ||
      row.attack_day === null ||
      row.attack_day === undefined
        ? null
        : { night: row.attack_night, day: row.attack_day },
    powerCost: row.power_cost ?? 0,
    sendToPower: row.send_to_power ?? 0,
    effect: row.effect || '',
    image: row.image || '',
    errata: row.errata || '',
  };
  if (row.en_name_official) def.enNameOfficial = row.en_name_official;
  if (row.en_effect_official) def.enEffectOfficial = row.en_effect_official;
  return def;
}

function cardDefToDbParams(card) {
  const attack =
    card.attack && typeof card.attack === 'object'
      ? {
          night: Number.isFinite(Number(card.attack.night)) ? Math.trunc(Number(card.attack.night)) : null,
          day: Number.isFinite(Number(card.attack.day)) ? Math.trunc(Number(card.attack.day)) : null,
        }
      : null;

  return [
    card.id,
    card.name,
    card.enNameOfficial || '',
    card.pack,
    card.song || '',
    card.illustrator || '',
    card.rarity || '',
    card.element,
    card.type,
    Math.trunc(Number(card.clock) || 0),
    attack?.night ?? null,
    attack?.day ?? null,
    Math.trunc(Number(card.powerCost) || 0),
    Math.trunc(Number(card.sendToPower) || 0),
    card.effect || '',
    card.enEffectOfficial || '',
    card.image || '',
    card.errata || '',
  ];
}

function normalizeCardForUpsert(id, body, baseCard) {
  const bodyCard = body && typeof body === 'object' ? body : {};
  const candidate = {
    ...(baseCard || {}),
    ...bodyCard,
    id,
  };
  if (baseCard?.attack && bodyCard.attack && typeof bodyCard.attack === 'object') {
    candidate.attack = { ...baseCard.attack, ...bodyCard.attack };
  }

  for (const field of ['name', 'pack', 'element', 'type']) {
    if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
      return null;
    }
  }

  return {
    id,
    name: String(candidate.name),
    enNameOfficial: typeof candidate.enNameOfficial === 'string' ? candidate.enNameOfficial : '',
    pack: String(candidate.pack),
    song: typeof candidate.song === 'string' ? candidate.song : '',
    illustrator: typeof candidate.illustrator === 'string' ? candidate.illustrator : '',
    rarity: typeof candidate.rarity === 'string' ? candidate.rarity : '',
    element: String(candidate.element),
    type: String(candidate.type),
    clock: Math.trunc(Number(candidate.clock) || 0),
    attack:
      candidate.attack && typeof candidate.attack === 'object'
        ? {
            night: Math.trunc(Number(candidate.attack.night) || 0),
            day: Math.trunc(Number(candidate.attack.day) || 0),
          }
        : null,
    powerCost: Math.trunc(Number(candidate.powerCost) || 0),
    sendToPower: Math.trunc(Number(candidate.sendToPower) || 0),
    effect: typeof candidate.effect === 'string' ? candidate.effect : '',
    enEffectOfficial: typeof candidate.enEffectOfficial === 'string' ? candidate.enEffectOfficial : '',
    image: typeof candidate.image === 'string' ? candidate.image : '',
    errata: typeof candidate.errata === 'string' ? candidate.errata : '',
  };
}

function filterStaticCards(searchParams) {
  let cards = staticCards;
  const pack = searchParams.get('pack');
  const element = searchParams.get('element');
  const type = searchParams.get('type');
  if (pack) cards = cards.filter((card) => card.pack === pack);
  if (element) cards = cards.filter((card) => card.element === element);
  if (type) cards = cards.filter((card) => card.type === type);
  return cards;
}

function normalizeI18nLang(lang) {
  if (typeof lang !== 'string') return null;
  const canonical = I18N_LANG_ALIASES.get(lang) || lang;
  return I18N_LANGS.includes(canonical) ? canonical : null;
}

function staticI18nForCard(cardId) {
  const source = staticCardI18n && typeof staticCardI18n === 'object' ? staticCardI18n[cardId] : null;
  return Object.fromEntries(
    I18N_LANGS.map((lang) => [lang, source && typeof source[lang] === 'string' ? source[lang] : '']),
  );
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
      const { email, password, nickname } = await readBody();
      if (!email || !password) return json({ error: 'Email and password required' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

      const cleanEmail = String(email).slice(0, 120).toLowerCase();
      const cleanNickname = sanitizeText(nickname || String(cleanEmail).split('@')[0], 30) || 'player';

      const existing = (await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail])).rows[0];
      if (existing) return json({ error: 'Email already registered' }, 409);

      const id = 'u_' + crypto.randomBytes(8).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = await hashPassword(password, salt);

      await pool.query('INSERT INTO users (id, email, password_hash, salt, nickname) VALUES ($1, $2, $3, $4, $5)', [
        id,
        cleanEmail,
        hash,
        salt,
        cleanNickname,
      ]);

      const token = createToken(id);
      json({ token, user: { id, email: cleanEmail, nickname: cleanNickname, elo: 1000 } });
      return;
    }

    // Login
    if (pathname === '/api/login' && method === 'POST') {
      const { email, password } = await readBody();
      const user = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
      if (!user) return json({ error: 'Invalid credentials' }, 401);

      // P0-4：先用新迭代數驗證，失敗再用舊迭代數驗證（向後相容）。
      const newHash = await hashPassword(password, user.salt, PBKDF2_ITERATIONS);
      const legacyHash = await hashPassword(password, user.salt, PBKDF2_LEGACY_ITERATIONS);
      if (newHash !== user.password_hash && legacyHash !== user.password_hash) {
        return json({ error: 'Invalid credentials' }, 401);
      }

      // 若密碼仍用舊迭代數，登入成功後自動升級到新迭代數。
      if (newHash !== user.password_hash) {
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      }

      const token = createToken(user.id);
      json({
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname, elo: user.elo },
      });
      return;
    }

    // Get profile
    if (pathname === '/api/profile' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
      if (!user) return json({ error: 'User not found' }, 404);
      json({
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        elo: user.elo,
        matchCount: user.match_count,
        wins: user.wins,
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
      const decks = (await pool.query('SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [userId]))
        .rows;
      json({
        decks: decks.map((d) => ({
          ...d,
          cardIds: Array.isArray(d.card_ids) ? d.card_ids : [],
        })),
      });
      return;
    }

    // Create deck
    if (pathname === '/api/decks' && method === 'POST') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { name, cardIds } = await readBody();
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
      await pool.query('INSERT INTO decks (id, user_id, name, card_ids) VALUES ($1, $2, $3, $4::jsonb)', [
        id,
        userId,
        name,
        JSON.stringify(cardIds),
      ]);
      json({ id, name, cardIds });
      return;
    }

    // Delete deck
    if (pathname.match(/^\/api\/decks\/d_/) && method === 'DELETE') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const deckId = pathname.split('/').pop();
      const result = await pool.query('DELETE FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId]);
      if (result.rowCount === 0) return json({ error: 'Deck not found' }, 404);
      json({ deleted: true });
      return;
    }

    // ===== Match Routes =====

    // Get match action log
    const matchLogRoute = pathname.match(/^\/api\/matches\/([^/]+)\/log$/);
    if (matchLogRoute && method === 'GET') {
      const matchId = matchLogRoute[1];
      const match = (await pool.query('SELECT id, action_log FROM matches WHERE id = $1', [matchId])).rows[0];
      if (!match) return json({ error: 'Match not found' }, 404);
      const actionLog = Array.isArray(match.action_log) ? match.action_log : [];
      json({ matchId: match.id, actionLog: sanitizeActionLog(actionLog) });
      return;
    }

    // Submit match result
    if (pathname === '/api/matches' && method === 'POST') {
      // P0-2：強制 JWT 認證，只有贏家可以提交自己的勝利。
      const authUserId = getAuthUserId(req);
      if (!authUserId) return json({ error: 'Unauthorized' }, 401);

      const body = await readBody();
      const { winnerId, loserId, turns, duration, actionLog, action_log, sourceMatchId, winnerPlayer } = body;
      if (!winnerId || !loserId) return json({ error: 'Winner and loser IDs required' }, 400);
      // P0-2：認證使用者必須是贏家，杜絕偽造勝負。
      if (winnerId !== authUserId) return json({ error: 'Forbidden: winner must match authenticated user' }, 403);

      const cleanSourceMatchId =
        typeof sourceMatchId === 'string' && sourceMatchId.length > 0 ? sourceMatchId.slice(0, 120) : '';
      const sourceVerification = await verifyBoardgameMatchResult(
        cleanSourceMatchId,
        normalizeWinnerPlayer(winnerPlayer),
        authUserId,
      );
      if (!sourceVerification.ok) return json({ error: sourceVerification.error }, sourceVerification.status);

      const sanitizedActionLog = sanitizeActionLog(actionLog ?? action_log);
      const matchId = 'm_' + crypto.randomBytes(8).toString('hex');

      // 交易：兩個 UPDATE users + 一個 INSERT matches 必須原子。
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const winner = (await client.query('SELECT * FROM users WHERE id = $1', [winnerId])).rows[0];
        const loser = (await client.query('SELECT * FROM users WHERE id = $1', [loserId])).rows[0];

        let winnerEloChange = 0;
        let loserEloChange = 0;

        if (winner && loser) {
          const newWinnerElo = calculateElo(winner.elo, loser.elo, 1);
          const newLoserElo = calculateElo(loser.elo, winner.elo, 0);
          winnerEloChange = newWinnerElo - winner.elo;
          loserEloChange = newLoserElo - loser.elo;

          await client.query(
            'UPDATE users SET elo = $1, match_count = match_count + 1, wins = wins + 1 WHERE id = $2',
            [newWinnerElo, winnerId],
          );
          await client.query('UPDATE users SET elo = $1, match_count = match_count + 1 WHERE id = $2', [
            newLoserElo,
            loserId,
          ]);
        }

        const player0Id = winner ? winnerId : null;
        const player1Id = loser ? loserId : null;
        await client.query(
          'INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, action_log) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)',
          [
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
          ],
        );

        await client.query('COMMIT');

        json({
          matchId,
          winnerEloChange,
          loserEloChange,
          winnerNewElo: (winner?.elo || 1000) + winnerEloChange,
          loserNewElo: (loser?.elo || 1000) + loserEloChange,
        });
        return;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Leaderboard
    if (pathname === '/api/leaderboard' && method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
      const entries = (
        await pool.query(
          'SELECT id, nickname, elo, match_count, wins FROM users WHERE match_count > 0 ORDER BY elo DESC LIMIT $1',
          [limit],
        )
      ).rows;
      json({
        leaderboard: entries.map((e) => ({
          id: e.id,
          nickname: sanitizeText(e.nickname, 60),
          elo: e.elo,
          matchCount: e.match_count,
          wins: e.wins,
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
      const matches = (
        await pool.query(
          `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       WHERE m.player0_id = $1 OR m.player1_id = $2
       ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`,
          [userId, userId, limit, offset],
        )
      ).rows;
      json({
        matches: matches.map((m) => ({
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
      const { nickname } = await readBody();
      const clean = sanitizeText(nickname, 30);
      if (!clean) return json({ error: 'Nickname required' }, 400);
      await pool.query('UPDATE users SET nickname = $1 WHERE id = $2', [clean, userId]);
      const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
      json({
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        elo: user.elo,
        matchCount: user.match_count,
        wins: user.wins,
        winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
      });
      return;
    }

    // ===== Admin API (P0-3 + P2-12) =====

    // Admin 登入
    if (pathname === '/api/admin/login' && method === 'POST') {
      if (!ADMIN_PASSWORD) return json({ error: 'Admin not configured' }, 503);
      const { password } = await readBody();
      if (password !== ADMIN_PASSWORD) return json({ error: 'Invalid password' }, 401);
      json({ token: createAdminToken() });
      return;
    }

    // Admin：使用者列表
    if (pathname === '/api/admin/users' && method === 'GET') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
      const users = (
        await pool.query(
          'SELECT id, email, nickname, elo, match_count, wins, created_at FROM users ORDER BY created_at DESC LIMIT $1',
          [limit],
        )
      ).rows;
      json({
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          nickname: u.nickname,
          elo: u.elo,
          matchCount: u.match_count,
          wins: u.wins,
          createdAt: u.created_at,
          winRate: u.match_count > 0 ? Math.round((u.wins / u.match_count) * 100) : 0,
        })),
      });
      return;
    }

    // Admin：對戰列表
    if (pathname === '/api/admin/matches' && method === 'GET') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      const matches = (
        await pool.query(
          `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       ORDER BY m.created_at DESC LIMIT $1`,
          [limit],
        )
      ).rows;
      json({
        matches: matches.map((m) => ({
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

    // Admin：重置使用者 ELO
    if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/elo') && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const targetUserId = pathname.split('/')[4];
      const { elo } = await readBody();
      const newElo = Math.max(0, Math.min(9999, Math.trunc(Number(elo) || 1000)));
      await pool.query('UPDATE users SET elo = $1 WHERE id = $2', [newElo, targetUserId]);
      json({ id: targetUserId, elo: newElo });
      return;
    }

    // ===== Card Data Routes =====

    // Public: list card definitions from PG, falling back to static cards.json when cards are not seeded.
    if (pathname === '/api/cards' && method === 'GET') {
      res.setHeader('Cache-Control', 'public, max-age=300');
      try {
        const conditions = [];
        const values = [];
        for (const [param, column] of [
          ['pack', 'pack'],
          ['element', 'element'],
          ['type', 'type'],
        ]) {
          const value = url.searchParams.get(param);
          if (!value) continue;
          values.push(value);
          conditions.push(`${column} = $${values.length}`);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const cards = (
          await pool.query(
            `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata
             FROM cards ${where}
             ORDER BY id`,
            values,
          )
        ).rows;
        if (cards.length > 0) {
          json(cards.map(cardRowToDef));
          return;
        }

        const hasSeededCards = (await pool.query('SELECT 1 FROM cards LIMIT 1')).rows.length > 0;
        if (hasSeededCards) {
          json([]);
          return;
        }
      } catch {
        // Keep the API usable in offline/dev environments where PG card data is not available.
      }
      json(filterStaticCards(url.searchParams));
      return;
    }

    // 批次 i18n 端點：回傳所有卡牌的所有語言翻譯（與 data/card-effects-i18n.json 結構相同）
    if (pathname === '/api/cards/i18n' && method === 'GET') {
      try {
        const rows = (await pool.query('SELECT card_id, lang, effect_text FROM card_effects_i18n ORDER BY card_id, lang')).rows;
        if (rows.length > 0) {
          const grouped = {};
          for (const row of rows) {
            if (!grouped[row.card_id]) grouped[row.card_id] = {};
            grouped[row.card_id][row.lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
          }
          json(grouped);
          return;
        }
      } catch {
        // Fallback below
      }
      json(staticCardI18n);
      return;
    }

    const publicCardI18nRoute = pathname.match(/^\/api\/cards\/([^/]+)\/i18n$/);
    if (publicCardI18nRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardI18nRoute[1]);
      const translations = staticI18nForCard(cardId);
      try {
        const rows = (
          await pool.query('SELECT lang, effect_text FROM card_effects_i18n WHERE card_id = $1', [cardId])
        ).rows;
        for (const row of rows) {
          const lang = normalizeI18nLang(row.lang);
          if (lang) translations[lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
        }
      } catch {
        // Static fallback already populated above.
      }
      json(translations);
      return;
    }

    const publicCardRoute = pathname.match(/^\/api\/cards\/([^/]+)$/);
    if (publicCardRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardRoute[1]);
      try {
        const card = (
          await pool.query(
            `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata
             FROM cards
             WHERE id = $1`,
            [cardId],
          )
        ).rows[0];
        if (card) {
          json(cardRowToDef(card));
          return;
        }
      } catch {
        // Static fallback below.
      }

      const fallback = staticCardMap.get(cardId);
      if (!fallback) return json({ error: 'Card not found' }, 404);
      json(fallback);
      return;
    }

    if (pathname === '/api/config' && method === 'GET') {
      const rows = (await pool.query('SELECT key, value FROM game_config ORDER BY key')).rows;
      json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
      return;
    }

    if (pathname === '/api/preset-decks' && method === 'GET') {
      const rows = (await pool.query('SELECT id, name, card_ids FROM preset_decks ORDER BY id')).rows;
      json(
        rows.map((deck) => ({
          id: deck.id,
          name: deck.name,
          cardIds: Array.isArray(deck.card_ids) ? deck.card_ids : [],
        })),
      );
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
      const body = await readBody();
      const lang = normalizeI18nLang(body?.lang);
      if (!lang) return json({ error: 'Unsupported language' }, 400);
      if (typeof body?.effectText !== 'string') return json({ error: 'effectText required' }, 400);

      await pool.query(
        `INSERT INTO card_effects_i18n (card_id, lang, effect_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (card_id, lang) DO UPDATE SET
           effect_text = EXCLUDED.effect_text`,
        [cardId, lang, body.effectText],
      );
      await pool.query(
        'INSERT INTO admin_audit_log (action, target_type, target_id, details) VALUES ($1, $2, $3, $4::jsonb)',
        ['upsert_card_i18n', 'card_effects_i18n', cardId, JSON.stringify({ lang, effectText: body.effectText })],
      );
      json({ ok: true });
      return;
    }

    const adminCardRoute = pathname.match(/^\/api\/admin\/cards\/([^/]+)$/);
    if (adminCardRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const cardId = decodeURIComponent(adminCardRoute[1]);
      const body = await readBody();
      const existing = (
        await pool.query(
          `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                  attack_night, attack_day, power_cost, send_to_power, effect,
                  en_effect_official, image, errata
           FROM cards
           WHERE id = $1`,
          [cardId],
        )
      ).rows[0];
      const card = normalizeCardForUpsert(cardId, body, existing ? cardRowToDef(existing) : staticCardMap.get(cardId));
      if (!card) return json({ error: 'Card requires name, pack, element, and type' }, 400);

      await pool.query(
        `INSERT INTO cards (
           id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
           attack_night, attack_day, power_cost, send_to_power, effect,
           en_effect_official, image, errata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           en_name_official = EXCLUDED.en_name_official,
           pack = EXCLUDED.pack,
           song = EXCLUDED.song,
           illustrator = EXCLUDED.illustrator,
           rarity = EXCLUDED.rarity,
           element = EXCLUDED.element,
           type = EXCLUDED.type,
           clock = EXCLUDED.clock,
           attack_night = EXCLUDED.attack_night,
           attack_day = EXCLUDED.attack_day,
           power_cost = EXCLUDED.power_cost,
           send_to_power = EXCLUDED.send_to_power,
           effect = EXCLUDED.effect,
           en_effect_official = EXCLUDED.en_effect_official,
           image = EXCLUDED.image,
           errata = EXCLUDED.errata,
           updated_at = NOW()`,
        cardDefToDbParams(card),
      );
      await pool.query(
        'INSERT INTO admin_audit_log (action, target_type, target_id, details) VALUES ($1, $2, $3, $4::jsonb)',
        ['upsert_card', 'card', cardId, JSON.stringify({ card })],
      );
      json(card);
      return;
    }

    const adminConfigRoute = pathname.match(/^\/api\/admin\/config\/([^/]+)$/);
    if (adminConfigRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const key = decodeURIComponent(adminConfigRoute[1]);
      const body = await readBody();
      if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'value')) {
        return json({ error: 'Config value required' }, 400);
      }
      const description = typeof body.description === 'string' ? body.description : '';
      await pool.query(
        `INSERT INTO game_config (key, value, description)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [key, JSON.stringify(body.value), description],
      );
      await pool.query(
        'INSERT INTO admin_audit_log (action, target_type, target_id, details) VALUES ($1, $2, $3, $4::jsonb)',
        ['upsert_config', 'game_config', key, JSON.stringify({ value: body.value, description })],
      );
      json({ key, value: body.value, description });
      return;
    }

    // ===== Matchmaking Routes =====

    // POST /api/matchmaking/queue — 加入配對佇列
    if (pathname === '/api/matchmaking/queue' && method === 'POST') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { deckName, deckIds } = await readBody();
      const existing = await redis.hgetall(`mm:${userId}`);
      // 若已在佇列且已配對，不重複加入
      if (existing && existing.status === 'matched') {
        return json({ queueId: existing.queueId, status: 'matched' });
      }
      const queueId = (existing && existing.queueId) || 'q_' + crypto.randomBytes(8).toString('hex');
      const now = Date.now();
      const cleanDeckName = typeof deckName === 'string' ? sanitizeText(deckName, 60) : '';
      const cleanDeckIds = Array.isArray(deckIds) ? deckIds.filter((id) => typeof id === 'string').slice(0, 20) : [];

      await redis.hset(`mm:${userId}`, {
        queueId,
        joinedAt: String(now),
        deckName: cleanDeckName,
        deckIds: JSON.stringify(cleanDeckIds),
        status: 'queued',
      });
      await redis.zadd('mm:queue', now, userId);
      await redis.expire(`mm:${userId}`, MM_TTL_SECONDS);

      // 嘗試立即配對（Lua 原子）
      const matchId = generateMatchmakingId();
      await redis.mmTryMatch('mm:queue', userId, String(now), matchId, String(MATCHMAKING_TIMEOUT_MS));

      const current = await redis.hgetall(`mm:${userId}`);
      if (!current || !current.status) return json({ status: 'timeout' });
      json({ queueId: current.queueId, status: current.status });
      return;
    }

    // GET /api/matchmaking/status — 查詢配對狀態
    if (pathname === '/api/matchmaking/status' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      await redis.mmCleanExpired('mm:queue', String(Date.now()), String(MATCHMAKING_TIMEOUT_MS));
      const entry = await redis.hgetall(`mm:${userId}`);
      if (!entry || !entry.status) return json({ status: 'timeout' });
      json({
        status: entry.status,
        matchId: entry.matchId || undefined,
        opponentId: entry.opponentId || undefined,
        role: entry.role || undefined,
        realMatchId: entry.realMatchId || undefined,
      });
      return;
    }

    // DELETE /api/matchmaking/queue — 離開佇列
    if (pathname === '/api/matchmaking/queue' && method === 'DELETE') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const entry = await redis.hgetall(`mm:${userId}`);
      if (entry && entry.opponentId) {
        const opponent = await redis.hgetall(`mm:${entry.opponentId}`);
        if (opponent && opponent.status) {
          // 已配對情況下離開，標記對手為 timeout 讓對手能即時知道
          await redis.hset(`mm:${entry.opponentId}`, 'status', 'timeout');
        }
      }
      await redis.zrem('mm:queue', userId);
      await redis.del(`mm:${userId}`);
      json({ deleted: true });
      return;
    }

    // PUT /api/matchmaking/match — host 回報真實 boardgame.io matchID
    if (pathname === '/api/matchmaking/match' && method === 'PUT') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { matchId } = await readBody();
      if (typeof matchId !== 'string' || !matchId) {
        return json({ error: 'matchId required' }, 400);
      }
      const entry = await redis.hgetall(`mm:${userId}`);
      if (!entry || entry.status !== 'matched') {
        return json({ error: 'Not in a matched queue' }, 400);
      }
      await redis.hset(`mm:${userId}`, 'realMatchId', matchId);
      json({ ok: true });
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
