/* global module, require */

const { writeAuditLog } = require('./adminService.cjs');
const { officialRulingsTranslationWritesTotal } = require('./observability.cjs');

const PUBLIC_TRANSLATION_STATUSES = new Set(['machine', 'verified']);
const WRITABLE_TRANSLATION_STATUSES = new Set(['pending_review', 'machine', 'verified', 'failed']);
const SUPPORTED_LOCALES = new Set(['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko']);
const LOCALE_ALIASES = new Map([
  ['zh-tw', 'zh-TW'],
  ['zhtw', 'zh-TW'],
  ['zh-cn', 'zh-CN'],
  ['zhcn', 'zh-CN'],
  ['zh-hk', 'zh-HK'],
  ['zhhk', 'zh-HK'],
  ['ja-jp', 'ja'],
  ['en-us', 'en'],
  ['en-gb', 'en'],
  ['ko-kr', 'ko'],
]);
const TAG_TRANSLATIONS = {
  基本ルール: {
    'zh-TW': '基本規則',
    'zh-CN': '基本规则',
    'zh-HK': '基本規則',
    en: 'Basic Rules',
    ko: '기본 규칙',
  },
  対戦準備: { 'zh-TW': '對戰準備', 'zh-CN': '对战准备', 'zh-HK': '對戰準備', en: 'Match Setup', ko: '대전 준비' },
  対戦の流れ: { 'zh-TW': '對戰流程', 'zh-CN': '对战流程', 'zh-HK': '對戰流程', en: 'Match Flow', ko: '대전 흐름' },
  効果処理: { 'zh-TW': '效果結算', 'zh-CN': '效果结算', 'zh-HK': '效果結算', en: 'Effect Resolution', ko: '효과 처리' },
  カード裁定: { 'zh-TW': '卡牌裁定', 'zh-CN': '卡牌裁定', 'zh-HK': '卡牌裁定', en: 'Card Rulings', ko: '카드 판정' },
  バトル: { 'zh-TW': '戰鬥', 'zh-CN': '战斗', 'zh-HK': '戰鬥', en: 'Battle', ko: '배틀' },
  キャラクター: {
    'zh-TW': '角色',
    'zh-CN': '角色',
    'zh-HK': '角色',
    en: 'Character',
    ko: '캐릭터',
  },
  エンチャント: { 'zh-TW': '附魔', 'zh-CN': '附魔', 'zh-HK': '附魔', en: 'Enchant', ko: '인챈트' },
  エリアエンチャント: {
    'zh-TW': '區域附魔',
    'zh-CN': '区域附魔',
    'zh-HK': '區域附魔',
    en: 'Area Enchant',
    ko: '에리어 인챈트',
  },
};
function normalizeOfficialLocale(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (SUPPORTED_LOCALES.has(raw)) return raw;
  const lowered = raw.toLowerCase().replace('_', '-');
  return LOCALE_ALIASES.get(lowered) || (SUPPORTED_LOCALES.has(lowered) ? lowered : 'zh-TW');
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function normalizedCardName(value) {
  return text(value).normalize('NFKC').replace(/\s+/g, '');
}

function reviewedCardName(row, locale) {
  if (locale === 'en') return text(row.en_name_official).trim();
  if (row.localized_review_status === 'verified') return text(row.localized_name_text).trim();
  return '';
}

async function validateQaTranslationCardNames({ pool, qaId, locale, question, answer }) {
  const { rows } = await pool.query(
    `SELECT qa.question_ja, qa.answer_ja,
            qa.related_card_ids,
            card.id, card.name, card.en_name_official,
            localized.name_text AS localized_name_text,
            localized.review_status AS localized_review_status
       FROM official_qa_items qa
       CROSS JOIN cards card
       LEFT JOIN card_texts_i18n localized
         ON localized.card_id = card.id AND localized.lang = $2
      WHERE qa.id = $1
      ORDER BY card.id`,
    [qaId, locale],
  );
  const sourceText = rows[0] ? `${text(rows[0].question_ja)}\n${text(rows[0].answer_ja)}` : '';
  const source = normalizedCardName(sourceText);
  const quotedNames = new Set([...sourceText.matchAll(/「([^」]+)」/gu)].map((match) => normalizedCardName(match[1])));
  const relatedIds = new Set(Array.isArray(rows[0]?.related_card_ids) ? rows[0].related_card_ids : []);
  const grouped = new Map();
  for (const row of rows) {
    const japaneseName = normalizedCardName(row.name);
    if (!japaneseName) continue;
    const group = grouped.get(japaneseName) || [];
    group.push(row);
    grouped.set(japaneseName, group);
  }
  const translated = normalizedCardName(`${question}\n${answer}`);
  for (const [japaneseName, group] of [...grouped].sort((left, right) => right[0].length - left[0].length)) {
    const related = group.find((row) => relatedIds.has(row.id));
    if (!related && !quotedNames.has(japaneseName)) continue;
    if (!source.includes(japaneseName)) continue;
    const row = related || [...group].sort((left, right) => text(left.id).localeCompare(text(right.id)))[0];
    const canonicalName = reviewedCardName(row, locale);
    if (!canonicalName) {
      return { ok: false, status: 409, error: `Reviewed ${locale} card name is unavailable for ${row.id}` };
    }
    if (!translated.includes(normalizedCardName(canonicalName))) {
      return {
        ok: false,
        status: 400,
        error: `Q&A translation must use reviewed card name ${canonicalName} (${row.id})`,
      };
    }
  }
  return { ok: true };
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function hasPublicTranslation(row, fields) {
  return PUBLIC_TRANSLATION_STATUSES.has(row.translation_status) && fields.every((field) => text(row[field]).trim());
}

function localizedQaTags(tags, locale) {
  if (locale === 'ja') return tags;
  return tags.map((tag) => TAG_TRANSLATIONS[tag]?.[locale] || tag);
}

function mapQaRow(row, requestedLocale) {
  const tagIds = stringArray(row.tags);
  const translated =
    requestedLocale !== 'ja' && hasPublicTranslation(row, ['translated_question', 'translated_answer']);
  return {
    id: text(row.id),
    number: Number(row.number) || 0,
    publishedAt: dateOnly(row.published_at),
    tagIds,
    tags: localizedQaTags(tagIds, requestedLocale),
    relatedCardIds: stringArray(row.related_card_ids),
    source: {
      question: text(row.question_ja),
      answer: text(row.answer_ja),
    },
    localized: {
      question: translated ? text(row.translated_question) : text(row.question_ja),
      answer: translated ? text(row.translated_answer) : text(row.answer_ja),
    },
    requestedLocale,
    effectiveLocale: translated ? requestedLocale : 'ja',
    translationStatus: translated ? text(row.translation_status) : 'source',
    sourceUrl: text(row.source_url),
    lastSyncedAt: isoDate(row.last_seen_at),
    contentVersion: Number(row.content_version) || 1,
  };
}

function matchesQa(item, { query, tag, cardId }) {
  if (tag && !item.tagIds.includes(tag) && !item.tags.includes(tag)) return false;
  if (cardId && !item.relatedCardIds.includes(cardId)) return false;
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return [item.localized.question, item.localized.answer, item.source.question, item.source.answer, ...item.tags]
    .join('\n')
    .toLocaleLowerCase()
    .includes(needle);
}

async function listPublicQa({ pool, language, query = '', tag = '', cardId = '' }) {
  try {
    const locale = normalizeOfficialLocale(language);
    const { rows } = await pool.query(
      `SELECT qa.*, qa.qa_id AS id,
              translation.question_text AS translated_question,
              translation.answer_text AS translated_answer,
              translation.status AS translation_status
         FROM official_rulings_active_release AS active
         JOIN official_rulings_release_qa AS qa ON qa.release_id = active.release_id
         LEFT JOIN official_qa_translations AS translation
           ON translation.qa_id = qa.qa_id
          AND translation.content_version = qa.content_version
          AND translation.locale = $1
          AND translation.status IN ('machine', 'verified')
        WHERE active.key = 'active'
        ORDER BY qa.number ASC`,
      [locale],
    );
    const filters = {
      query: text(query).trim(),
      tag: text(tag).trim(),
      cardId: text(cardId).trim(),
    };
    const localizedItems = rows.map((row) => mapQaRow(row, locale));
    if (locale !== 'ja' && localizedItems.some((item) => item.effectiveLocale !== locale)) {
      return { ok: false, status: 503, error: 'Official Q&A translation release is incomplete' };
    }
    const items = localizedItems.filter((item) => matchesQa(item, filters));
    return { ok: true, body: { items, total: items.length, locale } };
  } catch {
    return { ok: false, status: 503, error: 'Official Q&A unavailable' };
  }
}

async function getPublicQa({ pool, language, number }) {
  try {
    const locale = normalizeOfficialLocale(language);
    const numericNumber = Number(number);
    if (!Number.isInteger(numericNumber) || numericNumber <= 0) {
      return { ok: false, status: 400, error: 'Invalid Q&A number' };
    }
    const row = (
      await pool.query(
        `SELECT qa.*, qa.qa_id AS id,
                translation.question_text AS translated_question,
                translation.answer_text AS translated_answer,
                translation.status AS translation_status
           FROM official_rulings_active_release AS active
           JOIN official_rulings_release_qa AS qa ON qa.release_id = active.release_id
           LEFT JOIN official_qa_translations AS translation
             ON translation.qa_id = qa.qa_id
            AND translation.content_version = qa.content_version
            AND translation.locale = $1
            AND translation.status IN ('machine', 'verified')
          WHERE active.key = 'active' AND qa.number = $2`,
        [locale, numericNumber],
      )
    ).rows[0];
    if (!row) return { ok: false, status: 404, error: 'Official Q&A not found' };
    const item = mapQaRow(row, locale);
    if (locale !== 'ja' && item.effectiveLocale !== locale) {
      return { ok: false, status: 503, error: 'Official Q&A translation release is incomplete' };
    }
    return { ok: true, body: { item } };
  } catch {
    return { ok: false, status: 503, error: 'Official Q&A unavailable' };
  }
}

function localizedCardText(row, locale) {
  const japanese = text(row.corrected_japanese_text);
  if (locale === 'ja') return japanese;
  const english = text(row.corrected_english_text) || japanese;
  if (locale === 'en') return english;
  if (row.localized_review_status === 'verified') {
    const localized = row.affects_name ? text(row.localized_name_text) : text(row.localized_effect_text);
    if (localized) return localized;
  }
  return english;
}

function localizedCardName(row, locale) {
  const japanese = text(row.card_name_ja);
  if (locale === 'ja') return japanese;
  const english = text(row.card_name_en) || japanese;
  if (locale === 'en') return english;
  if (row.localized_review_status === 'verified' && text(row.localized_name_text)) {
    return text(row.localized_name_text);
  }
  return english;
}

function mapErrataRow(row, requestedLocale) {
  const translated =
    requestedLocale !== 'ja' &&
    PUBLIC_TRANSLATION_STATUSES.has(row.translation_status) &&
    [
      row.translated_incorrect_text,
      row.translated_reason_text,
      row.translated_replacement_policy_text,
      row.translated_usage_policy_text,
    ].some((value) => text(value).trim());
  const source = {
    incorrectText: text(row.incorrect_text),
    correctedText: text(row.corrected_japanese_text),
    reason: text(row.reason_ja),
    replacementPolicy: text(row.replacement_policy_ja),
    usagePolicy: text(row.usage_policy_ja),
  };
  return {
    errataId: text(row.errata_id),
    cardId: text(row.card_id),
    cardName: localizedCardName(row, requestedLocale),
    cardNameJa: text(row.card_name_ja),
    pack: text(row.pack),
    rarity: text(row.rarity),
    cardNumber: text(row.card_number),
    publishedAt: dateOnly(row.published_at),
    affectsName: Boolean(row.affects_name),
    affectsEffect: Boolean(row.affects_effect),
    source,
    localized: {
      incorrectText:
        translated && text(row.translated_incorrect_text) ? text(row.translated_incorrect_text) : source.incorrectText,
      correctedText: localizedCardText(row, requestedLocale),
      reason: translated && text(row.translated_reason_text) ? text(row.translated_reason_text) : source.reason,
      replacementPolicy:
        translated && text(row.translated_replacement_policy_text)
          ? text(row.translated_replacement_policy_text)
          : source.replacementPolicy,
      usagePolicy:
        translated && text(row.translated_usage_policy_text)
          ? text(row.translated_usage_policy_text)
          : source.usagePolicy,
    },
    requestedLocale,
    effectiveLocale: translated ? requestedLocale : 'ja',
    translationStatus: translated ? text(row.translation_status) : 'source',
    sourceUrl: text(row.source_url),
    lastSyncedAt: isoDate(row.last_seen_at),
    contentVersion: Number(row.content_version) || 1,
  };
}

const ERRATA_SELECT = `SELECT errata.*,
                              card.name AS card_name_ja,
                              card.en_name_official AS card_name_en,
                              card.pack,
                              card.rarity,
                              errata.corrected_japanese_text,
                              CASE WHEN errata.affects_name THEN card.en_name_official ELSE card.en_effect_official END
                                AS corrected_english_text,
                              translation.incorrect_text AS translated_incorrect_text,
                              translation.reason_text AS translated_reason_text,
                              translation.replacement_policy_text AS translated_replacement_policy_text,
                              translation.usage_policy_text AS translated_usage_policy_text,
                              translation.status AS translation_status,
                              localized.name_text AS localized_name_text,
                              localized.effect_text AS localized_effect_text,
                              localized.review_status AS localized_review_status
                         FROM official_rulings_active_release AS active
                         JOIN official_rulings_release_errata AS errata ON errata.release_id = active.release_id
                         JOIN cards AS card ON card.id = errata.card_id
                         LEFT JOIN card_official_errata_translations AS translation
                           ON translation.errata_id = errata.errata_id
                          AND translation.content_version = errata.content_version
                          AND translation.locale = $1
                          AND translation.status IN ('machine', 'verified')
                         LEFT JOIN card_texts_i18n AS localized
                           ON localized.card_id = errata.card_id
                          AND localized.lang = $1
                          AND localized.review_status = 'verified'`;

async function listPublicErrata({ pool, language, cardId = '' }) {
  try {
    const locale = normalizeOfficialLocale(language);
    const values = [locale];
    let cardFilter = '';
    if (text(cardId).trim()) {
      values.push(text(cardId).trim());
      cardFilter = 'AND errata.card_id = $2';
    }
    const { rows } = await pool.query(
      `${ERRATA_SELECT}
        WHERE active.key = 'active'
          ${cardFilter}
        ORDER BY errata.published_at DESC, errata.errata_id DESC`,
      values,
    );
    const items = rows.map((row) => mapErrataRow(row, locale));
    if (locale !== 'ja' && items.some((item) => item.effectiveLocale !== locale)) {
      return { ok: false, status: 503, error: 'Official errata translation release is incomplete' };
    }
    return { ok: true, body: { items, total: items.length, locale } };
  } catch {
    return { ok: false, status: 503, error: 'Official errata unavailable' };
  }
}

async function getPublicErrata({ pool, language, errataId }) {
  try {
    const locale = normalizeOfficialLocale(language);
    const cleanId = text(errataId).trim();
    if (!/^\d{3}$/.test(cleanId)) return { ok: false, status: 400, error: 'Invalid errata id' };
    const row = (
      await pool.query(
        `${ERRATA_SELECT}
          WHERE active.key = 'active' AND errata.errata_id = $2`,
        [locale, cleanId],
      )
    ).rows[0];
    if (!row) return { ok: false, status: 404, error: 'Official errata not found' };
    const item = mapErrataRow(row, locale);
    if (locale !== 'ja' && item.effectiveLocale !== locale) {
      return { ok: false, status: 503, error: 'Official errata translation release is incomplete' };
    }
    return { ok: true, body: { item } };
  } catch {
    return { ok: false, status: 503, error: 'Official errata unavailable' };
  }
}

function translationInput(body) {
  const status = WRITABLE_TRANSLATION_STATUSES.has(body.status) ? body.status : 'pending_review';
  return {
    locale: normalizeOfficialLocale(body.locale),
    status,
    provider: text(body.provider).slice(0, 60),
    model: text(body.model).slice(0, 120),
    reviewNote: text(body.reviewNote).slice(0, 2000),
  };
}

async function upsertOfficialQaTranslation({ pool, qaId, body, reviewerUserId, operation = 'manual' }) {
  const input = translationInput(body);
  if (input.locale === 'ja') return { ok: false, status: 400, error: 'Japanese is the source language' };
  const question = text(body.question).trim().slice(0, 10_000);
  const answer = text(body.answer).trim().slice(0, 20_000);
  if (['machine', 'verified'].includes(input.status) && (!question || !answer)) {
    return { ok: false, status: 400, error: 'Published translations require question and answer' };
  }
  if (['machine', 'verified'].includes(input.status)) {
    const validation = await validateQaTranslationCardNames({
      pool,
      qaId,
      locale: input.locale,
      question,
      answer,
    });
    if (!validation.ok) return validation;
  }
  const row = (
    await pool.query(
      `INSERT INTO official_qa_translations (
         qa_id, content_version, locale, question_text, answer_text, status,
         provider, model, review_note, reviewed_by_user_id, reviewed_at, updated_at
       )
       SELECT qa.id, qa.content_version, $2, $3, $4, $5, $6, $7, $8,
              CASE WHEN $5 = 'verified' THEN $9 ELSE NULL END,
              CASE WHEN $5 = 'verified' THEN NOW() ELSE NULL END,
              NOW()
         FROM official_qa_items qa
        WHERE qa.id = $1
       ON CONFLICT (qa_id, content_version, locale)
       DO UPDATE SET question_text = EXCLUDED.question_text,
                     answer_text = EXCLUDED.answer_text,
                     status = EXCLUDED.status,
                     provider = EXCLUDED.provider,
                     model = EXCLUDED.model,
                     review_note = EXCLUDED.review_note,
                     reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
                     reviewed_at = EXCLUDED.reviewed_at,
                     updated_at = NOW()
       RETURNING *`,
      [
        qaId,
        input.locale,
        question,
        answer,
        input.status,
        input.provider,
        input.model,
        input.reviewNote,
        reviewerUserId,
      ],
    )
  ).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Official Q&A not found' };
  await writeAuditLog(pool, {
    adminUserId: reviewerUserId,
    action: 'update_official_qa_translation',
    targetType: 'official_qa_translation',
    targetId: `${qaId}:${input.locale}`,
    details: { status: input.status, contentVersion: row.content_version },
  });
  officialRulingsTranslationWritesTotal.labels('qa', input.locale, input.status, operation).inc();
  return { ok: true, body: { translation: row } };
}

async function upsertOfficialErrataTranslation({ pool, errataId, body, reviewerUserId, operation = 'manual' }) {
  const input = translationInput(body);
  if (input.locale === 'ja') return { ok: false, status: 400, error: 'Japanese is the source language' };
  const fields = ['incorrectText', 'reason', 'replacementPolicy', 'usagePolicy'].map((key) =>
    text(body[key]).trim().slice(0, 20_000),
  );
  if (['machine', 'verified'].includes(input.status) && fields.some((value) => !value)) {
    return { ok: false, status: 400, error: 'Published errata translations require every field' };
  }
  const row = (
    await pool.query(
      `INSERT INTO card_official_errata_translations (
         errata_id, content_version, locale, incorrect_text, reason_text,
         replacement_policy_text, usage_policy_text, status, provider, model,
         review_note, reviewed_by_user_id, reviewed_at, updated_at
       )
       SELECT errata.errata_id, errata.content_version, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              CASE WHEN $7 = 'verified' THEN $11 ELSE NULL END,
              CASE WHEN $7 = 'verified' THEN NOW() ELSE NULL END,
              NOW()
         FROM card_official_errata errata
        WHERE errata.errata_id = $1
       ON CONFLICT (errata_id, content_version, locale)
       DO UPDATE SET incorrect_text = EXCLUDED.incorrect_text,
                     reason_text = EXCLUDED.reason_text,
                     replacement_policy_text = EXCLUDED.replacement_policy_text,
                     usage_policy_text = EXCLUDED.usage_policy_text,
                     status = EXCLUDED.status,
                     provider = EXCLUDED.provider,
                     model = EXCLUDED.model,
                     review_note = EXCLUDED.review_note,
                     reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
                     reviewed_at = EXCLUDED.reviewed_at,
                     updated_at = NOW()
       RETURNING *`,
      [errataId, input.locale, ...fields, input.status, input.provider, input.model, input.reviewNote, reviewerUserId],
    )
  ).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Official errata not found' };
  await writeAuditLog(pool, {
    adminUserId: reviewerUserId,
    action: 'update_official_errata_translation',
    targetType: 'official_errata_translation',
    targetId: `${errataId}:${input.locale}`,
    details: { status: input.status, contentVersion: row.content_version },
  });
  officialRulingsTranslationWritesTotal.labels('errata', input.locale, input.status, operation).inc();
  return { ok: true, body: { translation: row } };
}

async function getOfficialRulingsReleaseStatus({ pool }) {
  try {
    const row = (
      await pool.query(
        `SELECT release.id AS release_id, release.source_hash, release.translation_hash,
                release.card_dataset_hash, release.qa_count, release.errata_count,
                release.locales, release.app_version, release.build_id,
                release.source_checked_at, active.activated_at
           FROM official_rulings_active_release active
           JOIN official_rulings_releases release ON release.id=active.release_id
          WHERE active.key='active' AND release.status='active'`,
      )
    ).rows[0];
    if (!row) return { ok: false, status: 503, error: 'Official rulings release unavailable' };
    return {
      ok: true,
      body: {
        releaseId: text(row.release_id),
        sourceHash: text(row.source_hash),
        translationHash: text(row.translation_hash),
        cardDatasetHash: text(row.card_dataset_hash),
        qaCount: Number(row.qa_count),
        errataCount: Number(row.errata_count),
        locales: stringArray(row.locales),
        appVersion: text(row.app_version),
        buildId: text(row.build_id),
        sourceCheckedAt: isoDate(row.source_checked_at),
        activatedAt: isoDate(row.activated_at),
      },
    };
  } catch {
    return { ok: false, status: 503, error: 'Official rulings release unavailable' };
  }
}

module.exports = {
  getPublicErrata,
  getPublicQa,
  getOfficialRulingsReleaseStatus,
  listPublicErrata,
  listPublicQa,
  localizedQaTags,
  mapErrataRow,
  mapQaRow,
  normalizeOfficialLocale,
  upsertOfficialErrataTranslation,
  upsertOfficialQaTranslation,
};
