/* global module */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { createGzip } = require('node:zlib');
const QueryStream = require('pg-query-stream');
const { AccountExportPermanentError } = require('./accountExportService.cjs');

const DEFAULT_ASYNC_ACCOUNT_EXPORT_MAX_BYTES = 100 * 1024 * 1024;
const FORBIDDEN_EXPORT_KEY =
  /(password|salt|token|ciphertext|credential|secret|ip[_-]?address|client[_-]?ip|remote[_-]?ip|(?:admin|internal|review|moderator)[_-]?note)/i;

const EXPORT_COLLECTIONS = Object.freeze([
  {
    key: 'identities',
    sql: `SELECT provider, provider_user_id, email, email_verified, display_name, avatar_url, created_at, updated_at
            FROM user_identities WHERE user_id = $1 ORDER BY created_at`,
  },
  {
    key: 'decks',
    sql: `SELECT id, name, card_ids, created_at, updated_at FROM decks WHERE user_id = $1 ORDER BY created_at`,
  },
  {
    key: 'deckReservations',
    sql: `SELECT id, deck_id, deck_version, rules_version, card_ids, match_id, player_id,
                 expires_at, consumed_at, created_at
            FROM deck_reservations WHERE user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'matches',
    sql: `SELECT id, source_match_id, player0_id, player1_id, winner_id, loser_id,
                 winner_elo_change, loser_elo_change, turns, duration_seconds, rules_version, created_at
            FROM matches WHERE player0_id = $1 OR player1_id = $1 ORDER BY created_at DESC`,
    transform: transformMatch,
  },
  {
    key: 'friends',
    sql: `SELECT friend_user_id, created_at FROM user_friends WHERE user_id = $1 ORDER BY created_at`,
    transform: (row, context) => ({
      counterpart: pseudonymize(row.friend_user_id, context),
      created_at: row.created_at,
    }),
  },
  {
    key: 'friendRequests',
    sql: `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at, responded_at
            FROM friend_requests
           WHERE requester_user_id = $1 OR recipient_user_id = $1 ORDER BY created_at`,
    transform: transformFriendRequest,
  },
  {
    key: 'blocks',
    sql: `SELECT blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = $1 ORDER BY created_at`,
    transform: (row, context) => ({
      counterpart: pseudonymize(row.blocked_user_id, context),
      created_at: row.created_at,
    }),
  },
  {
    key: 'chatMessages',
    sql: `SELECT m.id, c.type AS conversation_type, m.author_display_name, m.author_role,
                 m.content, m.source_language, m.moderation_status, m.created_at, m.edited_at, m.deleted_at
            FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
           WHERE m.author_user_id = $1 ORDER BY m.created_at DESC`,
  },
  {
    key: 'chatTranslations',
    sql: `SELECT t.message_id, t.target_language, t.translated_content, t.provider, t.model,
                 t.status, t.created_at, t.updated_at
            FROM chat_message_translations t
            JOIN chat_messages m ON m.id = t.message_id
           WHERE m.author_user_id = $1
           ORDER BY t.created_at DESC`,
  },
  {
    key: 'chatReadStates',
    sql: `SELECT conversation_id, last_read_message_id, read_at
            FROM chat_read_states WHERE user_id = $1 ORDER BY read_at DESC`,
  },
  {
    key: 'chatReports',
    sql: `SELECT id, message_id, conversation_id, reason, note, status, created_at, reviewed_at
            FROM chat_reports WHERE reporter_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'sanctions',
    sql: `SELECT id, type, status, conversation_id, created_at, expires_at, revoked_at
            FROM chat_user_sanctions WHERE target_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackPosts',
    sql: `SELECT id, title, description, status, tag, created_at, updated_at, edited_at
            FROM feedback_posts WHERE author_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackComments',
    sql: `SELECT id, post_id, content, is_official, created_at, edited_at
            FROM feedback_comments WHERE author_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackVotes',
    sql: `SELECT post_id, created_at FROM feedback_votes WHERE voter_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackCommentVotes',
    sql: `SELECT comment_id, created_at FROM feedback_comment_votes WHERE voter_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackReactions',
    sql: `SELECT comment_id, emoji, created_at
            FROM feedback_comment_reactions WHERE voter_user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'feedbackAttachments',
    sql: `SELECT attachments.id, attachments.post_id, attachments.comment_id, attachments.file_name,
                 attachments.content_type, attachments.file_size, attachments.created_at
            FROM feedback_attachments attachments
            LEFT JOIN feedback_posts posts ON posts.id = attachments.post_id
            LEFT JOIN feedback_comments comments ON comments.id = attachments.comment_id
           WHERE posts.author_user_id = $1 OR comments.author_user_id = $1
           ORDER BY attachments.created_at DESC`,
  },
  {
    key: 'platformMatchParticipation',
    sql: `SELECT boardgame_match_id, role, boardgame_player_id, display_name, first_joined_at, last_seen_at
            FROM platform_match_participants WHERE user_id = $1 ORDER BY last_seen_at DESC`,
  },
  {
    key: 'platformRoomParticipation',
    sql: `SELECT room_code, role, display_name, first_joined_at, last_seen_at
            FROM platform_room_participants WHERE user_id = $1 ORDER BY last_seen_at DESC`,
  },
  {
    key: 'boardgameSeats',
    sql: `SELECT match_id, player_id, ranked_eligible, reserved_at, last_resumed_at
            FROM bjg_match_seats WHERE user_id = $1 ORDER BY reserved_at DESC`,
  },
  {
    key: 'boardgameResults',
    sql: `SELECT source_match_id, player0_user_id, player1_user_id, winner_user_id, loser_user_id,
                 winner_player, ranked_eligible, turns, duration_seconds, state_id, status,
                 completed_at, rules_version, created_at, delivered_at
            FROM bjg_match_result_outbox
           WHERE player0_user_id = $1 OR player1_user_id = $1 OR winner_user_id = $1 OR loser_user_id = $1
           ORDER BY created_at DESC`,
    transform: transformBoardgameResult,
  },
  {
    key: 'seasonRatings',
    sql: `SELECT sr.season_id, s.name AS season_name, s.status AS season_status,
                 s.starts_at, s.ends_at, sr.rating, sr.match_count, sr.wins,
                 sr.placement_complete, sr.updated_at
            FROM season_ratings sr
            JOIN seasons s ON s.id = sr.season_id
           WHERE sr.user_id = $1
           ORDER BY sr.updated_at DESC`,
  },
  {
    key: 'seasonMatchResults',
    sql: `SELECT season_id, source_match_id, canonical_match_id, winner_user_id, loser_user_id,
                 winner_delta, loser_delta, winner_rating_before, winner_rating_after,
                 loser_rating_before, loser_rating_after, completed_at, rules_version, applied_at
            FROM season_match_results
           WHERE winner_user_id = $1 OR loser_user_id = $1
           ORDER BY completed_at DESC`,
    transform: transformSeasonMatchResult,
  },
  {
    key: 'seasonRewards',
    sql: `SELECT season_id, final_rank, final_rating, reward_tier, reward_payload, granted_at, claimed_at
            FROM season_rewards WHERE user_id = $1 ORDER BY granted_at DESC`,
  },
  {
    key: 'seasonRewardEntitlements',
    sql: `SELECT id, season_id, reward_tier, reward_payload, granted_at
            FROM season_reward_entitlements WHERE user_id = $1 ORDER BY granted_at DESC`,
  },
  {
    key: 'accountActionHistory',
    sql: `SELECT action_type, expires_at, consumed_at, created_at
            FROM account_action_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'accountDeletionHistory',
    sql: `SELECT id, provider, provider_user_id, status, attempt_count, created_at, updated_at,
                 provider_deleted_at, completed_at
            FROM account_deletion_requests WHERE user_id = $1 ORDER BY created_at DESC`,
  },
  {
    key: 'accountExportHistory',
    sql: `SELECT id, status, format_version, content_sha256, size_bytes, attempt_count, max_attempts,
                 requested_at, started_at, completed_at, expires_at, downloaded_at, download_count
            FROM account_export_jobs WHERE user_id = $1 AND id <> $2 ORDER BY requested_at DESC`,
    params: (context) => [context.userId, context.jobId],
  },
  {
    key: 'accountExportAudit',
    sql: `SELECT job_id, event_type, created_at
            FROM account_export_audit WHERE user_id = $1 ORDER BY created_at DESC`,
  },
]);

function boundedMaxBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return DEFAULT_ASYNC_ACCOUNT_EXPORT_MAX_BYTES;
  return Math.max(1024 * 1024, Math.min(DEFAULT_ASYNC_ACCOUNT_EXPORT_MAX_BYTES, Math.floor(bytes)));
}

function resolveAccountExportPseudonymKey(env = process.env) {
  const key = String(env.ACCOUNT_EXPORT_PSEUDONYM_KEY || '').trim();
  if (!key) {
    if (env.NODE_ENV === 'production') throw new Error('ACCOUNT_EXPORT_PSEUDONYM_KEY is required in production');
    return 'development-only-account-export-pseudonym-key';
  }
  if (Buffer.byteLength(key, 'utf8') < 32) throw new Error('ACCOUNT_EXPORT_PSEUDONYM_KEY must be at least 32 bytes');
  return key;
}

function pseudonymize(value, context) {
  if (!value) return null;
  return `subject:${crypto.createHmac('sha256', context.pseudonymKey).update(String(value)).digest('hex').slice(0, 32)}`;
}

function transformMatch(row, context) {
  const playerSlot = row.player0_id === context.userId ? '0' : row.player1_id === context.userId ? '1' : null;
  const counterpartId = playerSlot === '0' ? row.player1_id : row.player0_id;
  const won = row.winner_id === context.userId ? true : row.loser_id === context.userId ? false : null;
  return {
    id: row.id,
    source_match_id: row.source_match_id,
    player_slot: playerSlot,
    counterpart: pseudonymize(counterpartId, context),
    won,
    elo_change: won === true ? row.winner_elo_change : won === false ? row.loser_elo_change : null,
    turns: row.turns,
    duration_seconds: row.duration_seconds,
    rules_version: row.rules_version,
    created_at: row.created_at,
  };
}

function transformFriendRequest(row, context) {
  const outgoing = row.requester_user_id === context.userId;
  return {
    id: row.id,
    direction: outgoing ? 'outgoing' : 'incoming',
    counterpart: pseudonymize(outgoing ? row.recipient_user_id : row.requester_user_id, context),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    responded_at: row.responded_at,
  };
}

function transformBoardgameResult(row, context) {
  const playerSlot = row.player0_user_id === context.userId ? '0' : row.player1_user_id === context.userId ? '1' : null;
  const counterpartId = playerSlot === '0' ? row.player1_user_id : row.player0_user_id;
  return {
    source_match_id: row.source_match_id,
    player_slot: playerSlot,
    counterpart: pseudonymize(counterpartId, context),
    won: row.winner_user_id === context.userId ? true : row.loser_user_id === context.userId ? false : null,
    winner_player: row.winner_player,
    ranked_eligible: row.ranked_eligible,
    turns: row.turns,
    duration_seconds: row.duration_seconds,
    state_id: row.state_id,
    status: row.status,
    completed_at: row.completed_at,
    rules_version: row.rules_version,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  };
}

function transformSeasonMatchResult(row, context) {
  const won = row.winner_user_id === context.userId;
  return {
    season_id: row.season_id,
    source_match_id: row.source_match_id,
    canonical_match_id: row.canonical_match_id,
    counterpart: pseudonymize(won ? row.loser_user_id : row.winner_user_id, context),
    won,
    rating_delta: won ? row.winner_delta : row.loser_delta,
    rating_before: won ? row.winner_rating_before : row.loser_rating_before,
    rating_after: won ? row.winner_rating_after : row.loser_rating_after,
    completed_at: row.completed_at,
    rules_version: row.rules_version,
    applied_at: row.applied_at,
  };
}

function assertSafeExportValue(value, pathParts = []) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeExportValue(item, [...pathParts, String(index)]));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_EXPORT_KEY.test(key)) {
      throw new AccountExportPermanentError(
        'schema_error',
        `Unsafe account export field: ${[...pathParts, key].join('.')}`,
      );
    }
    assertSafeExportValue(nested, [...pathParts, key]);
  }
}

function sanitizeExportValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const sanitized = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_EXPORT_KEY.test(key)) continue;
    sanitized[key] = sanitizeExportValue(nested);
  }
  return sanitized;
}

async function writeChunk(stream, chunk, tracker, signal) {
  if (signal?.aborted) throw signal.reason || new Error('Account export artifact was aborted');
  const bytes = Buffer.byteLength(chunk, 'utf8');
  tracker.bytes += bytes;
  if (tracker.bytes > tracker.maxBytes) {
    throw new AccountExportPermanentError('too_large', 'Account export exceeds the configured asynchronous size limit');
  }
  if (!stream.write(chunk, 'utf8')) await once(stream, 'drain');
}

async function streamCollection(client, output, tracker, descriptor, context, signal) {
  await writeChunk(output, `,${JSON.stringify(descriptor.key)}:[`, tracker, signal);
  const params = descriptor.params ? descriptor.params(context) : [context.userId];
  const rows = client.query(new QueryStream(descriptor.sql, params, { batchSize: 250, highWaterMark: 500 }));
  const abort = () => rows.destroy(signal.reason || new Error('Account export artifact was aborted'));
  signal?.addEventListener('abort', abort, { once: true });
  let first = true;
  try {
    for await (const sourceRow of rows) {
      const transformed = descriptor.transform ? descriptor.transform(sourceRow, context) : sourceRow;
      const row = sanitizeExportValue(transformed);
      assertSafeExportValue(row, [descriptor.key]);
      await writeChunk(output, `${first ? '' : ','}${JSON.stringify(row)}`, tracker, signal);
      first = false;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  await writeChunk(output, ']', tracker, signal);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function cleanupStaleAccountExportArtifacts({
  tempRoot = process.env.ACCOUNT_EXPORT_TMP_DIR || path.join(os.tmpdir(), 'zutomayo-account-exports'),
  maxAgeMs = 2 * 60 * 60 * 1000,
  now = Date.now(),
} = {}) {
  let entries;
  try {
    entries = await fsPromises.readdir(tempRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || (!entry.name.startsWith('job-') && !entry.name.startsWith('download-'))) {
      continue;
    }
    const candidate = path.join(tempRoot, entry.name);
    let stat;
    try {
      stat = await fsPromises.lstat(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) continue;
    let activityStat = stat;
    try {
      activityStat = await fsPromises.lstat(path.join(candidate, '.activity'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (activityStat.isSymbolicLink() || now - activityStat.mtimeMs < maxAgeMs) continue;
    await fsPromises.rm(candidate, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function ensureAccountExportTempRoot(tempRoot) {
  await fsPromises.mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const stat = await fsPromises.lstat(tempRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AccountExportPermanentError('schema_error', 'Account export temporary path must be a directory');
  }
  await fsPromises.chmod(tempRoot, 0o700);
}

async function createAccountExportArtifact({
  pool,
  userId,
  jobId,
  signal,
  pseudonymKey = resolveAccountExportPseudonymKey(process.env),
  maxBytes = DEFAULT_ASYNC_ACCOUNT_EXPORT_MAX_BYTES,
  tempRoot = process.env.ACCOUNT_EXPORT_TMP_DIR || path.join(os.tmpdir(), 'zutomayo-account-exports'),
}) {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(jobId)) {
    throw new AccountExportPermanentError('schema_error', 'Account export job id is invalid');
  }
  const tracker = { bytes: 0, maxBytes: boundedMaxBytes(maxBytes) };
  const context = { userId, jobId, pseudonymKey };
  await ensureAccountExportTempRoot(tempRoot);
  await cleanupStaleAccountExportArtifacts({ tempRoot });
  const workDir = await fsPromises.mkdtemp(path.join(tempRoot, 'job-'));
  const activityPath = path.join(workDir, '.activity');
  await fsPromises.writeFile(activityPath, '', { flag: 'wx', mode: 0o600 });
  const touchActivity = () => {
    const now = new Date();
    return fsPromises.utimes(activityPath, now, now);
  };
  const activityTimer = setInterval(() => void touchActivity().catch(() => undefined), 30_000);
  activityTimer.unref?.();
  const filePath = path.join(workDir, 'account-export.json.gz');
  const gzip = createGzip({ level: 9 });
  const file = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  const compression = pipeline(gzip, file);
  let client;
  let release = () => undefined;
  let transactionStarted = false;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(activityTimer);
    await fsPromises.rm(workDir, { recursive: true, force: true });
  };

  try {
    client = typeof pool.connect === 'function' ? await pool.connect() : pool;
    release = typeof client.release === 'function' ? () => client.release() : () => undefined;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    const account = (
      await client.query(
        `SELECT id, email, email_verified, nickname, elo, match_count, wins, created_at
           FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
      )
    ).rows[0];
    if (!account) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      gzip.destroy();
      await compression.catch(() => undefined);
      await cleanup();
      throw new AccountExportPermanentError('user_missing', 'Account export subject no longer exists');
    }

    const exportedAt = new Date().toISOString();
    const safeAccount = sanitizeExportValue(account);
    assertSafeExportValue(safeAccount, ['account']);
    await writeChunk(
      gzip,
      `{"formatVersion":1,"exportedAt":${JSON.stringify(exportedAt)},"account":${JSON.stringify(safeAccount)}`,
      tracker,
      signal,
    );
    for (const descriptor of EXPORT_COLLECTIONS) {
      await streamCollection(client, gzip, tracker, descriptor, context, signal);
    }
    await writeChunk(gzip, '}', tracker, signal);
    gzip.end();
    await compression;
    await client.query('COMMIT');
    transactionStarted = false;

    const stat = await fsPromises.stat(filePath);
    const contentSha256 = await sha256File(filePath);
    return {
      ok: true,
      filePath,
      sizeBytes: stat.size,
      uncompressedBytes: tracker.bytes,
      snapshotAt: exportedAt,
      contentSha256,
      touch: touchActivity,
      cleanup,
    };
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
    await compression.catch(() => undefined);
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    await cleanup().catch(() => undefined);
    if (error instanceof AccountExportPermanentError) throw error;
    if (String(error?.code || '').startsWith('42')) {
      throw new AccountExportPermanentError('schema_error', 'Account export schema is unavailable');
    }
    throw error;
  } finally {
    release();
  }
}

module.exports = {
  DEFAULT_ASYNC_ACCOUNT_EXPORT_MAX_BYTES,
  EXPORT_COLLECTIONS,
  FORBIDDEN_EXPORT_KEY,
  assertSafeExportValue,
  cleanupStaleAccountExportArtifacts,
  createAccountExportArtifact,
  ensureAccountExportTempRoot,
  resolveAccountExportPseudonymKey,
  sanitizeExportValue,
};
