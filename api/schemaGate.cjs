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
  'card_texts_i18n',
  'card_official_errata',
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
  'relationship_change_outbox',
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
  matches: [
    'id',
    'source_match_id',
    'player0_id',
    'player1_id',
    'rules_version',
    'action_log',
    'completed_at',
    'action_log_purged_at',
    'anonymized_at',
  ],
  cards: [
    'id',
    'name',
    'en_name_official',
    'element',
    'type',
    'effect',
    'en_effect_official',
    'has_official_errata',
    'official_errata_id',
    'official_errata_affects_name',
    'official_errata_affects_effect',
    'official_errata_url',
    'updated_at',
  ],
  card_effects_i18n: ['card_id', 'lang', 'effect_text'],
  card_texts_i18n: [
    'card_id',
    'lang',
    'name_text',
    'effect_text',
    'name_source',
    'effect_source',
    'review_status',
    'review_note',
  ],
  card_official_errata: [
    'errata_id',
    'card_id',
    'affects_name',
    'affects_effect',
    'corrected_japanese_text',
    'corrected_english_text',
    'corrected_english_status',
    'corrected_english_source',
    'source_url',
  ],
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
    'winner_rating_before',
    'winner_rating_after',
    'loser_rating_before',
    'loser_rating_after',
    'applied_at',
  ],
  season_rewards: ['season_id', 'user_id', 'reward_tier', 'reward_payload', 'claimed_at'],
  season_reward_entitlements: ['season_id', 'user_id', 'reward_tier', 'reward_payload', 'granted_at'],
  legal_holds: ['id', 'subject_type', 'subject_id', 'released_at', 'expires_at'],
  legal_hold_objects: ['hold_id', 'object_type', 'object_id'],
  retention_runs: ['id', 'mode', 'status', 'heartbeat_at', 'batch_count', 'duration_ms'],
  account_action_tokens: ['id', 'user_id', 'action_type', 'token_hash', 'expires_at'],
  account_deletion_requests: [
    'id',
    'user_id',
    'provider',
    'provider_user_id',
    'status',
    'attempt_count',
    'last_error',
    'created_at',
    'updated_at',
    'provider_deleted_at',
    'completed_at',
  ],
  relationship_change_outbox: [
    'event_id',
    'idempotency_key',
    'version',
    'kind',
    'user_ids',
    'actor_user_id',
    'occurred_at',
    'status',
    'attempt_count',
    'poison_count',
    'next_attempt_at',
    'locked_at',
    'lock_token',
    'lease_expires_at',
    'last_error',
    'created_at',
    'updated_at',
    'delivered_at',
  ],
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

// Catalog-level contracts for the fields whose shape is security or data-
// integrity critical. `udtName` uses PostgreSQL's stable internal names
// (for example `timestamptz` and `int4`) instead of localized display text.
const REQUIRED_RUNTIME_COLUMN_CONTRACTS = Object.freeze([
  { tableName: 'matches', columnName: 'completed_at', udtName: 'timestamptz', nullable: false, defaultToken: 'now()' },
  { tableName: 'matches', columnName: 'rules_version', udtName: 'text', nullable: false, defaultToken: "'legacy'" },
  {
    tableName: 'matches',
    columnName: 'action_log_purged_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  { tableName: 'matches', columnName: 'anonymized_at', udtName: 'timestamptz', nullable: true, defaultToken: null },
  { tableName: 'season_ratings', columnName: 'rating', udtName: 'int4', nullable: false, defaultToken: null },
  { tableName: 'season_ratings', columnName: 'match_count', udtName: 'int4', nullable: false, defaultToken: '0' },
  { tableName: 'season_ratings', columnName: 'wins', udtName: 'int4', nullable: false, defaultToken: '0' },
  {
    tableName: 'season_ratings',
    columnName: 'placement_complete',
    udtName: 'bool',
    nullable: false,
    defaultToken: 'false',
  },
  {
    tableName: 'season_match_results',
    columnName: 'winner_rating_before',
    udtName: 'int4',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'winner_rating_after',
    udtName: 'int4',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'loser_rating_before',
    udtName: 'int4',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'loser_rating_after',
    udtName: 'int4',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'completed_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'rules_version',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'applied_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'prepared'",
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'attempt_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'last_error',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'created_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'updated_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'provider_deleted_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'account_deletion_requests',
    columnName: 'completed_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'relationship_change_outbox',
    columnName: 'status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'pending'",
  },
  {
    tableName: 'relationship_change_outbox',
    columnName: 'attempt_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'relationship_change_outbox',
    columnName: 'next_attempt_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'relationship_change_outbox',
    columnName: 'poison_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'relationship_change_outbox',
    columnName: 'last_error',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
]);

// These contracts cover the invariants that cannot be represented by a
// column-presence check. Definitions are matched against pg_get_constraintdef
// / pg_indexes output after identifier and whitespace normalization.
const REQUIRED_RUNTIME_CONSTRAINTS = Object.freeze([
  { tableName: 'season_ratings', constraintType: 'p', fragments: ['primary key (season_id, user_id)'] },
  {
    tableName: 'season_ratings',
    constraintType: 'f',
    fragments: ['foreign key (season_id)', 'references seasons(id)'],
  },
  { tableName: 'season_ratings', constraintType: 'f', fragments: ['foreign key (user_id)', 'references users(id)'] },
  { tableName: 'season_match_results', constraintType: 'p', fragments: ['primary key (season_id, source_match_id)'] },
  {
    tableName: 'season_match_results',
    constraintType: 'f',
    fragments: ['foreign key (season_id)', 'references seasons(id)'],
  },
  {
    tableName: 'season_match_results',
    constraintType: 'f',
    fragments: ['foreign key (winner_user_id)', 'references users(id)'],
  },
  {
    tableName: 'season_match_results',
    constraintType: 'f',
    fragments: ['foreign key (loser_user_id)', 'references users(id)'],
  },
  { tableName: 'season_match_results', constraintType: 'c', fragments: ['winner_user_id <> loser_user_id'] },
  {
    tableName: 'season_match_results',
    constraintName: 'fk_season_match_results_canonical_match',
    constraintType: 'f',
    fragments: ['foreign key (canonical_match_id)', 'references matches(id)'],
  },
  { tableName: 'account_deletion_requests', constraintType: 'p', fragments: ['primary key (id)'] },
  {
    tableName: 'account_deletion_requests',
    constraintType: 'c',
    fragments: [
      'prepared',
      'provider_deleting',
      'provider_deleted',
      'provider_failed',
      'completed',
      'attempt_count >= 0',
    ],
  },
  { tableName: 'relationship_change_outbox', constraintType: 'p', fragments: ['primary key (event_id)'] },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'u',
    fragments: ['unique (idempotency_key)'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['pending', 'processing', 'delivered', 'dead_letter'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['attempt_count >= 0'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['poison_count >= 0'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['version = 1'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['friendship_added', 'friendship_removed', 'block_created', 'block_removed', 'account_deleted'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['account_deleted', 'cardinality(user_ids) = 1', 'cardinality(user_ids) = 2'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['actor_user_id is null', 'actor_user_id = any (user_ids)'],
  },
  {
    tableName: 'relationship_change_outbox',
    constraintType: 'c',
    fragments: ['block_created', 'block_removed', 'actor_user_id is not null'],
  },
]);

const REQUIRED_RUNTIME_INDEXES = Object.freeze([
  {
    tableName: 'matches',
    indexName: 'idx_matches_action_log_retention',
    fragments: ['action_log_purged_at', 'completed_at', 'action_log_purged_at is null'],
  },
  {
    tableName: 'matches',
    indexName: 'idx_matches_identity_retention',
    fragments: ['anonymized_at', 'completed_at', 'anonymized_at is null'],
  },
  { tableName: 'season_ratings', indexName: 'idx_season_ratings_leaderboard', fragments: ['season_id', 'rating'] },
  {
    tableName: 'season_match_results',
    indexName: 'uq_season_match_results_source',
    fragments: ['unique index', 'source_match_id'],
  },
  {
    tableName: 'season_match_results',
    indexName: 'uq_season_match_results_canonical_match',
    fragments: ['unique index', 'canonical_match_id', 'canonical_match_id is not null'],
  },
  {
    tableName: 'season_match_results',
    indexName: 'idx_season_match_results_completed',
    fragments: ['season_id', 'completed_at', 'source_match_id'],
  },
  {
    tableName: 'account_deletion_requests',
    indexName: 'uq_account_deletion_requests_active_user',
    fragments: ['unique index', 'user_id', 'status <>', 'completed'],
  },
  {
    tableName: 'account_deletion_requests',
    indexName: 'idx_account_deletion_requests_principal',
    fragments: ['provider', 'provider_user_id'],
  },
  {
    tableName: 'account_deletion_requests',
    indexName: 'idx_account_deletion_requests_recovery',
    fragments: ['status', 'updated_at'],
  },
  {
    tableName: 'relationship_change_outbox',
    indexName: 'idx_relationship_change_outbox_delivery',
    fragments: ['status', 'next_attempt_at'],
  },
  {
    tableName: 'relationship_change_outbox',
    indexName: 'idx_relationship_change_outbox_created',
    fragments: ['created_at'],
  },
]);

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

function normalizeCatalogText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('"', '')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultMatches(actualDefault, expectedToken) {
  if (expectedToken === null) return actualDefault === null || actualDefault === undefined;
  const normalizeDefault = (value) =>
    normalizeCatalogText(value)
      .replaceAll(' ', '')
      .replace(/::(?:pg_catalog\.)?[a-z0-9_]+(?:\[\])?$/, '');
  return normalizeDefault(actualDefault) === normalizeDefault(expectedToken);
}

function contractMatches(row, contract) {
  return (
    row.present === true &&
    row.udt_name === contract.udtName &&
    row.is_nullable === (contract.nullable ? 'YES' : 'NO') &&
    defaultMatches(row.column_default, contract.defaultToken)
  );
}

function definitionContains(definition, fragments) {
  const normalized = normalizeCatalogText(definition);
  return fragments.every((fragment) => normalized.includes(normalizeCatalogText(fragment)));
}

function constraintMatches(row, contract) {
  return (
    row.table_name === contract.tableName &&
    row.constraint_type === contract.constraintType &&
    (!contract.constraintName || row.constraint_name === contract.constraintName) &&
    definitionContains(row.definition, contract.fragments)
  );
}

function indexMatches(row, contract) {
  return (
    row.table_name === contract.tableName &&
    row.index_name === contract.indexName &&
    definitionContains(row.index_definition, contract.fragments)
  );
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

  const contractTableNames = REQUIRED_RUNTIME_COLUMN_CONTRACTS.map(({ tableName }) => tableName);
  const contractColumnNames = REQUIRED_RUNTIME_COLUMN_CONTRACTS.map(({ columnName }) => columnName);
  const contractCheck = await pool.query(
    `SELECT required.table_name,
            required.column_name,
            columns.udt_name,
            columns.is_nullable,
            columns.column_default,
            columns.column_name IS NOT NULL AS present
       FROM unnest($1::text[], $2::text[]) AS required(table_name, column_name)
       LEFT JOIN information_schema.columns columns
         ON columns.table_schema = 'public'
        AND columns.table_name = required.table_name
        AND columns.column_name = required.column_name`,
    [contractTableNames, contractColumnNames],
  );
  const invalidColumns = REQUIRED_RUNTIME_COLUMN_CONTRACTS.filter((contract) => {
    const row = contractCheck.rows.find(
      (candidate) => candidate.table_name === contract.tableName && candidate.column_name === contract.columnName,
    );
    return !row || !contractMatches(row, contract);
  }).map((contract) => `${contract.tableName}.${contract.columnName}`);
  if (invalidColumns.length > 0) {
    throw new Error(`Runtime column contracts are invalid: ${invalidColumns.join(', ')}`);
  }

  const constraintTableNames = [...new Set(REQUIRED_RUNTIME_CONSTRAINTS.map(({ tableName }) => tableName))];
  const constraintCheck = await pool.query(
    `SELECT tables.relname AS table_name,
            constraints.conname AS constraint_name,
            constraints.contype AS constraint_type,
            pg_get_constraintdef(constraints.oid, true) AS definition
       FROM pg_constraint constraints
       JOIN pg_class tables ON tables.oid = constraints.conrelid
       JOIN pg_namespace namespaces ON namespaces.oid = tables.relnamespace
      WHERE namespaces.nspname = 'public'
        AND tables.relname = ANY($1::text[])`,
    [constraintTableNames],
  );
  const missingConstraints = REQUIRED_RUNTIME_CONSTRAINTS.filter(
    (contract) => !constraintCheck.rows.some((row) => constraintMatches(row, contract)),
  ).map((contract) => `${contract.tableName}:${contract.constraintName || contract.constraintType}`);
  if (missingConstraints.length > 0) {
    throw new Error(`Runtime constraints are missing or invalid: ${missingConstraints.join(', ')}`);
  }

  const indexTableNames = [...new Set(REQUIRED_RUNTIME_INDEXES.map(({ tableName }) => tableName))];
  const indexCheck = await pool.query(
    `SELECT tablename AS table_name,
            indexname AS index_name,
            indexdef AS index_definition
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])`,
    [indexTableNames],
  );
  const missingIndexes = REQUIRED_RUNTIME_INDEXES.filter(
    (contract) => !indexCheck.rows.some((row) => indexMatches(row, contract)),
  ).map((contract) => `${contract.tableName}.${contract.indexName}`);
  if (missingIndexes.length > 0) {
    throw new Error(`Runtime indexes are missing or invalid: ${missingIndexes.join(', ')}`);
  }
  return { expectedMigration: migration, expectedChecksum: checksum };
}

module.exports = {
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
};
