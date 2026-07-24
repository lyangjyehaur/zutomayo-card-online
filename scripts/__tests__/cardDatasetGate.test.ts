import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../src/game/types';
import {
  cardDatasetSha256,
  DERIVED_CARD_LANGUAGES,
  evaluateCardDataset,
  type CardDatasetSnapshot,
} from '../cardDatasetGate';

function card(index: number): CardDef {
  return {
    id: `card_${String(index).padStart(2, '0')}`,
    name: `Card ${index}`,
    enNameOfficial: `Card ${index}`,
    pack: 'test',
    song: '',
    illustrator: '',
    rarity: 'N',
    element: '闇',
    type: 'Character',
    clock: 1,
    attack: { night: 10, day: 10 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '',
    errata: '',
  };
}

function snapshot(): CardDatasetSnapshot {
  const cards = Array.from({ length: 20 }, (_, index) => card(index + 1));
  return {
    cards,
    translations: cards.flatMap((item) =>
      DERIVED_CARD_LANGUAGES.map((lang) => ({
        cardId: item.id,
        lang,
        nameText: `${item.name} ${lang}`,
        effectText: '',
        reviewStatus: 'verified',
      })),
    ),
    presetDecks: [{ id: 'dark', name: 'Dark', cardIds: cards.map((item) => item.id) }],
    gameConfig: { deckSize: 20, maxCopies: 2 },
  };
}

describe('release card dataset gate', () => {
  it('accepts a complete deterministic dataset', () => {
    const report = evaluateCardDataset(snapshot(), { expectedCardCount: 20, gameSmokePassed: true });

    expect(report.failures).toEqual([]);
    expect(report.checks).toEqual(
      expect.objectContaining({ derivedTranslationsComplete: true, presetDecksValid: true }),
    );
    expect(report.metrics).toEqual(expect.objectContaining({ cards: 20, verifiedTranslationRows: 80 }));
  });

  it('hashes equivalent snapshots independently of database row order', () => {
    const original = snapshot();
    const reordered = {
      ...original,
      cards: [...original.cards].reverse(),
      translations: [...original.translations].reverse(),
      presetDecks: [...original.presetDecks].reverse(),
      gameConfig: { maxCopies: 2, deckSize: 20 },
    };

    expect(cardDatasetSha256(reordered)).toBe(cardDatasetSha256(original));
  });

  it('fails closed for synthetic counts, incomplete translations, bad presets, or smoke failure', () => {
    const input = snapshot();
    input.translations = input.translations.slice(1);
    input.presetDecks[0].cardIds = input.presetDecks[0].cardIds.slice(0, 19);

    const report = evaluateCardDataset(input, { expectedCardCount: 422, gameSmokePassed: false });

    expect(report.failures).toEqual(
      expect.arrayContaining([
        'expected 422 cards, found 20',
        expect.stringContaining('missing derived translation'),
        expect.stringContaining('preset deck dark'),
        'game smoke failed against the release dataset',
      ]),
    );
  });

  it('rejects a dataset hash that differs from the release manifest', () => {
    const report = evaluateCardDataset(snapshot(), {
      expectedCardCount: 20,
      expectedDatasetSha256: '0'.repeat(64),
      gameSmokePassed: true,
    });

    expect(report.failures).toContainEqual(expect.stringContaining('does not match expected'));
  });

  it('rejects replacement characters and hidden control bytes in player-visible text', () => {
    const replacementCharacter = snapshot();
    replacementCharacter.cards[0].name = 'Broken � name';
    replacementCharacter.translations[1].effectText = 'Broken\u0000effect';

    const report = evaluateCardDataset(replacementCharacter, { expectedCardCount: 20, gameSmokePassed: true });

    expect(report.checks.textIntegrity).toBe(false);
    expect(report.failures).toContain(
      'corrupt Unicode text detected: card card_01.name, translation card_01/zh-CN.effectText',
    );
  });
});
