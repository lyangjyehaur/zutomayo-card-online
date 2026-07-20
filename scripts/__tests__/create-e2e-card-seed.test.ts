import { describe, expect, it } from 'vitest';
import { createE2ECardSeed } from '../create-e2e-card-seed';

describe('synthetic E2E card seed', () => {
  it('contains enough synthetic cards for presets without production text or translations', () => {
    const fixture = createE2ECardSeed();

    expect(fixture.cards).toHaveLength(92);
    expect(fixture.texts).toEqual({});
    expect(new Set(fixture.cards.map((card) => card.id)).size).toBe(fixture.cards.length);
    for (const element of ['闇', '炎', '電気', '風']) {
      expect(fixture.cards.filter((card) => card.element === element && card.type === 'Character')).toHaveLength(20);
    }
    expect(fixture.cards.every((card) => card.name.startsWith('E2E CARD '))).toBe(true);
    expect(fixture.cards.map((card) => card.id)).toEqual(
      expect.arrayContaining(['1st_2', '1st_46', '1st_98', '2nd_86', '2nd_98']),
    );
  });

  it('preserves the minimum mechanics required by the deterministic tutorial', () => {
    const cards = new Map(createE2ECardSeed().cards.map((card) => [card.id, card]));

    expect(cards.get('1st_70')).toMatchObject({ clock: 2, attack: { night: 30, day: 10 }, sendToPower: 2 });
    expect(cards.get('1st_67')).toMatchObject({ clock: 1, attack: { night: 50, day: 30 } });
    expect(cards.get('1st_46')).toMatchObject({ attack: { night: 40, day: 80 }, powerCost: 2 });
    expect(cards.get('1st_98')).toMatchObject({ clock: 4, effect: expect.stringContaining('パワーコスト') });
    expect(cards.get('2nd_98')).toMatchObject({ clock: 2, effect: expect.stringContaining('昼なら攻撃力+20') });

    const scenarioIds = new Set(['1st_2', '1st_46', '1st_67', '1st_70', '1st_98', '2nd_86', '2nd_98']);
    expect(
      createE2ECardSeed()
        .cards.filter((card) => !scenarioIds.has(card.id))
        .every((card) => card.effect === '' && card.enEffectOfficial === ''),
    ).toBe(true);
  });
});
