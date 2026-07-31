/** Persist de-identified terminal match facts, deck snapshots, and allowlisted events. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumn('bjg_match_seats', {
    resume_count: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('bjg_match_seats', 'bjg_match_seats_resume_count_check', {
    check: 'resume_count >= 0',
  });
  pgm.createTable('bjg_match_telemetry', {
    source_match_id: {
      type: 'text',
      primaryKey: true,
      references: 'bjg_matches(match_id)',
      onDelete: 'CASCADE',
    },
    match_mode: { type: 'text', notNull: true, default: 'direct' },
    traffic_class: { type: 'text', notNull: true, default: 'unknown' },
    player0_disconnect_count: { type: 'integer', notNull: true, default: 0 },
    player1_disconnect_count: { type: 'integer', notNull: true, default: 0 },
    player0_reconnect_count: { type: 'integer', notNull: true, default: 0 },
    player1_reconnect_count: { type: 'integer', notNull: true, default: 0 },
    observed_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('bjg_match_telemetry', 'bjg_match_telemetry_classification_check', {
    check:
      "match_mode IN ('quick_match', 'custom_room', 'invite', 'direct', 'unknown') " +
      "AND traffic_class IN ('production', 'operator', 'synthetic', 'ai', 'unknown')",
  });
  pgm.addConstraint('bjg_match_telemetry', 'bjg_match_telemetry_counts_check', {
    check:
      'player0_disconnect_count >= 0 AND player1_disconnect_count >= 0 ' +
      'AND player0_reconnect_count >= 0 AND player1_reconnect_count >= 0',
  });
  pgm.createIndex('bjg_match_telemetry', ['match_mode', 'traffic_class', 'updated_at'], {
    name: 'idx_bjg_match_telemetry_classification',
  });

  pgm.createTable('match_analytics', {
    source_match_digest: { type: 'text', primaryKey: true },
    environment: { type: 'text', notNull: true },
    traffic_class: { type: 'text', notNull: true },
    match_mode: { type: 'text', notNull: true, default: 'direct' },
    rating_mode: { type: 'text', notNull: true },
    unrated_reason: { type: 'text' },
    app_version: { type: 'text', notNull: true },
    build_id: { type: 'text', notNull: true },
    rules_version: { type: 'text', notNull: true },
    dataset_sha256: { type: 'text', notNull: true, default: 'unknown' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz', notNull: true },
    duration_seconds: { type: 'integer', notNull: true },
    turns: { type: 'integer', notNull: true },
    outcome: { type: 'text', notNull: true },
    winner_seat: { type: 'smallint' },
    janken_winner_seat: { type: 'smallint' },
    gameover_reason_code: { type: 'text', notNull: true },
    final_hp: { type: 'integer[]', notNull: true },
    seat_classes: { type: 'text[]', notNull: true },
    quality_flags: { type: 'text[]', notNull: true, default: '{}' },
    action_count: { type: 'integer', notNull: true },
    timeout_count: { type: 'integer', notNull: true },
    disconnect_counts: { type: 'integer[]', notNull: true, default: '{0,0}' },
    reconnect_counts: { type: 'integer[]', notNull: true, default: '{0,0}' },
    seat_resume_counts: { type: 'integer[]', notNull: true, default: '{0,0}' },
    deck_count: { type: 'smallint', notNull: true },
    event_count: { type: 'integer', notNull: true },
    capture_schema_version: { type: 'smallint', notNull: true, default: 1 },
    integrity_sha256: { type: 'text', notNull: true },
    captured_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('match_analytics', 'match_analytics_digest_check', {
    check: "source_match_digest ~ '^[0-9a-f]{64}$' AND integrity_sha256 ~ '^[0-9a-f]{64}$'",
  });
  pgm.addConstraint('match_analytics', 'match_analytics_classification_check', {
    check:
      "environment IN ('production', 'staging', 'development', 'test', 'unknown') " +
      "AND traffic_class IN ('production', 'operator', 'synthetic', 'ai', 'unknown') " +
      "AND match_mode IN ('quick_match', 'custom_room', 'invite', 'direct', 'unknown') " +
      "AND rating_mode IN ('ranked', 'unrated') " +
      "AND outcome IN ('completed', 'draw', 'surrendered', 'abandoned')",
  });
  pgm.addConstraint('match_analytics', 'match_analytics_seats_check', {
    check:
      '(winner_seat IS NULL OR winner_seat IN (0, 1)) ' +
      'AND (janken_winner_seat IS NULL OR janken_winner_seat IN (0, 1)) ' +
      'AND cardinality(final_hp) = 2 AND cardinality(seat_classes) = 2 ' +
      'AND cardinality(disconnect_counts) = 2 AND cardinality(reconnect_counts) = 2 ' +
      'AND cardinality(seat_resume_counts) = 2 ' +
      'AND disconnect_counts[1] >= 0 AND disconnect_counts[2] >= 0 ' +
      'AND reconnect_counts[1] >= 0 AND reconnect_counts[2] >= 0 ' +
      'AND seat_resume_counts[1] >= 0 AND seat_resume_counts[2] >= 0',
  });
  pgm.addConstraint('match_analytics', 'match_analytics_counts_check', {
    check:
      'duration_seconds >= 0 AND turns >= 0 AND action_count >= 0 AND timeout_count >= 0 ' +
      'AND deck_count = 2 AND event_count >= 0 AND capture_schema_version = 1',
  });

  pgm.createTable('match_analytics_decks', {
    source_match_digest: {
      type: 'text',
      notNull: true,
      references: 'match_analytics(source_match_digest)',
      onDelete: 'RESTRICT',
    },
    seat: { type: 'smallint', notNull: true },
    card_ids: { type: 'text[]', notNull: true },
    deck_hash: { type: 'text', notNull: true },
    deck_source: { type: 'text', notNull: true },
    deck_validation: { type: 'text', notNull: true },
  });
  pgm.addConstraint('match_analytics_decks', 'match_analytics_decks_pkey', {
    primaryKey: ['source_match_digest', 'seat'],
  });
  pgm.addConstraint('match_analytics_decks', 'match_analytics_decks_content_check', {
    check:
      "seat IN (0, 1) AND cardinality(card_ids) = 20 AND deck_hash ~ '^[0-9a-f]{64}$' " +
      "AND deck_source IN ('registered', 'guest', 'unknown') AND deck_validation = 'valid'",
  });

  pgm.createTable('match_analytics_events', {
    source_match_digest: {
      type: 'text',
      notNull: true,
      references: 'match_analytics(source_match_digest)',
      onDelete: 'RESTRICT',
    },
    sequence: { type: 'integer', notNull: true },
    turn: { type: 'integer', notNull: true },
    step: { type: 'text', notNull: true },
    actor_seat: { type: 'smallint' },
    event_type: { type: 'text', notNull: true },
    card_def_id: { type: 'text' },
    target_seat: { type: 'smallint' },
    hp_before: { type: 'integer' },
    hp_after: { type: 'integer' },
    chronos_position: { type: 'integer' },
    result_code: { type: 'text' },
    timeout_phase: { type: 'text' },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.addConstraint('match_analytics_events', 'match_analytics_events_pkey', {
    primaryKey: ['source_match_digest', 'sequence'],
  });
  pgm.addConstraint('match_analytics_events', 'match_analytics_events_bounds_check', {
    check:
      'sequence >= 0 AND turn >= 0 ' +
      'AND (actor_seat IS NULL OR actor_seat IN (0, 1)) ' +
      'AND (target_seat IS NULL OR target_seat IN (0, 1))',
  });

  pgm.createIndex('match_analytics', [{ name: 'completed_at', sort: 'DESC' }], {
    name: 'idx_match_analytics_completed_at',
  });
  pgm.createIndex('match_analytics', ['rules_version', 'dataset_sha256', 'completed_at'], {
    name: 'idx_match_analytics_version_analysis',
  });
  pgm.createIndex('match_analytics_events', ['event_type', 'step'], {
    name: 'idx_match_analytics_events_type_step',
  });
};

export const down = false;
