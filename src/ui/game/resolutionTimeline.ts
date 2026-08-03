import type { GameNotice, PlayerIndex } from '../../game/types';

export type ResolutionNoticeChannel = 'chronos' | 'battle' | 'hp' | 'general';

export const RESOLUTION_REPLAY_WINDOW_MS = 5000;

export type PresentationHpState = Partial<Record<PlayerIndex, number>>;

function hpChangePlayer(notice: GameNotice): PlayerIndex | null {
  return notice.kind === 'hpChange' && (notice.player === 0 || notice.player === 1) ? notice.player : null;
}

/**
 * Keep the battlefield HP at the first unplayed snapshot while authoritative
 * state may already contain every later HP change in the same resolution batch.
 */
export function beginHpPresentation(
  current: PresentationHpState,
  notices: GameNotice[],
  authoritativeHp: readonly [number, number],
): PresentationHpState {
  const working: [number, number] = [authoritativeHp[0], authoritativeHp[1]];
  const affected = new Set<PlayerIndex>();
  const ordered = [...notices].sort((a, b) => b.id - a.id);

  for (const notice of ordered) {
    const player = hpChangePlayer(notice);
    if (player === null) continue;
    const after = typeof notice.hpAfter === 'number' ? notice.hpAfter : working[player];
    const delta = typeof notice.delta === 'number' ? notice.delta : 0;
    working[player] = typeof notice.hpBefore === 'number' ? notice.hpBefore : after - delta;
    affected.add(player);
  }

  let next = current;
  for (const player of affected) {
    if (current[player] !== undefined) continue;
    if (next === current) next = { ...current };
    next[player] = working[player];
  }
  return next;
}

/** Commit one HP notice only after its spatial animation has completed. */
export function finishHpPresentation(current: PresentationHpState, notice: GameNotice): PresentationHpState {
  const player = hpChangePlayer(notice);
  if (player === null) return current;
  const before = current[player] ?? notice.hpBefore;
  const after = notice.hpAfter ?? (before === undefined ? undefined : before + (notice.delta ?? 0));
  if (after === undefined || current[player] === after) return current;
  return { ...current, [player]: after };
}

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
