import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredOnlineSession,
  leaveOnlineSession,
  loadOnlineSession,
  ONLINE_SESSION_STORAGE_KEY,
  requestOnlineRematch,
  resolveOnlineRouteSession,
  saveOnlineSession,
  type OnlineSession,
  validateOnlineSession,
} from '../onlineSession';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe('online session storage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('persists stable platform identity with the boardgame online session', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });
    const session: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-0',
      platformSeatToken: 'seat-token-0',
      platformUserId: 'logto:u_1',
      platformDisplayName: 'Alice',
    };

    saveOnlineSession(session);

    expect(localStorage.setItem).toHaveBeenCalledWith(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session));
    expect(loadOnlineSession()).toEqual(session);
  });

  it('rejects malformed persisted platform identity instead of reviving unsafe evidence', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });
    localStorage.setItem(
      ONLINE_SESSION_STORAGE_KEY,
      JSON.stringify({
        matchID: 'bgio-match-1',
        playerID: '0',
        playerCredentials: 'credential-0',
        platformUserId: 123,
      }),
    );

    expect(loadOnlineSession()).toBeNull();
  });

  it('clears only the stored online session key', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });

    clearStoredOnlineSession();

    expect(localStorage.removeItem).toHaveBeenCalledWith(ONLINE_SESSION_STORAGE_KEY);
  });

  it('uses the newly stored rematch session while the parent state still points at the previous match', () => {
    const previousSession: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-1',
    };
    const rematchSession: OnlineSession = {
      matchID: 'bgio-match-2',
      playerID: '0',
      playerCredentials: 'credential-2',
    };

    expect(resolveOnlineRouteSession(previousSession, rematchSession, 'bgio-match-2', false)).toBe(rematchSession);
    expect(resolveOnlineRouteSession(previousSession, rematchSession, 'bgio-match-3', false)).toBeNull();
    expect(resolveOnlineRouteSession(previousSession, rematchSession, 'bgio-match-2', true)).toBeNull();
  });

  it('refreshes platform seat tokens without dropping stable platform identity', async () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ platformSeatToken: 'seat-token-refreshed' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const session: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-0',
      platformSeatToken: 'seat-token-old',
      platformUserId: 'logto:u_1',
      platformDisplayName: 'Alice',
    };

    await expect(validateOnlineSession(session)).resolves.toEqual({ ok: true });

    expect(session).toEqual({
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-0',
      platformSeatToken: 'seat-token-refreshed',
      platformUserId: 'logto:u_1',
      platformDisplayName: 'Alice',
    });
    expect(loadOnlineSession()).toEqual(session);
  });

  it('restores the server-issued platform identity for legacy stored sessions', async () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          platformSeatToken: 'seat-token-refreshed',
          platformUserId: 'guest:match:bgio-match-1:reservation:abc',
        }),
      })),
    );
    const session: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-0',
    };

    await expect(validateOnlineSession(session)).resolves.toEqual({ ok: true });

    expect(session.platformUserId).toBe('guest:match:bgio-match-1:reservation:abc');
    expect(loadOnlineSession()).toEqual(session);
  });

  it('aborts remote leave cleanup after the local timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const session: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '0',
      playerCredentials: 'credential-0',
    };

    const leaving = leaveOnlineSession(session);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(leaving).resolves.toBeUndefined();
  });

  it('requests the shared next match with the current seat credentials', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ nextMatchID: 'bgio-match-2' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const session: OnlineSession = {
      matchID: 'bgio-match-1',
      playerID: '1',
      playerCredentials: 'credential-1',
    };

    await expect(requestOnlineRematch(session)).resolves.toBe('bgio-match-2');
    expect(fetch).toHaveBeenCalledWith(
      '/games/zutomayo-card/bgio-match-1/playAgain',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerID: '1', credentials: 'credential-1', unlisted: true }),
      }),
    );
  });
});
