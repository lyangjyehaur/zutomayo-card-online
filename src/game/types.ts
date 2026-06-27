export type Element = '闇' | '炎' | '電気' | '風' | 'カオス';
export type CardType = 'Character' | 'Enchant' | 'Area Enchant';
export type Rarity = 'N' | 'R' | 'SR' | 'UR' | 'SE';
export type ChronosTime = 'night' | 'day';

export const CHRONOS_MAPPING = {
  positions: 12,
  midnight: 0,
  noon: 6,
  nightPositions: [0, 1, 2, 3, 10, 11],
  dayPositions: [4, 5, 6, 7, 8, 9],
  direction: 'clockwise' as const,
} as const;

export type JankenChoice = 'rock' | 'paper' | 'scissors';
export type GameStep = 'janken' | 'mulligan' | 'initialSet' | 'turnSet' | 'effectOrder' | 'gameOver';
export type PlayerIndex = 0 | 1;
export type SetSlot = 'A' | 'B';
export type TimingEventType =
  | 'turnStart'
  | 'turnEnd'
  | 'damageReceived'
  | 'chronosChanged'
  | 'zoneEntered'
  | 'characterReplaced'
  | 'battle';

export interface ActionLogResult {
  ok: boolean;
  message?: string;
}

export interface ActionLogEntry {
  id?: number;
  turn: number;
  step: string;
  player: PlayerIndex;
  action: string;
  payload?: Record<string, unknown>;
  result?: ActionLogResult;
  chronosPosition?: number;
  hp?: [number, number];
  pendingEffectCardDefId?: string;
  pendingChoiceType?: PendingChoice['type'];
  timestamp: number;
}

export interface TimingEvent {
  type: TimingEventType;
  player?: PlayerIndex;
  amount?: number;
  fromChronos?: number;
  toChronos?: number;
  fromChronosTime?: ChronosTime;
  toChronosTime?: ChronosTime;
  zone?: 'battleZone' | 'setZoneC' | 'abyss' | 'powerCharger';
  cardDefId?: string;
  replacedCardDefId?: string;
}

export interface ZutomayoSetupData {
  deck0Name?: string;
  deck1Name?: string;
  deck0Ids?: string[];
  deck1Ids?: string[];
}

export interface CardDef {
  id: string;
  name: string;
  enNameOfficial?: string;
  enEffectOfficial?: string;
  pack: string;
  song: string;
  illustrator: string;
  rarity: string;
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

export type PendingEffectSource = 'played' | 'battleZone' | 'setZoneC';

export interface PendingEffect {
  id: string;
  player: PlayerIndex;
  cardInstanceId: string;
  cardDefId: string;
  rawText: string;
  effect: import('./effects').ParsedEffect;
  source: PendingEffectSource;
}

export interface PendingChoiceOption {
  id: string;
  label: string;
  cardInstanceId?: string;
  cardDefId?: string;
  value?: number | string;
}

export type PendingChoiceCardZone = 'hand' | 'abyss' | 'powerCharger';
export type PendingChoiceDestinationZone = 'abyss' | 'deck';
export type PendingChoiceDeckPosition = 'bottom';

export interface PendingCardFilter {
  cardType?: CardType;
  song?: string;
  element?: Element;
}

export interface PendingCardMovePayload {
  sourcePlayer: PlayerIndex;
  sourceZone: PendingChoiceCardZone;
  destinationPlayer: PlayerIndex;
  destinationZone: PendingChoiceDestinationZone;
  destinationPosition?: PendingChoiceDeckPosition;
  filterSendToPower?: number;
}

export interface PendingOptionalHandMoveThenDrawPayload {
  sourcePlayer: PlayerIndex;
  sourceZone: 'hand';
  destinationPlayer: PlayerIndex;
  destinationZone: 'abyss' | 'powerCharger' | 'deck';
  destinationPosition?: PendingChoiceDeckPosition;
  drawCount: number | 'selected';
  filter: PendingCardFilter;
}

export interface PendingAbyssToDeckBottomPayload {
  faceDown: boolean;
  shuffle: boolean;
  followUpChoiceType?: 'reorderOpponentDeckTop';
  followUpCount?: number;
}

export interface PendingOpponentPowerCharacterSwapPayload {
  opponentPlayer: PlayerIndex;
}

export interface PendingReorderDeckTopPayload {
  targetPlayer: PlayerIndex;
  count: number;
}

export interface PendingUseFromAbyssPayload {
  sourcePlayer: PlayerIndex;
  sourceZone?: 'abyss' | 'powerCharger';
  cardType?: CardType;
  song?: string;
}

export interface PendingUseFromHandPayload {
  sourcePlayer: PlayerIndex;
  filter: PendingCardFilter;
  followUpDrawCount?: number;
}

export interface PendingRevealHandAttackBoostPayload {
  sourcePlayer: PlayerIndex;
  boostPerCard: number;
  filter: PendingCardFilter;
}

export interface PendingNameGuessOpponentHandRevealPayload {
  opponentPlayer: PlayerIndex;
  attackBoost: number;
}

export interface PendingChoiceBase {
  id: string;
  player: PlayerIndex;
  options: PendingChoiceOption[];
  min: number;
  max: number;
  prompt?: string;
}

export type PendingChoice =
  | (PendingChoiceBase & {
      type: 'handToDeckBottomThenDraw';
      payload: { drawCount: number };
    })
  | (PendingChoiceBase & {
      type: 'cardMove';
      payload: PendingCardMovePayload;
    })
  | (PendingChoiceBase & {
      type: 'optionalHandMoveThenDraw';
      payload: PendingOptionalHandMoveThenDrawPayload;
    })
  | (PendingChoiceBase & {
      type: 'abyssToDeckBottomOrLose';
      payload: PendingAbyssToDeckBottomPayload;
    })
  | (PendingChoiceBase & {
      type: 'reorderOpponentDeckTop';
      payload: PendingReorderDeckTopPayload;
    })
  | (PendingChoiceBase & {
      type: 'opponentPowerCharacterSwap';
      payload: PendingOpponentPowerCharacterSwapPayload;
    })
  | (PendingChoiceBase & {
      type: 'useFromAbyss';
      payload: PendingUseFromAbyssPayload;
    })
  | (PendingChoiceBase & {
      type: 'useFromHand';
      payload: PendingUseFromHandPayload;
    })
  | (PendingChoiceBase & {
      type: 'revealHandAttackBoost';
      payload: PendingRevealHandAttackBoostPayload;
    })
  | (PendingChoiceBase & {
      type: 'nameGuessOpponentHandReveal';
      payload: PendingNameGuessOpponentHandRevealPayload;
    })
  | (PendingChoiceBase & {
      type: 'handAbyssSwap';
      payload: Record<string, never>;
    })
  | (PendingChoiceBase & {
      type: 'clockPosition';
      payload: Record<string, never>;
    })
  | (PendingChoiceBase & {
      type: 'clockAdvance';
      payload: Record<string, never>;
    });

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
  cardsSetThisTurn: number;
  rawAttack: number;
}

export interface ChronosState {
  position: number;
  nightSidePlayer: PlayerIndex;
}

export interface LastBattleResult {
  winner: PlayerIndex | null;
  damage: number;
  winnerAttack: number;
  loserAttack: number;
}

export interface CombatModifiers {
  attack: [number, number];
  attackSetTo: [number | null, number | null];
  attackTimeOverride: [ChronosTime | null, ChronosTime | null];
  cardClockSetTo: number | null;
  damageReduction: [number, number];
  elementOverride: [Element | null, Element | null];
  handSize: [number, number];
  clockContributionDisabled: [boolean, boolean];
  powerCostReduction: [number, number];
  extraSettableCards: [number, number];
  sendToPower: [number, number];
  swapAttack: [boolean, boolean];
  effectsDisabled: [boolean, boolean];
  enchantEffectsDisabled: [boolean, boolean];
  unreduceableDamage: [boolean, boolean];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  step: GameStep;
  ready: [boolean, boolean];
  chronos: ChronosState;
  midnightRange: number;
  chronosAtTurnStart: number;
  turnNumber: number;
  // P3-16：伺服器權威回合計時器，於回合開始時記錄（毫秒，Date.now()）。
  // 客戶端據此計算剩餘時間，避免兩端 setInterval 漂移；超時由 timeoutSkip move 處理。
  turnStartTime: number;
  lastBattleResult: LastBattleResult;
  setCardsThisTurn: [CardInstance[], CardInstance[]];
  pendingEffects: [PendingEffect[], PendingEffect[]];
  pendingEffectPlayer: PlayerIndex | null;
  delayedEffects: PendingEffect[];
  pendingChoice: PendingChoice | null;
  lastChoiceSelectionCount: [number | null, number | null];
  timingEvents: TimingEvent[];
  revealedHandCardIds: [string[], string[]];
  swappedCardsThisTurn: [CardInstance[], CardInstance[]];
  suppressedEffectCardIdsThisTurn: string[];
  drawEffectCardIdsThisTurn: string[];
  drawOccurredThisEffect: [boolean, boolean];
  previousTurnCharacterElements: [Element | null, Element | null];
  handSizeModifier: [number, number];
  areaEnchantSetLocked: [boolean, boolean];
  damageReducedThisTurn: [number, number];
  jankenChoices: [JankenChoice | null, JankenChoice | null];
  mulliganUsed: [boolean, boolean];
  modifiers: CombatModifiers;
  winner: PlayerIndex | null;
  gameoverReason: string | null;
  log: string[];
  actionLog: ActionLogEntry[];
}
