import { describe, expect, it } from 'vitest';
import { createE2ECardSeed } from '../create-e2e-card-seed';

describe('synthetic E2E card seed', () => {
  it('contains enough synthetic cards for presets without production text or translations', () => {
    const fixture = createE2ECardSeed();

    expect(fixture.cards).toHaveLength(90);
    expect(fixture.i18n).toEqual({});
    expect(new Set(fixture.cards.map((card) => card.id)).size).toBe(fixture.cards.length);
    for (const element of ['闇', '炎', '電気', '風']) {
      expect(fixture.cards.filter((card) => card.element === element && card.type === 'Character')).toHaveLength(20);
    }
    expect(fixture.cards.every((card) => card.name.startsWith('E2E CARD '))).toBe(true);
    expect(fixture.cards.every((card) => card.effect === '' && card.enEffectOfficial === '')).toBe(true);
    expect(fixture.cards.map((card) => card.id)).toEqual(expect.arrayContaining(['1st_2', '1st_98', '2nd_86']));
    expect(fixture.cards.find((card) => card.element === '闇')?.attack).toEqual({ night: 60, day: 60 });
    expect(fixture.cards.find((card) => card.element === '炎')?.attack).toEqual({ night: 20, day: 20 });
  });
});
