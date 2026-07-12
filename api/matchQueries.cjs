/* global module */

function clampLimit(value, fallback, max) {
  const limit = Number(value) || fallback;
  return Math.min(limit, max);
}

function clampOffset(value) {
  return Math.max(0, Number(value) || 0);
}

function mapMatchRow(match) {
  const mapped = {
    id: match.id,
    winnerId: match.winner_id,
    loserId: match.loser_id,
    winnerNickname: match.winner_nickname,
    loserNickname: match.loser_nickname,
    winnerEloChange: match.winner_elo_change,
    loserEloChange: match.loser_elo_change,
    turns: match.turns,
    duration: match.duration_seconds,
    createdAt: match.created_at,
  };
  // Preserve the authoritative boardgame id for history/chat correlation.
  // Keep the field omitted for pre-migration rows so legacy API consumers that
  // compare exact shapes remain compatible.
  if (match.source_match_id !== undefined) mapped.sourceMatchId = match.source_match_id || null;
  if (match.rules_version !== undefined) mapped.rulesVersion = match.rules_version || 'legacy';
  return mapped;
}

async function getMatchActionLog(pool, matchId, sanitizeActionLog, userId) {
  const match = (
    await pool.query(
      'SELECT id, rules_version, action_log FROM matches WHERE id = $1 AND (player0_id = $2 OR player1_id = $2)',
      [matchId, userId],
    )
  ).rows[0];
  if (!match) return { ok: false, status: 403, error: 'Forbidden' };
  const actionLog = Array.isArray(match.action_log) ? match.action_log : [];
  return {
    ok: true,
    body: { matchId: match.id, rulesVersion: match.rules_version || 'legacy', actionLog: sanitizeActionLog(actionLog) },
  };
}

async function getLeaderboard(pool, limitParam, sanitizeText) {
  const limit = clampLimit(limitParam, 100, 500);
  const entries = (
    await pool.query(
      'SELECT id, nickname, elo, match_count, wins FROM users WHERE match_count > 0 ORDER BY elo DESC LIMIT $1',
      [limit],
    )
  ).rows;
  return {
    leaderboard: entries.map((entry) => ({
      id: entry.id,
      nickname: sanitizeText(entry.nickname, 60),
      elo: entry.elo,
      matchCount: entry.match_count,
      wins: entry.wins,
      winRate: entry.match_count > 0 ? Math.round((entry.wins / entry.match_count) * 100) : 0,
    })),
  };
}

async function getUserMatches(pool, userId, limitParam, offsetParam) {
  const limit = clampLimit(limitParam, 50, 200);
  const offset = clampOffset(offsetParam);
  const matches = (
    await pool.query(
      `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       WHERE m.player0_id = $1 OR m.player1_id = $2
       ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`,
      [userId, userId, limit, offset],
    )
  ).rows;
  return { matches: matches.map(mapMatchRow) };
}

async function getAdminMatches(pool, limitParam) {
  const limit = clampLimit(limitParam, 50, 200);
  const matches = (
    await pool.query(
      `SELECT m.*, w.nickname AS winner_nickname, l.nickname AS loser_nickname
       FROM matches m
       LEFT JOIN users w ON m.winner_id = w.id
       LEFT JOIN users l ON m.loser_id = l.id
       ORDER BY m.created_at DESC LIMIT $1`,
      [limit],
    )
  ).rows;
  return { matches: matches.map(mapMatchRow) };
}

module.exports = {
  getAdminMatches,
  getLeaderboard,
  getMatchActionLog,
  getUserMatches,
};
