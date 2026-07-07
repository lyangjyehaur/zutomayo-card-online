import { beforeEach, describe, expect, it } from 'vitest';
import {
  CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY,
  CUSTOM_DECK_LIBRARY_STORAGE_KEY,
  CUSTOM_DECK_STORAGE_KEY,
  loadCustomDeckIds,
  loadSavedCustomDecks,
  removeSavedCustomDecks,
  saveCustomDeck,
} from '../customDeck';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
}

function makeDeckIds(prefix: string): string[] {
  return Array.from({ length: 20 }, (_, index) => `${prefix}-${Math.floor(index / 2)}`);
}

describe('custom deck storage', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('removes migrated legacy decks so the old single-deck key cannot revive them', () => {
    const legacyDeckIds = makeDeckIds('legacy');
    localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(legacyDeckIds));

    expect(loadSavedCustomDecks()).toEqual([
      {
        id: 'legacy-custom',
        name: 'Custom Deck',
        cardIds: legacyDeckIds,
        updatedAt: new Date(0).toISOString(),
      },
    ]);

    expect(removeSavedCustomDecks(['legacy-custom'])).toEqual([]);
    expect(localStorage.getItem(CUSTOM_DECK_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY)).toBeNull();
    expect(loadCustomDeckIds()).toBeNull();
  });

  it('removes only selected v2 decks and points the legacy mirror at the next remaining deck', () => {
    const firstDeck = saveCustomDeck('First', makeDeckIds('first'));
    const secondDeck = saveCustomDeck('Second', makeDeckIds('second'));

    const remainingDecks = removeSavedCustomDecks([secondDeck.id]);

    expect(remainingDecks.map((deck) => deck.id)).toEqual([firstDeck.id]);
    expect(JSON.parse(localStorage.getItem(CUSTOM_DECK_STORAGE_KEY) ?? '[]')).toEqual(firstDeck.cardIds);
    expect(localStorage.getItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY)).toBe(firstDeck.id);
    expect(JSON.parse(localStorage.getItem(CUSTOM_DECK_LIBRARY_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('clears all local deck keys when the last v2 deck is removed', () => {
    const deck = saveCustomDeck('Only', makeDeckIds('only'));

    expect(removeSavedCustomDecks([deck.id])).toEqual([]);
    expect(localStorage.getItem(CUSTOM_DECK_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOM_DECK_ACTIVE_ID_STORAGE_KEY)).toBeNull();
    expect(loadCustomDeckIds()).toBeNull();
  });
});
