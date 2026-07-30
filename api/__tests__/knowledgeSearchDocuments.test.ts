import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { baseDocument, buildDeckDocuments, buildRuleSummaryDocuments, documentUid, publicCardText } =
  require('../knowledgeSearchDocuments.cjs') as {
    baseDocument: (input: Record<string, unknown>) => Record<string, unknown>;
    buildDeckDocuments: (
      pool: { query: ReturnType<typeof vi.fn> },
      localizedCards: Map<string, Record<string, { name: string }>>,
    ) => Promise<Array<Record<string, unknown>>>;
    buildRuleSummaryDocuments: (
      localized: Record<string, Record<string, unknown>>,
      fallback: Record<string, unknown>,
      documentId: string,
    ) => Array<Record<string, unknown>>;
    documentUid: (type: string, sourceId: string, locale: string) => string;
    publicCardText: (
      card: Record<string, unknown>,
      translations: Record<string, Record<string, string>>,
      locale: string,
    ) => { name: string; effect: string };
  };

describe('knowledge search documents', () => {
  it('uses only published card translations and falls back to official English', () => {
    const card = {
      name: '日本語名',
      effect: '日本語効果',
      enNameOfficial: 'Official name',
      enEffectOfficial: 'Official effect',
    };
    expect(
      publicCardText(
        card,
        { 'zh-TW': { name: '未複核名稱', effect: '未複核效果', reviewStatus: 'pending_review' } },
        'zh-TW',
      ),
    ).toEqual({ name: 'Official name', effect: 'Official effect' });
    expect(
      publicCardText(card, { 'zh-TW': { name: '標準名稱', effect: '標準效果', reviewStatus: 'verified' } }, 'zh-TW'),
    ).toEqual({ name: '標準名稱', effect: '標準效果' });
  });

  it('creates Meilisearch-compatible stable document IDs', () => {
    expect(documentUid('rule', 'grand:10.2(1)', 'zh-TW')).toBe('rule__grand_10_2_1___zh-TW');
  });

  it('normalizes missing fields without leaking arbitrary source properties', () => {
    expect(
      baseDocument({
        type: 'qa',
        locale: 'zh-TW',
        sourceId: '74',
        title: '問題',
        aliases: ['問題', '', '問題'],
        internalReviewNote: 'must not leak',
      }),
    ).toEqual(
      expect.not.objectContaining({
        internalReviewNote: expect.anything(),
      }),
    );
  });

  it('indexes only public, published and visible deck shares', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'ds_public',
          name: 'Chronos Deck',
          card_ids: ['4th_106'],
          owner_nickname: 'Player',
          published_at: '2026-07-30T00:00:00.000Z',
          updated_at: '2026-07-30T01:00:00.000Z',
        },
      ],
    }));
    const localizedCards = new Map([
      [
        '4th_106',
        {
          ja: { name: 'うにぐり' },
          'zh-TW': { name: '海膽栗子' },
          'zh-CN': { name: '海胆栗子' },
          'zh-HK': { name: '海膽栗子' },
          en: { name: 'Uniguri' },
          ko: { name: '성게밤' },
        },
      ],
    ]);

    const documents = await buildDeckDocuments({ query }, localizedCards);

    expect(query.mock.calls[0][0]).toContain("ds.publication_status = 'published'");
    expect(query.mock.calls[0][0]).toContain("ds.moderation_status = 'visible'");
    expect(query.mock.calls[0][0]).toContain("ds.visibility = 'public'");
    expect(documents).toHaveLength(6);
    expect(documents.find((item) => item.locale === 'zh-TW')).toMatchObject({
      type: 'deck',
      title: 'Chronos Deck',
      body: '海膽栗子',
      relatedCardIds: ['4th_106'],
    });
  });

  it('indexes localized rule document titles and summaries separately from sections', () => {
    const japanese = {
      id: 'grand',
      version: '1.2',
      publishedAt: '2026-07-30',
      sourceCheckedAt: '2026-07-30T01:00:00.000Z',
      source: { title: '総合ルール', summary: '日本語の概要' },
      localized: { title: '総合ルール', summary: '日本語の概要' },
    };
    const traditionalChinese = {
      ...japanese,
      localized: { title: '完整規則', summary: '繁體中文摘要' },
    };

    const documents = buildRuleSummaryDocuments({ ja: japanese, 'zh-TW': traditionalChinese }, japanese, 'grand');

    expect(documents).toHaveLength(6);
    expect(documents.find((item) => item.locale === 'zh-TW')).toMatchObject({
      sourceId: 'grand:__document__',
      title: '完整規則',
      body: '繁體中文摘要',
      url: '/rules/grand',
      documentId: 'grand',
      sortNumber: -1,
    });
    expect(documents.find((item) => item.locale === 'ko')).toMatchObject({
      title: '総合ルール',
      body: '日本語の概要',
    });
  });
});
