import { InitializeGame } from 'boardgame.io/internal';
import { Master } from 'boardgame.io/master';
import type { Game, State } from 'boardgame.io';
import { describe, expect, it, vi } from 'vitest';

type TestState = { finished: boolean };

const game: Game<TestState> = {
  name: 'persistence-order-test',
  setup: () => ({ finished: false }),
  moves: {
    finish: ({ G }) => {
      G.finished = true;
    },
  },
  endIf: ({ G }) => (G.finished ? { winner: '0' } : undefined),
};

function moveAction() {
  return {
    type: 'MAKE_MOVE',
    payload: {
      type: 'finish',
      args: [],
      playerID: '0',
      credentials: 'credential-0',
    },
  } as const;
}

function initialState(): State<TestState> {
  return InitializeGame({ game, numPlayers: 2 });
}

function storageWith(setState: (state: State<TestState>) => Promise<void>) {
  const state = initialState();
  return {
    type: () => 1,
    fetch: vi.fn(async (_matchID: string, opts: { metadata?: boolean; state?: boolean }) => ({
      ...(opts.metadata
        ? {
            metadata: {
              gameName: game.name,
              players: {
                '0': { id: 0, credentials: 'credential-0' },
                '1': { id: 1, credentials: 'credential-1' },
              },
            },
          }
        : {}),
      ...(opts.state ? { state } : {}),
    })),
    setState: vi.fn(async (_matchID: string, nextState: State<TestState>) => setState(nextState)),
    setMetadata: vi.fn(async () => undefined),
  };
}

describe('boardgame.io persistence-before-broadcast patch', () => {
  it('does not publish or notify subscribers when a terminal state transaction fails', async () => {
    const storage = storageWith(async () => {
      throw new Error('terminal transaction failed');
    });
    const sendAll = vi.fn();
    const subscriber = vi.fn();
    const master = new Master(game, storage as never, { send: vi.fn(), sendAll });
    master.subscribe(subscriber);

    await expect(master.onUpdate(moveAction(), 0, 'match-1', '0')).rejects.toThrow('terminal transaction failed');

    expect(storage.setState).toHaveBeenCalledOnce();
    expect(sendAll).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('publishes the terminal state only after durable storage resolves', async () => {
    const sequence: string[] = [];
    const storage = storageWith(async () => {
      sequence.push('persisted');
    });
    const sendAll = vi.fn(() => sequence.push('broadcast'));
    const subscriber = vi.fn(() => sequence.push('subscriber'));
    const master = new Master(game, storage as never, { send: vi.fn(), sendAll });
    master.subscribe(subscriber);

    await master.onUpdate(moveAction(), 0, 'match-1', '0');

    expect(sequence).toEqual(['persisted', 'subscriber', 'broadcast']);
    expect(sendAll).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        args: ['match-1', expect.objectContaining({ ctx: expect.objectContaining({ gameover: { winner: '0' } }) })],
      }),
    );
  });
});
