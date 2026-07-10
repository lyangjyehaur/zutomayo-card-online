import { useCallback, useEffect, useState } from 'react';
import { fetchOnlinePresence, sendOnlinePresenceHeartbeat } from '../api/client';
import { connectPlatformLobby, type PlatformLobbyRoom } from '../platformClient';
import { createOnlinePresenceFallbackController } from './onlinePresenceFallback';

const PRESENCE_VISITOR_ID_KEY = 'zutomayo_presence_visitor_id';
const HEARTBEAT_INTERVAL_MS = 30_000;

function createVisitorId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `presence:${random.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function loadVisitorId(): string {
  if (typeof localStorage === 'undefined') return createVisitorId();
  const existing = localStorage.getItem(PRESENCE_VISITOR_ID_KEY);
  if (existing && /^[a-zA-Z0-9:_-]{8,96}$/.test(existing)) return existing;
  const next = createVisitorId();
  localStorage.setItem(PRESENCE_VISITOR_ID_KEY, next);
  return next;
}

export function useOnlinePresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  const refresh = useCallback(async (heartbeat = true) => {
    try {
      const visitorId = loadVisitorId();
      const data = heartbeat ? await sendOnlinePresenceHeartbeat(visitorId) : await fetchOnlinePresence();
      setOnlineCount(Math.max(0, Math.trunc(data.onlineCount)));
    } catch {
      setOnlineCount(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let platformRoom: PlatformLobbyRoom | undefined;
    const fallback = createOnlinePresenceFallbackController({
      refresh,
      intervalMs: HEARTBEAT_INTERVAL_MS,
      windowTarget: window,
      documentTarget: document,
      visibilityState: () => document.visibilityState,
      setIntervalFn: window.setInterval.bind(window),
      clearIntervalFn: window.clearInterval.bind(window),
    });

    const startHttpFallback = () => {
      if (cancelled) return;
      fallback.start();
    };

    const stopHttpFallback = () => {
      fallback.stop();
    };

    void connectPlatformLobby(
      {
        userId: loadVisitorId(),
        displayName: 'visitor',
        role: 'spectator',
      },
      {
        onOnlineCount: (count) => {
          if (cancelled) return;
          stopHttpFallback();
          setOnlineCount(count);
        },
        onDisconnect: startHttpFallback,
      },
    ).then(
      (room) => {
        if (cancelled) {
          void room.leave(true).catch(() => undefined);
          return;
        }
        platformRoom = room;
      },
      () => {
        startHttpFallback();
      },
    );

    return () => {
      cancelled = true;
      stopHttpFallback();
      void platformRoom?.leave(true).catch(() => undefined);
    };
  }, [refresh]);

  return { onlineCount, refresh };
}
