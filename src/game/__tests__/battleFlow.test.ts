import { beforeAll, describe, expect, it } from 'vitest';
import { ZutomayoCard } from '../Game';
import {
  confirmReady,
  finishMulligan,
  resolveJanken,
  setInitialCard,
  setTurnCard,
  setupGame,
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
    const timeoutMove = ZutomayoCard.moves?.timeoutSkip as unknown as (
      context: { G: GameState; playerID: string },
      target: PlayerIndex,
    ) => unknown;

    timeoutMove({ G, playerID: '0' }, 1);

    expect(G.actionLog.some((entry) => entry.action === 'timeoutSkip' && entry.player === 1)).toBe(true);
    expect(G.step).not.toBe('effectOrder');
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
