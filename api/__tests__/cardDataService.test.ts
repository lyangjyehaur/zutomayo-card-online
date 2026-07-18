import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const {
  cardRowToDef,
  getAllCardI18n,
  getAllCardTextsI18n,
  getCardI18n,
  getCardOfficialErrata,
  getCardTextsI18n,
  getGameConfig,
  getPresetDecks,
  getPublicCard,
  getPublicCards,
  normalizeI18nLang,
  officialErrataRowToDef,
} = require('../cardDataService.cjs') as {
  cardRowToDef: (row: Record<string, unknown>) => Record<string, unknown>;
  getAllCardI18n: (pool: Queryable) => Promise<Record<string, unknown>>;
  getAllCardTextsI18n: (pool: Queryable) => Promise<Record<string, unknown>>;
  getCardI18n: (pool: Queryable, cardId: string) => Promise<Record<string, string>>;
  getCardOfficialErrata: (pool: Queryable, cardId: string) => Promise<Record<string, unknown> | null>;
  getCardTextsI18n: (pool: Queryable, cardId: string) => Promise<Record<string, unknown>>;
  getGameConfig: (pool: Queryable) => Promise<Record<string, unknown>>;
  getPresetDecks: (pool: Queryable) => Promise<Array<Record<string, unknown>>>;
  getPublicCard: (
    pool: Queryable,
    cardId: string,
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  getPublicCards: (pool: Queryable, searchParams: URLSearchParams) => Promise<Array<Record<string, unknown>>>;
  normalizeI18nLang: (lang: unknown) => string | null;
  officialErrataRowToDef: (row: Record<string, unknown> | undefined) => Record<string, unknown> | null;
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
  has_official_errata: true,
  official_errata_id: '009',
  official_errata_affects_name: false,
  official_errata_affects_effect: true,
  official_errata_url: 'https://zutomayocard.net/errata/009/',
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
      hasOfficialErrata: true,
      officialErrataId: '009',
      officialErrataAffectsName: false,
      officialErrataAffectsEffect: true,
      officialErrataUrl: 'https://zutomayocard.net/errata/009/',
    });
  });

  it('filters cards by structured official errata status', async () => {
    const pool = poolWithRows([dbCard]);
    await expect(getPublicCards(pool, new URLSearchParams('errata=true'))).resolves.toEqual([cardRowToDef(dbCard)]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE has_official_errata = $1'), [true]);
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

    const pool = poolWithRows([{ card_id: 'c_1', lang: 'ja', effect_text: 'JP' }]);
    await expect(getAllCardI18n(pool)).resolves.toEqual({
      c_1: { ja: 'JP' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM cards'));
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('card_effects_i18n'));
    await expect(getCardI18n(poolWithRows([{ lang: 'zhTW', effect_text: 'TW' }]), 'c_1')).resolves.toMatchObject({
      en: '',
      'zh-TW': 'TW',
    });
  });

  it('returns unified card text with provenance and review status', async () => {
    const row = {
      card_id: 'c_1',
      lang: 'zhTW',
      name_text: '卡名',
      effect_text: '效果',
      name_source: 'bilingual_review',
      effect_source: 'bilingual_review',
      review_status: 'verified',
      review_note: 'Compared with official print text',
    };
    const expected = {
      name: '卡名',
      effect: '效果',
      nameSource: 'bilingual_review',
      effectSource: 'bilingual_review',
      reviewStatus: 'verified',
      reviewNote: 'Compared with official print text',
    };

    await expect(getAllCardTextsI18n(poolWithRows([row]))).resolves.toEqual({
      c_1: { 'zh-TW': expected },
    });
    await expect(getCardTextsI18n(poolWithRows([row]), 'c_1')).resolves.toMatchObject({
      en: { reviewStatus: 'pending_review' },
      'zh-TW': expected,
    });
  });

  it('projects effective Japanese and English card text from cards', async () => {
    const rows = [
      {
        card_id: '4th_76',
        lang: 'ja',
        name_text: 'グレくまくん (形)',
        effect_text: '',
        name_source: 'official_errata_notice',
        effect_source: 'official_card_print',
        review_status: 'official',
        review_note: 'Official errata 011',
      },
      {
        card_id: '4th_76',
        lang: 'en',
        name_text: 'GUREKUMA-KUN (Pain Give Form)',
        effect_text: '',
        name_source: 'official_errata_notice',
        effect_source: 'official_card_print',
        review_status: 'official',
        review_note: 'Official errata 011',
      },
    ];
    const pool = poolWithRows(rows);

    await expect(getCardTextsI18n(pool, '4th_76')).resolves.toMatchObject({
      ja: { name: 'グレくまくん (形)' },
      en: { name: 'GUREKUMA-KUN (Pain Give Form)' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SELECT id, 'en', en_name_official"), ['4th_76']);
  });

  it('returns the complete official errata comparison for card maintenance', async () => {
    const row = {
      errata_id: '001',
      card_id: 'c_1',
      published_at: new Date('2026-02-17T00:00:00.000Z'),
      affects_name: false,
      affects_effect: true,
      incorrect_text: 'old text',
      corrected_japanese_text: 'corrected Japanese',
      corrected_english_text: 'corrected English',
      corrected_english_status: 'verified',
      corrected_english_source: 'official_japanese_errata_translation',
      source_url: 'https://zutomayocard.net/errata/001/',
    };
    const expected = {
      errataId: '001',
      cardId: 'c_1',
      publishedAt: '2026-02-17',
      affectsName: false,
      affectsEffect: true,
      incorrectText: 'old text',
      correctedJapaneseText: 'corrected Japanese',
      correctedEnglishText: 'corrected English',
      correctedEnglishStatus: 'verified',
      correctedEnglishSource: 'official_japanese_errata_translation',
      sourceUrl: 'https://zutomayocard.net/errata/001/',
    };

    expect(officialErrataRowToDef(row)).toEqual(expected);
    const pool = poolWithRows([row]);
    await expect(getCardOfficialErrata(pool, 'c_1')).resolves.toEqual(expected);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('JOIN cards AS card'), ['c_1']);
    await expect(getCardOfficialErrata(poolWithRows([]), 'missing')).resolves.toBeNull();
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
