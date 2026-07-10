import { describe, expect, it, vi } from 'vitest';
import { createOnlinePresenceFallbackController } from '../hooks/onlinePresenceFallback';

class FakeEventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(new Event(type));
      else listener.handleEvent(new Event(type));
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('online presence fallback controller', () => {
  it('starts HTTP heartbeat fallback once and stops all fallback listeners', () => {
    const refresh = vi.fn();
    const timers = new Map<number, () => void>();
    let nextTimerId = 1;
    let visibilityState: DocumentVisibilityState = 'visible';
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeEventTarget();
    const clearIntervalFn = vi.fn((timerId: number) => {
      timers.delete(timerId);
    });

    const fallback = createOnlinePresenceFallbackController({
      refresh,
      intervalMs: 30_000,
      windowTarget,
      documentTarget,
      visibilityState: () => visibilityState,
      setIntervalFn: (handler, timeout) => {
        expect(timeout).toBe(30_000);
        const timerId = nextTimerId;
        nextTimerId += 1;
        timers.set(timerId, handler);
        return timerId;
      },
      clearIntervalFn,
    });

    fallback.start();
    fallback.start();

    expect(fallback.started).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(windowTarget.listenerCount('focus')).toBe(1);
    expect(documentTarget.listenerCount('visibilitychange')).toBe(1);

    timers.get(1)?.();
    windowTarget.dispatch('focus');
    visibilityState = 'hidden';
    documentTarget.dispatch('visibilitychange');
    expect(refresh).toHaveBeenCalledTimes(3);

    fallback.stop();
    fallback.stop();

    expect(fallback.started).toBe(false);
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
    expect(timers).toHaveLength(0);
    expect(windowTarget.listenerCount('focus')).toBe(0);
    expect(documentTarget.listenerCount('visibilitychange')).toBe(0);
  });
});
