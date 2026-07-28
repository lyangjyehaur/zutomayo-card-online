import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllCardDefs, getCardDef, initCards, refreshCards, registerCardDefFallbacks } from '../loader';
import { randomDeck, randomElementDeck } from '../deckBuilder';

describe('card loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initCards([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps existing PG-backed cards and does not request a JSON fallback when the API times out', async () => {
    const existingCard = { id: 'existing_card' } as Parameters<typeof initCards>[0][number];
    initCards([existingCard]);
    const fetchMock = vi.fn((path: string | URL | Request, init?: RequestInit) => {
      const pathname = String(path);
      if (pathname === '/api/cards') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const cardsPromise = refreshCards();
    await vi.advanceTimersByTimeAsync(3000);
    const cards = await cardsPromise;

    expect(cards).toEqual([existingCard]);
    expect(getCardDef('existing_card')).toEqual(existingCard);
    expect(fetchMock).toHaveBeenCalledWith('/api/cards', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to build a random deck from an empty card pool', () => {
    expect(() => randomDeck()).toThrow('Cards not loaded yet');
  });

  it('fills random decks from the remaining pool when non-character cards are scarce', () => {
    const cards = [
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `character_${index}`,
        type: 'Character' as const,
        element: '闇' as const,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `enchant_${index}`,
        type: 'Enchant' as const,
        element: '闇' as const,
      })),
    ] as Parameters<typeof initCards>[0];
    initCards(cards);

    expect(randomDeck()).toHaveLength(20);
    expect(randomElementDeck('闇')).toHaveLength(20);
  });

  it('rejects a loaded card pool that cannot form a complete deck', () => {
    initCards(
      Array.from({ length: 19 }, (_, index) => ({
        id: `character_${index}`,
        type: 'Character' as const,
        element: '闇' as const,
      })) as Parameters<typeof initCards>[0],
    );

    expect(() => randomDeck()).toThrow('Card pool must contain at least 20 cards, got 19');
  });

  it('uses presentation fallbacks without treating them as the authoritative card dataset', () => {
    const fallback = { id: 'tutorial_fallback' } as Parameters<typeof registerCardDefFallbacks>[0][number];
    registerCardDefFallbacks([fallback]);

    expect(getCardDef(fallback.id)).toBe(fallback);
    expect(getAllCardDefs()).toEqual([]);
    expect(() => randomDeck()).toThrow('Cards not loaded yet');

    const authoritative = { id: fallback.id, name: 'Authoritative' } as typeof fallback;
    initCards([authoritative]);
    expect(getCardDef(fallback.id)).toBe(authoritative);
  });
});
