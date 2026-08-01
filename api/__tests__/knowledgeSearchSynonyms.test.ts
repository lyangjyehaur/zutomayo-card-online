import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { RULES_TERMINOLOGY } from '../../src/rulesTerminology';

const require = createRequire(import.meta.url);
const { SEARCH_TERMINOLOGY_GROUPS, buildTerminologySynonyms } = require('../knowledgeSearchSynonyms.cjs') as {
  SEARCH_TERMINOLOGY_GROUPS: Record<string, string[]>;
  buildTerminologySynonyms: () => Record<string, string[]>;
};

const locales = ['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;

describe('knowledge search terminology synonyms', () => {
  it('stays synchronized with the canonical rules terminology dictionary', () => {
    for (const [key, values] of Object.entries(SEARCH_TERMINOLOGY_GROUPS)) {
      expect(values, key).toEqual(
        locales.map((locale) => RULES_TERMINOLOGY[locale][key as keyof (typeof RULES_TERMINOLOGY)[typeof locale]]),
      );
    }
  });

  it('maps each canonical term to the other unique locale terms', () => {
    const synonyms = buildTerminologySynonyms();
    expect(synonyms.Chronos).toEqual(expect.arrayContaining(['クロノス', '크로노스']));
    expect(synonyms.Chronos).not.toContain('Chronos');
    expect(synonyms['傷害']).toEqual(expect.arrayContaining(['ダメージ', '伤害', 'Damage', '데미지']));
  });
});
