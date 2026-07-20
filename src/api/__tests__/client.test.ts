import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('API client admin session refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('renews account CSRF and linked admin sessions before retrying an expired admin request', async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    sessionStorage.setItem('zutomayo_admin_token', 'expired-admin-token');
    let csrfCookie = 'old-csrf-token';
    const document = {} as Document;
    Object.defineProperty(document, 'cookie', { get: () => `zutomayo_csrf=${csrfCookie}` });

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      if (path === '/api/admin/config/card_song_titles_i18n') {
        if (headers.Authorization === 'Bearer expired-admin-token') {
          expect(headers['X-CSRF-Token']).toBe('old-csrf-token');
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        expect(headers.Authorization).toBe('Bearer renewed-admin-token');
        expect(headers['X-CSRF-Token']).toBe('new-csrf-token');
        return new Response(JSON.stringify({ key: 'card_song_titles_i18n', value: {} }));
      }
      if (path === '/api/admin/session') {
        if (headers['X-CSRF-Token'] === 'old-csrf-token') {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        expect(headers['X-CSRF-Token']).toBe('new-csrf-token');
        return new Response(JSON.stringify({ token: 'renewed-admin-token', role: 'admin', expiresIn: 3600 }));
      }
      if (path === '/api/auth/refresh') {
        csrfCookie = 'new-csrf-token';
        return new Response(JSON.stringify({ ok: true }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    vi.stubGlobal('document', document);
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('fetch', fetchMock);

    const { adminUpdateConfig } = await import('../client');
    await expect(adminUpdateConfig('card_song_titles_i18n', {})).resolves.toBeUndefined();

    expect(sessionStorage.getItem('zutomayo_admin_token')).toBe('renewed-admin-token');
    expect(sessionStorage.getItem('zutomayo_admin_role')).toBe('admin');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/admin/config/card_song_titles_i18n',
      '/api/admin/session',
      '/api/auth/refresh',
      '/api/admin/session',
      '/api/admin/config/card_song_titles_i18n',
    ]);
  });
});

describe('API client deck sharing contracts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('builds the public lobby query and encoded detail URL', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ shares: [], nextCursor: null }))),
    );

    const { getDeckShare, listDeckShares } = await import('../client');
    await listDeckShares({
      sort: 'most-copied',
      q: '炎 deck',
      element: '炎',
      cursor: 'cursor/value',
      limit: 24,
    });
    await getDeckShare('ds_share/value');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/deck-shares?sort=most-copied&q=%E7%82%8E+deck&element=%E7%82%8E&cursor=cursor%2Fvalue&limit=24',
      '/api/deck-shares/ds_share%2Fvalue',
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('sends deck-share mutations with JSON bodies, credentials, and CSRF', async () => {
    const localStorage = memoryStorage();
    const document = {} as Document;
    Object.defineProperty(document, 'cookie', { get: () => 'zutomayo_csrf=deck-share-csrf' });
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('document', document);
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('fetch', fetchMock);

    const { copyDeckShare, likeDeckShare, publishDeckShare, reportDeckShare } = await import('../client');
    await publishDeckShare('d_source_1234', 'unlisted');
    await copyDeckShare('ds_share_12345678', 'Copied deck', 'copy-key-1234');
    await likeDeckShare('ds_share_12345678');
    await reportDeckShare('ds_share_12345678', { reason: 'spam', note: 'Repeated entry' });

    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/deck-shares',
      '/api/deck-shares/ds_share_12345678/copy',
      '/api/deck-shares/ds_share_12345678/like',
      '/api/deck-shares/ds_share_12345678/reports',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init)).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deckId: 'd_source_1234', visibility: 'unlisted' }),
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'deck-share-csrf' }),
      }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Copied deck', idempotencyKey: 'copy-key-1234' }),
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'deck-share-csrf' }),
      }),
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'deck-share-csrf' }),
      }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'spam', note: 'Repeated entry' }),
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'deck-share-csrf' }),
      }),
    ]);
  });
});
