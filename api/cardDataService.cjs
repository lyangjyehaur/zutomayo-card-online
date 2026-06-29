/* global module */

const I18N_LANGS = ['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'];
const I18N_LANG_ALIASES = new Map([
  ['zhTW', 'zh-TW'],
  ['zhCN', 'zh-CN'],
  ['zhHK', 'zh-HK'],
]);

const CARD_SELECT = `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata`;

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
  };
  if (row.en_name_official) def.enNameOfficial = row.en_name_official;
  if (row.en_effect_official) def.enEffectOfficial = row.en_effect_official;
  return def;
}

function filterStaticCards(staticCards, searchParams) {
  let cards = staticCards;
  const pack = searchParams.get('pack');
  const element = searchParams.get('element');
  const type = searchParams.get('type');
  if (pack) cards = cards.filter((card) => card.pack === pack);
  if (element) cards = cards.filter((card) => card.element === element);
  if (type) cards = cards.filter((card) => card.type === type);
  return cards;
}

function normalizeI18nLang(lang) {
  if (typeof lang !== 'string') return null;
  const canonical = I18N_LANG_ALIASES.get(lang) || lang;
  return I18N_LANGS.includes(canonical) ? canonical : null;
}

function staticI18nForCard(staticCardI18n, cardId) {
  const source = staticCardI18n && typeof staticCardI18n === 'object' ? staticCardI18n[cardId] : null;
  return Object.fromEntries(
    I18N_LANGS.map((lang) => [lang, source && typeof source[lang] === 'string' ? source[lang] : '']),
  );
}

async function getPublicCards(pool, searchParams, staticCards) {
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
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const cards = (await pool.query(`${CARD_SELECT} FROM cards ${where} ORDER BY id`, values)).rows;
    if (cards.length > 0) return cards.map(cardRowToDef);

    const hasSeededCards = (await pool.query('SELECT 1 FROM cards LIMIT 1')).rows.length > 0;
    if (hasSeededCards) return [];
  } catch {
    // Keep the API usable in offline/dev environments where PG card data is not available.
  }
  return filterStaticCards(staticCards, searchParams);
}

async function getAllCardI18n(pool, staticCardI18n) {
  try {
    const rows = (await pool.query('SELECT card_id, lang, effect_text FROM card_effects_i18n ORDER BY card_id, lang')).rows;
    if (rows.length > 0) {
      const grouped = {};
      for (const row of rows) {
        if (!grouped[row.card_id]) grouped[row.card_id] = {};
        grouped[row.card_id][row.lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
      }
      return grouped;
    }
  } catch {
    // Fallback below.
  }
  return staticCardI18n;
}

async function getCardI18n(pool, staticCardI18n, cardId) {
  const translations = staticI18nForCard(staticCardI18n, cardId);
  try {
    const rows = (await pool.query('SELECT lang, effect_text FROM card_effects_i18n WHERE card_id = $1', [cardId])).rows;
    for (const row of rows) {
      const lang = normalizeI18nLang(row.lang);
      if (lang) translations[lang] = typeof row.effect_text === 'string' ? row.effect_text : '';
    }
  } catch {
    // Static fallback already populated above.
  }
  return translations;
}

async function getPublicCard(pool, staticCardMap, cardId) {
  try {
    const card = (await pool.query(`${CARD_SELECT} FROM cards WHERE id = $1`, [cardId])).rows[0];
    if (card) return { ok: true, body: cardRowToDef(card) };
  } catch {
    // Static fallback below.
  }

  const fallback = staticCardMap.get(cardId);
  if (!fallback) return { ok: false, status: 404, error: 'Card not found' };
  return { ok: true, body: fallback };
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
  cardRowToDef,
  filterStaticCards,
  getAllCardI18n,
  getCardI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
  normalizeI18nLang,
  staticI18nForCard,
};
