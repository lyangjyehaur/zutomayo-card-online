import { describe, expect, it, vi } from 'vitest';
import { createRelationshipChangeProcessor, createRelationshipRecoveryLoop } from '../relationshipEventProcessor';
import type { PlatformRelationshipChange } from '../rooms/types';

function event(eventId = 'event-1'): PlatformRelationshipChange {
  return {
    version: 1,
    eventId,
    kind: 'friendship_removed',
    userIds: ['u_1', 'u_2'],
    occurredAt: '2026-07-13T00:00:00.000Z',
  };
}

describe('relationship event processor', () => {
  it('coalesces concurrent delivery and suppresses completed duplicates', async () => {
    const apply = vi.fn(async () => undefined);
    const processor = createRelationshipChangeProcessor(apply);

    await Promise.all([processor.handle(event()), processor.handle(event())]);
    await processor.handle(event());

    expect(apply).toHaveBeenCalledOnce();
  });

  it('does not remember a failed event and allows a retry', async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error('room unavailable')).mockResolvedValueOnce(undefined);
    const processor = createRelationshipChangeProcessor(apply);

    await expect(processor.handle(event())).rejects.toThrow('room unavailable');
    await expect(processor.handle(event())).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('reprocesses an event after the bounded TTL expires', async () => {
    let timestamp = 1_000;
    const apply = vi.fn(async () => undefined);
    const processor = createRelationshipChangeProcessor(apply, { ttlMs: 1_000, now: () => timestamp });

    await processor.handle(event());
    timestamp = 2_001;
    await processor.handle(event());

    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('keeps authorization unavailable and retries reconciliation until it succeeds', async () => {
    vi.useFakeTimers();
    const recover = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(undefined);
    const onUnavailable = vi.fn();
    const onReady = vi.fn();
    const loop = createRelationshipRecoveryLoop({
      recover,
      onUnavailable,
      onReady,
      initialDelayMs: 100,
      maxDelayMs: 400,
    });

    loop.schedule();
    expect(onUnavailable).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledOnce();

    loop.stop();
    loop.schedule();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recover).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
