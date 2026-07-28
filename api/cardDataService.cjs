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
                    official_errata_affects_name, official_errata_affects_effect, official_errata_url,
                    catalog_status, distribution_type, publication_status, play_status, play_status_reason,
                    source_url, source_note, source_sha256`;

const CARD_TEXTS_SELECT = `SELECT card_id, lang, name_text, effect_text, name_source, effect_source,
                                 review_status, review_note
                          FROM (
                            SELECT card_id, lang, name_text, effect_text, name_source, effect_source,
                                   review_status, review_note
                            FROM card_texts_i18n AS translation
                            JOIN cards AS card ON card.id = translation.card_id
                            WHERE lang NOT IN ('ja', 'en')
                              AND card.publication_status = 'published'
                              AND card.play_status IN ('playable', 'display_only')
                            UNION ALL
                            SELECT id, 'ja', name, effect,
                                   CASE WHEN official_errata_affects_name
                                     THEN 'official_errata_notice' ELSE 'official_card_print' END,
                                   CASE WHEN official_errata_affects_effect
                                     THEN 'official_errata_notice' ELSE 'official_card_print' END,
                                   'official',
                                   CASE WHEN has_official_errata
                                     THEN CONCAT('Official errata ', official_errata_id, ': ', official_errata_url)
                                     ELSE '' END
                            FROM cards
                            WHERE publication_status = 'published' AND play_status IN ('playable', 'display_only')
                            UNION ALL
                            SELECT id, 'en', en_name_official, en_effect_official,
                                   CASE WHEN official_errata_affects_name
                                     THEN 'official_errata_notice' ELSE 'official_card_print' END,
                                   CASE WHEN official_errata_affects_effect
                                     THEN 'official_errata_notice' ELSE 'official_card_print' END,
                                   'official',
                                   CASE WHEN has_official_errata
                                     THEN CONCAT('Official errata ', official_errata_id, ': ', official_errata_url)
                                     ELSE '' END
                            FROM cards
                            WHERE publication_status = 'published' AND play_status IN ('playable', 'display_only')
                          ) AS effective_card_texts`;

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
    catalogStatus: row.catalog_status || 'listed',
    distributionType: row.distribution_type || 'standard',
    publicationStatus: row.publication_status || 'published',
    playStatus: row.play_status || 'playable',
    playStatusReason: row.play_status_reason || '',
    sourceUrl: row.source_url || '',
    sourceNote: row.source_note || '',
    sourceSha256: row.source_sha256 || '',
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

function officialErrataRowToDef(row) {
  if (!row) return null;
  return {
    errataId: typeof row.errata_id === 'string' ? row.errata_id : '',
    cardId: typeof row.card_id === 'string' ? row.card_id : '',
    publishedAt:
      row.published_at instanceof Date
        ? row.published_at.toISOString().slice(0, 10)
        : String(row.published_at || '').slice(0, 10),
    affectsName: Boolean(row.affects_name),
    affectsEffect: Boolean(row.affects_effect),
    incorrectText: typeof row.incorrect_text === 'string' ? row.incorrect_text : '',
    correctedJapaneseText: typeof row.corrected_japanese_text === 'string' ? row.corrected_japanese_text : '',
    correctedEnglishText: typeof row.corrected_english_text === 'string' ? row.corrected_english_text : '',
    correctedEnglishStatus:
      typeof row.corrected_english_status === 'string' ? row.corrected_english_status : 'pending_review',
    correctedEnglishSource: typeof row.corrected_english_source === 'string' ? row.corrected_english_source : '',
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : '',
  };
}

async function getPublicCards(pool, searchParams) {
  try {
    const conditions = ["publication_status = 'published'", "play_status = 'playable'"];
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

async function getCatalogCards(pool, searchParams = new URLSearchParams()) {
  try {
    const conditions = ["publication_status = 'published'", "play_status IN ('playable', 'display_only')"];
    const values = [];
    for (const [param, column] of [
      ['pack', 'pack'],
      ['element', 'element'],
      ['type', 'type'],
      ['distributionType', 'distribution_type'],
    ]) {
      const value = searchParams.get(param);
      if (!value) continue;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
    const query = searchParams.get('query')?.trim();
    if (query) {
      values.push(`%${query}%`);
      conditions.push(
        `(id ILIKE $${values.length} OR name ILIKE $${values.length} OR en_name_official ILIKE $${values.length} OR song ILIKE $${values.length} OR pack ILIKE $${values.length})`,
      );
    }
    const rows = (await pool.query(`${CARD_SELECT} FROM cards WHERE ${conditions.join(' AND ')} ORDER BY id`, values))
      .rows;
    return rows.map(cardRowToDef);
  } catch {
    return [];
  }
}

async function getAdminCards(pool) {
  try {
    const rows = (await pool.query(`${CARD_SELECT} FROM cards ORDER BY id`)).rows;
    return rows.map(cardRowToDef);
  } catch {
    return [];
  }
}

function normalizedCardText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s（）()「」『』・･_\-—―,，.。!！?？]/gu, '')
    .toLowerCase();
}

function recommendationReasons(source, candidate) {
  const reasons = [];
  if (source.song && candidate.song && source.song === candidate.song) reasons.push('same_song');
  const sourceName = normalizedCardText(source.name);
  const candidateEffect = normalizedCardText(candidate.effect);
  const sourceSong = normalizedCardText(source.song);
  if (sourceName && candidateEffect.includes(sourceName)) reasons.push('named_card_reference');
  if (sourceSong && candidateEffect.includes(sourceSong)) reasons.push('song_reference');
  return reasons;
}

async function getCardRecommendations(pool, cardId, limit = 12) {
  const cards = await getCatalogCards(pool);
  const source = cards.find((card) => card.id === cardId);
  if (!source) return { ok: false, status: 404, error: 'Card not found' };
  const safeLimit = Math.max(1, Math.min(24, Number(limit) || 12));
  let approved = [];
  try {
    const relations = (
      await pool.query(
        `SELECT target_card_id, primary_category, categories, score, rationale_ja, rationale_i18n
         FROM card_synergy_relations
         WHERE source_card_id = $1 AND kind = 'enables' AND review_status = 'approved'
           AND recommendation_eligible = TRUE
         ORDER BY score DESC, target_card_id
         LIMIT $2`,
        [cardId, safeLimit],
      )
    ).rows;
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    approved = relations
      .map((relation) => {
        const card = cardsById.get(relation.target_card_id);
        if (!card) return null;
        const categories = Array.isArray(relation.categories) ? relation.categories : [];
        return {
          card,
          score: Number(relation.score),
          reasons: [`synergy_${relation.primary_category}`],
          categories,
          rationale: relation.rationale_ja || '',
          rationaleI18n: relation.rationale_i18n || {},
          source: 'approved',
          recommendationType: 'synergy',
        };
      })
      .filter(Boolean);
  } catch {
    approved = [];
  }
  const approvedIds = new Set(approved.map((entry) => entry.card.id));
  const heuristic = cards
    .filter((card) => card.id !== source.id)
    .map((card) => {
      const reasons = recommendationReasons(source, card);
      const score = reasons.reduce(
        (total, reason) =>
          total +
          ({
            named_card_reference: 92,
            song_reference: 88,
            same_song: 78,
          }[reason] || 0),
        0,
      );
      const recommendationType = reasons.some((reason) => reason !== 'same_song') ? 'synergy' : 'same_song';
      return {
        card,
        score,
        reasons,
        categories: [],
        rationale: '',
        rationaleI18n: {},
        source: 'heuristic',
        recommendationType,
      };
    })
    .filter((entry) => entry.score > 0)
    .filter((entry) => !approvedIds.has(entry.card.id))
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, safeLimit - approved.length);
  return { ok: true, body: [...approved, ...heuristic].slice(0, safeLimit) };
}

async function getAllCardTextsI18n(pool) {
  try {
    const rows = (await pool.query(`${CARD_TEXTS_SELECT} ORDER BY card_id, lang`)).rows;
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
    const rows = (await pool.query(`${CARD_TEXTS_SELECT} WHERE card_id = $1 ORDER BY lang`, [cardId])).rows;
    for (const row of rows) {
      const lang = normalizeI18nLang(row.lang);
      if (lang) translations[lang] = cardTextRowToDef(row);
    }
  } catch {
    // Return the empty language shape when PG is unavailable.
  }
  return translations;
}

async function getCardOfficialErrata(pool, cardId) {
  const row = (
    await pool.query(
      `SELECT errata.errata_id, errata.card_id, errata.published_at,
              errata.affects_name, errata.affects_effect, errata.incorrect_text,
              CASE WHEN errata.affects_name THEN card.name ELSE card.effect END
                AS corrected_japanese_text,
              CASE WHEN errata.affects_name THEN card.en_name_official ELSE card.en_effect_official END
                AS corrected_english_text,
              errata.corrected_english_status, errata.corrected_english_source, errata.source_url
       FROM card_official_errata AS errata
       JOIN cards AS card ON card.id = errata.card_id
       WHERE errata.card_id = $1`,
      [cardId],
    )
  ).rows[0];
  return officialErrataRowToDef(row);
}

async function getPublicCard(pool, cardId) {
  try {
    const card = (
      await pool.query(
        `${CARD_SELECT} FROM cards
         WHERE id = $1 AND publication_status = 'published' AND play_status = 'playable'`,
        [cardId],
      )
    ).rows[0];
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
  getAllCardTextsI18n,
  getAdminCards,
  getCardRecommendations,
  getCatalogCards,
  getCardOfficialErrata,
  getCardTextsI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
  normalizeI18nLang,
  officialErrataRowToDef,
};
