import type { GameNotice } from '../../game/types';

export type ResolutionNoticeChannel = 'chronos' | 'battle' | 'hp' | 'general';

export const RESOLUTION_REPLAY_WINDOW_MS = 5000;

export function resolutionNoticeChannel(notice: GameNotice): ResolutionNoticeChannel {
  if (notice.kind === 'chronosChange') return 'chronos';
  if (notice.kind === 'battleResult' || (notice.kind === 'hpChange' && notice.reason === 'battle')) return 'battle';
  if (notice.kind === 'hpChange') return 'hp';
  return 'general';
}

/**
 * On reconnect/QA mount, start at the first recent spatial animation and retain
 * every subsequent recent notice so one causal resolution batch stays complete.
 * Standalone historical general notices remain live-only.
 */
export function initialResolutionNotices(notices: GameNotice[], now = Date.now()): GameNotice[] {
  const recent = notices
    .filter((notice) => now - notice.timestamp <= RESOLUTION_REPLAY_WINDOW_MS)
    .sort((a, b) => a.id - b.id);
  const firstSpatialId = recent.find((notice) => resolutionNoticeChannel(notice) !== 'general')?.id;
  return firstSpatialId === undefined ? [] : recent.filter((notice) => notice.id >= firstSpatialId);
}

export function unseenResolutionNotices(notices: GameNotice[], lastSeenId: number): GameNotice[] {
  return notices.filter((notice) => notice.id > lastSeenId).sort((a, b) => a.id - b.id);
}
