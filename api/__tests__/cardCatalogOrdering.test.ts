import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { getCatalogCards } = require('../cardDataService.cjs') as {
  getCatalogCards: (
    pool: { query: ReturnType<typeof vi.fn> },
    searchParams?: URLSearchParams,
  ) => Promise<Array<{ id: string }>>;
};

function cardRow(id: string) {
  return {
    id,
    name: id,
    pack: '4th',
    element: '闇',
    type: 'Character',
    clock: 0,
    attack_night: 0,
    attack_day: 0,
    power_cost: 0,
    send_to_power: 0,
  };
}

describe('card catalog ordering contract', () => {
  it('returns naturally ordered card IDs even when PostgreSQL rows are lexicographically ordered', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: ['4th_1', '4th_10', '4th_100', '4th_105', '4th_11', '4th_2', '4th_9', '4th_99'].map(cardRow),
      })),
    };

    const cards = await getCatalogCards(pool);

    expect(cards.map((card) => card.id)).toEqual([
      '4th_1',
      '4th_2',
      '4th_9',
      '4th_10',
      '4th_11',
      '4th_99',
      '4th_100',
      '4th_105',
    ]);
  });
});
