import { describe, expect, it } from 'vitest';
import { buildAIBrowserBenchmarkDeck, runAIBrowserBenchmark } from '../aiBrowserBenchmark';
import { initCards } from '../cards/loader';
import { getAIParsedEffects } from '../ai/evaluate';
import type { CardDef } from '../types';

function card(index: number, type: CardDef['type']): CardDef {
  return {
    id: `browser-benchmark-${index}`,
    name: `Browser benchmark ${index}`,
    pack: 'test',
    song: '',
    illustrator: '',
    rarity: 'N',
    element: index % 2 === 0 ? '闇' : '炎',
    type,
    clock: index % 4,
    attack: type === 'Character' ? { night: 20 + index, day: 25 + index } : null,
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '',
    errata: '',
  };
}

const cards = [
  ...Array.from({ length: 16 }, (_, index) => card(index, 'Character')),
  ...Array.from({ length: 8 }, (_, index) => card(index + 16, 'Enchant')),
  ...Array.from({ length: 4 }, (_, index) => card(index + 24, 'Area Enchant')),
];

describe('AI browser benchmark harness', () => {
  it('builds a stable legal 20-card benchmark deck', () => {
    expect(buildAIBrowserBenchmarkDeck(cards, '闇', 'stable')).toEqual(
      buildAIBrowserBenchmarkDeck([...cards].reverse(), '闇', 'stable'),
    );
    expect(new Set(buildAIBrowserBenchmarkDeck(cards, '闇', 'stable'))).toHaveLength(20);
  });

  it('invalidates parsed effects when the card dataset revision changes', () => {
    initCards(cards);
    expect(getAIParsedEffects().get(cards[0].id)).toBeUndefined();

    initCards(
      cards.map((definition, index) =>
        index === 0 ? { ...definition, effect: '相手に30ダメージを与える。' } : definition,
      ),
    );
    expect(getAIParsedEffects().get(cards[0].id)).toHaveLength(1);

    initCards(cards);
  });

  it('runs a hard decision against the currently loaded card set', async () => {
    initCards(cards);
    const report = await runAIBrowserBenchmark({ iterations: 1 });

    expect(report.cardCount).toBe(cards.length);
    expect(report.cardFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].selections).toBeGreaterThan(0);
    expect(report.decisions[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
