import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMatchHistoryChatPath,
  getMatchRecords,
  historyChatSubjectId,
  linkMatchRecordToServer,
  matchRecordFromServer,
  mergeMatchRecords,
  resolveInitialHistoryChatRecord,
  saveMatchRecord,
  type MatchRecord,
} from '../matchHistory';
import type { GameState } from '../types';
import { APP_VERSION_INFO } from '../../version';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
});

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

describe('match history', () => {
  it('stores the online source match id for post-match chat lookup', () => {
    saveMatchRecord(gameState(), 0, 90, ' bgio-match-1 ');

    expect(getMatchRecords()[0]).toEqual(
      expect.objectContaining({
        sourceMatchId: 'bgio-match-1',
        rulesVersion: APP_VERSION_INFO.rulesVersion,
        turns: 4,
      }),
    );
  });

  it('deduplicates retries by the stable submission key', () => {
    const G = gameState();

    saveMatchRecord(G, 0, 65, 'room-1', 'room-1-result');
    saveMatchRecord(G, 0, 65, 'room-1', 'room-1-result');

    expect(getMatchRecords()).toHaveLength(1);
    expect(getMatchRecords()[0]).toMatchObject({
      id: 'room-1-result',
      sourceMatchId: 'room-1',
      winner: 0,
      duration: 65,
    });
  });

  it('links a local result to its server match id after submission', () => {
    saveMatchRecord(gameState(), 0, 65, 'room-1', 'room-1-result');

    linkMatchRecordToServer('room-1-result', 'server-match-1');

    expect(getMatchRecords()[0]).toMatchObject({
      id: 'room-1-result',
      serverMatchId: 'server-match-1',
    });
  });

  it('maps server history from the signed-in account perspective', () => {
    const victory = matchRecordFromServer(
      {
        id: 'server-match-1',
        winnerId: 'user-1',
        loserId: 'user-2',
        sourceMatchId: 'bgio-match-1',
        rulesVersion: 'rules-2026-01',
        turns: 7,
        duration: 93,
        createdAt: '2026-07-12T08:00:00.000Z',
      },
      'user-1',
    );
    const defeat = matchRecordFromServer(
      {
        id: 'server-match-2',
        winnerId: 'user-2',
        loserId: 'user-1',
        turns: 8,
        duration: 101,
        createdAt: '2026-07-12T09:00:00.000Z',
      },
      'user-1',
    );

    expect(victory).toMatchObject({
      serverMatchId: 'server-match-1',
      sourceMatchId: 'bgio-match-1',
      rulesVersion: 'rules-2026-01',
      outcome: 'victory',
      detailsAvailable: false,
      turns: 7,
    });
    expect(defeat).toMatchObject({ serverMatchId: 'server-match-2', outcome: 'defeat' });
  });

  it('prefers server records and deduplicates linked local results', () => {
    saveMatchRecord(gameState(), 0, 65, 'room-1', 'room-1-result');
    linkMatchRecordToServer('room-1-result', 'server-match-1');
    const local = getMatchRecords();
    const server = matchRecordFromServer(
      {
        id: 'server-match-1',
        winnerId: 'user-1',
        loserId: 'user-2',
        turns: 4,
        duration: 65,
        createdAt: '2026-07-12T08:00:00.000Z',
      },
      'user-1',
    );

    expect(mergeMatchRecords([server], local)).toEqual([server]);
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
