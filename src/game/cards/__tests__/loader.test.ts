import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllCardDefs,
  getCardDef,
  getGameConfig,
  initCards,
  loadConfigFromAPI,
  refreshCards,
  registerCardDefFallbacks,
} from '../loader';
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

  it('accepts a card response slower than the legacy 2.5 second cutoff', async () => {
    const slowCard = { id: 'slow_card' } as Parameters<typeof initCards>[0][number];
    const fetchMock = vi.fn(
      (_path: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response(JSON.stringify([slowCard]), { status: 200 })), 3_000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cardsPromise = refreshCards();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(cardsPromise).resolves.toEqual([slowCard]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies the same resilient policy to game config', async () => {
    const config = { deck_sharing_enabled: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response(JSON.stringify(config), { status: 200 })), 3_000);
          }),
      ),
    );

    const configPromise = loadConfigFromAPI();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(configPromise).resolves.toEqual(config);
    expect(getGameConfig()).toEqual(config);
  });

  it('retries once before keeping existing PG-backed cards after a timeout', async () => {
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
    await vi.advanceTimersByTimeAsync(30_250);
    const cards = await cardsPromise;

    expect(cards).toEqual([existingCard]);
    expect(getCardDef('existing_card')).toEqual(existingCard);
    expect(fetchMock).toHaveBeenCalledWith('/api/cards', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let the app boot deadline override the bounded cards and config policy', () => {
    const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('const cards = await refreshCards();');
    expect(appSource).toContain('loadConfigFromAPI(),');
    expect(appSource).not.toContain('withBootTimeout(refreshCards())');
    expect(appSource).not.toContain('withBootTimeout(loadConfigFromAPI())');
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
