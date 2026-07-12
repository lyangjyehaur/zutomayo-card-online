import type { PlatformLobbyHandlers, PlatformLobbyJoinOptions, PlatformLobbyRoom } from '../platformClient';
import type { OnlinePresenceFallbackController } from './onlinePresenceFallback';

type ConnectPlatformLobby = (
  options: PlatformLobbyJoinOptions,
  handlers: PlatformLobbyHandlers,
) => Promise<PlatformLobbyRoom>;

interface OnlinePresenceConnectionOptions {
  connectPlatformLobby: ConnectPlatformLobby;
  loadVisitorId: () => string;
  fallback: OnlinePresenceFallbackController;
  setOnlineCount: (onlineCount: number) => void;
}

export interface OnlinePresenceConnectionController {
  readonly disposed: boolean;
  connect(): void;
  dispose(): void;
}

export function createOnlinePresenceConnectionController({
  connectPlatformLobby,
  loadVisitorId,
  fallback,
  setOnlineCount,
}: OnlinePresenceConnectionOptions): OnlinePresenceConnectionController {
  let disposed = false;
  let connectStarted = false;
  let platformRoom: PlatformLobbyRoom | undefined;

  const startHttpFallback = () => {
    if (disposed) return;
    fallback.start();
  };

  const stopHttpFallback = () => {
    fallback.stop();
  };

  return {
    get disposed() {
      return disposed;
    },
    connect() {
      if (connectStarted) return;
      connectStarted = true;

      void connectPlatformLobby(
        {
          userId: loadVisitorId(),
          displayName: 'visitor',
          role: 'spectator',
        },
        {
          onOnlineCount: (count) => {
            if (disposed) return;
            stopHttpFallback();
            setOnlineCount(count);
          },
          onDisconnect: startHttpFallback,
        },
      ).then(
        (room) => {
          if (disposed) {
            void room.leave(true).catch(() => undefined);
            return;
          }
          platformRoom = room;
        },
        () => {
          startHttpFallback();
        },
      );
    },
    dispose() {
      disposed = true;
      stopHttpFallback();
      void platformRoom?.leave(true).catch(() => undefined);
    },
  };
}
