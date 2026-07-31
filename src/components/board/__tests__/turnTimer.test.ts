import { describe, expect, it } from 'vitest';
import { shouldRunBoardTurnTimer } from '../turnTimer';

describe('board turn timer ownership', () => {
  it('runs only on the visible player client in a local AI match', () => {
    expect(shouldRunBoardTurnTimer({ spectator: false, useServerTimer: false, playerID: '0' })).toBe(true);
    expect(shouldRunBoardTurnTimer({ spectator: false, useServerTimer: false, playerID: '1' })).toBe(false);
  });

  it('allows either seated online client to submit authoritative timeout recovery', () => {
    expect(shouldRunBoardTurnTimer({ spectator: false, useServerTimer: true, playerID: '0' })).toBe(true);
    expect(shouldRunBoardTurnTimer({ spectator: false, useServerTimer: true, playerID: '1' })).toBe(true);
  });

  it('never runs for spectators', () => {
    expect(shouldRunBoardTurnTimer({ spectator: true, useServerTimer: true, playerID: null })).toBe(false);
  });
});
