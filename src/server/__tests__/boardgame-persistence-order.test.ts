import { InitializeGame } from 'boardgame.io/internal';
import { Master } from 'boardgame.io/master';
import { Server, SocketIO } from 'boardgame.io/server';
import type { Game, State } from 'boardgame.io';
import { io } from 'socket.io-client';
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

  it('resyncs the authoritative state when a socket update fails to persist', async () => {
    const state = initialState();
    const metadata = {
      gameName: game.name,
      players: {
        '0': { id: 0, credentials: 'credential-0' },
        '1': { id: 1, credentials: 'credential-1' },
      },
    };
    let stateFetches = 0;
    const storage = {
      type: () => 1,
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async (_matchID: string, opts: Record<string, boolean>) => {
        if (opts.state) stateFetches += 1;
        return {
          ...(opts.metadata ? { metadata } : {}),
          ...(opts.state ? { state } : {}),
          ...(opts.initialState ? { initialState: state } : {}),
          ...(opts.log ? { log: [] } : {}),
        };
      }),
      setState: vi.fn(async () => {
        throw new Error('stale state write');
      }),
      setMetadata: vi.fn(async () => undefined),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = Server({
      games: [game],
      db: storage as never,
      transport: new SocketIO(),
      origins: [/^http:\/\/127\.0\.0\.1:\d+$/],
    });
    const running = await server.run(0);
    const address = running.appServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server address');
    const socket = io(`http://127.0.0.1:${address.port}/${game.name}`, {
      transports: ['websocket'],
      extraHeaders: { Origin: `http://127.0.0.1:${address.port}` },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const resynced = new Promise<{ matchID: string; state: State<TestState> }>((resolve) => {
        socket.once('sync', (matchID: string, syncInfo: { state: State<TestState> }) =>
          resolve({ matchID, state: syncInfo.state }),
        );
      });

      socket.emit('update', moveAction(), 0, 'match-1', '0');

      await expect(resynced).resolves.toMatchObject({
        matchID: 'match-1',
        state: { _stateID: state._stateID, G: state.G },
      });
      expect(storage.setState).toHaveBeenCalledOnce();
      expect(stateFetches).toBe(2);
      expect(consoleError).toHaveBeenCalledWith('ERROR:', expect.stringContaining('stale state write'));
    } finally {
      socket.close();
      server.kill(running);
      consoleError.mockRestore();
    }
  });
});
