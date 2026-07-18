/* global module, require */

const { CARD_SELECT, cardRowToDef, normalizeI18nLang } = require('./cardDataService.cjs');
const { writeAuditLog } = require('./adminService.cjs');

const CARD_SONG_TITLES_I18N_CONFIG_KEY = 'card_song_titles_i18n';
const CARD_SONG_TITLE_LANGS = new Set(['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko']);

function isValidSongTitleConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([song, translations]) =>
      song.trim().length > 0 &&
      translations &&
      typeof translations === 'object' &&
      !Array.isArray(translations) &&
      Object.entries(translations).every(
        ([lang, title]) => CARD_SONG_TITLE_LANGS.has(lang) && typeof title === 'string',
      ),
  );
}

function cardDefToDbParams(card) {
  const attack =
    card.attack && typeof card.attack === 'object'
      ? {
          night: Number.isFinite(Number(card.attack.night)) ? Math.trunc(Number(card.attack.night)) : null,
          day: Number.isFinite(Number(card.attack.day)) ? Math.trunc(Number(card.attack.day)) : null,
        }
      : null;

  return [
    card.id,
    card.name,
    card.enNameOfficial || '',
    card.pack,
    card.song || '',
    card.illustrator || '',
    card.rarity || '',
    card.element,
    card.type,
    Math.trunc(Number(card.clock) || 0),
    attack?.night ?? null,
    attack?.day ?? null,
    Math.trunc(Number(card.powerCost) || 0),
    Math.trunc(Number(card.sendToPower) || 0),
    card.effect || '',
    card.enEffectOfficial || '',
    card.image || '',
    card.errata || '',
    Boolean(card.hasOfficialErrata),
    card.officialErrataId || null,
    Boolean(card.officialErrataAffectsName),
    Boolean(card.officialErrataAffectsEffect),
    card.officialErrataUrl || '',
  ];
}

function normalizeCardForUpsert(id, body, baseCard) {
  const bodyCard = body && typeof body === 'object' ? body : {};
  const candidate = {
    ...(baseCard || {}),
    ...bodyCard,
    id,
  };
  if (baseCard?.attack && bodyCard.attack && typeof bodyCard.attack === 'object') {
    candidate.attack = { ...baseCard.attack, ...bodyCard.attack };
  }

  for (const field of ['name', 'pack', 'element', 'type']) {
    if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
      return null;
    }
  }

  return {
    id,
    name: String(candidate.name),
    enNameOfficial: typeof candidate.enNameOfficial === 'string' ? candidate.enNameOfficial : '',
    pack: String(candidate.pack),
    song: typeof candidate.song === 'string' ? candidate.song : '',
    illustrator: typeof candidate.illustrator === 'string' ? candidate.illustrator : '',
    rarity: typeof candidate.rarity === 'string' ? candidate.rarity : '',
    element: String(candidate.element),
    type: String(candidate.type),
    clock: Math.trunc(Number(candidate.clock) || 0),
    attack:
      candidate.attack && typeof candidate.attack === 'object'
        ? {
            night: Math.trunc(Number(candidate.attack.night) || 0),
            day: Math.trunc(Number(candidate.attack.day) || 0),
          }
        : null,
    powerCost: Math.trunc(Number(candidate.powerCost) || 0),
    sendToPower: Math.trunc(Number(candidate.sendToPower) || 0),
    effect: typeof candidate.effect === 'string' ? candidate.effect : '',
    enEffectOfficial: typeof candidate.enEffectOfficial === 'string' ? candidate.enEffectOfficial : '',
    image: typeof candidate.image === 'string' ? candidate.image : '',
    errata: typeof candidate.errata === 'string' ? candidate.errata : '',
    hasOfficialErrata: Boolean(baseCard?.hasOfficialErrata),
    officialErrataId: typeof baseCard?.officialErrataId === 'string' ? baseCard.officialErrataId : undefined,
    officialErrataAffectsName: Boolean(baseCard?.officialErrataAffectsName),
    officialErrataAffectsEffect: Boolean(baseCard?.officialErrataAffectsEffect),
    officialErrataUrl: typeof baseCard?.officialErrataUrl === 'string' ? baseCard.officialErrataUrl : undefined,
  };
}

async function upsertCardI18n(pool, cardId, body, adminUserId) {
  const lang = normalizeI18nLang(body?.lang);
  if (!lang) return { ok: false, status: 400, error: 'Unsupported language' };
  if (lang === 'ja' || lang === 'en') {
    return { ok: false, status: 400, error: 'Official text must be updated through the card endpoint' };
  }
  const hasName = typeof body?.nameText === 'string';
  const hasEffect = typeof body?.effectText === 'string';
  if (!hasName && !hasEffect) return { ok: false, status: 400, error: 'nameText or effectText required' };
  const allowedReviewStatuses = ['official', 'verified', 'pending_review'];
  if (body?.reviewStatus !== undefined && !allowedReviewStatuses.includes(body.reviewStatus)) {
    return { ok: false, status: 400, error: 'Unsupported review status' };
  }
  if (body?.reviewStatus === 'official') {
    return { ok: false, status: 400, error: 'Derived translations cannot be marked official' };
  }
  const reviewStatus = body?.reviewStatus || 'pending_review';
  if (reviewStatus === 'verified' && (!hasName || !hasEffect)) {
    return { ok: false, status: 400, error: 'Verified translations require both nameText and effectText' };
  }
  const card = (await pool.query('SELECT effect FROM cards WHERE id = $1', [cardId])).rows[0];
  if (!card) return { ok: false, status: 404, error: 'Card not found' };
  if (reviewStatus === 'verified') {
    if (!body.nameText.trim()) {
      return { ok: false, status: 400, error: 'Verified card name cannot be empty' };
    }
    if (String(card.effect || '').trim() && !body.effectText.trim()) {
      return { ok: false, status: 400, error: 'Verified card effect cannot be empty' };
    }
  }
  const source = typeof body?.source === 'string' && body.source ? body.source : 'admin';
  const nameSource = typeof body?.nameSource === 'string' && body.nameSource ? body.nameSource : source;
  const effectSource = typeof body?.effectSource === 'string' && body.effectSource ? body.effectSource : source;
  const reviewNote = typeof body?.reviewNote === 'string' ? body.reviewNote : '';

  await pool.query(
    `INSERT INTO card_texts_i18n (
       card_id, lang, name_text, effect_text, name_source, effect_source,
       review_status, review_note
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (card_id, lang) DO UPDATE SET
       name_text = CASE WHEN $9 THEN EXCLUDED.name_text ELSE card_texts_i18n.name_text END,
       effect_text = CASE WHEN $10 THEN EXCLUDED.effect_text ELSE card_texts_i18n.effect_text END,
       name_source = CASE WHEN $9 THEN EXCLUDED.name_source ELSE card_texts_i18n.name_source END,
       effect_source = CASE WHEN $10 THEN EXCLUDED.effect_source ELSE card_texts_i18n.effect_source END,
       review_status = EXCLUDED.review_status,
       review_note = EXCLUDED.review_note,
       updated_at = NOW()`,
    [
      cardId,
      lang,
      body.nameText || '',
      body.effectText || '',
      nameSource,
      effectSource,
      reviewStatus,
      reviewNote,
      hasName,
      hasEffect,
    ],
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'upsert_card_i18n',
    targetType: 'card_texts_i18n',
    targetId: cardId,
    details: {
      lang,
      ...(hasName ? { nameText: body.nameText } : {}),
      ...(hasEffect ? { effectText: body.effectText } : {}),
      reviewStatus,
      reviewNote,
      source,
      ...(body.nameSource ? { nameSource } : {}),
      ...(body.effectSource ? { effectSource } : {}),
    },
  });
  return { ok: true, body: { ok: true } };
}

async function upsertCard(pool, cardId, body, adminUserId) {
  const existing = (await pool.query(`${CARD_SELECT} FROM cards WHERE id = $1`, [cardId])).rows[0];
  const card = normalizeCardForUpsert(cardId, body, existing ? cardRowToDef(existing) : undefined);
  if (!card) return { ok: false, status: 400, error: 'Card requires name, pack, element, and type' };

  await pool.query(
    `INSERT INTO cards (
       id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
       attack_night, attack_day, power_cost, send_to_power, effect,
       en_effect_official, image, errata, has_official_errata, official_errata_id,
       official_errata_affects_name, official_errata_affects_effect, official_errata_url
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       en_name_official = EXCLUDED.en_name_official,
       pack = EXCLUDED.pack,
       song = EXCLUDED.song,
       illustrator = EXCLUDED.illustrator,
       rarity = EXCLUDED.rarity,
       element = EXCLUDED.element,
       type = EXCLUDED.type,
       clock = EXCLUDED.clock,
       attack_night = EXCLUDED.attack_night,
       attack_day = EXCLUDED.attack_day,
       power_cost = EXCLUDED.power_cost,
       send_to_power = EXCLUDED.send_to_power,
       effect = EXCLUDED.effect,
       en_effect_official = EXCLUDED.en_effect_official,
       image = EXCLUDED.image,
       errata = EXCLUDED.errata,
       has_official_errata = EXCLUDED.has_official_errata,
       official_errata_id = EXCLUDED.official_errata_id,
       official_errata_affects_name = EXCLUDED.official_errata_affects_name,
       official_errata_affects_effect = EXCLUDED.official_errata_affects_effect,
       official_errata_url = EXCLUDED.official_errata_url,
       updated_at = NOW()`,
    cardDefToDbParams(card),
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'upsert_card',
    targetType: 'card',
    targetId: cardId,
    details: { card },
  });
  return { ok: true, body: card };
}

async function upsertGameConfig(pool, key, body, adminUserId) {
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'value')) {
    return { ok: false, status: 400, error: 'Config value required' };
  }
  if (key === CARD_SONG_TITLES_I18N_CONFIG_KEY && !isValidSongTitleConfig(body.value)) {
    return { ok: false, status: 400, error: 'Invalid card song title translations' };
  }
  const description = typeof body.description === 'string' ? body.description : '';
  await pool.query(
    `INSERT INTO game_config (key, value, description)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       description = EXCLUDED.description,
       updated_at = NOW()`,
    [key, JSON.stringify(body.value), description],
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'upsert_config',
    targetType: 'game_config',
    targetId: key,
    details: { value: body.value, description },
  });
  return { ok: true, body: { key, value: body.value, description } };
}

module.exports = {
  cardDefToDbParams,
  isValidSongTitleConfig,
  normalizeCardForUpsert,
  upsertCard,
  upsertCardI18n,
  upsertGameConfig,
};
