import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { TUTORIAL_DECK0_IDS, TUTORIAL_DECK1_IDS } from '../data/tutorialScenario';
import { ZutomayoCard } from '../game/Game';
import {
  advanceChronos,
  confirmReady,
  finishMulligan,
  resolveBattle,
  resolveJanken,
  revealCards,
  setInitialCard,
  setTurnCard,
  setupGame,
  submitPendingChoice,
} from '../game/GameLogic';
import { parseAllEffects, type ParsedEffect } from '../game/effects';
import { pushGameNotice } from '../game/gameNotices';
import {
  createInstance,
  getAllCardDefs,
  getCardDef,
  initCards,
  isCardsInitialized,
  resetInstanceCounter,
} from '../game/cards/loader';
import { CHRONOS_MAPPING } from '../game/types';
import type {
  CardDef,
  CardInstance,
  ChronosTime,
  GameState,
  PendingChoice,
  PendingEffect,
  PlayerIndex,
  SetSlot,
} from '../game/types';
import { t } from '../i18n';

type BoardComponentProps = ComponentProps<typeof Board>;

const BATTLE_QA_STATES = [
  { id: 'janken', label: 'Janken' },
  { id: 'mulligan', label: 'Mulligan' },
  { id: 'initial-select', label: 'Initial Select' },
  { id: 'initial-set', label: 'Initial Set' },
  { id: 'turn-set', label: 'Turn Set' },
  { id: 'clock-resolution', label: 'Clock Resolution' },
  { id: 'chronos-effect-advance', label: 'Chronos Effect +' },
  { id: 'chronos-effect-rewind', label: 'Chronos Effect −' },
  { id: 'chronos-effect-set', label: 'Chronos Effect Set' },
  { id: 'chronos-effect-cycle', label: 'Chronos Effect Full Cycle' },
  { id: 'chronos-effect-queue', label: 'Chronos Effect Queue' },
  { id: 'chronos-position-choice', label: 'Chronos Position Choice' },
  { id: 'revealed-hand', label: 'Revealed Hand' },
  { id: 'guess-declaration', label: 'Guess Declaration' },
  { id: 'guess-position', label: 'Guess Hidden Card' },
  { id: 'partial-reveal', label: 'Partial Hand Reveal' },
  { id: 'deck-top-reveal', label: 'Deck-top Reveal' },
  { id: 'deck-reorder', label: 'Deck Reorder' },
  { id: 'status-effects', label: 'Persistent Status Effects' },
  { id: 'battle-resolution', label: 'Battle Resolution' },
  { id: 'battle-modifiers', label: 'Battle Modifiers' },
  { id: 'battle-insufficient', label: 'Battle Power 0' },
  { id: 'battle-draw', label: 'Battle Draw' },
  { id: 'battle-zero-damage', label: 'Battle Guard' },
  { id: 'battle-double-zero', label: 'Battle 0 = 0' },
  { id: 'battle-negative', label: 'Battle Negative' },
  { id: 'effect-hp-resolution', label: 'Effect HP' },
  { id: 'resolution-timeline', label: 'Resolution Timeline' },
  { id: 'game-over-resolution', label: 'Game Over Resolution' },
  { id: 'cross-turn-resolution', label: 'Cross-turn Resolution' },
  { id: 'effect-order', label: 'Effect Order' },
  { id: 'pending-choice', label: 'Pending Choice' },
  { id: 'game-over', label: 'Game Over' },
] as const;

const BATTLE_QA_SIDES = [
  { id: 'night', label: 'Me Night' },
  { id: 'day', label: 'Me Day' },
] as const;

const BATTLE_QA_TIMES = [
  { id: 'auto', label: 'Auto Time' },
  { id: 'night', label: 'Night Time' },
  { id: 'day', label: 'Day Time' },
] as const;

type BattleQaStateId = (typeof BATTLE_QA_STATES)[number]['id'];
type BattleQaSideId = (typeof BATTLE_QA_SIDES)[number]['id'];
type BattleQaTimeId = (typeof BATTLE_QA_TIMES)[number]['id'];
type BattleQaViewerId = '0' | '1' | 'spectator';

const REQUIRED_QA_CARD_IDS = [...new Set([...TUTORIAL_DECK0_IDS, ...TUTORIAL_DECK1_IDS])];

const BATTLE_QA_FALLBACK_CARDS: CardDef[] = [
  {
    id: '1st_2',
    name: 'QA High Cost Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '闇',
    type: 'Character',
    clock: 1,
    attack: { night: 90, day: 60 },
    powerCost: 7,
    sendToPower: 2,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_34',
    name: 'QA Night Attacker',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: '炎',
    type: 'Character',
    clock: 1,
    attack: { night: 70, day: 40 },
    powerCost: 1,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_35',
    name: 'QA Reserve Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '炎',
    type: 'Character',
    clock: 1,
    attack: { night: 45, day: 45 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_46',
    name: 'QA Day Attacker',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '電気',
    type: 'Character',
    clock: 1,
    attack: { night: 40, day: 80 },
    powerCost: 2,
    sendToPower: 0,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_66',
    name: 'QA Filler Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 1,
    attack: { night: 40, day: 40 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_67',
    name: 'QA Opponent Attacker',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 1,
    attack: { night: 50, day: 30 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_68',
    name: 'QA Reserve Wind',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '風',
    type: 'Character',
    clock: 2,
    attack: { night: 35, day: 55 },
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_70',
    name: 'QA Opening Character',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: '電気',
    type: 'Character',
    clock: 2,
    attack: { night: 30, day: 60 },
    powerCost: 0,
    sendToPower: 2,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '1st_98',
    name: 'QA Attack Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: 'カオス',
    type: 'Enchant',
    clock: 4,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '相手のキャラクターカードが1コスト以下なら攻撃力+30',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '2nd_86',
    name: 'QA Night Area Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'SR',
    element: '闇',
    type: 'Area Enchant',
    clock: 2,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '夜なら攻撃力+20',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '2nd_92',
    name: 'QA Reserve Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'N',
    element: '電気',
    type: 'Enchant',
    clock: 1,
    attack: null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '/card-back.jpg',
    errata: '',
  },
  {
    id: '2nd_98',
    name: 'QA Day Area Enchant',
    pack: 'QA',
    song: 'Fixture',
    illustrator: 'QA',
    rarity: 'R',
    element: '電気',
    type: 'Area Enchant',
    clock: 2,
    attack: null,
    powerCost: 1,
    sendToPower: 1,
    effect: '昼なら攻撃力+20。昼じゃなくなったらパワーチャージャーに置く',
    image: '/card-back.jpg',
    errata: '',
  },
];

function hasRequiredQaCards(): boolean {
  return REQUIRED_QA_CARD_IDS.every((id) => Boolean(getCardDef(id)));
}

function ensureBattleQaCards(): void {
  if (!isCardsInitialized() || !hasRequiredQaCards()) {
    initCards(BATTLE_QA_FALLBACK_CARDS);
  }
}

function createParsedEffects(): Map<string, ParsedEffect[]> {
  return parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));
}

function createTutorialGame(): GameState {
  resetInstanceCounter();
  return setupGame(
    {
      deck0Ids: TUTORIAL_DECK0_IDS,
      deck1Ids: TUTORIAL_DECK1_IDS,
      skipShuffle: true,
    },
    { allowBrowserCustomDeckName: true },
  );
}

function setCardFromHand(
  G: GameState,
  player: PlayerIndex,
  defId: string,
  setCard: (G: GameState, player: PlayerIndex, handIndex: number) => boolean,
): void {
  const handIndex = G.players[player].hand.findIndex((card) => card.defId === defId);
  if (handIndex === -1 || !setCard(G, player, handIndex)) {
    throw new Error(`Unable to set ${defId} for player ${player}`);
  }
}

function setTurnCardFromHand(G: GameState, player: PlayerIndex, defId: string, slot: SetSlot): void {
  const handIndex = G.players[player].hand.findIndex((card) => card.defId === defId);
  if (handIndex === -1 || !setTurnCard(G, player, handIndex, slot)) {
    throw new Error(`Unable to set ${defId} into slot ${slot} for player ${player}`);
  }
}

function createMulliganState(side: BattleQaSideId): GameState {
  const G = createTutorialGame();
  if (side === 'day') {
    resolveJanken(G, 'scissors', 'rock');
  } else {
    resolveJanken(G, 'rock', 'scissors');
  }
  return G;
}

function createInitialSetBase(side: BattleQaSideId): GameState {
  const G = createMulliganState(side);
  finishMulligan(G, 0, [0]);
  finishMulligan(G, 1, []);
  return G;
}

function createInitialSetState(side: BattleQaSideId): GameState {
  const G = createInitialSetBase(side);
  setCardFromHand(G, 0, '1st_70', setInitialCard);
  return G;
}

function createTurnOneResolvedState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createInitialSetBase(side);
  setCardFromHand(G, 0, '1st_70', setInitialCard);
  setCardFromHand(G, 1, '1st_67', setInitialCard);
  confirmReady(G, 0, parsedEffects);
  confirmReady(G, 1, parsedEffects);
  if (G.step !== 'turnSet') {
    throw new Error(`Expected turnSet after turn one, got ${G.step}`);
  }
  return G;
}

function createTurnSetState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnOneResolvedState(parsedEffects, side);
  clearTransientQaOverlays(G);
  setTurnCardFromHand(G, 0, '1st_46', 'A');
  setTurnCardFromHand(G, 0, '2nd_98', 'B');
  setTurnCardFromHand(G, 1, '1st_98', 'A');
  addQaZonePreviewStacks(G);
  return G;
}

/** 第二回合公開後、卡牌移出設置區前的時計合計瞬間。 */
function createClockResolutionState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  G.ready = [true, true];
  revealCards(G);
  advanceChronos(G, parsedEffects);
  return G;
}

function createChronosEffectState(
  parsedEffects: Map<string, ParsedEffect[]>,
  side: BattleQaSideId,
  mode: 'advance' | 'rewind' | 'set',
): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const sourceCard = G.players[0].battleZone;
  if (!sourceCard) throw new Error('Unable to prepare Chronos effect source card');
  sourceCard.faceUp = true;
  const from = mode === 'advance' ? 2 : mode === 'rewind' ? 8 : 3;
  const to = mode === 'advance' ? 7 : mode === 'rewind' ? 5 : 13;
  G.chronos.position = to;
  G.step = 'effectOrder';
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  pushGameNotice(G, {
    kind: 'chronosChange',
    tone: 'phase',
    titleKey: 'board.notice.chronosCardEffect',
    player: 0,
    chronosFrom: from,
    chronosTo: to,
    chronosDelta: mode === 'advance' ? 5 : mode === 'rewind' ? -3 : -8,
    chronosSourceKind: 'cardEffect',
    chronosSourceCardDefId: sourceCard.defId,
    chronosSourceCardInstanceId: sourceCard.instanceId,
    chronosEffectMode: mode,
    ...(mode === 'set' ? {} : { chronosMoveAmount: mode === 'advance' ? 5 : 3 }),
  });
  return G;
}

function createChronosEffectCycleState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const sourceCard = G.players[0].battleZone;
  if (!sourceCard) throw new Error('Unable to prepare Chronos full-cycle effect source card');
  sourceCard.faceUp = true;
  G.chronos.position = 2;
  G.step = 'effectOrder';
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  pushGameNotice(G, {
    kind: 'chronosChange',
    tone: 'phase',
    titleKey: 'board.notice.chronosCardEffect',
    player: 0,
    chronosFrom: 2,
    chronosTo: 2,
    chronosDelta: 0,
    chronosSourceKind: 'cardEffect',
    chronosSourceCardDefId: sourceCard.defId,
    chronosSourceCardInstanceId: sourceCard.instanceId,
    chronosEffectMode: 'advance',
    chronosMoveAmount: CHRONOS_MAPPING.positions,
  });
  return G;
}

function createChronosEffectQueueState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const sourceCard = G.players[0].battleZone;
  if (!sourceCard) throw new Error('Unable to prepare queued Chronos effect source card');
  sourceCard.faceUp = true;
  G.chronos.position = 13;
  G.step = 'effectOrder';
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  const notices = [
    { from: 2, to: 7, mode: 'advance' as const, moveAmount: 5, delta: 5 },
    { from: 7, to: 4, mode: 'rewind' as const, moveAmount: 3, delta: -3 },
    { from: 4, to: 13, mode: 'set' as const, moveAmount: undefined, delta: -9 },
  ];
  for (const notice of notices) {
    pushGameNotice(G, {
      kind: 'chronosChange',
      tone: 'phase',
      titleKey: 'board.notice.chronosCardEffect',
      player: 0,
      chronosFrom: notice.from,
      chronosTo: notice.to,
      chronosDelta: notice.delta,
      chronosSourceKind: 'cardEffect',
      chronosSourceCardDefId: sourceCard.defId,
      chronosSourceCardInstanceId: sourceCard.instanceId,
      chronosEffectMode: notice.mode,
      ...(notice.moveAmount === undefined ? {} : { chronosMoveAmount: notice.moveAmount }),
    });
  }
  return G;
}

/** 獨立重播攻擊力比較、卡牌交鋒與 HP 扣減，不混入時計動畫。 */
function createBattleResolutionState(
  parsedEffects: Map<string, ParsedEffect[]>,
  side: BattleQaSideId,
  time: BattleQaTimeId,
  variant: 'standard' | 'modifiers' | 'insufficient' | 'draw' | 'zero-damage' | 'double-zero' | 'negative' = 'standard',
): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const player0Card = variant === 'insufficient' || variant === 'double-zero' ? '1st_2' : '1st_34';
  const player1Card = variant === 'double-zero' ? '1st_2' : '1st_46';
  G.players[0].battleZone = createInstance(player0Card, true);
  G.players[1].battleZone = createInstance(player1Card, true);
  G.players[0].setZoneA = null;
  G.players[0].setZoneB = null;
  G.players[1].setZoneA = null;
  G.players[1].setZoneB = null;
  G.players[0].hp = 100;
  G.players[1].hp = 100;
  G.ready = [true, true];
  G.setCardsThisTurn = [[], []];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
  G.modifiers.attack = variant === 'modifiers' ? [20, 0] : variant === 'negative' ? [-20, 0] : [0, 0];
  G.modifiers.attackSetTo = variant === 'draw' ? [40, 40] : [null, null];
  G.modifiers.damageReduction = variant === 'modifiers' ? [0, 10] : variant === 'zero-damage' ? [0, 99] : [0, 0];
  G.modifiers.damageReductionSources = [
    [],
    variant === 'modifiers' || variant === 'zero-damage'
      ? [
          {
            cardInstanceId: G.players[1].battleZone.instanceId,
            cardDefId: G.players[1].battleZone.defId,
            amount: variant === 'zero-damage' ? 99 : 10,
          },
        ]
      : [],
  ];
  G.modifiers.powerCostReduction = variant === 'insufficient' ? [0, 99] : variant === 'double-zero' ? [0, 0] : [99, 99];
  if (variant === 'insufficient' || variant === 'double-zero') G.players[0].powerCharger = [];
  if (variant === 'double-zero') G.players[1].powerCharger = [];
  applyQaChronosTime(G, time);
  resolveBattle(G, new Map());
  return G;
}

function createResolutionTimelineState(
  parsedEffects: Map<string, ParsedEffect[]>,
  side: BattleQaSideId,
  time: BattleQaTimeId,
): GameState {
  const G = createBattleResolutionState(parsedEffects, side, time);
  const affectedPlayer: PlayerIndex = 1;
  const hpBeforeHeal = G.players[affectedPlayer].hp;
  const hpAfterHeal = Math.min(100, hpBeforeHeal + 10);
  G.players[affectedPlayer].hp = hpAfterHeal;
  pushGameNotice(G, {
    kind: 'hpChange',
    tone: 'success',
    titleKey: 'board.hpChange.healBoth',
    player: affectedPlayer,
    delta: hpAfterHeal - hpBeforeHeal,
    hpBefore: hpBeforeHeal,
    hpAfter: hpAfterHeal,
    reason: 'healBoth',
    sourceCardDefId: G.players[0].battleZone?.defId,
    sourceCardInstanceId: G.players[0].battleZone?.instanceId,
  });
  const chronosFrom = G.chronos.position;
  const chronosTo = (chronosFrom + 2) % CHRONOS_MAPPING.positions;
  G.chronos.position = chronosTo;
  pushGameNotice(G, {
    kind: 'chronosChange',
    tone: 'phase',
    titleKey: 'board.notice.chronosCardEffect',
    player: 0,
    chronosFrom,
    chronosTo,
    chronosDelta: 2,
    chronosSourceKind: 'cardEffect',
    chronosSourceCardDefId: G.players[0].battleZone?.defId,
    chronosSourceCardInstanceId: G.players[0].battleZone?.instanceId,
    chronosEffectMode: 'advance',
    chronosMoveAmount: 2,
  });
  pushGameNotice(G, {
    kind: 'turnStart',
    tone: 'phase',
    titleKey: 'board.notice.turnStart',
    turn: G.turnNumber + 1,
  });
  return G;
}

function createEffectHpResolutionState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const sourceCard = G.players[0].battleZone;
  if (!sourceCard) throw new Error('Unable to prepare effect HP source card');
  sourceCard.faceUp = true;
  G.players[0].hp = 65;
  pushGameNotice(G, {
    kind: 'hpChange',
    tone: 'success',
    titleKey: 'board.hpChange.heal',
    player: 0,
    delta: 20,
    hpBefore: 45,
    hpAfter: 65,
    reason: 'heal',
    sourceCardDefId: sourceCard.defId,
    sourceCardInstanceId: sourceCard.instanceId,
  });
  return G;
}

function createZonePreviewCards(defIds: string[]): CardInstance[] {
  return defIds.filter((defId) => Boolean(getCardDef(defId))).map((defId) => createInstance(defId, true));
}

function addQaZonePreviewStacks(G: GameState): void {
  G.players[0].powerCharger = createZonePreviewCards(['1st_9', '1st_43', '1st_13']);
  G.players[0].abyss = createZonePreviewCards(['2nd_92', '1st_98', '2nd_86']);
  G.players[1].powerCharger = createZonePreviewCards(['1st_9', '1st_43']);
  G.players[1].abyss = createZonePreviewCards(['2nd_92', '1st_98']);
}

function faceUp(card: CardInstance | null): void {
  if (card) card.faceUp = true;
}

function clearTransientQaOverlays(G: GameState): void {
  G.recentGameNotices = [];
  G.recentHpChanges = [];
}

function prepareEffectField(G: GameState): GameState {
  clearTransientQaOverlays(G);
  for (const card of G.setCardsThisTurn.flat()) faceUp(card);
  faceUp(G.players[0].battleZone);
  faceUp(G.players[1].battleZone);
  faceUp(G.players[1].setZoneA);

  const previousPlayerCharacter = G.players[0].battleZone;
  const nextPlayerCharacter = G.players[0].setZoneA;
  const nextAreaEnchant = G.players[0].setZoneB;
  if (previousPlayerCharacter) {
    G.players[0].powerCharger.push(previousPlayerCharacter);
  }
  if (nextPlayerCharacter) {
    nextPlayerCharacter.faceUp = true;
    G.players[0].battleZone = nextPlayerCharacter;
    G.players[0].setZoneA = null;
  }
  if (nextAreaEnchant) {
    nextAreaEnchant.faceUp = true;
    G.players[0].setZoneC = nextAreaEnchant;
    G.players[0].setZoneB = null;
  }

  G.step = 'effectOrder';
  G.ready = [true, true];
  G.chronosAtTurnStart = 3;
  G.chronos.position = 10;
  G.log.push('QA fixture: cards revealed for effect-order visual state.');
  return G;
}

function createQaEffect(
  player: PlayerIndex,
  card: CardInstance,
  actionValue: number,
  rawText: string,
  source: PendingEffect['source'],
): PendingEffect {
  return {
    id: `qa-effect-${player}-${card.instanceId}`,
    player,
    cardInstanceId: card.instanceId,
    cardDefId: card.defId,
    rawText,
    effect: {
      trigger: 'onUse',
      conditions: [],
      action: { type: 'boostAttack', params: { value: actionValue } },
      rawText,
    },
    source,
  };
}

function createEffectOrderState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = prepareEffectField(createTurnSetState(parsedEffects, side));
  const playerArea = G.players[0].setZoneC;
  const playerCharacter = G.players[0].battleZone;
  const opponentEnchant = G.players[1].setZoneA;
  if (!playerArea || !playerCharacter || !opponentEnchant) throw new Error('Unable to prepare QA pending effects');
  G.chronos.position = G.chronosAtTurnStart;
  advanceChronos(G, parsedEffects);
  G.pendingEffects = [
    [
      createQaEffect(0, playerArea, 20, '昼なら攻撃力+20', 'setZoneC'),
      createQaEffect(0, playerCharacter, 10, 'このターン中、自分の攻撃力+10', 'battleZone'),
    ],
    [createQaEffect(1, opponentEnchant, 30, '相手のキャラクターカードが1コスト以下なら攻撃力+30', 'played')],
  ];
  G.pendingEffectPlayer = 0;
  return G;
}

function createPendingChoiceState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const options = G.players[0].hand.slice(0, 3).map((card) => ({
    id: card.instanceId,
    label: getCardDef(card.defId)?.name ?? card.defId,
    cardInstanceId: card.instanceId,
    cardDefId: card.defId,
  }));
  const choice: PendingChoice = {
    id: 'qa-choice-hand-to-power',
    type: 'cardMove',
    player: 0,
    options,
    min: 1,
    max: Math.min(2, Math.max(1, options.length)),
    prompt: 'QA fixture: choose cards to move for responsive inspection.',
    sourceCardDefId: G.players[0].setZoneC?.defId,
    payload: {
      sourcePlayer: 0,
      sourceZone: 'hand',
      destinationPlayer: 0,
      destinationZone: 'abyss',
    },
  };
  G.pendingChoice = choice;
  return G;
}

function createChronosPositionChoiceState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const sourceCard = G.players[0].setZoneC ?? G.players[0].battleZone;
  G.pendingChoice = {
    id: 'qa-choice-chronos-position',
    type: 'clockPosition',
    player: 0,
    options: Array.from({ length: CHRONOS_MAPPING.positions }, (_, position) => ({
      id: `chronos-${position}`,
      label: `${position}`,
      value: position,
    })),
    min: 1,
    max: 1,
    prompt: 'QA fixture: choose any Chronos target position.',
    ...(sourceCard ? { sourceCardDefId: sourceCard.defId, sourceCardInstanceId: sourceCard.instanceId } : {}),
    payload: {},
  };
  return G;
}

function createRevealedHandState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  const sourceCard = G.players[0].battleZone;
  if (!sourceCard) throw new Error('Unable to prepare revealed-hand source card');
  sourceCard.faceUp = true;
  G.step = 'effectOrder';
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.revealedHandCardIds[1] = G.players[1].hand.map((card) => card.instanceId);
  G.pendingChoice = {
    id: 'qa-choice-revealed-hand',
    type: 'acknowledgeRevealedHand',
    player: 0,
    options: [],
    min: 0,
    max: 0,
    prompt: 'QA fixture: review the temporarily revealed opposing hand.',
    sourceCardDefId: sourceCard.defId,
    sourceCardInstanceId: sourceCard.instanceId,
    payload: { revealedPlayer: 1 },
  };
  return G;
}

function createGuessDeclarationState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const sourceCard = G.players[0].battleZone;
  G.pendingChoice = {
    id: 'qa-choice-guess-declaration',
    type: 'declareOpponentHandCardName',
    player: 0,
    min: 1,
    max: 1,
    prompt: 'QA fixture: declare a card name.',
    payload: { opponentPlayer: 1, attackBoost: 20 },
    options: getAllCardDefs().map((card) => ({
      id: `declare:${card.id}`,
      label: card.name,
      value: card.id,
      cardDefId: card.id,
    })),
    ...(sourceCard ? { sourceCardDefId: sourceCard.defId, sourceCardInstanceId: sourceCard.instanceId } : {}),
  };
  return G;
}

function createGuessPositionState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const target = G.players[1].hand[0];
  G.pendingChoice = {
    id: 'qa-choice-guess-position',
    type: 'selectOpponentHandCard',
    player: 0,
    min: 1,
    max: 1,
    prompt: 'QA fixture: choose one hidden opposing hand card.',
    payload: { opponentPlayer: 1, attackBoost: 20, guessedCardDefId: target?.defId ?? '1st_1' },
    options: G.players[1].hand.map((_card, index) => ({
      id: `hand-position:${index}`,
      label: `Opponent hand ${index + 1}`,
      value: index,
    })),
  };
  return G;
}

function createPartialRevealState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const revealed = G.players[0].hand.slice(0, 2);
  G.revealedHandCardIds[0] = revealed.map((card) => card.instanceId);
  G.pendingChoice = {
    id: 'qa-choice-partial-reveal',
    type: 'acknowledgeRevealedHand',
    player: 1,
    min: 0,
    max: 0,
    prompt: 'QA fixture: selected cards revealed for attack boost.',
    payload: {
      revealedPlayer: 0,
      sourceZone: 'hand',
      revealedCardInstanceIds: revealed.map((card) => card.instanceId),
      boostPerCard: 10,
      attackBoost: revealed.length * 10,
    },
    options: [],
  };
  return G;
}

function createDeckTopRevealState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const revealed = G.players[1].deck[0];
  const revealedPowerCost = getCardDef(revealed?.defId ?? '')?.powerCost ?? 0;
  if (revealed) revealed.faceUp = true;
  G.pendingChoice = {
    id: 'qa-choice-deck-top-reveal',
    type: 'acknowledgeRevealedHand',
    player: 0,
    min: 0,
    max: 0,
    prompt: 'QA fixture: review a revealed deck-top card.',
    payload: {
      revealedPlayer: 1,
      sourceZone: 'deck',
      revealedCardInstanceIds: revealed ? [revealed.instanceId] : [],
      deckComparison: {
        stat: 'powerCost',
        value: revealedPowerCost,
        threshold: 3,
        matched: revealedPowerCost >= 3,
      },
    },
    options: [],
  };
  return G;
}

function createDeckReorderState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createEffectOrderState(parsedEffects, side);
  const cards = G.players[1].deck.slice(0, 3);
  G.pendingChoice = {
    id: 'qa-choice-deck-reorder',
    type: 'reorderOpponentDeckTop',
    player: 0,
    min: cards.length,
    max: cards.length,
    prompt: 'QA fixture: reorder the opposing deck top.',
    payload: { targetPlayer: 1, count: cards.length },
    options: cards.map((card) => ({
      id: card.instanceId,
      label: getCardDef(card.defId)?.name ?? card.defId,
      cardInstanceId: card.instanceId,
      cardDefId: card.defId,
    })),
  };
  return G;
}

function createStatusEffectsState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = createTurnSetState(parsedEffects, side);
  clearTransientQaOverlays(G);
  G.midnightRange = 2;
  G.modifiers.elementOverride = ['炎', '風'];
  G.modifiers.powerCostReduction = [2, 1];
  G.modifiers.cardClockSetTo = 3;
  G.modifiers.enchantEffectsDisabled = [true, false];
  G.modifiers.effectsDisabled = [false, true];
  G.modifiers.handSize = [1, -1];
  G.modifiers.extraSettableCards = [1, 2];
  G.modifiers.clockContributionDisabled = [false, true];
  G.modifiers.attackTimeOverride = ['night', 'day'];
  G.modifiers.swapAttack = [true, false];
  G.modifiers.sendToPower = [2, 3];
  return G;
}

function createGameOverState(parsedEffects: Map<string, ParsedEffect[]>, side: BattleQaSideId): GameState {
  const G = prepareEffectField(createTurnSetState(parsedEffects, side));
  G.step = 'gameOver';
  G.ready = [true, true];
  G.winner = 0;
  G.players[0].hp = 40;
  G.players[1].hp = 0;
  G.gameoverReason = 'Player 1 loses at 0 HP.';
  G.matchEndedAt = G.matchStartedAt + 95_000;
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
  G.log.push(G.gameoverReason);
  return G;
}

function createGameOverResolutionState(
  parsedEffects: Map<string, ParsedEffect[]>,
  side: BattleQaSideId,
  time: BattleQaTimeId,
): GameState {
  const G = createBattleResolutionState(parsedEffects, side, time);
  G.step = 'gameOver';
  G.ready = [true, true];
  G.winner = 0;
  G.players[1].hp = 0;
  G.gameoverReason = 'QA: final battle resolution must finish before the result screen.';
  G.matchEndedAt = G.matchStartedAt + 95_000;
  return G;
}

function createCrossTurnResolutionState(
  parsedEffects: Map<string, ParsedEffect[]>,
  side: BattleQaSideId,
  time: BattleQaTimeId,
): GameState {
  const G = createBattleResolutionState(parsedEffects, side, time);
  G.turnNumber += 1;
  G.players[0].battleZone = createInstance('1st_66', true);
  G.players[1].battleZone = createInstance('1st_67', true);
  G.lastBattleResult = { winner: 1, damage: 5, winnerAttack: 45, loserAttack: 40 };
  G.log.push('QA fixture: advanced to the next turn before the previous battle animation played.');
  return G;
}

function normalizeStateId(value: string | null): BattleQaStateId {
  return BATTLE_QA_STATES.some((state) => state.id === value) ? (value as BattleQaStateId) : 'turn-set';
}

function normalizeSideId(value: string | null): BattleQaSideId {
  return BATTLE_QA_SIDES.some((side) => side.id === value) ? (value as BattleQaSideId) : 'night';
}

function normalizeTimeId(value: string | null): BattleQaTimeId {
  return BATTLE_QA_TIMES.some((time) => time.id === value) ? (value as BattleQaTimeId) : 'auto';
}

function normalizeViewerId(value: string | null): BattleQaViewerId {
  return value === '1' || value === 'spectator' ? value : '0';
}

function applyQaChronosTime(G: GameState, time: BattleQaTimeId): void {
  if (time === 'auto') return;
  const positionByTime: Record<ChronosTime, number> = {
    night: CHRONOS_MAPPING.midnight,
    day: CHRONOS_MAPPING.noon,
  };
  G.chronos.position = positionByTime[time];
}

function createBattleQaState(id: BattleQaStateId, side: BattleQaSideId, time: BattleQaTimeId): GameState {
  const parsedEffects = createParsedEffects();
  const G =
    id === 'janken'
      ? createTutorialGame()
      : id === 'mulligan'
        ? createMulliganState(side)
        : id === 'initial-select'
          ? createInitialSetBase(side)
          : id === 'initial-set'
            ? createInitialSetState(side)
            : id === 'turn-set'
              ? createTurnSetState(parsedEffects, side)
              : id === 'clock-resolution'
                ? createClockResolutionState(parsedEffects, side)
                : id === 'chronos-effect-advance'
                  ? createChronosEffectState(parsedEffects, side, 'advance')
                  : id === 'chronos-effect-rewind'
                    ? createChronosEffectState(parsedEffects, side, 'rewind')
                    : id === 'chronos-effect-set'
                      ? createChronosEffectState(parsedEffects, side, 'set')
                      : id === 'chronos-effect-cycle'
                        ? createChronosEffectCycleState(parsedEffects, side)
                        : id === 'chronos-effect-queue'
                          ? createChronosEffectQueueState(parsedEffects, side)
                          : id === 'chronos-position-choice'
                            ? createChronosPositionChoiceState(parsedEffects, side)
                            : id === 'revealed-hand'
                              ? createRevealedHandState(parsedEffects, side)
                              : id === 'guess-declaration'
                                ? createGuessDeclarationState(parsedEffects, side)
                                : id === 'guess-position'
                                  ? createGuessPositionState(parsedEffects, side)
                                  : id === 'partial-reveal'
                                    ? createPartialRevealState(parsedEffects, side)
                                    : id === 'deck-top-reveal'
                                      ? createDeckTopRevealState(parsedEffects, side)
                                      : id === 'deck-reorder'
                                        ? createDeckReorderState(parsedEffects, side)
                                        : id === 'status-effects'
                                          ? createStatusEffectsState(parsedEffects, side)
                                          : id === 'battle-resolution'
                                            ? createBattleResolutionState(parsedEffects, side, time)
                                            : id === 'battle-modifiers'
                                              ? createBattleResolutionState(parsedEffects, side, time, 'modifiers')
                                              : id === 'battle-insufficient'
                                                ? createBattleResolutionState(parsedEffects, side, time, 'insufficient')
                                                : id === 'battle-draw'
                                                  ? createBattleResolutionState(parsedEffects, side, time, 'draw')
                                                  : id === 'battle-zero-damage'
                                                    ? createBattleResolutionState(
                                                        parsedEffects,
                                                        side,
                                                        time,
                                                        'zero-damage',
                                                      )
                                                    : id === 'battle-double-zero'
                                                      ? createBattleResolutionState(
                                                          parsedEffects,
                                                          side,
                                                          time,
                                                          'double-zero',
                                                        )
                                                      : id === 'battle-negative'
                                                        ? createBattleResolutionState(
                                                            parsedEffects,
                                                            side,
                                                            time,
                                                            'negative',
                                                          )
                                                        : id === 'effect-hp-resolution'
                                                          ? createEffectHpResolutionState(parsedEffects, side)
                                                          : id === 'resolution-timeline'
                                                            ? createResolutionTimelineState(parsedEffects, side, time)
                                                            : id === 'game-over-resolution'
                                                              ? createGameOverResolutionState(parsedEffects, side, time)
                                                              : id === 'cross-turn-resolution'
                                                                ? createCrossTurnResolutionState(
                                                                    parsedEffects,
                                                                    side,
                                                                    time,
                                                                  )
                                                                : id === 'effect-order'
                                                                  ? createEffectOrderState(parsedEffects, side)
                                                                  : id === 'pending-choice'
                                                                    ? createPendingChoiceState(parsedEffects, side)
                                                                    : createGameOverState(parsedEffects, side);
  applyQaChronosTime(G, time);
  return G;
}

const noopMoves: BoardComponentProps['moves'] = {
  janken: () => undefined,
  mulligan: () => undefined,
  keepHand: () => undefined,
  setInitialCard: () => undefined,
  setTurnCard: () => undefined,
  undoSetCard: () => undefined,
  confirmReady: () => undefined,
  timeoutSkip: () => undefined,
  timeoutAdvance: () => undefined,
  resolvePendingEffect: () => undefined,
  submitPendingChoice: () => undefined,
};

function createQaCtx(G: GameState): BoardComponentProps['ctx'] {
  return {
    numPlayers: 2,
    playOrder: ['0', '1'],
    playOrderPos: 0,
    activePlayers: { '0': 'simultaneous', '1': 'simultaneous' },
    currentPlayer: '0',
    turn: G.turnNumber,
    phase: 'default',
    gameover: G.step === 'gameOver' ? (G.winner === null ? { draw: true } : { winner: String(G.winner) }) : undefined,
  } as BoardComponentProps['ctx'];
}

function QaControls({
  selectedState,
  selectedSide,
  selectedTime,
}: {
  selectedState: BattleQaStateId;
  selectedSide: BattleQaSideId;
  selectedTime: BattleQaTimeId;
}) {
  return (
    <aside className="fixed bottom-3 left-3 z-[var(--z-modal)] max-w-[calc(100vw-1.5rem)] rounded-sm border border-content-primary/10 bg-surface-canvas/90 p-2 font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-primary/55 shadow-raised backdrop-blur">
      <div className="mb-1 text-accent-primary/70">Battle QA</div>
      <div className="flex flex-wrap gap-1">
        {BATTLE_QA_STATES.map((state) => (
          <Link
            key={state.id}
            className={`rounded-xs px-2 py-1 transition ${
              selectedState === state.id
                ? 'bg-accent-primary text-surface-base'
                : 'bg-content-primary/5 text-content-primary/55 hover:text-content-primary'
            }`}
            to={`/qa/battle?state=${state.id}&side=${selectedSide}&time=${selectedTime}`}
          >
            {state.label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {BATTLE_QA_SIDES.map((side) => (
          <Link
            key={side.id}
            className={`rounded-xs px-2 py-1 transition ${
              selectedSide === side.id
                ? 'bg-accent-action text-surface-base'
                : 'bg-content-primary/5 text-content-primary/55 hover:text-content-primary'
            }`}
            to={`/qa/battle?state=${selectedState}&side=${side.id}&time=${selectedTime}`}
          >
            {side.label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {BATTLE_QA_TIMES.map((time) => (
          <Link
            key={time.id}
            className={`rounded-xs px-2 py-1 transition ${
              selectedTime === time.id
                ? 'bg-content-primary text-surface-base'
                : 'bg-content-primary/5 text-content-primary/55 hover:text-content-primary'
            }`}
            to={`/qa/battle?state=${selectedState}&side=${selectedSide}&time=${time.id}`}
          >
            {time.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}

export function BattleVisualQaPage() {
  const [searchParams] = useSearchParams();
  const selectedState = normalizeStateId(searchParams.get('state'));
  const selectedSide = normalizeSideId(searchParams.get('side'));
  const selectedTime = normalizeTimeId(searchParams.get('time'));
  const selectedViewer = normalizeViewerId(searchParams.get('viewer'));
  const showControls = searchParams.get('controls') !== '0';
  const [qaRevision, setQaRevision] = useState(0);

  const fixture = useMemo(() => {
    try {
      ensureBattleQaCards();
      return { G: createBattleQaState(selectedState, selectedSide, selectedTime), error: null };
    } catch (error) {
      return { G: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [selectedState, selectedSide, selectedTime]);

  const playerID = selectedViewer === 'spectator' ? null : selectedViewer;
  const boardG = fixture.G
    ? ((ZutomayoCard.playerView?.({ G: fixture.G, playerID } as never) as GameState | undefined) ?? fixture.G)
    : null;
  const qaMoves = useMemo<BoardComponentProps['moves']>(
    () => ({
      ...noopMoves,
      submitPendingChoice: (optionIds: string[]) => {
        if (!fixture.G || playerID === null) return;
        if (submitPendingChoice(fixture.G, Number(playerID) as PlayerIndex, optionIds, createParsedEffects())) {
          setQaRevision((revision) => revision + 1);
        }
      },
    }),
    [fixture.G, playerID],
  );

  useEffect(() => {
    document.documentElement.dataset.battleQaState = fixture.G ? selectedState : '';
    document.documentElement.dataset.battleQaSide = fixture.G ? selectedSide : '';
    document.documentElement.dataset.battleQaTime = fixture.G ? selectedTime : '';
    return () => {
      delete document.documentElement.dataset.battleQaState;
      delete document.documentElement.dataset.battleQaSide;
      delete document.documentElement.dataset.battleQaTime;
    };
  }, [fixture.G, selectedState, selectedSide, selectedTime]);

  if (fixture.error) {
    return (
      <main className="grid h-full w-full place-items-center bg-surface-canvas px-6 text-center text-content-primary">
        <section className="max-w-xl rounded-sm border border-accent-action/30 bg-surface-base p-5 shadow-raised">
          <div className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-action">
            Battle QA
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold">Fixture Error</h1>
          <p className="mt-3 text-sm leading-relaxed text-content-primary/60">{fixture.error}</p>
        </section>
      </main>
    );
  }

  if (!fixture.G || !boardG) return null;

  return (
    <main
      className="relative h-full min-h-0 w-full overflow-hidden bg-surface-canvas"
      data-battle-qa-state={selectedState}
      data-battle-qa-side={selectedSide}
      data-battle-qa-time={selectedTime}
    >
      <Board
        key={`${selectedState}-${selectedSide}-${selectedTime}-${selectedViewer}-${qaRevision}`}
        G={boardG}
        ctx={createQaCtx(boardG)}
        moves={qaMoves}
        events={{} as BoardComponentProps['events']}
        plugins={{}}
        _undo={[]}
        _redo={[]}
        _stateID={0}
        log={[]}
        reset={() => undefined}
        undo={() => undefined}
        redo={() => undefined}
        matchData={undefined}
        sendChatMessage={() => undefined}
        chatMessages={[]}
        playerID={playerID}
        matchID={`qa-${selectedState}-${selectedSide}-${selectedTime}`}
        isActive={playerID !== null}
        isConnected
        isMultiplayer={false}
        spectator={playerID === null}
        useServerTimer
        gameOverActions={
          selectedState === 'game-over' || selectedState === 'game-over-resolution'
            ? {
                primary: { label: t('board.playAgain'), onClick: () => undefined },
                secondary: {
                  label: t('board.result.changeSetup'),
                  onClick: () => undefined,
                  variant: 'secondary',
                },
                tertiary: { label: t('common.backToLobby'), onClick: () => undefined, variant: 'secondary' },
              }
            : undefined
        }
      />
      {showControls && (
        <QaControls selectedState={selectedState} selectedSide={selectedSide} selectedTime={selectedTime} />
      )}
    </main>
  );
}
