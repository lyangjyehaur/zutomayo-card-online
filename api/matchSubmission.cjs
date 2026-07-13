/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const crypto = require('crypto');
const { normalizeWinnerPlayer, verifyBoardgameMatchResult } = require('./matchVerification.cjs');
const { applyCanonicalSeasonResult } = require('./seasonResultService.cjs');
const { AccountMutationError, acquireAccountMutationLocks } = require('./accountMutationLock.cjs');

function calculateElo(ratingA, ratingB, scoreA) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

function existingMatchResponse(existing) {
  return {
    ok: true,
    body: {
      matchId: existing.id,
      winnerEloChange: Number(existing.winner_elo_change || 0),
      loserEloChange: Number(existing.loser_elo_change || 0),
      duplicate: true,
    },
  };
}

async function submitMatchResult({
  pool,
  authUserId,
  body,
  sanitizeActionLog,
  rankedMatchesEnabled = false,
  rulesVersion = 'legacy',
  generateMatchId = () => 'm_' + crypto.randomBytes(8).toString('hex'),
}) {
  const { winnerId, loserId, turns, duration, actionLog, action_log, sourceMatchId, winnerPlayer } = body;
  if (!winnerId || !loserId) return { ok: false, status: 400, error: 'Winner and loser IDs required' };
  if (winnerId === loserId) return { ok: false, status: 400, error: 'Winner and loser must be different users' };
  const cleanSourceMatchId =
    typeof sourceMatchId === 'string' && sourceMatchId.length > 0 ? sourceMatchId.slice(0, 120) : '';
  if (cleanSourceMatchId && rankedMatchesEnabled !== true) {
    // Ranked may be intentionally disabled during beta or maintenance. Treat
    // the finished game as a successful unrated submission so the client does
    // not enter a retry/error loop; no player history or rating is mutated.
    return {
      ok: true,
      body: {
        winnerEloChange: 0,
        loserEloChange: 0,
        unrated: true,
        reason: 'ranked_disabled',
      },
    };
  }
  if (!cleanSourceMatchId && winnerId !== authUserId) {
    return { ok: false, status: 403, error: 'Forbidden: winner must match authenticated user' };
  }
  let resolvedWinnerId = winnerId;
  let resolvedLoserId = loserId;
  let resolvedTurns = turns || 0;
  let resolvedDuration = duration || 0;
  let resolvedCompletedAt = new Date().toISOString();
  let rawActionLog = actionLog ?? action_log;
  let resolvedRulesVersion =
    String(rulesVersion || 'legacy')
      .trim()
      .slice(0, 120) || 'legacy';
  let sourceVerification = null;
  if (cleanSourceMatchId) {
    sourceVerification = await verifyBoardgameMatchResult(
      pool,
      cleanSourceMatchId,
      normalizeWinnerPlayer(winnerPlayer),
      authUserId,
    );
    if (!sourceVerification.ok) {
      return { ok: false, status: sourceVerification.status, error: sourceVerification.error };
    }
    resolvedWinnerId = sourceVerification.winnerUserId;
    resolvedLoserId = sourceVerification.loserUserId;
    resolvedTurns = sourceVerification.authoritative.turns;
    resolvedDuration = sourceVerification.authoritative.duration;
    rawActionLog = sourceVerification.authoritative.actionLog;
    resolvedRulesVersion = sourceVerification.rulesVersion;
    resolvedCompletedAt = sourceVerification.authoritative.completedAt || resolvedCompletedAt;
  }

  const sanitizedActionLog = sanitizeActionLog(rawActionLog);
  const matchId = generateMatchId();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await acquireAccountMutationLocks(client, [resolvedWinnerId, resolvedLoserId], { requireLiveUsers: false });
    let lockedUsers;
    if (cleanSourceMatchId) {
      const existing = (
        await client.query(
          `SELECT id, winner_elo_change, loser_elo_change, winner_id, loser_id,
                  completed_at, rules_version
             FROM matches WHERE source_match_id = $1`,
          [cleanSourceMatchId],
        )
      ).rows[0];
      if (existing) {
        try {
          lockedUsers = await acquireAccountMutationLocks(client, [
            existing.winner_id || resolvedWinnerId,
            existing.loser_id || resolvedLoserId,
          ]);
        } catch (error) {
          if (error instanceof AccountMutationError) {
            await client.query('COMMIT');
            return existingMatchResponse(existing);
          }
          throw error;
        }
        const seasonResult = await applyCanonicalSeasonResult({
          client,
          sourceMatchId: cleanSourceMatchId,
          canonicalMatchId: existing.id,
          completedAt: existing.completed_at || resolvedCompletedAt,
          rulesVersion: existing.rules_version || resolvedRulesVersion,
          winnerId: existing.winner_id || resolvedWinnerId,
          loserId: existing.loser_id || resolvedLoserId,
        });
        if (seasonResult.reason === 'season-not-settled') {
          throw new Error(`Season result is waiting for settlement: ${seasonResult.seasonId}`);
        }
        await client.query('COMMIT');
        return existingMatchResponse(existing);
      }
    }

    try {
      lockedUsers = await acquireAccountMutationLocks(client, [resolvedWinnerId, resolvedLoserId]);
    } catch (error) {
      if (error instanceof AccountMutationError) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'Ranked participants no longer exist' };
      }
      throw error;
    }

    const winner = lockedUsers.find((user) => user.id === resolvedWinnerId);
    const loser = lockedUsers.find((user) => user.id === resolvedLoserId);

    if (cleanSourceMatchId && (!winner || !loser)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Ranked participants no longer exist' };
    }

    let winnerEloChange = 0;
    let loserEloChange = 0;

    if (cleanSourceMatchId && winner && loser) {
      const newWinnerElo = calculateElo(winner.elo, loser.elo, 1);
      const newLoserElo = calculateElo(loser.elo, winner.elo, 0);
      winnerEloChange = newWinnerElo - winner.elo;
      loserEloChange = newLoserElo - loser.elo;

      await client.query('UPDATE users SET elo = $1, match_count = match_count + 1, wins = wins + 1 WHERE id = $2', [
        newWinnerElo,
        resolvedWinnerId,
      ]);
      await client.query('UPDATE users SET elo = $1, match_count = match_count + 1 WHERE id = $2', [
        newLoserElo,
        resolvedLoserId,
      ]);
    }

    const player0Id = winner ? resolvedWinnerId : null;
    const player1Id = loser ? resolvedLoserId : null;
    await client.query(
      'INSERT INTO matches (id, source_match_id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, rules_version, action_log, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)',
      [
        matchId,
        cleanSourceMatchId || null,
        player0Id,
        player1Id,
        resolvedWinnerId,
        resolvedLoserId,
        winnerEloChange,
        loserEloChange,
        resolvedTurns,
        resolvedDuration,
        resolvedRulesVersion,
        JSON.stringify(sanitizedActionLog),
        resolvedCompletedAt,
      ],
    );

    if (cleanSourceMatchId) {
      const seasonResult = await applyCanonicalSeasonResult({
        client,
        sourceMatchId: cleanSourceMatchId,
        canonicalMatchId: matchId,
        completedAt: resolvedCompletedAt,
        rulesVersion: resolvedRulesVersion,
        winnerId: resolvedWinnerId,
        loserId: resolvedLoserId,
      });
      if (seasonResult.reason === 'season-not-settled') {
        throw new Error(`Season result is waiting for settlement: ${seasonResult.seasonId}`);
      }
    }

    await client.query('COMMIT');

    return {
      ok: true,
      body: {
        matchId,
        winnerId: resolvedWinnerId,
        loserId: resolvedLoserId,
        winnerEloChange,
        loserEloChange,
        winnerNewElo: (winner?.elo || 1000) + winnerEloChange,
        loserNewElo: (loser?.elo || 1000) + loserEloChange,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505' && cleanSourceMatchId) {
      const existing = (
        await client.query('SELECT id, winner_elo_change, loser_elo_change FROM matches WHERE source_match_id = $1', [
          cleanSourceMatchId,
        ])
      ).rows[0];
      if (existing) return existingMatchResponse(existing);
      return { ok: false, status: 409, error: 'Source match result already submitted' };
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  calculateElo,
  submitMatchResult,
};
