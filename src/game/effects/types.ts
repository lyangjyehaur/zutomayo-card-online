import type { ChronosTime, Element } from '../types';

// ===== Effect DSL Types =====

export interface ParsedEffect {
  trigger: EffectTrigger;
  conditions: Condition[];
  action: EffectAction;
  rawText: string; // Original Japanese text
}

export type EffectTrigger =
  | 'onBattle'      // Battle phase
  | 'onUse'         // When card is played
  | 'onEnter'       // When entering battle zone
  | 'onLeave'       // When leaving field
  | 'onTurnStart'   // Start of turn
  | 'onTurnEnd'     // End of turn
  | 'onDamageReceived'; // When taking damage

export interface Condition {
  type: ConditionType;
  value: any;
  target?: string; // e.g. 'powerCharger' vs 'abyss'
}

export type ConditionType =
  | 'chronos'           // Night or day
  | 'opponentElement'   // Opponent character's element
  | 'selfElement'       // Own character's element
  | 'powerAtLeast'      // Player power >= N
  | 'abyssCount'        // Abyss has N+ cards
  | 'abyssElements'     // Abyss has N distinct elements
  | 'handCount'         // Hand has N cards
  | 'hpLessOrEqual'     // Player HP <= N
  | 'chronosChanged'    // Chronos changed this turn
  | 'previousCharElement' // Previous turn's character element
  | 'hasAreaEnchant'    // Set zone C has specific card
  | 'and'               // Compound AND
  | 'or';               // Compound OR

export interface EffectAction {
  type: ActionType;
  params: Record<string, any>;
}

export type ActionType =
  | 'boostAttack'       // Attack +N
  | 'reduceAttack'      // Attack -N
  | 'directDamage'      // Deal N damage to player
  | 'heal'              // Restore N HP
  | 'damageReduce'      // Reduce incoming damage by N
  | 'drawCards'         // Draw N cards
  | 'swapAttack'        // Swap night/day attack values
  | 'clockReset'        // Reset chronos to start-of-turn
  | 'clockSet'          // Set chronos to specific position
  | 'clockAdvance'      // Advance chronos by N
  | 'recoverFromAbyss'  // Pick card from abyss
  | 'sendToAbyss'       // Send card to abyss
  | 'noEffect'          // Disable opponent effects
  | 'addSettableCard';  // Can set extra card
