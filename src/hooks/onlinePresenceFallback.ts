type PresenceFallbackTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface OnlinePresenceFallbackController {
  readonly started: boolean;
  start(): void;
  stop(): void;
}

interface OnlinePresenceFallbackOptions {
  refresh: (heartbeat?: boolean) => void | Promise<void>;
  intervalMs: number;
  windowTarget: PresenceFallbackTarget;
  documentTarget: PresenceFallbackTarget;
  visibilityState: () => DocumentVisibilityState;
  setIntervalFn: (handler: () => void, timeout: number) => number;
  clearIntervalFn: (timerId: number) => void;
}

export function createOnlinePresenceFallbackController({
  refresh,
  intervalMs,
  windowTarget,
  documentTarget,
  visibilityState,
  setIntervalFn,
  clearIntervalFn,
}: OnlinePresenceFallbackOptions): OnlinePresenceFallbackController {
  let started = false;
  let timerId: number | undefined;

  const refreshWhenVisible = () => {
    if (visibilityState() === 'visible') void refresh(true);
  };

  return {
    get started() {
      return started;
    },
    start() {
      if (started) return;
      started = true;
      void refresh(true);
      timerId = setIntervalFn(() => void refresh(true), intervalMs);
      windowTarget.addEventListener('focus', refreshWhenVisible);
      documentTarget.addEventListener('visibilitychange', refreshWhenVisible);
    },
    stop() {
      if (!started) return;
      started = false;
      if (timerId !== undefined) clearIntervalFn(timerId);
      timerId = undefined;
      windowTarget.removeEventListener('focus', refreshWhenVisible);
      documentTarget.removeEventListener('visibilitychange', refreshWhenVisible);
    },
  };
}
