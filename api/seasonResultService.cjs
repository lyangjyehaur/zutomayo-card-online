/* global module */

function calculateElo(rating, opponentRating, score, kFactor = 32) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.round(rating + kFactor * (score - expected));
}

function normalizeCompletedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Canonical match completion time is invalid');
  return date.toISOString();
}

async function applyCanonicalSeasonResult({
  client,
  sourceMatchId,
  canonicalMatchId,
  completedAt,
  rulesVersion,
  winnerId,
  loserId,
  kFactor = 32,
}) {
  if (!client || typeof client.query !== 'function') throw new Error('Season result requires a transaction client');
  if (!sourceMatchId || !canonicalMatchId || !winnerId || !loserId || winnerId === loserId) {
    throw new Error('Canonical season result is invalid');
  }
  const canonicalCompletedAt = normalizeCompletedAt(completedAt);
  const canonicalRulesVersion =
    String(rulesVersion || 'legacy')
      .trim()
      .slice(0, 120) || 'legacy';

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`season-result:${sourceMatchId}`]);
  const existing = (
    await client.query(
      `SELECT season_id, winner_delta, loser_delta,
              winner_rating_after, loser_rating_after,
              canonical_match_id, winner_user_id, loser_user_id,
              completed_at, rules_version
         FROM season_match_results
        WHERE source_match_id = $1`,
      [sourceMatchId],
    )
  ).rows[0];
  if (existing) {
    const immutableConflict =
      (existing.canonical_match_id && existing.canonical_match_id !== canonicalMatchId) ||
      (existing.winner_user_id && existing.winner_user_id !== winnerId) ||
      (existing.loser_user_id && existing.loser_user_id !== loserId) ||
      (existing.rules_version && existing.rules_version !== canonicalRulesVersion) ||
      (existing.completed_at && normalizeCompletedAt(existing.completed_at) !== canonicalCompletedAt);
    if (immutableConflict) {
      throw new Error(`Season result identity conflict for source match ${sourceMatchId}`);
    }
    return { applied: false, reason: 'duplicate', seasonId: existing.season_id, ...existing };
  }

  const season = (
    await client.query(
      `SELECT id, starting_rating, placement_matches, rules_version
         FROM seasons
        WHERE status IN ('active', 'settling')
          AND starts_at <= $1
          AND ends_at > $1
          AND rules_version = $2
        ORDER BY starts_at DESC
        LIMIT 1
        FOR SHARE`,
      [canonicalCompletedAt, canonicalRulesVersion],
    )
  ).rows[0];
  if (!season) {
    const configuredSeason = (
      await client.query(
        `SELECT id, status
           FROM seasons
          WHERE starts_at <= $1
            AND ends_at > $1
            AND rules_version = $2
          ORDER BY starts_at DESC
          LIMIT 1`,
        [canonicalCompletedAt, canonicalRulesVersion],
      )
    ).rows[0];
    if (configuredSeason) {
      return {
        applied: false,
        reason: 'season-not-settled',
        seasonId: configuredSeason.id,
        seasonStatus: configuredSeason.status,
      };
    }
    return { applied: false, reason: 'no-matching-season' };
  }

  for (const userId of [winnerId, loserId]) {
    await client.query(
      `INSERT INTO season_ratings (season_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [season.id, userId, season.starting_rating],
    );
  }
  const ratings = (
    await client.query(
      `SELECT user_id, rating, match_count
         FROM season_ratings
        WHERE season_id = $1 AND user_id IN ($2, $3)
        ORDER BY user_id
        FOR UPDATE`,
      [season.id, winnerId, loserId],
    )
  ).rows;
  const winner = ratings.find((row) => row.user_id === winnerId);
  const loser = ratings.find((row) => row.user_id === loserId);
  if (!winner || !loser) throw new Error('Season rating rows missing');

  const winnerBefore = Number(winner.rating);
  const loserBefore = Number(loser.rating);
  const winnerAfter = calculateElo(winnerBefore, loserBefore, 1, kFactor);
  const loserAfter = calculateElo(loserBefore, winnerBefore, 0, kFactor);
  const winnerDelta = winnerAfter - winnerBefore;
  const loserDelta = loserAfter - loserBefore;

  await client.query(
    `UPDATE season_ratings
        SET rating = $1, match_count = match_count + 1, wins = wins + 1,
            placement_complete = match_count + 1 >= $2, updated_at = NOW()
      WHERE season_id = $3 AND user_id = $4`,
    [winnerAfter, season.placement_matches, season.id, winnerId],
  );
  await client.query(
    `UPDATE season_ratings
        SET rating = $1, match_count = match_count + 1,
            placement_complete = match_count + 1 >= $2, updated_at = NOW()
      WHERE season_id = $3 AND user_id = $4`,
    [loserAfter, season.placement_matches, season.id, loserId],
  );
  await client.query(
    `INSERT INTO season_match_results
       (season_id, source_match_id, canonical_match_id, winner_user_id, loser_user_id,
        winner_delta, loser_delta, completed_at, rules_version,
        winner_rating_before, winner_rating_after, loser_rating_before, loser_rating_after, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
    [
      season.id,
      sourceMatchId,
      canonicalMatchId,
      winnerId,
      loserId,
      winnerDelta,
      loserDelta,
      canonicalCompletedAt,
      canonicalRulesVersion,
      winnerBefore,
      winnerAfter,
      loserBefore,
      loserAfter,
    ],
  );
  return {
    applied: true,
    seasonId: season.id,
    winnerDelta,
    loserDelta,
    winnerRating: winnerAfter,
    loserRating: loserAfter,
  };
}

module.exports = { applyCanonicalSeasonResult, calculateElo, normalizeCompletedAt };
