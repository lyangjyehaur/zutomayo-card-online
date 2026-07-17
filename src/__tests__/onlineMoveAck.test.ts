import { describe, expect, it } from 'vitest';
import { didOnlineStateAdvance, shouldTrackOnlineMove } from '../onlineMoveAck';

describe('online move acknowledgement', () => {
  it('tracks player commands but excludes background timeout recovery', () => {
    expect(shouldTrackOnlineMove('keepHand')).toBe(true);
    expect(shouldTrackOnlineMove('setInitialCard')).toBe(true);
    expect(shouldTrackOnlineMove('timeoutAdvance')).toBe(false);
    expect(shouldTrackOnlineMove('timeoutSkip')).toBe(false);
  });

  it('requires a newer authoritative state ID to acknowledge a move', () => {
    expect(didOnlineStateAdvance(4, null)).toBe(false);
    expect(didOnlineStateAdvance(4, 4)).toBe(false);
    expect(didOnlineStateAdvance(4, 5)).toBe(true);
  });
});
