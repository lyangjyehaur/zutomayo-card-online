import { onlineHttpError } from './onlineHttpError';
import { hasOnlineOpponent, type OnlineRoomStatus } from './onlineRoomStatus';
import { Sentry } from './sentry';

type MatchResponse = {
  players?: Array<{ id: number; name?: string }>;
};

export type OnlineRoomProbeResult =
  | { ok: true; opponentJoined: boolean }
  | {
      ok: false;
      reason: Exclude<OnlineRoomStatus, 'reconnecting' | 'retrying' | 'waiting' | 'ready'>;
      error: Error;
    };

export async function fetchOnlineRoom(matchID: string, playerID?: '0' | '1'): Promise<OnlineRoomProbeResult> {
  try {
    const response = await fetch(`/games/zutomayo-card/${encodeURIComponent(matchID)}`);
    if (!response.ok) {
      const error = await onlineHttpError(response, 'fetchRoom');
      return { ok: false, reason: response.status === 404 ? 'roomNotFound' : 'connectionFailed', error };
    }
    const data = (await response.json()) as MatchResponse;
    return { ok: true, opponentJoined: hasOnlineOpponent(data.players, playerID ?? '0') };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: 'fetch-room', match_id: matchID } });
    return {
      ok: false,
      reason: 'connectionFailed',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
