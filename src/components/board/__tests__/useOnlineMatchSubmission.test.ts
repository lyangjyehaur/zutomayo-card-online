import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../game/types';
import {
  accountIdForPlayer,
  activeAccountPlayer,
  matchSubmissionKey,
  matchDurationSeconds,
  normalizeGameOverWinner,
  onlineSourceMatchID,
  parseStoredEloSubmission,
  signedEloChange,
} from '../useOnlineMatchSubmission';

function gameState(overrides: Partial<GameState> = {}): GameState {
  return {
    winner: null,
    turnNumber: 3,
    gameoverReason: 'Player 1 loses at 0 HP.',
    actionLog: [
      { id: 1, turn: 1, step: 'janken', player: 0, action: 'janken', timestamp: 1000, payload: {} },
      { id: 2, turn: 3, step: 'gameOver', player: 0, action: 'gameOver', timestamp: 2000, payload: {} },
    ],
    ...overrides,
  } as unknown as GameState;
}

describe('useOnlineMatchSubmission helpers', () => {
  it('normalizes boardgame.io gameover winners and draws', () => {
    expect(normalizeGameOverWinner(gameState({ winner: 1 }), undefined)).toBe(1);
    expect(normalizeGameOverWinner(gameState(), { winner: '0' })).toBe(0);
    expect(normalizeGameOverWinner(gameState({ winner: 1 }), { draw: true, winner: '1' })).toBeNull();
  });

  it('maps the active account player by route context', () => {
    expect(activeAccountPlayer(undefined, '/play/ai')).toBe(0);
    expect(activeAccountPlayer('0', '/play/ai')).toBe(0);
    expect(activeAccountPlayer('1', '/play/ai')).toBeNull();
    expect(activeAccountPlayer('1', '/play/online/abc')).toBe(1);
    expect(activeAccountPlayer(undefined, '/play/online/abc')).toBeNull();
  });

  it('only sends source match IDs for real online rooms', () => {
    expect(onlineSourceMatchID('room-1', '/play/online/room-1')).toBe('room-1');
    expect(onlineSourceMatchID('default', '/play/online/default')).toBeUndefined();
    expect(onlineSourceMatchID('room-1', '/play/ai')).toBeUndefined();
  });

  it('builds stable submission keys from route and final action trace', () => {
    expect(matchSubmissionKey(gameState(), 0, '/play/online/room-1')).toBe(
      'zutomayo-match-submit-v2:/play/online/room-1:0:3:Player 1 loses at 0 HP.:2:1000:2000:gameOver',
    );
  });

  it('uses guest IDs only for non-account seats', () => {
    expect(accountIdForPlayer(0, 0, { id: 'u_1' })).toBe('u_1');
    expect(accountIdForPlayer(1, 0, { id: 'u_1' })).toBe('guest-player-1');
  });

  it('formats signed ELO changes', () => {
    expect(signedEloChange(12)).toBe('+12');
    expect(signedEloChange(0)).toBe('0');
    expect(signedEloChange(-8)).toBe('-8');
  });

  it('uses authoritative game timestamps for duration after remount or reconnect', () => {
    const G = gameState({ matchStartedAt: 10_000, matchEndedAt: 73_500 });
    expect(matchDurationSeconds(G, 999_999)).toBe(63.5);
  });

  it('restores the exact rated result after the result screen remounts', () => {
    expect(parseStoredEloSubmission(JSON.stringify({ status: 'rated', message: '+12' }))).toEqual({
      status: 'rated',
      message: '+12',
    });
    expect(parseStoredEloSubmission('not-json')).toBeNull();
  });
});
