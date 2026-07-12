import { useCallback, useEffect, useRef, useState } from 'react';
import { getProfile, isLoggedIn, submitMatch } from '../../api/client';
import { saveMatchRecord } from '../../game/matchHistory';
import type { GameState, PlayerIndex } from '../../game/types';
import { t } from '../../i18n';

type GameOverState = { winner?: string | number; draw?: boolean };
type MatchSubmitResponse = {
  winnerEloChange?: number;
  loserEloChange?: number;
};

type AccountProfile = {
  id: string;
};

export type OnlineMatchSubmissionOptions = {
  G: GameState;
  gameover?: GameOverState;
  matchID?: string;
  playerID?: string | null;
};

export type EloSubmissionState = {
  status: 'pending' | 'rated' | 'unrated' | 'failed';
  message: string;
  retry?: () => void;
};

function currentPathname(): string {
  return typeof window === 'undefined' ? 'server' : window.location.pathname;
}

export function normalizeGameOverWinner(G: GameState, gameover?: GameOverState): PlayerIndex | null {
  if (gameover?.draw) return null;
  const winner = gameover?.winner ?? G.winner;
  if (winner === 0 || winner === '0') return 0;
  if (winner === 1 || winner === '1') return 1;
  return G.winner;
}

export function activeAccountPlayer(
  playerID: string | null | undefined,
  pathname = currentPathname(),
): PlayerIndex | null {
  if (playerID !== '0' && playerID !== '1') return 0;
  const player = Number(playerID) as PlayerIndex;
  if (pathname.startsWith('/play/online/')) return player;
  return player === 0 ? 0 : null;
}

export function accountIdForPlayer(player: PlayerIndex, accountPlayer: PlayerIndex, profile: AccountProfile): string {
  return player === accountPlayer ? profile.id : `guest-player-${player}`;
}

export function matchSubmissionKey(G: GameState, winner: PlayerIndex | null, pathname = currentPathname()): string {
  const firstEntry = G.actionLog?.[0];
  const lastEntry = G.actionLog?.[G.actionLog.length - 1];
  return [
    'zutomayo-match-submit-v2',
    pathname,
    winner ?? 'draw',
    G.turnNumber,
    G.gameoverReason ?? '',
    G.actionLog?.length ?? 0,
    firstEntry?.timestamp ?? '',
    lastEntry?.timestamp ?? '',
    lastEntry?.action ?? '',
  ].join(':');
}

export function onlineSourceMatchID(matchID: string | undefined, pathname = currentPathname()): string | undefined {
  if (!pathname.startsWith('/play/online/')) return undefined;
  return matchID && matchID !== 'default' ? matchID : undefined;
}

export function parseStoredEloSubmission(value: string | null): EloSubmissionState | null {
  if (!value) return null;
  if (value === '1') return { status: 'unrated', message: t('auth.eloUnrated') };
  try {
    const parsed = JSON.parse(value) as Partial<EloSubmissionState>;
    if ((parsed.status === 'rated' || parsed.status === 'unrated') && typeof parsed.message === 'string') {
      return { status: parsed.status, message: parsed.message };
    }
  } catch {
    return null;
  }
  return null;
}

function storedSubmission(key: string): EloSubmissionState | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseStoredEloSubmission(window.sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function markSubmitted(key: string, state: EloSubmissionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ status: state.status, message: state.message }));
  } catch {
    // Submission still proceeds; the in-memory ref prevents same-mount duplicates.
  }
}

export function signedEloChange(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function matchDurationSeconds(G: GameState, now = Date.now()): number {
  const startedAt = Number.isFinite(G.matchStartedAt) ? G.matchStartedAt : now;
  const endedAt = Number.isFinite(G.matchEndedAt) ? (G.matchEndedAt as number) : now;
  return Math.max(0, (endedAt - startedAt) / 1000);
}

export function useOnlineMatchSubmission({
  G,
  gameover,
  matchID,
  playerID,
}: OnlineMatchSubmissionOptions): EloSubmissionState {
  const submittedAttempt = useRef(-1);
  const [attempt, setAttempt] = useState(0);
  const [eloState, setEloState] = useState<EloSubmissionState>({
    status: 'pending',
    message: t('auth.eloCalculating'),
  });
  const retry = useCallback(() => {
    setEloState({ status: 'pending', message: t('auth.eloCalculating') });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (submittedAttempt.current === attempt) return;
    submittedAttempt.current = attempt;

    const durationSeconds = matchDurationSeconds(G);
    const winner = normalizeGameOverWinner(G, gameover);
    const submitKey = matchSubmissionKey(G, winner);
    const existingSubmission = storedSubmission(submitKey);
    if (existingSubmission) {
      setEloState(existingSubmission);
      return;
    }

    const sourceMatchId = onlineSourceMatchID(matchID);
    saveMatchRecord(G, gameover?.winner ?? winner, durationSeconds, sourceMatchId);

    const accountPlayer = activeAccountPlayer(playerID);
    if (!isLoggedIn() || winner === null || accountPlayer === null) {
      const state: EloSubmissionState = { status: 'unrated', message: t('auth.eloUnrated') };
      markSubmitted(submitKey, state);
      setEloState(state);
      return;
    }

    const loser = (1 - winner) as PlayerIndex;
    getProfile()
      .then((profile) => {
        const winnerId = accountIdForPlayer(winner, accountPlayer, profile);
        const loserId = accountIdForPlayer(loser, accountPlayer, profile);
        return submitMatch(
          winnerId,
          loserId,
          G.turnNumber,
          durationSeconds,
          G.actionLog,
          sourceMatchId,
          winner,
        ) as Promise<MatchSubmitResponse>;
      })
      .then((result) => {
        if ((result.winnerEloChange ?? 0) === 0 && (result.loserEloChange ?? 0) === 0) {
          const state: EloSubmissionState = { status: 'unrated', message: t('auth.eloUnrated') };
          markSubmitted(submitKey, state);
          setEloState(state);
          return;
        }
        const change = winner === accountPlayer ? (result.winnerEloChange ?? 0) : (result.loserEloChange ?? 0);
        const state: EloSubmissionState = { status: 'rated', message: signedEloChange(change) };
        markSubmitted(submitKey, state);
        setEloState(state);
      })
      .catch(() => {
        // 不寫入 submitted marker，允許玩家立即重試或重新掛載後再次提交。
        setEloState({ status: 'failed', message: t('auth.eloFailed'), retry });
      });
  }, [G, attempt, gameover, matchID, playerID, retry]);

  return eloState;
}
