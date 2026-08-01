import { APP_VERSION_INFO } from './version';
import { Sentry } from './sentry';
import { onlineHttpError } from './onlineHttpError';

export interface OnlineSession {
  matchID: string;
  playerID: '0' | '1';
  playerCredentials: string;
  platformSeatToken?: string;
  platformUserId?: string;
  platformDisplayName?: string;
}

export type OnlineSessionValidationReason = 'network' | 'roomGone' | 'seatTaken' | 'versionMismatch' | 'invalidSession';

export type OnlineSessionValidationResult =
  | { ok: true }
  | { ok: false; reason: OnlineSessionValidationReason; error: Error };

export const ONLINE_SESSION_STORAGE_KEY = 'zutomayo_online_session';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function isOnlineSession(data: Partial<OnlineSession>): data is OnlineSession {
  return (
    typeof data.matchID === 'string' &&
    (data.playerID === '0' || data.playerID === '1') &&
    typeof data.playerCredentials === 'string' &&
    (data.platformSeatToken === undefined || typeof data.platformSeatToken === 'string') &&
    (data.platformUserId === undefined || typeof data.platformUserId === 'string') &&
    (data.platformDisplayName === undefined || typeof data.platformDisplayName === 'string')
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

export function resolveOnlineRouteSession(
  session: OnlineSession | null,
  storedSession: OnlineSession | null,
  matchID: string,
  spectatorMode: boolean,
): OnlineSession | null {
  if (spectatorMode || !matchID) return null;
  if (session?.matchID === matchID) return session;
  return storedSession?.matchID === matchID ? storedSession : null;
}

export async function leaveOnlineSession(session: OnlineSession): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(`/games/zutomayo-card/${encodeURIComponent(session.matchID)}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      keepalive: true,
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestOnlineRematch(session: OnlineSession): Promise<string> {
  const response = await fetch(`/games/zutomayo-card/${encodeURIComponent(session.matchID)}/playAgain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerID: session.playerID,
      credentials: session.playerCredentials,
      unlisted: true,
    }),
  });
  if (!response.ok) throw await onlineHttpError(response, 'requestOnlineRematch');
  const data = (await response.json()) as { nextMatchID?: unknown };
  if (typeof data.nextMatchID !== 'string' || !data.nextMatchID) {
    throw new Error('Online rematch did not return a match ID');
  }
  return data.nextMatchID;
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

    if (response.ok) {
      const data = (await response.json()) as Partial<OnlineSession>;
      if (typeof data.platformSeatToken === 'string' && data.platformSeatToken) {
        session.platformSeatToken = data.platformSeatToken;
      }
      if (typeof data.platformUserId === 'string' && data.platformUserId) {
        session.platformUserId = data.platformUserId;
      }
      saveOnlineSession(session);
      return { ok: true };
    }
    const error = await onlineHttpError(response, 'validateOnlineSession');
    if (response.status === 426) return { ok: false, reason: 'versionMismatch', error };
    if (response.status === 404) return { ok: false, reason: 'roomGone', error };
    if (response.status === 403) return { ok: false, reason: 'invalidSession', error };
    if (response.status === 409) {
      const reason =
        /player (?:not reserved|not available)|no available seats|seat (?:is )?(?:taken|unavailable)/i.test(
          error.message,
        )
          ? 'seatTaken'
          : 'invalidSession';
      return { ok: false, reason, error };
    }
    return { ok: false, reason: 'network', error };
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'online-session',
      message: 'validateOnlineSession network error',
      level: 'warning',
      data: { match_id: session.matchID, error: err instanceof Error ? err.message : String(err) },
    });
    return {
      ok: false,
      reason: 'network',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
