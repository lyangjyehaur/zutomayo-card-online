import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCardDef, initCards, refreshCards } from '../loader';
import { randomDeck } from '../deckBuilder';

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
});
