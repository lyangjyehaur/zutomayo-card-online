import type { GameState, PendingChoice, PendingEffect, TimingEvent } from './types';

export interface AutomaticResolutionContext {
  turnNumber: number;
  seenStates: Set<string>;
}

function cardState(card: { instanceId: string; defId: string; faceUp: boolean } | null) {
  return card ? [card.instanceId, card.defId, card.faceUp] : null;
}

function pendingEffectState(effect: PendingEffect) {
  return {
    player: effect.player,
    cardInstanceId: effect.cardInstanceId,
    cardDefId: effect.cardDefId,
    rulesSourceCardInstanceId: effect.rulesSourceCardInstanceId,
    rulesSourceCardDefId: effect.rulesSourceCardDefId,
    rawText: effect.rawText,
    effect: effect.effect,
    source: effect.source,
  };
}

function pendingChoiceState(choice: PendingChoice | null) {
  if (!choice) return null;
  const { id: _id, ...state } = choice;
  return state;
}

function timingEventState(events: TimingEvent[]) {
  const zoneEntries = new Set<string>();
  const chronosTransitions = new Set<string>();
  const latestDamageReceived: [number | null, number | null] = [null, null];
  for (const event of events) {
    if (event.type === 'zoneEntered') {
      zoneEntries.add(JSON.stringify([event.player, event.zone, event.cardDefId]));
    } else if (event.type === 'chronosChanged') {
      chronosTransitions.add(JSON.stringify([event.fromChronosTime, event.toChronosTime]));
    } else if (event.type === 'damageReceived' && (event.player === 0 || event.player === 1)) {
      latestDamageReceived[event.player] = event.amount ?? 0;
    }
  }
  return {
    zoneEntries: [...zoneEntries].sort(),
    chronosTransitions: [...chronosTransitions].sort(),
    latestDamageReceived,
  };
}

/** Captures rule-relevant state while excluding logs, timestamps, and generated queue IDs. */
export function automaticResolutionStateKey(G: GameState, event: TimingEvent): string {
  return JSON.stringify({
    event,
    turnNumber: G.turnNumber,
    step: G.step,
    ready: G.ready,
    chronos: G.chronos,
    midnightRange: G.midnightRange,
    chronosAtTurnStart: G.chronosAtTurnStart,
    players: G.players.map((player) => ({
      hp: player.hp,
      deck: player.deck.map(cardState),
      hand: player.hand.map(cardState),
      battleZone: cardState(player.battleZone),
      setZoneA: cardState(player.setZoneA),
      setZoneB: cardState(player.setZoneB),
      setZoneC: cardState(player.setZoneC),
      powerCharger: player.powerCharger.map(cardState),
      abyss: player.abyss.map(cardState),
      cardsSetThisTurn: player.cardsSetThisTurn,
      rawAttack: player.rawAttack,
    })),
    lastBattleResult: G.lastBattleResult,
    setCardsThisTurn: G.setCardsThisTurn.map((cards) => cards.map(cardState)),
    pendingEffects: G.pendingEffects.map((effects) => effects.map(pendingEffectState)),
    pendingEffectPlayer: G.pendingEffectPlayer,
    delayedEffects: G.delayedEffects.map(pendingEffectState),
    pendingChoice: pendingChoiceState(G.pendingChoice),
    lastChoiceSelectionCount: G.lastChoiceSelectionCount,
    timingEvents: timingEventState(G.timingEvents),
    revealedHandCardIds: G.revealedHandCardIds,
    swappedCardsThisTurn: G.swappedCardsThisTurn.map((cards) => cards.map(cardState)),
    suppressedEffectCardIdsThisTurn: [...G.suppressedEffectCardIdsThisTurn].sort(),
    drawEffectCardIdsThisTurn: [...G.drawEffectCardIdsThisTurn].sort(),
    drawOccurredThisEffect: G.drawOccurredThisEffect,
    previousTurnCharacterElements: G.previousTurnCharacterElements,
    handSizeModifier: G.handSizeModifier,
    areaEnchantSetLocked: G.areaEnchantSetLocked,
    damageReducedThisTurn: G.damageReducedThisTurn,
    jankenChoices: G.jankenChoices,
    jankenDrawCount: G.jankenDrawCount,
    mulliganUsed: G.mulliganUsed,
    modifiers: G.modifiers,
  });
}

export function enterAutomaticResolution(
  G: GameState,
  event: TimingEvent,
  context?: AutomaticResolutionContext,
): { context: AutomaticResolutionContext; repeated: boolean } {
  const active =
    context?.turnNumber === G.turnNumber ? context : { turnNumber: G.turnNumber, seenStates: new Set<string>() };
  const key = automaticResolutionStateKey(G, event);
  if (active.seenStates.has(key)) return { context: active, repeated: true };
  active.seenStates.add(key);
  return { context: active, repeated: false };
}
