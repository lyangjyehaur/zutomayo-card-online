-- Core anonymous match analytics queries.
--
-- Every balance query partitions by app/rules/dataset identity and excludes
-- abandoned, operator/synthetic, and timeout-heavy sessions where applicable.
-- Internal rows always retain sample counts and Wilson intervals. Deck/card
-- conclusions are not public-ready until they reach 100 eligible appearances.

-- 1. Daily completion and abandonment rate.
WITH daily AS (
  SELECT
    date_trunc('day', completed_at) AS day,
    environment,
    traffic_class,
    match_mode,
    seat_classes,
    app_version,
    rules_version,
    dataset_sha256,
    COUNT(*) AS sessions,
    COUNT(*) FILTER (
      WHERE outcome = 'abandoned'
        AND action_count = 0
        AND quality_flags @> ARRAY['missing-seat-reservation']::text[]
    ) AS unformed_sessions,
    COUNT(*) FILTER (
      WHERE NOT (
        outcome = 'abandoned'
        AND action_count = 0
        AND quality_flags @> ARRAY['missing-seat-reservation']::text[]
      )
    ) AS formed_sessions,
    COUNT(*) FILTER (WHERE outcome <> 'abandoned') AS completed_sessions,
    COUNT(*) FILTER (
      WHERE outcome = 'abandoned'
        AND NOT (
          action_count = 0
          AND quality_flags @> ARRAY['missing-seat-reservation']::text[]
        )
    ) AS abandoned_sessions
  FROM match_analytics
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
)
SELECT
  *,
  formed_sessions::double precision / NULLIF(sessions, 0) AS room_formation_rate,
  completed_sessions::double precision / NULLIF(formed_sessions, 0) AS completion_rate,
  abandoned_sessions::double precision / NULLIF(formed_sessions, 0) AS abandonment_rate
FROM daily
ORDER BY day DESC, environment, traffic_class, match_mode;

-- 2. Timeout-affected matches and allowlisted timeout events by game step.
-- connection_class is a whole-match summary; it does not claim the socket was
-- disconnected at the exact timeout event.
WITH match_timeouts AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    match_mode,
    CASE
      WHEN reconnect_counts[1] > 0 OR reconnect_counts[2] > 0 THEN 'reconnected'
      WHEN disconnect_counts[1] > 0 OR disconnect_counts[2] > 0 THEN 'disconnected'
      ELSE 'no_disconnect_observed'
    END AS connection_class,
    COUNT(*) AS matches,
    COUNT(*) FILTER (WHERE timeout_count > 0) AS timeout_affected_matches,
    SUM(timeout_count) AS timeout_events
  FROM match_analytics
  WHERE outcome <> 'abandoned'
    AND traffic_class = 'production'
  GROUP BY 1, 2, 3, 4, 5
),
step_timeouts AS (
  SELECT
    facts.app_version,
    facts.rules_version,
    facts.dataset_sha256,
    facts.match_mode,
    CASE
      WHEN facts.reconnect_counts[1] > 0 OR facts.reconnect_counts[2] > 0 THEN 'reconnected'
      WHEN facts.disconnect_counts[1] > 0 OR facts.disconnect_counts[2] > 0 THEN 'disconnected'
      ELSE 'no_disconnect_observed'
    END AS connection_class,
    events.step,
    events.actor_seat,
    COUNT(*) AS timeout_events,
    COUNT(DISTINCT events.source_match_digest) AS affected_matches
  FROM match_analytics_events events
  JOIN match_analytics facts USING (source_match_digest)
  WHERE events.event_type IN ('timeoutSkip', 'timeoutAdvance')
    AND facts.outcome <> 'abandoned'
    AND facts.traffic_class = 'production'
  GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT
  summary.app_version,
  summary.rules_version,
  summary.dataset_sha256,
  summary.match_mode,
  summary.connection_class,
  detail.step,
  detail.actor_seat,
  summary.matches,
  summary.timeout_affected_matches,
  summary.timeout_affected_matches::double precision / NULLIF(summary.matches, 0) AS timeout_affected_rate,
  detail.timeout_events,
  detail.affected_matches
FROM match_timeouts summary
LEFT JOIN step_timeouts detail USING (
  app_version,
  rules_version,
  dataset_sha256,
  match_mode,
  connection_class
)
ORDER BY summary.app_version, summary.rules_version, summary.dataset_sha256,
         summary.match_mode, summary.connection_class, detail.step, detail.actor_seat;

-- 2b. Trusted connection lifecycle events by mode, stage, and seat. Reconnect
-- percentiles use only the bounded server-derived disconnect duration.
SELECT
  facts.app_version,
  facts.rules_version,
  facts.dataset_sha256,
  facts.match_mode,
  events.event_type,
  events.step,
  events.actor_seat,
  COUNT(DISTINCT events.source_match_digest) AS affected_matches,
  COUNT(*) AS event_count,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY (events.payload->>'disconnectSeconds')::integer
  ) FILTER (
    WHERE events.event_type = 'connectionReconnect'
      AND events.payload->>'disconnectSeconds' ~ '^[0-9]+$'
  ) AS reconnect_gap_seconds_p50,
  percentile_cont(0.9) WITHIN GROUP (
    ORDER BY (events.payload->>'disconnectSeconds')::integer
  ) FILTER (
    WHERE events.event_type = 'connectionReconnect'
      AND events.payload->>'disconnectSeconds' ~ '^[0-9]+$'
  ) AS reconnect_gap_seconds_p90
FROM match_analytics_events events
JOIN match_analytics facts USING (source_match_digest)
WHERE facts.outcome <> 'abandoned'
  AND facts.traffic_class = 'production'
  AND events.event_type IN ('connectionDisconnect', 'connectionReconnect')
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY 1, 2, 3, 4, 5, 6, 7;

-- 3. Seat and janken advantage with 95% Wilson intervals.
WITH observations AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    'seat_0_win'::text AS metric,
    (winner_seat = 0)::integer AS won
  FROM match_analytics
  WHERE outcome IN ('completed', 'surrendered')
    AND traffic_class = 'production'
    AND NOT quality_flags @> ARRAY['timeout-heavy']::text[]
  UNION ALL
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    'janken_winner_win'::text AS metric,
    (winner_seat = janken_winner_seat)::integer AS won
  FROM match_analytics
  WHERE outcome IN ('completed', 'surrendered')
    AND janken_winner_seat IS NOT NULL
    AND traffic_class = 'production'
    AND NOT quality_flags @> ARRAY['timeout-heavy']::text[]
),
samples AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    metric,
    COUNT(*)::double precision AS sample_size,
    SUM(won)::double precision AS wins
  FROM observations
  GROUP BY 1, 2, 3, 4
),
wilson AS (
  SELECT *, wins / sample_size AS win_rate, 1.96::double precision AS z
  FROM samples
)
SELECT
  app_version,
  rules_version,
  dataset_sha256,
  metric,
  sample_size::bigint,
  wins::bigint,
  win_rate,
  (
    win_rate + z * z / (2 * sample_size)
    - z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_lower_95,
  (
    win_rate + z * z / (2 * sample_size)
    + z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_upper_95
FROM wilson
ORDER BY app_version, rules_version, dataset_sha256, metric;

-- 4a. Card inclusion win rate. Each card counts once per deck even when the
-- deck contains two copies; copy-count analysis should be a separate query.
WITH deck_cards AS (
  SELECT DISTINCT
    decks.source_match_digest,
    decks.seat,
    cards.card_id
  FROM match_analytics_decks decks
  CROSS JOIN LATERAL unnest(decks.card_ids) AS cards(card_id)
),
card_results AS (
  SELECT
    facts.app_version,
    facts.rules_version,
    facts.dataset_sha256,
    deck_cards.card_id,
    (deck_cards.seat = facts.winner_seat)::integer AS won
  FROM deck_cards
  JOIN match_analytics facts USING (source_match_digest)
  WHERE facts.outcome IN ('completed', 'surrendered')
    AND facts.traffic_class = 'production'
    AND NOT facts.quality_flags @> ARRAY['timeout-heavy']::text[]
),
samples AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    card_id,
    COUNT(*)::double precision AS sample_size,
    SUM(won)::double precision AS wins
  FROM card_results
  GROUP BY 1, 2, 3, 4
),
wilson AS (
  SELECT *, wins / sample_size AS win_rate, 1.96::double precision AS z
  FROM samples
)
SELECT
  app_version,
  rules_version,
  dataset_sha256,
  card_id,
  sample_size::bigint AS included_decks,
  wins::bigint AS winning_decks,
  win_rate AS inclusion_win_rate,
  (
    win_rate + z * z / (2 * sample_size)
    - z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_lower_95,
  (
    win_rate + z * z / (2 * sample_size)
    + z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_upper_95,
  CASE WHEN sample_size >= 100 THEN 'publishable' ELSE 'insufficient_sample' END AS sample_status
FROM wilson
ORDER BY app_version, rules_version, dataset_sha256, inclusion_win_rate DESC, card_id;

-- 4b. Exact deck inclusion win rate. Deck hashes identify an unordered card
-- definition multiset and never contain a player, match, or card-instance ID.
WITH deck_results AS (
  SELECT
    facts.app_version,
    facts.rules_version,
    facts.dataset_sha256,
    decks.deck_hash,
    (decks.seat = facts.winner_seat)::integer AS won
  FROM match_analytics_decks decks
  JOIN match_analytics facts USING (source_match_digest)
  WHERE facts.outcome IN ('completed', 'surrendered')
    AND facts.traffic_class = 'production'
    AND NOT facts.quality_flags @> ARRAY['timeout-heavy']::text[]
),
samples AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    deck_hash,
    COUNT(*)::double precision AS sample_size,
    SUM(won)::double precision AS wins
  FROM deck_results
  GROUP BY 1, 2, 3, 4
),
wilson AS (
  SELECT *, wins / sample_size AS win_rate, 1.96::double precision AS z
  FROM samples
)
SELECT
  app_version,
  rules_version,
  dataset_sha256,
  deck_hash,
  sample_size::bigint AS appearances,
  wins::bigint AS wins,
  win_rate,
  (
    win_rate + z * z / (2 * sample_size)
    - z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_lower_95,
  (
    win_rate + z * z / (2 * sample_size)
    + z * sqrt((win_rate * (1 - win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_upper_95,
  CASE WHEN sample_size >= 100 THEN 'publishable' ELSE 'insufficient_sample' END AS sample_status
FROM wilson
ORDER BY app_version, rules_version, dataset_sha256, win_rate DESC, deck_hash;

-- 5. Match length and suspicious terminal-state distribution.
SELECT
  app_version,
  rules_version,
  dataset_sha256,
  outcome,
  gameover_reason_code,
  COUNT(*) AS matches,
  percentile_cont(ARRAY[0.1, 0.5, 0.9]) WITHIN GROUP (ORDER BY duration_seconds) AS duration_seconds_p10_p50_p90,
  percentile_cont(ARRAY[0.1, 0.5, 0.9]) WITHIN GROUP (ORDER BY turns) AS turns_p10_p50_p90,
  COUNT(*) FILTER (WHERE duration_seconds < 60) AS under_one_minute,
  COUNT(*) FILTER (WHERE final_hp[1] = 100 AND final_hp[2] = 100) AS both_full_hp
FROM match_analytics
WHERE traffic_class = 'production'
GROUP BY 1, 2, 3, 4, 5
ORDER BY app_version, rules_version, dataset_sha256, outcome, gameover_reason_code;

-- 6. Same-version matchup matrix. Deck A/B ordering is lexical and therefore
-- independent of seat assignment. Never combine rules or dataset identities.
WITH matchups AS (
  SELECT
    facts.app_version,
    facts.rules_version,
    facts.dataset_sha256,
    LEAST(seat0.deck_hash, seat1.deck_hash) AS deck_a_hash,
    GREATEST(seat0.deck_hash, seat1.deck_hash) AS deck_b_hash,
    CASE
      WHEN seat0.deck_hash <= seat1.deck_hash THEN (facts.winner_seat = 0)::integer
      ELSE (facts.winner_seat = 1)::integer
    END AS deck_a_won
  FROM match_analytics facts
  JOIN match_analytics_decks seat0
    ON seat0.source_match_digest = facts.source_match_digest AND seat0.seat = 0
  JOIN match_analytics_decks seat1
    ON seat1.source_match_digest = facts.source_match_digest AND seat1.seat = 1
  WHERE facts.outcome IN ('completed', 'surrendered')
    AND facts.traffic_class = 'production'
    AND NOT facts.quality_flags @> ARRAY['timeout-heavy']::text[]
),
samples AS (
  SELECT
    app_version,
    rules_version,
    dataset_sha256,
    deck_a_hash,
    deck_b_hash,
    COUNT(*)::double precision AS sample_size,
    SUM(deck_a_won)::double precision AS deck_a_wins
  FROM matchups
  GROUP BY 1, 2, 3, 4, 5
),
wilson AS (
  SELECT *, deck_a_wins / sample_size AS deck_a_win_rate, 1.96::double precision AS z
  FROM samples
)
SELECT
  app_version,
  rules_version,
  dataset_sha256,
  deck_a_hash,
  deck_b_hash,
  sample_size::bigint AS matches,
  deck_a_wins::bigint AS deck_a_wins,
  deck_a_win_rate,
  (
    deck_a_win_rate + z * z / (2 * sample_size)
    - z * sqrt((deck_a_win_rate * (1 - deck_a_win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_lower_95,
  (
    deck_a_win_rate + z * z / (2 * sample_size)
    + z * sqrt((deck_a_win_rate * (1 - deck_a_win_rate) + z * z / (4 * sample_size)) / sample_size)
  ) / (1 + z * z / sample_size) AS wilson_upper_95,
  CASE WHEN sample_size >= 100 THEN 'publishable' ELSE 'insufficient_sample' END AS sample_status
FROM wilson
ORDER BY app_version, rules_version, dataset_sha256, deck_a_hash, deck_b_hash;
