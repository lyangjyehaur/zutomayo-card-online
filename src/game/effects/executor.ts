import type { GameState } from '../types';
import type { ParsedEffect, Condition, EffectAction } from './types';
import { getCardDef } from '../cards/loader';

// ===== Condition Evaluator =====

function evaluateCondition(cond: Condition, G: GameState, playerIdx: number): boolean {
  const me = G.players[playerIdx];
  const opp = G.players[1 - playerIdx];

  switch (cond.type) {
    case 'chronos': {
      const currentTime = G.chronos.position < 6 ? 'night' : 'day';
      return currentTime === cond.value;
    }

    case 'opponentElement': {
      if (!opp.battleZone) return false;
      const def = getCardDef(opp.battleZone.defId);
      return def?.element === cond.value;
    }

    case 'selfElement': {
      if (!me.battleZone) return false;
      const def = getCardDef(me.battleZone.defId);
      return def?.element === cond.value;
    }

    case 'abyssElements': {
      const target = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      const elements = new Set<string>();
      for (const card of target) {
        const def = getCardDef(card.defId);
        if (def) elements.add(def.element);
      }
      return elements.size >= cond.value;
    }

    case 'abyssCount': {
      return me.abyss.length >= cond.value;
    }

    case 'handCount': {
      return me.hand.length >= cond.value;
    }

    case 'hpLessOrEqual': {
      return me.hp <= cond.value;
    }

    case 'chronosChanged': {
      // Simplified: always true if it's past turn 1
      return G.turn > 0;
    }

    case 'previousCharElement': {
      // TODO: Track previous turn's character
      return false;
    }

    case 'and': {
      return (cond.value as Condition[]).every(c => evaluateCondition(c, G, playerIdx));
    }

    case 'or': {
      return (cond.value as Condition[]).some(c => evaluateCondition(c, G, playerIdx));
    }

    default:
      return true;
  }
}

// ===== Action Executor =====

export function executeEffect(
  effect: ParsedEffect,
  G: GameState,
  playerIdx: number
): { success: boolean; message: string } {
  // Check all conditions
  const allConditionsMet = effect.conditions.every(c => evaluateCondition(c, G, playerIdx));
  if (!allConditionsMet) {
    return { success: false, message: 'Condition not met' };
  }

  const me = G.players[playerIdx];
  const opp = G.players[1 - playerIdx];

  switch (effect.action.type) {
    case 'boostAttack': {
      const value = effect.action.params.value;
      if (me.battleZone) {
        // Store boost in log (actual calculation happens in battle)
        G.log.push(`  Effect: Attack +${value}`);
        // We'll apply this during battle calculation
        return { success: true, message: `Attack +${value}` };
      }
      return { success: false, message: 'No battle character' };
    }

    case 'reduceAttack': {
      const value = effect.action.params.value;
      if (opp.battleZone) {
        G.log.push(`  Effect: Opponent attack -${value}`);
        return { success: true, message: `Opponent attack -${value}` };
      }
      return { success: false, message: 'No opponent battle character' };
    }

    case 'heal': {
      const value = effect.action.params.value;
      me.hp = Math.min(100, me.hp + value);
      G.log.push(`  Effect: Heal ${value} HP (now ${me.hp})`);
      return { success: true, message: `Heal ${value} HP` };
    }

    case 'directDamage': {
      const value = effect.action.params.value;
      if (value === -1) {
        // "damage cannot be reduced" - marker effect
        G.log.push(`  Effect: Damage cannot be reduced`);
        return { success: true, message: 'Unreduceable damage' };
      }
      opp.hp = Math.max(0, opp.hp - value);
      G.log.push(`  Effect: ${value} damage to opponent (HP: ${opp.hp})`);
      return { success: true, message: `${value} damage` };
    }

    case 'damageReduce': {
      const value = effect.action.params.value;
      G.log.push(`  Effect: Reduce damage by ${value}`);
      // Store for battle calculation
      return { success: true, message: `Damage reduce ${value}` };
    }

    case 'drawCards': {
      const value = effect.action.params.value;
      for (let i = 0; i < value && me.deck.length > 0; i++) {
        const card = me.deck.shift()!;
        card.faceUp = true;
        me.hand.push(card);
      }
      G.log.push(`  Effect: Draw ${value} cards`);
      return { success: true, message: `Draw ${value}` };
    }

    case 'swapAttack': {
      if (opp.battleZone) {
        const def = getCardDef(opp.battleZone.defId);
        if (def?.attack) {
          // Swap night and day attack values
          // This is a visual/logic marker - actual swap happens in battle calculation
          G.log.push(`  Effect: Swap opponent's day/night attack`);
          return { success: true, message: 'Swap attack' };
        }
      }
      return { success: false, message: 'No opponent character' };
    }

    case 'clockReset': {
      G.log.push(`  Effect: Chronos reset to start of turn`);
      // Reset to position 0
      G.chronos.position = 0;
      return { success: true, message: 'Chronos reset' };
    }

    case 'clockSet': {
      if (effect.action.params.value === 'any') {
        G.log.push(`  Effect: Set Chronos to any position`);
        // For now, set to midnight
        G.chronos.position = 0;
        return { success: true, message: 'Chronos set' };
      }
      if (effect.action.params.value === 'expand_midnight') {
        G.log.push(`  Effect: Expand midnight range`);
        return { success: true, message: 'Midnight expanded' };
      }
      return { success: false, message: 'Unknown clock set' };
    }

    case 'clockAdvance': {
      const value = effect.action.params.value;
      G.chronos.position = (G.chronos.position + value) % 12;
      G.log.push(`  Effect: Chronos +${value} (now ${G.chronos.position})`);
      return { success: true, message: `Chronos +${value}` };
    }

    case 'recoverFromAbyss': {
      if (effect.action.params.source === 'powerCharger' && me.powerCharger.length > 0) {
        const card = me.powerCharger.pop()!;
        card.faceUp = true;
        me.hand.push(card);
        G.log.push(`  Effect: Recover card from Power Charger`);
        return { success: true, message: 'Recover from Power Charger' };
      }
      if (me.abyss.length > 0) {
        const card = me.abyss.pop()!;
        card.faceUp = true;
        me.hand.push(card);
        G.log.push(`  Effect: Recover card from Abyss`);
        return { success: true, message: 'Recover from Abyss' };
      }
      return { success: false, message: 'No cards in abyss' };
    }

    case 'noEffect': {
      G.log.push(`  Effect: Opponent effects disabled`);
      return { success: true, message: 'Effects disabled' };
    }

    case 'addSettableCard': {
      G.log.push(`  Effect: May set additional card`);
      return { success: true, message: 'Extra set allowed' };
    }

    default:
      return { success: false, message: 'Unknown action type' };
  }
}

// ===== Process All Effects for a Turn =====

export function processTurnEffects(G: GameState, parsedEffects: Map<string, ParsedEffect[]>): void {
  // Process priority player first
  const priorityPlayer = G.chronos.position < 6 ? G.chronos.nightSidePlayer : (1 - G.chronos.nightSidePlayer) as 0 | 1;

  for (const playerIdx of [priorityPlayer, 1 - priorityPlayer] as const) {
    const player = G.players[playerIdx];

    // Check all cards in play (battle zone, set zone C)
    const cardsToCheck = [
      player.battleZone,
      player.setZoneC,
    ].filter(c => c !== null);

    for (const card of cardsToCheck) {
      if (!card) continue;
      const effects = parsedEffects.get(card.defId);
      if (!effects) continue;

      for (const effect of effects) {
        if (effect.trigger === 'onUse' || effect.trigger === 'onBattle') {
          executeEffect(effect, G, playerIdx);
        }
      }
    }
  }
}
