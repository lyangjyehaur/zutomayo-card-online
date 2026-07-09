import { afterEach, describe, expect, it } from 'vitest';
import { getMatchRecords, saveMatchRecord } from '../matchHistory';
import type { GameState } from '../types';

function gameState(): GameState {
  return {
    winner: 0,
    turnNumber: 4,
    log: ['game over'],
    actionLog: [{ id: 1, turn: 4, step: 'gameOver', player: 0, action: 'gameOver', timestamp: 1000, payload: {} }],
    players: [
      { hp: 7, deck: ['a'], abyss: [], powerCharger: [] },
      { hp: 0, deck: ['b'], abyss: ['x'], powerCharger: [] },
    ],
    chronos: {
      nightSidePlayer: 0,
      position: 3,
    },
  } as unknown as GameState;
}

function installLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('match history', () => {
  it('stores the online source match id for post-match chat lookup', () => {
    installLocalStorage();

    saveMatchRecord(gameState(), 0, 90, 'bgio-match-1');

    expect(getMatchRecords()[0]).toEqual(
      expect.objectContaining({
        sourceMatchId: 'bgio-match-1',
        turns: 4,
      }),
    );
  });
});
