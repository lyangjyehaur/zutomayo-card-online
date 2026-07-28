import { describe, expect, it } from 'vitest';
import type { CardDef, Element } from '../../src/game/types';
import {
  MATRIX_ARCHETYPES,
  buildRepresentativeDeck,
  createMatrixSchedule,
  summarizeDecisionTiming,
  type DecisionSample,
} from '../aiBenchmark';

function card(id: string, type: CardDef['type'], element: Element): CardDef {
  return {
    id,
    name: id,
    pack: 'test',
    song: '',
    illustrator: '',
    rarity: 'N',
    element,
    type,
    clock: 1,
    attack: type === 'Character' ? { night: 50, day: 50 } : null,
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '',
    errata: '',
  };
}

describe('AI benchmark decks', () => {
  it('builds stable 12/6/2 elemental profiles independent of source ordering', () => {
    const cards = [
      ...(['闇', '炎', '電気', '風'] as const).flatMap((element) =>
        Array.from({ length: 15 }, (_, index) => card(`${element}-character-${index}`, 'Character', element)),
      ),
      ...Array.from({ length: 6 }, (_, index) => card(`enchant-${index}`, 'Enchant', 'カオス')),
      ...Array.from({ length: 2 }, (_, index) => card(`area-${index}`, 'Area Enchant', 'カオス')),
    ];

    const forward = buildRepresentativeDeck(cards, MATRIX_ARCHETYPES[0]);
    const reversed = buildRepresentativeDeck([...cards].reverse(), MATRIX_ARCHETYPES[0]);

    expect(forward.cardIds).toEqual(reversed.cardIds);
    expect(new Set(forward.cardIds)).toHaveLength(20);
    expect(forward.composition).toEqual({ Character: 12, Enchant: 6, 'Area Enchant': 2 });
    expect(forward.cardIds.filter((id) => id.startsWith('闇-character-'))).toHaveLength(12);
  });

  it('fills unavailable type quotas from the target element without duplicating cards', () => {
    const cards = [
      ...Array.from({ length: 20 }, (_, index) => card(`dark-${index}`, 'Character', '闇')),
      card('only-enchant', 'Enchant', 'カオス'),
      card('area-0', 'Area Enchant', 'カオス'),
      card('area-1', 'Area Enchant', 'カオス'),
    ];

    const profile = buildRepresentativeDeck(cards, MATRIX_ARCHETYPES[0]);

    expect(profile.cardIds).toHaveLength(20);
    expect(new Set(profile.cardIds)).toHaveLength(20);
    expect(profile.composition).toEqual({ Character: 17, Enchant: 1, 'Area Enchant': 2 });
  });
});

describe('AI matchup schedule and timing', () => {
  it('runs every unordered profile pair with both seat assignments for each comparison', () => {
    const schedule = createMatrixSchedule(
      MATRIX_ARCHETYPES.map((profile) => profile.id),
      2,
    );

    expect(schedule).toHaveLength(80);
    expect(schedule.filter((entry) => entry.higherPlayer === 0)).toHaveLength(40);
    expect(schedule.filter((entry) => entry.higherPlayer === 1)).toHaveLength(40);
    expect(new Set(schedule.map((entry) => entry.seed))).toHaveLength(80);
  });

  it('reports bounded percentiles and fallback counts', () => {
    const samples: DecisionSample[] = [1, 2, 3, 8].map((durationMs, index) => ({
      player: (index % 2) as 0 | 1,
      difficulty: 'hard',
      kind: 'turnPlan',
      durationMs,
      ...(index === 3 ? { fallback: 'budget' } : {}),
    }));

    expect(summarizeDecisionTiming(samples)).toEqual({
      decisions: 4,
      p50Ms: 2,
      p95Ms: 8,
      p99Ms: 8,
      maxMs: 8,
      fallbacks: 1,
    });
  });
});
