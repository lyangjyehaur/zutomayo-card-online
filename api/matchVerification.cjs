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

async function verifyBoardgameMatchResult(pool, sourceMatchId, winnerPlayer, authUserId) {
  if (!sourceMatchId) return { ok: false, status: 400, error: 'sourceMatchId required for ranked match submission' };
  if (winnerPlayer !== 0 && winnerPlayer !== 1) {
    return { ok: false, status: 400, error: 'winnerPlayer required for source match verification' };
  }
  let match;
  try {
    match = (await pool.query('SELECT state, metadata FROM bjg_matches WHERE match_id = $1', [sourceMatchId])).rows[0];
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
  if (playerDataUserId(match.metadata, winnerPlayer) !== authUserId) {
    return { ok: false, status: 403, error: 'Winner seat is not bound to authenticated user' };
  }
  const loserPlayer = winnerPlayer === 0 ? 1 : 0;
  return {
    ok: true,
    sourceMatchId,
    winnerPlayer,
    loserPlayer,
    winnerUserId: playerDataUserId(match.metadata, winnerPlayer),
    loserUserId: playerDataUserId(match.metadata, loserPlayer),
  };
}

module.exports = {
  boardgameWinnerFromState,
  isBoardgameFinished,
  normalizeWinnerPlayer,
  playerDataUserId,
  verifyBoardgameMatchResult,
};
