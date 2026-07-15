import { describe, expect, it } from 'vitest';
import {
  applyHumanReview,
  summarize,
  type Extraction,
  type ExtractionCard,
  type ReviewLedger,
} from '../card-official-text-review-server';

function card(overrides: Partial<ExtractionCard> = {}): ExtractionCard {
  return {
    id: 'test_1',
    japaneseName: '日本語名',
    enNameOfficial: 'ENGLISH NAME',
    nameStatus: 'machine_verified',
    nameVerificationSource: 'ocr-agreement',
    japaneseEffect: '日本語効果',
    enEffectOfficial: 'ENGLISH EFFECT',
    effectStatus: 'machine_verified',
    effectVerificationSource: 'ocr-agreement',
    reviewReasons: [],
    evidence: {},
    ...overrides,
  };
}

function extraction(cards: ExtractionCard[]): Extraction {
  return { schemaVersion: 2, summary: summarize(cards), cards };
}

describe('official card-text review store', () => {
  it('summarizes machine, human, and not-applicable states separately', () => {
    const cards = [
      card(),
      card({
        id: 'test_2',
        nameStatus: 'human_verified',
        effectStatus: 'human_verified',
      }),
      card({
        id: 'test_3',
        japaneseEffect: '',
        enEffectOfficial: '',
        effectStatus: 'not_applicable',
      }),
    ];

    expect(summarize(cards)).toMatchObject({
      cardCount: 3,
      machineVerifiedNames: 2,
      humanVerifiedNames: 1,
      effectCardCount: 2,
      noEffectCardCount: 1,
      machineVerifiedEffectCards: 1,
      humanVerifiedEffectCards: 1,
    });
  });

  it('records field-level human confirmation and reviewer evidence', () => {
    const data = extraction([card()]);
    const ledger: ReviewLedger = { schemaVersion: 1, reviews: {} };
    const reviewedAt = '2026-07-15T01:00:00.000Z';

    const result = applyHumanReview(
      data,
      ledger,
      'test_1',
      {
        confirmName: true,
        confirmEffect: true,
        nameText: 'CORRECTED NAME',
        effectText: 'CORRECTED EFFECT',
      },
      reviewedAt,
    );

    expect(result).toMatchObject({
      enNameOfficial: 'CORRECTED NAME',
      nameStatus: 'human_verified',
      enEffectOfficial: 'CORRECTED EFFECT',
      effectStatus: 'human_verified',
    });
    expect(ledger.reviews.test_1).toEqual({
      name: { value: 'CORRECTED NAME', source: 'local-web-review', reviewedAt },
      effect: { value: 'CORRECTED EFFECT', source: 'local-web-review', reviewedAt },
    });
    expect(data.summary).toMatchObject({ humanVerifiedNames: 1, humanVerifiedEffectCards: 1 });
  });

  it('rejects effect confirmation for a card without printed effect text', () => {
    const data = extraction([card({ japaneseEffect: '', enEffectOfficial: '', effectStatus: 'not_applicable' })]);
    const ledger: ReviewLedger = { schemaVersion: 1, reviews: {} };

    expect(() =>
      applyHumanReview(data, ledger, 'test_1', {
        confirmEffect: true,
        effectText: 'Unexpected effect',
      }),
    ).toThrow('no printed effect');
    expect(ledger.reviews).toEqual({});
  });
});
