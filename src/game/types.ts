// ===== Card Definitions =====

export type Element = '闇' | '炎' | '電気' | '風' | 'カオス';
export type CardType = 'Character' | 'Enchant' | 'Area Enchant';
export type Rarity = 'N' | 'R' | 'SR' | 'UR' | 'SE';
export type ChronosTime = 'night' | 'day';
export type GamePhase = 'set' | 'reveal' | 'time' | 'swap' | 'effect' | 'battle' | 'end';

export interface CardDef {
  id: string;
  name: string;
  pack: string;
  element: Element;
  type: CardType;
  clock: number;
  attack: { night: number; day: number } | null;
  powerCost: number;
  sendToPower: number;
  effect: string;
  image: string;
  errata: string;
}

export interface CardInstance {
  instanceId: string;
  defId: string;
  faceUp: boolean;
}

// ===== Player State =====

export interface PlayerState {
  hp: number;
  deck: CardInstance[];
  hand: CardInstance[];
  battleZone: CardInstance | null;
  setZoneA: CardInstance | null;
  setZoneB: CardInstance | null;
  setZoneC: CardInstance | null;
  powerCharger: CardInstance[];
  abyss: CardInstance[];
  // Track how many cards were set this turn (for draw count)
  cardsSetThisTurn: number;
  // Track the raw attack value this turn (before effects)
  rawAttack: number;
}

// ===== Game State =====

export interface ChronosState {
  // 0-11 position on the clock face
  position: number;
  // Which player is the "night side"
  nightSidePlayer: 0 | 1;
}

export interface LastBattleResult {
  winner: 0 | 1 | null; // null = draw
  damage: number;
  winnerAttack: number;
  loserAttack: number;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  chronos: ChronosState;
  turn: number;
  lastBattleResult: LastBattleResult;
  // Cards that were set this turn (for reveal/swap processing)
  setCardsThisTurn: {
    player0: CardInstance[];
    player1: CardInstance[];
  };
  // Game log for debugging
  log: string[];
}
