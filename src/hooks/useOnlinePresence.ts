import { useCallback, useEffect, useState } from 'react';
import { fetchOnlinePresence, sendOnlinePresenceHeartbeat } from '../api/client';

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
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), HEARTBEAT_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  return { onlineCount, refresh };
}
