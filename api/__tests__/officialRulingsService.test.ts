import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { RULES_TERMINOLOGY, type RulesTerminologyLocale } from '../../src/rulesTerminology';

const require = createRequire(import.meta.url);
const { listPublicQa, localizedQaTags, mapErrataRow, mapQaRow, normalizeOfficialLocale, upsertOfficialQaTranslation } =
  require('../officialRulingsService.cjs') as {
    normalizeOfficialLocale: (value: unknown) => string;
    mapQaRow: (row: Record<string, unknown>, locale: string) => Record<string, unknown>;
    mapErrataRow: (row: Record<string, unknown>, locale: string) => Record<string, unknown>;
    listPublicQa: (options: {
      pool: { query: ReturnType<typeof vi.fn> };
      language: string;
      query?: string;
      tag?: string;
      cardId?: string;
    }) => Promise<{ ok: boolean; body: { items: Array<Record<string, unknown>> } }>;
    localizedQaTags: (tags: string[], locale: RulesTerminologyLocale) => string[];
    upsertOfficialQaTranslation: (options: {
      pool: { query: ReturnType<typeof vi.fn> };
      qaId: string;
      body: Record<string, unknown>;
      reviewerUserId: string;
    }) => Promise<{ ok: boolean; status?: number; error?: string }>;
  };

const qaRow = {
  id: 'qa_1',
  number: 1,
  published_at: '2026-02-17',
  question_ja: '質問',
  answer_ja: '回答',
  tags: ['基本ルール'],
  related_card_ids: ['1st_1'],
  source_url: 'https://zutomayocard.net/qa/',
  content_version: 2,
  last_seen_at: '2026-07-20T00:00:00.000Z',
};

describe('official rulings service', () => {
  it('normalizes frontend and HTTP locale aliases', () => {
    expect(normalizeOfficialLocale('zh-tw')).toBe('zh-TW');
    expect(normalizeOfficialLocale('zh_HK')).toBe('zh-HK');
    expect(normalizeOfficialLocale('ja-JP')).toBe('ja');
    expect(normalizeOfficialLocale('unknown')).toBe('zh-TW');
  });

  it('returns reviewed localized Q&A while preserving the Japanese source', () => {
    expect(
      mapQaRow(
        {
          ...qaRow,
          translated_question: '問題',
          translated_answer: '答案',
          translation_status: 'verified',
        },
        'zh-TW',
      ),
    ).toMatchObject({
      tagIds: ['基本ルール'],
      tags: ['基本規則'],
      source: { question: '質問', answer: '回答' },
      localized: { question: '問題', answer: '答案' },
      effectiveLocale: 'zh-TW',
      translationStatus: 'verified',
    });
  });

  it('localizes every Q&A filter tag with the canonical rules glossary', () => {
    const sourceTags = [
      '基本ルール',
      '対戦準備',
      '対戦の流れ',
      '効果処理',
      'カード裁定',
      'バトル',
      'キャラクター',
      'エンチャント',
      'エリアエンチャント',
    ];
    const glossaryKeys = [
      'basicRules',
      'matchSetup',
      'matchFlow',
      'effectResolution',
      'cardRulings',
      'battle',
      'character',
      'enchant',
      'areaEnchant',
    ] as const;

    for (const locale of Object.keys(RULES_TERMINOLOGY) as RulesTerminologyLocale[]) {
      expect(localizedQaTags(sourceTags, locale), locale).toEqual(
        glossaryKeys.map((key) => RULES_TERMINOLOGY[locale][key]),
      );
    }
  });

  it('preserves PostgreSQL date values in the server local timezone', () => {
    expect(mapQaRow({ ...qaRow, published_at: new Date(2026, 1, 16) }, 'ja')).toMatchObject({
      publishedAt: '2026-02-16',
    });
  });

  it('falls back to source Q&A when a translation is incomplete', () => {
    expect(
      mapQaRow(
        { ...qaRow, translated_question: '問題', translated_answer: '', translation_status: 'machine' },
        'zh-TW',
      ),
    ).toMatchObject({
      localized: { question: '質問', answer: '回答' },
      effectiveLocale: 'ja',
      translationStatus: 'source',
    });
  });

  it('filters the small public dataset by text, category, and card id', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          qaRow,
          { ...qaRow, id: 'qa_2', number: 2, question_ja: '別の質問', tags: ['バトル'], related_card_ids: [] },
        ],
      }),
    };
    const result = await listPublicQa({
      pool,
      language: 'ja',
      query: '質問',
      tag: '基本ルール',
      cardId: '1st_1',
    });
    expect(result.ok).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('translation.qa_id = qa.qa_id'), ['ja']);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ id: 'qa_1' });
  });

  it('filters localized Q&A with a stable Japanese tag ID', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { ...qaRow, translated_question: '問題', translated_answer: '答案', translation_status: 'verified' },
          {
            ...qaRow,
            id: 'qa_2',
            number: 2,
            tags: ['バトル'],
            translated_question: '其他問題',
            translated_answer: '其他答案',
            translation_status: 'verified',
          },
        ],
      }),
    };
    const result = await listPublicQa({ pool, language: 'zh-TW', tag: '基本ルール' });
    expect(result.ok).toBe(true);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ id: 'qa_1', tagIds: ['基本ルール'], tags: ['基本規則'] });
  });

  it('does not fall back to repository JSON when PostgreSQL has no Q&A rows', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await listPublicQa({ pool, language: 'ja' });
    expect(result.ok).toBe(true);
    expect(result.body.items).toEqual([]);
  });

  it('fails closed instead of serving Japanese from an incomplete active translation release', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [qaRow] }) };
    const result = await listPublicQa({ pool, language: 'zh-TW' });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it('uses reviewed card text for a localized corrected errata effect', () => {
    expect(
      mapErrataRow(
        {
          errata_id: '001',
          card_id: '1st_6',
          published_at: '2026-02-17',
          affects_name: false,
          affects_effect: true,
          incorrect_text: '誤り',
          corrected_japanese_text: '修正後',
          corrected_english_text: 'Corrected',
          card_name_ja: 'カード',
          card_name_en: 'Card',
          localized_name_text: '卡牌',
          localized_effect_text: '修正內容',
          localized_review_status: 'verified',
          reason_ja: '理由',
          replacement_policy_ja: '交換',
          usage_policy_ja: '使用',
          card_number: '006/104',
          pack: 'Pack',
          rarity: 'UR',
          source_url: 'https://zutomayocard.net/errata/001/',
          last_seen_at: '2026-07-20T00:00:00.000Z',
          content_version: 1,
        },
        'zh-TW',
      ),
    ).toMatchObject({
      cardName: '卡牌',
      localized: { correctedText: '修正內容' },
      translationStatus: 'source',
    });
  });

  it('rejects publishing an incomplete Q&A translation', async () => {
    const pool = { query: vi.fn() };
    await expect(
      upsertOfficialQaTranslation({
        pool,
        qaId: 'qa_1',
        body: { locale: 'en', question: '', answer: '', status: 'verified' },
        reviewerUserId: 'admin_1',
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a published Q&A translation that re-translates a reviewed card name', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '1st_1',
            name: 'テストカード',
            en_name_official: 'Test Card',
            localized_name_text: '校對卡名',
            localized_review_status: 'verified',
            related_card_ids: [],
            question_ja: '「テストカード」を使えますか？',
            answer_ja: '使えます。',
          },
        ],
      }),
    };

    await expect(
      upsertOfficialQaTranslation({
        pool,
        qaId: 'qa_1',
        body: { locale: 'zh-TW', question: '可以使用重新翻譯的卡名嗎？', answer: '可以。', status: 'verified' },
        reviewerUserId: 'admin_1',
      }),
    ).resolves.toMatchObject({ ok: false, status: 400, error: expect.stringContaining('校對卡名') });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CROSS JOIN cards card'), ['qa_1', 'zh-TW']);
  });
});
