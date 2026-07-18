import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ZutomayoCard } from '../Game';
import {
  confirmReady,
  finishMulligan,
  getPlayersAwaitingAction,
  chooseJanken,
  resolveJanken,
  setInitialCard,
  setTurnCard,
  setupGame,
  timeoutAdvance,
  TURN_TIMER_MS,
} from '../GameLogic';
import { executeEffect, parseAllEffects } from '../effects';
import { getAllCardDefs, initCards, isCardsInitialized } from '../cards/loader';
import type { CardDef, GameState, PlayerIndex } from '../types';

function flowCard(index: number): CardDef {
  return {
    id: `flow-character-${index}`,
    name: `Flow Character ${index}`,
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
  if (!isCardsInitialized()) initCards(Array.from({ length: 20 }, (_, index) => flowCard(index)));
});

function createFlowGame(): { G: GameState; parsedEffects: ReturnType<typeof parseAllEffects> } {
  const ids = getAllCardDefs()
    .filter((card) => card.effect.length === 0)
    .slice(0, 20)
    .map((card) => card.id);
  expect(ids).toHaveLength(20);
  const G = setupGame(
    { deck0Ids: ids, deck1Ids: ids, skipShuffle: true },
    { allowBrowserCustomDeckName: true, allowSkipShuffle: true },
  );
  const parsedEffects = parseAllEffects(ids.map((id) => ({ id, effect: '' })));
  resolveJanken(G, 'rock', 'scissors');
  expect(finishMulligan(G, 0, [])).toBe(true);
  expect(finishMulligan(G, 1, [])).toBe(true);
  expect(setInitialCard(G, 0, 0)).toBe(true);
  expect(setInitialCard(G, 1, 0)).toBe(true);
  expect(confirmReady(G, 0, parsedEffects)).toBe(true);
  expect(confirmReady(G, 1, parsedEffects)).toBe(true);
  return { G, parsedEffects };
}

function expireInteraction(G: GameState): void {
  G.interactionStartTime = Date.now() - TURN_TIMER_MS - 1;
}

describe('complete battle flow', () => {
  it('finishes a full match without leaving pending interaction state behind', () => {
    const { G, parsedEffects } = createFlowGame();
    let resolvedTurns = 0;

    while (G.step !== 'gameOver' && resolvedTurns < 30) {
      expect(G.step).toBe('turnSet');
      expect(setTurnCard(G, 0, 0, 'A')).toBe(true);
      expect(setTurnCard(G, 1, 0, 'A')).toBe(true);
      expect(confirmReady(G, 0, parsedEffects)).toBe(true);
      expect(confirmReady(G, 1, parsedEffects)).toBe(true);
      resolvedTurns++;
    }

    expect(resolvedTurns).toBeLessThan(30);
    expect(G.step).toBe('gameOver');
    expect(G.matchEndedAt).toEqual(expect.any(Number));
    expect(G.matchEndedAt!).toBeGreaterThanOrEqual(G.matchStartedAt);
    expect(G.pendingChoice).toBeNull();
    expect(G.pendingEffectPlayer).toBeNull();
    expect(G.pendingEffects).toEqual([[], []]);
    expect(G.delayedEffects).toEqual([]);
  });

  it('lets a connected player enforce the authoritative timeout for an unresponsive opponent', () => {
    const { G } = createFlowGame();
    G.ready = [true, false];
    G.turnStartTime = Date.now() - TURN_TIMER_MS - 1;
    const timeoutMove = ZutomayoCard.moves?.timeoutAdvance as unknown as {
      move: (context: { G: GameState; playerID: string }, target: PlayerIndex) => unknown;
    };

    timeoutMove.move({ G, playerID: '0' }, 1);

    expect(G.actionLog.some((entry) => entry.action === 'timeoutSkip' && entry.player === 1)).toBe(true);
    expect(G.step).not.toBe('effectOrder');
  });

  it('only allows a seated player to surrender through the game move', () => {
    const { G } = createFlowGame();
    const surrenderMove = ZutomayoCard.moves?.surrender as unknown as {
      move: (context: { G: GameState; playerID: string | null }) => unknown;
    };

    expect(surrenderMove.move({ G, playerID: null })).toBe('INVALID_MOVE');
    expect(G.step).not.toBe('gameOver');

    surrenderMove.move({ G, playerID: '0' });
    expect(G.step).toBe('gameOver');
    expect(G.winner).toBe(1);
  });
});

describe('online inactivity recovery', () => {
  it('auto-selects for a missing janken player only after the authoritative timeout', () => {
    const ids = getAllCardDefs()
      .slice(0, 20)
      .map((card) => card.id);
    const G = setupGame(
      { deck0Ids: ids, deck1Ids: ids, skipShuffle: true },
      { allowBrowserCustomDeckName: true, allowSkipShuffle: true },
    );
    const parsedEffects = parseAllEffects([]);
    G.interactionStartTime = Date.now() - TURN_TIMER_MS - 10_000;
    expect(chooseJanken(G, 0, 'paper')).toBe(true);
    expect(getPlayersAwaitingAction(G)).toEqual([1]);
    expect(Date.now() - G.interactionStartTime).toBeLessThan(1_000);
    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(false);
    expireInteraction(G);
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0);

    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(true);
    random.mockRestore();

    expect(G.step).toBe('mulligan');
    expect(G.actionLog.some((entry) => entry.action === 'timeoutAdvance' && entry.player === 1)).toBe(true);
  });

  it('keeps the hand and advances when a player times out during mulligan', () => {
    const { G, parsedEffects } = createFlowGame();
    G.step = 'mulligan';
    G.mulliganUsed = [true, false];
    G.ready = [true, false];
    expireInteraction(G);

    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(true);

    expect(G.step).toBe('initialSet');
    expect(G.mulliganUsed).toEqual([true, true]);
  });

  it('sets a legal initial card and confirms for an unresponsive player', () => {
    const { G, parsedEffects } = createFlowGame();
    G.step = 'initialSet';
    G.ready = [true, false];
    G.players[1].battleZone = null;
    G.players[1].cardsSetThisTurn = 0;
    G.setCardsThisTurn[1] = [];
    expireInteraction(G);

    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(true);

    expect(G.players[1].battleZone).not.toBeNull();
    expect(G.step).not.toBe('initialSet');
  });

  it('submits a legal default choice when effect resolution times out', () => {
    const { G, parsedEffects } = createFlowGame();
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 1;
    G.pendingChoice = {
      id: 'timeout-clock-choice',
      player: 1,
      type: 'clockPosition',
      min: 1,
      max: 1,
      payload: {},
      options: [{ id: 'clock:4', label: '4', value: 4 }],
    };
    expireInteraction(G);

    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(true);

    expect(G.pendingChoice).toBeNull();
    expect(G.chronos.position).toBe(4);
    expect(G.actionLog.some((entry) => entry.action === 'timeoutAdvance' && entry.player === 1)).toBe(true);
  });

  it('resolves the first legal pending effect when effect ordering times out', () => {
    const { G, parsedEffects } = createFlowGame();
    const card = G.players[1].battleZone!;
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 1;
    G.pendingEffects = [
      [],
      [
        {
          id: 'timeout-effect',
          player: 1,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
          rawText: '',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'boostAttack', params: { value: 5 } },
            rawText: '',
          },
          source: 'battleZone',
        },
      ],
    ];
    expireInteraction(G);

    expect(timeoutAdvance(G, 1, parsedEffects)).toBe(true);

    expect(G.actionLog.some((entry) => entry.action === 'resolvePendingEffect' && entry.player === 1)).toBe(true);
    expect(G.actionLog.some((entry) => entry.action === 'timeoutAdvance' && entry.player === 1)).toBe(true);
  });
});

describe('effect-driven game over', () => {
  it.each([
    ['lethal damage', 0, { type: 'directDamage', params: { value: 100 } }],
    ['effect overdraw', 1, { type: 'drawCards', params: { value: 16 } }],
  ] as const)('records an authoritative end time for %s', (_label, player, action) => {
    const { G } = createFlowGame();
    G.delayedEffects = [
      {
        id: 'stale-delayed-effect',
        player: 0,
        cardInstanceId: 'stale-card',
        cardDefId: 'stale-card',
        rawText: '',
        effect: { trigger: 'onTurnEnd', conditions: [], action: { type: 'noEffect', params: {} }, rawText: '' },
        source: 'played',
      },
    ];

    executeEffect({ trigger: 'onUse', conditions: [], action, rawText: '' }, G, player);

    expect(G.step).toBe('gameOver');
    expect(G.matchEndedAt).toEqual(expect.any(Number));
    expect(G.pendingChoice).toBeNull();
    expect(G.pendingEffects).toEqual([[], []]);
    expect(G.delayedEffects).toEqual([]);
  });
});
