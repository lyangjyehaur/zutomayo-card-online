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
