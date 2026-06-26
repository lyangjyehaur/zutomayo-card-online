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
  | 'onChronosChanged' // When Chronos crosses a timing boundary
  | 'onZoneEntered'; // When a card enters a public zone

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
  | 'zoneHasElement'    // A zone has at least one card of an element
  | 'zoneEnteredCardType' // A card of this type entered a zone this turn
  | 'handCount'         // Hand has N cards
  | 'hpLessOrEqual'     // Player HP <= N
  | 'hpLessThanOpponent' // Player HP < opponent HP
  | 'damageAtLeast'     // Current damage event amount >= N
  | 'zoneEntered'       // A card entered a zone this turn
  | 'zoneCountAtLeast'  // A zone has at least N cards
  | 'chronosChanged'    // Chronos changed this turn
  | 'chronosTimeChanged' // Chronos changed between night/day this turn
  | 'namedCardCondition' // Named-song Character in a relevant zone
  | 'simultaneousCharacter' // Character was played with this effect
  | 'previousCharElement' // Previous turn's character element
  | 'hasAreaEnchant'    // Set zone C has specific card
  | 'battleLost'        // This player lost the current battle
  | 'and'               // Compound AND
  | 'or';               // Compound OR

export interface EffectAction {
  type: ActionType;
  params: Record<string, EffectValue>;
}

export type ActionType =
  | 'boostAttack'       // Attack +N
  | 'boostBothAttackByOwnHp' // Both players gain attack equal to own HP
  | 'reduceAttack'      // Attack -N
  | 'setOpponentAttack' // Set opposing attack to N
  | 'directDamage'      // Deal N damage to player
  | 'heal'              // Restore N HP
  | 'damageReduce'      // Reduce incoming damage by N
  | 'drawCards'         // Draw N cards
  | 'swapAttack'        // Swap night/day attack values
  | 'forceOwnAttackTime' // Force own attack to day/night value
  | 'clockReset'        // Reset chronos to start-of-turn
  | 'clockSet'          // Set chronos to specific position
  | 'clockSetFromTurnStartMinusOpponentClock' // Set Chronos to turn start minus opponent character clock
  | 'setAllCardClocks'  // Set all card clock values to N
  | 'clockAdvance'      // Advance chronos by N
  | 'recoverFromAbyss'  // Pick card from abyss
  | 'sendToAbyss'       // Send card to abyss
  | 'millDeckToAbyss'   // Move cards from deck top to abyss
  | 'moveOwnDeckTopByPower' // Move own deck top to power/abyss by SEND TO POWER
  | 'moveOpponentDeckTopByPowerCost' // Move opponent deck top by revealed power cost
  | 'revealOpponentHand' // Reveal opponent's current hand
  | 'returnAreaEnchantToDeck' // Return Area Enchant to deck
  | 'moveSelfAreaEnchant' // Move own Area Enchant to a zone
  | 'useFromAbyss'      // Choose an Enchant in Abyss and use its parsed effect
  | 'handSizeModifier'  // Track battle/game duration hand-size increases
  | 'setPowerCost'      // Reduce own Character power cost
  | 'requestChoice'      // Ask the owner to submit a validated choice
  | 'suppressEffectActivation' // Narrow no-op marker for a card-specific suppression clause
  | 'noEffect'          // Disable opponent effects
  | 'addSettableCard';  // Can set extra card
