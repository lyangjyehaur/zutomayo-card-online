import { describe, expect, it } from 'vitest';
import { COUNTER_DECK_NAME, RANDOM_DECK_NAME } from '../../../game/cards/deckBuilder';
import { aiOpponentDeckName, canStartAI } from '../shared';

describe('AI lobby deck flow', () => {
  it('allows difficulty selection after the player deck is selected', () => {
    expect(canStartAI({ cardsReady: true, deck0Name: 'dark', deck1Name: '' })).toBe(true);
  });

  it('keeps AI-only counter decks and defaults blank opponent decks to random', () => {
    expect(aiOpponentDeckName(COUNTER_DECK_NAME)).toBe(COUNTER_DECK_NAME);
    expect(aiOpponentDeckName('')).toBe(RANDOM_DECK_NAME);
  });
});
