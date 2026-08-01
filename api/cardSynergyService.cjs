/* global module */

const { writeAuditLog } = require('./adminService.cjs');

const CATEGORIES = new Set([
  'named_card_song',
  'element',
  'zone_resource',
  'chronos',
  'hp_damage',
  'hand_draw',
  'card_stats_type',
  'deck_flow',
  'area_enchant',
  'event_trigger',
  'other',
]);

function relationRow(row) {
  return {
    id: row.id,
    groupId: row.group_id || '',
    sourceCardId: row.source_card_id,
    sourceCardName: row.source_card_name || '',
    targetCardId: row.target_card_id,
    targetCardName: row.target_card_name || '',
    kind: row.kind,
    primaryCategory: row.primary_category,
    categories: Array.isArray(row.categories) ? row.categories : [],
    confidence: row.confidence,
    score: Number(row.score),
    rationaleJa: row.rationale_ja,
    rationaleI18n: row.rationale_i18n || {},
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    reviewStatus: row.review_status,
    recommendationEligible: Boolean(row.recommendation_eligible),
    sourceVersion: row.source_version,
    rulesVersion: row.rules_version,
    reviewedAt: row.reviewed_at || null,
    updatedAt: row.updated_at,
  };
}

async function listCardSynergies(pool, { status = '', query = '', category = '', limit = 200 } = {}) {
  const values = [];
  const conditions = [];
  if (status) {
    values.push(status);
    conditions.push(`relation.review_status = $${values.length}`);
  }
  if (category) {
    values.push(category);
    conditions.push(`relation.primary_category = $${values.length}`);
  }
  if (query) {
    values.push(`%${query}%`);
    conditions.push(
      `(relation.id ILIKE $${values.length} OR relation.source_card_id ILIKE $${values.length} OR relation.target_card_id ILIKE $${values.length} OR source.name ILIKE $${values.length} OR target.name ILIKE $${values.length} OR relation.rationale_ja ILIKE $${values.length} OR EXISTS (
         SELECT 1 FROM card_texts_i18n AS localized
          WHERE localized.card_id IN (relation.source_card_id, relation.target_card_id)
            AND localized.review_status = 'verified'
            AND localized.name_text ILIKE $${values.length}
       ))`,
    );
  }
  values.push(Math.max(1, Math.min(500, Number(limit) || 200)));
  const rows = (
    await pool.query(
      `SELECT relation.*, source.name AS source_card_name, target.name AS target_card_name
       FROM card_synergy_relations AS relation
       JOIN cards AS source ON source.id = relation.source_card_id
       JOIN cards AS target ON target.id = relation.target_card_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY CASE relation.review_status WHEN 'candidate' THEN 0 WHEN 'needs_changes' THEN 1 ELSE 2 END,
                relation.confidence, relation.score DESC, relation.id
       LIMIT $${values.length}`,
      values,
    )
  ).rows;
  return rows.map(relationRow);
}

function normalizeInput(id, body) {
  const categories = [...new Set((body.categories || []).filter((value) => CATEGORIES.has(value)))];
  const primaryCategory = body.primaryCategory;
  if (!CATEGORIES.has(primaryCategory)) return null;
  if (!categories.includes(primaryCategory)) categories.unshift(primaryCategory);
  const reviewStatus = body.reviewStatus || 'candidate';
  const recommendationEligible = reviewStatus === 'approved' && body.recommendationEligible === true;
  return {
    id,
    groupId: body.groupId || null,
    sourceCardId: body.sourceCardId,
    targetCardId: body.targetCardId,
    kind: body.kind,
    primaryCategory,
    categories,
    confidence: body.confidence,
    score: Math.trunc(Number(body.score) || 0),
    rationaleJa: body.rationaleJa,
    rationaleI18n: body.rationaleI18n || {},
    evidence: body.evidence || [],
    reviewStatus,
    recommendationEligible,
    sourceVersion: body.sourceVersion,
    rulesVersion: body.rulesVersion,
  };
}

async function upsertCardSynergy(pool, id, body, adminUserId) {
  const relation = normalizeInput(id, body);
  if (!relation) return { ok: false, status: 400, error: 'Invalid synergy category' };
  const cardRows = await pool.query('SELECT id FROM cards WHERE id = ANY($1::text[])', [
    [relation.sourceCardId, relation.targetCardId],
  ]);
  if (cardRows.rows.length !== 2) return { ok: false, status: 400, error: 'Both cards must exist' };
  if (relation.sourceCardId === relation.targetCardId) {
    return { ok: false, status: 400, error: 'A card cannot recommend itself' };
  }
  const row = (
    await pool.query(
      `INSERT INTO card_synergy_relations (
         id, group_id, source_card_id, target_card_id, kind, primary_category, categories,
         confidence, score, rationale_ja, rationale_i18n, evidence, review_status,
         recommendation_eligible, source_version, rules_version, reviewed_by_user_id, reviewed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 CASE WHEN $13 IN ('approved','rejected','needs_changes') THEN $17 ELSE NULL END,
                 CASE WHEN $13 IN ('approved','rejected','needs_changes') THEN NOW() ELSE NULL END)
       ON CONFLICT (id) DO UPDATE SET
         group_id=EXCLUDED.group_id, source_card_id=EXCLUDED.source_card_id, target_card_id=EXCLUDED.target_card_id,
         kind=EXCLUDED.kind, primary_category=EXCLUDED.primary_category, categories=EXCLUDED.categories,
         confidence=EXCLUDED.confidence, score=EXCLUDED.score, rationale_ja=EXCLUDED.rationale_ja,
         rationale_i18n=EXCLUDED.rationale_i18n, evidence=EXCLUDED.evidence,
         review_status=EXCLUDED.review_status, recommendation_eligible=EXCLUDED.recommendation_eligible,
         source_version=EXCLUDED.source_version, rules_version=EXCLUDED.rules_version,
         reviewed_by_user_id=EXCLUDED.reviewed_by_user_id, reviewed_at=EXCLUDED.reviewed_at, updated_at=NOW()
       RETURNING *`,
      [
        relation.id,
        relation.groupId,
        relation.sourceCardId,
        relation.targetCardId,
        relation.kind,
        relation.primaryCategory,
        relation.categories,
        relation.confidence,
        relation.score,
        relation.rationaleJa,
        JSON.stringify(relation.rationaleI18n),
        JSON.stringify(relation.evidence),
        relation.reviewStatus,
        relation.recommendationEligible,
        relation.sourceVersion,
        relation.rulesVersion,
        adminUserId || null,
      ],
    )
  ).rows[0];
  await writeAuditLog(pool, {
    adminUserId: adminUserId || null,
    action: 'upsert_card_synergy',
    targetType: 'card_synergy_relation',
    targetId: id,
    details: { relation },
  });
  return { ok: true, body: relationRow(row) };
}

module.exports = { CATEGORIES, listCardSynergies, normalizeInput, relationRow, upsertCardSynergy };
