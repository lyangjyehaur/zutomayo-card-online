import { useEffect, useRef, useState } from 'react';
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
  matchStartedAt: number;
  playerID?: string | null;
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
    'zutomayo-match-submit',
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

function isAlreadySubmitted(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSubmitted(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Submission still proceeds; the in-memory ref prevents same-mount duplicates.
  }
}

export function signedEloChange(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function useOnlineMatchSubmission({
  G,
  gameover,
  matchID,
  matchStartedAt,
  playerID,
}: OnlineMatchSubmissionOptions): string {
  const saved = useRef(false);
  const [eloNotice, setEloNotice] = useState('');

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;

    const durationSeconds = (Date.now() - matchStartedAt) / 1000;
    const winner = normalizeGameOverWinner(G, gameover);
    const submitKey = matchSubmissionKey(G, winner);
    if (isAlreadySubmitted(submitKey)) return;

    markSubmitted(submitKey);
    saveMatchRecord(G, gameover?.winner ?? winner, durationSeconds);

    const accountPlayer = activeAccountPlayer(playerID);
    if (!isLoggedIn() || winner === null || accountPlayer === null) return;

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
          onlineSourceMatchID(matchID),
          winner,
        ) as Promise<MatchSubmitResponse>;
      })
      .then((result) => {
        if ((result.winnerEloChange ?? 0) === 0 && (result.loserEloChange ?? 0) === 0) {
          setEloNotice(t('auth.matchSubmittedNoElo'));
          return;
        }
        const change = winner === accountPlayer ? (result.winnerEloChange ?? 0) : (result.loserEloChange ?? 0);
        setEloNotice(`${t('auth.eloChange')} ${signedEloChange(change)}`);
      })
      .catch(() => {
        // Local history above remains the fallback when the API is unavailable.
        setEloNotice(t('auth.matchSubmitFailed'));
      });
  }, [G, gameover, matchID, matchStartedAt, playerID]);

  return eloNotice;
}
