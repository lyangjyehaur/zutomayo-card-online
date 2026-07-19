import { getLocale } from './i18n';
import { APP_VERSION_INFO } from './version';

export type FunnelEventName =
  | 'F_Tutorial_Start'
  | 'F_Tutorial_Step'
  | 'F_Tutorial_First_Action'
  | 'F_Tutorial_Exit'
  | 'F_Tutorial_Complete'
  | 'F_Queue_Start'
  | 'F_Queue_Checkpoint'
  | 'F_Queue_Cancel'
  | 'F_Queue_Match'
  | 'F_Match_Start'
  | 'F_Match_Reconnect'
  | 'F_Match_Complete'
  | 'F_First_Win';

export type FunnelEventData = Partial<{
  step: number;
  total_steps: number;
  phase: string;
  reason: 'route_exit' | 'back' | 'skip' | 'player' | 'fallback_custom_room' | 'fallback_friend_invite';
  elapsed_s: number;
  queue_duration_s: number;
  match_mode: 'quick_match' | 'custom_room' | 'friend_invite' | 'online';
  outcome: 'win' | 'loss' | 'draw';
}>;

export interface FunnelContext {
  app_version: string;
  build_id: string;
  rules_version: string;
  dataset_sha256: string;
  locale: string;
  viewport_class: 'mobile' | 'tablet' | 'desktop';
  entry_route: string;
}

const ENTRY_ROUTE_KEY = 'zutomayo_funnel_entry_route';
const FIRST_WIN_KEY = 'zutomayo_funnel_first_win';
const DATASET_SHA256 = import.meta.env.VITE_CARD_DATASET_SHA256 || 'unknown';
const pendingEvents: Array<{ name: FunnelEventName; data: FunnelContext & FunnelEventData }> = [];

export function viewportClass(width: number): FunnelContext['viewport_class'] {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function buildFunnelPayload(
  context: FunnelContext,
  data: FunnelEventData = {},
): FunnelContext & FunnelEventData {
  return { ...context, ...data };
}

export function sanitizeFunnelEntryRoute(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : '/';
  if (/^\/play\/online\/[^/]+/.test(normalized)) return '/play/online/:matchID';
  return normalized.slice(0, 160);
}

function entryRoute(): string {
  try {
    const existing = window.sessionStorage.getItem(ENTRY_ROUTE_KEY);
    if (existing) return existing;
    const route = sanitizeFunnelEntryRoute(window.location.pathname);
    window.sessionStorage.setItem(ENTRY_ROUTE_KEY, route);
    return route;
  } catch {
    return sanitizeFunnelEntryRoute(window.location.pathname);
  }
}

function context(): FunnelContext {
  return {
    app_version: APP_VERSION_INFO.appVersion,
    build_id: APP_VERSION_INFO.buildId,
    rules_version: APP_VERSION_INFO.rulesVersion,
    dataset_sha256: DATASET_SHA256,
    locale: getLocale(),
    viewport_class: viewportClass(window.innerWidth),
    entry_route: entryRoute(),
  };
}

export function trackFunnelEvent(name: FunnelEventName, data: FunnelEventData = {}): void {
  try {
    const payload = buildFunnelPayload(context(), data);
    if (!window.umami) {
      pendingEvents.push({ name, data: payload });
      if (pendingEvents.length > 100) pendingEvents.shift();
      return;
    }
    window.umami.track(name, { ...payload });
  } catch {
    // Product telemetry must never affect navigation or gameplay.
  }
}

export function flushFunnelEvents(): void {
  try {
    if (!window.umami) return;
    for (const event of pendingEvents.splice(0)) {
      window.umami.track(event.name, { ...event.data });
    }
  } catch {
    // A telemetry flush must never affect application startup.
  }
}

export function trackFirstWinOnce(matchMode: FunnelEventData['match_mode']): void {
  try {
    if (window.localStorage.getItem(FIRST_WIN_KEY) === 'true') return;
    window.localStorage.setItem(FIRST_WIN_KEY, 'true');
    trackFunnelEvent('F_First_Win', { match_mode: matchMode, outcome: 'win' });
  } catch {
    trackFunnelEvent('F_First_Win', { match_mode: matchMode, outcome: 'win' });
  }
}
