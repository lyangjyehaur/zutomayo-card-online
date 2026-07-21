import { describe, expect, it } from 'vitest';
import { inferCardNameAliases, replaceQaCardNamesWithTokens } from '../export-official-rulings-translations';
import { OFFICIAL_TRANSLATION_LOCALES, type OfficialQaSnapshotRow } from '../officialRulingsData';

const source: OfficialQaSnapshotRow = {
  id: 'qa_1',
  number: 1,
  date: '2026-02-17',
  question: '「テストカード」を使えますか？',
  answer: '「テストカード」を使えます。',
  tags: [],
  relatedCards: ['1st_1'],
};

const cardTexts = {
  '1st_1': {
    ja: { name: 'テストカード', reviewStatus: 'official' },
    en: { name: 'Reviewed Card', reviewStatus: 'official' },
    'zh-TW': { name: '校對卡名', reviewStatus: 'verified' },
    'zh-CN': { name: '校对卡名', reviewStatus: 'verified' },
    'zh-HK': { name: '校對卡名', reviewStatus: 'verified' },
    ko: { name: '검수 카드명', reviewStatus: 'verified' },
  },
};

describe('official rulings translation export', () => {
  it('infers existing aliases and replaces them with stable card tokens', () => {
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [
        locale,
        [
          {
            id: source.id,
            relatedCardIds: source.relatedCards,
            source: { question: source.question, answer: source.answer },
            localized: { question: 'Use “Old Alias”?', answer: 'Use “Old Alias”.' },
            effectiveLocale: locale,
          },
        ],
      ]),
    ) as unknown as Parameters<typeof inferCardNameAliases>[0];
    const aliases = inferCardNameAliases(qaByLocale, cardTexts);
    const result = replaceQaCardNamesWithTokens(qaByLocale['zh-TW'][0], source, 'zh-TW', cardTexts, aliases);

    expect(result).toEqual({
      question: 'Use “[[CARD:1st_1]]”?',
      answer: 'Use “[[CARD:1st_1]]”.',
      replacements: 2,
    });
  });

  it('fails closed when a translated card-name alias cannot be identified', () => {
    const item = {
      id: source.id,
      relatedCardIds: source.relatedCards,
      source: { question: source.question, answer: source.answer },
      localized: { question: 'No recognizable name', answer: 'No recognizable name' },
      effectiveLocale: 'zh-TW',
    };

    expect(() => replaceQaCardNamesWithTokens(item, source, 'zh-TW', cardTexts, new Map())).toThrow(
      /Could not identify/,
    );
  });

  it('recognizes TeX-style English quotes produced by the existing baseline', () => {
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [
        locale,
        [
          {
            id: source.id,
            relatedCardIds: source.relatedCards,
            source: { question: source.question, answer: source.answer },
            localized: { question: "Use ``Old Alias''?", answer: "Use ``Old Alias''." },
            effectiveLocale: locale,
          },
        ],
      ]),
    ) as Parameters<typeof inferCardNameAliases>[0];

    expect(inferCardNameAliases(qaByLocale, cardTexts).get('en:1st_1')).toEqual(['Old Alias']);
  });

  it('does not interpret English possessive apostrophes as card-name quotes', () => {
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [
        locale,
        [
          {
            id: source.id,
            relatedCardIds: source.relatedCards,
            source: { question: source.question, answer: source.answer },
            localized: { question: "The player's effect changes the opponent's card.", answer: 'Answer.' },
            effectiveLocale: locale,
          },
        ],
      ]),
    ) as Parameters<typeof inferCardNameAliases>[0];

    expect(inferCardNameAliases(qaByLocale, cardTexts).get('en:1st_1')).toBeUndefined();
  });

  it('recognizes East Asian title marks without consuming a quoted rules effect', () => {
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [
        locale,
        [
          {
            id: source.id,
            relatedCardIds: source.relatedCards,
            source: { question: '「テストカード」の「★+１」', answer: '「テストカード」を使う。' },
            localized: { question: '《Old Alias》中的「★+１」', answer: '使用《Old Alias》。' },
            effectiveLocale: locale,
          },
        ],
      ]),
    ) as Parameters<typeof inferCardNameAliases>[0];

    expect(inferCardNameAliases(qaByLocale, cardTexts).get('zh-TW:1st_1')).toEqual(['Old Alias']);
  });

  it('matches canonical card names when translated sentence structure reorders quoted phrases', () => {
    const reorderedTexts = {
      ...cardTexts,
      '1st_2': {
        ja: { name: '別カード', reviewStatus: 'official' },
        en: { name: 'Leapt Through Time', reviewStatus: 'official' },
        'zh-TW': { name: '另一張卡', reviewStatus: 'verified' },
        'zh-CN': { name: '另一张卡', reviewStatus: 'verified' },
        'zh-HK': { name: '另一張卡', reviewStatus: 'verified' },
        ko: { name: '다른 카드', reviewStatus: 'verified' },
      },
    };
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [
        locale,
        [
          {
            id: source.id,
            relatedCardIds: ['1st_1', '1st_2'],
            source: { question: '「テストカード」や「別カード」の「効果」', answer: '回答' },
            localized: {
              question: 'The “effect” of “Reviewed Card” and “Run Through Time”',
              answer: 'Answer',
            },
            effectiveLocale: locale,
          },
        ],
      ]),
    ) as Parameters<typeof inferCardNameAliases>[0];

    const aliases = inferCardNameAliases(qaByLocale, reorderedTexts);
    expect(aliases.get('en:1st_1')).toEqual(['Reviewed Card']);
    expect(aliases.get('en:1st_2')).toEqual(['Run Through Time']);
  });

  it('tokenizes a quoted card omitted from relatedCardIds', () => {
    const item = {
      id: source.id,
      relatedCardIds: [],
      source: { question: source.question, answer: source.answer },
      localized: { question: '可以使用「舊譯名」嗎？', answer: '可以使用「舊譯名」。' },
      effectiveLocale: 'zh-TW',
    };
    const qaByLocale = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => [locale, [{ ...item, effectiveLocale: locale }]]),
    ) as unknown as Parameters<typeof inferCardNameAliases>[0];
    const aliases = inferCardNameAliases(qaByLocale, cardTexts);

    expect(replaceQaCardNamesWithTokens(item, { ...source, relatedCards: [] }, 'zh-TW', cardTexts, aliases)).toEqual({
      question: '可以使用「[[CARD:1st_1]]」嗎？',
      answer: '可以使用「[[CARD:1st_1]]」。',
      replacements: 2,
    });
  });
});
