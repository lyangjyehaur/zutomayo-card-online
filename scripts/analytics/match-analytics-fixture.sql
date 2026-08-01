-- Deterministic MA-08 fixture for a disposable PostgreSQL database only.

DO $$
BEGIN
  IF current_database() !~ '(role_smoke|fixture|test)' THEN
    RAISE EXCEPTION 'match analytics fixture refused database %', current_database();
  END IF;
END
$$;

DELETE FROM match_analytics_events
WHERE source_match_digest IN (
  SELECT source_match_digest FROM match_analytics WHERE build_id = 'analytics-fixture'
);
DELETE FROM match_analytics_decks
WHERE source_match_digest IN (
  SELECT source_match_digest FROM match_analytics WHERE build_id = 'analytics-fixture'
);
DELETE FROM match_analytics WHERE build_id = 'analytics-fixture';

-- 100 eligible production matches: seat 0 wins 60, and the janken winner wins 90.
INSERT INTO match_analytics (
  source_match_digest, environment, traffic_class, match_mode, rating_mode,
  app_version, build_id, rules_version, dataset_sha256, started_at, completed_at,
  duration_seconds, turns, outcome, winner_seat, janken_winner_seat,
  gameover_reason_code, final_hp, seat_classes, quality_flags, action_count,
  timeout_count, disconnect_counts, reconnect_counts, seat_resume_counts,
  deck_count, event_count, integrity_sha256
)
SELECT
  lpad(to_hex(n), 64, '0'), 'test', 'production', 'quick_match', 'ranked',
  'fixture-app', 'analytics-fixture', 'fixture-rules', 'fixture-dataset-a',
  timestamptz '2026-07-31 00:00:00+00' + make_interval(mins => n),
  timestamptz '2026-07-31 00:00:00+00' + make_interval(mins => n, secs => 60 + n),
  60 + n, 4 + (n % 6), 'completed', CASE WHEN n <= 60 THEN 0 ELSE 1 END,
  CASE WHEN n <= 50 THEN 0 ELSE 1 END, 'rules_terminal',
  CASE WHEN n <= 60 THEN ARRAY[80, 0] ELSE ARRAY[0, 80] END,
  ARRAY['registered', 'registered'], ARRAY[]::text[],
  CASE WHEN n <= 10 THEN 1 ELSE 0 END,
  CASE WHEN n <= 10 THEN 1 ELSE 0 END,
  CASE WHEN n <= 10 THEN ARRAY[1, 0] ELSE ARRAY[0, 0] END,
  CASE WHEN n BETWEEN 6 AND 10 THEN ARRAY[1, 0] ELSE ARRAY[0, 0] END,
  ARRAY[0, 0], 2, CASE WHEN n <= 10 THEN 1 ELSE 0 END,
  lpad(to_hex(1000 + n), 64, '0')
FROM generate_series(1, 100) AS series(n);

INSERT INTO match_analytics_decks (
  source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
)
SELECT lpad(to_hex(n), 64, '0'), 0, array_fill('fixture-card-a'::text, ARRAY[20]),
       repeat('1', 64), 'registered', 'valid'
FROM generate_series(1, 100) AS series(n)
UNION ALL
SELECT lpad(to_hex(n), 64, '0'), 1, array_fill('fixture-card-b'::text, ARRAY[20]),
       repeat('2', 64), 'registered', 'valid'
FROM generate_series(1, 100) AS series(n);

INSERT INTO match_analytics_events (
  source_match_digest, sequence, turn, step, actor_seat, event_type, timeout_phase, payload
)
SELECT lpad(to_hex(n), 64, '0'), 0, 5, 'effectOrder', n % 2,
       'timeoutAdvance', 'effectOrder', '{"timedOutStep":"effectOrder"}'::jsonb
FROM generate_series(1, 10) AS series(n);

-- Two trusted connection lifecycles exercise stage/seat counts and reconnect
-- duration percentiles without any match, socket, session, or user identifier.
UPDATE match_analytics
SET event_count = 3
WHERE source_match_digest IN (lpad(to_hex(1), 64, '0'), lpad(to_hex(2), 64, '0'));

INSERT INTO match_analytics_events (
  source_match_digest, sequence, turn, step, actor_seat, event_type, payload
) VALUES
  (lpad(to_hex(1), 64, '0'), 1, 0, 'effectOrder', 0, 'connectionDisconnect',
   '{"offsetSeconds":30}'::jsonb),
  (lpad(to_hex(1), 64, '0'), 2, 0, 'effectOrder', 0, 'connectionReconnect',
   '{"offsetSeconds":42,"disconnectSeconds":12}'::jsonb),
  (lpad(to_hex(2), 64, '0'), 1, 0, 'effectOrder', 0, 'connectionDisconnect',
   '{"offsetSeconds":50}'::jsonb),
  (lpad(to_hex(2), 64, '0'), 2, 0, 'effectOrder', 0, 'connectionReconnect',
   '{"offsetSeconds":98,"disconnectSeconds":48}'::jsonb);

-- A timeout-heavy match remains in operational timeout/length reports but is
-- excluded from balance, deck, card, and matchup conclusions.
INSERT INTO match_analytics (
  source_match_digest, environment, traffic_class, match_mode, rating_mode,
  app_version, build_id, rules_version, dataset_sha256, started_at, completed_at,
  duration_seconds, turns, outcome, winner_seat, janken_winner_seat,
  gameover_reason_code, final_hp, seat_classes, quality_flags, action_count,
  timeout_count, disconnect_counts, reconnect_counts, seat_resume_counts,
  deck_count, event_count, integrity_sha256
) VALUES (
  lpad(to_hex(201), 64, '0'), 'test', 'production', 'quick_match', 'ranked',
  'fixture-app', 'analytics-fixture', 'fixture-rules', 'fixture-dataset-a',
  '2026-07-31 03:30:00+00', '2026-07-31 03:30:30+00', 30, 1, 'completed', 0, 0,
  'rules_terminal', ARRAY[100, 100], ARRAY['registered', 'registered'],
  ARRAY['timeout-heavy'], 3, 3, ARRAY[1, 0], ARRAY[0, 0], ARRAY[0, 0], 2, 3,
  lpad(to_hex(1201), 64, '0')
);

INSERT INTO match_analytics_decks (
  source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
) VALUES
  (lpad(to_hex(201), 64, '0'), 0, array_fill('fixture-card-a'::text, ARRAY[20]), repeat('1', 64), 'registered', 'valid'),
  (lpad(to_hex(201), 64, '0'), 1, array_fill('fixture-card-b'::text, ARRAY[20]), repeat('2', 64), 'registered', 'valid');

INSERT INTO match_analytics_events (
  source_match_digest, sequence, turn, step, actor_seat, event_type, timeout_phase, payload
)
SELECT lpad(to_hex(201), 64, '0'), sequence, 1, 'effectOrder', 0,
       'timeoutAdvance', 'effectOrder', '{"timedOutStep":"effectOrder"}'::jsonb
FROM generate_series(0, 2) AS events(sequence);

-- One never-formed room validates that the funnel separates empty shells from
-- gameplay abandonment while the operational length report still retains it.
INSERT INTO match_analytics (
  source_match_digest, environment, traffic_class, match_mode, rating_mode,
  app_version, build_id, rules_version, dataset_sha256, started_at, completed_at,
  duration_seconds, turns, outcome, gameover_reason_code, final_hp, seat_classes,
  quality_flags, action_count, timeout_count, disconnect_counts, reconnect_counts,
  seat_resume_counts, deck_count, event_count, integrity_sha256
) VALUES (
  lpad(to_hex(202), 64, '0'), 'test', 'production', 'quick_match', 'unrated',
  'fixture-app', 'analytics-fixture', 'fixture-rules', 'fixture-dataset-a',
  '2026-07-31 04:00:00+00', '2026-07-31 04:10:00+00', 600, 2, 'abandoned',
  'inactive-room', ARRAY[100, 100], ARRAY['registered', 'unknown'],
  ARRAY['abandoned', 'missing-seat-reservation'],
  0, 0, ARRAY[0, 0], ARRAY[0, 0], ARRAY[0, 0], 2, 0,
  lpad(to_hex(1202), 64, '0')
);

INSERT INTO match_analytics_decks (
  source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
) VALUES
  (lpad(to_hex(202), 64, '0'), 0, array_fill('fixture-card-a'::text, ARRAY[20]), repeat('1', 64), 'registered', 'valid'),
  (lpad(to_hex(202), 64, '0'), 1, array_fill('fixture-card-b'::text, ARRAY[20]), repeat('2', 64), 'unknown', 'valid');

-- A second dataset proves version identity is never mixed. Its single
-- appearance must remain visible but marked insufficient.
INSERT INTO match_analytics (
  source_match_digest, environment, traffic_class, match_mode, rating_mode,
  app_version, build_id, rules_version, dataset_sha256, started_at, completed_at,
  duration_seconds, turns, outcome, winner_seat, janken_winner_seat,
  gameover_reason_code, final_hp, seat_classes, quality_flags, action_count,
  timeout_count, disconnect_counts, reconnect_counts, seat_resume_counts,
  deck_count, event_count, integrity_sha256
) VALUES (
  lpad(to_hex(203), 64, '0'), 'test', 'production', 'custom_room', 'unrated',
  'fixture-app', 'analytics-fixture', 'fixture-rules', 'fixture-dataset-b',
  '2026-07-31 05:00:00+00', '2026-07-31 05:02:00+00', 120, 4, 'completed', 1, 0,
  'rules_terminal', ARRAY[0, 80], ARRAY['guest', 'registered'], ARRAY[]::text[],
  0, 0, ARRAY[0, 0], ARRAY[0, 0], ARRAY[0, 0], 2, 0,
  lpad(to_hex(1203), 64, '0')
);

INSERT INTO match_analytics_decks (
  source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
) VALUES
  (lpad(to_hex(203), 64, '0'), 0, array_fill('fixture-card-c'::text, ARRAY[20]), repeat('3', 64), 'guest', 'valid'),
  (lpad(to_hex(203), 64, '0'), 1, array_fill('fixture-card-d'::text, ARRAY[20]), repeat('4', 64), 'registered', 'valid');

-- Operator traffic is present in the funnel but excluded from balance reports.
INSERT INTO match_analytics (
  source_match_digest, environment, traffic_class, match_mode, rating_mode,
  app_version, build_id, rules_version, dataset_sha256, completed_at,
  duration_seconds, turns, outcome, winner_seat, gameover_reason_code, final_hp,
  seat_classes, action_count, timeout_count, deck_count, event_count, integrity_sha256
) VALUES (
  lpad(to_hex(204), 64, '0'), 'test', 'operator', 'direct', 'unrated',
  'fixture-app', 'analytics-fixture', 'fixture-rules', 'fixture-dataset-a',
  '2026-07-31 06:00:00+00', 0, 0, 'completed', 0, 'operator-fixture',
  ARRAY[100, 100], ARRAY['registered', 'registered'], 0, 0, 2, 0,
  lpad(to_hex(1204), 64, '0')
);

INSERT INTO match_analytics_decks (
  source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
) VALUES
  (lpad(to_hex(204), 64, '0'), 0, array_fill('fixture-card-a'::text, ARRAY[20]), repeat('1', 64), 'registered', 'valid'),
  (lpad(to_hex(204), 64, '0'), 1, array_fill('fixture-card-b'::text, ARRAY[20]), repeat('2', 64), 'registered', 'valid');
