import { describe, expect, it } from 'vitest';
import { automaticResolutionStateKey, enterAutomaticResolution } from '../automaticLoop';
import { initCards, isCardsInitialized } from '../cards/loader';
import { resolveTimingEvent, setupGame } from '../GameLogic';
import type { CardDef, TimingEvent } from '../types';

if (!isCardsInitialized()) {
  initCards(
    Array.from(
      { length: 20 },
      (_, index): CardDef => ({
        id: `loop-test-${index}`,
        name: `Loop Test ${index}`,
        pack: 'test',
        song: 'test',
        illustrator: 'test',
        rarity: 'N',
        element: '闇',
        type: 'Character',
        clock: 1,
        attack: { night: 10, day: 10 },
        powerCost: 0,
        sendToPower: 0,
        effect: '',
        image: '',
        errata: '',
      }),
    ),
  );
}

const event: TimingEvent = { type: 'zoneEntered', player: 0, zone: 'abyss', cardDefId: 'test-card' };

describe('automatic infinite-loop detection', () => {
  it('ignores observational log growth but detects the same rule state and event', () => {
    const G = setupGame();
    const first = enterAutomaticResolution(G, event);
    G.log.push('diagnostic output that cannot alter the game');
    G.actionLog.push({
      id: 999,
      turn: G.turnNumber,
      step: G.step,
      player: 0,
      action: 'diagnostic',
      timestamp: Date.now(),
    });

    expect(enterAutomaticResolution(G, event, first.context).repeated).toBe(true);
  });

  it('does not treat a changed mechanical state or a new turn as the same loop', () => {
    const G = setupGame();
    const first = enterAutomaticResolution(G, event);
    G.players[0].hp -= 1;
    expect(enterAutomaticResolution(G, event, first.context).repeated).toBe(false);

    G.turnNumber += 1;
    expect(enterAutomaticResolution(G, event, first.context).repeated).toBe(false);
  });

  it('tracks the latest damage event while collapsing duplicate existence checks', () => {
    const G = setupGame();
    G.timingEvents.push({ type: 'damageReceived', player: 0, amount: 10 });
    const first = enterAutomaticResolution(G, event);
    G.timingEvents.push({ type: 'zoneEntered', player: 0, zone: 'abyss', cardDefId: 'same-card' });
    const second = enterAutomaticResolution(G, event, first.context);
    expect(second.repeated).toBe(false);

    G.timingEvents.push({ type: 'zoneEntered', player: 0, zone: 'abyss', cardDefId: 'same-card' });
    expect(enterAutomaticResolution(G, event, second.context).repeated).toBe(true);

    G.timingEvents.push({ type: 'damageReceived', player: 0, amount: 20 });
    expect(enterAutomaticResolution(G, event, second.context).repeated).toBe(false);
  });

  it('ends an unavoidable repeated automatic resolution as a draw', () => {
    const G = setupGame();
    G.timingEvents.push(event);
    const context = enterAutomaticResolution(G, event).context;
    expect(context.seenStates.has(automaticResolutionStateKey(G, event))).toBe(true);

    resolveTimingEvent(G, new Map(), event, { automaticResolution: context });

    expect(G.step).toBe('gameOver');
    expect(G.winner).toBeNull();
    expect(G.gameoverReason).toContain('unavoidable automatic infinite loop');
    expect(G.actionLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'gameOver', payload: expect.objectContaining({ draw: true }) }),
      ]),
    );
  });
});
