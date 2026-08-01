import { beforeAll, describe, expect, it } from 'vitest';
import { APP_VERSION_INFO } from '../../version';
import { ZutomayoCard } from '../Game';
import { TURN_TIMER_MS, setupGame } from '../GameLogic';
import { getAllCardDefs, initCards } from '../cards/loader';
import {
  REPLAY_MOVE_NAMES,
  canonicalJsonStringify,
  createReplayRequestFingerprint,
  createReplayStateFingerprint,
} from '../decisionTrace';
import { replayMatch } from '../replayEngine';
import type {
  CardDef,
  GameState,
  PlayerIndex,
  ReplayDecisionRecord,
  ReplayManifest,
  ReplayMoveName,
  ReplayStatus,
} from '../types';

function replayCard(index: number): CardDef {
  return {
    id: `replay-character-${index}`,
    name: `Replay Character ${index}`,
    pack: 'test',
    song: 'test',
    illustrator: 'test',
    rarity: 'N',
    element: '闇',
    type: 'Character',
    clock: 0,
    attack: { night: 10, day: 10 },
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
  };
}

beforeAll(() => {
  initCards(Array.from({ length: 20 }, (_, index) => replayCard(index)));
});

function deckIds(): string[] {
  return getAllCardDefs().map((card) => card.id);
}

function createReplayGame(seed = 24680): GameState {
  const ids = deckIds();
  expect(ids).toHaveLength(20);
  return setupGame({ deck0Ids: ids, deck1Ids: ids, rngSeed: seed }, { allowBrowserCustomDeckName: true });
}

function runMove(G: GameState, move: ReplayMoveName, player: PlayerIndex, ...args: unknown[]): unknown {
  const registered = ZutomayoCard.moves?.[move] as unknown as {
    move: (context: { G: GameState; playerID: string }, ...moveArgs: unknown[]) => unknown;
  };
  expect(registered?.move, `${move} should be a long-form move`).toEqual(expect.any(Function));
  return registered.move({ G, playerID: String(player) }, ...args);
}

function completeOpeningFlow(G: GameState): void {
  expect(runMove(G, 'janken', 0, 'rock')).toBeUndefined();
  expect(runMove(G, 'janken', 1, 'scissors')).toBeUndefined();
  expect(runMove(G, 'keepHand', 0)).toBeUndefined();
  expect(runMove(G, 'keepHand', 1)).toBeUndefined();
  expect(runMove(G, 'setInitialCard', 0, 0)).toBeUndefined();
  expect(runMove(G, 'setInitialCard', 1, 0)).toBeUndefined();
  expect(runMove(G, 'confirmReady', 0)).toBeUndefined();
  expect(runMove(G, 'confirmReady', 1)).toBeUndefined();
  expect(G.step).toBe('turnSet');
}

function manifestAndTrace(G: GameState): { manifest: ReplayManifest; trace: ReplayDecisionRecord[] } {
  expect(G.replayManifest).toBeDefined();
  expect(G.decisionTrace).toBeDefined();
  return {
    manifest: structuredClone(G.replayManifest!),
    trace: structuredClone(G.decisionTrace!),
  };
}

describe('decision trace fingerprints', () => {
  it('canonicalizes object keys and ignores only presentation and wall-clock state', () => {
    expect(canonicalJsonStringify({ z: 1, a: { d: 2, b: 3 } })).toBe('{"a":{"b":3,"d":2},"z":1}');

    const G = createReplayGame();
    const before = createReplayStateFingerprint(G);
    G.matchStartedAt += 10_000;
    G.turnStartTime += 20_000;
    G.actionLog.push({
      id: 1,
      turn: 1,
      step: 'janken',
      player: 0,
      action: 'presentation-only',
      timestamp: Date.now(),
    });
    expect(createReplayStateFingerprint(G)).toBe(before);

    G.chronos.position = 1;
    expect(createReplayStateFingerprint(G)).not.toBe(before);
  });

  it('appends an exact record only after an accepted move', () => {
    const G = createReplayGame();
    const requestFingerprint = createReplayRequestFingerprint(G, 0, 'janken', ['rock']);

    expect(runMove(G, 'janken', 0, 'rock')).toBeUndefined();
    expect(G.decisionTrace).toEqual([
      {
        schemaVersion: 1,
        sequence: 1,
        player: 0,
        move: 'janken',
        args: ['rock'],
        requestFingerprint,
        stateFingerprintAfter: createReplayStateFingerprint(G),
      },
    ]);

    expect(runMove(G, 'janken', 0, 'paper')).toBe('INVALID_MOVE');
    expect(G.decisionTrace).toHaveLength(1);
  });

  it('keeps every registered boardgame move in the replay contract', () => {
    expect(Object.keys(ZutomayoCard.moves ?? {}).sort()).toEqual([...REPLAY_MOVE_NAMES].sort());
  });
});

describe('deterministic replay', () => {
  it('reconstructs an accepted opening flow from manifest plus decisions', () => {
    const original = createReplayGame();
    completeOpeningFlow(original);
    const { manifest, trace } = manifestAndTrace(original);

    const result = replayMatch(manifest, trace);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createReplayStateFingerprint(result.G)).toBe(createReplayStateFingerprint(original));
    expect(result.G.decisionTrace).toEqual(trace);
    expect(result.G.replayStatus).toEqual({ status: 'verified', decisionsApplied: trace.length });
  });

  it('fails at a tampered request before applying it', () => {
    const original = createReplayGame();
    completeOpeningFlow(original);
    const { manifest, trace } = manifestAndTrace(original);
    trace[0].args = ['paper'];

    const result = replayMatch(manifest, trace);

    expect(result).toMatchObject({
      ok: false,
      divergence: { sequence: 1, reason: 'requestFingerprint' },
      G: { replayStatus: { status: 'diverged', decisionsApplied: 0 } },
    });
  });

  it('fails closed on a sequence gap', () => {
    const original = createReplayGame();
    completeOpeningFlow(original);
    const { manifest, trace } = manifestAndTrace(original);
    trace[1].sequence = 3;

    const result = replayMatch(manifest, trace);

    expect(result).toMatchObject({
      ok: false,
      divergence: { sequence: 2, reason: 'sequence', expected: '2', actual: '3' },
      G: { replayStatus: { status: 'diverged', decisionsApplied: 1 } },
    });
  });

  it('checks the final post-state fingerprint', () => {
    const original = createReplayGame();
    completeOpeningFlow(original);
    const { manifest, trace } = manifestAndTrace(original);
    trace.at(-1)!.stateFingerprintAfter = 'fnv1a64-v1:0000000000000000';

    const result = replayMatch(manifest, trace);

    expect(result).toMatchObject({
      ok: false,
      divergence: { sequence: trace.length, reason: 'stateFingerprint' },
      G: { replayStatus: { status: 'diverged', decisionsApplied: trace.length - 1 } },
    });
  });

  it('rejects an invalid decision even when its request fingerprint is internally consistent', () => {
    const G = createReplayGame();
    const manifest = structuredClone(G.replayManifest!);
    const invalid = {
      schemaVersion: 1,
      sequence: 1,
      player: 0,
      move: 'janken',
      args: ['lizard'],
      requestFingerprint: createReplayRequestFingerprint(G, 0, 'janken', ['lizard']),
      stateFingerprintAfter: 'fnv1a64-v1:0000000000000000',
    } as ReplayDecisionRecord;

    expect(replayMatch(manifest, [invalid])).toMatchObject({
      ok: false,
      divergence: { sequence: 1, reason: 'invalidDecision' },
    });
  });

  it('replays timeout through the normal elapsed-time and rules path', () => {
    const original = createReplayGame();
    completeOpeningFlow(original);
    expect(runMove(original, 'setTurnCard', 0, 0, 'A')).toBeUndefined();
    expect(runMove(original, 'confirmReady', 0)).toBeUndefined();
    original.turnStartTime = Date.now() - TURN_TIMER_MS - 1;
    expect(runMove(original, 'timeoutAdvance', 0, 1)).toBeUndefined();
    const { manifest, trace } = manifestAndTrace(original);

    const result = replayMatch(manifest, trace);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.G.decisionTrace?.at(-1)).toMatchObject({ move: 'timeoutAdvance', player: 0, args: [1] });
    expect(createReplayStateFingerprint(result.G)).toBe(createReplayStateFingerprint(original));
  });

  it('rejects an unsupported rules version before setup', () => {
    const G = createReplayGame();
    const manifest = { ...G.replayManifest!, rulesVersion: `${APP_VERSION_INFO.rulesVersion}-unsupported` };

    expect(replayMatch(manifest, [])).toEqual({
      ok: false,
      G: null,
      divergence: {
        sequence: 0,
        reason: 'rulesVersion',
        expected: APP_VERSION_INFO.rulesVersion,
        actual: manifest.rulesVersion,
      },
    });
  });

  it('rejects an unsupported manifest schema before setup', () => {
    const G = createReplayGame();
    const manifest = { ...G.replayManifest!, schemaVersion: 2 } as unknown as ReplayManifest;

    expect(replayMatch(manifest, [])).toEqual({
      ok: false,
      G: null,
      divergence: { sequence: 0, reason: 'unsupportedManifest' },
    });
  });

  it('fails closed for a missing persisted manifest at runtime', () => {
    expect(replayMatch(null as unknown as ReplayManifest, [])).toEqual({
      ok: false,
      G: null,
      divergence: { sequence: 0, reason: 'unsupportedManifest' },
    });
  });
});

describe('decision trace redaction', () => {
  it.each(['0', null] as const)('does not expose trace or replay status to viewer %s', (playerID) => {
    const G = createReplayGame();
    runMove(G, 'janken', 0, 'rock');
    G.replayStatus = { status: 'verified', decisionsApplied: 1 } satisfies ReplayStatus;

    const view = ZutomayoCard.playerView?.({ G, playerID } as never) as GameState;

    expect(view.decisionTrace).toBeUndefined();
    expect(view.replayStatus).toBeUndefined();
  });
});
