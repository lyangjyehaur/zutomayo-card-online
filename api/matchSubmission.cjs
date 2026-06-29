/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const crypto = require('crypto');
const { normalizeWinnerPlayer, verifyBoardgameMatchResult } = require('./matchVerification.cjs');

function calculateElo(ratingA, ratingB, scoreA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

async function submitMatchResult({
  pool,
  authUserId,
  body,
  sanitizeActionLog,
  generateMatchId = () => 'm_' + crypto.randomBytes(8).toString('hex'),
}) {
  const { winnerId, loserId, turns, duration, actionLog, action_log, sourceMatchId, winnerPlayer } = body;
  if (!winnerId || !loserId) return { ok: false, status: 400, error: 'Winner and loser IDs required' };
  if (winnerId !== authUserId) {
    return { ok: false, status: 403, error: 'Forbidden: winner must match authenticated user' };
  }

  const cleanSourceMatchId =
    typeof sourceMatchId === 'string' && sourceMatchId.length > 0 ? sourceMatchId.slice(0, 120) : '';
  const sourceVerification = await verifyBoardgameMatchResult(
    pool,
    cleanSourceMatchId,
    normalizeWinnerPlayer(winnerPlayer),
    authUserId,
  );
  if (!sourceVerification.ok) {
    return { ok: false, status: sourceVerification.status, error: sourceVerification.error };
  }

  const sanitizedActionLog = sanitizeActionLog(actionLog ?? action_log);
  const matchId = generateMatchId();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const winner = (await client.query('SELECT * FROM users WHERE id = $1', [winnerId])).rows[0];
    const loser = (await client.query('SELECT * FROM users WHERE id = $1', [loserId])).rows[0];

    let winnerEloChange = 0;
    let loserEloChange = 0;

    if (winner && loser) {
      const newWinnerElo = calculateElo(winner.elo, loser.elo, 1);
      const newLoserElo = calculateElo(loser.elo, winner.elo, 0);
      winnerEloChange = newWinnerElo - winner.elo;
      loserEloChange = newLoserElo - loser.elo;

      await client.query('UPDATE users SET elo = $1, match_count = match_count + 1, wins = wins + 1 WHERE id = $2', [
        newWinnerElo,
        winnerId,
      ]);
      await client.query('UPDATE users SET elo = $1, match_count = match_count + 1 WHERE id = $2', [
        newLoserElo,
        loserId,
      ]);
    }

    const player0Id = winner ? winnerId : null;
    const player1Id = loser ? loserId : null;
    await client.query(
      'INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, action_log) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)',
      [
        matchId,
        player0Id,
        player1Id,
        winnerId,
        loserId,
        winnerEloChange,
        loserEloChange,
        turns || 0,
        duration || 0,
        JSON.stringify(sanitizedActionLog),
      ],
    );

    await client.query('COMMIT');

    return {
      ok: true,
      body: {
        matchId,
        winnerEloChange,
        loserEloChange,
        winnerNewElo: (winner?.elo || 1000) + winnerEloChange,
        loserNewElo: (loser?.elo || 1000) + loserEloChange,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  calculateElo,
  submitMatchResult,
};
