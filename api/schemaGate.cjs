/* global module */

// Production disables runtime DDL. Keep this list aligned with every table
// created by the release migrations so a partial/incorrect migration cannot
// be mistaken for a healthy application database.
const REQUIRED_RUNTIME_TABLES = Object.freeze([
  'schema_migration_checksums',
  'official_card_data_releases',
  'users',
  'user_identities',
  'decks',
  'deck_reservations',
  'matches',
  'cards',
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
  'announcements',
  'announcement_translations',
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
  'account_export_jobs',
  'account_export_audit',
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
  official_card_data_releases: [
    'dataset_sha256',
    'extraction_sha256',
    'errata_sha256',
    'review_provenance_sha256',
    'release_sha',
    'card_count',
    'errata_count',
    'applied_at',
  ],
  users: ['id', 'auth_version', 'deleted_at', 'identity_anonymized_at'],
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
  card_texts_i18n: [
    'card_id',
    'lang',
    'name_text',
    'effect_text',
    'name_source',
    'effect_source',
    'review_status',
    'review_note',
    'updated_at',
  ],
  card_official_errata: [
    'errata_id',
    'card_id',
    'published_at',
    'affects_name',
    'affects_effect',
    'incorrect_text',
    'corrected_english_status',
    'corrected_english_source',
    'source_url',
    'updated_at',
  ],
  game_config: ['key', 'value'],
  preset_decks: ['id', 'card_ids'],
  admin_audit_log: [
    'id',
    'admin_user_id',
    'action',
    'target_type',
    'target_id',
    'details',
    'created_at',
    'identity_anonymized_at',
  ],
  feedback_posts: ['id', 'title', 'description', 'status', 'created_at'],
  feedback_votes: ['post_id', 'created_at'],
  feedback_comments: ['id', 'post_id', 'content', 'created_at'],
  feedback_comment_votes: ['comment_id', 'created_at'],
  feedback_tags: ['id', 'name', 'color', 'created_at'],
  feedback_comment_reactions: ['comment_id', 'emoji', 'created_at'],
  feedback_attachments: ['id', 'file_name', 'content_type', 'file_size', 'created_at'],
  announcements: ['id', 'title', 'content', 'source_language', 'status', 'content_version', 'published_at'],
  announcement_translations: [
    'announcement_id',
    'content_version',
    'target_language',
    'translated_title',
    'translated_content',
    'status',
  ],
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
    'winner_user_id',
    'loser_user_id',
    'completed_at',
    'rules_version',
    'winner_rating_before',
    'winner_rating_after',
    'loser_rating_before',
    'loser_rating_after',
    'applied_at',
    'identity_anonymized_at',
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
    'identity_anonymized_at',
  ],
  account_export_jobs: [
    'id',
    'user_id',
    'status',
    'format_version',
    'object_key',
    'object_version_id',
    'content_sha256',
    'size_bytes',
    'uncompressed_size_bytes',
    'attempt_count',
    'max_attempts',
    'available_at',
    'locked_at',
    'lease_token',
    'lease_expires_at',
    'error_code',
    'last_error',
    'purge_attempt_count',
    'purge_available_at',
    'requested_at',
    'snapshot_at',
    'started_at',
    'completed_at',
    'expires_at',
    'downloaded_at',
    'download_count',
    'purged_at',
    'updated_at',
    'identity_anonymized_at',
  ],
  account_export_audit: [
    'id',
    'job_id',
    'user_id',
    'event_type',
    'request_id',
    'details',
    'created_at',
    'identity_anonymized_at',
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
    'identities_redacted_at',
  ],
  admin_users: [
    'id',
    'user_id',
    'username',
    'password_hash',
    'salt',
    'role',
    'totp_secret_ciphertext',
    'updated_at',
    'disabled_at',
  ],
  admin_sessions: ['jti', 'admin_user_id', 'role', 'expires_at', 'created_at', 'revoked_at', 'last_seen_at'],
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

// The game process runs under a least-privilege PostgreSQL role. Keep this
// contract limited to the tables and columns touched by PostgresAdapter and
// its account/deck mutation dependencies; information_schema intentionally
// hides API-only columns from that role.
const REQUIRED_BOARDGAME_RUNTIME_TABLES = Object.freeze([
  'users',
  'deck_reservations',
  'bjg_matches',
  'bjg_match_seats',
  'bjg_match_result_outbox',
]);

const REQUIRED_BOARDGAME_RUNTIME_COLUMNS = Object.freeze({
  users: ['id', 'deleted_at', 'elo', 'match_count', 'wins'],
  deck_reservations: [
    'id',
    'user_id',
    'deck_version',
    'rules_version',
    'card_ids',
    'expires_at',
    'match_id',
    'player_id',
    'consumed_at',
  ],
  bjg_matches: ['match_id', 'state', 'initial_state', 'metadata', 'log', 'updated_at'],
  bjg_match_seats: [
    'match_id',
    'player_id',
    'user_id',
    'ranked_eligible',
    'credential_hash',
    'reserved_at',
    'last_resumed_at',
  ],
  bjg_match_result_outbox: [
    'source_match_id',
    'player0_user_id',
    'player1_user_id',
    'winner_player',
    'winner_user_id',
    'loser_user_id',
    'ranked_eligible',
    'turns',
    'duration_seconds',
    'completed_at',
    'rules_version',
    'action_log',
    'state_id',
    'status',
    'attempt_count',
    'next_attempt_at',
    'locked_at',
    'last_error',
    'delivered_match_id',
    'created_at',
    'updated_at',
    'delivered_at',
  ],
});

const REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS = Object.freeze([
  { tableName: 'users', columnName: 'id', udtName: 'text', nullable: false, defaultToken: null },
  { tableName: 'users', columnName: 'deleted_at', udtName: 'timestamptz', nullable: true, defaultToken: null },
  { tableName: 'users', columnName: 'elo', udtName: 'int4', nullable: false, defaultToken: '1000' },
  { tableName: 'users', columnName: 'match_count', udtName: 'int4', nullable: false, defaultToken: '0' },
  { tableName: 'users', columnName: 'wins', udtName: 'int4', nullable: false, defaultToken: '0' },
  {
    tableName: 'deck_reservations',
    columnName: 'card_ids',
    udtName: 'jsonb',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'deck_reservations',
    columnName: 'expires_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'deck_reservations',
    columnName: 'match_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'deck_reservations',
    columnName: 'player_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'deck_reservations',
    columnName: 'consumed_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'bjg_matches',
    columnName: 'state',
    udtName: 'jsonb',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'bjg_matches',
    columnName: 'initial_state',
    udtName: 'jsonb',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'bjg_matches',
    columnName: 'metadata',
    udtName: 'jsonb',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'bjg_matches',
    columnName: 'log',
    udtName: 'jsonb',
    nullable: false,
    defaultToken: "'[]'::jsonb",
  },
  {
    tableName: 'bjg_matches',
    columnName: 'updated_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'bjg_match_seats',
    columnName: 'ranked_eligible',
    udtName: 'bool',
    nullable: false,
    defaultToken: 'false',
  },
  {
    tableName: 'bjg_match_seats',
    columnName: 'reserved_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'bjg_match_seats',
    columnName: 'last_resumed_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'winner_player',
    udtName: 'int2',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'ranked_eligible',
    udtName: 'bool',
    nullable: false,
    defaultToken: 'false',
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'turns',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'duration_seconds',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'completed_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'rules_version',
    udtName: 'text',
    nullable: false,
    defaultToken: "'legacy'",
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'action_log',
    udtName: 'jsonb',
    nullable: false,
    defaultToken: "'[]'::jsonb",
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'pending'",
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'attempt_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'bjg_match_result_outbox',
    columnName: 'next_attempt_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
]);

// Catalog-level contracts for the fields whose shape is security or data-
// integrity critical. `udtName` uses PostgreSQL's stable internal names
// (for example `timestamptz` and `int4`) instead of localized display text.
const REQUIRED_RUNTIME_COLUMN_CONTRACTS = Object.freeze([
  {
    tableName: 'users',
    columnName: 'identity_anonymized_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'dataset_sha256',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'extraction_sha256',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'errata_sha256',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'review_provenance_sha256',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'release_sha',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'card_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'errata_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'official_card_data_releases',
    columnName: 'applied_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'admin_audit_log',
    columnName: 'details',
    udtName: 'jsonb',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'admin_audit_log',
    columnName: 'created_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'admin_audit_log',
    columnName: 'identity_anonymized_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'admin_users',
    columnName: 'user_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'admin_users',
    columnName: 'password_hash',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  { tableName: 'admin_users', columnName: 'salt', udtName: 'text', nullable: true, defaultToken: null },
  {
    tableName: 'admin_users',
    columnName: 'totp_secret_ciphertext',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'admin_users',
    columnName: 'updated_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'admin_sessions',
    columnName: 'expires_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'admin_sessions',
    columnName: 'revoked_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'cards',
    columnName: 'en_name_official',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'cards',
    columnName: 'en_effect_official',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'card_id',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'lang',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'name_text',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'effect_text',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'name_source',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'effect_source',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'review_status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'pending_review'",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'review_note',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_texts_i18n',
    columnName: 'updated_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'card_official_errata',
    columnName: 'errata_id',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_official_errata',
    columnName: 'card_id',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_official_errata',
    columnName: 'published_at',
    udtName: 'date',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_official_errata',
    columnName: 'affects_name',
    udtName: 'bool',
    nullable: false,
    defaultToken: 'false',
  },
  {
    tableName: 'card_official_errata',
    columnName: 'affects_effect',
    udtName: 'bool',
    nullable: false,
    defaultToken: 'false',
  },
  {
    tableName: 'card_official_errata',
    columnName: 'incorrect_text',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'card_official_errata',
    columnName: 'corrected_english_status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'pending_review'",
  },
  {
    tableName: 'card_official_errata',
    columnName: 'corrected_english_source',
    udtName: 'text',
    nullable: false,
    defaultToken: "'official_japanese_errata_translation'",
  },
  {
    tableName: 'card_official_errata',
    columnName: 'source_url',
    udtName: 'text',
    nullable: false,
    defaultToken: null,
  },
  {
    tableName: 'card_official_errata',
    columnName: 'updated_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
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
    tableName: 'season_match_results',
    columnName: 'winner_user_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'season_match_results',
    columnName: 'loser_user_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
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
    tableName: 'season_match_results',
    columnName: 'identity_anonymized_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
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
    columnName: 'identity_anonymized_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'user_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
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
    tableName: 'account_export_jobs',
    columnName: 'status',
    udtName: 'text',
    nullable: false,
    defaultToken: "'queued'",
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'format_version',
    udtName: 'int2',
    nullable: false,
    defaultToken: '1',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'attempt_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'max_attempts',
    udtName: 'int4',
    nullable: false,
    defaultToken: '5',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'available_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'error_code',
    udtName: 'text',
    nullable: false,
    defaultToken: "''",
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'purge_attempt_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'purge_available_at',
    udtName: 'timestamptz',
    nullable: false,
    defaultToken: 'now()',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'download_count',
    udtName: 'int4',
    nullable: false,
    defaultToken: '0',
  },
  {
    tableName: 'account_export_jobs',
    columnName: 'identity_anonymized_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'account_export_audit',
    columnName: 'user_id',
    udtName: 'text',
    nullable: true,
    defaultToken: null,
  },
  {
    tableName: 'account_export_audit',
    columnName: 'details',
    udtName: 'jsonb',
    nullable: false,
    defaultToken: "'{}'::jsonb",
  },
  {
    tableName: 'account_export_audit',
    columnName: 'identity_anonymized_at',
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
  {
    tableName: 'relationship_change_outbox',
    columnName: 'identities_redacted_at',
    udtName: 'timestamptz',
    nullable: true,
    defaultToken: null,
  },
]);

// These contracts cover the invariants that cannot be represented by a
// column-presence check. Definitions are matched against pg_get_constraintdef
// / pg_indexes output after identifier and whitespace normalization.
const REQUIRED_RUNTIME_CONSTRAINTS = Object.freeze([
  {
    tableName: 'official_card_data_releases',
    constraintType: 'p',
    fragments: ['primary key (dataset_sha256)'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['dataset_sha256', '^[a-f0-9]{64}$'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['extraction_sha256', '^[a-f0-9]{64}$'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['errata_sha256', '^[a-f0-9]{64}$'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['review_provenance_sha256', '^[a-f0-9]{64}$'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['release_sha', '^[a-f0-9]{40}$'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['card_count > 0'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['errata_count >= 0'],
  },
  {
    tableName: 'official_card_data_releases',
    constraintType: 'c',
    fragments: ['errata_count <= card_count'],
  },
  { tableName: 'admin_users', constraintType: 'p', fragments: ['primary key (id)'] },
  { tableName: 'admin_users', constraintType: 'u', fragments: ['unique (username)'] },
  {
    tableName: 'admin_users',
    constraintType: 'f',
    fragments: ['foreign key (user_id)', 'references users(id)', 'on delete cascade'],
  },
  {
    tableName: 'admin_users',
    constraintName: 'admin_users_auth_mode_check',
    constraintType: 'c',
    fragments: ['user_id is null', 'password_hash is not null', 'salt is not null', 'user_id is not null'],
  },
  {
    tableName: 'admin_users',
    constraintType: 'c',
    fragments: ['role', 'viewer', 'moderator', 'operator', 'admin'],
  },
  { tableName: 'admin_sessions', constraintType: 'p', fragments: ['primary key (jti)'] },
  {
    tableName: 'admin_sessions',
    constraintType: 'f',
    fragments: ['foreign key (admin_user_id)', 'references admin_users(id)', 'on delete cascade'],
  },
  { tableName: 'card_texts_i18n', constraintType: 'p', fragments: ['primary key (card_id, lang)'] },
  {
    tableName: 'card_texts_i18n',
    constraintType: 'f',
    fragments: ['foreign key (card_id)', 'references cards(id)', 'on delete cascade'],
  },
  {
    tableName: 'card_texts_i18n',
    constraintType: 'c',
    fragments: ['review_status', 'official', 'verified', 'pending_review'],
  },
  { tableName: 'card_official_errata', constraintType: 'p', fragments: ['primary key (errata_id)'] },
  { tableName: 'card_official_errata', constraintType: 'u', fragments: ['unique (card_id)'] },
  {
    tableName: 'card_official_errata',
    constraintType: 'f',
    fragments: ['foreign key (card_id)', 'references cards(id)', 'on delete cascade'],
  },
  {
    tableName: 'card_official_errata',
    constraintType: 'c',
    fragments: ['affects_name OR affects_effect'],
  },
  {
    tableName: 'card_official_errata',
    constraintType: 'c',
    fragments: ['corrected_english_status', 'official', 'verified', 'pending_review'],
  },
  {
    tableName: 'card_official_errata',
    constraintName: 'card_official_errata_english_source_check',
    constraintType: 'c',
    fragments: [
      'corrected_english_source',
      'official_errata_notice',
      'official_card_print_unaffected',
      'official_card_print_corrected',
      'official_japanese_errata_translation',
    ],
  },
  {
    tableName: 'card_texts_i18n',
    constraintName: 'card_texts_i18n_derived_lang_check',
    constraintType: 'c',
    fragments: [],
  },
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
  { tableName: 'account_export_jobs', constraintType: 'p', fragments: ['primary key (id)'] },
  {
    tableName: 'account_export_jobs',
    constraintType: 'f',
    fragments: ['foreign key (user_id)', 'references users(id)', 'on delete set null'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['queued', 'processing', 'ready', 'failed', 'expired'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['lease_token is not null', 'lease_expires_at is not null'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['object_key is not null', 'content_sha256 is not null', 'expires_at is not null'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['attempt_count >= 0'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['attempt_count <= max_attempts'],
  },
  {
    tableName: 'account_export_jobs',
    constraintType: 'c',
    fragments: ['purge_attempt_count >= 0'],
  },
  { tableName: 'account_export_audit', constraintType: 'p', fragments: ['primary key (id)'] },
  {
    tableName: 'account_export_audit',
    constraintType: 'f',
    fragments: ['foreign key (job_id)', 'references account_export_jobs(id)'],
  },
  {
    tableName: 'account_export_audit',
    constraintType: 'c',
    fragments: [
      'requested',
      'processing',
      'ready',
      'retry_scheduled',
      'failed',
      'download_started',
      'download_completed',
      'download_interrupted',
      'integrity_failed',
      'expired',
      'purged',
      'purge_retry',
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

const REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS = Object.freeze([
  { tableName: 'users', constraintType: 'p', fragments: ['primary key (id)'] },
  { tableName: 'deck_reservations', constraintType: 'p', fragments: ['primary key (id)'] },
  {
    tableName: 'deck_reservations',
    constraintType: 'f',
    fragments: ['foreign key (user_id)', 'references users(id)', 'on delete cascade'],
  },
  {
    tableName: 'deck_reservations',
    constraintType: 'c',
    fragments: ['player_id is null', 'player_id', "'0'", "'1'"],
  },
  { tableName: 'bjg_matches', constraintType: 'p', fragments: ['primary key (match_id)'] },
  { tableName: 'bjg_match_seats', constraintType: 'p', fragments: ['primary key (match_id, player_id)'] },
  { tableName: 'bjg_match_seats', constraintType: 'u', fragments: ['unique (match_id, user_id)'] },
  {
    tableName: 'bjg_match_seats',
    constraintType: 'f',
    fragments: ['foreign key (match_id)', 'references bjg_matches(match_id)', 'on delete cascade'],
  },
  {
    tableName: 'bjg_match_seats',
    constraintType: 'c',
    fragments: ['player_id', "'0'", "'1'"],
  },
  {
    tableName: 'bjg_match_result_outbox',
    constraintType: 'p',
    fragments: ['primary key (source_match_id)'],
  },
  {
    tableName: 'bjg_match_result_outbox',
    constraintType: 'f',
    fragments: ['foreign key (source_match_id)', 'references bjg_matches(match_id)', 'on delete cascade'],
  },
  {
    tableName: 'bjg_match_result_outbox',
    constraintType: 'c',
    fragments: ['status', 'pending', 'processing', 'delivered', 'unrated'],
  },
  {
    tableName: 'bjg_match_result_outbox',
    constraintType: 'c',
    fragments: ['winner_player is null', 'winner_player', '0', '1'],
  },
]);

const REQUIRED_RUNTIME_INDEXES = Object.freeze([
  {
    tableName: 'admin_users',
    indexName: 'uq_admin_users_user_id',
    fragments: ['unique index', '(user_id)'],
  },
  {
    tableName: 'users',
    indexName: 'idx_users_deleted_identity_pending',
    fragments: ['(deleted_at)', 'deleted_at is not null', 'identity_anonymized_at is null'],
  },
  {
    tableName: 'card_texts_i18n',
    indexName: 'idx_card_texts_i18n_lang_review',
    fragments: ['(lang, review_status)'],
  },
  {
    tableName: 'cards',
    indexName: 'idx_cards_has_official_errata',
    fragments: ['(has_official_errata)'],
  },
  {
    tableName: 'admin_audit_log',
    indexName: 'idx_admin_audit_log_target_id',
    fragments: ['target_id', 'target_id is not null'],
  },
  {
    tableName: 'admin_sessions',
    indexName: 'idx_admin_sessions_user_expiry',
    fragments: ['admin_user_id', 'expires_at'],
  },
  {
    tableName: 'matches',
    indexName: 'idx_matches_action_log_retention',
    fragments: ['action_log_purged_at', 'completed_at', 'action_log_purged_at is null'],
  },
  {
    tableName: 'season_match_results',
    indexName: 'idx_season_match_results_winner_user',
    fragments: ['winner_user_id', 'winner_user_id is not null'],
  },
  {
    tableName: 'season_match_results',
    indexName: 'idx_season_match_results_loser_user',
    fragments: ['loser_user_id', 'loser_user_id is not null'],
  },
  {
    tableName: 'account_deletion_requests',
    indexName: 'idx_account_deletion_requests_user_all',
    fragments: ['user_id'],
  },
  {
    tableName: 'relationship_change_outbox',
    indexName: 'idx_relationship_change_outbox_user_ids',
    fragments: ['using gin (user_ids)'],
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
    tableName: 'account_export_jobs',
    indexName: 'uq_account_export_jobs_active_user',
    fragments: ['unique index', 'user_id', 'queued', 'processing'],
  },
  {
    tableName: 'account_export_jobs',
    indexName: 'idx_account_export_jobs_delivery',
    fragments: ['status', 'available_at', 'lease_expires_at'],
  },
  {
    tableName: 'account_export_jobs',
    indexName: 'idx_account_export_jobs_user_requested',
    fragments: ['user_id', 'requested_at desc'],
  },
  {
    tableName: 'account_export_jobs',
    indexName: 'idx_account_export_jobs_expiry',
    fragments: ['expires_at', "status = 'ready'"],
  },
  {
    tableName: 'account_export_jobs',
    indexName: 'idx_account_export_jobs_purge',
    fragments: ['purge_available_at', 'expires_at', 'object_key is not null'],
  },
  {
    tableName: 'account_export_jobs',
    indexName: 'idx_account_export_jobs_retention',
    fragments: ['updated_at', 'failed', 'expired', 'object_key is null', 'object_version_id is null'],
  },
  {
    tableName: 'account_export_audit',
    indexName: 'idx_account_export_audit_job_created',
    fragments: ['job_id', 'created_at'],
  },
  {
    tableName: 'account_export_audit',
    indexName: 'idx_account_export_audit_user_created',
    fragments: ['user_id', 'created_at'],
  },
  {
    tableName: 'account_export_audit',
    indexName: 'idx_account_export_audit_retention',
    fragments: ['created_at'],
  },
  {
    tableName: 'account_export_audit',
    indexName: 'uq_account_export_audit_request_event',
    fragments: ['unique index', 'job_id', 'request_id', 'event_type', 'request_id is not null'],
  },
  {
    tableName: 'account_export_audit',
    indexName: 'uq_account_export_audit_request_terminal',
    fragments: [
      'unique index',
      'job_id',
      'request_id',
      'download_completed',
      'download_interrupted',
      'integrity_failed',
    ],
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

const REQUIRED_BOARDGAME_RUNTIME_INDEXES = Object.freeze([
  {
    tableName: 'deck_reservations',
    indexName: 'uq_deck_reservations_match_seat',
    fragments: ['unique index', 'match_id', 'player_id', 'match_id is not null', 'player_id is not null'],
  },
  {
    tableName: 'bjg_matches',
    indexName: 'idx_bjg_matches_updated_at',
    fragments: ['updated_at'],
  },
  {
    tableName: 'bjg_matches',
    indexName: 'idx_bjg_matches_game_name',
    fragments: ["metadata ->> 'gamename'"],
  },
  {
    tableName: 'bjg_match_seats',
    indexName: 'idx_bjg_match_seats_user',
    fragments: ['user_id', 'reserved_at desc'],
  },
  {
    tableName: 'bjg_match_result_outbox',
    indexName: 'idx_bjg_match_result_outbox_delivery',
    fragments: ['status', 'next_attempt_at'],
  },
  {
    tableName: 'bjg_match_result_outbox',
    indexName: 'idx_match_result_outbox_season_settlement',
    fragments: ['rules_version', 'completed_at', 'status', 'ranked_eligible = true'],
  },
]);

// Platform runs under its own least-privilege role in production. Its startup
// gate must prove every relation it actually reads/writes without requiring
// API-only catalog visibility that the role is intentionally denied.
const REQUIRED_PLATFORM_RUNTIME_TABLES = Object.freeze([
  'schema_migration_checksums',
  'official_card_data_releases',
  'users',
  'user_friends',
  'user_blocks',
  'platform_match_participants',
  'platform_room_participants',
  'chat_conversations',
  'chat_messages',
  'bjg_matches',
]);

const REQUIRED_PLATFORM_RUNTIME_COLUMNS = Object.freeze({
  official_card_data_releases: REQUIRED_RUNTIME_COLUMNS.official_card_data_releases,
  users: ['id', 'auth_version', 'deleted_at', 'identity_anonymized_at'],
  user_friends: REQUIRED_RUNTIME_COLUMNS.user_friends,
  user_blocks: REQUIRED_RUNTIME_COLUMNS.user_blocks,
  platform_match_participants: REQUIRED_RUNTIME_COLUMNS.platform_match_participants,
  platform_room_participants: REQUIRED_RUNTIME_COLUMNS.platform_room_participants,
  chat_conversations: REQUIRED_RUNTIME_COLUMNS.chat_conversations,
  chat_messages: REQUIRED_RUNTIME_COLUMNS.chat_messages,
  bjg_matches: REQUIRED_RUNTIME_COLUMNS.bjg_matches,
});

const PLATFORM_RUNTIME_TABLE_SET = new Set(REQUIRED_PLATFORM_RUNTIME_TABLES);
const PLATFORM_RUNTIME_COLUMN_SET = new Set(
  Object.entries(REQUIRED_PLATFORM_RUNTIME_COLUMNS).flatMap(([tableName, columns]) =>
    columns.map((columnName) => `${tableName}.${columnName}`),
  ),
);
const REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS = Object.freeze(
  [...REQUIRED_RUNTIME_COLUMN_CONTRACTS, ...REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS].filter(
    ({ tableName, columnName }) => PLATFORM_RUNTIME_COLUMN_SET.has(`${tableName}.${columnName}`),
  ),
);
const REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS = Object.freeze(
  [...REQUIRED_RUNTIME_CONSTRAINTS, ...REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS].filter(({ tableName }) =>
    PLATFORM_RUNTIME_TABLE_SET.has(tableName),
  ),
);
const REQUIRED_PLATFORM_RUNTIME_INDEXES = Object.freeze(
  [...REQUIRED_RUNTIME_INDEXES, ...REQUIRED_BOARDGAME_RUNTIME_INDEXES].filter(({ tableName }) =>
    PLATFORM_RUNTIME_TABLE_SET.has(tableName),
  ),
);

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

async function assertExpectedMigration({ pool, expectedMigration, expectedChecksum }) {
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

  return { expectedMigration: migration, expectedChecksum: checksum };
}

async function assertSchemaContracts({
  pool,
  requiredTables,
  requiredColumns,
  requiredColumnContracts,
  requiredConstraints,
  requiredIndexes,
}) {
  const tableCheck = await pool.query(
    `SELECT required.table_name,
            to_regclass('public.' || required.table_name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS required(table_name)`,
    [requiredTables],
  );
  const missing = tableCheck.rows.filter((row) => row.present !== true).map((row) => row.table_name);
  if (missing.length > 0) throw new Error(`Required runtime tables are missing: ${missing.join(', ')}`);

  const requiredTableNames = [];
  const requiredColumnNames = [];
  for (const [tableName, columns] of Object.entries(requiredColumns)) {
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

  const contractTableNames = requiredColumnContracts.map(({ tableName }) => tableName);
  const contractColumnNames = requiredColumnContracts.map(({ columnName }) => columnName);
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
  const invalidColumns = requiredColumnContracts
    .filter((contract) => {
      const row = contractCheck.rows.find(
        (candidate) => candidate.table_name === contract.tableName && candidate.column_name === contract.columnName,
      );
      return !row || !contractMatches(row, contract);
    })
    .map((contract) => `${contract.tableName}.${contract.columnName}`);
  if (invalidColumns.length > 0) {
    throw new Error(`Runtime column contracts are invalid: ${invalidColumns.join(', ')}`);
  }

  const constraintTableNames = [...new Set(requiredConstraints.map(({ tableName }) => tableName))];
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
  const missingConstraints = requiredConstraints
    .filter((contract) => !constraintCheck.rows.some((row) => constraintMatches(row, contract)))
    .map((contract) => `${contract.tableName}:${contract.constraintName || contract.constraintType}`);
  if (missingConstraints.length > 0) {
    throw new Error(`Runtime constraints are missing or invalid: ${missingConstraints.join(', ')}`);
  }

  const indexTableNames = [...new Set(requiredIndexes.map(({ tableName }) => tableName))];
  const indexCheck = await pool.query(
    `SELECT tablename AS table_name,
            indexname AS index_name,
            indexdef AS index_definition
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])`,
    [indexTableNames],
  );
  const missingIndexes = requiredIndexes
    .filter((contract) => !indexCheck.rows.some((row) => indexMatches(row, contract)))
    .map((contract) => `${contract.tableName}.${contract.indexName}`);
  if (missingIndexes.length > 0) {
    throw new Error(`Runtime indexes are missing or invalid: ${missingIndexes.join(', ')}`);
  }
}

async function assertRuntimeSchema({ pool, expectedMigration, expectedChecksum }) {
  const expected = await assertExpectedMigration({ pool, expectedMigration, expectedChecksum });
  await assertSchemaContracts({
    pool,
    requiredTables: REQUIRED_RUNTIME_TABLES,
    requiredColumns: REQUIRED_RUNTIME_COLUMNS,
    requiredColumnContracts: REQUIRED_RUNTIME_COLUMN_CONTRACTS,
    requiredConstraints: REQUIRED_RUNTIME_CONSTRAINTS,
    requiredIndexes: REQUIRED_RUNTIME_INDEXES,
  });
  await assertNoPendingLegacyTombstones(pool);
  return expected;
}

async function assertNoPendingLegacyTombstones(pool) {
  const pendingLegacyTombstones = await pool.query(
    `SELECT COUNT(*) AS pending_count
       FROM users
      WHERE deleted_at IS NOT NULL
        AND identity_anonymized_at IS NULL`,
  );
  const pendingCount = Number(pendingLegacyTombstones.rows[0]?.pending_count);
  if (!Number.isSafeInteger(pendingCount) || pendingCount !== 0) {
    throw new Error(
      `Runtime schema contains ${Number.isSafeInteger(pendingCount) ? pendingCount : 'an unknown number of'} legacy deleted accounts pending identity anonymization`,
    );
  }
}

async function assertBoardgameRuntimeSchema({ pool, expectedMigration, expectedChecksum }) {
  const expected = await assertExpectedMigration({ pool, expectedMigration, expectedChecksum });
  await assertSchemaContracts({
    pool,
    requiredTables: REQUIRED_BOARDGAME_RUNTIME_TABLES,
    requiredColumns: REQUIRED_BOARDGAME_RUNTIME_COLUMNS,
    requiredColumnContracts: REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS,
    requiredConstraints: REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS,
    requiredIndexes: REQUIRED_BOARDGAME_RUNTIME_INDEXES,
  });
  return expected;
}

async function assertPlatformRuntimeSchema({ pool, expectedMigration, expectedChecksum }) {
  const expected = await assertExpectedMigration({ pool, expectedMigration, expectedChecksum });
  await assertSchemaContracts({
    pool,
    requiredTables: REQUIRED_PLATFORM_RUNTIME_TABLES,
    requiredColumns: REQUIRED_PLATFORM_RUNTIME_COLUMNS,
    requiredColumnContracts: REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS,
    requiredConstraints: REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS,
    requiredIndexes: REQUIRED_PLATFORM_RUNTIME_INDEXES,
  });
  await assertNoPendingLegacyTombstones(pool);
  return expected;
}

module.exports = {
  REQUIRED_BOARDGAME_RUNTIME_TABLES,
  REQUIRED_BOARDGAME_RUNTIME_COLUMNS,
  REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS,
  REQUIRED_BOARDGAME_RUNTIME_INDEXES,
  REQUIRED_PLATFORM_RUNTIME_TABLES,
  REQUIRED_PLATFORM_RUNTIME_COLUMNS,
  REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS,
  REQUIRED_PLATFORM_RUNTIME_INDEXES,
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
  assertBoardgameRuntimeSchema,
  assertPlatformRuntimeSchema,
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
};
