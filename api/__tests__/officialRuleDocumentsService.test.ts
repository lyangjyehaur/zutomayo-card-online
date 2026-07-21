import { describe, expect, it, vi } from 'vitest';

const { getPublicRuleDocument, mapRuleDocumentRows } = await import('../officialRuleDocumentsService.cjs');

const baseRow = {
  document_id: 'grand',
  document_version: '1.0.0',
  title_ja: 'グランドルール',
  summary_ja: '複雑なルールを説明します。',
  published_at: '2026-07-21',
  source_url: 'https://example.test/grand.pdf',
  source_sha256: 'a'.repeat(64),
  source_page_count: 8,
  source_checked_at: '2026-07-21T08:00:00.000Z',
  activated_at: '2026-07-21T09:00:00.000Z',
  section_number: '',
  parent_section_id: null,
  level: 1,
  page_start: 1,
  page_end: 1,
};

describe('official rule documents service', () => {
  it('maps translated metadata and ordered sections while preserving Japanese source', () => {
    const document = mapRuleDocumentRows(
      [
        {
          ...baseRow,
          section_id: 'overview',
          sort_order: 0,
          section_title_ja: 'グランドルール',
          body_ja: '複雑なルールを説明します。',
          translated_title: 'Grand Rules',
          translated_body: '正式的進階規則。',
          translation_status: 'verified',
        },
        {
          ...baseRow,
          section_id: 'game-overview',
          section_number: '1',
          sort_order: 1,
          section_title_ja: 'ゲームの概要',
          body_ja: 'ゲームは2名で行います。',
          translated_title: '遊戲概要',
          translated_body: '遊戲由兩名玩家進行。',
          translation_status: 'verified',
        },
      ],
      'zh-TW',
    );
    expect(document).toMatchObject({
      id: 'grand',
      localized: { title: 'Grand Rules', summary: '正式的進階規則。' },
      translationStatus: 'verified',
      sections: [
        {
          id: 'game-overview',
          source: { title: 'ゲームの概要' },
          localized: { title: '遊戲概要' },
          effectiveLocale: 'zh-TW',
        },
      ],
    });
  });

  it('fails closed when one section is missing the requested translation', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            ...baseRow,
            section_id: 'overview',
            sort_order: 0,
            section_title_ja: 'グランドルール',
            body_ja: '概要',
            translated_title: 'Grand Rules',
            translated_body: '概要翻譯',
            translation_status: 'verified',
          },
          {
            ...baseRow,
            section_id: 'game-overview',
            sort_order: 1,
            section_title_ja: 'ゲームの概要',
            body_ja: '本文',
            translated_title: null,
            translated_body: null,
            translation_status: null,
          },
        ],
      }),
    };
    await expect(getPublicRuleDocument({ pool, language: 'zh-TW', documentId: 'grand' })).resolves.toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('rejects unknown document ids without querying PostgreSQL', async () => {
    const pool = { query: vi.fn() };
    await expect(getPublicRuleDocument({ pool, language: 'en', documentId: 'other' })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
