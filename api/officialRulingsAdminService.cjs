/* global module */

const crypto = require('node:crypto');
const { writeAuditLog } = require('./adminService.cjs');
const {
  officialRulingsSyncChangesTotal,
  officialRulingsSyncRunsTotal,
  officialRulingsTranslationFailuresTotal,
} = require('./observability.cjs');
const { upsertOfficialErrataTranslation, upsertOfficialQaTranslation } = require('./officialRulingsService.cjs');
const {
  errataHashInput,
  fetchOfficialSourceSnapshot,
  officialContentHash,
  qaHashInput,
} = require('./officialRulingsSource.cjs');

const TARGET_LOCALES = new Set(['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko']);
const TRANSLATION_STATUSES = new Set(['pending_review', 'machine', 'verified', 'failed']);
const NAME_ERRATA_IDS = new Set(['006', '011']);

function text(value) {
  return typeof value === 'string' ? value : '';
}

function locale(value) {
  const clean = text(value).trim();
  return TARGET_LOCALES.has(clean) ? clean : 'zh-TW';
}

function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function mapSyncRun(row) {
  return {
    id: text(row.id),
    triggerSource: text(row.trigger_source),
    status: text(row.status),
    qaLocalCount: Number(row.qa_local_count) || 0,
    qaRemoteCount: Number(row.qa_remote_count) || 0,
    errataLocalCount: Number(row.errata_local_count) || 0,
    errataRemoteCount: Number(row.errata_remote_count) || 0,
    diff: row.diff && typeof row.diff === 'object' ? row.diff : {},
    error: text(row.error_text),
    requestedByAdminUserId: text(row.requested_by_admin_user_id),
    startedAt: isoDate(row.started_at),
    finishedAt: isoDate(row.finished_at),
  };
}

function parseJsonTranslation(value) {
  const clean = text(value)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(clean);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid translation JSON');
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, text(item).trim()]));
}

function protectedTokens(value) {
  return text(value).match(/\[\[CARD:[^\]]+\]\]|SEND TO POWER|[0-9０-９]+|★+/g) || [];
}

function validateProtectedTranslation(source, translated) {
  const expected = protectedTokens(source).sort();
  const actual = protectedTokens(translated).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Translation changed protected card, number, or rules tokens');
  }
}

function tokenizeCards(value, cards) {
  let output = text(value);
  for (const card of cards) {
    if (card.name) output = output.replaceAll(card.name, `[[CARD:${card.id}]]`);
  }
  return output;
}

function restoreCards(value, cards, targetLocale) {
  const names = new Map(
    cards.map((card) => [
      card.id,
      targetLocale === 'en'
        ? card.en_name_official || card.name
        : card.localized_review_status === 'verified' && card.localized_name_text
          ? card.localized_name_text
          : card.en_name_official || card.name,
    ]),
  );
  return text(value).replace(/\[\[CARD:([^\]]+)\]\]/g, (_match, cardId) => names.get(cardId) || cardId);
}

function translationStatus(value) {
  const clean = text(value);
  return TRANSLATION_STATUSES.has(clean) ? clean : 'pending_review';
}

function mapQaTranslation(row) {
  return {
    resourceType: 'qa',
    id: text(row.id),
    number: Number(row.number) || 0,
    label: `Q.${Number(row.number) || 0}`,
    contentVersion: Number(row.content_version) || 1,
    source: { question: text(row.question_ja), answer: text(row.answer_ja) },
    translation: { question: text(row.question_text), answer: text(row.answer_text) },
    status: translationStatus(row.translation_status),
    provider: text(row.provider),
    model: text(row.model),
    reviewNote: text(row.review_note),
    updatedAt: isoDate(row.translation_updated_at),
  };
}

function mapErrataTranslation(row) {
  return {
    resourceType: 'errata',
    id: text(row.errata_id),
    label: `ERRATA #${text(row.errata_id)}`,
    cardId: text(row.card_id),
    cardName: text(row.card_name),
    contentVersion: Number(row.content_version) || 1,
    source: {
      incorrectText: text(row.incorrect_text),
      reason: text(row.reason_ja),
      replacementPolicy: text(row.replacement_policy_ja),
      usagePolicy: text(row.usage_policy_ja),
    },
    translation: {
      incorrectText: text(row.translated_incorrect_text),
      reason: text(row.reason_text),
      replacementPolicy: text(row.replacement_policy_text),
      usagePolicy: text(row.usage_policy_text),
    },
    status: translationStatus(row.translation_status),
    provider: text(row.provider),
    model: text(row.model),
    reviewNote: text(row.review_note),
    updatedAt: isoDate(row.translation_updated_at),
  };
}

async function listOfficialTranslations({ pool, language, resourceType = 'all', status = '', query = '' }) {
  try {
    const targetLocale = locale(language);
    const items = [];
    if (resourceType === 'all' || resourceType === 'qa') {
      const { rows } = await pool.query(
        `SELECT qa.*,
                translation.question_text,
                translation.answer_text,
                translation.status AS translation_status,
                translation.provider,
                translation.model,
                translation.review_note,
                translation.updated_at AS translation_updated_at
           FROM official_qa_items qa
           LEFT JOIN official_qa_translations translation
             ON translation.qa_id = qa.id
            AND translation.content_version = qa.content_version
            AND translation.locale = $1
          WHERE qa.publication_status = 'published'
          ORDER BY qa.number`,
        [targetLocale],
      );
      items.push(...rows.map(mapQaTranslation));
    }
    if (resourceType === 'all' || resourceType === 'errata') {
      const { rows } = await pool.query(
        `SELECT errata.*,
                card.name AS card_name,
                translation.incorrect_text AS translated_incorrect_text,
                translation.reason_text,
                translation.replacement_policy_text,
                translation.usage_policy_text,
                translation.status AS translation_status,
                translation.provider,
                translation.model,
                translation.review_note,
                translation.updated_at AS translation_updated_at
           FROM card_official_errata errata
           JOIN cards card ON card.id = errata.card_id
           LEFT JOIN card_official_errata_translations translation
             ON translation.errata_id = errata.errata_id
            AND translation.content_version = errata.content_version
            AND translation.locale = $1
          WHERE errata.publication_status = 'published'
          ORDER BY errata.errata_id`,
        [targetLocale],
      );
      items.push(...rows.map(mapErrataTranslation));
    }
    const needle = text(query).trim().toLocaleLowerCase();
    const cleanStatus = text(status).trim();
    const filtered = items.filter((item) => {
      if (cleanStatus && item.status !== cleanStatus) return false;
      if (!needle) return true;
      return JSON.stringify(item).toLocaleLowerCase().includes(needle);
    });
    const coverage = {
      total: items.length,
      translated: items.filter((item) => item.status === 'machine' || item.status === 'verified').length,
      verified: items.filter((item) => item.status === 'verified').length,
      pending: items.filter((item) => item.status === 'pending_review').length,
      failed: items.filter((item) => item.status === 'failed').length,
    };
    return { ok: true, body: { items: filtered, coverage, locale: targetLocale } };
  } catch {
    return { ok: false, status: 503, error: 'Official translations unavailable' };
  }
}

function diffRows(localRows, remoteRows, idField, hashInput) {
  const local = new Map(localRows.map((row) => [text(row[idField]), text(row.content_hash)]));
  const remote = new Map(remoteRows.map((row) => [text(row[idField]), officialContentHash(hashInput(row))]));
  return {
    added: [...remote.keys()].filter((id) => !local.has(id)),
    removed: [...local.keys()].filter((id) => !remote.has(id)),
    updated: [...remote.keys()].filter((id) => local.has(id) && local.get(id) !== remote.get(id)),
  };
}

async function validateRemoteCards(pool, snapshot) {
  const ids = [
    ...new Set([...snapshot.qa.flatMap((row) => row.relatedCards), ...snapshot.errata.map((row) => row.cardId)]),
  ];
  const { rows } = await pool.query('SELECT id, name, effect FROM cards WHERE id = ANY($1::text[])', [ids]);
  const cards = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    if (!cards.has(id)) throw new Error(`Official source references unknown card ${id}`);
  }
  for (const row of snapshot.errata) {
    const card = cards.get(row.cardId);
    if (NAME_ERRATA_IDS.has(row.errataId)) {
      if (!row.correctedText.includes(card.name)) throw new Error(`Errata ${row.errataId} corrected name mismatch`);
    } else if (/[ぁ-んァ-ヶ一-龠]/.test(row.correctedText) && card.effect !== row.correctedText) {
      throw new Error(`Errata ${row.errataId} corrected effect mismatch`);
    }
  }
}

async function checkOfficialSources({ pool, adminUserId, fetchImpl }) {
  const id = `official_sync_${crypto.randomBytes(12).toString('hex')}`;
  await pool.query(
    `INSERT INTO official_rulings_sync_runs (id, trigger_source, status, requested_by_admin_user_id)
     VALUES ($1, 'admin', 'running', $2)`,
    [id, adminUserId],
  );
  try {
    const snapshot = await fetchOfficialSourceSnapshot(fetchImpl);
    await validateRemoteCards(pool, snapshot);
    const [qaLocal, errataLocal] = await Promise.all([
      pool.query('SELECT id, content_hash FROM official_qa_items WHERE publication_status = $1', ['published']),
      pool.query('SELECT errata_id, content_hash FROM card_official_errata WHERE publication_status = $1', [
        'published',
      ]),
    ]);
    const diff = {
      qa: diffRows(qaLocal.rows, snapshot.qa, 'id', qaHashInput),
      errata: diffRows(errataLocal.rows, snapshot.errata, 'errataId', errataHashInput),
    };
    const changed = Object.values(diff).some((group) =>
      Object.values(group).some((values) => Array.isArray(values) && values.length > 0),
    );
    const status = changed ? 'changes' : 'no_change';
    const { rows } = await pool.query(
      `UPDATE official_rulings_sync_runs
          SET status = $2,
              qa_local_count = $3,
              qa_remote_count = $4,
              errata_local_count = $5,
              errata_remote_count = $6,
              diff = $7::jsonb,
              finished_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [
        id,
        status,
        qaLocal.rows.length,
        snapshot.qa.length,
        errataLocal.rows.length,
        snapshot.errata.length,
        JSON.stringify(diff),
      ],
    );
    await writeAuditLog(pool, {
      adminUserId,
      action: 'check_official_rulings_source',
      targetType: 'official_rulings_sync',
      targetId: id,
      details: { status, diff },
    });
    officialRulingsSyncRunsTotal.labels(status, 'admin').inc();
    for (const [resourceType, group] of Object.entries(diff)) {
      for (const changeType of ['added', 'updated', 'removed']) {
        const count = Array.isArray(group[changeType]) ? group[changeType].length : 0;
        if (count > 0) officialRulingsSyncChangesTotal.labels(resourceType, changeType).inc(count);
      }
    }
    return { ok: true, body: { run: mapSyncRun(rows[0]) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Official source check failed';
    await pool.query(
      `UPDATE official_rulings_sync_runs
          SET status = 'failed', error_text = $2, finished_at = NOW()
        WHERE id = $1`,
      [id, message.slice(0, 4000)],
    );
    officialRulingsSyncRunsTotal.labels('failed', 'admin').inc();
    return { ok: false, status: 502, error: message };
  }
}

async function getOfficialSyncStatus({ pool, limit = 20 }) {
  try {
    const { rows } = await pool.query(`SELECT * FROM official_rulings_sync_runs ORDER BY started_at DESC LIMIT $1`, [
      Math.max(1, Math.min(Number(limit) || 20, 100)),
    ]);
    return { ok: true, body: { runs: rows.map(mapSyncRun) } };
  } catch {
    return { ok: false, status: 503, error: 'Official sync status unavailable' };
  }
}

async function qaCards(pool, row, targetLocale) {
  const ids = Array.isArray(row.related_card_ids) ? row.related_card_ids : [];
  if (ids.length === 0) return [];
  return (
    await pool.query(
      `SELECT card.id, card.name, card.en_name_official,
              localized.name_text AS localized_name_text,
              localized.review_status AS localized_review_status
         FROM cards card
         LEFT JOIN card_texts_i18n localized
           ON localized.card_id = card.id AND localized.lang = $2
        WHERE card.id = ANY($1::text[])`,
      [ids, targetLocale],
    )
  ).rows;
}

async function generateOfficialTranslation({ pool, resourceType, resourceId, language, adminUserId, translateText }) {
  const targetLocale = locale(language);
  if (typeof translateText !== 'function') {
    officialRulingsTranslationFailuresTotal.labels(resourceType, targetLocale, 'machine_generate').inc();
    return { ok: false, status: 503, error: 'Translation provider is not configured' };
  }
  try {
    if (resourceType === 'qa') {
      const row = (
        await pool.query('SELECT * FROM official_qa_items WHERE id = $1 AND publication_status = $2', [
          resourceId,
          'published',
        ])
      ).rows[0];
      if (!row) return { ok: false, status: 404, error: 'Official Q&A not found' };
      const cards = await qaCards(pool, row, targetLocale);
      const source = {
        question: tokenizeCards(row.question_ja, cards),
        answer: tokenizeCards(row.answer_ja, cards),
      };
      const result = await translateText({
        text: JSON.stringify({
          ...source,
          instruction:
            'Translate faithfully as a trading-card rules ruling. Preserve every [[CARD:id]] token, number, ★ symbol, zone label, and SEND TO POWER. Return JSON with question and answer only.',
        }),
        sourceLanguage: 'ja',
        targetLanguage: targetLocale,
        purpose: 'official-rulings',
        resourceType: 'official_qa',
        resourceId,
        maxLength: 30_000,
      });
      const parsed = parseJsonTranslation(result.translatedContent);
      if (!parsed.question || !parsed.answer) throw new Error('Incomplete Q&A translation');
      validateProtectedTranslation(`${source.question}\n${source.answer}`, `${parsed.question}\n${parsed.answer}`);
      return upsertOfficialQaTranslation({
        pool,
        qaId: resourceId,
        reviewerUserId: adminUserId,
        operation: 'machine_generate',
        body: {
          locale: targetLocale,
          question: restoreCards(parsed.question, cards, targetLocale),
          answer: restoreCards(parsed.answer, cards, targetLocale),
          status: 'machine',
          provider: result.provider || 'llm',
          model: result.model || '',
          reviewNote: '',
        },
      });
    }
    if (resourceType === 'errata') {
      const row = (
        await pool.query(`SELECT * FROM card_official_errata WHERE errata_id = $1 AND publication_status = $2`, [
          resourceId,
          'published',
        ])
      ).rows[0];
      if (!row) return { ok: false, status: 404, error: 'Official errata not found' };
      const source = {
        incorrectText: row.incorrect_text,
        reason: row.reason_ja,
        replacementPolicy: row.replacement_policy_ja,
        usagePolicy: row.usage_policy_ja,
      };
      const result = await translateText({
        text: JSON.stringify({
          ...source,
          instruction:
            'Translate faithfully as an official card errata notice. Preserve every number, ★ symbol, zone label, and SEND TO POWER. Return JSON with incorrectText, reason, replacementPolicy, and usagePolicy only.',
        }),
        sourceLanguage: 'ja',
        targetLanguage: targetLocale,
        purpose: 'official-rulings',
        resourceType: 'official_errata',
        resourceId,
        maxLength: 30_000,
      });
      const parsed = parseJsonTranslation(result.translatedContent);
      if (!parsed.incorrectText || !parsed.reason || !parsed.replacementPolicy || !parsed.usagePolicy) {
        throw new Error('Incomplete errata translation');
      }
      validateProtectedTranslation(Object.values(source).join('\n'), Object.values(parsed).join('\n'));
      return upsertOfficialErrataTranslation({
        pool,
        errataId: resourceId,
        reviewerUserId: adminUserId,
        operation: 'machine_generate',
        body: {
          locale: targetLocale,
          ...parsed,
          status: 'machine',
          provider: result.provider || 'llm',
          model: result.model || '',
          reviewNote: '',
        },
      });
    }
    return { ok: false, status: 400, error: 'Invalid official resource type' };
  } catch (error) {
    officialRulingsTranslationFailuresTotal.labels(resourceType, targetLocale, 'machine_generate').inc();
    return { ok: false, status: 502, error: error instanceof Error ? error.message : 'Translation generation failed' };
  }
}

module.exports = {
  checkOfficialSources,
  generateOfficialTranslation,
  getOfficialSyncStatus,
  listOfficialTranslations,
  mapErrataTranslation,
  mapQaTranslation,
  validateProtectedTranslation,
};
