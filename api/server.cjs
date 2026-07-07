const http = require('http');
const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const Redis = require('ioredis');
const {
  getAccountProfile,
  linkOAuthIdentity,
  listAccountIdentities,
  loginAccount,
  loginWithOAuthIdentity,
  registerAccount,
  updateAccountPassword,
  updateAccountProfile,
  unlinkOAuthIdentity,
} = require('./accountService.cjs');
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
const { countOnlinePresence, heartbeatOnlinePresence } = require('./presenceService.cjs');
const { getAdminMatches, getLeaderboard, getMatchActionLog, getUserMatches } = require('./matchQueries.cjs');
const { submitMatchResult } = require('./matchSubmission.cjs');
const {
  listPosts: listFeedbackPosts,
  getPost: getFeedbackPost,
  createPost: createFeedbackPost,
  toggleVote: toggleFeedbackVote,
  addComment: addFeedbackComment,
  updatePostStatus: updateFeedbackPostStatus,
  updatePostTag: updateFeedbackPostTag,
  deletePost: deleteFeedbackPost,
  getStats: getFeedbackStats,
  toggleCommentVote: toggleFeedbackCommentVote,
  listVoters: listFeedbackVoters,
  editPost: editFeedbackPost,
  editComment: editFeedbackComment,
  deleteComment: deleteFeedbackComment,
  listTags: listFeedbackTags,
  createTag: createFeedbackTag,
  deleteTag: deleteFeedbackTag,
  markAsDuplicate: markFeedbackAsDuplicate,
  findSimilarPosts: findFeedbackSimilarPosts,
  toggleCommentReaction: toggleFeedbackCommentReaction,
} = require('./feedbackService.cjs');

const pbkdf2 = util.promisify(crypto.pbkdf2);

// ===== Config =====
const PORT = Number(process.env.API_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
// P0-3：Admin 密碼改為後端環境變數，移除前端硬編碼。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const APP_BUILD_ID = process.env.APP_BUILD_ID || APP_VERSION;
const GAME_RULES_VERSION = process.env.GAME_RULES_VERSION || APP_VERSION;
const APP_VERSION_INFO = Object.freeze({
  appVersion: APP_VERSION,
  buildId: APP_BUILD_ID,
  rulesVersion: GAME_RULES_VERSION,
});
const AUTH_COOKIE_NAME = 'zutomayo_session';
const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || '';
const AUTH_COOKIE_SAMESITE = ['Strict', 'Lax', 'None'].includes(process.env.AUTH_COOKIE_SAMESITE)
  ? process.env.AUTH_COOKIE_SAMESITE
  : 'Lax';
const AUTH_MODE = process.env.AUTH_MODE || (process.env.LOGTO_ONLY_AUTH === 'true' ? 'logto' : 'hybrid');
const LOCAL_AUTH_ENABLED = AUTH_MODE !== 'logto';
const ACCOUNT_LINKING_ENABLED = AUTH_MODE !== 'logto';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_REQUIRED = process.env.TURNSTILE_REQUIRED === 'true';
const TURNSTILE_SITEVERIFY_URL =
  process.env.TURNSTILE_SITEVERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const OAUTH_PUBLIC_BASE_URL = process.env.OAUTH_PUBLIC_BASE_URL || '';
const LOGTO_ISSUER = (process.env.LOGTO_ISSUER || '').replace(/\/$/, '');
const LOGTO_ENDPOINT = (process.env.LOGTO_ENDPOINT || '').replace(/\/$/, '');
const LOGTO_DISCOVERY_URL =
  process.env.LOGTO_DISCOVERY_URL ||
  (LOGTO_ISSUER
    ? `${LOGTO_ISSUER}/.well-known/openid-configuration`
    : LOGTO_ENDPOINT
      ? `${LOGTO_ENDPOINT}/oidc/.well-known/openid-configuration`
      : '');
const LOGTO_ACCOUNT_CENTER_URL = process.env.LOGTO_ACCOUNT_CENTER_URL || '';

// 安全性驗證：JWT_SECRET 必須在生產環境設定
function validateSecurityConfig() {
  if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required');
    console.error('Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  if (JWT_SECRET.length < 32) {
    console.warn('WARNING: JWT_SECRET should be at least 32 characters for security');
  }
  if (!ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD not set - admin login will be disabled');
  } else if (ADMIN_PASSWORD.length < 8) {
    console.warn('WARNING: ADMIN_PASSWORD should be at least 8 characters');
  }
}

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

async function initSchema() {
  // 啟動時建立 schema（CREATE TABLE IF NOT EXISTS），移除原本 SQLite PRAGMA migration 邏輯。
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      nickname TEXT NOT NULL,
      elo INTEGER NOT NULL DEFAULT 1000,
      match_count INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_elo ON users (elo DESC)`,

    `CREATE TABLE IF NOT EXISTS user_identities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT DEFAULT '',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      display_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, provider_user_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_identities_user_provider
      ON user_identities(user_id, provider)`,
    `CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id)`,

    `CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      card_ids JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id)`,

    `CREATE TABLE IF NOT EXISTS matches (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC)`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_match_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_match_id
      ON matches(source_match_id)
      WHERE source_match_id IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS cards (
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
    )`,

    `CREATE TABLE IF NOT EXISTS card_effects_i18n (
      card_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      effect_text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (card_id, lang)
    )`,

    `CREATE TABLE IF NOT EXISTS game_config (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS preset_decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      card_ids JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ===== 反饋功能 schema（參考 Fider）=====
    `CREATE TABLE IF NOT EXISTS feedback_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      anonymous_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      tag TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (author_user_id IS NOT NULL OR anonymous_id IS NOT NULL),
      CHECK (NOT (author_user_id IS NOT NULL AND anonymous_id IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_posts_status ON feedback_posts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_posts_created_at ON feedback_posts(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS feedback_votes (
      post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
      voter_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      anonymous_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL),
      CHECK (NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_votes_user
      ON feedback_votes(post_id, voter_user_id) WHERE voter_user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_votes_anon
      ON feedback_votes(post_id, anonymous_id) WHERE anonymous_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS feedback_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      anonymous_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (author_user_id IS NOT NULL OR anonymous_id IS NOT NULL),
      CHECK (NOT (author_user_id IS NOT NULL AND anonymous_id IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_comments_post ON feedback_comments(post_id, created_at)`,

    // ===== 反饋功能擴展 schema（標籤管理/留言按讚/編輯/官方回應）=====
    // ALTER TABLE IF NOT EXISTS ADD COLUMN IF NOT EXISTS（PG 9.6+）
    `ALTER TABLE feedback_posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
    `ALTER TABLE feedback_comments ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE feedback_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
    // 留言按讚表
    `CREATE TABLE IF NOT EXISTS feedback_comment_votes (
      comment_id TEXT NOT NULL REFERENCES feedback_comments(id) ON DELETE CASCADE,
      voter_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      anonymous_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL),
      CHECK (NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_comment_votes_user
      ON feedback_comment_votes(comment_id, voter_user_id) WHERE voter_user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_comment_votes_anon
      ON feedback_comment_votes(comment_id, anonymous_id) WHERE anonymous_id IS NOT NULL`,
    // 標籤管理表
    `CREATE TABLE IF NOT EXISTS feedback_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ===== 反饋功能擴展 schema（Duplicate/Emoji 反應/圖片附件）=====
    `ALTER TABLE feedback_posts ADD COLUMN IF NOT EXISTS original_post_id TEXT REFERENCES feedback_posts(id) ON DELETE SET NULL`,
    // 留言 emoji 反應表
    `CREATE TABLE IF NOT EXISTS feedback_comment_reactions (
      comment_id TEXT NOT NULL REFERENCES feedback_comments(id) ON DELETE CASCADE,
      voter_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      anonymous_id TEXT,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL),
      CHECK (NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_comment_reactions_user
      ON feedback_comment_reactions(comment_id, voter_user_id, emoji) WHERE voter_user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_comment_reactions_anon
      ON feedback_comment_reactions(comment_id, anonymous_id, emoji) WHERE anonymous_id IS NOT NULL`,
    // 圖片附件表
    `CREATE TABLE IF NOT EXISTS feedback_attachments (
      id TEXT PRIMARY KEY,
      post_id TEXT REFERENCES feedback_posts(id) ON DELETE CASCADE,
      comment_id TEXT REFERENCES feedback_comments(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'image/png',
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (post_id IS NOT NULL OR comment_id IS NOT NULL)
    )`,
  ];

  for (const statement of schemaStatements) {
    await pool.query(statement);
  }
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

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => {
        const [name, ...valueParts] = part.trim().split('=');
        return [name, decodeCookieValue(valueParts.join('=') || '')];
      })
      .filter(([name]) => name),
  );
}

function isSecureRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https' || req.socket.encrypted === true || process.env.NODE_ENV === 'production';
}

function serializeAuthCookie(req, token, maxAge = AUTH_COOKIE_MAX_AGE_SECONDS) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    `SameSite=${AUTH_COOKIE_SAMESITE}`,
  ];
  if (AUTH_COOKIE_DOMAIN) parts.push(`Domain=${AUTH_COOKIE_DOMAIN}`);
  if (AUTH_COOKIE_SAMESITE === 'None' || isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setAuthCookie(req, res, token) {
  res.setHeader('Set-Cookie', serializeAuthCookie(req, token));
}

function clearAuthCookie(req, res) {
  res.setHeader('Set-Cookie', serializeAuthCookie(req, '', 0));
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
  if (auth) {
    const userId = verifyToken(auth.replace('Bearer ', ''));
    if (userId) return userId;
  }
  return verifyToken(parseCookies(req)[AUTH_COOKIE_NAME]);
}

function getClientCountry(req) {
  return String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').toUpperCase();
}

function hashEmailForAvatar(email) {
  return crypto.createHash('sha256').update(email).digest('hex');
}

const OAUTH_PROVIDERS = {
  logto: {
    label: 'Logto',
    clientId: process.env.LOGTO_APP_ID || process.env.LOGTO_CLIENT_ID || '',
    clientSecret: process.env.LOGTO_APP_SECRET || process.env.LOGTO_CLIENT_SECRET || '',
    discoveryUrl: LOGTO_DISCOVERY_URL,
    authUrl: '',
    tokenUrl: '',
    userInfoUrl: '',
    scope: process.env.LOGTO_OAUTH_SCOPE || 'openid profile email',
  },
  google: {
    label: 'Google',
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    label: 'GitHub',
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    emailsUrl: 'https://api.github.com/user/emails',
    scope: 'read:user user:email',
  },
  discord: {
    label: 'Discord',
    clientId: process.env.DISCORD_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
  },
};

let logtoDiscoveryCache = null;

async function resolveLogtoProvider(config) {
  if (!config.discoveryUrl || !config.clientId || !config.clientSecret) return config;
  if (!logtoDiscoveryCache) {
    const response = await fetch(config.discoveryUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Logto discovery failed');
    const discovery = await response.json();
    logtoDiscoveryCache = {
      authUrl: discovery.authorization_endpoint || '',
      tokenUrl: discovery.token_endpoint || '',
      userInfoUrl: discovery.userinfo_endpoint || '',
    };
  }
  return { ...config, ...logtoDiscoveryCache };
}

function getOAuthProvider(provider) {
  const config = OAUTH_PROVIDERS[String(provider || '').toLowerCase()];
  if (!config) return null;
  return {
    ...config,
    provider: String(provider).toLowerCase(),
    enabled: Boolean(config.clientId && config.clientSecret && (config.authUrl || config.discoveryUrl)),
  };
}

async function getResolvedOAuthProvider(provider) {
  const config = getOAuthProvider(provider);
  if (!config) return null;
  if (config.provider !== 'logto') return config;
  const resolved = await resolveLogtoProvider(config);
  return {
    ...resolved,
    enabled: Boolean(
      resolved.clientId && resolved.clientSecret && resolved.authUrl && resolved.tokenUrl && resolved.userInfoUrl,
    ),
  };
}

function isOAuthProviderAllowed(provider) {
  return LOCAL_AUTH_ENABLED || provider === 'logto';
}

function visibleOAuthProviderEntries() {
  return Object.entries(OAUTH_PROVIDERS).filter(([provider]) => isOAuthProviderAllowed(provider));
}

function getPublicBaseUrl(req) {
  if (OAUTH_PUBLIC_BASE_URL) return OAUTH_PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http')
    .split(',')[0]
    .trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/$/, '');
}

function oauthRedirectUri(req, provider) {
  return `${getPublicBaseUrl(req)}/api/oauth/${encodeURIComponent(provider)}/callback`;
}

function signOAuthState(payload) {
  const body = base64urlJson(payload);
  return `${body}.${signTokenInput(`oauth.${body}`)}`;
}

function verifyOAuthState(state) {
  try {
    const [body, signature] = String(state || '').split('.');
    if (!body || !signature) return null;
    const expected = signTokenInput(`oauth.${body}`);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function oauthReturnScript({ token, returnTo, error }) {
  const safeReturnTo = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/';
  const url = new URL(`http://localhost${safeReturnTo}`);
  if (error) url.searchParams.set('oauth', 'error');
  if (!error && token) url.searchParams.set('oauth', 'login');
  if (!error && !token) url.searchParams.set('oauth', 'linked');
  return `<!doctype html><meta charset="utf-8"><script>
try {
  localStorage.removeItem('zutomayo_token');
  ${token ? `localStorage.setItem('zutomayo_session', '1');` : ''}
  location.replace(${JSON.stringify(`${url.pathname}${url.search}${url.hash}`)});
} catch (e) {
  location.replace(${JSON.stringify(`${url.pathname}${url.search}${url.hash}`)});
}
</script>`;
}

async function exchangeOAuthCode(req, providerConfig, code) {
  const body = new URLSearchParams();
  body.set('client_id', providerConfig.clientId);
  body.set('client_secret', providerConfig.clientSecret);
  body.set('code', code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', oauthRedirectUri(req, providerConfig.provider));

  const response = await fetch(providerConfig.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error('OAuth token exchange failed');
  }
  return data.access_token;
}

async function fetchJsonWithBearer(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'zutomayo-card-online',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('OAuth profile fetch failed');
  return data;
}

async function fetchOAuthProfile(providerConfig, accessToken) {
  const profile = await fetchJsonWithBearer(providerConfig.userInfoUrl, accessToken);
  if (providerConfig.provider === 'logto') {
    return {
      provider: 'logto',
      providerUserId: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified,
      displayName: profile.name || profile.username || profile.email,
      avatarUrl: profile.picture,
    };
  }
  if (providerConfig.provider === 'google') {
    return {
      provider: 'google',
      providerUserId: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified,
      displayName: profile.name,
      avatarUrl: profile.picture,
    };
  }
  if (providerConfig.provider === 'discord') {
    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=160`
      : '';
    return {
      provider: 'discord',
      providerUserId: profile.id,
      email: profile.email,
      emailVerified: profile.verified,
      displayName: profile.global_name || profile.username,
      avatarUrl,
    };
  }

  let email = profile.email || '';
  let emailVerified = Boolean(profile.email);
  if (providerConfig.emailsUrl) {
    const emails = await fetchJsonWithBearer(providerConfig.emailsUrl, accessToken).catch(() => []);
    const primary = Array.isArray(emails) ? emails.find((item) => item.primary) || emails[0] : null;
    email = primary?.email || email;
    emailVerified = Boolean(primary?.verified || emailVerified);
  }
  return {
    provider: 'github',
    providerUserId: profile.id,
    email,
    emailVerified,
    displayName: profile.name || profile.login,
    avatarUrl: profile.avatar_url,
  };
}

async function verifyAuthChallenge(body, clientIp) {
  const token = body && typeof body.verificationToken === 'string' ? body.verificationToken : '';
  if (!TURNSTILE_SECRET_KEY) {
    if (TURNSTILE_REQUIRED) return { ok: false, status: 503, error: 'Verification is not configured' };
    return { ok: true };
  }
  if (!token) {
    if (TURNSTILE_REQUIRED) return { ok: false, status: 400, error: 'Verification token required' };
    return { ok: true };
  }

  const form = new URLSearchParams();
  form.set('secret', TURNSTILE_SECRET_KEY);
  form.set('response', token);
  if (clientIp) form.set('remoteip', clientIp);

  const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) return { ok: false, status: 502, error: 'Verification service unavailable' };

  const result = await response.json().catch(() => ({}));
  if (!result.success) return { ok: false, status: 400, error: 'Verification failed' };
  return { ok: true };
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
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS) || 90 * 1000;

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
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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
  const serviceJson = (result, status = 200) => {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      if (!result.ok) return json({ error: result.error || 'Request failed' }, result.status || 400);
      return json(result.body ?? {}, status);
    }
    return json(result, status);
  };

  const readBody = (maxBytes = 3 * 1024 * 1024) =>
    new Promise((resolve) => {
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > maxBytes) {
          tooLarge = true;
          resolve({});
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
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

    if ((pathname === '/api/app-version' || pathname === '/api/version') && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      json(APP_VERSION_INFO);
      return;
    }

    if (pathname === '/api/oauth/providers' && method === 'GET') {
      json({
        authMode: AUTH_MODE,
        localAuthEnabled: LOCAL_AUTH_ENABLED,
        accountLinkingEnabled: ACCOUNT_LINKING_ENABLED,
        accountCenterUrl: AUTH_MODE === 'logto' ? LOGTO_ACCOUNT_CENTER_URL : '',
        providers: visibleOAuthProviderEntries().map(([provider, config]) => ({
          provider,
          label: config.label,
          enabled: Boolean(config.clientId && config.clientSecret && (config.authUrl || config.discoveryUrl)),
        })),
      });
      return;
    }

    const oauthStartRoute = pathname.match(/^\/api\/oauth\/([^/]+)\/start$/);
    if (oauthStartRoute && method === 'GET') {
      const provider = decodeURIComponent(oauthStartRoute[1]);
      if (!isOAuthProviderAllowed(provider)) return json({ error: 'Unknown OAuth provider' }, 404);
      const providerConfig = await getResolvedOAuthProvider(provider);
      if (!providerConfig) return json({ error: 'Unknown OAuth provider' }, 404);
      if (!providerConfig.enabled) return json({ error: 'OAuth provider is not configured' }, 503);

      const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
      if (mode === 'link' && !ACCOUNT_LINKING_ENABLED)
        return json({ error: 'Account linking is managed by Logto' }, 403);
      const userId = getAuthUserId(req);
      if (mode === 'link' && !userId) return json({ error: 'Unauthorized' }, 401);
      const returnTo = url.searchParams.get('returnTo') || (mode === 'link' ? '/profile' : '/');
      const now = Math.floor(Date.now() / 1000);
      const state = signOAuthState({
        mode,
        provider: providerConfig.provider,
        userId: mode === 'link' ? userId : undefined,
        returnTo: returnTo.startsWith('/') ? returnTo : '/',
        nonce: crypto.randomBytes(12).toString('hex'),
        iat: now,
        exp: now + 10 * 60,
      });

      const authUrl = new URL(providerConfig.authUrl);
      authUrl.searchParams.set('client_id', providerConfig.clientId);
      authUrl.searchParams.set('redirect_uri', oauthRedirectUri(req, providerConfig.provider));
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', providerConfig.scope);
      authUrl.searchParams.set('state', state);
      if (providerConfig.provider === 'google') authUrl.searchParams.set('prompt', 'select_account');
      if (providerConfig.provider === 'logto' && mode === 'login') authUrl.searchParams.set('prompt', 'login');

      res.writeHead(302, { Location: authUrl.toString() });
      res.end();
      return;
    }

    const oauthCallbackRoute = pathname.match(/^\/api\/oauth\/([^/]+)\/callback$/);
    if (oauthCallbackRoute && method === 'GET') {
      const provider = decodeURIComponent(oauthCallbackRoute[1]);
      if (!isOAuthProviderAllowed(provider)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(oauthReturnScript({ returnTo: '/', error: 'Unknown OAuth provider' }));
        return;
      }
      const providerConfig = await getResolvedOAuthProvider(provider);
      const state = verifyOAuthState(url.searchParams.get('state'));
      if (!providerConfig || !state || state.provider !== providerConfig.provider) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(oauthReturnScript({ returnTo: state?.returnTo || '/', error: 'Invalid OAuth state' }));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(oauthReturnScript({ returnTo: state.returnTo, error: 'Missing OAuth code' }));
        return;
      }

      const accessToken = await exchangeOAuthCode(req, providerConfig, code);
      const oauthProfile = await fetchOAuthProfile(providerConfig, accessToken);
      if (state.mode === 'link') {
        if (!ACCOUNT_LINKING_ENABLED) {
          res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(oauthReturnScript({ returnTo: state.returnTo, error: 'Account linking is managed by Logto' }));
          return;
        }
        const result = await linkOAuthIdentity({ pool, userId: state.userId, profile: oauthProfile });
        res.writeHead(result.ok ? 200 : result.status || 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(oauthReturnScript({ returnTo: state.returnTo, error: result.ok ? '' : result.error }));
        return;
      }

      const result = await loginWithOAuthIdentity({
        pool,
        profile: oauthProfile,
        sanitizeText,
        createToken,
        generateUserId: () => 'u_' + crypto.randomBytes(8).toString('hex'),
        generateDisabledPasswordHash: () => 'oauth:' + crypto.randomBytes(24).toString('hex'),
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
        hashEmail: hashEmailForAvatar,
        country: getClientCountry(req),
      });
      if (result.ok) setAuthCookie(req, res, result.body.token);
      res.writeHead(result.ok ? 200 : result.status || 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        oauthReturnScript({
          token: result.ok ? result.body.token : '',
          returnTo: state.returnTo,
          error: result.ok ? '' : result.error,
        }),
      );
      return;
    }

    // ===== Auth Routes =====

    // Register
    if (pathname === '/api/register' && method === 'POST') {
      if (!LOCAL_AUTH_ENABLED) return json({ error: 'Local auth is disabled' }, 403);
      const body = await readBody();
      const challenge = await verifyAuthChallenge(body, clientIp);
      if (!challenge.ok) return json({ error: challenge.error }, challenge.status);
      const result = await registerAccount({
        pool,
        body,
        sanitizeText,
        hashPassword,
        createToken,
        generateUserId: () => 'u_' + crypto.randomBytes(8).toString('hex'),
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      setAuthCookie(req, res, result.body.token);
      json(result.body);
      return;
    }

    // Login
    if (pathname === '/api/login' && method === 'POST') {
      if (!LOCAL_AUTH_ENABLED) return json({ error: 'Local auth is disabled' }, 403);
      const body = await readBody();
      const challenge = await verifyAuthChallenge(body, clientIp);
      if (!challenge.ok) return json({ error: challenge.error }, challenge.status);
      const result = await loginAccount({
        pool,
        body,
        hashPassword,
        createToken,
        currentIterations: PBKDF2_ITERATIONS,
        legacyIterations: PBKDF2_LEGACY_ITERATIONS,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      setAuthCookie(req, res, result.body.token);
      json(result.body);
      return;
    }

    if (pathname === '/api/logout' && method === 'POST') {
      clearAuthCookie(req, res);
      json({ ok: true });
      return;
    }

    // Get profile
    if (pathname === '/api/profile' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await getAccountProfile(pool, userId, {
        country: getClientCountry(req),
        hashEmail: hashEmailForAvatar,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/profile/identities' && method === 'GET') {
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listAccountIdentities(pool, userId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const profileIdentityRoute = pathname.match(/^\/api\/profile\/identities\/([^/]+)$/);
    if (profileIdentityRoute && method === 'DELETE') {
      if (!ACCOUNT_LINKING_ENABLED) return json({ error: 'Account linking is managed by Logto' }, 403);
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const provider = decodeURIComponent(profileIdentityRoute[1]);
      const result = await unlinkOAuthIdentity({ pool, userId, provider });
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

    // GET /api/presence — 目前在線人數（最近有 heartbeat 的瀏覽器客戶端）
    if (pathname === '/api/presence' && method === 'GET') {
      json(await countOnlinePresence(redis, { ttlMs: PRESENCE_TTL_MS }));
      return;
    }

    // POST /api/presence/heartbeat — 刷新目前客戶端在線狀態
    if (pathname === '/api/presence/heartbeat' && method === 'POST') {
      const { visitorId } = await readBody(32 * 1024);
      const result = await heartbeatOnlinePresence(redis, { visitorId, ttlMs: PRESENCE_TTL_MS });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
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
      const result = await updateAccountProfile({
        pool,
        userId,
        body: await readBody(),
        sanitizeText,
        country: getClientCountry(req),
        hashEmail: hashEmailForAvatar,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // PUT /api/profile/password — 修改密碼。
    if (pathname === '/api/profile/password' && method === 'PUT') {
      if (!LOCAL_AUTH_ENABLED) return json({ error: 'Password is managed by Logto' }, 403);
      const userId = getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await updateAccountPassword({
        pool,
        userId,
        body: await readBody(),
        hashPassword,
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
        currentIterations: PBKDF2_ITERATIONS,
        legacyIterations: PBKDF2_LEGACY_ITERATIONS,
      });
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

    // Public: list card definitions from PostgreSQL.
    if (pathname === '/api/cards' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      json(await getPublicCards(pool, url.searchParams));
      return;
    }

    // 批次 i18n 端點：回傳所有卡牌的所有語言翻譯。
    if (pathname === '/api/cards/i18n' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      json(await getAllCardI18n(pool));
      return;
    }

    const publicCardI18nRoute = pathname.match(/^\/api\/cards\/([^/]+)\/i18n$/);
    if (publicCardI18nRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardI18nRoute[1]);
      res.setHeader('Cache-Control', 'no-store');
      json(await getCardI18n(pool, cardId));
      return;
    }

    const publicCardRoute = pathname.match(/^\/api\/cards\/([^/]+)$/);
    if (publicCardRoute && method === 'GET') {
      const cardId = decodeURIComponent(publicCardRoute[1]);
      const result = await getPublicCard(pool, cardId);
      if (!result.ok) return json({ error: result.error }, result.status);
      res.setHeader('Cache-Control', 'no-store');
      json(result.body);
      return;
    }

    if (pathname === '/api/config' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      json(await getGameConfig(pool));
      return;
    }

    if (pathname === '/api/preset-decks' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
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
      const result = await upsertCard(pool, cardId, await readBody());
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

    // ===== Feedback Routes（反饋功能，參考 Fider）=====
    // 投票者身份：登入用戶優先，否則用匿名 ID（前端 localStorage 產生）。
    function extractFeedbackVoter(req, body) {
      const userId = getAuthUserId(req);
      if (userId) return { userId };
      const raw = body && body.anonymousId !== undefined ? body.anonymousId : url.searchParams.get('anonymousId');
      if (typeof raw === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw)) return { anonymousId: raw };
      return {};
    }
    const generateFeedbackId = (prefix) => prefix + crypto.randomBytes(8).toString('hex');

    // GET /api/feedback/posts — 列出反饋
    if (pathname === '/api/feedback/posts' && method === 'GET') {
      const voter = extractFeedbackVoter(req, {});
      serviceJson(
        await listFeedbackPosts({
          pool,
          voter,
          status: url.searchParams.get('status'),
          tag: url.searchParams.get('tag'),
          sort: url.searchParams.get('sort'),
          q: url.searchParams.get('q'),
          limit: url.searchParams.get('limit'),
          offset: url.searchParams.get('offset'),
        }),
      );
      return;
    }

    // GET /api/feedback/stats — 統計資料
    if (pathname === '/api/feedback/stats' && method === 'GET') {
      serviceJson(await getFeedbackStats({ pool }));
      return;
    }

    // GET /api/feedback/posts/:id — 取得單一文章含留言
    const feedbackPostRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)$/);
    if (feedbackPostRoute && method === 'GET') {
      const postId = decodeURIComponent(feedbackPostRoute[1]);
      const voter = extractFeedbackVoter(req, {});
      serviceJson(await getFeedbackPost({ pool, voter, postId }));
      return;
    }

    // POST /api/feedback/posts — 建立反饋（匿名或登入）
    if (pathname === '/api/feedback/posts' && method === 'POST') {
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(
        await createFeedbackPost({
          pool,
          voter,
          body,
          sanitizeText,
          generateId: () => generateFeedbackId('fb_'),
        }),
      );
      return;
    }

    // POST /api/feedback/posts/:id/votes — 切換投票
    const feedbackVoteRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)\/votes$/);
    if (feedbackVoteRoute && method === 'POST') {
      const postId = decodeURIComponent(feedbackVoteRoute[1]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackVote({ pool, voter, postId }));
      return;
    }

    // POST /api/feedback/posts/:id/comments — 新增留言
    const feedbackCommentRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)\/comments$/);
    if (feedbackCommentRoute && method === 'POST') {
      const postId = decodeURIComponent(feedbackCommentRoute[1]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(
        await addFeedbackComment({
          pool,
          voter,
          postId,
          body,
          sanitizeText,
          generateId: () => generateFeedbackId('fc_'),
          isOfficial: Boolean(body.isOfficial) && verifyAdminToken(req),
        }),
      );
      return;
    }

    // GET /api/feedback/posts/:id/voters — 投票者列表
    const feedbackVotersRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)\/voters$/);
    if (feedbackVotersRoute && method === 'GET') {
      const postId = decodeURIComponent(feedbackVotersRoute[1]);
      serviceJson(await listFeedbackVoters({ pool, postId }));
      return;
    }

    // POST /api/feedback/comments/:id/votes — 留言按讚 toggle
    const commentVoteRoute = pathname.match(/^\/api\/feedback\/comments\/([^/]+)\/votes$/);
    if (commentVoteRoute && method === 'POST') {
      const commentId = decodeURIComponent(commentVoteRoute[1]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackCommentVote({ pool, voter, commentId }));
      return;
    }

    // PUT /api/feedback/posts/:id — 編輯文章（作者）
    const feedbackEditPostRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)$/);
    if (feedbackEditPostRoute && method === 'PUT') {
      const postId = decodeURIComponent(feedbackEditPostRoute[1]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(await editFeedbackPost({ pool, voter, postId, body, sanitizeText }));
      return;
    }

    // PUT /api/feedback/comments/:id — 編輯留言（作者）
    const commentEditRoute = pathname.match(/^\/api\/feedback\/comments\/([^/]+)$/);
    if (commentEditRoute && method === 'PUT') {
      const commentId = decodeURIComponent(commentEditRoute[1]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(await editFeedbackComment({ pool, voter, commentId, body, sanitizeText }));
      return;
    }

    // DELETE /api/feedback/comments/:id — 刪除留言（作者或管理員）
    if (commentEditRoute && method === 'DELETE') {
      const commentId = decodeURIComponent(commentEditRoute[1]);
      const isAdmin = verifyAdminToken(req);
      const voter = extractFeedbackVoter(req, {});
      serviceJson(await deleteFeedbackComment({ pool, voter, commentId, isAdmin }));
      return;
    }

    // GET /api/feedback/tags — 列出標籤
    if (pathname === '/api/feedback/tags' && method === 'GET') {
      serviceJson(await listFeedbackTags({ pool }));
      return;
    }

    // ===== Feedback Admin Routes（管理員審核）=====
    // PUT /api/feedback/admin/posts/:id/status — 變更狀態
    const feedbackStatusRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)\/status$/);
    if (feedbackStatusRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackStatusRoute[1]);
      const { status } = await readBody();
      serviceJson(await updateFeedbackPostStatus({ pool, postId, status }));
      return;
    }

    // PUT /api/feedback/admin/posts/:id/tag — 變更標籤
    const feedbackTagRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)\/tag$/);
    if (feedbackTagRoute && method === 'PUT') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackTagRoute[1]);
      const { tag } = await readBody();
      serviceJson(await updateFeedbackPostTag({ pool, postId, tag, sanitizeText }));
      return;
    }

    // DELETE /api/feedback/admin/posts/:id — 刪除文章（審核）
    const feedbackDeleteRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)$/);
    if (feedbackDeleteRoute && method === 'DELETE') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackDeleteRoute[1]);
      serviceJson(await deleteFeedbackPost({ pool, postId }));
      return;
    }

    // POST /api/feedback/admin/tags — 建立標籤
    if (pathname === '/api/feedback/admin/tags' && method === 'POST') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody();
      serviceJson(
        await createFeedbackTag({
          pool,
          body,
          sanitizeText,
          generateId: () => generateFeedbackId('ft_'),
        }),
      );
      return;
    }

    // DELETE /api/feedback/admin/tags/:id — 刪除標籤
    const feedbackTagDeleteRoute = pathname.match(/^\/api\/feedback\/admin\/tags\/([^/]+)$/);
    if (feedbackTagDeleteRoute && method === 'DELETE') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const tagId = decodeURIComponent(feedbackTagDeleteRoute[1]);
      serviceJson(await deleteFeedbackTag({ pool, tagId }));
      return;
    }

    // GET /api/feedback/similar — 相似文章查詢（建立時提示重複）
    if (pathname === '/api/feedback/similar' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const limit = url.searchParams.get('limit') || '5';
      serviceJson(await findFeedbackSimilarPosts({ pool, q, limit }));
      return;
    }

    // POST /api/feedback/comments/:id/reactions/:emoji — 切換留言 emoji 反應
    const commentReactionRoute = pathname.match(/^\/api\/feedback\/comments\/([^/]+)\/reactions\/([^/]+)$/);
    if (commentReactionRoute && (method === 'POST' || method === 'DELETE')) {
      const commentId = decodeURIComponent(commentReactionRoute[1]);
      const emoji = decodeURIComponent(commentReactionRoute[2]);
      const body = await readBody();
      const voter = extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackCommentReaction({ pool, voter, commentId, emoji }));
      return;
    }

    // POST /api/feedback/admin/posts/:id/duplicate — 標記為重複文章
    const feedbackDuplicateRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)\/duplicate$/);
    if (feedbackDuplicateRoute && method === 'POST') {
      if (!verifyAdminToken(req)) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackDuplicateRoute[1]);
      const body = await readBody();
      serviceJson(await markFeedbackAsDuplicate({ pool, postId, originalPostId: body.originalPostId }));
      return;
    }

    // POST /api/feedback/uploads — 圖片上傳（base64，限制 3MB body）
    if (pathname === '/api/feedback/uploads' && method === 'POST') {
      const body = await readBody(3 * 1024 * 1024);
      const voter = extractFeedbackVoter(req, body);
      if (!voter.userId && !voter.anonymousId) return json({ error: 'Identity is required' }, 400);
      // 解析 data URL: data:image/png;base64,xxxx
      const dataUrl = body.image || '';
      const match = dataUrl.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,(.+)$/);
      if (!match) return json({ error: 'Invalid image format' }, 400);
      // 先檢查 base64 字串長度（避免 OOM），base64 長度 × 3/4 ≈ 解碼後大小
      const base64Data = match[3];
      if (base64Data.length * 0.75 > 2 * 1024 * 1024) {
        return json({ error: 'Image too large (max 2MB)' }, 400);
      }
      const contentType = match[1];
      const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
      const buffer = Buffer.from(base64Data, 'base64');
      // 二次驗證實際大小
      if (buffer.length > 2 * 1024 * 1024) {
        return json({ error: 'Image too large (max 2MB)' }, 400);
      }
      const bkey = generateFeedbackId('fa_') + '.' + ext;
      const uploadDir = process.env.FEEDBACK_UPLOAD_DIR || '/tmp/feedback-uploads';
      try {
        require('fs').mkdirSync(uploadDir, { recursive: true });
      } catch (e) {
        /* exists */
      }
      require('fs').writeFileSync(uploadDir + '/' + bkey, buffer);
      // 記錄到 DB（post_id/comment_id 可選，後續綁定）
      await pool.query(
        'INSERT INTO feedback_attachments (id, post_id, comment_id, file_name, content_type, file_size) VALUES ($1, $2, $3, $4, $5, $6)',
        [bkey, body.postId || null, body.commentId || null, body.fileName || bkey, contentType, buffer.length],
      );
      return json({ bkey, url: '/api/feedback/images/' + bkey }, 200);
    }

    // GET /api/feedback/images/:bkey — 圖片服務（嚴格驗證 bkey 防路徑穿越）
    const feedbackImageRoute = pathname.match(/^\/api\/feedback\/images\/([^/]+)$/);
    if (feedbackImageRoute && method === 'GET') {
      const bkey = decodeURIComponent(feedbackImageRoute[1]);
      // 嚴格白名單：只允許 fa_<hex>.<ext> 格式，阻擋路徑穿越
      if (!/^fa_[a-f0-9]{16}\.(png|jpg|gif|webp)$/.test(bkey)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid image key' }));
        return;
      }
      const uploadDir = process.env.FEEDBACK_UPLOAD_DIR || '/tmp/feedback-uploads';
      const path = require('path');
      const resolvedPath = path.resolve(uploadDir, bkey);
      const resolvedDir = path.resolve(uploadDir);
      if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid image key' }));
        return;
      }
      try {
        const buffer = require('fs').readFileSync(resolvedPath);
        const ext = bkey.split('.').pop().toLowerCase();
        const ct =
          ext === 'jpg'
            ? 'image/jpeg'
            : ext === 'png'
              ? 'image/png'
              : ext === 'gif'
                ? 'image/gif'
                : ext === 'webp'
                  ? 'image/webp'
                  : 'image/png';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
        res.end(buffer);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Image not found' }));
      }
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
  validateSecurityConfig();
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
