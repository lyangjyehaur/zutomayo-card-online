/* global module */

// Production disables runtime DDL. Keep this list aligned with every table
// created by the release migrations so a partial/incorrect migration cannot
// be mistaken for a healthy application database.
const REQUIRED_RUNTIME_TABLES = Object.freeze([
  'schema_migration_checksums',
  'users',
  'user_identities',
  'decks',
  'deck_reservations',
  'matches',
  'cards',
  'card_effects_i18n',
  'game_config',
  'preset_decks',
  'admin_audit_log',
  'feedback_posts',
  'feedback_votes',
  'feedback_comments',
  'feedback_comment_votes',
  'feedback_tags',
  'feedback_comment_reactions',
  'feedback_attachments',
  'chat_conversations',
  'chat_messages',
  'chat_message_translations',
  'chat_read_states',
  'chat_reports',
  'chat_moderation_events',
  'chat_user_sanctions',
  'user_friends',
  'friend_requests',
  'user_blocks',
  'platform_match_participants',
  'platform_room_participants',
  'seasons',
  'season_ratings',
  'season_match_results',
  'season_rewards',
  'season_reward_entitlements',
  'legal_holds',
  'legal_hold_objects',
  'retention_runs',
  'account_action_tokens',
  'account_deletion_requests',
  'admin_users',
  'admin_sessions',
  'bjg_matches',
  'bjg_match_seats',
  'bjg_match_result_outbox',
]);

// These are the columns used by authentication, match authority, social/chat,
// retention, and account-deletion paths. Checking the columns catches an
// interrupted expand migration even when the table itself already exists.
const REQUIRED_RUNTIME_COLUMNS = Object.freeze({
  users: ['id', 'auth_version', 'deleted_at'],
  user_identities: ['user_id', 'provider', 'provider_user_id'],
  decks: ['id', 'user_id', 'card_ids', 'updated_at'],
  deck_reservations: ['id', 'user_id', 'deck_id', 'rules_version', 'card_ids', 'expires_at'],
  matches: ['id', 'source_match_id', 'player0_id', 'player1_id', 'rules_version', 'action_log', 'completed_at'],
  cards: ['id', 'name', 'element', 'type', 'updated_at'],
  card_effects_i18n: ['card_id', 'lang', 'effect_text'],
  game_config: ['key', 'value'],
  preset_decks: ['id', 'card_ids'],
  admin_audit_log: ['id', 'action', 'target_type', 'created_at'],
  feedback_posts: ['id', 'title', 'description', 'status', 'created_at'],
  feedback_votes: ['post_id', 'created_at'],
  feedback_comments: ['id', 'post_id', 'content', 'created_at'],
  feedback_comment_votes: ['comment_id', 'created_at'],
  feedback_tags: ['id', 'name', 'color', 'created_at'],
  feedback_comment_reactions: ['comment_id', 'emoji', 'created_at'],
  feedback_attachments: ['id', 'file_name', 'content_type', 'file_size', 'created_at'],
  chat_conversations: ['id', 'type', 'subject_id', 'status', 'updated_at'],
  chat_messages: ['id', 'conversation_id', 'author_user_id', 'content', 'created_at', 'retention_anonymized_at'],
  chat_message_translations: ['message_id', 'target_language', 'translated_content', 'status'],
  chat_read_states: ['conversation_id', 'user_id', 'last_read_message_id', 'read_at'],
  chat_reports: ['id', 'message_id', 'conversation_id', 'status', 'created_at'],
  chat_moderation_events: ['id', 'message_id', 'conversation_id', 'action', 'created_at'],
  chat_user_sanctions: ['id', 'target_user_id', 'type', 'status', 'expires_at'],
  user_friends: ['user_id', 'friend_user_id', 'created_at'],
  friend_requests: ['id', 'requester_user_id', 'recipient_user_id', 'status', 'updated_at'],
  user_blocks: ['blocker_user_id', 'blocked_user_id', 'created_at'],
  platform_match_participants: ['boardgame_match_id', 'user_id', 'role', 'access_verified', 'last_seen_at'],
  platform_room_participants: ['room_code', 'user_id', 'role', 'access_verified', 'last_seen_at'],
  seasons: [
    'id',
    'status',
    'starts_at',
    'ends_at',
    'rules_version',
    'rating_decay_percent',
    'reward_config',
    'settling_at',
    'settled_at',
  ],
  season_ratings: ['season_id', 'user_id', 'rating', 'placement_complete', 'updated_at'],
  season_match_results: [
    'season_id',
    'source_match_id',
    'canonical_match_id',
    'completed_at',
    'rules_version',
    'applied_at',
  ],
  season_rewards: ['season_id', 'user_id', 'reward_tier', 'reward_payload', 'claimed_at'],
  season_reward_entitlements: ['season_id', 'user_id', 'reward_tier', 'reward_payload', 'granted_at'],
  legal_holds: ['id', 'subject_type', 'subject_id', 'released_at', 'expires_at'],
  legal_hold_objects: ['hold_id', 'object_type', 'object_id'],
  retention_runs: ['id', 'mode', 'status', 'heartbeat_at', 'batch_count', 'duration_ms'],
  account_action_tokens: ['id', 'user_id', 'action_type', 'token_hash', 'expires_at'],
  account_deletion_requests: ['id', 'user_id', 'provider', 'provider_user_id', 'status', 'attempt_count', 'last_error'],
  admin_users: ['id', 'username', 'role', 'disabled_at'],
  admin_sessions: ['jti', 'admin_user_id', 'role', 'expires_at', 'revoked_at'],
  bjg_matches: ['match_id', 'state', 'initial_state', 'metadata', 'log', 'updated_at'],
  bjg_match_seats: ['match_id', 'player_id', 'user_id', 'ranked_eligible', 'credential_hash', 'last_resumed_at'],
  bjg_match_result_outbox: [
    'source_match_id',
    'ranked_eligible',
    'turns',
    'duration_seconds',
    'completed_at',
    'rules_version',
    'action_log',
    'status',
    'next_attempt_at',
  ],
});

function normalizeExpectedMigration(value) {
  const migration = String(value || '').trim();
  if (!/^\d{6,}_[a-z0-9_]+$/i.test(migration)) {
    throw new Error('EXPECTED_SCHEMA_MIGRATION must be a migration basename such as 000015_game_seats_result_outbox');
  }
  return migration;
}

function normalizeExpectedChecksum(value) {
  const checksum = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('EXPECTED_SCHEMA_CHECKSUM must be a 64-character SHA-256 digest');
  }
  return checksum;
}

async function assertRuntimeSchema({ pool, expectedMigration, expectedChecksum }) {
  const migration = normalizeExpectedMigration(expectedMigration);
  const checksum = normalizeExpectedChecksum(expectedChecksum);
  let applied;
  try {
    applied = await pool.query('SELECT 1 FROM public.schema_migrations WHERE name = $1 LIMIT 1', [migration]);
  } catch (error) {
    throw new Error(`Schema migration table is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!applied.rows[0]) throw new Error(`Required schema migration is not applied: ${migration}`);

  const recorded = await pool.query('SELECT sha256 FROM public.schema_migration_checksums WHERE name = $1 LIMIT 1', [
    migration,
  ]);
  if (recorded.rows[0]?.sha256 !== checksum) {
    throw new Error(`Schema migration checksum mismatch: ${migration}`);
  }

  const tableCheck = await pool.query(
    `SELECT required.table_name,
            to_regclass('public.' || required.table_name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS required(table_name)`,
    [REQUIRED_RUNTIME_TABLES],
  );
  const missing = tableCheck.rows.filter((row) => row.present !== true).map((row) => row.table_name);
  if (missing.length > 0) throw new Error(`Required runtime tables are missing: ${missing.join(', ')}`);

  const requiredTableNames = [];
  const requiredColumnNames = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_RUNTIME_COLUMNS)) {
    for (const columnName of columns) {
      requiredTableNames.push(tableName);
      requiredColumnNames.push(columnName);
    }
  }
  const columnCheck = await pool.query(
    `SELECT required.table_name,
            required.column_name,
            EXISTS (
              SELECT 1
                FROM information_schema.columns columns
               WHERE columns.table_schema = 'public'
                 AND columns.table_name = required.table_name
                 AND columns.column_name = required.column_name
            ) AS present
       FROM unnest($1::text[], $2::text[]) AS required(table_name, column_name)`,
    [requiredTableNames, requiredColumnNames],
  );
  const missingColumns = columnCheck.rows
    .filter((row) => row.present !== true)
    .map((row) => `${row.table_name}.${row.column_name}`);
  if (missingColumns.length > 0) throw new Error(`Required runtime columns are missing: ${missingColumns.join(', ')}`);
  return { expectedMigration: migration, expectedChecksum: checksum };
}

module.exports = {
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
};
