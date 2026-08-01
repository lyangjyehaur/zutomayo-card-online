/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    UPDATE matches SET completed_at = created_at WHERE completed_at IS NULL;
    ALTER TABLE matches ALTER COLUMN completed_at SET DEFAULT NOW();
    ALTER TABLE matches ALTER COLUMN completed_at SET NOT NULL;

    ALTER TABLE bjg_match_result_outbox ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    UPDATE bjg_match_result_outbox
       SET completed_at = created_at
     WHERE completed_at IS NULL;
    ALTER TABLE bjg_match_result_outbox ALTER COLUMN completed_at SET DEFAULT NOW();
    ALTER TABLE bjg_match_result_outbox ALTER COLUMN completed_at SET NOT NULL;

    ALTER TABLE seasons ADD COLUMN IF NOT EXISTS settling_at TIMESTAMPTZ;
    ALTER TABLE seasons ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

    DO $migration$
    DECLARE status_constraint TEXT;
    BEGIN
      FOR status_constraint IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'seasons'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%status%'
      LOOP
        EXECUTE format('ALTER TABLE seasons DROP CONSTRAINT %I', status_constraint);
      END LOOP;
    END
    $migration$;

    ALTER TABLE seasons
      ADD CONSTRAINT ck_seasons_status_schedule
      CHECK (
        status IN ('scheduled', 'active', 'settling', 'closed')
        AND ends_at > starts_at
        AND placement_matches BETWEEN 0 AND 20
      );

    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS canonical_match_id TEXT;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS rules_version TEXT;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS winner_rating_before INTEGER;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS winner_rating_after INTEGER;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS loser_rating_before INTEGER;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS loser_rating_after INTEGER;
    ALTER TABLE season_match_results ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

    UPDATE season_match_results AS result
       SET canonical_match_id = canonical.id,
           completed_at = COALESCE(canonical.completed_at, result.created_at),
           rules_version = COALESCE(canonical.rules_version, season.rules_version, 'legacy'),
           applied_at = result.created_at
      FROM seasons AS season, matches AS canonical
     WHERE season.id = result.season_id
       AND canonical.source_match_id = result.source_match_id;

    UPDATE season_match_results AS result
       SET completed_at = COALESCE(completed_at, created_at),
           rules_version = COALESCE(
             rules_version,
             (SELECT season.rules_version FROM seasons AS season WHERE season.id = result.season_id),
             'legacy'
           ),
           applied_at = COALESCE(applied_at, created_at);

    ALTER TABLE season_match_results ALTER COLUMN completed_at SET NOT NULL;
    ALTER TABLE season_match_results ALTER COLUMN rules_version SET NOT NULL;
    ALTER TABLE season_match_results ALTER COLUMN applied_at SET DEFAULT NOW();
    ALTER TABLE season_match_results ALTER COLUMN applied_at SET NOT NULL;

    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM season_match_results
         GROUP BY source_match_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'season_match_results contains cross-season duplicate source_match_id values';
      END IF;
    END
    $migration$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_season_match_results_source
      ON season_match_results (source_match_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_season_match_results_canonical_match
      ON season_match_results (canonical_match_id)
      WHERE canonical_match_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_season_match_results_completed
      ON season_match_results (season_id, completed_at, source_match_id);
    CREATE INDEX IF NOT EXISTS idx_match_result_outbox_season_settlement
      ON bjg_match_result_outbox (rules_version, completed_at, status)
      WHERE ranked_eligible = TRUE;

    ALTER TABLE season_match_results
      DROP CONSTRAINT IF EXISTS fk_season_match_results_canonical_match;
    ALTER TABLE season_match_results
      ADD CONSTRAINT fk_season_match_results_canonical_match
      FOREIGN KEY (canonical_match_id) REFERENCES matches(id) ON DELETE RESTRICT;

    CREATE TABLE IF NOT EXISTS season_reward_entitlements (
      id BIGSERIAL PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reward_tier TEXT NOT NULL,
      reward_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_season_reward_entitlements_reward
        FOREIGN KEY (season_id, user_id)
        REFERENCES season_rewards(season_id, user_id)
        ON DELETE CASCADE,
      CONSTRAINT ck_season_reward_entitlements_tier CHECK (length(reward_tier) > 0),
      CONSTRAINT uq_season_reward_entitlements_allocation UNIQUE (season_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_season_reward_entitlements_user
      ON season_reward_entitlements (user_id, granted_at DESC);

    INSERT INTO season_reward_entitlements
      (season_id, user_id, reward_tier, reward_payload, granted_at)
    SELECT season_id, user_id, reward_tier, reward_payload, granted_at
      FROM season_rewards
    ON CONFLICT (season_id, user_id) DO NOTHING;

    DROP INDEX IF EXISTS idx_seasons_single_active;
  `);
};

// This migration creates immutable result and entitlement evidence. Reversing
// it would discard production audit data, so rollback must use a forward fix.
export const down = false;
