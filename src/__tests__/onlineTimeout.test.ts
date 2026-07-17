import { describe, expect, it } from 'vitest';
import {
  canSubmitOnlineTimeout,
  ONLINE_OPPONENT_TIMEOUT_GRACE_MS,
  ONLINE_TIMEOUT_RETRY_MS,
  onlinePhaseTimerStartedAt,
} from '../onlineTimeout';

describe('online timeout coordination', () => {
  it('starts initial janken when the playable phase is observed instead of when the room was created', () => {
    expect(onlinePhaseTimerStartedAt({ step: 'janken', serverStartedAt: 1_000, phaseObservedAt: 90_000 })).toBe(90_000);
  });

  it('keeps server-authoritative timestamps after the initial room wait', () => {
    expect(onlinePhaseTimerStartedAt({ step: 'mulligan', serverStartedAt: 1_000, phaseObservedAt: 90_000 })).toBe(
      1_000,
    );
  });

  it('lets each player submit its own timeout first and delays opponent recovery', () => {
    const base = { expiredForMs: 0, lastAttemptAt: undefined, now: 100_000 };
    expect(canSubmitOnlineTimeout({ ...base, target: 0, localPlayer: 0 })).toBe(true);
    expect(canSubmitOnlineTimeout({ ...base, target: 1, localPlayer: 0 })).toBe(false);
    expect(
      canSubmitOnlineTimeout({
        ...base,
        target: 1,
        localPlayer: 0,
        expiredForMs: ONLINE_OPPONENT_TIMEOUT_GRACE_MS,
      }),
    ).toBe(true);
  });

  it('rate-limits repeated timeout recovery for the same authoritative state', () => {
    expect(
      canSubmitOnlineTimeout({
        target: 0,
        localPlayer: 0,
        expiredForMs: 10_000,
        lastAttemptAt: 100_000,
        now: 100_000 + ONLINE_TIMEOUT_RETRY_MS - 1,
      }),
    ).toBe(false);
  });
});
