import { describe, expect, it } from 'vitest';
import { handSelectionResetKey } from '../handSelection';

describe('battle hand selection reset key', () => {
  const initial = {
    step: 'initialSet' as const,
    turnNumber: 1,
    ready: [false, false] as const,
    playerIndex: 1 as const,
    playerID: '1',
  };

  it('does not reset when only the opponent ready state changes', () => {
    const before = handSelectionResetKey(initial);
    const afterOpponentMove = handSelectionResetKey({ ...initial, ready: [true, false] });

    expect(afterOpponentMove).toBe(before);
  });

  it('resets when the local player or interaction window changes', () => {
    const before = handSelectionResetKey(initial);

    expect(handSelectionResetKey({ ...initial, ready: [false, true] })).not.toBe(before);
    expect(handSelectionResetKey({ ...initial, step: 'turnSet' })).not.toBe(before);
    expect(handSelectionResetKey({ ...initial, turnNumber: 2 })).not.toBe(before);
    expect(handSelectionResetKey({ ...initial, playerIndex: 0, playerID: '0' })).not.toBe(before);
  });
});
