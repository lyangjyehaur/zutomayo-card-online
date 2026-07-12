// OpenTelemetry tracing 必須在所有其他 require 之前載入，讓 auto-instrumentation 能正確 patch 模組。
require('./tracing.cjs');
const http = require('http');
const https = require('https');
const net = require('net');
const Sentry = require('@sentry/node');
const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const Redis = require('ioredis');
const {
  getAccountProfile,
  getAccountSecurityCapabilities,
  linkOAuthIdentity,
  listAccountIdentities,
  loginAccount,
  loginWithOAuthIdentity,
  registerAccount,
  updateAccountPassword,
  updateAccountProfile,
  unlinkOAuthIdentity,
} = require('./accountService.cjs');
const {
  deleteAccount,
  exportAccountData,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyRecentPassword,
  verifyEmailToken,
} = require('./accountLifecycleService.cjs');
const { deliverAccountAction } = require('./accountNotificationService.cjs');
const { consumeAccountStepUp, issueAccountStepUp } = require('./accountStepUpService.cjs');
const { LOGTO_ACCOUNT_DELETION_SCOPE, validateLogtoAccountDeletionConfig } = require('./accountDeletionConfig.cjs');
const {
  listRecoverableAccountDeletions,
  markProviderDeleted,
  markProviderDeletionFailure,
  markProviderDeletionStarted,
  prepareLogtoAccountDeletion,
} = require('./accountDeletionService.cjs');
const { upsertCard, upsertCardI18n, upsertGameConfig } = require('./adminCardService.cjs');
const { listAdminUsers, resetUserElo } = require('./adminService.cjs');
const { authenticateAdmin, revokeAdminSession, verifyAdminSession } = require('./adminAuthService.cjs');
const { assertRuntimeSchema } = require('./schemaGate.cjs');
const { fetchWithResilience } = require('./oauthHttp.cjs');
const {
  createRelationshipOutboxWorker,
  RelationshipOutboxPermanentError,
  relationshipOutboxConfig,
  relationshipOutboxStats,
} = require('./relationshipOutbox.cjs');
const {
  postgresConnectionString,
  postgresSslConfig,
  resolveOAuthPublicBaseUrl,
  resolveRedisConnectionConfig,
  validateProductionRuntimeSecurity,
} = require('./runtimeSecurityConfig.cjs');
const { metricsRequestAuthorized } = require('./metricsAuth.cjs');
const { decryptAdminTotpSecret } = require('./adminSecretCrypto.cjs');
const {
  logger,
  attachRequestObservability,
  metricsResponse,
  rateLimitedTotal,
  refreshMatchmakingQueueDepth,
  relationshipOutboxDeadLetter,
  relationshipOutboxOldestAgeSeconds,
  relationshipOutboxPending,
  relationshipOutboxProcessedTotal,
  relationshipOutboxMetricsLastSuccess,
  relationshipOutboxMetricsRefreshSuccess,
} = require('./observability.cjs');
const { validateBody } = require('./validate.cjs');
const S = require('./schemas.cjs');
const { buildSignedImgproxyUrl, parseAllowedSources } = require('./imgproxySigner.cjs');
const {
  getAllCardI18n,
  getCardI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
} = require('./cardDataService.cjs');
const {
  createChatUserSanction,
  defaultChatModerationRules,
  listChatEvidenceMessages,
  listChatMessages,
  listChatReports,
  listUnreadChat,
  markConversationRead,
  reportChatMessage,
  requestChatTranslation,
  reviewChatMessageModeration,
  reviewChatReport,
  revokeChatUserSanction,
  sendChatMessage,
} = require('./chatService.cjs');
const { createUserDeck, deleteUserDeck, listUserDecks, reserveUserDeck, updateUserDeck } = require('./deckService.cjs');
const {
  applyMatchmakingBlock,
  getMatchmakingStatus,
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  listMatchmakingBlockedUserIds,
  removeMatchmakingBlock,
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
const { listFriends, removeFriend } = require('./friendService.cjs');
const {
  blockUser,
  createFriendRequest,
  listBlocks,
  listFriendRequests,
  respondToFriendRequest,
  unblockUser,
} = require('./socialSafetyService.cjs');
const {
  activateSeason,
  claimSeasonReward,
  closeSeason,
  createSeason,
  getCurrentSeason,
  getUserSeasonRewards,
  getUserSeasonRating,
  listSeasons,
  listSeasonLeaderboard,
} = require('./seasonService.cjs');
const { createLegalHold, listLegalHolds, releaseLegalHold } = require('./legalHoldService.cjs');
const { createChatTranslationProviderFromEnv } = require('./chatTranslationProvider.cjs');

const pbkdf2 = util.promisify(crypto.pbkdf2);
const translateChatMessage = createChatTranslationProviderFromEnv(process.env);

function readPackageVersion() {
  for (const packagePath of ['../package.json', './package.json']) {
    try {
      const packageJson = require(packagePath);
      if (typeof packageJson.version === 'string' && packageJson.version.trim()) return packageJson.version.trim();
    } catch {
      // Try the next package path. The API Docker image only contains ./package.json.
    }
  }
  throw new Error('package.json version is required');
}

// ===== Config =====
const PORT = Number(process.env.API_PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
// B4：OAuth token 加密金鑰獨立於 JWT_SECRET，避免金鑰輪換時 OAuth token 失效。
const OAUTH_TOKEN_ENCRYPTION_KEY = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || '';
const ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY || '';
const ADMIN_SESSION_TTL_SECONDS = Number(process.env.ADMIN_SESSION_TTL_SECONDS) || 60 * 60;
const PACKAGE_VERSION = readPackageVersion();
const APP_VERSION = process.env.APP_VERSION || PACKAGE_VERSION;
const APP_BUILD_ID = process.env.APP_BUILD_ID || APP_VERSION;
const GAME_RULES_VERSION = process.env.GAME_RULES_VERSION || APP_VERSION;
// Ranked writes are fail-closed. Production must explicitly opt in after the
// seat-identity trust chain has been verified.
const RANKED_MATCHES_ENABLED = process.env.RANKED_MATCHES_ENABLED === 'true';
const IMGPROXY_INTERNAL_BASE_URL = process.env.IMGPROXY_INTERNAL_BASE_URL || process.env.IMGPROXY_BASE_URL || '';
const IMGPROXY_KEY = process.env.IMGPROXY_KEY || '';
const IMGPROXY_SALT = process.env.IMGPROXY_SALT || '';
const IMGPROXY_ALLOWED_SOURCES = parseAllowedSources(process.env.IMGPROXY_ALLOWED_SOURCES);
const IMGPROXY_CACHE_CONTROL = process.env.IMGPROXY_CACHE_CONTROL || 'public, max-age=31536000, immutable';
const APP_VERSION_INFO = Object.freeze({
  appVersion: APP_VERSION,
  buildId: APP_BUILD_ID,
  rulesVersion: GAME_RULES_VERSION,
});

const METRICS_TOKEN = process.env.METRICS_TOKEN || '';
function checkMetricsAuth(req, { token = METRICS_TOKEN, nodeEnv = process.env.NODE_ENV } = {}) {
  return metricsRequestAuthorized(req.headers.authorization, { token, nodeEnv });
}
const AUTH_COOKIE_NAME = 'zutomayo_session';
const OAUTH_STATE_COOKIE_PREFIX = 'zutomayo_oauth_state_';
const OAUTH_PKCE_COOKIE_PREFIX = 'zutomayo_oauth_pkce_';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_SESSION_TICKET_TTL_SECONDS = 2 * 60;
const OAUTH_HTTP_TIMEOUT_MS = Math.min(15_000, Math.max(1_000, Number(process.env.OAUTH_HTTP_TIMEOUT_MS) || 8_000));
const OAUTH_REDIS_TIMEOUT_MS = Math.min(5_000, Math.max(250, Number(process.env.OAUTH_REDIS_TIMEOUT_MS) || 1_500));
const OAUTH_HTTP_MAX_ATTEMPTS = Math.min(3, Math.max(1, Number(process.env.OAUTH_HTTP_MAX_ATTEMPTS) || 2));
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 3600;
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 7 * 24 * 60 * 60;
const SESSION_REVOCATION_TTL_SECONDS = Math.max(ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS);
const AUTH_COOKIE_MAX_AGE_SECONDS = ACCESS_TOKEN_TTL_SECONDS;
const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || '';
const AUTH_COOKIE_SAMESITE = ['Strict', 'Lax', 'None'].includes(process.env.AUTH_COOKIE_SAMESITE)
  ? process.env.AUTH_COOKIE_SAMESITE
  : 'Lax';
const REFRESH_COOKIE_NAME = 'zutomayo_refresh';
const REFRESH_COOKIE_PATH = '/api';
const CSRF_COOKIE_NAME = 'zutomayo_csrf';
const CSRF_EXEMPT_PATHS = new Set([
  '/api/login',
  '/api/register',
  '/api/auth/email-verification/confirm',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
  '/api/admin/login',
  '/api/oauth/session',
  '/api/presence/heartbeat',
  '/api/auth/refresh',
  '/api/logout',
]);
const AUTH_MODE = process.env.AUTH_MODE || (process.env.LOGTO_ONLY_AUTH === 'true' ? 'logto' : 'hybrid');
const LOCAL_AUTH_ENABLED = AUTH_MODE !== 'logto';
const ACCOUNT_LINKING_ENABLED = AUTH_MODE !== 'logto';
const ACCOUNT_STEP_UP_PURPOSE_PASSWORD = 'password-change';
const ACCOUNT_STEP_UP_PURPOSE_DELETE = 'account-delete';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_REQUIRED = process.env.TURNSTILE_REQUIRED === 'true';
const TURNSTILE_SITEVERIFY_URL =
  process.env.TURNSTILE_SITEVERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const OAUTH_PUBLIC_BASE_URL = resolveOAuthPublicBaseUrl(process.env);
const LOGTO_ISSUER = (process.env.LOGTO_ISSUER || '').replace(/\/$/, '');
const LOGTO_ENDPOINT = (process.env.LOGTO_ENDPOINT || '').replace(/\/$/, '');
const LOGTO_DISCOVERY_URL =
  process.env.LOGTO_DISCOVERY_URL ||
  (LOGTO_ISSUER
    ? `${LOGTO_ISSUER}/.well-known/openid-configuration`
    : LOGTO_ENDPOINT
      ? `${LOGTO_ENDPOINT}/oidc/.well-known/openid-configuration`
      : '');
const LOGTO_ACCOUNT_CENTER_URL =
  process.env.LOGTO_ACCOUNT_CENTER_URL ||
  (LOGTO_ENDPOINT
    ? `${LOGTO_ENDPOINT}/account/security`
    : LOGTO_ISSUER
      ? `${LOGTO_ISSUER.replace(/\/oidc$/, '')}/account/security`
      : '');
const LOGTO_M2M_APP_ID = process.env.LOGTO_M2M_APP_ID || '';
const LOGTO_M2M_APP_SECRET = process.env.LOGTO_M2M_APP_SECRET || '';
const LOGTO_MANAGEMENT_RESOURCE = process.env.LOGTO_MANAGEMENT_RESOURCE || '';
const LOGTO_MANAGEMENT_SCOPE = process.env.LOGTO_MANAGEMENT_SCOPE || '';
const ACCOUNT_DELETION_RECOVERY_INTERVAL_MS = Math.max(
  10_000,
  Math.min(Number(process.env.ACCOUNT_DELETION_RECOVERY_INTERVAL_MS) || 60_000, 60 * 60 * 1000),
);

// GlitchTip/Sentry error tracking — no-op when SENTRY_DSN is unset.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // 支援 staging/preview 等環境：若顯式設定 SENTRY_ENVIRONMENT 則優先使用。
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: `${APP_VERSION}@${APP_BUILD_ID}`,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    // GlitchTip 不支援 session replay；@sentry/node 10.x 不再支援 autoSessionTracking 選項。
    normalizeDepth: 5,
    sendDefaultPii: false,
    beforeSend(event) {
      // 移除 request 中的敏感 header / cookie / body，避免 token / 密碼外洩。
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
    initialScope: {
      tags: {
        service: 'api',
        app: 'zutomayo-card',
      },
    },
  });
}

// 安全性驗證：JWT_SECRET 必須在生產環境設定
function validateSecurityConfig() {
  if (!JWT_SECRET) {
    logger.fatal('JWT_SECRET environment variable is required');
    logger.fatal('Generate secrets with: openssl rand -hex 32');
    process.exit(1);
  }
  try {
    validateProductionRuntimeSecurity(process.env);
  } catch (error) {
    logger.fatal(error instanceof Error ? error.message : String(error));
    logger.fatal('Generate secrets with: openssl rand -hex 32');
    process.exit(1);
  }
  if (process.env.NODE_ENV !== 'production' && Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
    logger.warn('JWT_SECRET should be at least 32 bytes for security');
  }
  if (process.env.NODE_ENV === 'production' && ADMIN_TOTP_ENCRYPTION_KEY.length < 32) {
    logger.fatal('ADMIN_TOTP_ENCRYPTION_KEY must be at least 32 characters in production');
    process.exit(1);
  }
  if (process.env.ADMIN_PASSWORD) {
    logger.warn(
      'ADMIN_PASSWORD is deprecated and ignored; create an individual admin account with scripts/create-admin.cjs',
    );
  }
  if (OAUTH_TOKEN_ENCRYPTION_KEY && OAUTH_TOKEN_ENCRYPTION_KEY.length < 32) {
    logger.warn('OAUTH_TOKEN_ENCRYPTION_KEY should be at least 32 characters; falling back to JWT_SECRET-derived key');
  }
  try {
    validateLogtoAccountDeletionConfig(process.env);
  } catch (error) {
    logger.fatal(error instanceof Error ? error.message : String(error));
    process.exit(1);
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
const REDIS_CONNECTION = resolveRedisConnectionConfig(process.env);
const REDIS_URL = REDIS_CONNECTION.url;
const REDIS_TLS = REDIS_CONNECTION.tls ? { rejectUnauthorized: true } : undefined;
const REDIS_DB = Number(process.env.REDIS_DB) || 0;

// ===== Database (PG + Redis) =====
const DATABASE_CONNECTION_URL = postgresConnectionString(process.env);
const pool = new Pool({
  ...(DATABASE_CONNECTION_URL
    ? { connectionString: DATABASE_CONNECTION_URL }
    : {
        host: PG_HOST,
        port: PG_PORT,
        user: PG_USER,
        password: PG_PASSWORD,
        database: PG_DATABASE,
      }),
  max: Number(process.env.PG_POOL_MAX) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: postgresSslConfig(process.env),
});

const redis = new Redis(REDIS_URL, {
  db: REDIS_DB,
  maxRetriesPerRequest: 1,
  commandTimeout: Math.min(5_000, Math.max(250, Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 1_500)),
  enableOfflineQueue: false,
  enableReadyCheck: true,
  ...(REDIS_TLS ? { tls: REDIS_TLS } : {}),
});
// 連線層錯誤（如 Redis 暫時斷線）不應變成 unhandled error event；
// query 層錯誤仍會 reject promise 由各 handler 的 safe() 接住。
redis.on('error', () => {});

const relationshipOutboxWorker = createRelationshipOutboxWorker({
  pool,
  redis,
  intervalMs: Number(process.env.RELATIONSHIP_OUTBOX_INTERVAL_MS) || 500,
  config: relationshipOutboxConfig(process.env),
  projectEvent: async (event) => {
    if (event.kind === 'account_deleted') {
      await leaveMatchmakingQueue(redis, event.userIds[0]);
      await redis.del(`mm:blocked:${event.userIds[0]}`);
      return;
    }
    if (event.kind !== 'block_created' && event.kind !== 'block_removed') return;
    const actorUserId = event.actorUserId;
    if (!actorUserId) {
      throw new RelationshipOutboxPermanentError(`Relationship outbox ${event.kind} event is missing actorUserId`);
    }
    const targetUserId = event.userIds.find((userId) => userId !== actorUserId);
    if (!targetUserId) {
      throw new RelationshipOutboxPermanentError(`Relationship outbox ${event.kind} event is missing targetUserId`);
    }
    if (event.kind === 'block_created') await applyMatchmakingBlock(redis, actorUserId, targetUserId);
    else await removeMatchmakingBlock(redis, actorUserId, targetUserId);
  },
  onResult: (result) => relationshipOutboxProcessedTotal.labels(result).inc(),
  onBatch: async () => {
    const stats = await relationshipOutboxStats(pool);
    relationshipOutboxPending.set(stats.pending);
    relationshipOutboxDeadLetter.set(stats.deadLetter);
    relationshipOutboxOldestAgeSeconds.set(stats.oldestAgeSeconds);
    relationshipOutboxMetricsRefreshSuccess.set(1);
    relationshipOutboxMetricsLastSuccess.set(Date.now() / 1000);
  },
  onError: (error) => {
    relationshipOutboxMetricsRefreshSuccess.set(0);
    logger.error({ err: error }, 'relationship change outbox worker failed');
  },
});

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
    `ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT`,
    `ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS refresh_token_ciphertext TEXT`,
    `ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`,

    `CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      card_ids JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id)`,

    `CREATE TABLE IF NOT EXISTS user_friends (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, friend_user_id),
      CHECK (user_id <> friend_user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_friends_friend
      ON user_friends(friend_user_id)`,

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
      rules_version TEXT NOT NULL DEFAULT 'legacy',
      action_log JSONB,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_matches_player0 ON matches(player0_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC)`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_match_id TEXT`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS rules_version TEXT NOT NULL DEFAULT 'legacy'`,
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_match_id
      ON matches(source_match_id)
      WHERE source_match_id IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS platform_match_participants (
      boardgame_match_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'spectator',
      boardgame_player_id TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      access_verified BOOLEAN NOT NULL DEFAULT FALSE,
      first_joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (boardgame_match_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_platform_match_participants_user
      ON platform_match_participants(user_id, last_seen_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_platform_match_participants_match_role
      ON platform_match_participants(boardgame_match_id, role)`,
    `ALTER TABLE platform_match_participants ADD COLUMN IF NOT EXISTS access_verified BOOLEAN NOT NULL DEFAULT FALSE`,

    `CREATE TABLE IF NOT EXISTS platform_room_participants (
      room_code TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'spectator',
      display_name TEXT NOT NULL DEFAULT '',
      access_verified BOOLEAN NOT NULL DEFAULT FALSE,
      first_joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_code, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_platform_room_participants_user
      ON platform_room_participants(user_id, last_seen_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_platform_room_participants_room_role
      ON platform_room_participants(room_code, role)`,
    `ALTER TABLE platform_room_participants ADD COLUMN IF NOT EXISTS access_verified BOOLEAN NOT NULL DEFAULT FALSE`,

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
      admin_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // 既有資料庫補欄位（CREATE TABLE IF NOT EXISTS 不會對已存在資料表新增欄位）
    `ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS admin_user_id TEXT`,

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

    // ===== 聊天功能 schema：持久化聊天、未讀、舉報、LLM 翻譯與審核事件 =====
    `CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (type, subject_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conversations_type_subject
      ON chat_conversations(type, subject_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at
      ON chat_conversations(updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_display_name TEXT NOT NULL DEFAULT '',
      author_role TEXT NOT NULL DEFAULT 'spectator',
      content TEXT NOT NULL,
      source_language TEXT NOT NULL DEFAULT '',
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      moderation_reason TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
      ON chat_messages(conversation_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_author_created
      ON chat_messages(author_user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS chat_message_translations (
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      target_language TEXT NOT NULL,
      translated_content TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, target_language)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_read_states (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id TEXT,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_read_states_user
      ON chat_read_states(user_id, read_at DESC)`,
    `CREATE TABLE IF NOT EXISTS chat_reports (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reported_message_content TEXT NOT NULL DEFAULT '',
      reported_message_author_user_id TEXT,
      reported_message_author_display_name TEXT NOT NULL DEFAULT '',
      reported_message_author_role TEXT NOT NULL DEFAULT 'spectator',
      reported_message_moderation_status TEXT NOT NULL DEFAULT 'visible',
      reported_message_created_at TIMESTAMPTZ,
      reason TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      reviewer_user_id TEXT,
      resolution_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_reports_status_created
      ON chat_reports(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_reports_message
      ON chat_reports(message_id)`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_content TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_author_user_id TEXT`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_author_display_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_author_role TEXT NOT NULL DEFAULT 'spectator'`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_moderation_status TEXT NOT NULL DEFAULT 'visible'`,
    `ALTER TABLE chat_reports ADD COLUMN IF NOT EXISTS reported_message_created_at TIMESTAMPTZ`,
    `CREATE TABLE IF NOT EXISTS chat_moderation_events (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE CASCADE,
      actor_user_id TEXT,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_moderation_events_message
      ON chat_moderation_events(message_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS chat_user_sanctions (
      id TEXT PRIMARY KEY,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'chat_mute',
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT NOT NULL DEFAULT '',
      source_report_id TEXT REFERENCES chat_reports(id) ON DELETE SET NULL,
      source_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoked_by_user_id TEXT,
      revocation_reason TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_user_sanctions_target_active
      ON chat_user_sanctions(target_user_id, type, status, expires_at DESC)`,
    `CREATE TABLE IF NOT EXISTS relationship_change_outbox (
      event_id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      version SMALLINT NOT NULL DEFAULT 1 CHECK (version = 1),
      kind TEXT NOT NULL CHECK (kind IN (
        'friendship_added', 'friendship_removed', 'block_created', 'block_removed', 'account_deleted'
      )),
      user_ids TEXT[] NOT NULL,
      actor_user_id TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      poison_count INTEGER NOT NULL DEFAULT 0 CHECK (poison_count >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      lock_token TEXT,
      lease_expires_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at TIMESTAMPTZ,
      CHECK (
        (kind = 'account_deleted' AND cardinality(user_ids) = 1)
        OR (kind <> 'account_deleted' AND cardinality(user_ids) = 2)
      ),
      CHECK (actor_user_id IS NULL OR actor_user_id = ANY(user_ids)),
      CHECK (kind NOT IN ('block_created', 'block_removed') OR actor_user_id IS NOT NULL)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_relationship_change_outbox_delivery
      ON relationship_change_outbox(status, next_attempt_at)`,
    `CREATE INDEX IF NOT EXISTS idx_relationship_change_outbox_created
      ON relationship_change_outbox(created_at)`,
  ];

  for (const statement of schemaStatements) {
    await pool.query(statement);
  }
}

// Development and CI may apply migrations at startup. Production never
// executes runtime DDL and must pass the immutable release schema gate above.
async function runMigrations() {
  if (process.env.NODE_ENV === 'production' || process.env.RUNTIME_SCHEMA_DDL === 'false') {
    return assertRuntimeSchema({
      pool,
      expectedMigration: process.env.EXPECTED_SCHEMA_MIGRATION,
      expectedChecksum: process.env.EXPECTED_SCHEMA_CHECKSUM,
    });
  }
  let runner;
  try {
    ({ runner } = require('node-pg-migrate'));
  } catch {
    // Local development images may omit the migration runner.
    return initSchema();
  }

  const { resolve } = require('node:path');
  const { existsSync } = require('node:fs');
  const migrationsDir = resolve(__dirname, '..', 'migrations');
  if (!existsSync(migrationsDir)) {
    // Local development API-only images may omit migration sources.
    return initSchema();
  }

  // node-pg-migrate runner 接受 connection string 或 pg ClientConfig。
  // 專案用 PG_* 分開的環境變數，直接組成 ClientConfig。
  const databaseUrl = process.env.DATABASE_URL || {
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DATABASE,
  };

  await runner({
    databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'schema_migrations',
    schema: 'public',
    count: Infinity,
    log: (msg) => logger.info({ msg }, 'migration'),
  });
}

// 匯出 schemaReady 供測試 await，並讓正式啟動在 migration 失敗時 fail closed。
let schemaInitError = null;
const schemaReady = runMigrations().catch((err) => {
  schemaInitError = err;
  logger.error({ err }, 'schema init failed');
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

function secretEncryptionKey() {
  // B4：優先使用獨立的 OAUTH_TOKEN_ENCRYPTION_KEY（>=32 字元）
  if (OAUTH_TOKEN_ENCRYPTION_KEY.length >= 32) {
    return crypto.createHash('sha256').update(`oauth-encryption:${OAUTH_TOKEN_ENCRYPTION_KEY}`).digest();
  }
  // Fallback：從 JWT_SECRET 衍生（向後相容）
  return crypto.createHash('sha256').update(`zutomayo-secret:${JWT_SECRET}`).digest();
}

function legacySecretEncryptionKey() {
  return crypto.createHash('sha256').update(`zutomayo-secret:${JWT_SECRET}`).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  const raw = String(value || '');
  const parts = raw.split('.');
  if (parts.length !== 3) return '';
  const [ivPart, tagPart, encryptedPart] = parts;
  if (!ivPart || !tagPart || !encryptedPart) return '';
  const decryptWithKey = (key) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8');
  };
  // 先用當前金鑰嘗試
  try {
    return decryptWithKey(secretEncryptionKey());
  } catch {
    // 當前金鑰失敗，fallback 嘗試舊金鑰（JWT_SECRET 衍生）
  }
  try {
    return decryptWithKey(legacySecretEncryptionKey());
  } catch {
    return '';
  }
}

function createToken(userId, sessionIat, authVersion = 1) {
  const now = Math.floor(Date.now() / 1000);
  const effectiveSessionIat = Number.isFinite(sessionIat) ? Number(sessionIat) : now;
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomBytes(12).toString('hex'),
    sessionIat: effectiveSessionIat,
    authVersion: Number.isInteger(authVersion) && authVersion > 0 ? authVersion : 1,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signTokenInput(input)}`;
}

function createRefreshToken(userId, sessionIat, authVersion = 1) {
  const now = Math.floor(Date.now() / 1000);
  const effectiveSessionIat = Number.isFinite(sessionIat) ? Number(sessionIat) : now;
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    typ: 'refresh',
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    jti: crypto.randomBytes(12).toString('hex'),
    sessionIat: effectiveSessionIat,
    authVersion: Number.isInteger(authVersion) && authVersion > 0 ? authVersion : 1,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signTokenInput(input)}`;
}

function decodeJWTPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

function verifiedTokenPayload(token, expectedType) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expectedSignature = signTokenInput(input);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      return null;
    }
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (expectedType === 'refresh' && payload.typ !== 'refresh') return null;
    if (expectedType === 'access' && payload.typ === 'refresh') return null;
    if (typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getCurrentAuthVersion(userId) {
  try {
    const row = (await pool.query('SELECT auth_version, deleted_at FROM users WHERE id = $1', [userId])).rows[0];
    if (!row || row.deleted_at) return null;
    const version = Number(row.auth_version);
    return Number.isInteger(version) && version > 0 ? version : 1;
  } catch (err) {
    logger.error({ err, userId }, 'failed to read durable auth version');
    return null;
  }
}

async function issueRefreshToken(userId, sessionIat, authVersion) {
  const effectiveAuthVersion = Number.isInteger(authVersion) ? authVersion : await getCurrentAuthVersion(userId);
  if (!effectiveAuthVersion) throw new Error('Unable to verify account session');
  const refreshToken = createRefreshToken(userId, sessionIat, effectiveAuthVersion);
  const payload = decodeJWTPayload(refreshToken);
  if (payload && payload.jti) {
    const ttl = Number(payload.exp) - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      try {
        await redis.set(`refresh:${payload.jti}`, String(userId), 'EX', ttl);
      } catch (err) {
        logger.error({ err, userId }, 'failed to persist refresh session');
        throw new Error('Unable to persist refresh session');
      }
    }
  }
  return refreshToken;
}

async function createTokenPair(userId, sessionIat, authVersion) {
  const effectiveSessionIat = Number.isFinite(sessionIat) ? Number(sessionIat) : Math.floor(Date.now() / 1000);
  const effectiveAuthVersion = Number.isInteger(authVersion) ? authVersion : await getCurrentAuthVersion(userId);
  if (!effectiveAuthVersion) throw new Error('Unable to verify account session');
  const accessToken = createToken(userId, effectiveSessionIat, effectiveAuthVersion);
  const refreshToken = await issueRefreshToken(userId, effectiveSessionIat, effectiveAuthVersion);
  return { accessToken, refreshToken };
}

function sessionIatFromToken(token) {
  const payload = decodeJWTPayload(token);
  if (!payload) return undefined;
  return Number.isFinite(payload.sessionIat) ? Number(payload.sessionIat) : Number(payload.iat);
}

function authVersionFromToken(token) {
  const payload = decodeJWTPayload(token);
  if (!payload) return undefined;
  return Number.isInteger(payload.authVersion) && payload.authVersion > 0 ? Number(payload.authVersion) : undefined;
}

async function isTokenBlacklisted(jti) {
  if (!jti) return false;
  try {
    const flagged = await redis.get(`blacklist:${jti}`);
    return flagged === '1';
  } catch (err) {
    // A Redis read failure must not turn a revoked token into a valid one.
    logger.error({ err }, 'failed to read access-token blacklist');
    throw new Error('Unable to verify access-token revocation');
  }
}

async function blacklistToken(token) {
  const payload = verifiedTokenPayload(token, 'access');
  if (!payload) return;
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(payload.exp) - now;
  if (ttl > 0) {
    try {
      await redis.set(`blacklist:${payload.jti}`, '1', 'EX', Math.min(ttl, ACCESS_TOKEN_TTL_SECONDS));
    } catch (err) {
      logger.error({ err }, 'failed to blacklist access token');
      throw new Error('Unable to revoke access token');
    }
  }
}

async function revokeRefreshToken(token) {
  const payload = verifiedTokenPayload(token, 'refresh');
  if (!payload) return;
  try {
    await redis.del(`refresh:${payload.jti}`);
  } catch (err) {
    logger.error({ err }, 'failed to revoke refresh token');
    throw new Error('Unable to revoke refresh token');
  }
}

async function revokeAllUserSessions(userId, { bumpAuthVersion = true } = {}) {
  const revokedBefore = Math.floor(Date.now() / 1000);
  try {
    // Redis is an acceleration/index for revocation, not the authority. A
    // durable auth-version bump keeps already-issued JWTs invalid after a
    // Redis restart or key eviction. Callers that already hold the user row
    // lock and increment auth_version in their transaction can opt out.
    if (bumpAuthVersion) {
      await pool.query(
        `UPDATE users
            SET auth_version = COALESCE(auth_version, 1) + 1
          WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
      );
    }
    await redis.set(`auth:revoked-before:${userId}`, String(revokedBefore), 'EX', SESSION_REVOCATION_TTL_SECONDS);
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length === 0) continue;
      const owners = await redis.mget(keys);
      const ownedKeys = keys.filter((_key, index) => owners[index] === String(userId));
      if (ownedKeys.length > 0) await redis.del(...ownedKeys);
    } while (cursor !== '0');
  } catch (err) {
    logger.error({ err, userId }, 'failed to revoke all user sessions');
    throw new Error('Unable to revoke active sessions');
  }
}

async function revokeRequestAccountSessions(req, userId, { bumpAuthVersion = true } = {}) {
  const authorization = String(req.headers.authorization || '');
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  const cookies = parseCookies(req);
  const cookieToken = cookies[AUTH_COOKIE_NAME] || '';

  if (bearerToken) await blacklistToken(bearerToken);
  if (cookieToken && cookieToken !== bearerToken) await blacklistToken(cookieToken);
  await revokeAllUserSessions(userId, { bumpAuthVersion });
}

async function isUserSessionRevoked(userId, issuedAt) {
  try {
    const value = await redis.get(`auth:revoked-before:${userId}`);
    if (!value) return false;
    const revokedBefore = Number(value);
    return Number.isFinite(revokedBefore) && (!Number.isFinite(issuedAt) || issuedAt <= revokedBefore);
  } catch {
    // Authentication revocation is security-sensitive; fail closed while Redis
    // is unavailable instead of silently accepting an already revoked token.
    return true;
  }
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
  return (
    proto === 'https' ||
    req.socket.encrypted === true ||
    process.env.NODE_ENV === 'production' ||
    getPublicBaseUrl(req).startsWith('https://')
  );
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
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

function serializeRefreshCookie(req, token, maxAge = REFRESH_TOKEN_TTL_SECONDS) {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    `SameSite=${AUTH_COOKIE_SAMESITE}`,
  ];
  if (AUTH_COOKIE_DOMAIN) parts.push(`Domain=${AUTH_COOKIE_DOMAIN}`);
  if (AUTH_COOKIE_SAMESITE === 'None' || isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setAuthCookie(req, res, token) {
  appendSetCookie(res, serializeAuthCookie(req, token));
}

function setRefreshCookie(req, res, token) {
  appendSetCookie(res, serializeRefreshCookie(req, token));
}

function clearAuthCookie(req, res) {
  appendSetCookie(res, serializeAuthCookie(req, '', 0));
}

function clearRefreshCookie(req, res) {
  appendSetCookie(res, serializeRefreshCookie(req, '', 0));
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function serializeCsrfCookie(req, token, maxAge = AUTH_COOKIE_MAX_AGE_SECONDS) {
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    `SameSite=${AUTH_COOKIE_SAMESITE}`,
  ];
  if (AUTH_COOKIE_DOMAIN) parts.push(`Domain=${AUTH_COOKIE_DOMAIN}`);
  if (AUTH_COOKIE_SAMESITE === 'None' || isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setCsrfCookie(req, res, token) {
  appendSetCookie(res, serializeCsrfCookie(req, token));
}

function clearCsrfCookie(req, res) {
  appendSetCookie(res, serializeCsrfCookie(req, '', 0));
}

function isCsrfValid(req) {
  const cookieToken = parseCookies(req)[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyTokenSync(token) {
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
    // 拒絕 refresh token 用於一般認證
    if (payload.typ === 'refresh') return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
}

async function verifyToken(token) {
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
    // 拒絕 refresh token 用於一般認證
    if (payload.typ === 'refresh') return null;
    // 向後相容：舊 JWT 無 jti，略過黑名單檢查
    if (payload.jti && (await isTokenBlacklisted(payload.jti))) return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    if (typeof userId !== 'string') return null;
    // New tokens carry a durable PostgreSQL auth version. A mismatch remains
    // revoked even when Redis loses its ephemeral blacklist/cutoff keys.
    if (payload.authVersion !== undefined) {
      const currentAuthVersion = await getCurrentAuthVersion(userId);
      if (!currentAuthVersion || currentAuthVersion !== Number(payload.authVersion)) return null;
    }
    const sessionIat = Number.isFinite(payload.sessionIat) ? Number(payload.sessionIat) : Number(payload.iat);
    if (await isUserSessionRevoked(userId, sessionIat)) return null;
    return userId;
  } catch {
    return null;
  }
}

// Atomically consume a refresh token while checking the per-user revocation
// cutoff. This closes the race between password/logout revocation and refresh
// rotation (a plain GETDEL cannot check the cutoff in the same operation).
const CONSUME_REFRESH_TOKEN_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if not stored or stored ~= ARGV[2] then return false end
local revokedBefore = redis.call('GET', KEYS[2])
if revokedBefore and tonumber(ARGV[1]) <= tonumber(revokedBefore) then
  redis.call('DEL', KEYS[1])
  return false
end
redis.call('DEL', KEYS[1])
return stored
`;

async function consumeRefreshTokenJti(jti, userId, sessionIat) {
  const key = `refresh:${jti}`;
  const revokedBeforeKey = `auth:revoked-before:${userId}`;
  if (typeof redis.eval === 'function') {
    // EVAL is available on every supported Redis version. Do not fall back
    // on an ACL/connection error because that would re-open the race.
    return redis.eval(CONSUME_REFRESH_TOKEN_SCRIPT, 2, key, revokedBeforeKey, String(sessionIat), userId);
  }
  // Test/legacy-client fallback. Supported production clients expose EVAL;
  // retain the cutoff check before deletion for compatibility only.
  const value = await redis.get(key);
  if (value !== userId || (await isUserSessionRevoked(userId, sessionIat))) return null;
  await redis.del(key);
  return value;
}

async function verifyRefreshToken(token) {
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
    if (payload.typ !== 'refresh') return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.jti) return null;
    const userId = typeof payload.sub === 'string' ? payload.sub : payload.userId;
    if (typeof userId !== 'string' || !userId) return null;
    if (payload.authVersion !== undefined) {
      const currentAuthVersion = await getCurrentAuthVersion(userId);
      if (!currentAuthVersion || currentAuthVersion !== Number(payload.authVersion)) return null;
    }
    // Atomically consume the refresh token and apply the user revocation
    // cutoff; a null result means it was used, revoked, or never registered.
    const sessionIat = Number.isFinite(payload.sessionIat)
      ? Number(payload.sessionIat)
      : Number.isFinite(payload.iat)
        ? Number(payload.iat)
        : 0;
    const registered = await consumeRefreshTokenJti(payload.jti, userId, sessionIat);
    if (!registered) return null;
    return {
      userId,
      sessionIat,
      authVersion: Number.isInteger(payload.authVersion) ? Number(payload.authVersion) : undefined,
    };
  } catch {
    return null;
  }
}

function getAuthUserIdSync(req) {
  const auth = req.headers.authorization;
  if (auth) {
    const userId = verifyTokenSync(auth.replace('Bearer ', ''));
    if (userId) return userId;
  }
  return verifyTokenSync(parseCookies(req)[AUTH_COOKIE_NAME]);
}

async function getAuthUserId(req) {
  const auth = req.headers.authorization;
  if (auth) {
    const userId = await verifyToken(auth.replace('Bearer ', ''));
    if (userId) return userId;
  }
  const cookieToken = parseCookies(req)[AUTH_COOKIE_NAME];
  if (cookieToken) {
    return verifyToken(cookieToken);
  }
  return null;
}

function getClientCountry(req) {
  return String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').toUpperCase();
}

function hashEmailForAvatar(email) {
  return crypto.createHash('sha256').update(email).digest('hex');
}

function mergeOAuthScopes(baseScope, requiredScopes) {
  const scopes = new Set(
    String(baseScope || '')
      .split(/\s+/)
      .filter(Boolean),
  );
  for (const scope of requiredScopes) scopes.add(scope);
  return Array.from(scopes).join(' ');
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
    scope: mergeOAuthScopes(process.env.LOGTO_OAUTH_SCOPE || 'openid profile email', [
      'phone',
      'address',
      'identities',
      'custom_data',
      'urn:logto:scope:sessions',
      'offline_access',
    ]),
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
const oauthOneTimeMemory = new Map();

async function fetchOAuthWithTimeout(url, options = {}, timeoutMs = OAUTH_HTTP_TIMEOUT_MS) {
  const method = String(options.method || 'GET').toUpperCase();
  return fetchWithResilience(fetch, url, options, {
    timeoutMs,
    maxAttempts: OAUTH_HTTP_MAX_ATTEMPTS,
    retry: method === 'GET' || method === 'HEAD' || method === 'DELETE',
  });
}

async function resolveLogtoProvider(config) {
  if (!config.discoveryUrl || !config.clientId || !config.clientSecret) return config;
  if (!logtoDiscoveryCache) {
    const configuredDiscovery = new URL(config.discoveryUrl);
    if (process.env.NODE_ENV === 'production' && configuredDiscovery.protocol !== 'https:') {
      throw new Error('Logto discovery URL must use HTTPS in production');
    }
    const response = await fetchOAuthWithTimeout(config.discoveryUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Logto discovery failed');
    const discovery = await response.json();
    const expectedIssuer = LOGTO_ISSUER || (LOGTO_ENDPOINT ? `${LOGTO_ENDPOINT}/oidc` : '');
    const normalizeIssuer = (value) => String(value || '').replace(/\/$/, '');
    if (
      process.env.NODE_ENV === 'production' &&
      (!discovery.issuer || normalizeIssuer(discovery.issuer) !== normalizeIssuer(expectedIssuer))
    ) {
      throw new Error('Logto discovery issuer mismatch');
    }
    const endpoint = (value, name) => {
      let parsed;
      try {
        parsed = new URL(String(value || ''));
      } catch {
        throw new Error(`Logto discovery ${name} endpoint is invalid`);
      }
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new Error(`Logto discovery ${name} endpoint must use HTTPS`);
      }
      if (process.env.NODE_ENV === 'production' && parsed.origin !== configuredDiscovery.origin) {
        throw new Error(`Logto discovery ${name} endpoint origin mismatch`);
      }
      return parsed.toString();
    };
    logtoDiscoveryCache = {
      authUrl: endpoint(discovery.authorization_endpoint, 'authorization'),
      tokenUrl: endpoint(discovery.token_endpoint, 'token'),
      userInfoUrl: endpoint(discovery.userinfo_endpoint, 'userinfo'),
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
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OAuth public base URL is unavailable in production');
  }
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

function oauthCookieName(prefix, nonce) {
  return `${prefix}${String(nonce || '')
    .replace(/[^a-f0-9]/gi, '')
    .slice(0, 48)}`;
}

function serializeOAuthCookie(req, name, value, maxAge = OAUTH_STATE_TTL_SECONDS) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setOAuthCookie(req, res, name, value, maxAge = OAUTH_STATE_TTL_SECONDS) {
  appendSetCookie(res, serializeOAuthCookie(req, name, value, maxAge));
}

function clearOAuthCookies(req, res, nonce) {
  setOAuthCookie(req, res, oauthCookieName(OAUTH_STATE_COOKIE_PREFIX, nonce), '', 0);
  setOAuthCookie(req, res, oauthCookieName(OAUTH_PKCE_COOKIE_PREFIX, nonce), '', 0);
}

function oauthCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function oauthCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function storeOAuthOneTimeValue(key, value, ttlSeconds) {
  try {
    const stored = await boundedRedisCommand(
      () => redis.set(key, value, 'EX', ttlSeconds, 'NX'),
      OAUTH_REDIS_TIMEOUT_MS,
    );
    if (stored !== 'OK') throw new Error('OAuth state already exists');
    return;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw new Error('OAuth state store unavailable');
    oauthOneTimeMemory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

async function consumeOAuthOneTimeValue(key) {
  try {
    if (typeof redis.eval === 'function') {
      const result = await boundedRedisCommand(
        () =>
          redis.eval(
            'local value = redis.call("GET", KEYS[1]); if value then redis.call("DEL", KEYS[1]) end; return value',
            1,
            key,
          ),
        OAUTH_REDIS_TIMEOUT_MS,
      );
      return typeof result === 'string' ? result : null;
    }
    if (process.env.NODE_ENV === 'production') throw new Error('OAuth one-time consume is unavailable');
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw new Error('OAuth state store unavailable');
  }
  const entry = oauthOneTimeMemory.get(key);
  oauthOneTimeMemory.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

async function issueOAuthState(req, res, payload) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const verifier = oauthCodeVerifier();
  await storeOAuthOneTimeValue(`oauth:state:${nonce}`, verifier, OAUTH_STATE_TTL_SECONDS);
  setOAuthCookie(req, res, oauthCookieName(OAUTH_STATE_COOKIE_PREFIX, nonce), nonce);
  setOAuthCookie(req, res, oauthCookieName(OAUTH_PKCE_COOKIE_PREFIX, nonce), verifier);
  return signOAuthState({ ...payload, nonce, codeChallenge: oauthCodeChallenge(verifier) });
}

async function consumeOAuthState(req, res, stateValue) {
  const payload = verifyOAuthState(stateValue);
  if (
    !payload ||
    typeof payload.nonce !== 'string' ||
    !/^[a-f0-9]{48}$/i.test(payload.nonce) ||
    typeof payload.codeChallenge !== 'string'
  )
    return null;
  const cookies = parseCookies(req);
  const cookieNonce = cookies[oauthCookieName(OAUTH_STATE_COOKIE_PREFIX, payload.nonce)] || '';
  const cookieVerifier = cookies[oauthCookieName(OAUTH_PKCE_COOKIE_PREFIX, payload.nonce)] || '';
  if (!cookieNonce || !safeStringEqual(cookieNonce, payload.nonce) || !cookieVerifier) return null;
  const verifier = await consumeOAuthOneTimeValue(`oauth:state:${payload.nonce}`);
  clearOAuthCookies(req, res, payload.nonce);
  if (
    !verifier ||
    !safeStringEqual(verifier, cookieVerifier) ||
    !safeStringEqual(oauthCodeChallenge(verifier), payload.codeChallenge)
  )
    return null;
  return { ...payload, codeVerifier: verifier };
}

async function createOAuthSessionTicket(userId) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString('hex');
  await storeOAuthOneTimeValue(`oauth:session:${nonce}`, userId, OAUTH_SESSION_TICKET_TTL_SECONDS);
  const body = base64urlJson({
    sub: userId,
    iat: now,
    exp: now + OAUTH_SESSION_TICKET_TTL_SECONDS,
    nonce,
  });
  return `${body}.${signTokenInput(`oauth-session.${body}`)}`;
}

async function consumeOAuthSessionTicket(ticket) {
  try {
    const [body, signature] = String(ticket || '').split('.');
    if (!body || !signature) return null;
    const expected = signTokenInput(`oauth-session.${body}`);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== 'string' || typeof payload.nonce !== 'string') return null;
    const userId = await consumeOAuthOneTimeValue(`oauth:session:${payload.nonce}`);
    return userId === payload.sub ? userId : null;
  } catch {
    return null;
  }
}

function oauthErrorReason(error) {
  const reason = String(error || 'unknown_error')
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return reason || 'unknown_error';
}

function normalizeOAuthReturnTo(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  // Reject protocol-relative and backslash variants before URL parsing; both
  // can be interpreted as an external origin by browser navigation APIs.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback;
  try {
    const parsed = new URL(candidate, 'https://oauth.local.invalid');
    if (parsed.origin !== 'https://oauth.local.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

function oauthReturnScript({ sessionTicket, returnTo, error }) {
  const safeReturnTo = normalizeOAuthReturnTo(returnTo);
  const url = new URL(`http://localhost${safeReturnTo}`);
  if (error) url.searchParams.set('oauth', 'error');
  if (!error && sessionTicket) url.searchParams.set('oauth', 'login');
  if (!error && !sessionTicket) url.searchParams.set('oauth', 'linked');
  const errorUrl = new URL(url.toString());
  errorUrl.searchParams.set('oauth', 'error');
  if (error) errorUrl.searchParams.set('oauth_error', oauthErrorReason(error));
  const target = `${url.pathname}${url.search}${url.hash}`;
  const errorTarget = `${errorUrl.pathname}${errorUrl.search}${errorUrl.hash}`;
  return `<!doctype html><meta charset="utf-8"><script>
(async function () {
  const target = ${JSON.stringify(target)};
  const errorTarget = ${JSON.stringify(errorTarget)};
  try {
    localStorage.removeItem('zutomayo_token');
    ${
      sessionTicket
        ? `const exchange = await fetch('/api/oauth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ ticket: ${JSON.stringify(sessionTicket)} })
    });
    if (!exchange.ok) {
      localStorage.removeItem('zutomayo_session');
      const failedUrl = new URL(errorTarget, location.origin);
      failedUrl.searchParams.set('oauth_error', 'session_exchange_failed_' + exchange.status);
      location.replace(failedUrl.pathname + failedUrl.search + failedUrl.hash);
      return;
    }
    localStorage.setItem('zutomayo_session', '1');`
        : ''
    }
    location.replace(target);
  } catch (e) {
    localStorage.removeItem('zutomayo_session');
    const failedUrl = new URL(errorTarget, location.origin);
    failedUrl.searchParams.set('oauth_error', 'session_check_network');
    location.replace(failedUrl.pathname + failedUrl.search + failedUrl.hash);
  }
})();
</script>`;
}

function sendOAuthHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(body);
}

async function exchangeOAuthCode(req, providerConfig, code, codeVerifier) {
  const body = new URLSearchParams();
  body.set('client_id', providerConfig.clientId);
  body.set('client_secret', providerConfig.clientSecret);
  body.set('code', code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', oauthRedirectUri(req, providerConfig.provider));
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const response = await fetchOAuthWithTimeout(providerConfig.tokenUrl, {
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
  return {
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '',
    expiresIn: Number(data.expires_in) || 0,
    scope: typeof data.scope === 'string' ? data.scope : '',
  };
}

async function fetchJsonWithBearer(url, accessToken) {
  const response = await fetchOAuthWithTimeout(url, {
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

function logtoApiBase() {
  return LOGTO_ENDPOINT || LOGTO_ISSUER.replace(/\/oidc$/, '');
}

function tokenExpiresAt(expiresIn) {
  const seconds = Number(expiresIn) || 3600;
  return new Date(Date.now() + Math.max(60, seconds - 30) * 1000);
}

function logtoErrorMessage(data, fallback = 'Logto account request failed') {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.error_description === 'string') return data.error_description;
  return fallback;
}

async function storeOAuthTokenSet({ userId, provider, tokenSet }) {
  if (!userId || !provider || !tokenSet?.accessToken) return;
  await pool.query(
    `UPDATE user_identities
     SET access_token_ciphertext = $1,
         refresh_token_ciphertext = COALESCE($2, refresh_token_ciphertext),
         token_expires_at = $3,
         updated_at = NOW()
     WHERE user_id = $4 AND provider = $5`,
    [
      encryptSecret(tokenSet.accessToken),
      tokenSet.refreshToken ? encryptSecret(tokenSet.refreshToken) : null,
      tokenExpiresAt(tokenSet.expiresIn),
      userId,
      provider,
    ],
  );
}

async function refreshOAuthTokenSet(providerConfig, refreshToken) {
  const body = new URLSearchParams();
  body.set('client_id', providerConfig.clientId);
  body.set('client_secret', providerConfig.clientSecret);
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);

  const response = await fetchOAuthWithTimeout(providerConfig.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('OAuth token refresh failed');
  return {
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken,
    expiresIn: Number(data.expires_in) || 0,
  };
}

async function getLogtoAccountAccessToken(userId) {
  const identity = (
    await pool.query(
      `SELECT access_token_ciphertext, refresh_token_ciphertext, token_expires_at
       FROM user_identities
       WHERE user_id = $1 AND provider = 'logto'`,
      [userId],
    )
  ).rows[0];
  const accessToken = decryptSecret(identity?.access_token_ciphertext);
  if (!accessToken) return { ok: false, status: 409, error: 'Logto account session is not connected' };

  const expiresAt = identity?.token_expires_at ? new Date(identity.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 30 * 1000) return { ok: true, accessToken };

  const refreshToken = decryptSecret(identity?.refresh_token_ciphertext);
  if (!refreshToken) return { ok: false, status: 409, error: 'Logto account session needs reconnect' };

  const providerConfig = await getResolvedOAuthProvider('logto');
  if (!providerConfig) return { ok: false, status: 503, error: 'Logto provider is not configured' };
  const nextTokenSet = await refreshOAuthTokenSet(providerConfig, refreshToken).catch(() => null);
  if (!nextTokenSet) return { ok: false, status: 409, error: 'Logto account session needs reconnect' };
  await storeOAuthTokenSet({ userId, provider: 'logto', tokenSet: nextTokenSet });
  return { ok: true, accessToken: nextTokenSet.accessToken };
}

async function logtoAccountRequest({ userId, path, method = 'GET', body, verificationId }) {
  const base = logtoApiBase();
  if (!base) return { ok: false, status: 503, error: 'Logto endpoint is not configured' };
  const token = await getLogtoAccountAccessToken(userId);
  if (!token.ok) return token;

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token.accessToken}`,
    'User-Agent': 'zutomayo-card-online',
  };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (verificationId) headers['logto-verification-record-id'] = verificationId;

  const response = await fetchOAuthWithTimeout(`${base}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: logtoErrorMessage(data),
      body: data,
    };
  }
  return { ok: true, body: data };
}

function extractLogtoVerificationRecordId(body) {
  const candidates = [body?.verificationRecordId, body?.id, body?.verification?.id, body?.record?.id];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return value ? value.trim().slice(0, 200) : '';
}

async function issueLogtoAccountStepUp({ userId, currentPassword, purpose }) {
  const verification = await logtoAccountRequest({
    userId,
    path: '/api/verifications/password',
    method: 'POST',
    body: { password: currentPassword },
  });
  if (!verification.ok) {
    return {
      ok: false,
      status: verification.status === 401 || verification.status === 403 ? 401 : verification.status,
      error:
        verification.status === 401 || verification.status === 403 ? 'Invalid current password' : verification.error,
    };
  }

  const providerVerificationRecordId = extractLogtoVerificationRecordId(verification.body);
  if (!providerVerificationRecordId) {
    return { ok: false, status: 502, error: 'Logto verification response is invalid' };
  }
  try {
    const issued = await issueAccountStepUp({
      redis,
      userId,
      providerVerificationRecordId,
      purpose,
    });
    return { ok: true, body: { stepUpToken: issued.token, expiresIn: issued.expiresIn } };
  } catch (error) {
    logger.error({ err: error, userId, purpose }, 'failed to persist account step-up');
    return { ok: false, status: 503, error: 'Account verification is temporarily unavailable' };
  }
}

async function consumeLogtoAccountStepUp({ userId, stepUpToken, purpose }) {
  if (typeof stepUpToken !== 'string' || !stepUpToken) {
    return { ok: false, status: 401, error: 'Account verification required' };
  }
  let providerVerificationRecordId;
  try {
    providerVerificationRecordId = await consumeAccountStepUp({
      redis,
      token: stepUpToken,
      userId,
      purpose,
    });
  } catch (error) {
    logger.error({ err: error, userId, purpose }, 'failed to consume account step-up');
    return { ok: false, status: 503, error: 'Account verification is temporarily unavailable' };
  }
  if (!providerVerificationRecordId) {
    return { ok: false, status: 401, error: 'Account verification expired or already used' };
  }
  return { ok: true, verificationId: providerVerificationRecordId };
}

let logtoManagementTokenCache = null;

async function readJsonResponse(response) {
  const responseText = await response.text();
  if (!responseText) return {};
  try {
    return JSON.parse(responseText);
  } catch {
    return { error: responseText };
  }
}

async function getLogtoManagementAccessToken({ forceRefresh = false } = {}) {
  const base = logtoApiBase();
  if (!base || !LOGTO_M2M_APP_ID || !LOGTO_M2M_APP_SECRET) {
    return { ok: false, status: 503, error: 'Logto management account deletion is not configured' };
  }
  if (!forceRefresh && logtoManagementTokenCache?.expiresAt > Date.now() + 30_000) {
    return { ok: true, accessToken: logtoManagementTokenCache.accessToken };
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', LOGTO_M2M_APP_ID);
  body.set('client_secret', LOGTO_M2M_APP_SECRET);
  body.set('resource', LOGTO_MANAGEMENT_RESOURCE || `${base}/api`);
  body.set('scope', LOGTO_MANAGEMENT_SCOPE || LOGTO_ACCOUNT_DELETION_SCOPE);

  const response = await fetchOAuthWithTimeout(`${base}/oidc/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'zutomayo-card-online',
    },
    body: body.toString(),
  });
  const data = await readJsonResponse(response);
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    return {
      ok: false,
      status: response.status || 502,
      error: logtoErrorMessage(data, 'Logto management token failed'),
    };
  }

  const expiresIn = Math.max(60, Number(data.expires_in) || 3600);
  logtoManagementTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return { ok: true, accessToken: data.access_token };
}

async function deleteLogtoPrincipalWithManagementApi(providerUserId, { retryUnauthorized = true } = {}) {
  const token = await getLogtoManagementAccessToken();
  if (!token.ok) return token;
  const base = logtoApiBase();
  const response = await fetchOAuthWithTimeout(`${base}/api/users/${encodeURIComponent(providerUserId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token.accessToken}`,
      'User-Agent': 'zutomayo-card-online',
    },
  });
  if (response.status === 401 && retryUnauthorized) {
    logtoManagementTokenCache = null;
    const refreshed = await getLogtoManagementAccessToken({ forceRefresh: true });
    if (!refreshed.ok) return refreshed;
    return deleteLogtoPrincipalWithManagementApi(providerUserId, { retryUnauthorized: false });
  }
  if (response.ok || response.status === 404) return { ok: true, alreadyDeleted: response.status === 404 };
  const data = await readJsonResponse(response);
  return {
    ok: false,
    status: response.status || 502,
    error: logtoErrorMessage(data, 'Logto principal deletion failed'),
  };
}

async function recoverAccountDeletionRequest(request) {
  let currentRequest = request;
  if (currentRequest.status === 'provider_deleting') {
    await revokeAllUserSessions(currentRequest.userId);
    const providerResult = await deleteLogtoPrincipalWithManagementApi(currentRequest.providerUserId);
    if (!providerResult.ok) return providerResult;
    const marked = await markProviderDeleted({ pool, requestId: currentRequest.id });
    if (!marked.ok) return marked;
    currentRequest = marked.body.request;
  }

  if (currentRequest.status !== 'provider_deleted') {
    return { ok: false, status: 409, error: 'Account deletion request is not recoverable' };
  }
  return deleteAccount({
    pool,
    userId: currentRequest.userId,
    deletionRequestId: currentRequest.id,
    beforeDelete: () => revokeAllUserSessions(currentRequest.userId, { bumpAuthVersion: false }),
  });
}

let accountDeletionRecoveryRunning = false;
let accountDeletionRecoveryTimer = null;

async function recoverAccountDeletions() {
  if (accountDeletionRecoveryRunning) return;
  accountDeletionRecoveryRunning = true;
  try {
    const requests = await listRecoverableAccountDeletions({ pool, limit: 20 });
    for (const request of requests) {
      try {
        const result = await recoverAccountDeletionRequest(request);
        if (!result.ok) {
          logger.warn(
            { requestId: request.id, userId: request.userId, status: result.status, error: result.error },
            'account deletion recovery remains pending',
          );
        }
      } catch (error) {
        logger.error({ err: error, requestId: request.id, userId: request.userId }, 'account deletion recovery failed');
      }
    }
  } finally {
    accountDeletionRecoveryRunning = false;
  }
}

function startAccountDeletionRecovery() {
  if (accountDeletionRecoveryTimer) return;
  void recoverAccountDeletions();
  accountDeletionRecoveryTimer = setInterval(
    () => void recoverAccountDeletions(),
    ACCOUNT_DELETION_RECOVERY_INTERVAL_MS,
  );
  accountDeletionRecoveryTimer.unref?.();
}

function stopAccountDeletionRecovery() {
  if (!accountDeletionRecoveryTimer) return;
  clearInterval(accountDeletionRecoveryTimer);
  accountDeletionRecoveryTimer = null;
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

  const response = await fetchOAuthWithTimeout(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) return { ok: false, status: 502, error: 'Verification service unavailable' };

  const result = await response.json().catch(() => ({}));
  if (!result.success) return { ok: false, status: 400, error: 'Verification failed' };
  return { ok: true };
}

function createAdminToken({ adminUserId, role, jti, expiresIn }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    admin: true,
    adminUserId,
    role,
    jti,
    iat: now,
    exp: now + expiresIn,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signTokenInput(input)}`;
}

function decodeAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const token = auth.slice('Bearer '.length);
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadPart, signature] = parts;
    const input = `${header}.${payloadPart}`;
    const expected = signTokenInput(input);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (!payload.admin || !payload.adminUserId || !payload.role || !payload.jti) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authorizeAdmin(req, permission) {
  const payload = decodeAdminToken(req);
  if (!payload) return null;
  // Route tests use a signed synthetic actor and mock the downstream service
  // calls. This branch is unreachable outside NODE_ENV=test and production
  // always checks the persisted revocable session below.
  if (process.env.NODE_ENV === 'test' && payload.adminUserId === 'admin_test') {
    return { adminUserId: payload.adminUserId, role: payload.role };
  }
  return verifyAdminSession({ pool, payload, permission });
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
const RATE_LIMIT_IMGPROXY = Number(process.env.RATE_LIMIT_IMGPROXY) || 600;
const RATE_LIMIT_DEFAULT = 120;
const RATE_LIMIT_UPLOAD = 10;
const REDIS_LIMITER_TIMEOUT_MS = Math.max(100, Number(process.env.REDIS_LIMITER_TIMEOUT_MS) || 750);
const MATCHMAKING_USER_LIMIT = Math.max(1, Number(process.env.MATCHMAKING_USER_LIMIT) || 6);
const MATCHMAKING_IP_LIMIT = Math.max(1, Number(process.env.MATCHMAKING_IP_LIMIT) || 30);
const MATCHMAKING_GLOBAL_LIMIT = Math.max(1, Number(process.env.MATCHMAKING_GLOBAL_LIMIT) || 2000);

function boundedRedisCommand(command, timeoutMs = REDIS_LIMITER_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(command),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis command timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkRateLimit(ip, limit, keyPrefix = 'ratelimit') {
  const minuteWindow = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const key = `${keyPrefix}:${ip}:${minuteWindow}`;
  try {
    const count = Number(await boundedRedisCommand(() => redis.incr(key)));
    if (count === 1) await boundedRedisCommand(() => redis.expire(key, 120));
    return Number.isFinite(count) && count > 0 && count <= limit;
  } catch (err) {
    // Security-sensitive admission controls fail closed when Redis is
    // unavailable; otherwise a short outage permits an unbounded flood.
    logger.error({ err, key }, 'rate limiter unavailable');
    return false;
  }
}

async function checkQuota({ ip, userId, namespace, ipLimit, userLimit, globalLimit }) {
  const userKey = userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32) : 'anonymous';
  const checks = await Promise.all([
    checkRateLimit(ip || 'unknown', ipLimit, `quota:${namespace}:ip`),
    checkRateLimit(userKey, userLimit, `quota:${namespace}:user`),
    checkRateLimit('global', globalLimit, `quota:${namespace}:global`),
  ]);
  return checks.every(Boolean);
}

// 驗證上傳圖片的 magic bytes，防止偽造副檔名上傳惡意檔案。
function validateImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return true;
  // JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
  // WEBP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return true;
  return false;
}

const IMGPROXY_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-security-policy',
  'content-type',
  'etag',
  'expires',
  'last-modified',
]);

const IMGPROXY_FORWARD_REQUEST_HEADERS = ['if-none-match', 'if-modified-since', 'if-range', 'range'];

function forwardedImgproxyHeaders(req) {
  const headers = {};
  for (const name of IMGPROXY_FORWARD_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

function proxyImgproxyResponse(targetUrl, req, res) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
    let completed = false;
    let proxyResEnded = false;
    let proxyReq;
    const cleanup = () => {
      req.off('aborted', onClientAbort);
      res.off('close', onClientAbort);
    };
    const finish = () => {
      if (completed) return;
      completed = true;
      cleanup();
      resolve();
    };
    const fail = (err) => {
      if (completed) return;
      completed = true;
      cleanup();
      reject(err);
    };
    const onClientAbort = () => {
      if (proxyResEnded || completed) return;
      proxyReq?.destroy(new Error('client aborted imgproxy request'));
      finish();
    };
    req.on('aborted', onClientAbort);
    res.on('close', onClientAbort);

    proxyReq = client.request(
      parsed,
      {
        method,
        headers: forwardedImgproxyHeaders(req),
        timeout: 10000,
      },
      (proxyRes) => {
        const headers = {};
        for (const [name, value] of Object.entries(proxyRes.headers)) {
          if (value === undefined || !IMGPROXY_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
          headers[name] = value;
        }
        headers['cache-control'] =
          proxyRes.statusCode && proxyRes.statusCode >= 200 && proxyRes.statusCode < 400
            ? IMGPROXY_CACHE_CONTROL
            : 'no-store';
        res.writeHead(proxyRes.statusCode || 502, headers);

        if (method === 'HEAD') {
          proxyRes.resume();
          proxyRes.on('end', () => {
            proxyResEnded = true;
            finish();
          });
          proxyRes.on('error', fail);
          return;
        }

        proxyRes.pipe(res);
        proxyRes.on('end', () => {
          proxyResEnded = true;
          finish();
        });
        proxyRes.on('error', fail);
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('imgproxy timeout'));
    });
    proxyReq.on('error', fail);
    proxyReq.end();
  });
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

local requestBlocked = {}
for i = 5, #ARGV do
  requestBlocked[ARGV[i]] = true
end

-- 找最早且雙向都沒有封鎖關係的 waiting 對手。Redis block set
-- 由 block API 即時維護，ARGV 則是本次排隊從 PostgreSQL 讀到的快照。
local opponentId = nil
local opponents = redis.call('ZRANGE', KEYS[1], 0, -1)
for i, candidateId in ipairs(opponents) do
  if candidateId ~= userId
     and not requestBlocked[candidateId]
     and redis.call('SISMEMBER', 'mm:blocked:' .. userId, candidateId) == 0
     and redis.call('SISMEMBER', 'mm:blocked:' .. candidateId, userId) == 0
     and redis.call('HGET', 'mm:' .. candidateId, 'status') == 'queued' then
    opponentId = candidateId
    break
  end
end
if not opponentId then return '' end

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

const CANCEL_MATCHMAKING_PAIR_LUA = `
local function cancelIfMatched(userId, opponentId)
  local key = 'mm:' .. userId
  if redis.call('HGET', key, 'status') ~= 'matched' then return 0 end
  if redis.call('HGET', key, 'opponentId') ~= opponentId then return 0 end
  redis.call('HSET', key, 'status', 'timeout')
  redis.call('HDEL', key, 'matchId', 'opponentId', 'role', 'realMatchId')
  redis.call('ZREM', KEYS[1], userId)
  return 1
end

local cancelled = cancelIfMatched(ARGV[1], ARGV[2])
cancelled = cancelled + cancelIfMatched(ARGV[2], ARGV[1])
return cancelled
`;

const APPLY_MATCHMAKING_BLOCK_LUA = `
redis.call('SADD', 'mm:blocked:' .. ARGV[1], ARGV[2])
local function cancelIfMatched(userId, opponentId)
  local key = 'mm:' .. userId
  if redis.call('HGET', key, 'status') ~= 'matched' then return 0 end
  if redis.call('HGET', key, 'opponentId') ~= opponentId then return 0 end
  redis.call('HSET', key, 'status', 'timeout')
  redis.call('HDEL', key, 'matchId', 'opponentId', 'role', 'realMatchId')
  redis.call('ZREM', KEYS[1], userId)
  return 1
end

local cancelled = cancelIfMatched(ARGV[1], ARGV[2])
cancelled = cancelled + cancelIfMatched(ARGV[2], ARGV[1])
return cancelled
`;

redis.defineCommand('mmTryMatch', { numberOfKeys: 1, lua: MATCH_LUA });
redis.defineCommand('mmCleanExpired', { numberOfKeys: 1, lua: CLEAN_LUA });
redis.defineCommand('mmCancelPair', { numberOfKeys: 1, lua: CANCEL_MATCHMAKING_PAIR_LUA });
redis.defineCommand('mmApplyBlock', { numberOfKeys: 1, lua: APPLY_MATCHMAKING_BLOCK_LUA });

// ===== Trusted Proxy & Client IP =====
// E10：信任代理 IP/CIDR 列表。僅當請求來自信任代理時才使用 X-Forwarded-For，
// 防止攻擊者偽造 header 繞過 rate limit。未設定時固定使用 req.socket.remoteAddress。
const TRUSTED_PROXIES = (process.env.TRUSTED_PROXY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip)
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%', 1)[0]
    .toLowerCase();
}

function ipv6ToBytes(value) {
  const ip = normalizeIp(value);
  if (net.isIP(ip) !== 6) return null;
  const embedded = ip.includes('.') ? ip.slice(ip.lastIndexOf(':') + 1) : '';
  let source = ip;
  if (embedded) {
    const v4 = ipv4ToInt(embedded);
    if (v4 === null) return null;
    source = `${ip.slice(0, ip.lastIndexOf(':'))}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(parseInt(group, 16), index * 2));
  return bytes;
}

function ipBytes(ip) {
  const normalized = normalizeIp(ip);
  if (net.isIP(normalized) === 4) {
    const value = ipv4ToInt(normalized);
    if (value === null) return null;
    return Buffer.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
  }
  const v6 = ipv6ToBytes(normalized);
  if (!v6) return null;
  // Treat IPv4-mapped IPv6 addresses as their IPv4 identity for proxy checks.
  if (v6.subarray(0, 10).equals(Buffer.alloc(10)) && v6[10] === 0xff && v6[11] === 0xff) {
    return Buffer.from(v6.subarray(12));
  }
  return v6;
}

function ipMatch(ip, range) {
  const normalizedRange = normalizeIp(range);
  const slash = normalizedRange.indexOf('/');
  const base = slash >= 0 ? normalizedRange.slice(0, slash) : normalizedRange;
  const ipBuffer = ipBytes(ip);
  const baseBuffer = ipBytes(base);
  if (!ipBuffer || !baseBuffer || ipBuffer.length !== baseBuffer.length) return false;
  if (slash < 0) return ipBuffer.equals(baseBuffer);
  const prefixLen = Number(normalizedRange.slice(slash + 1));
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > ipBuffer.length * 8) return false;
  const fullBytes = Math.floor(prefixLen / 8);
  const remainingBits = prefixLen % 8;
  if (!ipBuffer.subarray(0, fullBytes).equals(baseBuffer.subarray(0, fullBytes))) return false;
  if (!remainingBits) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (ipBuffer[fullBytes] & mask) === (baseBuffer[fullBytes] & mask);
}

function isTrustedProxy(ip) {
  if (!ip || TRUSTED_PROXIES.length === 0) return false;
  return TRUSTED_PROXIES.some((range) => ipMatch(ip, range));
}

function getClientIp(req) {
  const remoteAddress = req.socket.remoteAddress || '';
  if (isTrustedProxy(remoteAddress)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const chain = xff
        .toString()
        .split(',')
        .map((value) => value.trim())
        .filter((value) => net.isIP(normalizeIp(value)) > 0);
      // Walk from the proxy towards the client and stop at the first
      // untrusted hop. This prevents a client from smuggling an arbitrary
      // left-most address through a trusted reverse-proxy chain.
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        if (!isTrustedProxy(chain[index])) return normalizeIp(chain[index]);
      }
      if (chain.length > 0) return normalizeIp(chain[0]);
    }
  }
  return normalizeIp(remoteAddress);
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
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Request observability: request id, structured logging, Prometheus metrics.
  const { log: reqLog, requestId } = attachRequestObservability(req, res);

  // Rate limiting (P0-4, Redis)
  const clientIp = getClientIp(req);
  const isAuthEndpoint = pathname === '/api/login' || pathname === '/api/register' || pathname === '/api/admin/login';
  const isImgproxyEndpoint = pathname.startsWith('/api/imgproxy/');

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
  // 使用 withScope 包裹單次 capture，避免 configureScope 污染 Node server 請求 scope。
  const safe = (fn) => {
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        Sentry.withScope((scope) => {
          scope.setTag('request_id', requestId);
          scope.setTag('route', pathname);
          scope.setTag('method', method);
          scope.setContext('client', { ip: clientIp });
          const authUserId = getAuthUserIdSync(req);
          if (authUserId) scope.setUser({ id: authUserId });
          Sentry.captureException(err);
        });
        reqLog.error({ err }, 'handler error');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
  };

  // 先做 rate limit（async），其餘邏輯在 callback 內繼續。
  safe(async () => {
    const rateLimit = isAuthEndpoint ? RATE_LIMIT_AUTH : isImgproxyEndpoint ? RATE_LIMIT_IMGPROXY : RATE_LIMIT_DEFAULT;
    const rateLimitNamespace = isAuthEndpoint
      ? 'ratelimit:auth'
      : isImgproxyEndpoint
        ? 'ratelimit:imgproxy'
        : 'ratelimit:default';
    if (!(await checkRateLimit(clientIp, rateLimit, rateLimitNamespace))) {
      rateLimitedTotal.labels(isImgproxyEndpoint ? '/api/imgproxy/:path' : pathname).inc();
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }));
      return;
    }

    // CSRF protection (double-submit cookie pattern)
    if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && !CSRF_EXEMPT_PATHS.has(pathname)) {
      if (!isCsrfValid(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CSRF token validation failed' }));
        return;
      }
    }

    if (isImgproxyEndpoint && (method === 'GET' || method === 'HEAD')) {
      if (url.search) return json({ error: 'imgproxy query string is not supported' }, 400);
      const unsignedPath = pathname.slice('/api/imgproxy'.length);
      const signed = buildSignedImgproxyUrl({
        path: unsignedPath,
        baseUrl: IMGPROXY_INTERNAL_BASE_URL,
        keyHex: IMGPROXY_KEY,
        saltHex: IMGPROXY_SALT,
        allowedSources: IMGPROXY_ALLOWED_SOURCES,
      });
      if (!signed.ok) return json({ error: signed.error }, signed.status);

      try {
        await proxyImgproxyResponse(signed.url, req, res);
      } catch (err) {
        reqLog.warn({ err }, 'imgproxy proxy failed');
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'imgproxy unavailable' }));
        } else {
          res.destroy(err);
        }
      }
      return;
    }

    if (pathname === '/metrics' && method === 'GET') {
      if (!checkMetricsAuth(req)) return json({ error: 'Unauthorized' }, 401);
      try {
        await refreshMatchmakingQueueDepth(redis);
      } catch {
        // The auxiliary queue gauge is marked unknown; metrics serving remains available.
      }
      return metricsResponse(res);
    }

    if (pathname === '/health' && method === 'GET') {
      const checks = {};
      let allOk = true;
      try {
        await pool.query('SELECT 1');
        checks.postgres = 'up';
      } catch {
        checks.postgres = 'down';
        allOk = false;
      }
      try {
        await redis.ping();
        checks.redis = 'up';
      } catch {
        checks.redis = 'down';
        allOk = false;
      }
      res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: allOk ? 'ok' : 'degraded', checks }));
      return;
    }

    if (pathname === '/ready' && method === 'GET') {
      const checks = { postgres: 'down', redis: 'down', schema: 'down', draining: 'up' };
      let ready = !shuttingDown;
      if (shuttingDown) checks.draining = 'down';
      if (!schemaInitError) checks.schema = 'up';
      else ready = false;
      try {
        await pool.query('SELECT 1');
        checks.postgres = 'up';
      } catch {
        ready = false;
      }
      try {
        await boundedRedisCommand(() => redis.ping());
        checks.redis = 'up';
      } catch {
        ready = false;
      }
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ready, checks }));
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

    if (pathname === '/api/oauth/session' && method === 'POST') {
      res.setHeader('Cache-Control', 'no-store');
      const body = await readBody(32 * 1024);
      const userId = await consumeOAuthSessionTicket(body.ticket);
      if (!userId) return json({ error: 'Invalid OAuth session ticket' }, 401);
      const { accessToken, refreshToken } = await createTokenPair(userId);
      setAuthCookie(req, res, accessToken);
      setRefreshCookie(req, res, refreshToken);
      setCsrfCookie(req, res, generateCsrfToken());
      json({ ok: true });
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
      const userId = await getAuthUserId(req);
      if (mode === 'link' && !userId) return json({ error: 'Unauthorized' }, 401);
      const returnTo = url.searchParams.get('returnTo') || (mode === 'link' ? '/profile' : '/');
      const now = Math.floor(Date.now() / 1000);
      const state = await issueOAuthState(req, res, {
        mode,
        provider: providerConfig.provider,
        userId: mode === 'link' ? userId : undefined,
        returnTo: normalizeOAuthReturnTo(returnTo, mode === 'link' ? '/profile' : '/'),
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
      const statePayload = verifyOAuthState(state);
      if (statePayload?.codeChallenge) {
        authUrl.searchParams.set('code_challenge', statePayload.codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
      }
      if (providerConfig.provider === 'google') authUrl.searchParams.set('prompt', 'select_account');
      if (providerConfig.provider === 'logto' && mode === 'login') authUrl.searchParams.set('prompt', 'login');

      res.writeHead(302, { Location: authUrl.toString(), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const oauthCallbackRoute = pathname.match(/^\/api\/oauth\/([^/]+)\/callback$/);
    if (oauthCallbackRoute && method === 'GET') {
      const provider = decodeURIComponent(oauthCallbackRoute[1]);
      if (!isOAuthProviderAllowed(provider)) {
        Sentry.captureException(new Error('OAuth callback: unknown provider'), {
          tags: { action: 'oauth-callback', provider },
        });
        sendOAuthHtml(res, 404, oauthReturnScript({ returnTo: '/', error: 'Unknown OAuth provider' }));
        return;
      }
      const providerConfig = await getResolvedOAuthProvider(provider);
      const state = await consumeOAuthState(req, res, url.searchParams.get('state'));
      if (!providerConfig || !state || state.provider !== providerConfig.provider) {
        Sentry.captureException(new Error('OAuth callback: invalid state'), {
          tags: { action: 'oauth-callback', provider },
        });
        sendOAuthHtml(res, 400, oauthReturnScript({ returnTo: state?.returnTo || '/', error: 'Invalid OAuth state' }));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        Sentry.captureException(new Error('OAuth callback: missing code'), {
          tags: { action: 'oauth-callback', provider },
        });
        sendOAuthHtml(res, 400, oauthReturnScript({ returnTo: state.returnTo, error: 'Missing OAuth code' }));
        return;
      }

      if (state.mode === 'link') {
        const currentUserId = await getAuthUserId(req);
        if (!currentUserId || currentUserId !== state.userId) {
          sendOAuthHtml(
            res,
            401,
            oauthReturnScript({ returnTo: state.returnTo, error: 'Account linking session expired' }),
          );
          return;
        }
      }

      const tokenSet = await exchangeOAuthCode(req, providerConfig, code, state.codeVerifier);
      const oauthProfile = await fetchOAuthProfile(providerConfig, tokenSet.accessToken);
      if (state.mode === 'link') {
        if (!ACCOUNT_LINKING_ENABLED) {
          sendOAuthHtml(
            res,
            403,
            oauthReturnScript({ returnTo: state.returnTo, error: 'Account linking is managed by Logto' }),
          );
          return;
        }
        const result = await linkOAuthIdentity({ pool, userId: state.userId, profile: oauthProfile });
        sendOAuthHtml(
          res,
          result.ok ? 200 : result.status || 400,
          oauthReturnScript({ returnTo: state.returnTo, error: result.ok ? '' : result.error }),
        );
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
      const localUserId = result.ok && typeof result.body?.user?.id === 'string' ? result.body.user.id : '';
      const loginOk = result.ok && Boolean(localUserId);
      if (loginOk && providerConfig.provider === 'logto') {
        await storeOAuthTokenSet({ userId: localUserId, provider: providerConfig.provider, tokenSet });
      }
      sendOAuthHtml(
        res,
        loginOk ? 200 : result.status || 400,
        oauthReturnScript({
          sessionTicket: loginOk ? await createOAuthSessionTicket(localUserId) : '',
          returnTo: state.returnTo,
          error: loginOk ? '' : result.error || 'Missing local account id',
        }),
      );
      return;
    }

    // ===== Auth Routes =====

    // CSRF token endpoint: generates a new CSRF token and sets it as a cookie.
    if (pathname === '/api/csrf-token' && method === 'GET') {
      const token = generateCsrfToken();
      setCsrfCookie(req, res, token);
      json({ token });
      return;
    }

    // Register
    if (pathname === '/api/register' && method === 'POST') {
      if (!LOCAL_AUTH_ENABLED) return json({ error: 'Local auth is disabled' }, 403);
      const __body = await readBody();
      const challenge = await verifyAuthChallenge(__body, clientIp);
      if (!challenge.ok) return json({ error: challenge.error }, challenge.status);
      const __parsed = validateBody(S.registerSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await registerAccount({
        pool,
        body: __parsed.data,
        sanitizeText,
        hashPassword,
        createToken,
        generateUserId: () => 'u_' + crypto.randomBytes(8).toString('hex'),
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const refreshToken = await issueRefreshToken(
        result.body.user.id,
        sessionIatFromToken(result.body.token),
        authVersionFromToken(result.body.token),
      );
      setAuthCookie(req, res, result.body.token);
      setRefreshCookie(req, res, refreshToken);
      setCsrfCookie(req, res, generateCsrfToken());
      json(result.body);
      return;
    }

    // Login
    if (pathname === '/api/login' && method === 'POST') {
      if (!LOCAL_AUTH_ENABLED) return json({ error: 'Local auth is disabled' }, 403);
      const __body = await readBody();
      const challenge = await verifyAuthChallenge(__body, clientIp);
      if (!challenge.ok) return json({ error: challenge.error }, challenge.status);
      const __parsed = validateBody(S.loginSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await loginAccount({
        pool,
        body: __parsed.data,
        hashPassword,
        createToken,
        currentIterations: PBKDF2_ITERATIONS,
        legacyIterations: PBKDF2_LEGACY_ITERATIONS,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const refreshToken = await issueRefreshToken(
        result.body.user.id,
        sessionIatFromToken(result.body.token),
        authVersionFromToken(result.body.token),
      );
      setAuthCookie(req, res, result.body.token);
      setRefreshCookie(req, res, refreshToken);
      setCsrfCookie(req, res, generateCsrfToken());
      json(result.body);
      return;
    }

    if (pathname === '/api/auth/refresh' && method === 'POST') {
      const refreshToken = parseCookies(req)[REFRESH_COOKIE_NAME];
      if (!refreshToken) return json({ error: 'Refresh token required' }, 401);
      const session = await verifyRefreshToken(refreshToken);
      if (!session) {
        clearRefreshCookie(req, res);
        clearCsrfCookie(req, res);
        return json({ error: 'Invalid or expired refresh token' }, 401);
      }
      // Rotate：verifyRefreshToken 已透過 GETDEL 原子消費舊 refresh token，發新 token pair
      const { accessToken, refreshToken: newRefreshToken } = await createTokenPair(
        session.userId,
        session.sessionIat,
        session.authVersion ?? 1,
      );
      setAuthCookie(req, res, accessToken);
      setRefreshCookie(req, res, newRefreshToken);
      setCsrfCookie(req, res, generateCsrfToken());
      json({ token: accessToken });
      return;
    }

    if (pathname === '/api/logout' && method === 'POST') {
      const cookieToken = parseCookies(req)[AUTH_COOKIE_NAME];
      if (cookieToken) await blacklistToken(cookieToken);
      const refreshToken = parseCookies(req)[REFRESH_COOKIE_NAME];
      if (refreshToken) await revokeRefreshToken(refreshToken);
      clearAuthCookie(req, res);
      clearRefreshCookie(req, res);
      clearCsrfCookie(req, res);
      json({ ok: true });
      return;
    }

    if (pathname === '/api/auth/email-verification/request' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await requestEmailVerification({ pool, userId });
      if (!result.ok) return json({ error: result.error }, result.status);
      if (result.body.alreadyVerified) return json({ accepted: true, alreadyVerified: true });
      const delivery = await deliverAccountAction({
        actionType: 'verify_email',
        email: result.body.email,
        token: result.body.token,
        expiresIn: result.body.expiresIn,
      });
      if (!delivery.ok) return json({ error: delivery.error }, delivery.status);
      json({ accepted: true });
      return;
    }

    if (pathname === '/api/auth/email-verification/confirm' && method === 'POST') {
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.accountTokenSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await verifyEmailToken({ pool, token: parsed.data.token });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/auth/password-reset/request' && method === 'POST') {
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.passwordResetRequestSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await requestPasswordReset({ pool, email: parsed.data.email });
      if (!result.ok) return json({ error: result.error }, result.status);
      if (result.body.token) {
        const delivery = await deliverAccountAction({
          actionType: 'reset_password',
          email: parsed.data.email,
          token: result.body.token,
          expiresIn: result.body.expiresIn,
        });
        if (!delivery.ok) reqLog.error({ deliveryError: delivery.error }, 'password reset delivery failed');
      }
      // Deliberately return the same response for existing and missing email addresses.
      json({ accepted: true }, 202);
      return;
    }

    if (pathname === '/api/auth/password-reset/confirm' && method === 'POST') {
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.passwordResetConfirmSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await resetPassword({
        pool,
        token: parsed.data.token,
        newPassword: parsed.data.newPassword,
        hashPassword,
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const consumedUserId = result.body.userId;
      if (consumedUserId) await revokeAllUserSessions(consumedUserId, { bumpAuthVersion: false });
      clearAuthCookie(req, res);
      clearRefreshCookie(req, res);
      clearCsrfCookie(req, res);
      json({ reset: true });
      return;
    }

    if (pathname === '/api/account/export' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await exportAccountData({
        pool,
        userId,
        maxBytes: Number(process.env.ACCOUNT_EXPORT_MAX_BYTES) || undefined,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Vary', 'Cookie, Authorization');
      res.setHeader('Content-Disposition', `attachment; filename="zutomayo-account-${userId}.json"`);
      json(result.body);
      return;
    }

    if (pathname === '/api/account' && method === 'DELETE') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.accountDeleteSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);

      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);

      // A linked Logto principal must be removed before local anonymization,
      // including hybrid accounts that also have a local password.
      if (capabilities.body.hasLogtoIdentity) {
        const prepared = await prepareLogtoAccountDeletion({ pool, userId });
        if (!prepared.ok) return json({ error: prepared.error }, prepared.status);
        let deletionRequest = prepared.body.request;

        if (deletionRequest.status === 'provider_deleting') {
          await revokeRequestAccountSessions(req, userId);
          const recovered = await recoverAccountDeletionRequest(deletionRequest);
          if (!recovered.ok) {
            return json({ error: recovered.error, deletionPending: true }, recovered.status === 503 ? 503 : 409);
          }
          clearAuthCookie(req, res);
          clearRefreshCookie(req, res);
          clearCsrfCookie(req, res);
          json(recovered.body);
          return;
        }

        if (deletionRequest.status === 'provider_deleted') {
          const result = await deleteAccount({
            pool,
            userId,
            requireStepUp: true,
            stepUpVerified: true,
            deletionRequestId: deletionRequest.id,
            beforeDelete: () => revokeRequestAccountSessions(req, userId, { bumpAuthVersion: false }),
          });
          if (!result.ok) return json({ error: result.error }, result.status);
          clearAuthCookie(req, res);
          clearRefreshCookie(req, res);
          clearCsrfCookie(req, res);
          json(result.body);
          return;
        }

        const consumed = await consumeLogtoAccountStepUp({
          userId,
          stepUpToken: parsed.data.stepUpToken,
          purpose: ACCOUNT_STEP_UP_PURPOSE_DELETE,
        });
        if (!consumed.ok) return json({ error: consumed.error }, consumed.status);

        const started = await markProviderDeletionStarted({ pool, requestId: deletionRequest.id });
        if (!started.ok) return json({ error: started.error }, started.status);
        deletionRequest = started.body.request;

        // Once provider deletion is durable intent, block all existing local
        // sessions before issuing the external mutation.
        await revokeRequestAccountSessions(req, userId);
        let providerDeletion;
        try {
          providerDeletion = await logtoAccountRequest({
            userId,
            path: '/api/my-account',
            method: 'DELETE',
            verificationId: consumed.verificationId,
          });
        } catch (error) {
          await markProviderDeletionFailure({
            pool,
            requestId: deletionRequest.id,
            error,
            retryable: true,
          });
          throw error;
        }
        if (!providerDeletion.ok) {
          const retryable =
            providerDeletion.status === 408 || providerDeletion.status === 429 || providerDeletion.status >= 500;
          await markProviderDeletionFailure({
            pool,
            requestId: deletionRequest.id,
            error: providerDeletion.error,
            retryable,
          });
          return json({ error: providerDeletion.error, deletionPending: retryable }, providerDeletion.status);
        }

        const marked = await markProviderDeleted({ pool, requestId: deletionRequest.id });
        if (!marked.ok) return json({ error: marked.error, deletionPending: true }, marked.status);
        const result = await deleteAccount({
          pool,
          userId,
          requireStepUp: true,
          stepUpVerified: true,
          deletionRequestId: deletionRequest.id,
          beforeDelete: () => revokeRequestAccountSessions(req, userId, { bumpAuthVersion: false }),
        });
        if (!result.ok) return json({ error: result.error, deletionPending: true }, result.status);
        clearAuthCookie(req, res);
        clearRefreshCookie(req, res);
        clearCsrfCookie(req, res);
        json(result.body);
        return;
      }

      if (capabilities.body.hasLocalPassword) {
        const stepUp = await verifyRecentPassword({
          pool,
          userId,
          currentPassword: parsed.data.currentPassword,
          hashPassword,
          currentIterations: PBKDF2_ITERATIONS,
          legacyIterations: PBKDF2_LEGACY_ITERATIONS,
        });
        if (!stepUp.ok) return json({ error: stepUp.error }, stepUp.status);
      } else {
        return json({ error: 'No supported account verification method is available' }, 409);
      }

      const result = await deleteAccount({
        pool,
        userId,
        requireStepUp: true,
        stepUpVerified: true,
        beforeDelete: () => revokeRequestAccountSessions(req, userId, { bumpAuthVersion: false }),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      clearAuthCookie(req, res);
      clearRefreshCookie(req, res);
      clearCsrfCookie(req, res);
      json(result.body);
      return;
    }

    // Get profile
    if (pathname === '/api/profile' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await getAccountProfile(pool, userId, {
        country: getClientCountry(req),
        hashEmail: hashEmailForAvatar,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      json({ ...result.body, ...capabilities.body });
      return;
    }

    if (pathname === '/api/profile/identities' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listAccountIdentities(pool, userId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/account-center' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const account = await logtoAccountRequest({ userId, path: '/api/my-account' });
      if (!account.ok) return json({ error: account.error }, account.status);
      const [identities, mfaVerifications, logtoConfigs] = await Promise.all([
        logtoAccountRequest({ userId, path: '/api/my-account/identities' }).catch((error) => ({
          ok: false,
          error: error.message,
        })),
        logtoAccountRequest({ userId, path: '/api/my-account/mfa-verifications' }).catch((error) => ({
          ok: false,
          error: error.message,
        })),
        logtoAccountRequest({ userId, path: '/api/my-account/logto-configs' }).catch((error) => ({
          ok: false,
          error: error.message,
        })),
      ]);
      json({
        account: account.body,
        identities: identities.ok ? identities.body : null,
        mfaVerifications: mfaVerifications.ok ? mfaVerifications.body : null,
        logtoConfigs: logtoConfigs.ok ? logtoConfigs.body : null,
      });
      return;
    }

    if (pathname === '/api/account-center/verifications/password' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.accountCenterVerificationSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      if (!capabilities.body.hasLogtoIdentity) {
        return json({ error: 'Logto account verification is unavailable' }, 409);
      }
      const result = await issueLogtoAccountStepUp({
        userId,
        currentPassword: parsed.data.currentPassword,
        purpose: ACCOUNT_STEP_UP_PURPOSE_PASSWORD,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/account-center/password' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.accountCenterPasswordSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      if (!capabilities.body.hasLogtoIdentity) {
        return json({ error: 'Logto account password is unavailable' }, 409);
      }
      const consumed = await consumeLogtoAccountStepUp({
        userId,
        stepUpToken: parsed.data.stepUpToken,
        purpose: ACCOUNT_STEP_UP_PURPOSE_PASSWORD,
      });
      if (!consumed.ok) return json({ error: consumed.error }, consumed.status);

      // Revoke local sessions before the provider mutation. If Redis cannot
      // persist the cutoff, do not change the provider password with live
      // sessions still active.
      await revokeAllUserSessions(userId);
      const result = await logtoAccountRequest({
        userId,
        path: '/api/my-account/password',
        method: 'POST',
        verificationId: consumed.verificationId,
        body: { password: parsed.data.newPassword },
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      clearAuthCookie(req, res);
      clearRefreshCookie(req, res);
      clearCsrfCookie(req, res);
      json({ ok: true });
      return;
    }

    const profileIdentityRoute = pathname.match(/^\/api\/profile\/identities\/([^/]+)$/);
    if (profileIdentityRoute && method === 'DELETE') {
      if (!ACCOUNT_LINKING_ENABLED) return json({ error: 'Account linking is managed by Logto' }, 403);
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const provider = decodeURIComponent(profileIdentityRoute[1]);
      const result = await unlinkOAuthIdentity({ pool, userId, provider });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Friend Routes =====

    if (pathname === '/api/friends' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listFriends({ pool, userId });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/friends' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody();
      const __parsed = validateBody(S.friendCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await createFriendRequest({ pool, userId, targetUserId: __parsed.data.friendUserId });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, result.body.accepted ? 200 : 202);
      return;
    }

    if (pathname === '/api/friend-requests' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listFriendRequests({ pool, userId });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const friendRequestRoute = pathname.match(/^\/api\/friend-requests\/(\d+)$/);
    if (friendRequestRoute && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.friendRequestResponseSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await respondToFriendRequest({
        pool,
        userId,
        requestId: friendRequestRoute[1],
        accept: parsed.data.accept,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      json({ ...result.body, ...capabilities.body });
      return;
    }

    if (pathname === '/api/blocks' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listBlocks({ pool, userId });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/blocks' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.userBlockSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await blockUser({ pool, userId, targetUserId: parsed.data.targetUserId });
      if (!result.ok) return json({ error: result.error }, result.status);
      await applyMatchmakingBlock(redis, userId, parsed.data.targetUserId).catch((error) =>
        logger.error(
          { err: error, userId, targetUserId: parsed.data.targetUserId },
          'matchmaking block projection failed',
        ),
      );
      json(result.body);
      return;
    }

    const blockRoute = pathname.match(/^\/api\/blocks\/([^/]+)$/);
    if (blockRoute && method === 'DELETE') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await unblockUser({ pool, userId, targetUserId: decodeURIComponent(blockRoute[1]) });
      if (!result.ok) return json({ error: result.error }, result.status);
      await removeMatchmakingBlock(redis, userId, decodeURIComponent(blockRoute[1])).catch((error) =>
        logger.error({ err: error, userId }, 'matchmaking unblock projection failed'),
      );
      json(result.body);
      return;
    }

    const friendRoute = pathname.match(/^\/api\/friends\/([^/]+)$/);
    if (friendRoute && method === 'DELETE') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await removeFriend({ pool, userId, friendUserId: decodeURIComponent(friendRoute[1]) });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Season Routes =====

    if (pathname === '/api/seasons/current' && method === 'GET') {
      const result = await getCurrentSeason(pool);
      json(result.body);
      return;
    }

    if (pathname === '/api/seasons/me' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await getUserSeasonRating({ pool, userId });
      json(result.body);
      return;
    }

    if (pathname === '/api/seasons/leaderboard' && method === 'GET') {
      const result = await listSeasonLeaderboard({
        pool,
        limit: url.searchParams.get('limit'),
        offset: url.searchParams.get('offset'),
      });
      json(result.body);
      return;
    }

    if (pathname === '/api/seasons/rewards' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await getUserSeasonRewards({ pool, userId });
      serviceJson(result);
      return;
    }

    const seasonRewardClaimRoute = pathname.match(/^\/api\/seasons\/([^/]+)\/rewards\/claim$/);
    if (seasonRewardClaimRoute && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const seasonId = decodeURIComponent(seasonRewardClaimRoute[1]);
      const parsedSeasonId = validateBody(S.seasonIdSchema, seasonId);
      if (!parsedSeasonId.ok) return json({ error: 'Validation failed', details: parsedSeasonId.errors }, 400);
      const result = await claimSeasonReward({ pool, userId, seasonId: parsedSeasonId.data });
      serviceJson(result);
      return;
    }

    // ===== Deck Routes =====

    // List user's decks
    if (pathname === '/api/decks' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await listUserDecks(pool, userId));
      return;
    }

    // Create deck
    if (pathname === '/api/decks' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody();
      const __parsed = validateBody(S.deckCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await createUserDeck(pool, userId, __parsed.data);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Reserve a server-owned deck for a single online match seat. The game
    // server consumes this opaque id after validating the same JWT identity.
    if ((pathname === '/api/deck-reservations' || pathname === '/api/decks/reservations') && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.deckReservationSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await reserveUserDeck(
        pool,
        userId,
        parsed.data.deckId,
        parsed.data.rulesVersion || GAME_RULES_VERSION,
      );
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, 201);
      return;
    }

    // Update deck
    if (pathname.match(/^\/api\/decks\/d_/) && method === 'PUT') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const deckId = pathname.split('/').pop();
      const __body = await readBody();
      const __parsed = validateBody(S.deckCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await updateUserDeck(pool, userId, deckId, __parsed.data);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Delete deck
    if (pathname.match(/^\/api\/decks\/d_/) && method === 'DELETE') {
      const userId = await getAuthUserId(req);
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
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const matchId = matchLogRoute[1];
      const result = await getMatchActionLog(pool, matchId, sanitizeActionLog, userId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Submit match result
    if (pathname === '/api/matches' && method === 'POST') {
      // P0-2：強制 JWT 認證，只有贏家可以提交自己的勝利。
      const authUserId = await getAuthUserId(req);
      if (!authUserId) return json({ error: 'Unauthorized' }, 401);

      const __rawBody = await readBody();
      const __parsed = validateBody(S.matchSubmitSchema, __rawBody);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await submitMatchResult({
        pool,
        authUserId,
        body: __parsed.data,
        sanitizeActionLog,
        rankedMatchesEnabled: RANKED_MATCHES_ENABLED,
        rulesVersion: GAME_RULES_VERSION,
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
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.heartbeatSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const { visitorId } = __parsed.data;
      const result = await heartbeatOnlinePresence(redis, { visitorId, ttlMs: PRESENCE_TTL_MS });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Chat Routes =====

    // GET /api/chat/messages?type=match&subjectId=... — 對話歷史同步。
    if (pathname === '/api/chat/messages' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listChatMessages({
        pool,
        userId,
        conversationType: url.searchParams.get('type'),
        subjectId: url.searchParams.get('subjectId'),
        limit: url.searchParams.get('limit'),
        before: url.searchParams.get('before'),
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // POST /api/chat/messages — 持久化訊息；Colyseus 只負責後續 preview 廣播。
    if (pathname === '/api/chat/messages' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatMessageCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await sendChatMessage({
        pool,
        authorUserId: userId,
        body: __parsed.data,
        sanitizeText,
        generateMessageId: () => 'chat_msg_' + crypto.randomBytes(12).toString('hex'),
        generateModerationEventId: () => 'chat_mod_' + crypto.randomBytes(12).toString('hex'),
        moderationRules: defaultChatModerationRules(process.env),
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
        allowedAuthorRoles: ['player', 'spectator'],
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, 201);
      return;
    }

    // POST /api/chat/read — 記錄已讀游標，支援未讀計數。
    if (pathname === '/api/chat/read' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatReadSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await markConversationRead({
        pool,
        userId,
        body: __parsed.data,
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // GET /api/chat/unread — 跨對局/房間/好友聊天未讀摘要。
    if (pathname === '/api/chat/unread' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const result = await listUnreadChat({
        pool,
        userId,
        limit: url.searchParams.get('limit'),
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const chatTranslationRoute = pathname.match(/^\/api\/chat\/messages\/([^/]+)\/translate$/);
    if (chatTranslationRoute && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatTranslationRequestSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await requestChatTranslation({
        pool,
        userId,
        messageId: chatTranslationRoute[1],
        body: __parsed.data,
        sanitizeText,
        translateText: translateChatMessage,
        providerName: process.env.CHAT_TRANSLATION_PROVIDER || '',
        modelName: process.env.CHAT_TRANSLATION_MODEL || '',
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, result.body.translation?.status === 'ready' ? 200 : 202);
      return;
    }

    const chatReportRoute = pathname.match(/^\/api\/chat\/messages\/([^/]+)\/report$/);
    if (chatReportRoute && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatReportCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await reportChatMessage({
        pool,
        reporterUserId: userId,
        messageId: chatReportRoute[1],
        body: __parsed.data,
        sanitizeText,
        generateReportId: () => 'chat_report_' + crypto.randomBytes(12).toString('hex'),
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, 201);
      return;
    }

    // P2-10：使用者對戰歷史（跨裝置同步）。
    if (pathname === '/api/matches' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await getUserMatches(pool, userId, url.searchParams.get('limit'), url.searchParams.get('offset')));
      return;
    }

    // PUT /api/profile — 修改暱稱（P2 補齊）。
    if (pathname === '/api/profile' && method === 'PUT') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody();
      const __parsed = validateBody(S.profileUpdateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await updateAccountProfile({
        pool,
        userId,
        body: __parsed.data,
        sanitizeText,
        country: getClientCountry(req),
        hashEmail: hashEmailForAvatar,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      json({ ...result.body, ...capabilities.body });
      return;
    }

    // PUT /api/profile/password — 修改密碼。
    if (pathname === '/api/profile/password' && method === 'PUT') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody();
      const __parsed = validateBody(S.passwordChangeSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const capabilities = await getAccountSecurityCapabilities(pool, userId);
      if (!capabilities.ok) return json({ error: capabilities.error }, capabilities.status);
      if (!capabilities.body.hasLocalPassword) return json({ error: 'Password is managed by Logto' }, 403);
      const result = await updateAccountPassword({
        pool,
        userId,
        body: __parsed.data,
        hashPassword,
        generateSalt: () => crypto.randomBytes(16).toString('hex'),
        currentIterations: PBKDF2_ITERATIONS,
        legacyIterations: PBKDF2_LEGACY_ITERATIONS,
        beforeUpdate: () => revokeAllUserSessions(userId),
        incrementAuthVersion: true,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Admin API (P0-3 + P2-12) =====

    // Admin 登入
    if (pathname === '/api/admin/login' && method === 'POST') {
      const __body = await readBody();
      const __parsed = validateBody(S.adminLoginSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      if (ADMIN_TOTP_ENCRYPTION_KEY.length < 32) return json({ error: 'Admin login is not configured' }, 503);
      const result = await authenticateAdmin({
        pool,
        body: __parsed.data,
        hashPassword,
        decryptTotpSecret: (ciphertext) => decryptAdminTotpSecret(ciphertext, ADMIN_TOTP_ENCRYPTION_KEY),
        createSessionToken: createAdminToken,
        passwordIterations: PBKDF2_ITERATIONS,
        sessionTtlSeconds: ADMIN_SESSION_TTL_SECONDS,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
      const payload = decodeAdminToken(req);
      if (!payload) return json({ error: 'Unauthorized' }, 401);
      await revokeAdminSession({ pool, jti: payload.jti, adminUserId: payload.adminUserId });
      json({ revoked: true });
      return;
    }

    // Admin：使用者列表
    if (pathname === '/api/admin/users' && method === 'GET') {
      if (!(await authorizeAdmin(req, 'users:read'))) return json({ error: 'Unauthorized' }, 401);
      json(await listAdminUsers(pool, url.searchParams.get('limit')));
      return;
    }

    // Admin：對戰列表
    if (pathname === '/api/admin/matches' && method === 'GET') {
      if (!(await authorizeAdmin(req, 'matches:read'))) return json({ error: 'Unauthorized' }, 401);
      json(await getAdminMatches(pool, url.searchParams.get('limit')));
      return;
    }

    if (pathname === '/api/admin/seasons' && method === 'GET') {
      if (!(await authorizeAdmin(req, 'seasons:read'))) return json({ error: 'Unauthorized' }, 401);
      const parsed = validateBody(S.adminSeasonListQuerySchema, Object.fromEntries(url.searchParams.entries()));
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await listSeasons({ pool, limit: parsed.data.limit });
      serviceJson(result);
      return;
    }

    if (pathname === '/api/admin/seasons' && method === 'POST') {
      const admin = await authorizeAdmin(req, 'seasons:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(64 * 1024);
      const parsed = validateBody(S.adminSeasonCreateSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await createSeason({ pool, adminUserId: admin.adminUserId, ...parsed.data });
      serviceJson(result, 201);
      return;
    }

    const adminSeasonActionRoute = pathname.match(/^\/api\/admin\/seasons\/([^/]+)\/(activate|close)$/);
    if (adminSeasonActionRoute && method === 'POST') {
      const admin = await authorizeAdmin(req, 'seasons:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const seasonId = decodeURIComponent(adminSeasonActionRoute[1]);
      const parsedSeasonId = validateBody(S.seasonIdSchema, seasonId);
      if (!parsedSeasonId.ok) return json({ error: 'Validation failed', details: parsedSeasonId.errors }, 400);
      const operation = adminSeasonActionRoute[2] === 'activate' ? activateSeason : closeSeason;
      const result = await operation({ pool, seasonId: parsedSeasonId.data, adminUserId: admin.adminUserId });
      serviceJson(result);
      return;
    }

    if (pathname === '/api/admin/legal-holds' && method === 'GET') {
      if (!(await authorizeAdmin(req, 'legal-holds:read'))) return json({ error: 'Unauthorized' }, 401);
      const parsed = validateBody(S.legalHoldListQuerySchema, Object.fromEntries(url.searchParams.entries()));
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await listLegalHolds({ pool, ...parsed.data });
      serviceJson(result);
      return;
    }

    if (pathname === '/api/admin/legal-holds' && method === 'POST') {
      const admin = await authorizeAdmin(req, 'legal-holds:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.legalHoldCreateSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const result = await createLegalHold({ pool, adminUserId: admin.adminUserId, ...parsed.data });
      serviceJson(result, 201);
      return;
    }

    const adminLegalHoldReleaseRoute = pathname.match(/^\/api\/admin\/legal-holds\/([^/]+)\/release$/);
    if (adminLegalHoldReleaseRoute && method === 'POST') {
      const admin = await authorizeAdmin(req, 'legal-holds:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody(32 * 1024);
      const parsed = validateBody(S.legalHoldReleaseSchema, body);
      if (!parsed.ok) return json({ error: 'Validation failed', details: parsed.errors }, 400);
      const holdId = decodeURIComponent(adminLegalHoldReleaseRoute[1]);
      if (!/^legal_hold_[a-f0-9]{24}$/.test(holdId)) return json({ error: 'Invalid legal hold id' }, 400);
      const result = await releaseLegalHold({
        pool,
        adminUserId: admin.adminUserId,
        holdId,
        reason: parsed.data.reason,
      });
      serviceJson(result);
      return;
    }

    // Admin：聊天舉報列表（審核取證）。
    if (pathname === '/api/admin/chat/reports' && method === 'GET') {
      if (!(await authorizeAdmin(req, 'chat:moderate'))) return json({ error: 'Unauthorized' }, 401);
      const result = await listChatReports({
        pool,
        status: url.searchParams.get('status'),
        limit: url.searchParams.get('limit'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：查看聊天對話上下文（賽後查詢與舉報取證）。
    const adminChatEvidenceRoute = pathname.match(/^\/api\/admin\/chat\/conversations\/([^/]+)\/messages$/);
    if (adminChatEvidenceRoute && method === 'GET') {
      if (!(await authorizeAdmin(req, 'chat:moderate'))) return json({ error: 'Unauthorized' }, 401);
      const conversationId = decodeURIComponent(adminChatEvidenceRoute[1]);
      const result = await listChatEvidenceMessages({
        pool,
        conversationId,
        limit: url.searchParams.get('limit'),
        before: url.searchParams.get('before'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：建立聊天禁言處置。
    if (pathname === '/api/admin/chat/sanctions' && method === 'POST') {
      const admin = await authorizeAdmin(req, 'chat:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatUserSanctionCreateSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await createChatUserSanction({
        pool,
        targetUserId: __parsed.data.targetUserId,
        body: __parsed.data,
        reviewerUserId: admin.adminUserId,
        sanitizeText,
        generateSanctionId: () => 'chat_sanction_' + crypto.randomBytes(12).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body, 201);
      return;
    }

    // Admin：解除聊天禁言處置。
    const adminChatSanctionRoute = pathname.match(/^\/api\/admin\/chat\/sanctions\/([^/]+)$/);
    if (adminChatSanctionRoute && method === 'DELETE') {
      const admin = await authorizeAdmin(req, 'chat:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const result = await revokeChatUserSanction({
        pool,
        sanctionId: adminChatSanctionRoute[1],
        reviewerUserId: admin.adminUserId,
        body: { reason: 'manual_revoke' },
        sanitizeText,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：更新聊天舉報審核狀態。
    const adminChatReportRoute = pathname.match(/^\/api\/admin\/chat\/reports\/([^/]+)$/);
    if (adminChatReportRoute && method === 'POST') {
      const admin = await authorizeAdmin(req, 'chat:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatReportReviewSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await reviewChatReport({
        pool,
        reportId: adminChatReportRoute[1],
        body: __parsed.data,
        reviewerUserId: admin.adminUserId,
        sanitizeText,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：審核聊天訊息本身（敏感詞放行 / 封鎖 / 刪除）。
    const adminChatMessageModerationRoute = pathname.match(/^\/api\/admin\/chat\/messages\/([^/]+)\/moderation$/);
    if (adminChatMessageModerationRoute && method === 'POST') {
      const admin = await authorizeAdmin(req, 'chat:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody(32 * 1024);
      const __parsed = validateBody(S.chatMessageModerationReviewSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const result = await reviewChatMessageModeration({
        pool,
        messageId: adminChatMessageModerationRoute[1],
        body: __parsed.data,
        reviewerUserId: admin.adminUserId,
        sanitizeText,
        generateModerationEventId: () => 'chat_mod_' + crypto.randomBytes(12).toString('hex'),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // Admin：重置使用者 ELO
    if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/elo') && method === 'PUT') {
      const admin = await authorizeAdmin(req, 'elo:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const targetUserId = pathname.split('/')[4];
      const __body = await readBody();
      const __parsed = validateBody(S.adminEloSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      json(await resetUserElo(pool, targetUserId, __parsed.data.elo, admin.adminUserId));
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
      if (!(await authorizeAdmin(req, 'cards:write'))) return json({ error: 'Unauthorized' }, 401);
      json({ ok: true });
      return;
    }

    const adminCardI18nRoute = pathname.match(/^\/api\/admin\/cards\/([^/]+)\/i18n$/);
    if (adminCardI18nRoute && method === 'PUT') {
      const admin = await authorizeAdmin(req, 'cards:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const cardId = decodeURIComponent(adminCardI18nRoute[1]);
      const result = await upsertCardI18n(pool, cardId, await readBody(), admin.adminUserId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const adminCardRoute = pathname.match(/^\/api\/admin\/cards\/([^/]+)$/);
    if (adminCardRoute && method === 'PUT') {
      const admin = await authorizeAdmin(req, 'cards:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const cardId = decodeURIComponent(adminCardRoute[1]);
      const result = await upsertCard(pool, cardId, await readBody(), admin.adminUserId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    const adminConfigRoute = pathname.match(/^\/api\/admin\/config\/([^/]+)$/);
    if (adminConfigRoute && method === 'PUT') {
      const admin = await authorizeAdmin(req, 'config:write');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const key = decodeURIComponent(adminConfigRoute[1]);
      const result = await upsertGameConfig(pool, key, await readBody(), admin.adminUserId);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Matchmaking Routes =====

    // POST /api/matchmaking/queue — 加入配對佇列
    if (pathname === '/api/matchmaking/queue' && method === 'POST') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      if (
        !(await checkQuota({
          ip: clientIp,
          userId,
          namespace: 'matchmaking',
          ipLimit: MATCHMAKING_IP_LIMIT,
          userLimit: MATCHMAKING_USER_LIMIT,
          globalLimit: MATCHMAKING_GLOBAL_LIMIT,
        }))
      ) {
        return json({ error: 'Matchmaking capacity is temporarily unavailable' }, 429);
      }
      const __body = await readBody();
      const __parsed = validateBody(S.mmQueueSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const blockedUserIds = await listMatchmakingBlockedUserIds({ pool, userId });
      json(
        await joinMatchmakingQueue({
          redis,
          userId,
          body: __parsed.data,
          sanitizeText,
          generateQueueId: () => 'q_' + crypto.randomBytes(8).toString('hex'),
          generateMatchId: generateMatchmakingId,
          ttlSeconds: MM_TTL_SECONDS,
          timeoutMs: MATCHMAKING_TIMEOUT_MS,
          blockedUserIds,
        }),
      );
      return;
    }

    // GET /api/matchmaking/status — 查詢配對狀態
    if (pathname === '/api/matchmaking/status' && method === 'GET') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const blockedUserIds = await listMatchmakingBlockedUserIds({ pool, userId });
      json(await getMatchmakingStatus(redis, userId, Date.now(), MATCHMAKING_TIMEOUT_MS, blockedUserIds));
      return;
    }

    // DELETE /api/matchmaking/queue — 離開佇列
    if (pathname === '/api/matchmaking/queue' && method === 'DELETE') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      json(await leaveMatchmakingQueue(redis, userId));
      return;
    }

    // PUT /api/matchmaking/match — host 回報真實 boardgame.io matchID
    if (pathname === '/api/matchmaking/match' && method === 'PUT') {
      const userId = await getAuthUserId(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const __body = await readBody();
      const __parsed = validateBody(S.mmMatchSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const blockedUserIds = await listMatchmakingBlockedUserIds({ pool, userId });
      const result = await reportRealMatch(redis, userId, __parsed.data.matchId, blockedUserIds);
      if (!result.ok) return json({ error: result.error }, result.status);
      json(result.body);
      return;
    }

    // ===== Feedback Routes（反饋功能，參考 Fider）=====
    // 投票者身份：登入用戶優先，否則用匿名 ID（前端 localStorage 產生）。
    async function extractFeedbackVoter(req, body) {
      const userId = await getAuthUserId(req);
      if (userId) return { userId };
      const raw = body && body.anonymousId !== undefined ? body.anonymousId : url.searchParams.get('anonymousId');
      if (typeof raw === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw)) return { anonymousId: raw };
      return {};
    }
    const generateFeedbackId = (prefix) => prefix + crypto.randomBytes(8).toString('hex');

    // GET /api/feedback/posts — 列出反饋
    if (pathname === '/api/feedback/posts' && method === 'GET') {
      const voter = await extractFeedbackVoter(req, {});
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
      const voter = await extractFeedbackVoter(req, {});
      serviceJson(await getFeedbackPost({ pool, voter, postId }));
      return;
    }

    // POST /api/feedback/posts — 建立反饋（匿名或登入）
    if (pathname === '/api/feedback/posts' && method === 'POST') {
      const body = await readBody();
      const __parsed = validateBody(S.feedbackPostCreateSchema, body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const voter = await extractFeedbackVoter(req, __parsed.data);
      serviceJson(
        await createFeedbackPost({
          pool,
          voter,
          body: __parsed.data,
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
      const voter = await extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackVote({ pool, voter, postId }));
      return;
    }

    // POST /api/feedback/posts/:id/comments — 新增留言
    const feedbackCommentRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)\/comments$/);
    if (feedbackCommentRoute && method === 'POST') {
      const postId = decodeURIComponent(feedbackCommentRoute[1]);
      const body = await readBody();
      const __parsed = validateBody(S.feedbackCommentCreateSchema, body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const voter = await extractFeedbackVoter(req, __parsed.data);
      const officialAdmin = body.isOfficial ? await authorizeAdmin(req, 'feedback:moderate') : null;
      serviceJson(
        await addFeedbackComment({
          pool,
          voter,
          postId,
          body: __parsed.data,
          sanitizeText,
          generateId: () => generateFeedbackId('fc_'),
          isOfficial: Boolean(body.isOfficial) && Boolean(officialAdmin),
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
      const voter = await extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackCommentVote({ pool, voter, commentId }));
      return;
    }

    // PUT /api/feedback/posts/:id — 編輯文章（作者）
    const feedbackEditPostRoute = pathname.match(/^\/api\/feedback\/posts\/([^/]+)$/);
    if (feedbackEditPostRoute && method === 'PUT') {
      const postId = decodeURIComponent(feedbackEditPostRoute[1]);
      const body = await readBody();
      const __parsed = validateBody(S.feedbackPostEditSchema, body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const voter = await extractFeedbackVoter(req, __parsed.data);
      serviceJson(await editFeedbackPost({ pool, voter, postId, body: __parsed.data, sanitizeText }));
      return;
    }

    // PUT /api/feedback/comments/:id — 編輯留言（作者）
    const commentEditRoute = pathname.match(/^\/api\/feedback\/comments\/([^/]+)$/);
    if (commentEditRoute && method === 'PUT') {
      const commentId = decodeURIComponent(commentEditRoute[1]);
      const body = await readBody();
      const __parsed = validateBody(S.feedbackCommentEditSchema, body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      const voter = await extractFeedbackVoter(req, __parsed.data);
      serviceJson(await editFeedbackComment({ pool, voter, commentId, body: __parsed.data, sanitizeText }));
      return;
    }

    // DELETE /api/feedback/comments/:id — 刪除留言（作者或管理員）
    if (commentEditRoute && method === 'DELETE') {
      const commentId = decodeURIComponent(commentEditRoute[1]);
      const isAdmin = Boolean(await authorizeAdmin(req, 'feedback:moderate'));
      const voter = await extractFeedbackVoter(req, {});
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
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackStatusRoute[1]);
      const __body = await readBody();
      const __parsed = validateBody(S.feedbackStatusSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      serviceJson(
        await updateFeedbackPostStatus({ pool, postId, status: __parsed.data.status, adminUserId: admin.adminUserId }),
      );
      return;
    }

    // PUT /api/feedback/admin/posts/:id/tag — 變更標籤
    const feedbackTagRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)\/tag$/);
    if (feedbackTagRoute && method === 'PUT') {
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackTagRoute[1]);
      const __body = await readBody();
      const __parsed = validateBody(S.feedbackTagSchema, __body);
      if (!__parsed.ok) return json({ error: 'Validation failed', details: __parsed.errors }, 400);
      serviceJson(
        await updateFeedbackPostTag({
          pool,
          postId,
          tag: __parsed.data.tag,
          sanitizeText,
          adminUserId: admin.adminUserId,
        }),
      );
      return;
    }

    // DELETE /api/feedback/admin/posts/:id — 刪除文章（審核）
    const feedbackDeleteRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)$/);
    if (feedbackDeleteRoute && method === 'DELETE') {
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackDeleteRoute[1]);
      serviceJson(await deleteFeedbackPost({ pool, postId, adminUserId: admin.adminUserId }));
      return;
    }

    // POST /api/feedback/admin/tags — 建立標籤
    if (pathname === '/api/feedback/admin/tags' && method === 'POST') {
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const body = await readBody();
      serviceJson(
        await createFeedbackTag({
          pool,
          body,
          sanitizeText,
          generateId: () => generateFeedbackId('ft_'),
          adminUserId: admin.adminUserId,
        }),
      );
      return;
    }

    // DELETE /api/feedback/admin/tags/:id — 刪除標籤
    const feedbackTagDeleteRoute = pathname.match(/^\/api\/feedback\/admin\/tags\/([^/]+)$/);
    if (feedbackTagDeleteRoute && method === 'DELETE') {
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const tagId = decodeURIComponent(feedbackTagDeleteRoute[1]);
      serviceJson(await deleteFeedbackTag({ pool, tagId, adminUserId: admin.adminUserId }));
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
      const voter = await extractFeedbackVoter(req, body);
      serviceJson(await toggleFeedbackCommentReaction({ pool, voter, commentId, emoji }));
      return;
    }

    // POST /api/feedback/admin/posts/:id/duplicate — 標記為重複文章
    const feedbackDuplicateRoute = pathname.match(/^\/api\/feedback\/admin\/posts\/([^/]+)\/duplicate$/);
    if (feedbackDuplicateRoute && method === 'POST') {
      const admin = await authorizeAdmin(req, 'feedback:moderate');
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const postId = decodeURIComponent(feedbackDuplicateRoute[1]);
      const body = await readBody();
      serviceJson(
        await markFeedbackAsDuplicate({
          pool,
          postId,
          originalPostId: body.originalPostId,
          adminUserId: admin.adminUserId,
        }),
      );
      return;
    }

    // POST /api/feedback/uploads — 圖片上傳（base64，限制 3MB body）
    if (pathname === '/api/feedback/uploads' && method === 'POST') {
      // 獨立限流：10 req/min/IP，避免大 body 上傳被濫用
      if (!(await checkRateLimit(clientIp, RATE_LIMIT_UPLOAD, 'rl:upload'))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Too many upload requests. Please try again later.' }));
        return;
      }
      const body = await readBody(3 * 1024 * 1024);
      const voter = await extractFeedbackVoter(req, body);
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
      // magic byte 驗證，防止偽造副檔名上傳惡意檔案
      if (!validateImageMagicBytes(buffer)) {
        return json({ error: 'Invalid image file' }, 400);
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
  stopAccountDeletionRecovery();
  await relationshipOutboxWorker.stop();
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
    await Sentry.close(2000);
  } catch {}
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  validateSecurityConfig();
  schemaReady
    .then(() => {
      if (schemaInitError) throw schemaInitError;
      server.listen(PORT, () => {
        relationshipOutboxWorker.start();
        startAccountDeletionRecovery();
        logger.info({ port: PORT }, 'Zutomayo API server running');
      });
    })
    .catch((err) => {
      logger.fatal({ err }, 'failed to initialize schema; refusing to start API');
      process.exitCode = 1;
    });
}

module.exports = {
  handleRequest,
  server,
  closeDatabase,
  recoverAccountDeletions,
  schemaReady,
};
