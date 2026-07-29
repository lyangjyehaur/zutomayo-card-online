import { describe, expect, it } from 'vitest';
import type { GameNotice } from '../../../game/types';
import { effectHpChangeView } from '../EffectHpResolutionLayer';

function hpNotice(overrides: Partial<GameNotice> = {}): GameNotice {
  return {
    id: 1,
    kind: 'hpChange',
    tone: 'success',
    titleKey: 'board.hpChange.heal',
    player: 0,
    delta: 20,
    hpBefore: 45,
    hpAfter: 65,
    reason: 'heal',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('effectHpChangeView', () => {
  it('builds the actual healing equation shown beside the HP bar', () => {
    expect(effectHpChangeView(hpNotice())).toMatchObject({
      player: 0,
      healing: true,
      amount: 20,
      hpBefore: 45,
      hpAfter: 65,
      equation: '45 + 20 = 65',
    });
  });

  it('builds the direct-damage equation without treating it as battle damage', () => {
    expect(
      effectHpChangeView(
        hpNotice({
          tone: 'danger',
          titleKey: 'board.hpChange.directDamage',
          player: 1,
          delta: -25,
          hpBefore: 80,
          hpAfter: 55,
          reason: 'directDamage',
        }),
      ),
    ).toMatchObject({
      player: 1,
      healing: false,
      amount: 25,
      equation: '80 − 25 = 55',
    });
  });

  it('leaves battle damage on the dedicated battle animation layer', () => {
    expect(effectHpChangeView(hpNotice({ reason: 'battle', delta: -20 }))).toBeNull();
  });

  it('reconstructs snapshots from current HP for notices restored from older matches', () => {
    expect(effectHpChangeView(hpNotice({ hpBefore: undefined, hpAfter: undefined }), 70)).toMatchObject({
      hpBefore: 50,
      hpAfter: 70,
      equation: '50 + 20 = 70',
    });
  });
});
