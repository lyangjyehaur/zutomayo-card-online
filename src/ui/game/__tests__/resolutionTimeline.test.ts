import { describe, expect, it } from 'vitest';
import type { GameNotice } from '../../../game/types';
import { initialResolutionNotices, resolutionNoticeChannel, unseenResolutionNotices } from '../resolutionTimeline';

function notice(id: number, patch: Partial<GameNotice> = {}): GameNotice {
  return {
    id,
    kind: 'turnStart',
    tone: 'phase',
    titleKey: 'board.notice.turnStart',
    timestamp: 10_000,
    ...patch,
  };
}

describe('resolution timeline', () => {
  it('routes each notice to exactly one renderer', () => {
    expect(resolutionNoticeChannel(notice(1, { kind: 'chronosChange' }))).toBe('chronos');
    expect(resolutionNoticeChannel(notice(2, { kind: 'hpChange', reason: 'battle' }))).toBe('battle');
    expect(resolutionNoticeChannel(notice(3, { kind: 'battleResult' }))).toBe('battle');
    expect(resolutionNoticeChannel(notice(4, { kind: 'hpChange', reason: 'heal' }))).toBe('general');
    expect(resolutionNoticeChannel(notice(5))).toBe('general');
  });

  it('preserves global ID order across battle, HP, Chronos and turn notices', () => {
    const notices = [
      notice(4),
      notice(2, { kind: 'hpChange', reason: 'heal' }),
      notice(3, { kind: 'chronosChange' }),
      notice(1, { kind: 'hpChange', reason: 'battle' }),
    ];
    expect(unseenResolutionNotices(notices, 0).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it('replays a complete recent batch starting from its first spatial notice', () => {
    const notices = [
      notice(1, { kind: 'hpChange', reason: 'battle', timestamp: 9_000 }),
      notice(2, { kind: 'hpChange', reason: 'heal', timestamp: 9_100 }),
      notice(3, { kind: 'chronosChange', timestamp: 9_200 }),
      notice(4, { kind: 'battleResult', timestamp: 4_000 }),
    ];
    expect(initialResolutionNotices(notices, 10_000).map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('does not replay standalone historical general notices', () => {
    expect(initialResolutionNotices([notice(1), notice(2, { kind: 'hpChange', reason: 'heal' })], 10_000)).toEqual([]);
  });
});
