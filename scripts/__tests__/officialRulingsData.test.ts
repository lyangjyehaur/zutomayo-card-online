import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  errataHashInput,
  loadOfficialTranslationsSnapshot,
  normalizeOfficialText,
  normalizeQaRows,
  officialContentHash,
  qaHashInput,
  validateOfficialTranslation,
  type OfficialErrataSnapshotRow,
  type OfficialQaSnapshotRow,
} from '../officialRulingsData';
import { fixtureFileForUrl, parseErrataDetail, parseErrataList, shouldFailSyncCheck } from '../sync-official-rulings';

describe('official rulings source normalization', () => {
  it('normalizes line breaks and removes executable markup', () => {
    expect(normalizeOfficialText('前半<br/>後半<script>alert(1)</script>')).toBe('前半\n後半');
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
