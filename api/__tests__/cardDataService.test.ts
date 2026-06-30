import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const {
  cardRowToDef,
  getAllCardI18n,
  getCardI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
  normalizeI18nLang,
} = require('../cardDataService.cjs') as {
  cardRowToDef: (row: Record<string, unknown>) => Record<string, unknown>;
  getAllCardI18n: (pool: Queryable) => Promise<Record<string, unknown>>;
  getCardI18n: (pool: Queryable, cardId: string) => Promise<Record<string, string>>;
  getGameConfig: (pool: Queryable) => Promise<Record<string, unknown>>;
  getPresetDecks: (pool: Queryable) => Promise<Array<Record<string, unknown>>>;
  getPublicCard: (
    pool: Queryable,
    cardId: string,
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  getPublicCards: (pool: Queryable, searchParams: URLSearchParams) => Promise<Array<Record<string, unknown>>>;
  normalizeI18nLang: (lang: unknown) => string | null;
};

const dbCard = {
  id: 'c_1',
  name: 'Card',
  en_name_official: 'Official',
  pack: 'pack-a',
  song: null,
  illustrator: null,
  rarity: null,
  element: '闇',
  type: 'Character',
  clock: 2,
  attack_night: 10,
  attack_day: 20,
  power_cost: 1,
  send_to_power: 2,
  effect: null,
  en_effect_official: 'Effect',
  image: '',
  errata: '',
};

function poolWithRows(...rowSets: unknown[][]): Queryable {
  let index = 0;
  return {
    query: vi.fn(async () => ({ rows: rowSets[Math.min(index++, rowSets.length - 1)] ?? [] })),
  };
}

describe('card data service', () => {
  it('maps DB card rows to API card definitions', () => {
    expect(cardRowToDef(dbCard)).toEqual({
      id: 'c_1',
      name: 'Card',
      enNameOfficial: 'Official',
      pack: 'pack-a',
      song: '',
      illustrator: '',
      rarity: '',
      element: '闇',
      type: 'Character',
      clock: 2,
      attack: { night: 10, day: 20 },
      powerCost: 1,
      sendToPower: 2,
      effect: '',
      enEffectOfficial: 'Effect',
      image: '',
      errata: '',
    });
  });

  it('returns PG cards and preserves public query params', async () => {
    const pool = poolWithRows([dbCard]);
    await expect(getPublicCards(pool, new URLSearchParams('pack=pack-a&element=%E9%97%87'))).resolves.toEqual([
      cardRowToDef(dbCard),
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE pack = $1 AND element = $2'), [
      'pack-a',
      '闇',
    ]);
  });

  it('returns i18n data from PG with canonical language aliases', async () => {
    expect(normalizeI18nLang('zhTW')).toBe('zh-TW');
    expect(normalizeI18nLang('xx')).toBeNull();

    await expect(getAllCardI18n(poolWithRows([{ card_id: 'c_1', lang: 'ja', effect_text: 'JP' }]))).resolves.toEqual({
      c_1: { ja: 'JP' },
    });
    await expect(getCardI18n(poolWithRows([{ lang: 'zhTW', effect_text: 'TW' }]), 'c_1')).resolves.toMatchObject({
      en: '',
      'zh-TW': 'TW',
    });
  });

  it('gets a single card from PG and returns 404 when missing', async () => {
    await expect(getPublicCard(poolWithRows([dbCard]), 'c_1')).resolves.toEqual({
      ok: true,
      body: cardRowToDef(dbCard),
    });
    await expect(getPublicCard(poolWithRows([]), 'missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Card not found',
    });
  });

  it('maps game config and preset deck rows', async () => {
    await expect(getGameConfig(poolWithRows([{ key: 'turnSeconds', value: 60 }]))).resolves.toEqual({
      turnSeconds: 60,
    });
    await expect(getPresetDecks(poolWithRows([{ id: 'p1', name: 'Preset', card_ids: ['a', 'b'] }]))).resolves.toEqual([
      { id: 'p1', name: 'Preset', cardIds: ['a', 'b'] },
    ]);
  });
});
