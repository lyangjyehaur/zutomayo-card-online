/* global module, require */

const { applyCanonicalSeasonResult, calculateElo } = require('./seasonResultService.cjs');

function normalizeRewardConfig(value) {
  const tiers = Array.isArray(value?.tiers) ? value.tiers : [];
  const normalized = tiers
    .map((tier) => ({
      id: String(tier?.id || '')
        .trim()
        .slice(0, 64),
      maxRank: Math.max(1, Math.min(Number(tier?.maxRank) || 0, 1_000_000)),
      payload: tier?.payload && typeof tier.payload === 'object' && !Array.isArray(tier.payload) ? tier.payload : {},
    }))
    .filter((tier) => tier.id && tier.maxRank > 0)
    .sort((left, right) => left.maxRank - right.maxRank);
  const seen = new Set();
  return {
    tiers: normalized.filter((tier) => {
      if (seen.has(tier.id)) return false;
      seen.add(tier.id);
      return true;
    }),
  };
}

function rewardForRank(config, rank) {
  return normalizeRewardConfig(config).tiers.find((tier) => rank <= tier.maxRank) || null;
}

function parseSeasonInput(input) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const startingRating = Math.round(Number(input.startingRating) || 1000);
  const placementMatches = Math.round(Number(input.placementMatches) || 0);
  const ratingDecayPercent = Math.round(Number(input.ratingDecayPercent) || 0);
  const rulesVersion = String(input.rulesVersion || 'current')
    .trim()
    .slice(0, 64);
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(id)) return { error: 'Invalid season id' };
  if (!name || name.length > 120) return { error: 'Invalid season name' };
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    return { error: 'Invalid season schedule' };
  }
  if (startingRating < 500 || startingRating > 3000) return { error: 'Invalid starting rating' };
  if (placementMatches < 0 || placementMatches > 20) return { error: 'Invalid placement match count' };
  if (ratingDecayPercent < 0 || ratingDecayPercent > 100) return { error: 'Invalid rating decay percent' };
  if (!rulesVersion) return { error: 'Invalid rules version' };
  return {
    value: {
      id,
      name,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      startingRating,
      placementMatches,
      ratingDecayPercent,
      rulesVersion,
      rewardConfig: normalizeRewardConfig(input.rewardConfig),
    },
  };
}

async function withTransaction(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

async function writeSeasonAudit(client, { adminUserId, action, seasonId, details }) {
  if (!adminUserId) return;
  await client.query(
    `INSERT INTO admin_audit_log
       (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, 'season', $3, $4::jsonb)`,
    [adminUserId, action, seasonId, JSON.stringify(details || {})],
  );
}

async function getCurrentSeason(pool) {
  const season = (
    await pool.query(
      `SELECT id, name, status, starts_at, ends_at, starting_rating, placement_matches
       FROM seasons
       WHERE status = 'active' AND starts_at <= NOW() AND ends_at > NOW()
       LIMIT 1`,
    )
  ).rows[0];
  return { ok: true, body: { season: season || null } };
}

async function getUserSeasonRating({ pool, userId }) {
  const row = (
    await pool.query(
      `SELECT s.id AS season_id, s.name, s.ends_at, s.placement_matches,
              sr.rating, sr.match_count, sr.wins, sr.placement_complete,
              1 + (
                SELECT COUNT(*) FROM season_ratings ahead
                WHERE ahead.season_id = sr.season_id AND ahead.rating > sr.rating
              )::int AS rank
       FROM seasons s
       LEFT JOIN season_ratings sr ON sr.season_id = s.id AND sr.user_id = $1
       WHERE s.status = 'active' AND s.starts_at <= NOW() AND s.ends_at > NOW()
       LIMIT 1`,
      [userId],
    )
  ).rows[0];
  return { ok: true, body: { rating: row || null } };
}

async function listSeasonLeaderboard({ pool, limit = 100, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const { rows } = await pool.query(
    `SELECT sr.user_id, u.nickname, sr.rating, sr.match_count, sr.wins,
            sr.placement_complete
     FROM seasons s
     JOIN season_ratings sr ON sr.season_id = s.id
     JOIN users u ON u.id = sr.user_id
     WHERE s.status = 'active' AND u.deleted_at IS NULL
     ORDER BY sr.rating DESC, sr.wins DESC, sr.updated_at ASC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );
  return { ok: true, body: { entries: rows, limit: safeLimit, offset: safeOffset } };
}

async function listSeasons({ pool, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const { rows } = await pool.query(
    `SELECT id, name, status, starts_at, ends_at, starting_rating, placement_matches,
            rating_decay_percent, rules_version, reward_config, activated_at,
            settling_at, settled_at, closed_at, created_at
     FROM seasons ORDER BY starts_at DESC LIMIT $1`,
    [safeLimit],
  );
  return { ok: true, body: { seasons: rows } };
}

async function createSeason({ pool, ...input }) {
  const parsed = parseSeasonInput(input);
  if (parsed.error) return { ok: false, status: 400, error: parsed.error };
  const season = parsed.value;
  try {
    return await withTransaction(pool, async (client) => {
      const row = (
        await client.query(
          `INSERT INTO seasons
           (id, name, status, starts_at, ends_at, starting_rating, placement_matches,
            rating_decay_percent, rules_version, reward_config)
         VALUES ($1, $2, 'scheduled', $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
          [
            season.id,
            season.name,
            season.startsAt,
            season.endsAt,
            season.startingRating,
            season.placementMatches,
            season.ratingDecayPercent,
            season.rulesVersion,
            JSON.stringify(season.rewardConfig),
          ],
        )
      ).rows[0];
      await writeSeasonAudit(client, {
        adminUserId: input.adminUserId,
        action: 'season.create',
        seasonId: season.id,
        details: {
          startsAt: season.startsAt,
          endsAt: season.endsAt,
          rulesVersion: season.rulesVersion,
          ratingDecayPercent: season.ratingDecayPercent,
        },
      });
      return { ok: true, body: { season: row } };
    });
  } catch (error) {
    if (error?.code === '23505') return { ok: false, status: 409, error: 'Season already exists' };
    throw error;
  }
}

async function activateSeason({ pool, seasonId, adminUserId }) {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('season-lifecycle'))");
    const season = (
      await client.query(
        `SELECT id, status, starts_at, ends_at, starting_rating, rating_decay_percent
         FROM seasons WHERE id = $1 FOR UPDATE`,
        [seasonId],
      )
    ).rows[0];
    if (!season) return { ok: false, status: 404, error: 'Season not found' };
    if (season.status === 'active') return { ok: true, body: { activated: false, reason: 'already-active' } };
    if (season.status !== 'scheduled') return { ok: false, status: 409, error: 'Season cannot be activated' };
    if (new Date(season.ends_at).getTime() <= Date.now()) {
      return { ok: false, status: 409, error: 'Season has already ended' };
    }
    const current = (
      await client.query("SELECT id FROM seasons WHERE status = 'active' AND id <> $1 FOR UPDATE", [seasonId])
    ).rows[0];
    if (current) return { ok: false, status: 409, error: 'Another season is active' };

    const previous = (
      await client.query(
        `SELECT id, starting_rating FROM seasons
         WHERE status = 'closed' AND id <> $1
         ORDER BY closed_at DESC NULLS LAST, ends_at DESC LIMIT 1`,
        [seasonId],
      )
    ).rows[0];
    let seededRatings = 0;
    if (previous) {
      const seeded = await client.query(
        `INSERT INTO season_ratings (season_id, user_id, rating)
         SELECT $1, sr.user_id,
                $2 + ROUND((sr.rating - $3) * ((100 - $4)::numeric / 100))::int
         FROM season_ratings sr WHERE sr.season_id = $5
         ON CONFLICT (season_id, user_id) DO NOTHING`,
        [season.id, season.starting_rating, previous.starting_rating, season.rating_decay_percent, previous.id],
      );
      seededRatings = seeded.rowCount || 0;
    }
    await client.query(
      `UPDATE seasons SET status = 'active', activated_at = NOW()
       WHERE id = $1`,
      [season.id],
    );
    await writeSeasonAudit(client, {
      adminUserId,
      action: 'season.activate',
      seasonId: season.id,
      details: { seededRatings },
    });
    return { ok: true, body: { activated: true, seasonId: season.id, seededRatings } };
  });
}

async function closeSeason({ pool, seasonId, adminUserId }) {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('season-lifecycle'))");
    const season = (
      await client.query(
        `SELECT id, status, reward_config, starts_at, ends_at, rules_version,
                ends_at <= NOW() AS has_ended
           FROM seasons WHERE id = $1 FOR UPDATE`,
        [seasonId],
      )
    ).rows[0];
    if (!season) return { ok: false, status: 404, error: 'Season not found' };
    if (season.status === 'closed') return { ok: true, body: { closed: false, reason: 'already-closed' } };
    if (season.status !== 'active' && season.status !== 'settling') {
      return { ok: false, status: 409, error: 'Only an active or settling season can close' };
    }
    if (season.has_ended !== true) {
      return { ok: false, status: 409, error: 'Season cannot close before its scheduled end' };
    }

    const enteringSettlement = season.status === 'active';
    if (enteringSettlement) {
      await client.query(
        `UPDATE seasons
            SET status = 'settling', settling_at = COALESCE(settling_at, NOW())
          WHERE id = $1`,
        [season.id],
      );
    }
    const settlement = (
      await client.query(
        `SELECT
           (SELECT COUNT(*)::int
              FROM bjg_match_result_outbox outbox
             WHERE outbox.ranked_eligible = TRUE
               AND outbox.rules_version = $3
               AND outbox.completed_at >= $1
               AND outbox.completed_at < $2
               AND outbox.status IN ('pending', 'processing')) AS pending_count,
           (SELECT COUNT(*)::int
              FROM matches canonical_match
             WHERE canonical_match.source_match_id IS NOT NULL
               AND canonical_match.rules_version = $3
               AND canonical_match.completed_at >= $1
               AND canonical_match.completed_at < $2
               AND canonical_match.winner_id IS NOT NULL
               AND canonical_match.loser_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM season_match_results result
                  WHERE result.source_match_id = canonical_match.source_match_id
               )) AS unapplied_count`,
        [season.starts_at, season.ends_at, season.rules_version],
      )
    ).rows[0] || { pending_count: 0, unapplied_count: 0 };
    const pendingResults = Math.max(0, Number(settlement.pending_count) || 0);
    const unappliedResults = Math.max(0, Number(settlement.unapplied_count) || 0);
    if (pendingResults > 0 || unappliedResults > 0) {
      if (enteringSettlement) {
        await writeSeasonAudit(client, {
          adminUserId,
          action: 'season.settling',
          seasonId: season.id,
          details: { pendingResults, unappliedResults },
        });
      }
      return {
        ok: true,
        body: { closed: false, settling: true, seasonId: season.id, pendingResults, unappliedResults },
      };
    }

    const ratings = (
      await client.query(
        `SELECT user_id, rating, wins, match_count
         FROM season_ratings WHERE season_id = $1
         ORDER BY rating DESC, wins DESC, updated_at ASC FOR UPDATE`,
        [season.id],
      )
    ).rows;
    let rewardCount = 0;
    for (let index = 0; index < ratings.length; index += 1) {
      const rating = ratings[index];
      const rank = index + 1;
      const reward = rewardForRank(season.reward_config, rank);
      if (!reward) continue;
      const inserted = await client.query(
        `INSERT INTO season_rewards
           (season_id, user_id, final_rank, final_rating, reward_tier, reward_payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (season_id, user_id) DO NOTHING`,
        [season.id, rating.user_id, rank, rating.rating, reward.id, JSON.stringify(reward.payload)],
      );
      rewardCount += inserted.rowCount || 0;
    }
    // Record every granted reward, including rewards that have not been
    // claimed yet. The entitlement table is the immutable grant ledger; claim
    // is a separate state transition on season_rewards.
    await client.query(
      `INSERT INTO season_reward_entitlements
         (season_id, user_id, reward_tier, reward_payload, granted_at)
       SELECT season_id, user_id, reward_tier, reward_payload, granted_at
         FROM season_rewards
        WHERE season_id = $1
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [season.id],
    );
    await client.query(
      `UPDATE seasons
          SET status = 'closed', settled_at = NOW(), closed_at = NOW()
        WHERE id = $1`,
      [season.id],
    );
    await writeSeasonAudit(client, {
      adminUserId,
      action: 'season.close',
      seasonId: season.id,
      details: { rewardCount, playerCount: ratings.length },
    });
    return { ok: true, body: { closed: true, seasonId: season.id, rewardCount, playerCount: ratings.length } };
  });
}

async function getUserSeasonRewards({ pool, userId }) {
  const { rows } = await pool.query(
    `SELECT r.season_id, s.name AS season_name, r.final_rank, r.final_rating,
            r.reward_tier, r.reward_payload, r.granted_at, r.claimed_at,
            entitlement.id AS entitlement_id, entitlement.granted_at AS entitlement_granted_at
     FROM season_rewards r
     JOIN seasons s ON s.id = r.season_id
     LEFT JOIN season_reward_entitlements entitlement
       ON entitlement.season_id = r.season_id AND entitlement.user_id = r.user_id
     WHERE r.user_id = $1 ORDER BY r.granted_at DESC`,
    [userId],
  );
  return { ok: true, body: { rewards: rows } };
}

async function claimSeasonReward({ pool, userId, seasonId }) {
  return withTransaction(pool, async (client) => {
    const reward = (
      await client.query(
        `SELECT reward_tier, reward_payload, claimed_at
           FROM season_rewards
          WHERE season_id = $1 AND user_id = $2
          FOR UPDATE`,
        [seasonId, userId],
      )
    ).rows[0];
    if (!reward) return { ok: false, status: 404, error: 'Season reward not found' };

    let entitlement = (
      await client.query(
        `INSERT INTO season_reward_entitlements
           (season_id, user_id, reward_tier, reward_payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (season_id, user_id) DO NOTHING
         RETURNING id, reward_tier, reward_payload, granted_at`,
        [seasonId, userId, reward.reward_tier, JSON.stringify(reward.reward_payload || {})],
      )
    ).rows[0];
    if (!entitlement) {
      entitlement = (
        await client.query(
          `SELECT id, reward_tier, reward_payload, granted_at
             FROM season_reward_entitlements
            WHERE season_id = $1 AND user_id = $2`,
          [seasonId, userId],
        )
      ).rows[0];
    }
    if (!entitlement) throw new Error('Season reward entitlement was not persisted');

    const firstClaim = !reward.claimed_at;
    let claimedAt = reward.claimed_at;
    if (firstClaim) {
      claimedAt = (
        await client.query(
          `UPDATE season_rewards SET claimed_at = NOW()
            WHERE season_id = $1 AND user_id = $2 AND claimed_at IS NULL
          RETURNING claimed_at`,
          [seasonId, userId],
        )
      ).rows[0]?.claimed_at;
    }
    return {
      ok: true,
      body: {
        claimed: firstClaim,
        ...(firstClaim ? {} : { reason: 'already-claimed' }),
        claimedAt,
        reward: { reward_tier: reward.reward_tier, reward_payload: reward.reward_payload, claimed_at: claimedAt },
        entitlement,
      },
    };
  });
}

async function recordSeasonResult({ pool, sourceMatchId, winnerId, loserId, kFactor = 32 }) {
  if (!sourceMatchId || !winnerId || !loserId || winnerId === loserId) {
    return { ok: false, status: 400, error: 'Invalid season result' };
  }

  return withTransaction(pool, async (client) => {
    const canonical = (
      await client.query(
        `SELECT id, source_match_id, winner_id, loser_id, completed_at, rules_version
           FROM matches
          WHERE source_match_id = $1
          FOR SHARE`,
        [sourceMatchId],
      )
    ).rows[0];
    if (!canonical) return { ok: false, status: 404, error: 'Canonical match result not found' };
    if (canonical.winner_id !== winnerId || canonical.loser_id !== loserId) {
      return { ok: false, status: 409, error: 'Canonical match participants do not match' };
    }
    const result = await applyCanonicalSeasonResult({
      client,
      sourceMatchId,
      canonicalMatchId: canonical.id,
      completedAt: canonical.completed_at,
      rulesVersion: canonical.rules_version,
      winnerId,
      loserId,
      kFactor,
    });
    return { ok: true, body: result };
  });
}

module.exports = {
  activateSeason,
  calculateElo,
  claimSeasonReward,
  closeSeason,
  createSeason,
  getCurrentSeason,
  getUserSeasonRewards,
  getUserSeasonRating,
  listSeasons,
  listSeasonLeaderboard,
  normalizeRewardConfig,
  recordSeasonResult,
  rewardForRank,
};
