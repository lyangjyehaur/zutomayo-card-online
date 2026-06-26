import type { ChronosTime, Element } from '../types';

// ===== Effect DSL Types =====

export type EffectValue = string | number | boolean | string[];

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
  | 'onDamageReceived' // When taking damage
  | 'onChronosChanged'; // When Chronos crosses a timing boundary

export type Condition =
  | {
      type: Exclude<ConditionType, 'and' | 'or'>;
      value: EffectValue;
      target?: string; // e.g. 'powerCharger' vs 'abyss'
    }
  | {
      type: 'and' | 'or';
      value: Condition[];
      target?: string;
    };

export type ConditionType =
  | 'chronos'           // Night or day
  | 'opponentElement'   // Opponent character's element
  | 'selfElement'       // Own character's element
  | 'powerAtLeast'      // Player power >= N
  | 'abyssCount'        // Abyss has N+ cards
  | 'abyssElements'     // Abyss has N distinct elements
  | 'handCount'         // Hand has N cards
  | 'hpLessOrEqual'     // Player HP <= N
  | 'hpLessThanOpponent' // Player HP < opponent HP
  | 'chronosChanged'    // Chronos changed this turn
  | 'chronosTimeChanged' // Chronos changed between night/day this turn
  | 'namedCardCondition' // Named-song Character in a relevant zone
  | 'simultaneousCharacter' // Character was played with this effect
  | 'previousCharElement' // Previous turn's character element
  | 'hasAreaEnchant'    // Set zone C has specific card
  | 'and'               // Compound AND
  | 'or';               // Compound OR

export interface EffectAction {
  type: ActionType;
  params: Record<string, EffectValue>;
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
  | 'millDeckToAbyss'   // Move cards from deck top to abyss
  | 'returnAreaEnchantToDeck' // Return Area Enchant to deck
  | 'moveSelfAreaEnchant' // Move own Area Enchant to a zone
  | 'requestChoice'      // Ask the owner to submit a validated choice
  | 'noEffect'          // Disable opponent effects
  | 'addSettableCard';  // Can set extra card
