import {
  connectPlatformMatchShell,
  type PlatformMatchShellHandlers,
  type PlatformMatchShellJoinOptions,
  type PlatformMatchShellRoom,
} from './platformClient';

export type PlatformMatchShellConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface PlatformMatchShellConnectionHandlers extends PlatformMatchShellHandlers {
  onRoomChange?: (room: PlatformMatchShellRoom | null) => void;
  onStateChange?: (state: PlatformMatchShellConnectionState) => void;
  onError?: (error: unknown) => void;
}

export interface PlatformMatchShellConnectionController {
  stop: () => Promise<void>;
}

type Connector = (
  options: PlatformMatchShellJoinOptions,
  handlers: PlatformMatchShellHandlers,
) => Promise<PlatformMatchShellRoom>;
type TimerHandle = ReturnType<typeof setTimeout>;

export function platformMatchShellReconnectDelay(attempt: number): number {
  const normalizedAttempt = Math.min(Math.max(0, Math.floor(attempt)), 4);
  return Math.min(15_000, 500 * 2 ** normalizedAttempt);
}

export function connectPlatformMatchShellWithRetry(
  options: PlatformMatchShellJoinOptions,
  handlers: PlatformMatchShellConnectionHandlers,
  dependencies: {
    connect?: Connector;
    setTimeout?: (callback: () => void, delay: number) => TimerHandle;
    clearTimeout?: (handle: TimerHandle) => void;
  } = {},
): PlatformMatchShellConnectionController {
  const connect = dependencies.connect ?? connectPlatformMatchShell;
  const setTimer = dependencies.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimer = dependencies.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
  let stopped = false;
  let generation = 0;
  let retryAttempt = 0;
  let retryTimer: TimerHandle | null = null;
  let activeRoom: PlatformMatchShellRoom | null = null;

  const state = (next: PlatformMatchShellConnectionState) => handlers.onStateChange?.(next);
  const isCurrent = (candidate: number) => !stopped && candidate === generation;

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null) return;
    const delay = platformMatchShellReconnectDelay(retryAttempt);
    retryAttempt += 1;
    state('reconnecting');
    retryTimer = setTimer(() => {
      retryTimer = null;
      void connectOnce();
    }, delay);
  };

  const connectOnce = async (): Promise<void> => {
    if (stopped) return;
    const candidate = ++generation;
    state(candidate === 1 ? 'connecting' : 'reconnecting');
    try {
      const room = await connect(options, {
        onSnapshot: (snapshot) => {
          if (isCurrent(candidate)) handlers.onSnapshot?.(snapshot);
        },
        onPresence: (presence) => {
          if (!isCurrent(candidate)) return;
          handlers.onPresence?.(presence);
          retryAttempt = 0;
          state('connected');
        },
        onChatPreview: (message) => {
          if (isCurrent(candidate)) handlers.onChatPreview?.(message);
        },
        onDisconnect: () => {
          if (!isCurrent(candidate)) return;
          generation += 1;
          activeRoom = null;
          handlers.onRoomChange?.(null);
          handlers.onDisconnect?.();
          scheduleReconnect();
        },
      });
      if (!isCurrent(candidate)) {
        await room.leave(true).catch(() => undefined);
        return;
      }
      activeRoom = room;
      handlers.onRoomChange?.(room);
      state('connected');
    } catch (error) {
      if (!isCurrent(candidate)) return;
      handlers.onError?.(error);
      scheduleReconnect();
    }
  };

  void connectOnce();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      generation += 1;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      const room = activeRoom;
      activeRoom = null;
      handlers.onRoomChange?.(null);
      state('stopped');
      await room?.leave(true).catch(() => undefined);
    },
  };
}
