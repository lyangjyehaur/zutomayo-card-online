/* global module */

function normalizeWinnerPlayer(value) {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  return null;
}

function boardgameWinnerFromState(state) {
  if (!state || typeof state !== 'object') return null;
  const gameover = state.ctx && typeof state.ctx === 'object' ? state.ctx.gameover : null;
  if (gameover && typeof gameover === 'object') {
    if (gameover.draw) return null;
    const winner = normalizeWinnerPlayer(gameover.winner);
    if (winner !== null) return winner;
  }
  const G = state.G && typeof state.G === 'object' ? state.G : null;
  return normalizeWinnerPlayer(G?.winner);
}

function isBoardgameFinished(state) {
  if (!state || typeof state !== 'object') return false;
  const G = state.G && typeof state.G === 'object' ? state.G : null;
  return Boolean(state.ctx?.gameover) || G?.step === 'gameOver';
}

function playerDataUserId(metadata, player) {
  const seat = metadata?.players?.[String(player)] || metadata?.players?.[player];
  const userId = seat?.data?.userId;
  return typeof userId === 'string' ? userId : '';
}

function trustedPlayerSeat(metadata, player) {
  const seat = metadata?.players?.[String(player)] || metadata?.players?.[player];
  const data = seat?.data;
  if (!data || typeof data !== 'object') return null;
  const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
  if (!userId || data.identitySource !== 'server') return null;
  return {
    userId,
    rankedEligible: data.rankedEligible === true,
  };
}

function authoritativeMatchStats(state) {
  const G = state?.G && typeof state.G === 'object' ? state.G : {};
  const turns = Number.isInteger(G.turnNumber) && G.turnNumber >= 0 ? Math.min(G.turnNumber, 9999) : 0;
  const startedAt = Number.isFinite(G.matchStartedAt) ? Number(G.matchStartedAt) : 0;
  const endedAt = Number.isFinite(G.matchEndedAt) ? Number(G.matchEndedAt) : 0;
  const duration =
    startedAt > 0 && endedAt >= startedAt ? Math.min(Math.floor((endedAt - startedAt) / 1000), 86400) : 0;
  const completedAt =
    Number.isFinite(new Date(endedAt).getTime()) && endedAt > 0 ? new Date(endedAt).toISOString() : null;
  return {
    turns,
    duration,
    actionLog: Array.isArray(G.actionLog) ? G.actionLog : [],
    completedAt,
  };
}

function authoritativeRulesVersion(metadata) {
  const value = metadata?.setupData?.rulesVersion;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'legacy';
}

async function verifyBoardgameMatchResult(pool, sourceMatchId, winnerPlayer, authUserId) {
  if (!sourceMatchId) return { ok: false, status: 400, error: 'sourceMatchId required for ranked match submission' };
  if (winnerPlayer !== 0 && winnerPlayer !== 1) {
    return { ok: false, status: 400, error: 'winnerPlayer required for source match verification' };
  }
  let match;
  try {
    match = (
      await pool.query(
        `SELECT m.state, m.metadata, o.completed_at
           FROM bjg_matches m
           LEFT JOIN bjg_match_result_outbox o ON o.source_match_id = m.match_id
          WHERE m.match_id = $1
          FOR SHARE OF m`,
        [sourceMatchId],
      )
    ).rows[0];
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, status: 404, error: 'Source match not found' };
    throw err;
  }
  if (!match) return { ok: false, status: 404, error: 'Source match not found' };
  if (!isBoardgameFinished(match.state)) return { ok: false, status: 409, error: 'Source match is not finished' };
  const authoritativeWinner = boardgameWinnerFromState(match.state);
  if (authoritativeWinner === null) return { ok: false, status: 409, error: 'Source match has no winner' };
  if (authoritativeWinner !== winnerPlayer) {
    return { ok: false, status: 403, error: 'Winner does not match source match' };
  }
  const loserPlayer = winnerPlayer === 0 ? 1 : 0;
  const winnerSeat = trustedPlayerSeat(match.metadata, winnerPlayer);
  const loserSeat = trustedPlayerSeat(match.metadata, loserPlayer);
  if (!winnerSeat || !loserSeat) {
    return { ok: false, status: 409, error: 'Source match does not have server-bound seat identities' };
  }
  if (!winnerSeat.rankedEligible || !loserSeat.rankedEligible) {
    return { ok: false, status: 409, error: 'Source match is not eligible for ranked submission' };
  }
  const winnerUserId = winnerSeat.userId;
  const loserUserId = loserSeat.userId;
  if (winnerUserId === loserUserId) {
    return { ok: false, status: 409, error: 'Source match seats must belong to distinct accounts' };
  }
  if (authUserId !== winnerUserId && authUserId !== loserUserId) {
    return { ok: false, status: 403, error: 'Authenticated user is not a participant in the source match' };
  }
  return {
    ok: true,
    sourceMatchId,
    winnerPlayer,
    loserPlayer,
    winnerUserId,
    loserUserId,
    rulesVersion: authoritativeRulesVersion(match.metadata),
    authoritative: {
      ...authoritativeMatchStats(match.state),
      completedAt:
        typeof match.completed_at === 'string' && match.completed_at
          ? new Date(match.completed_at).toISOString()
          : authoritativeMatchStats(match.state).completedAt,
    },
  };
}

module.exports = {
  boardgameWinnerFromState,
  isBoardgameFinished,
  normalizeWinnerPlayer,
  playerDataUserId,
  trustedPlayerSeat,
  authoritativeMatchStats,
  authoritativeRulesVersion,
  verifyBoardgameMatchResult,
};
