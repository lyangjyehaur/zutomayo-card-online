import { APP_VERSION_INFO } from './version';
import { Sentry } from './sentry';

export interface OnlineSession {
  matchID: string;
  playerID: '0' | '1';
  playerCredentials: string;
}

export type OnlineSessionValidationReason = 'network' | 'roomGone' | 'seatTaken' | 'versionMismatch';

export type OnlineSessionValidationResult = { ok: true } | { ok: false; reason: OnlineSessionValidationReason };

export const ONLINE_SESSION_STORAGE_KEY = 'zutomayo_online_session';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function isOnlineSession(data: Partial<OnlineSession>): data is OnlineSession {
  return (
    typeof data.matchID === 'string' &&
    (data.playerID === '0' || data.playerID === '1') &&
    typeof data.playerCredentials === 'string'
  );
}

export function loadOnlineSession(): OnlineSession | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ONLINE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<OnlineSession>;
    if (isOnlineSession(data)) return data;
  } catch {
    storage.removeItem(ONLINE_SESSION_STORAGE_KEY);
  }
  return null;
}

export function saveOnlineSession(session: OnlineSession): void {
  getStorage()?.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredOnlineSession(): void {
  getStorage()?.removeItem(ONLINE_SESSION_STORAGE_KEY);
}

export async function leaveOnlineSession(session: OnlineSession): Promise<void> {
  try {
    await fetch(`/games/zutomayo-card/${encodeURIComponent(session.matchID)}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: session.playerID,
        credentials: session.playerCredentials,
      }),
    });
  } catch (err) {
    // Local cleanup still happens; the server may already have dropped the room.
    Sentry.addBreadcrumb({
      category: 'online-session',
      message: 'leaveOnlineSession failed (server may have dropped room)',
      level: 'warning',
      data: { match_id: session.matchID, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function validateOnlineSession(session: OnlineSession): Promise<OnlineSessionValidationResult> {
  try {
    const response = await fetch(`/games/zutomayo-card/${encodeURIComponent(session.matchID)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: session.playerID,
        credentials: session.playerCredentials,
        clientVersion: APP_VERSION_INFO,
      }),
    });

    if (response.ok) return { ok: true };
    if (response.status === 426) return { ok: false, reason: 'versionMismatch' };
    if (response.status === 404) return { ok: false, reason: 'roomGone' };
    if (response.status === 403 || response.status === 409) return { ok: false, reason: 'seatTaken' };
    return { ok: false, reason: 'network' };
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'online-session',
      message: 'validateOnlineSession network error',
      level: 'warning',
      data: { match_id: session.matchID, error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, reason: 'network' };
  }
}
