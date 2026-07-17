/* global module */

const I18N_LANGS = ['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'];
const I18N_LANG_ALIASES = new Map([
  ['zhTW', 'zh-TW'],
  ['zhCN', 'zh-CN'],
  ['zhHK', 'zh-HK'],
]);

const CARD_SELECT = `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata, has_official_errata, official_errata_id,
                    official_errata_affects_name, official_errata_affects_effect, official_errata_url`;

function cardRowToDef(row) {
  const def = {
    id: row.id,
    name: row.name,
    pack: row.pack,
    song: row.song || '',
    illustrator: row.illustrator || '',
    rarity: row.rarity || '',
    element: row.element,
    type: row.type,
    clock: row.clock ?? 0,
    attack:
      row.attack_night === null ||
      row.attack_night === undefined ||
      row.attack_day === null ||
      row.attack_day === undefined
        ? null
        : { night: row.attack_night, day: row.attack_day },
    powerCost: row.power_cost ?? 0,
    sendToPower: row.send_to_power ?? 0,
    effect: row.effect || '',
    image: row.image || '',
    errata: row.errata || '',
    hasOfficialErrata: Boolean(row.has_official_errata),
    officialErrataAffectsName: Boolean(row.official_errata_affects_name),
    officialErrataAffectsEffect: Boolean(row.official_errata_affects_effect),
  };
  if (row.en_name_official) def.enNameOfficial = row.en_name_official;
  if (row.en_effect_official) def.enEffectOfficial = row.en_effect_official;
  if (row.official_errata_id) def.officialErrataId = row.official_errata_id;
  if (row.official_errata_url) def.officialErrataUrl = row.official_errata_url;
  return def;
}

function normalizeI18nLang(lang) {
  if (typeof lang !== 'string') return null;
  const canonical = I18N_LANG_ALIASES.get(lang) || lang;
  return I18N_LANGS.includes(canonical) ? canonical : null;
}

function cardTextRowToDef(row) {
  return {
    name: typeof row.name_text === 'string' ? row.name_text : '',
    effect: typeof row.effect_text === 'string' ? row.effect_text : '',
    nameSource: typeof row.name_source === 'string' ? row.name_source : '',
    effectSource: typeof row.effect_source === 'string' ? row.effect_source : '',
    reviewStatus: typeof row.review_status === 'string' ? row.review_status : 'pending_review',
    reviewNote: typeof row.review_note === 'string' ? row.review_note : '',
  };
}

async function getPublicCards(pool, searchParams) {
  try {
    const conditions = [];
    const values = [];
    for (const [param, column] of [
      ['pack', 'pack'],
      ['element', 'element'],
      ['type', 'type'],
    ]) {
      const value = searchParams.get(param);
      if (!value) continue;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
    const errata = searchParams.get('errata');
    if (errata === 'true' || errata === 'false') {
      values.push(errata === 'true');
      conditions.push(`has_official_errata = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const cards = (await pool.query(`${CARD_SELECT} FROM cards ${where} ORDER BY id`, values)).rows;
    return cards.map(cardRowToDef);
  } catch {
    return [];
  }
}

async function getOfficialCardDataVersion(pool) {
  try {
    const row = (
      await pool.query(
        `SELECT dataset_sha256, release_sha, card_count, applied_at
         FROM official_card_data_releases
         ORDER BY applied_at DESC, dataset_sha256 DESC
         LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    return {
      datasetSha256: row.dataset_sha256,
      releaseSha: row.release_sha,
      cardCount: Number(row.card_count),
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
    };
  } catch {
    return null;
  }
}

async function getAllCardI18n(pool) {
  try {
    const rows = (await pool.query('SELECT card_id, lang, effect_text FROM card_effects_i18n ORDER BY card_id, lang'))
      .rows;
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.card_id]) grouped[row.card_id] = {};
      grouped[row.card_id][row.lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
    }
    return grouped;
  } catch {
    return {};
  }
}

async function getCardI18n(pool, cardId) {
  const translations = Object.fromEntries(I18N_LANGS.map((lang) => [lang, '']));
  try {
    const rows = (await pool.query('SELECT lang, effect_text FROM card_effects_i18n WHERE card_id = $1', [cardId]))
      .rows;
    for (const row of rows) {
      const lang = normalizeI18nLang(row.lang);
      if (lang) translations[lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
    }
  } catch {
    // Return the empty language shape when PG is unavailable.
  }
  return translations;
}

async function getAllCardTextsI18n(pool) {
  try {
    const rows = (
      await pool.query(
        `SELECT card_id, lang, name_text, effect_text, name_source, effect_source,
                review_status, review_note
         FROM card_texts_i18n
         ORDER BY card_id, lang`,
      )
    ).rows;
    const grouped = {};
    for (const row of rows) {
      const lang = normalizeI18nLang(row.lang);
      if (!lang) continue;
      if (!grouped[row.card_id]) grouped[row.card_id] = {};
      grouped[row.card_id][lang] = cardTextRowToDef(row);
    }
    return grouped;
  } catch {
    return {};
  }
}

async function getCardTextsI18n(pool, cardId) {
  const translations = Object.fromEntries(
    I18N_LANGS.map((lang) => [
      lang,
      cardTextRowToDef({
        name_text: '',
        effect_text: '',
        name_source: '',
        effect_source: '',
        review_status: 'pending_review',
        review_note: '',
      }),
    ]),
  );
  try {
    const rows = (
      await pool.query(
        `SELECT lang, name_text, effect_text, name_source, effect_source,
                review_status, review_note
         FROM card_texts_i18n
         WHERE card_id = $1`,
        [cardId],
      )
    ).rows;
    for (const row of rows) {
      const lang = normalizeI18nLang(row.lang);
      if (lang) translations[lang] = cardTextRowToDef(row);
    }
  } catch {
    // Return the empty language shape when PG is unavailable.
  }
  return translations;
}

async function getPublicCard(pool, cardId) {
  try {
    const card = (await pool.query(`${CARD_SELECT} FROM cards WHERE id = $1`, [cardId])).rows[0];
    if (card) return { ok: true, body: cardRowToDef(card) };
    return { ok: false, status: 404, error: 'Card not found' };
  } catch {
    return { ok: false, status: 503, error: 'Card data unavailable' };
  }
}

async function getGameConfig(pool) {
  const rows = (await pool.query('SELECT key, value FROM game_config ORDER BY key')).rows;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function getPresetDecks(pool) {
  const rows = (await pool.query('SELECT id, name, card_ids FROM preset_decks ORDER BY id')).rows;
  return rows.map((deck) => ({
    id: deck.id,
    name: deck.name,
    cardIds: Array.isArray(deck.card_ids) ? deck.card_ids : [],
  }));
}

module.exports = {
  CARD_SELECT,
  cardTextRowToDef,
  cardRowToDef,
  getAllCardI18n,
  getAllCardTextsI18n,
  getCardI18n,
  getCardTextsI18n,
  getGameConfig,
  getOfficialCardDataVersion,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
  normalizeI18nLang,
};
