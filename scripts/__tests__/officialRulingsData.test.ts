import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCanonicalQaCardNames,
  errataHashInput,
  loadOfficialTranslationsSnapshot,
  normalizeOfficialText,
  officialCorrectedNameMatches,
  normalizeQaRows,
  officialContentHash,
  qaHashInput,
  referencedQaCardIds,
  validateOfficialTranslation,
  type OfficialErrataSnapshotRow,
  type OfficialTranslationsSnapshot,
  type OfficialQaSnapshotRow,
} from '../officialRulingsData';
import {
  contentChanges,
  fixtureFileForUrl,
  parseErrataDetail,
  parseErrataList,
  shouldFailSyncCheck,
} from '../sync-official-rulings';

describe('official rulings source normalization', () => {
  it('normalizes line breaks and removes executable markup', () => {
    expect(normalizeOfficialText('前半<br/>後半<script>alert(1)</script>')).toBe('前半\n後半');
  });

  it('matches bilingual corrected names across full-width punctuation and spacing', () => {
    expect(officialCorrectedNameMatches('グレくまくん（形） GUREKUMA-KUN (Pain Give Form)', 'グレくまくん (形)')).toBe(
      true,
    );
    expect(officialCorrectedNameMatches('グレくまくん（形）', '別のカード')).toBe(false);
  });

  it('imports only records explicitly marked public from the raw Q&A source', () => {
    const rows = normalizeQaRows(
      [
        {
          id: 'qa_1',
          number: 1,
          date: '2026-02-17T00:00:00.000Z',
          question: '質問',
          answer: '回答',
          tags: ['基本ルール'],
          card: [],
          public: '公開',
        },
        {
          id: 'qa_2',
          number: 2,
          date: '2026-02-17T00:00:00.000Z',
          question: '未公開',
          answer: '回答',
          public: '',
        },
      ],
      { requireExplicitPublic: true },
    );
    expect(rows.map((row) => row.id)).toEqual(['qa_1']);
  });

  it('rejects translations that change card tokens, numbers, stars, or SEND TO POWER', () => {
    const source = '[[CARD:1st_6]] のカードを１枚選び、SEND TO POWER★★に置く';
    expect(() => validateOfficialTranslation(source, '選擇１張 [[CARD:1st_6]] 卡，放到 SEND TO POWER★★')).not.toThrow();
    expect(() => validateOfficialTranslation(source, '選擇1張 [[CARD:1st_6]] 卡，放到 SEND TO POWER★')).toThrow(
      /changed protected tokens/,
    );
  });

  it('rejects non-localized card types and zones in derived rulings translations', async () => {
    const qa: OfficialQaSnapshotRow = {
      id: 'qa_1',
      number: 1,
      date: '2026-02-17',
      question: '質問',
      answer: '回答',
      tags: [],
      relatedCards: [],
    };
    const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'];
    const temp = mkdtempSync(path.join(tmpdir(), 'official-rulings-terminology-'));
    const sourcePath = path.join(temp, 'translations.json');
    try {
      writeFileSync(
        sourcePath,
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: '2026-07-21T00:00:00.000Z',
          provider: 'reviewed-static',
          locales,
          qa: [
            {
              id: qa.id,
              sourceHash: officialContentHash(qaHashInput(qa)),
              translations: {
                'zh-TW': { question: 'Character 卡在哪裡？', answer: '放到 Battle Zone。' },
                'zh-CN': { question: '角色卡在哪里？', answer: '放到战斗区。' },
                'zh-HK': { question: '角色卡喺邊？', answer: '放到戰鬥區。' },
                en: { question: 'Where is the Character card?', answer: 'Place it in the Battle Zone.' },
                ko: { question: '캐릭터 카드는 어디에 있나요?', answer: '배틀 존에 놓습니다.' },
              },
            },
          ],
          errata: [],
        }),
      );
      await expect(loadOfficialTranslationsSnapshot(sourcePath, { qa: [qa], errata: [] })).rejects.toThrow(
        /Non-canonical rules terminology.*Character.*角色卡/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('resolves Q&A card tokens to reviewed names and rejects re-translated names', () => {
    const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;
    const source: OfficialQaSnapshotRow = {
      id: 'qa_1',
      number: 1,
      date: '2026-02-17',
      question: 'テストカードを使えますか？',
      answer: 'テストカードを使えます。',
      tags: [],
      relatedCards: ['1st_1'],
    };
    const snapshot: OfficialTranslationsSnapshot = {
      schemaVersion: 1,
      generatedAt: '2026-07-20T00:00:00.000Z',
      provider: 'reviewed-static',
      locales: [...locales],
      qa: [
        {
          id: source.id,
          sourceHash: officialContentHash(qaHashInput(source)),
          translations: Object.fromEntries(
            locales.map((locale) => [locale, { question: 'Use [[CARD:1st_1]]?', answer: 'Use [[CARD:1st_1]].' }]),
          ) as OfficialTranslationsSnapshot['qa'][number]['translations'],
        },
      ],
      errata: [],
    };
    const cards = {
      '1st_1': {
        ja: 'テストカード',
        translations: {
          'zh-TW': '校對卡名',
          'zh-CN': '校对卡名',
          'zh-HK': '校對卡名',
          en: 'Reviewed Card Name',
          ko: '검수 카드명',
        },
      },
    };

    const resolved = applyCanonicalQaCardNames(snapshot, [source], cards);
    expect(resolved.qa[0].translations['zh-TW'].question).toBe('Use 校對卡名?');
    expect(resolved.qa[0].translations.en.answer).toBe('Use Reviewed Card Name.');

    const wrong = structuredClone(snapshot);
    wrong.qa[0].translations['zh-TW'] = { question: '使用另一個譯名？', answer: '可以。' };
    expect(() => applyCanonicalQaCardNames(wrong, [source], cards)).toThrow(/must use reviewed card name/);
  });

  it('discovers quoted card names omitted from related-card metadata', () => {
    const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;
    const source: OfficialQaSnapshotRow = {
      id: 'qa_50',
      number: 50,
      date: '2026-07-20',
      question: '「関連カード」の効果です。',
      answer: '「未関連カード」も参照します。',
      tags: [],
      relatedCards: ['1st_1'],
    };
    const translations = Object.fromEntries(locales.map((locale) => [locale, 'Reviewed'])) as Record<
      (typeof locales)[number],
      string
    >;
    const cards = {
      '1st_1': { ja: '関連カード', translations },
      '1st_2': { ja: '未関連カード', translations },
    };

    expect(referencedQaCardIds(source, cards)).toEqual(['1st_2', '1st_1']);
  });

  it('parses the official errata list and detail shape fail-closed', () => {
    const list = parseErrataList(`
      <main><a href="/errata/001/"><p>2026.02.17</p><p>Pack</p></a></main>
    `);
    expect(list).toEqual([{ errataId: '001', publishedAt: '2026-02-17' }]);

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
    const detail = parseErrataDetail(`<main>${values.map((value) => `<p>${value}</p>`).join('')}</main>`, list[0]);
    expect(detail).toMatchObject({ errataId: '001', cardId: '1st_6', cardNumber: '006/104' });
  });

  it('returns a diff exit code only for read-only checks', () => {
    expect(shouldFailSyncCheck({ check: true, changed: true, apply: false })).toBe(true);
    expect(shouldFailSyncCheck({ check: true, changed: true, apply: true })).toBe(false);
  });

  it('compares PostgreSQL source hashes instead of reconstructed canonical card text', () => {
    const remote = { errataId: '011', correctedText: 'グレくまくん（形） GUREKUMA-KUN (Pain Give Form)' };
    const sourceHash = officialContentHash(remote);
    expect(
      contentChanges<{ errataId: string; correctedText: string; contentHash?: string }>(
        [{ errataId: '011', correctedText: 'グレくまくん (形)', contentHash: sourceHash }],
        [remote],
        (row) => row,
      ),
    ).toEqual({ added: [], removed: [], updated: [] });
  });

  it('maps official URLs to deterministic fixture files', () => {
    expect(
      fixtureFileForUrl(
        'https://script.google.com/macros/s/AKfycbxezC8Yd98DvURUQCOVlPawdRyu2XHCsBIRbWCGx_IKlqv6DTX2behOrEx0r8HiWhtTxw/exec',
        '/fixtures',
      ),
    ).toBe('/fixtures/qa-source.json');
    expect(fixtureFileForUrl('https://zutomayocard.net/errata/?page=2', '/fixtures')).toBe(
      '/fixtures/errata-page-2.html',
    );
    expect(fixtureFileForUrl('https://zutomayocard.net/errata/012/', '/fixtures')).toBe('/fixtures/errata-012.html');
  });

  it('validates a local five-locale translation source against PostgreSQL-shaped source rows', async () => {
    const qa: OfficialQaSnapshotRow = {
      id: 'qa_1',
      number: 1,
      date: '2026-02-17',
      question: '質問',
      answer: '回答',
      tags: ['基本ルール'],
      relatedCards: [],
    };
    const errata: OfficialErrataSnapshotRow = {
      errataId: '001',
      cardId: '1st_6',
      publishedAt: '2026-02-17',
      cardName: 'カード',
      rarity: 'UR',
      pack: 'THE WORLD IS CHANGING',
      cardNumber: '006/104',
      incorrectText: '誤り',
      correctedText: '修正',
      reason: '理由',
      replacementPolicy: '交換',
      usagePolicy: '使用可能',
      sourceUrl: 'https://zutomayocard.net/errata/001/',
    };
    const locales = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'];
    const temp = mkdtempSync(path.join(tmpdir(), 'official-rulings-translations-'));
    const sourcePath = path.join(temp, 'translations.json');
    try {
      writeFileSync(
        sourcePath,
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: '2026-07-20T00:00:00.000Z',
          provider: 'local-reviewed-source',
          locales,
          qa: [
            {
              id: qa.id,
              sourceHash: officialContentHash(qaHashInput(qa)),
              translations: Object.fromEntries(
                locales.map((locale) => [locale, { question: `${locale} question`, answer: `${locale} answer` }]),
              ),
            },
          ],
          errata: [
            {
              errataId: errata.errataId,
              sourceHash: officialContentHash(errataHashInput(errata)),
              translations: Object.fromEntries(
                locales.map((locale) => [
                  locale,
                  {
                    incorrectText: `${locale} incorrect`,
                    reason: `${locale} reason`,
                    replacementPolicy: `${locale} replacement`,
                    usagePolicy: `${locale} usage`,
                  },
                ]),
              ),
            },
          ],
        }),
      );
      const translations = await loadOfficialTranslationsSnapshot(sourcePath, { qa: [qa], errata: [errata] });
      expect(translations.locales).toEqual(locales);
      expect(translations.qa).toHaveLength(1);
      expect(translations.errata).toHaveLength(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
