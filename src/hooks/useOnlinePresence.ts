import { useCallback, useEffect, useState } from 'react';
import { fetchOnlinePresence, sendOnlinePresenceHeartbeat } from '../api/client';
import { connectPlatformLobby, type PlatformLobbyRoom } from '../platformClient';

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
    let fallbackStarted = false;
    let fallbackTimer: number | undefined;
    let platformRoom: PlatformLobbyRoom | undefined;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };

    const startHttpFallback = () => {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;
      void refresh(true);
      fallbackTimer = window.setInterval(() => void refresh(true), HEARTBEAT_INTERVAL_MS);
      window.addEventListener('focus', refreshWhenVisible);
      document.addEventListener('visibilitychange', refreshWhenVisible);
    };

    const stopHttpFallback = () => {
      if (!fallbackStarted) return;
      fallbackStarted = false;
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
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
