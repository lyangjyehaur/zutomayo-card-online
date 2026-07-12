import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMatchHistoryChatPath,
  getMatchRecords,
  historyChatSubjectId,
  resolveInitialHistoryChatRecord,
  saveMatchRecord,
  type MatchRecord,
} from '../matchHistory';
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

    saveMatchRecord(gameState(), 0, 90, ' bgio-match-1 ');

    expect(getMatchRecords()[0]).toEqual(
      expect.objectContaining({
        sourceMatchId: 'bgio-match-1',
        turns: 4,
      }),
    );
  });

  it('uses only the durable online source match id for post-match chat lookup', () => {
    expect(historyChatSubjectId({ sourceMatchId: ' bgio-match-1 ' })).toBe('bgio-match-1');
    expect(historyChatSubjectId({ sourceMatchId: '' })).toBeNull();
    expect(historyChatSubjectId({ sourceMatchId: '   ' })).toBeNull();
    expect(historyChatSubjectId({})).toBeNull();
    expect(buildMatchHistoryChatPath('match 1/2')).toBe('/history?chat=match%201%2F2');
  });

  it('resolves post-match chat from persisted online history before opening durable match chat', () => {
    const persistedRecord: MatchRecord = {
      id: 'local-history-1',
      sourceMatchId: ' bgio-match-1 ',
      date: '2026-07-12T00:00:00.000Z',
      duration: 90,
      winner: 0,
      players: [
        { hp: 7, deckSize: 1, cardsPlayed: 0 },
        { hp: 0, deckSize: 1, cardsPlayed: 1 },
      ],
      chronos: {
        nightSidePlayer: 0,
        finalPosition: 3,
      },
      turns: 4,
      log: ['game over'],
      actionLog: [],
    };

    const record = resolveInitialHistoryChatRecord([persistedRecord], 'bgio-match-1');

    expect(record).toBe(persistedRecord);
    expect(historyChatSubjectId(record!)).toBe('bgio-match-1');
  });

  it('creates a durable match chat placeholder from the history chat URL when local history is missing', () => {
    const record = resolveInitialHistoryChatRecord([], ' bgio-match-1 ');

    expect(record).toEqual(
      expect.objectContaining({
        id: 'chat:bgio-match-1',
        sourceMatchId: 'bgio-match-1',
        winner: null,
        turns: 0,
        actionLog: [],
      }),
    );
    expect(historyChatSubjectId(record!)).toBe('bgio-match-1');
  });
});
