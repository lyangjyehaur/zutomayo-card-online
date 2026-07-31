import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTER_DECK_NAME, RANDOM_DECK_NAME } from '../../../game/cards/deckBuilder';
import { CUSTOM_DECK_LIBRARY_STORAGE_KEY, customDeckOptionId } from '../../../game/cards/customDeck';
import { QUICK_MATCH_LOCAL_DECK_NAME } from '../../../platform/quickMatchDeck';
import {
  aiOpponentDeckName,
  aiOpponentDeckSetup,
  canStartAI,
  onlineDeckName,
  platformQuickMatchDeckName,
  serverDeckOptionId,
} from '../shared';

describe('AI lobby deck flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows difficulty selection after the player deck is selected', () => {
    expect(canStartAI({ cardsReady: true, deck0Name: 'dark', deck1Name: '' })).toBe(true);
    expect(canStartAI({ cardsReady: true, deck0Name: 'dark', deck1Name: 'flame' })).toBe(true);
  });

  it('keeps AI-only counter decks and defaults blank opponent decks to random', () => {
    expect(aiOpponentDeckName(COUNTER_DECK_NAME)).toBe(COUNTER_DECK_NAME);
    expect(aiOpponentDeckName('')).toBe(RANDOM_DECK_NAME);
  });

  it('passes the selected server deck cards into local AI matches', () => {
    const cardIds = Array.from({ length: 20 }, (_, index) => `card-${index + 1}`);

    expect(onlineDeckName(0, serverDeckOptionId('deck-1'), [{ id: 'deck-1', name: 'Reviewed Deck', cardIds }])).toEqual(
      { deck0Ids: cardIds },
    );
  });

  it('passes a selected server deck to the AI opponent by card ID', () => {
    const cardIds = Array.from({ length: 20 }, (_, index) => `card-${index + 1}`);

    expect(
      aiOpponentDeckSetup(serverDeckOptionId('deck-1'), [{ id: 'deck-1', name: 'Practice Deck', cardIds }]),
    ).toEqual({ deck1Ids: cardIds });
    expect(aiOpponentDeckSetup(COUNTER_DECK_NAME, [])).toEqual({ deck1Name: COUNTER_DECK_NAME });
    expect(aiOpponentDeckSetup('', [])).toEqual({ deck1Name: RANDOM_DECK_NAME });
  });

  it('passes a selected local custom deck to the AI opponent by card ID', () => {
    const cardIds = Array.from({ length: 20 }, (_, index) => `card-${index + 1}`);
    const storedDecks = JSON.stringify([
      { id: 'practice', name: 'Practice Deck', cardIds, updatedAt: '2026-07-27T00:00:00.000Z' },
    ]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => (key === CUSTOM_DECK_LIBRARY_STORAGE_KEY ? storedDecks : null)),
    });

    expect(aiOpponentDeckSetup(customDeckOptionId('practice'), [])).toEqual({ deck1Ids: cardIds });
  });

  it('replaces local deck identifiers with an opaque quick-match marker', () => {
    expect(platformQuickMatchDeckName(customDeckOptionId('private-deck-id'))).toBe(QUICK_MATCH_LOCAL_DECK_NAME);
    expect(platformQuickMatchDeckName('dark')).toBe('dark');
    expect(platformQuickMatchDeckName(serverDeckOptionId('reviewed-deck'))).toBe('server:reviewed-deck');
  });
});
