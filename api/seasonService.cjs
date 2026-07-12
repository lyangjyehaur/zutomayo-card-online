/* global module */

function calculateElo(rating, opponentRating, score, kFactor = 32) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.round(rating + kFactor * (score - expected));
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

async function recordSeasonResult({ pool, sourceMatchId, winnerId, loserId, kFactor = 32 }) {
  if (!sourceMatchId || !winnerId || !loserId || winnerId === loserId) {
    return { ok: false, status: 400, error: 'Invalid season result' };
  }

  return withTransaction(pool, async (client) => {
    const season = (
      await client.query(
        `SELECT id, starting_rating, placement_matches
         FROM seasons
         WHERE status = 'active' AND starts_at <= NOW() AND ends_at > NOW()
         FOR UPDATE`,
      )
    ).rows[0];
    if (!season) return { ok: true, body: { applied: false, reason: 'no-active-season' } };

    const existing = (
      await client.query(
        'SELECT winner_delta, loser_delta FROM season_match_results WHERE season_id = $1 AND source_match_id = $2',
        [season.id, sourceMatchId],
      )
    ).rows[0];
    if (existing) return { ok: true, body: { applied: false, reason: 'duplicate', ...existing } };

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

    const winnerNext = calculateElo(winner.rating, loser.rating, 1, kFactor);
    const loserNext = calculateElo(loser.rating, winner.rating, 0, kFactor);
    const winnerDelta = winnerNext - Number(winner.rating);
    const loserDelta = loserNext - Number(loser.rating);
    await client.query(
      `UPDATE season_ratings
       SET rating = $1, match_count = match_count + 1, wins = wins + 1,
           placement_complete = match_count + 1 >= $2, updated_at = NOW()
       WHERE season_id = $3 AND user_id = $4`,
      [winnerNext, season.placement_matches, season.id, winnerId],
    );
    await client.query(
      `UPDATE season_ratings
       SET rating = $1, match_count = match_count + 1,
           placement_complete = match_count + 1 >= $2, updated_at = NOW()
       WHERE season_id = $3 AND user_id = $4`,
      [loserNext, season.placement_matches, season.id, loserId],
    );
    await client.query(
      `INSERT INTO season_match_results
       (season_id, source_match_id, winner_user_id, loser_user_id, winner_delta, loser_delta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [season.id, sourceMatchId, winnerId, loserId, winnerDelta, loserDelta],
    );
    return {
      ok: true,
      body: { applied: true, seasonId: season.id, winnerDelta, loserDelta, winnerRating: winnerNext, loserRating: loserNext },
    };
  });
}

module.exports = {
  calculateElo,
  getCurrentSeason,
  getUserSeasonRating,
  listSeasonLeaderboard,
  recordSeasonResult,
};
