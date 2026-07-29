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

function effectHpNotice(id: number, patch: Partial<GameNotice> = {}): GameNotice {
  return notice(id, {
    kind: 'hpChange',
    reason: 'heal',
    player: 0,
    delta: 10,
    hpBefore: 50,
    hpAfter: 60,
    ...patch,
  });
}

describe('resolution timeline', () => {
  it('routes each notice to exactly one renderer', () => {
    expect(resolutionNoticeChannel(notice(1, { kind: 'chronosChange' }))).toBe('chronos');
    expect(resolutionNoticeChannel(notice(2, { kind: 'hpChange', reason: 'battle' }))).toBe('battle');
    expect(resolutionNoticeChannel(notice(3, { kind: 'battleResult' }))).toBe('battle');
    expect(resolutionNoticeChannel(effectHpNotice(4))).toBe('hp');
    expect(resolutionNoticeChannel(notice(5, { kind: 'hpChange', reason: 'heal' }))).toBe('hp');
    expect(resolutionNoticeChannel(notice(6))).toBe('general');
  });

  it('preserves global ID order across battle, HP, Chronos and turn notices', () => {
    const notices = [
      notice(4),
      effectHpNotice(2),
      notice(3, { kind: 'chronosChange' }),
      notice(1, { kind: 'hpChange', reason: 'battle' }),
    ];
    expect(unseenResolutionNotices(notices, 0).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it('replays a complete recent batch starting from its first spatial notice', () => {
    const notices = [
      notice(1, { kind: 'hpChange', reason: 'battle', timestamp: 9_000 }),
      effectHpNotice(2, { timestamp: 9_100 }),
      notice(3, { kind: 'chronosChange', timestamp: 9_200 }),
      notice(4, { kind: 'battleResult', timestamp: 4_000 }),
    ];
    expect(initialResolutionNotices(notices, 10_000).map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('replays recent spatial HP effects but not standalone historical general notices', () => {
    const heal = effectHpNotice(2);
    expect(initialResolutionNotices([notice(1), heal], 10_000)).toEqual([heal]);
    expect(initialResolutionNotices([notice(1), notice(2)], 10_000)).toEqual([]);
  });
});
