import { getLocale } from './i18n';
import { APP_VERSION_INFO } from './version';

export type DeckShareEventName =
  | 'deck_share_publish'
  | 'deck_share_update'
  | 'deck_share_unpublish'
  | 'deck_share_lobby_filter'
  | 'deck_share_detail_open'
  | 'deck_share_copy'
  | 'deck_share_like'
  | 'deck_share_report';

export interface DeckShareEventData {
  visibility?: 'public' | 'unlisted';
  sort?: 'newest' | 'popular' | 'most-copied';
  element?: string;
  is_logged_in?: boolean;
  source?: 'deck_builder' | 'lobby' | 'detail';
}

export function buildDeckShareAnalyticsPayload(data: DeckShareEventData = {}) {
  return {
    app_version: APP_VERSION_INFO.appVersion,
    rules_version: APP_VERSION_INFO.rulesVersion,
    locale: getLocale(),
    viewport:
      typeof window === 'undefined'
        ? 'unknown'
        : window.innerWidth < 640
          ? 'mobile'
          : window.innerWidth < 1024
            ? 'tablet'
            : 'desktop',
    ...(data.visibility ? { visibility: data.visibility } : {}),
    ...(data.sort ? { sort: data.sort } : {}),
    ...(data.element ? { element: data.element.slice(0, 16) } : {}),
    ...(data.is_logged_in !== undefined ? { is_logged_in: data.is_logged_in } : {}),
    ...(data.source ? { source: data.source } : {}),
  };
}

export function trackDeckShareEvent(name: DeckShareEventName, data: DeckShareEventData = {}): void {
  try {
    window.umami?.track(name, buildDeckShareAnalyticsPayload(data));
  } catch {
    // Product analytics must never affect deck sharing.
  }
}
