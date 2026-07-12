import { useCallback, useEffect, useState } from 'react';
import { fetchOnlinePresence, sendOnlinePresenceHeartbeat } from '../api/client';
import { connectPlatformLobby } from '../platformClient';
import { createOnlinePresenceConnectionController } from './onlinePresenceConnection';
import { createOnlinePresenceFallbackController } from './onlinePresenceFallback';

const PRESENCE_VISITOR_ID_KEY = 'zutomayo_presence_visitor_id';
const HEARTBEAT_INTERVAL_MS = 30_000;
const PRESENCE_VISITOR_ID_PATTERN = /^anon:presence:[a-zA-Z0-9_-]{8,82}$/;
const LEGACY_PRESENCE_VISITOR_ID_PATTERN = /^presence:[a-zA-Z0-9_-]{8,82}$/;

interface PresenceVisitorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createPresenceVisitorId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `anon:presence:${random.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function normalizePresenceVisitorId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (PRESENCE_VISITOR_ID_PATTERN.test(trimmed)) return trimmed;
  if (LEGACY_PRESENCE_VISITOR_ID_PATTERN.test(trimmed)) return `anon:${trimmed}`;
  return null;
}

export function loadPresenceVisitorId(
  storage: PresenceVisitorStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
): string {
  if (!storage) return createPresenceVisitorId();
  const existing = storage.getItem(PRESENCE_VISITOR_ID_KEY);
  const normalized = normalizePresenceVisitorId(existing);
  if (normalized) {
    if (normalized !== existing) storage.setItem(PRESENCE_VISITOR_ID_KEY, normalized);
    return normalized;
  }
  const next = createPresenceVisitorId();
  storage.setItem(PRESENCE_VISITOR_ID_KEY, next);
  return next;
}

export function useOnlinePresence() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  const refresh = useCallback(async (heartbeat = true) => {
    try {
      const visitorId = loadPresenceVisitorId();
      const data = heartbeat ? await sendOnlinePresenceHeartbeat(visitorId) : await fetchOnlinePresence();
      setOnlineCount(Math.max(0, Math.trunc(data.onlineCount)));
    } catch {
      setOnlineCount(null);
    }
  }, []);

  useEffect(() => {
    const fallback = createOnlinePresenceFallbackController({
      refresh,
      intervalMs: HEARTBEAT_INTERVAL_MS,
      windowTarget: window,
      documentTarget: document,
      visibilityState: () => document.visibilityState,
      setIntervalFn: window.setInterval.bind(window),
      clearIntervalFn: window.clearInterval.bind(window),
    });
    const connection = createOnlinePresenceConnectionController({
      connectPlatformLobby,
      loadVisitorId: loadPresenceVisitorId,
      fallback,
      setOnlineCount,
    });
    connection.connect();

    return () => {
      connection.dispose();
    };
  }, [refresh]);

  return { onlineCount, refresh };
}
