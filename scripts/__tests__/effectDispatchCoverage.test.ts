import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../src/game/types';
import {
  buildEffectDispatchCoverage,
  effectDispatchCoverageFailures,
  type EffectDispatchCoverageReport,
} from '../effect-dispatch-coverage';

function card(id: string, effect: string): CardDef {
  return {
    id,
    name: id,
    pack: 'test',
    song: '',
    illustrator: '',
    rarity: 'N',
    element: '闇',
    type: 'Character',
    clock: 1,
    attack: { night: 10, day: 10 },
    powerCost: 0,
    sendToPower: 1,
    effect,
    image: '',
    errata: '',
  };
}

describe('effect dispatch coverage', () => {
  it('dispatches every registered parsed effect through the executor handler map', () => {
    const report = buildEffectDispatchCoverage([card('boost', '攻撃力+10'), card('heal', 'HPを20回復')]);

    expect(report).toMatchObject({
      schemaVersion: 1,
      thresholdPercent: 100,
      sourceEffectLines: 2,
      registered: 2,
      dispatched: 2,
      missingCount: 0,
      coveragePercent: 100,
    });
    expect(report.byAction.boostAttack).toEqual({ registered: 1, dispatched: 1, missing: 0 });
    expect(effectDispatchCoverageFailures(report)).toEqual([]);
  });

  it('fails closed when measured coverage drops below the declared threshold', () => {
    const report: EffectDispatchCoverageReport = {
      schemaVersion: 1,
      thresholdPercent: 100,
      sourceEffectLines: 2,
      registered: 2,
      dispatched: 1,
      missingCount: 1,
      coveragePercent: 50,
      missing: [{ id: 'card:1', cardId: 'card', effectIndex: 1, action: 'heal', rawText: 'HPを10回復' }],
      byAction: {},
      byChoiceType: {},
    };
    expect(effectDispatchCoverageFailures(report)).toEqual([expect.stringContaining('below 100%')]);
  });
});
