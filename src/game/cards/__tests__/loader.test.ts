import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCardDef, initCards, refreshCards } from '../loader';

describe('card loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initCards([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('falls back to bundled cards when the API does not respond', async () => {
    const fallbackCards = [{ id: 'fallback_card' }];
    const fetchMock = vi.fn((path: string | URL | Request, init?: RequestInit) => {
      const pathname = String(path);
      if (pathname === '/api/cards') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      if (pathname === '/cards.json') {
        return Promise.resolve(new Response(JSON.stringify(fallbackCards), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const cardsPromise = refreshCards();
    await vi.advanceTimersByTimeAsync(3000);
    const cards = await cardsPromise;

    expect(cards).toEqual(fallbackCards);
    expect(getCardDef('fallback_card')).toEqual(fallbackCards[0]);
    expect(fetchMock).toHaveBeenCalledWith('/api/cards', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledWith('/cards.json', expect.objectContaining({ cache: 'default' }));
  });
});
