import { beforeEach, describe, expect, it } from 'vitest';
import { executeEffect } from '../executor';
import { initCards, createInstance, resetInstanceCounter } from '../../cards/loader';
import { emptyModifiers } from '../../GameLogic';
import type { CardDef, CardType, GameState, PlayerIndex } from '../../types';
import type { ParsedEffect, EffectAction } from '../types';

// ===== Test card definitions =====

function makeCard(id: string, overrides: Partial<CardDef> & { type?: CardType } = {}): CardDef {
  const type = overrides.type ?? 'Character';
  return {
    id,
    name: id,
    pack: 'test',
    song: 'test-song',
    illustrator: 'test',
    rarity: 'N',
    element: '炎',
    type,
    clock: 1,
    attack: type === 'Character' ? { night: 20, day: 30 } : null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
    ...overrides,
  };
}

const TEST_CARDS: CardDef[] = [
  makeCard('char-basic', { element: '炎', attack: { night: 20, day: 30 }, powerCost: 2, clock: 1 }),
  makeCard('char-dark', { element: '闇', attack: { night: 40, day: 10 }, powerCost: 3, clock: 2 }),
  makeCard('char-wind', { element: '風', attack: { night: 15, day: 25 }, powerCost: 1, clock: 1 }),
  makeCard('char-power', { element: '炎', attack: { night: 30, day: 30 }, powerCost: 4, clock: 1, sendToPower: 2 }),
  makeCard('char-zero-cost', { element: '炎', attack: { night: 10, day: 10 }, powerCost: 0, clock: 0 }),
  makeCard('enchant-fire', { type: 'Enchant', element: '炎', powerCost: 1, sendToPower: 1 }),
  makeCard('enchant-wind', { type: 'Enchant', element: '風', powerCost: 1, sendToPower: 1 }),
  makeCard('area-enchant-1', { type: 'Area Enchant', element: '風', powerCost: 1, sendToPower: 0 }),
  makeCard('area-enchant-2', { type: 'Area Enchant', element: '炎', powerCost: 1, sendToPower: 0 }),
];

if (TEST_CARDS.length > 0) {
  initCards(TEST_CARDS);
}

// ===== GameState helpers =====

function makePlayer() {
  return {
    hp: 100,
    deck: [],
    hand: [],
    battleZone: null as GameState['players'][number]['battleZone'],
    setZoneA: null as GameState['players'][number]['setZoneA'],
    setZoneB: null as GameState['players'][number]['setZoneB'],
    setZoneC: null as GameState['players'][number]['setZoneC'],
    powerCharger: [],
    abyss: [],
    cardsSetThisTurn: 0,
    rawAttack: 0,
  };
}

function makeG(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [makePlayer(), makePlayer()],
    step: 'turnSet',
    ready: [false, false],
    chronos: { position: 0, nightSidePlayer: 0 },
    midnightRange: 0,
    chronosAtTurnStart: 0,
    turnNumber: 2,
    turnStartTime: Date.now(),
    lastBattleResult: { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 },
    setCardsThisTurn: [[], []],
    pendingEffects: [[], []],
    pendingEffectPlayer: null,
    delayedEffects: [],
    pendingChoice: null,
    lastChoiceSelectionCount: [null, null],
    timingEvents: [],
    revealedHandCardIds: [[], []],
    swappedCardsThisTurn: [[], []],
    suppressedEffectCardIdsThisTurn: [],
    drawEffectCardIdsThisTurn: [],
    drawOccurredThisEffect: [false, false],
    previousTurnCharacterElements: [null, null],
    handSizeModifier: [0, 0],
    areaEnchantSetLocked: [false, false],
    damageReducedThisTurn: [0, 0],
    jankenChoices: [null, null],
    jankenDrawCount: 0,
    mulliganUsed: [false, false],
    modifiers: emptyModifiers(),
    winner: null,
    gameoverReason: null,
    log: [],
    actionLog: [],
    recentHpChanges: [],
    recentGameNotices: [],
    ...overrides,
  };
}

function makeEffect(
  actionType: EffectAction['type'],
  params: Record<string, unknown> = {},
  extra: Partial<ParsedEffect> = {},
): ParsedEffect {
  return {
    trigger: 'onUse',
    conditions: [],
    action: { type: actionType, params: params as never } as EffectAction,
    rawText: 'test effect',
    ...extra,
  };
}

function runEffect(
  effect: ParsedEffect,
  G: GameState,
  player: PlayerIndex = 0,
  context: { cardInstanceId?: string; cardDefId?: string } = {},
) {
  return executeEffect(effect, G, player, context);
}

function cardInstance(defId: string, faceUp = false) {
  return createInstance(defId, faceUp);
}

// ===== Tests =====

describe('effect executor', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('boostAttack', () => {
    it('增加自己攻擊力修飾器', () => {
      const G = makeG();
      G.players[0].battleZone = cardInstance('char-basic');
      G.players[0].powerCharger = [cardInstance('char-power')]; // sendToPower 2 >= powerCost 2
      const result = runEffect(makeEffect('boostAttack', { value: 10 }), G);
      expect(result.success).toBe(true);
      // base attack (day 30) + boost 10 = 40, modifier = 40 - 30 = 10
      expect(G.modifiers.attack[0]).toBe(10);
    });

    it('battleZone power cost 不足時跳過（不設定修飾器）', () => {
      const G = makeG();
      G.players[0].battleZone = cardInstance('char-power'); // powerCost 4
      G.players[0].powerCharger = []; // power 0 < 4
      const result = runEffect(makeEffect('boostAttack', { value: 10 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.attack[0]).toBe(0);
    });

    it('per zoneElementCount 乘以深淵元素數量', () => {
      const G = makeG();
      G.players[0].battleZone = cardInstance('char-basic');
      G.players[0].powerCharger = [cardInstance('char-power')];
      G.players[0].abyss = [cardInstance('enchant-fire'), cardInstance('enchant-fire')];
      const result = runEffect(
        makeEffect('boostAttack', { value: 10, per: 'zoneElementCount', zone: 'abyss', element: '炎' }),
        G,
      );
      expect(result.success).toBe(true);
      // 10 * 2 = 20
      expect(G.modifiers.attack[0]).toBe(20);
    });
  });

  describe('boostBothAttackByOwnHp', () => {
    it('雙方攻擊力各增加自身 HP', () => {
      const G = makeG();
      G.players[0].battleZone = cardInstance('char-basic');
      G.players[0].powerCharger = [cardInstance('char-power')];
      G.players[1].battleZone = cardInstance('char-basic');
      G.players[1].powerCharger = [cardInstance('char-power')];
      G.players[0].hp = 80;
      G.players[1].hp = 50;
      const result = runEffect(makeEffect('boostBothAttackByOwnHp'), G);
      expect(result.success).toBe(true);
      // p0: base 30 + 80 = 110, modifier = 80
      expect(G.modifiers.attack[0]).toBe(80);
      // p1: base 30 + 50 = 80, modifier = 50
      expect(G.modifiers.attack[1]).toBe(50);
    });
  });

  describe('boostPower', () => {
    it('增加 sendToPower 修飾器', () => {
      const G = makeG();
      const result = runEffect(makeEffect('boostPower', { value: 5 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.sendToPower![0]).toBe(5);
    });

    it('per zoneElementCount 乘以元素數量', () => {
      const G = makeG();
      G.players[0].abyss = [cardInstance('enchant-fire'), cardInstance('enchant-fire')];
      const result = runEffect(
        makeEffect('boostPower', { value: 3, per: 'zoneElementCount', zone: 'abyss', element: '炎' }),
        G,
      );
      expect(result.success).toBe(true);
      expect(G.modifiers.sendToPower![0]).toBe(6);
    });
  });

  describe('reduceAttack', () => {
    it('減少對手攻擊力', () => {
      const G = makeG();
      G.players[1].battleZone = cardInstance('char-basic');
      G.players[1].powerCharger = [cardInstance('char-power')];
      const result = runEffect(makeEffect('reduceAttack', { value: 10 }), G);
      expect(result.success).toBe(true);
      // base 30 - 10 = 20, modifier = -10
      expect(G.modifiers.attack[1]).toBe(-10);
    });

    it('對手 power cost 不足時跳過', () => {
      const G = makeG();
      G.players[1].battleZone = cardInstance('char-power'); // powerCost 4
      G.players[1].powerCharger = [];
      const result = runEffect(makeEffect('reduceAttack', { value: 10 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.attack[1]).toBe(0);
    });
  });

  describe('setOpponentAttack', () => {
    it('設定對手攻擊力並重置累積修飾器', () => {
      const G = makeG();
      G.modifiers.attack[1] = 15;
      const result = runEffect(makeEffect('setOpponentAttack', { value: 50 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.attackSetTo![1]).toBe(50);
      expect(G.modifiers.attack[1]).toBe(0);
    });
  });

  describe('setOpponentElement', () => {
    it('設定對手元素為闇', () => {
      const G = makeG();
      const result = runEffect(makeEffect('setOpponentElement', { value: '闇' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.elementOverride![1]).toBe('闇');
    });

    it('不支援的元素回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('setOpponentElement', { value: '光' }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('heal', () => {
    it('回復自己 HP', () => {
      const G = makeG();
      G.players[0].hp = 50;
      const result = runEffect(makeEffect('heal', { value: 20 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hp).toBe(70);
    });

    it('回復不超過 100', () => {
      const G = makeG();
      G.players[0].hp = 95;
      const result = runEffect(makeEffect('heal', { value: 20 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hp).toBe(100);
    });

    it('target opponent 回復對手', () => {
      const G = makeG();
      G.players[1].hp = 50;
      const result = runEffect(makeEffect('heal', { value: 20, target: 'opponent' }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].hp).toBe(70);
    });
  });

  describe('healOpponent', () => {
    it('回復對手 HP', () => {
      const G = makeG();
      G.players[1].hp = 50;
      const result = runEffect(makeEffect('healOpponent', { value: 30 }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].hp).toBe(80);
    });
  });

  describe('healBoth', () => {
    it('回復雙方 HP', () => {
      const G = makeG();
      G.players[0].hp = 40;
      G.players[1].hp = 60;
      const result = runEffect(makeEffect('healBoth', { value: 15 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hp).toBe(55);
      expect(G.players[1].hp).toBe(75);
    });
  });

  describe('directDamage', () => {
    it('對對手造成傷害', () => {
      const G = makeG();
      G.players[1].hp = 80;
      const result = runEffect(makeEffect('directDamage', { value: 25 }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].hp).toBe(55);
    });

    it('HP 歸零時觸發 gameOver', () => {
      const G = makeG();
      G.players[1].hp = 10;
      const result = runEffect(makeEffect('directDamage', { value: 25 }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].hp).toBe(0);
      expect(G.step).toBe('gameOver');
      expect(G.winner).toBe(0);
    });

    it('value=-1 設定不可減傷', () => {
      const G = makeG();
      const result = runEffect(makeEffect('directDamage', { value: -1 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.unreduceableDamage[0]).toBe(true);
    });

    it('timing=turnEnd 排入延遲效果', () => {
      const G = makeG();
      const result = runEffect(makeEffect('directDamage', { value: 15, timing: 'turnEnd' }), G);
      expect(result.success).toBe(true);
      expect(G.delayedEffects!.length).toBe(1);
      expect(G.delayedEffects![0].effect.trigger).toBe('onTurnEnd');
    });

    it('reducedThisTurn 使用當回合已減傷量', () => {
      const G = makeG();
      G.players[1].hp = 80;
      G.damageReducedThisTurn = [10, 0]; // player 0 的已減傷量
      const result = runEffect(makeEffect('directDamage', { value: 'reducedThisTurn' }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].hp).toBe(70);
    });
  });

  describe('damageReduce', () => {
    it('增加減傷修飾器', () => {
      const G = makeG();
      const result = runEffect(makeEffect('damageReduce', { value: 15 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.damageReduction[0]).toBe(15);
    });
  });

  describe('drawCards', () => {
    it('從牌組抽牌到手牌', () => {
      const G = makeG();
      G.players[0].deck = [cardInstance('char-basic'), cardInstance('char-dark')];
      const result = runEffect(makeEffect('drawCards', { value: 2 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hand.length).toBe(2);
      expect(G.players[0].deck.length).toBe(0);
      expect(G.drawOccurredThisEffect[0]).toBe(true);
    });

    it('牌組不足時觸發敗北', () => {
      const G = makeG();
      G.players[0].deck = [cardInstance('char-basic')];
      const result = runEffect(makeEffect('drawCards', { value: 3 }), G);
      expect(result.success).toBe(false);
      expect(G.step).toBe('gameOver');
      expect(G.winner).toBe(1);
    });

    it('記錄 cardInstanceId 到 drawEffectCardIdsThisTurn', () => {
      const G = makeG();
      G.players[0].deck = [cardInstance('char-basic')];
      const result = runEffect(makeEffect('drawCards', { value: 1 }), G, 0, { cardInstanceId: 'inst-test-1' });
      expect(result.success).toBe(true);
      expect(G.drawEffectCardIdsThisTurn).toContain('inst-test-1');
    });
  });

  describe('swapAttack', () => {
    it('切換自己晝夜攻擊力', () => {
      const G = makeG();
      const result = runEffect(makeEffect('swapAttack', { target: 'self' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.swapAttack[0]).toBe(true);
    });

    it('切換對手晝夜攻擊力', () => {
      const G = makeG();
      const result = runEffect(makeEffect('swapAttack', { target: 'opponent' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.swapAttack[1]).toBe(true);
    });
  });

  describe('forceOwnAttackTime', () => {
    it('設定攻擊時段為 night', () => {
      const G = makeG();
      const result = runEffect(makeEffect('forceOwnAttackTime', { value: 'night' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.attackTimeOverride![0]).toBe('night');
    });

    it('不支援的時段回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('forceOwnAttackTime', { value: 'dawn' }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('clockReset', () => {
    it('重置 chronos 到回合開始位置', () => {
      const G = makeG({ chronosAtTurnStart: 5 });
      G.chronos.position = 8;
      const result = runEffect(makeEffect('clockReset'), G);
      expect(result.success).toBe(true);
      expect(G.chronos.position).toBe(5);
    });
  });

  describe('nullifyOpponentClock', () => {
    it('禁用對手角色時鐘貢獻', () => {
      const G = makeG();
      const result = runEffect(makeEffect('nullifyOpponentClock'), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.clockContributionDisabled![1]).toBe(true);
    });
  });

  describe('clockRewindOpponentCharacter', () => {
    it('回退對手當回合角色時鐘總和', () => {
      const G = makeG();
      G.chronos.position = 5;
      G.setCardsThisTurn[1] = [cardInstance('char-basic'), cardInstance('char-dark')];
      // clock 1 + 2 = 3
      const result = runEffect(makeEffect('clockRewindOpponentCharacter'), G);
      expect(result.success).toBe(true);
      // 5 - 3 = 2
      expect(G.chronos.position).toBe(2);
    });
  });

  describe('clockSet', () => {
    it('設定 chronos 到指定位置', () => {
      const G = makeG();
      const result = runEffect(makeEffect('clockSet', { value: 7 }), G);
      expect(result.success).toBe(true);
      expect(G.chronos.position).toBe(7);
    });

    it('value=any 建立位置選擇 pendingChoice', () => {
      const G = makeG();
      const result = runEffect(makeEffect('clockSet', { value: 'any' }), G);
      expect(result.success).toBe(true);
      expect(G.pendingChoice).not.toBeNull();
      expect(G.pendingChoice!.type).toBe('clockPosition');
      expect(G.pendingChoice!.options.length).toBe(18);
    });
  });

  describe('expandMidnightRange', () => {
    it('擴展午夜範圍', () => {
      const G = makeG({ midnightRange: 0 });
      const result = runEffect(makeEffect('expandMidnightRange', { range: 2 }), G);
      expect(result.success).toBe(true);
      expect(G.midnightRange).toBe(2);
    });

    it('不小於現有範圍', () => {
      const G = makeG({ midnightRange: 3 });
      const result = runEffect(makeEffect('expandMidnightRange', { range: 1 }), G);
      expect(result.success).toBe(true);
      expect(G.midnightRange).toBe(3);
    });
  });

  describe('clockSetFromTurnStartMinusOpponentClock', () => {
    it('從回合開始減去對手角色時鐘', () => {
      const G = makeG({ chronosAtTurnStart: 6 });
      G.players[1].battleZone = cardInstance('char-dark'); // clock 2
      const result = runEffect(makeEffect('clockSetFromTurnStartMinusOpponentClock'), G);
      expect(result.success).toBe(true);
      expect(G.chronos.position).toBe(4);
    });

    it('對手無角色時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('clockSetFromTurnStartMinusOpponentClock'), G);
      expect(result.success).toBe(false);
    });
  });

  describe('setAllCardClocks', () => {
    it('設定所有卡牌時鐘為指定值', () => {
      const G = makeG();
      const result = runEffect(makeEffect('setAllCardClocks', { value: 3 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.cardClockSetTo).toBe(3);
    });
  });

  describe('clockAdvance', () => {
    it('推進 chronos 位置', () => {
      const G = makeG();
      G.chronos.position = 3;
      const result = runEffect(makeEffect('clockAdvance', { value: 5 }), G);
      expect(result.success).toBe(true);
      expect(G.chronos.position).toBe(8);
    });

    it('繞回正規化', () => {
      const G = makeG();
      G.chronos.position = 16;
      const result = runEffect(makeEffect('clockAdvance', { value: 5 }), G);
      expect(result.success).toBe(true);
      expect(G.chronos.position).toBe(3);
    });
  });

  describe('recoverFromAbyss', () => {
    it('從深淵回復卡牌到手牌', () => {
      const G = makeG();
      G.players[0].abyss = [cardInstance('enchant-fire'), cardInstance('enchant-wind')];
      const result = runEffect(makeEffect('recoverFromAbyss', { max: 1 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hand.length).toBe(1);
      expect(G.players[0].abyss.length).toBe(1);
    });

    it('深淵無卡時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('recoverFromAbyss', { max: 1 }), G);
      expect(result.success).toBe(false);
    });

    it('依 cardType 過濾', () => {
      const G = makeG();
      G.players[0].abyss = [cardInstance('enchant-fire'), cardInstance('char-basic')];
      const result = runEffect(makeEffect('recoverFromAbyss', { max: 1, cardType: 'Character' }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].hand[0].defId).toBe('char-basic');
    });
  });

  describe('sendToAbyss', () => {
    it('將對手戰鬥區角色送入深淵', () => {
      const G = makeG();
      G.players[1].battleZone = cardInstance('char-basic');
      const result = runEffect(makeEffect('sendToAbyss'), G);
      expect(result.success).toBe(true);
      expect(G.players[1].battleZone).toBeNull();
      expect(G.players[1].abyss.length).toBe(1);
    });

    it('對手無角色時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('sendToAbyss'), G);
      expect(result.success).toBe(false);
    });
  });

  describe('millDeckToAbyss', () => {
    it('將對手牌庫頂卡送入深淵', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-basic'), cardInstance('char-dark'), cardInstance('char-wind')];
      const result = runEffect(makeEffect('millDeckToAbyss', { count: 2 }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].abyss.length).toBe(2);
      expect(G.players[1].deck.length).toBe(1);
    });

    it('countFromLastChoice 使用上次選擇數量', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-basic'), cardInstance('char-dark')];
      G.lastChoiceSelectionCount[0] = 2;
      const result = runEffect(makeEffect('millDeckToAbyss', { countFromLastChoice: true }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].abyss.length).toBe(2);
      expect(G.lastChoiceSelectionCount[0]).toBeNull();
    });

    it('countFromLastChoice 無選擇數量時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('millDeckToAbyss', { countFromLastChoice: true }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('moveOwnDeckTopByPower', () => {
    it('sendToPower>0 的卡進 powerCharger', () => {
      const G = makeG();
      G.players[0].deck = [cardInstance('char-power')]; // sendToPower 2
      const result = runEffect(makeEffect('moveOwnDeckTopByPower'), G);
      expect(result.success).toBe(true);
      expect(G.players[0].powerCharger.length).toBe(1);
    });

    it('sendToPower=0 的卡進 abyss', () => {
      const G = makeG();
      G.players[0].deck = [cardInstance('char-basic')]; // sendToPower 0
      const result = runEffect(makeEffect('moveOwnDeckTopByPower'), G);
      expect(result.success).toBe(true);
      expect(G.players[0].abyss.length).toBe(1);
    });

    it('牌庫為空時觸發敗北', () => {
      const G = makeG();
      const result = runEffect(makeEffect('moveOwnDeckTopByPower'), G);
      expect(result.success).toBe(false);
      expect(G.step).toBe('gameOver');
    });
  });

  describe('moveOpponentDeckTopByPowerCost', () => {
    it('powerCost>=min 時移動自身 Area Enchant 到 powerCharger', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-power')]; // powerCost 4
      G.players[0].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('moveOpponentDeckTopByPowerCost', { minPowerCost: 3 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].setZoneC).toBeNull();
      expect(G.players[0].powerCharger.length).toBe(1);
    });

    it('powerCost<min 時僅公開牌頂', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-basic')]; // powerCost 2
      const result = runEffect(makeEffect('moveOpponentDeckTopByPowerCost', { minPowerCost: 3 }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].deck[0].faceUp).toBe(true);
    });

    it('對手牌庫為空時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('moveOpponentDeckTopByPowerCost', { minPowerCost: 3 }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('revealOpponentDeckTopBySendToPower', () => {
    it('sendToPower>=min 時移動自身 AE 到 powerCharger', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-power')]; // sendToPower 2
      G.players[0].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('revealOpponentDeckTopBySendToPower', { minSendToPower: 1 }), G);
      expect(result.success).toBe(true);
      expect(G.players[0].powerCharger.length).toBe(1);
    });

    it('不符合條件時給予攻擊力加成', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-basic')]; // sendToPower 0
      const result = runEffect(
        makeEffect('revealOpponentDeckTopBySendToPower', { minSendToPower: 1, boostIfMissing: 10 }),
        G,
      );
      expect(result.success).toBe(true);
      expect(G.modifiers.attack[0]).toBe(10);
    });
  });

  describe('revealOpponentHand', () => {
    it('公開對手手牌', () => {
      const G = makeG();
      G.players[1].hand = [cardInstance('char-basic'), cardInstance('char-dark')];
      const result = runEffect(makeEffect('revealOpponentHand'), G);
      expect(result.success).toBe(true);
      expect(G.revealedHandCardIds[1].length).toBe(2);
    });
  });

  describe('returnAreaEnchantToDeck', () => {
    it('將對手 Area Enchant 放回牌庫底', () => {
      const G = makeG();
      G.players[1].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('returnAreaEnchantToDeck', { position: 'bottom' }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].setZoneC).toBeNull();
      expect(G.players[1].deck.length).toBe(1);
    });

    it('position=top 放回牌庫頂', () => {
      const G = makeG();
      G.players[1].deck = [cardInstance('char-basic')];
      G.players[1].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('returnAreaEnchantToDeck', { position: 'top' }), G);
      expect(result.success).toBe(true);
      expect(G.players[1].deck[0].defId).toBe('area-enchant-1');
    });

    it('lockAreaEnchant 鎖定對手 AE 設定', () => {
      const G = makeG();
      G.players[1].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('returnAreaEnchantToDeck', { position: 'bottom', lockAreaEnchant: true }), G);
      expect(result.success).toBe(true);
      expect(G.areaEnchantSetLocked![1]).toBe(true);
    });

    it('對手無 AE 時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('returnAreaEnchantToDeck', { position: 'bottom' }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('moveSelfAreaEnchant', () => {
    it('移動自身 AE 到 powerCharger', () => {
      const G = makeG();
      G.players[0].setZoneC = cardInstance('area-enchant-1');
      const result = runEffect(makeEffect('moveSelfAreaEnchant', { destination: 'powerCharger' }), G, 0, {
        cardInstanceId: 'inst-test',
      });
      expect(result.success).toBe(true);
      expect(G.players[0].setZoneC).toBeNull();
      expect(G.players[0].powerCharger.length).toBe(1);
    });

    it('移動後 suppress 同卡後續效果', () => {
      const G = makeG();
      G.players[0].setZoneC = cardInstance('area-enchant-1');
      G.pendingEffects = [
        [
          {
            id: 'p1',
            player: 0,
            cardInstanceId: 'inst-test',
            cardDefId: 'area-enchant-1',
            rawText: '',
            effect: makeEffect('moveSelfAreaEnchant', { destination: 'abyss' }),
            source: 'setZoneC',
          },
        ],
        [],
      ];
      const result = runEffect(makeEffect('moveSelfAreaEnchant', { destination: 'abyss' }), G, 0, {
        cardInstanceId: 'inst-test',
      });
      expect(result.success).toBe(true);
      expect(G.suppressedEffectCardIdsThisTurn).toContain('inst-test');
      expect(G.pendingEffects[0]).toHaveLength(0);
    });

    it('無自身 AE 時回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('moveSelfAreaEnchant', { destination: 'abyss' }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('useFromAbyss', () => {
    it('從深淵建立 useFromAbyss pendingChoice', () => {
      const G = makeG();
      G.players[0].abyss = [cardInstance('enchant-fire'), cardInstance('enchant-wind')];
      const result = runEffect(makeEffect('useFromAbyss', { source: 'abyss' }), G);
      expect(result.success).toBe(true);
      expect(G.pendingChoice).not.toBeNull();
      expect(G.pendingChoice!.type).toBe('useFromAbyss');
      expect(G.pendingChoice!.options.length).toBe(2);
    });

    it('深淵無附魔卡時回傳失敗', () => {
      const G = makeG();
      G.players[0].abyss = [cardInstance('char-basic')]; // 非 Enchant
      const result = runEffect(makeEffect('useFromAbyss', { source: 'abyss' }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('handSizeModifier', () => {
    it('duration=game 設定永久手牌修飾器', () => {
      const G = makeG();
      const result = runEffect(makeEffect('handSizeModifier', { value: 1, duration: 'game' }), G);
      expect(result.success).toBe(true);
      expect(G.handSizeModifier[0]).toBe(1);
    });

    it('duration=battle 設定戰鬥手牌修飾器', () => {
      const G = makeG();
      const result = runEffect(makeEffect('handSizeModifier', { value: 2, duration: 'battle' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.handSize![0]).toBe(2);
    });
  });

  describe('setPowerCost', () => {
    it('增加角色 power cost 減免', () => {
      const G = makeG();
      const result = runEffect(makeEffect('setPowerCost', { reduction: 2 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.powerCostReduction![0]).toBe(2);
    });
  });

  describe('requestChoice', () => {
    it('依 params 建立 pendingChoice', () => {
      const G = makeG();
      G.players[0].hand = [cardInstance('char-basic'), cardInstance('char-dark')];
      const result = runEffect(
        makeEffect('requestChoice', { choiceType: 'handToDeckBottomThenDraw', drawCount: 1 }),
        G,
      );
      // requestChoice 會建立 pendingChoice 或依條件失敗
      expect(result.success).toBe(true);
      expect(G.pendingChoice).not.toBeNull();
    });
  });

  describe('suppressEffectActivation', () => {
    it('回傳成功（no-op 標記）', () => {
      const G = makeG();
      const result = runEffect(makeEffect('suppressEffectActivation'), G);
      expect(result.success).toBe(true);
    });
  });

  describe('noEffect', () => {
    it('scope=enchantOnly 禁用對手附魔效果', () => {
      const G = makeG();
      const result = runEffect(makeEffect('noEffect', { scope: 'enchantOnly' }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.enchantEffectsDisabled![1]).toBe(true);
    });

    it('預設禁用對手所有效果', () => {
      const G = makeG();
      const result = runEffect(makeEffect('noEffect'), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.effectsDisabled[1]).toBe(true);
    });
  });

  describe('addSettableCard', () => {
    it('增加可設定卡牌數量', () => {
      const G = makeG();
      const result = runEffect(makeEffect('addSettableCard', { count: 1 }), G);
      expect(result.success).toBe(true);
      expect(G.modifiers.extraSettableCards![0]).toBe(1);
    });

    it('無效 count 回傳失敗', () => {
      const G = makeG();
      const result = runEffect(makeEffect('addSettableCard', { count: -1 }), G);
      expect(result.success).toBe(false);
    });
  });

  describe('條件評估', () => {
    it('條件不滿足時效果不執行', () => {
      const G = makeG();
      G.players[0].hp = 80;
      const effect = makeEffect(
        'heal',
        { value: 10 },
        {
          conditions: [{ type: 'hpLessOrEqual', value: 50 }],
        },
      );
      const result = runEffect(effect, G);
      expect(result.success).toBe(false);
      expect(G.players[0].hp).toBe(80);
    });

    it('and 複合條件全部滿足時執行', () => {
      const G = makeG();
      G.players[0].hp = 40;
      G.chronos.position = 0; // midnight = night
      const effect = makeEffect(
        'heal',
        { value: 10 },
        {
          conditions: [
            {
              type: 'and',
              value: [
                { type: 'hpLessOrEqual', value: 50 },
                { type: 'chronos', value: 'night' },
              ],
            },
          ],
        },
      );
      const result = runEffect(effect, G);
      expect(result.success).toBe(true);
      expect(G.players[0].hp).toBe(50);
    });

    it('or 複合條件部分滿足時執行', () => {
      const G = makeG();
      G.players[0].hp = 80;
      G.chronos.position = 0;
      const effect = makeEffect(
        'heal',
        { value: 10 },
        {
          conditions: [
            {
              type: 'or',
              value: [
                { type: 'hpLessOrEqual', value: 50 },
                { type: 'chronos', value: 'night' },
              ],
            },
          ],
        },
      );
      const result = runEffect(effect, G);
      expect(result.success).toBe(true);
    });
  });
});
