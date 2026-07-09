/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const { CARD_SELECT, cardRowToDef, normalizeI18nLang } = require('./cardDataService.cjs');
const { writeAuditLog } = require('./adminService.cjs');

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
  };
}

async function upsertCardI18n(pool, cardId, body, adminUserId) {
  const lang = normalizeI18nLang(body?.lang);
  if (!lang) return { ok: false, status: 400, error: 'Unsupported language' };
  if (typeof body?.effectText !== 'string') return { ok: false, status: 400, error: 'effectText required' };

  await pool.query(
    `INSERT INTO card_effects_i18n (card_id, lang, effect_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (card_id, lang) DO UPDATE SET
       effect_text = EXCLUDED.effect_text`,
    [cardId, lang, body.effectText],
  );
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'upsert_card_i18n',
    targetType: 'card_effects_i18n',
    targetId: cardId,
    details: { lang, effectText: body.effectText },
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
       en_effect_official, image, errata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
  normalizeCardForUpsert,
  upsertCard,
  upsertCardI18n,
  upsertGameConfig,
};
