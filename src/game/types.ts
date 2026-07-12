import type { AppVersionInfo } from '../version';

export type Element = '闇' | '炎' | '電気' | '風' | 'カオス';
export type CardType = 'Character' | 'Enchant' | 'Area Enchant';
export type Rarity = 'N' | 'R' | 'SR' | 'UR' | 'SE';
export type ChronosTime = 'night' | 'day';

// 官方場地墊：クロノス共 18 刻度，夜（青）晝（赤）各 9 格平分；
// 真夜中（0）為夜弧中心、正午（9）為晝弧中心，順時針推進。
export const CHRONOS_MAPPING = {
  positions: 18,
  midnight: 0,
  noon: 9,
  nightPositions: [0, 1, 2, 3, 4, 14, 15, 16, 17],
  dayPositions: [5, 6, 7, 8, 9, 10, 11, 12, 13],
  direction: 'clockwise' as const,
} as const;

export type JankenChoice = 'rock' | 'paper' | 'scissors';
export type GameStep = 'janken' | 'mulligan' | 'initialSet' | 'turnSet' | 'effectOrder' | 'gameOver';
export type PlayerIndex = 0 | 1;
export type SetSlot = 'A' | 'B' | 'C';
export type TimingEventType =
  | 'turnStart'
  | 'turnEnd'
  | 'damageReceived'
  | 'chronosChanged'
  | 'zoneEntered'
  | 'characterReplaced'
  | 'battle';

export type HpChangeReason = 'battle' | 'directDamage' | 'heal' | 'healOpponent' | 'healBoth';

/**
 * HP 變化計算明細的一行說明。
 * - label：例如「攻擊力」「原始傷害」「減傷」「最終傷害」
 * - value：例如「30」「10」「-5」「25」
 * - cardDefId：若該行與某張卡（含附魔卡）相關，附上卡牌定義 ID 供 UI 顯示卡名
 */
export interface HpChangeBreakdownLine {
  label: string;
  value: string;
  cardDefId?: string;
}

/**
 * HP 變化的完整計算明細，供 UI 顯示「這次 HP 是怎麼算的」。
 * - title：摘要標題（例如「戰鬥傷害計算」「效果回復」）
 * - lines：結構化明細行，依計算順序排列
 * - participantCardDefIds：實際參與本次計算的所有卡牌（含附魔卡），用於 UI 標註參與卡
 *
 * battle 統一涵蓋攻擊力比較、減傷、不可減傷等；effect 涵蓋 directDamage / heal 類。
 */
export interface HpChangeBreakdown {
  title: string;
  lines: HpChangeBreakdownLine[];
  participantCardDefIds: string[];
}

export interface HpChangeEntry {
  id: number;
  player: PlayerIndex;
  delta: number;
  reason: HpChangeReason;
  sourceCardDefId?: string;
  breakdown?: HpChangeBreakdown;
  turn: number;
  timestamp: number;
}

/**
 * 統一遊戲事件提示（GameNotice）。
 *
 * 為了讓「遊戲進行的每一步」都有置中面板提示（HP 變化、時鐘推進、戰鬥結果、
 * 回合切換），且避免多個浮層互相競爭定位，引擎層在關鍵節點統一 push 到
 * `recentGameNotices`，由 UI 層單一 overlay 依序消費顯示。
 *
 * titleKey / kickerKey 存 i18n key 字串，由 UI 層翻譯（引擎層不依賴 i18n）。
 */
export type GameNoticeKind = 'hpChange' | 'chronosChange' | 'battleResult' | 'turnStart';
export type GameNoticeTone = 'success' | 'danger' | 'neutral' | 'phase';

export interface GameNotice {
  id: number;
  kind: GameNoticeKind;
  tone: GameNoticeTone;
  titleKey: string;
  kickerKey?: string;
  /** hpChange / battleResult 適用：受影響玩家。 */
  player?: PlayerIndex;
  /** hpChange 專用。 */
  delta?: number;
  reason?: HpChangeReason;
  sourceCardDefId?: string;
  breakdown?: HpChangeBreakdown;
  /** chronosChange 專用：from→to 位置與晝夜轉換、來源歸因。 */
  chronosFrom?: number;
  chronosTo?: number;
  chronosDelta?: number;
  chronosFromTime?: ChronosTime;
  chronosToTime?: ChronosTime;
  chronosSourceKind?: 'turnAdvance' | 'cardEffect';
  chronosSourceCardDefId?: string;
  /** battleResult 專用。 */
  winner?: PlayerIndex | null;
  winnerAttack?: number;
  loserAttack?: number;
  damage?: number;
  /** turnStart 專用。 */
  turn?: number;
  timestamp: number;
}

export interface ActionLogResult {
  ok: boolean;
  message?: string;
}

export interface ActionLogEntry {
  id: number;
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
  clientVersion?: AppVersionInfo;
  /**
   * 教學模式專用：跳過 setupGame 與 finishMulligan 的洗牌，
   * 讓固定牌組依陣列順序進入牌庫與手牌，確保劇本可預測。
   * 一般對戰不要設定此旗標。
   */
  skipShuffle?: boolean;
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
  sourceCardDefId?: string;
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
  /** 對局開始／結束的權威時間；保存在 G 中，重連與重新掛載不會重置。 */
  matchStartedAt: number;
  matchEndedAt: number | null;
  // P3-16：伺服器權威回合計時器，於回合開始時記錄（毫秒，Date.now()）。
  // 客戶端據此計算剩餘時間，避免兩端 setInterval 漂移；超時後任一在線端可為未準備玩家送出 timeoutSkip。
  turnStartTime: number;
  /** 當前需玩家互動階段的權威起始時間，供線上前置／效果流程超時恢復。 */
  interactionStartTime: number;
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
  jankenDrawCount: number;
  mulliganUsed: [boolean, boolean];
  modifiers: CombatModifiers;
  winner: PlayerIndex | null;
  gameoverReason: string | null;
  log: string[];
  actionLog: ActionLogEntry[];
  recentHpChanges: HpChangeEntry[];
  recentGameNotices: GameNotice[];
  /**
   * 教學模式內部旗標：由 setupGame 依 setupData.skipShuffle 設定。
   * finishMulligan 等後續流程據此跳過洗牌，確保教學劇本牌序可預測。
   * 非教學模式為 undefined，行為不變。
   */
  tutorialSkipShuffle?: boolean;
}
