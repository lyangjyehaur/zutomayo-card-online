import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredOnlineSession,
  loadOnlineSession,
  ONLINE_SESSION_STORAGE_KEY,
  saveOnlineSession,
  type OnlineSession,
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
});
