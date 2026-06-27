import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getAllCardDefs } from '../cards/loader';
import { parseAllEffects, parseEffect } from '../effects/parser';
import type { ParsedEffect, EffectTrigger, ActionType } from '../effects';
import {
  setupGame,
  resolveJanken,
  finishMulligan,
  setInitialCard,
  setTurnCard,
  undoSetCard,
  confirmReady,
  resolvePendingEffect,
  submitPendingChoice,
} from '../GameLogic';
import type { GameState, JankenChoice, PlayerIndex, SetSlot } from '../types';

// 預先解析所有卡牌效果，供遊戲流程使用
const parsedEffects = parseAllEffects(
  getAllCardDefs().map(card => ({ id: card.id, effect: card.effect })),
);

const INITIAL_TOTAL_CARDS = 40; // 每位玩家 20 張牌（15 deck + 5 hand）× 2

function playerCardCount(player: GameState['players'][number]): number {
  let count = player.deck.length + player.hand.length + player.powerCharger.length + player.abyss.length;
  if (player.battleZone) count++;
  if (player.setZoneA) count++;
  if (player.setZoneB) count++;
  if (player.setZoneC) count++;
  return count;
}

function totalCards(G: GameState): number {
  return playerCardCount(G.players[0]) + playerCardCount(G.players[1]);
}

const VALID_TRIGGERS: EffectTrigger[] = [
  'onBattle', 'onUse', 'onEnter', 'onLeave',
  'onTurnStart', 'onTurnEnd', 'onDamageReceived',
  'onChronosChanged', 'onZoneEntered',
];

const VALID_ACTIONS: ActionType[] = [
  'boostAttack', 'boostBothAttackByOwnHp', 'boostPower', 'reduceAttack',
  'setOpponentAttack', 'setOpponentElement', 'directDamage', 'heal',
  'healOpponent', 'healBoth', 'damageReduce', 'drawCards', 'swapAttack',
  'forceOwnAttackTime', 'clockReset', 'nullifyOpponentClock',
  'clockRewindOpponentCharacter', 'clockSet', 'expandMidnightRange',
  'clockSetFromTurnStartMinusOpponentClock', 'setAllCardClocks', 'clockAdvance',
  'recoverFromAbyss', 'sendToAbyss', 'millDeckToAbyss', 'moveOwnDeckTopByPower',
  'moveOpponentDeckTopByPowerCost', 'revealOpponentDeckTopBySendToPower',
  'revealOpponentHand', 'returnAreaEnchantToDeck', 'moveSelfAreaEnchant',
  'useFromAbyss', 'handSizeModifier', 'setPowerCost', 'requestChoice',
  'suppressEffectActivation', 'noEffect', 'addSettableCard',
];

function isValidParsedEffect(parsed: unknown): parsed is ParsedEffect {
  if (parsed === null) return true;
  if (typeof parsed !== 'object' || parsed === null) return false;
  const e = parsed as Record<string, unknown>;
  if (typeof e.rawText !== 'string') return false;
  if (typeof e.trigger !== 'string' || !VALID_TRIGGERS.includes(e.trigger as EffectTrigger)) return false;
  if (!Array.isArray(e.conditions)) return false;
  if (typeof e.action !== 'object' || e.action === null) return false;
  const action = e.action as Record<string, unknown>;
  if (typeof action.type !== 'string' || !VALID_ACTIONS.includes(action.type as ActionType)) return false;
  if (typeof action.params !== 'object' || action.params === null) return false;
  return true;
}

const JANKEN_CHOICES: JankenChoice[] = ['rock', 'paper', 'scissors'];
const SLOTS: SetSlot[] = ['A', 'B'];

// 隨機操作參數：用數字 ID + 參數避免 discriminated union 推導問題
type Operation = {
  op: number;
  player: PlayerIndex;
  choiceIdx: number;
  handIndex: number;
  slotIdx: number;
  indices: number[];
  effectIdx: number;
  optionCount: number;
};

const operationArb: fc.Arbitrary<Operation> = fc.record({
  op: fc.integer({ min: 0, max: 7 }),
  player: fc.integer({ min: 0, max: 1 }).map((p) => p as PlayerIndex),
  choiceIdx: fc.integer({ min: 0, max: 2 }),
  handIndex: fc.integer({ min: 0, max: 6 }),
  slotIdx: fc.integer({ min: 0, max: 1 }),
  indices: fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 5 }),
  effectIdx: fc.integer({ min: 0, max: 3 }),
  optionCount: fc.integer({ min: 0, max: 2 }),
});

function applyOperation(G: GameState, op: Operation): void {
  const player = op.player as PlayerIndex;
  switch (op.op) {
    case 0:
      resolveJanken(G, JANKEN_CHOICES[op.choiceIdx], JANKEN_CHOICES[(op.choiceIdx + 1) % 3]);
      break;
    case 1:
      finishMulligan(G, player, op.indices);
      break;
    case 2:
      setInitialCard(G, player, op.handIndex);
      break;
    case 3:
      setTurnCard(G, player, op.handIndex, SLOTS[op.slotIdx]);
      break;
    case 4:
      undoSetCard(G, player, SLOTS[op.slotIdx]);
      break;
    case 5:
      confirmReady(G, player, parsedEffects);
      break;
    case 6:
      resolvePendingEffect(G, player, op.effectIdx);
      break;
    case 7:
      submitPendingChoice(G, player, Array.from({ length: op.optionCount }, (_, i) => `opt-${i}`), parsedEffects);
      break;
  }
}

describe('rule engine invariants (property-based)', () => {
  it('HP 永遠在 [0, 100] 範圍內（任意合法操作序列後）', () => {
    fc.assert(
      fc.property(fc.array(operationArb, { maxLength: 40 }), ops => {
        const G = setupGame();
        for (const op of ops) {
          applyOperation(G, op);
          expect(G.players[0].hp).toBeGreaterThanOrEqual(0);
          expect(G.players[0].hp).toBeLessThanOrEqual(100);
          expect(G.players[1].hp).toBeGreaterThanOrEqual(0);
          expect(G.players[1].hp).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('手牌 + 牌組 + 各 zone 卡數 = 總卡數（不丟卡）', () => {
    fc.assert(
      fc.property(fc.array(operationArb, { maxLength: 40 }), ops => {
        const G = setupGame();
        const initial = totalCards(G);
        expect(initial).toBe(INITIAL_TOTAL_CARDS);
        for (const op of ops) {
          applyOperation(G, op);
          expect(totalCards(G)).toBe(INITIAL_TOTAL_CARDS);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('turnNumber 單調遞增', () => {
    fc.assert(
      fc.property(fc.array(operationArb, { maxLength: 40 }), ops => {
        const G = setupGame();
        let prevTurn = G.turnNumber;
        for (const op of ops) {
          applyOperation(G, op);
          expect(G.turnNumber).toBeGreaterThanOrEqual(prevTurn);
          prevTurn = G.turnNumber;
        }
      }),
      { numRuns: 60 },
    );
  });

  it('parseEffect 要麼回 null 要麼回結構合法的 ParsedEffect（不拋例外）', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), text => {
        let parsed: unknown;
        expect(() => {
          parsed = parseEffect(text);
        }).not.toThrow();
        expect(isValidParsedEffect(parsed)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('所有真實卡牌效果都能被 parseEffect 解析為合法結構（或 null）', () => {
    for (const card of getAllCardDefs()) {
      const lines = card.effect.split('\n').filter(line => line.trim().length > 0);
      for (const line of lines) {
        let parsed: unknown;
        expect(() => {
          parsed = parseEffect(line);
        }).not.toThrow();
        expect(isValidParsedEffect(parsed)).toBe(true);
      }
    }
  });
});
