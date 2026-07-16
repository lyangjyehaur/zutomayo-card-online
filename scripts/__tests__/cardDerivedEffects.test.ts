import { describe, expect, it } from 'vitest';
import {
  auditDerivedEffects,
  buildDerivedEffectRows,
  sha256,
  type DerivedEffectsAuditInput,
} from '../cardDerivedEffects';

function auditInput(): DerivedEffectsAuditInput {
  const effects = {
    card_1: {
      ja: '攻撃力+20',
      en: 'Attack +20',
      'zh-TW': '攻擊力+20',
      'zh-CN': '攻击力+20',
      'zh-HK': '攻擊力+20',
      ko: '同時に 공격력 +20',
    },
  };
  const sourceBytes = Buffer.from(JSON.stringify(effects));
  return {
    sourceBytes,
    effects,
    extraction: {
      cards: [
        {
          id: 'card_1',
          japaneseEffect: '攻撃力+20',
          enEffectOfficial: 'Attack +20',
          effectStatus: 'human_verified',
        },
      ],
    },
    errata: { errata: [] },
    review: {
      schemaVersion: 1,
      reviewedAt: '2026-07-16T00:00:00Z',
      reviewScope: 'all_effect_rows',
      reviewBasis: ['corrected_official_japanese', 'human_verified_official_printed_english'],
      sourceFile: 'fixture.json',
      sourceSha256: sha256(sourceBytes),
      effectCardIdsSha256: sha256('card_1\n'),
      effectErrataCardIdsSha256: sha256('\n'),
      cardCount: 1,
      languages: ['zh-TW', 'zh-CN', 'zh-HK', 'ko'],
    },
  };
}

describe('derived card-effect review data', () => {
  it('rejects retired English translations and mixed Japanese/Korean text', () => {
    const problems = auditDerivedEffects(auditInput());

    expect(problems).toContain('card_1: row must contain ja and four derived languages only (legacy en is forbidden)');
    expect(problems).toContain('card_1/ko: effect contains Japanese/Chinese text or punctuation');
  });

  it('assigns errata provenance only to cards whose effects were corrected', () => {
    const input = auditInput();
    delete input.effects.card_1.en;
    input.effects.card_1.ko = '공격력 +20';
    input.effects.card_2 = {
      ja: 'HPを10回復',
      'zh-TW': '恢復10點HP',
      'zh-CN': '恢复10点HP',
      'zh-HK': '恢復10點HP',
      ko: 'HP를 10 회복',
    };
    input.errata.errata = [{ cardId: 'card_2', fields: ['effect'] }];

    const rows = buildDerivedEffectRows(input);

    expect(rows).toHaveLength(8);
    expect(rows.filter((row) => row.cardId === 'card_1')).toEqual(
      expect.arrayContaining([expect.objectContaining({ effectSource: 'admin_bilingual_translation' })]),
    );
    expect(rows.filter((row) => row.cardId === 'card_2')).toEqual(
      expect.arrayContaining([expect.objectContaining({ effectSource: 'official_japanese_errata_translation' })]),
    );
  });
});
