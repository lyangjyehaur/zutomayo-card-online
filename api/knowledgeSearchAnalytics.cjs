/* global module */

const crypto = require('crypto');

const ZERO_RESULT_RETENTION_DAYS = 90;
const SENSITIVE_QUERY_PATTERN =
  /(?:https?:\/\/|www\.|\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b(?:bearer|token|password|passwd|secret|api[_ -]?key)\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{12,}\b|\b(?:ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b|\b[0-9a-f]{32,}\b|\b[A-Za-z0-9_-]{40,}\b)/i;

function normalizeZeroResultQuery(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function safeZeroResultQuery(value) {
  const query = normalizeZeroResultQuery(value);
  if (!query || query.length > 120 || SENSITIVE_QUERY_PATTERN.test(query)) return null;
  if (/[^\p{L}\p{N}\p{M}\p{P}\p{Zs}]/u.test(query)) return null;
  return query;
}

function zeroResultScope(scopes) {
  const values = Array.isArray(scopes) ? [...new Set(scopes)].sort() : [];
  return values.length === 1 && ['card', 'qa', 'rule', 'errata', 'deck'].includes(values[0]) ? values[0] : 'all';
}

async function recordZeroResult(pool, { query, locale, scopes }) {
  const normalizedQuery = safeZeroResultQuery(query);
  if (!normalizedQuery) return { stored: false };
  const scope = zeroResultScope(scopes);
  const id = crypto.createHash('sha256').update(`${locale}\n${scope}\n${normalizedQuery}`).digest('hex');
  await pool.query(
    `INSERT INTO knowledge_search_zero_results
       (id, normalized_query, locale, scope, occurrence_count, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
       SET occurrence_count = knowledge_search_zero_results.occurrence_count + 1,
           last_seen_at = NOW()`,
    [id, normalizedQuery, locale, scope],
  );
  return { stored: true, id, normalizedQuery, scope };
}

async function listZeroResults(pool, { limit = 50, days = 30 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const safeDays = Math.max(1, Math.min(Number(days) || 30, ZERO_RESULT_RETENTION_DAYS));
  const rows = (
    await pool.query(
      `SELECT normalized_query, locale, scope, occurrence_count, first_seen_at, last_seen_at
         FROM knowledge_search_zero_results
        WHERE last_seen_at >= NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY occurrence_count DESC, last_seen_at DESC
        LIMIT $2`,
      [safeDays, safeLimit],
    )
  ).rows;
  return rows.map((row) => ({
    query: row.normalized_query,
    locale: row.locale,
    scope: row.scope,
    count: Number(row.occurrence_count) || 0,
    firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : String(row.first_seen_at),
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : String(row.last_seen_at),
  }));
}

module.exports = {
  SENSITIVE_QUERY_PATTERN,
  ZERO_RESULT_RETENTION_DAYS,
  listZeroResults,
  normalizeZeroResultQuery,
  recordZeroResult,
  safeZeroResultQuery,
  zeroResultScope,
};
