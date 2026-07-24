import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  checkOfficialSources,
  generateOfficialTranslation,
  getOfficialSyncStatus,
  listOfficialTranslations,
  validateProtectedTranslation,
} = require('../officialRulingsAdminService.cjs') as {
  listOfficialTranslations: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getOfficialSyncStatus: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  checkOfficialSources: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  generateOfficialTranslation: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  validateProtectedTranslation: (source: string, translated: string) => void;
};
const { normalizeQaRows, parseErrataDetail, parseErrataList } = require('../officialRulingsSource.cjs') as {
  normalizeQaRows: (rows: unknown[]) => unknown[];
  parseErrataList: (html: string) => Array<{ errataId: string; publishedAt: string }>;
  parseErrataDetail: (html: string, meta: { errataId: string; publishedAt: string }) => Record<string, unknown>;
};
const { register } = require('../observability.cjs') as {
  register: { getSingleMetric: (name: string) => unknown };
};

describe('official rulings admin service', () => {
  it('shares fail-closed official source parsers with the API runtime', () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `qa_${index + 1}`,
      number: index + 1,
      date: '2026-02-17T00:00:00.000Z',
      question: `質問${index + 1}`,
      answer: '回答',
      public: '公開',
    }));
    rows.push({ id: 'qa_999', number: 999, date: '2026-02-17', question: 'draft', answer: 'draft', public: '' });
    expect(normalizeQaRows(rows)).toHaveLength(50);

    const list = parseErrataList('<main><a href="/errata/001/"><p>2026.02.17</p></a></main>');
    const values = [
      '誤',
      '誤った文章',
      '正',
      '修正後文章',
      'カード名',
      'カード',
      'レアリティ',
      'UR',
      '収録商品',
      'THE WORLD IS CHANGING',
      'カード番号',
      '006/104',
      '理由',
      '交換方針',
      '使用可能です。',
    ];
    expect(
      parseErrataDetail(`<main>${values.map((value) => `<p>${value}</p>`).join('')}</main>`, list[0]),
    ).toMatchObject({ cardId: '1st_6', errataId: '001' });
  });

  it('lists current-version Q&A and errata translation coverage', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'qa_1',
              number: 1,
              content_version: 2,
              question_ja: '質問',
              answer_ja: '回答',
              question_text: '問題',
              answer_text: '答案',
              translation_status: 'verified',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              errata_id: '001',
              card_id: '1st_6',
              card_name: 'カード',
              content_version: 1,
              incorrect_text: '誤り',
              reason_ja: '理由',
              replacement_policy_ja: '交換',
              usage_policy_ja: '使用',
              translation_status: null,
            },
          ],
        }),
    };
    const result = (await listOfficialTranslations({ pool, language: 'zh-TW' })) as {
      body: { coverage: Record<string, number>; items: unknown[] };
    };
    expect(result.body.coverage).toMatchObject({ total: 2, translated: 1, verified: 1, pending: 1 });
    expect(result.body.items).toHaveLength(2);
  });

  it('generates a protected machine Q&A translation and leaves verification to an admin', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM official_qa_items')) {
          return {
            rows: [
              {
                id: 'qa_1',
                content_version: 1,
                question_ja: 'カードを１枚選ぶ',
                answer_ja: 'SEND TO POWER★★に置く',
                related_card_ids: [],
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO official_qa_translations')) {
          return { rows: [{ qa_id: 'qa_1', content_version: 1, locale: 'zh-TW', status: 'machine' }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const translateText = vi.fn().mockResolvedValue({
      translatedContent: JSON.stringify({ question: '選擇１張卡牌', answer: '放到 SEND TO POWER★★' }),
      provider: 'test',
      model: 'model',
    });
    const result = await generateOfficialTranslation({
      pool,
      resourceType: 'qa',
      resourceId: 'qa_1',
      language: 'zh-TW',
      adminUserId: 'admin_1',
      translateText,
    });
    expect(result).toMatchObject({ ok: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO official_qa_translations'),
      expect.arrayContaining(['machine']),
    );
  });

  it('restores reviewed PostgreSQL card names after machine translation', async () => {
    const card = {
      id: '1st_1',
      name: 'テストカード',
      en_name_official: 'Test Card',
      localized_name_text: '校對卡名',
      localized_review_status: 'verified',
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM official_qa_items')) {
          return {
            rows: [
              {
                id: 'qa_1',
                content_version: 1,
                question_ja: '「テストカード」を使えますか？',
                answer_ja: '「テストカード」を使えます。',
                related_card_ids: [],
              },
            ],
          };
        }
        if (sql.includes('FROM cards card')) return { rows: [card] };
        if (sql.includes('JOIN cards card ON card.id = ANY')) {
          return {
            rows: [{ ...card, question_ja: 'テストカードを使えますか？', answer_ja: 'テストカードを使えます。' }],
          };
        }
        if (sql.includes('INSERT INTO official_qa_translations')) {
          return { rows: [{ qa_id: 'qa_1', content_version: 1, locale: 'zh-TW', status: 'machine' }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const translateText = vi.fn().mockResolvedValue({
      translatedContent: JSON.stringify({
        question: '可以使用 [[CARD:1st_1]] 嗎？',
        answer: '可以使用 [[CARD:1st_1]]。',
      }),
      provider: 'test',
      model: 'model',
    });

    const result = await generateOfficialTranslation({
      pool,
      resourceType: 'qa',
      resourceId: 'qa_1',
      language: 'zh-TW',
      adminUserId: 'admin_1',
      translateText,
    });

    expect(result).toMatchObject({ ok: true });
    const request = JSON.parse(translateText.mock.calls[0][0].text);
    expect(request).toMatchObject({
      question: '「[[CARD:1st_1]]」を使えますか？',
      canonicalCardNames: { '1st_1': '校對卡名' },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO official_qa_translations'),
      expect.arrayContaining(['可以使用 校對卡名 嗎？', '可以使用 校對卡名。']),
    );
  });

  it('rejects generated translations that alter protected rules tokens', () => {
    expect(() => validateProtectedTranslation('１枚 SEND TO POWER★★', '1 張 SEND TO POWER★')).toThrow(/protected/);
  });

  it('records a failed source check instead of replacing the last published content', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO official_rulings_sync_runs')) return { rows: [], rowCount: 1 };
        if (sql.includes("SET status = 'failed'")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await checkOfficialSources({
      pool,
      adminUserId: 'admin_1',
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }),
    });
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"), expect.any(Array));
  });

  it('returns recent sync runs in camelCase', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'official_sync_1',
            trigger_source: 'admin',
            status: 'no_change',
            qa_local_count: 74,
            qa_remote_count: 74,
            errata_local_count: 12,
            errata_remote_count: 12,
            diff: {},
            started_at: '2026-07-20T00:00:00.000Z',
          },
        ],
      }),
    };
    const result = (await getOfficialSyncStatus({ pool })) as { body: { runs: unknown[] } };
    expect(result.body.runs[0]).toMatchObject({ qaLocalCount: 74, errataRemoteCount: 12 });
  });

  it('registers bounded-cardinality sync and translation metrics', () => {
    expect(register.getSingleMetric('official_rulings_sync_runs_total')).toBeTruthy();
    expect(register.getSingleMetric('official_rulings_sync_changes_total')).toBeTruthy();
    expect(register.getSingleMetric('official_rulings_translation_writes_total')).toBeTruthy();
    expect(register.getSingleMetric('official_rulings_translation_failures_total')).toBeTruthy();
  });
});
