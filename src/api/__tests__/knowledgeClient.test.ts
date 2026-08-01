import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeClient, type ApiRequest } from '../knowledgeClient';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('knowledge client domain contracts', () => {
  it('builds suggestion and single-scope ID queries without owning transport behavior', async () => {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const request: ApiRequest = async <T>(path: string, options?: RequestInit) => {
      calls.push({ path, options });
      return {} as T;
    };
    const client = createKnowledgeClient({ request, adminAuthHeaders: () => ({}) });
    const suggestionController = new AbortController();
    const idsController = new AbortController();

    await client.suggestKnowledge(
      { query: '火 rule', locale: 'zh-TW', scopes: ['card', 'qa'], limit: 8 },
      { signal: suggestionController.signal },
    );
    await client.searchKnowledgeIds(
      {
        query: '夜',
        locale: 'ja',
        scopes: ['card'],
        pack: '',
        rarity: 'UR',
        cardId: 'card/1',
        limit: 20,
        analytics: false,
      },
      { signal: idsController.signal },
    );

    expect(calls).toEqual([
      {
        path: '/search/suggest?q=%E7%81%AB+rule&lang=zh-TW&scope=card%2Cqa&limit=8',
        options: { signal: suggestionController.signal },
      },
      {
        path: '/search/ids?q=%E5%A4%9C&scope=card&lang=ja&rarity=UR&cardId=card%2F1&limit=20&analytics=0',
        options: { signal: idsController.signal },
      },
    ]);
  });

  it('builds full search filters and unwraps admin zero-result items', async () => {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const zeroResult = {
      query: 'missing',
      locale: 'en',
      scope: 'all' as const,
      count: 3,
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-07-31T00:00:00.000Z',
    };
    const request: ApiRequest = async <T>(path: string, options?: RequestInit) => {
      calls.push({ path, options });
      return (path.startsWith('/admin/') ? { items: [zeroResult] } : {}) as T;
    };
    const client = createKnowledgeClient({
      request,
      adminAuthHeaders: () => ({ Authorization: 'Bearer admin-token' }),
    });

    await client.searchKnowledge({
      query: 'battle',
      locale: 'en',
      scopes: ['rule', 'errata'],
      pack: 'vol.1',
      documentId: 'grand',
      offset: 10,
    });
    await expect(client.adminGetKnowledgeSearchZeroResults({ limit: 25, days: 14 })).resolves.toEqual([zeroResult]);

    expect(calls).toEqual([
      {
        path: '/search?q=battle&lang=en&scope=rule%2Cerrata&pack=vol.1&documentId=grand&offset=10',
        options: { signal: undefined },
      },
      {
        path: '/admin/search/zero-results?limit=25&days=14',
        options: { headers: { Authorization: 'Bearer admin-token' } },
      },
    ]);
  });
});

describe('knowledge client compatibility facade', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('keeps search requests on the shared account refresh and error transport', async () => {
    const localStorage = memoryStorage();
    let searchAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === '/api/search/suggest?q=rule&lang=en&scope=rule&limit=5') {
        searchAttempts += 1;
        if (searchAttempts === 1) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        return new Response(JSON.stringify({ suggestions: [], engine: 'postgres-fallback', processingTimeMs: 2 }));
      }
      if (path === '/api/auth/refresh') return new Response(JSON.stringify({ ok: true }));
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('fetch', fetchMock);

    const { suggestKnowledge } = await import('../client');
    await expect(suggestKnowledge({ query: 'rule', locale: 'en', scopes: ['rule'], limit: 5 })).resolves.toEqual({
      suggestions: [],
      engine: 'postgres-fallback',
      processingTimeMs: 2,
    });

    expect(localStorage.getItem('zutomayo_session')).toBe('1');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/search/suggest?q=rule&lang=en&scope=rule&limit=5',
      '/api/auth/refresh',
      '/api/search/suggest?q=rule&lang=en&scope=rule&limit=5',
    ]);
  });
});
