import { beforeEach, describe, expect, it } from 'vitest';
import { getMatchRecords, saveMatchRecord } from '../matchHistory';
import type { GameState } from '../types';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

function finishedGame(): GameState {
  return {
    players: [
      { hp: 80, deck: [], abyss: [], powerCharger: [] },
      { hp: 0, deck: [], abyss: [], powerCharger: [] },
    ],
    chronos: { nightSidePlayer: 0, position: 4 },
    turnNumber: 5,
    log: ['done'],
    actionLog: [],
  } as unknown as GameState;
}

describe('match history persistence', () => {
  it('deduplicates retries by the stable submission key', () => {
    const G = finishedGame();

    saveMatchRecord(G, 0, 65, 'room-1-result');
    saveMatchRecord(G, 0, 65, 'room-1-result');

    expect(getMatchRecords()).toHaveLength(1);
    expect(getMatchRecords()[0]).toMatchObject({ id: 'room-1-result', winner: 0, duration: 65 });
  });
});
