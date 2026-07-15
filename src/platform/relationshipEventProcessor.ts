import type { PlatformRelationshipChange } from './rooms/types';

export interface RelationshipChangeProcessor {
  handle(change: PlatformRelationshipChange): Promise<void>;
}

export interface RelationshipRecoveryLoop {
  schedule(): void;
  stop(): void;
}

export function createRelationshipRecoveryLoop({
  recover,
  onUnavailable,
  onReady,
  onError,
  initialDelayMs = 250,
  maxDelayMs = 10_000,
}: {
  recover: () => Promise<void>;
  onUnavailable: () => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
}): RelationshipRecoveryLoop {
  const initialDelay = Math.max(10, Math.floor(initialDelayMs));
  const maxDelay = Math.max(initialDelay, Math.floor(maxDelayMs));
  let delayMs = initialDelay;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped || timer) return;
    onUnavailable();
    timer = setTimeout(() => {
      timer = null;
      void recover()
        .then(() => {
          delayMs = initialDelay;
          onReady?.();
        })
        .catch((error) => {
          onError?.(error);
          delayMs = Math.min(maxDelay, delayMs * 2);
          schedule();
        });
    }, delayMs);
    timer.unref?.();
  };

  return {
    schedule,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function createRelationshipChangeProcessor(
  apply: (change: PlatformRelationshipChange) => Promise<void>,
  { maxEntries = 4096, ttlMs = 15 * 60 * 1000, now = Date.now } = {},
): RelationshipChangeProcessor {
  const processed = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();
  const safeMaxEntries = Math.max(100, Math.min(100_000, Math.floor(maxEntries)));
  const safeTtlMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(ttlMs)));

  const prune = (timestamp: number) => {
    for (const [eventId, expiresAt] of processed) {
      if (expiresAt > timestamp && processed.size <= safeMaxEntries) break;
      processed.delete(eventId);
    }
  };

  return {
    async handle(change) {
      const timestamp = now();
      prune(timestamp);
      if ((processed.get(change.eventId) ?? 0) > timestamp) return;
      const existing = inFlight.get(change.eventId);
      if (existing) return existing;
      const execution = apply(change)
        .then(() => {
          processed.delete(change.eventId);
          processed.set(change.eventId, now() + safeTtlMs);
          prune(now());
        })
        .finally(() => {
          inFlight.delete(change.eventId);
        });
      inFlight.set(change.eventId, execution);
      return execution;
    },
  };
}
