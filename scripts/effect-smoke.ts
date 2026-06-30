import assert from 'node:assert/strict';
import { parseEffect } from '../src/game/effects/parser';
import { executeEffect } from '../src/game/effects/executor';
import { setupGame, getChronosTime, setInitialCard, resolveJanken, finishMulligan } from '../src/game/GameLogic';
import type { GameState } from '../src/game/types';
import type { ParsedEffect } from '../src/game/effects';
import { loadCardsForScript } from './cardSource';

const cardsData = await loadCardsForScript();

// ===== Test 1: Coverage — parse all effect cards =====
console.log('=== Test 1: Parser Coverage ===');
const effectCards = cardsData.filter((card) => card.effect && card.effect.trim().length > 0);
let parsed = 0;
const failed: string[] = [];

for (const card of effectCards) {
  const effectText = card.effect;
  if (!effectText) continue;
  const result = parseEffect(effectText);
  if (result) {
    parsed++;
  } else {
    failed.push(`[${card.id}] ${effectText.substring(0, 60)}`);
  }
}

console.log(`  Parsed: ${parsed}/${effectCards.length} (${Math.round((parsed / effectCards.length) * 100)}%)`);
if (failed.length > 0) {
  console.log(`  Failed (${failed.length}):`);
  failed.forEach((f) => console.log(`    ${f}`));
}
assert.ok(parsed >= effectCards.length * 0.9, `Parser coverage too low: ${parsed}/${effectCards.length}`);

// ===== Test 2: Parser returns correct structure =====
console.log('\n=== Test 2: Parser Structure ===');

const boostEffect = parseEffect('攻撃力+50');
assert.ok(boostEffect, 'boostAttack should parse');
assert.equal(boostEffect!.action.type, 'boostAttack');
assert.equal(boostEffect!.action.params.value, 50);
console.log('  ✓ boostAttack: 攻撃力+50');

const condBoost = parseEffect('夜なら攻撃力+30');
assert.ok(condBoost, 'conditional boost should parse');
assert.equal(condBoost!.action.type, 'boostAttack');
assert.equal(condBoost!.conditions.length, 1);
assert.equal(condBoost!.conditions[0].type, 'chronos');
console.log('  ✓ chronosCond: 夜なら攻撃力+30');

const elemCond = parseEffect('相手の属性が風なら攻撃力+50');
assert.ok(elemCond, 'element condition should parse');
assert.equal(elemCond!.conditions[0].type, 'opponentElement');
assert.equal(elemCond!.conditions[0].value, '風');
console.log('  ✓ elementCond: 相手の属性が風なら攻撃力+50');

const healEffect = parseEffect('HPを20回復');
assert.ok(healEffect, 'heal should parse');
assert.equal(healEffect!.action.type, 'heal');
assert.equal(healEffect!.action.params.value, 20);
console.log('  ✓ heal: HPを20回復');

const dmgReduce = parseEffect('30ダメージ軽減');
assert.ok(dmgReduce, 'damageReduce should parse');
assert.equal(dmgReduce!.action.type, 'damageReduce');
console.log('  ✓ damageReduce: 30ダメージ軽減');

const swapEffect = parseEffect('昼夜逆転');
assert.ok(swapEffect, 'swapAttack should parse');
assert.equal(swapEffect!.action.type, 'swapAttack');
console.log('  ✓ swapAttack: 昼夜逆転');

const clockEffect = parseEffect('時計を無効');
assert.ok(clockEffect, 'clockReset should parse');
assert.equal(clockEffect!.action.type, 'clockReset');
console.log('  ✓ clockReset: 時計を無効');

const drawEffect = parseEffect('カードを1枚引く');
assert.ok(drawEffect, 'drawCards should parse');
assert.equal(drawEffect!.action.type, 'drawCards');
console.log('  ✓ drawCards: カードを1枚引く');

assert.equal(parseEffect(''), null, 'empty string should return null');
console.log('  ✓ empty/null handling');

// ===== Test 3: Executor tests =====
console.log('\n=== Test 3: Executor Tests ===');

function makeTestState(): GameState {
  return setupGame();
}

// heal
{
  const G = makeTestState();
  G.players[0].hp = 80;
  const effect: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    action: { type: 'heal', params: { value: 20 } },
    rawText: 'HPを20回復',
  };
  const result = executeEffect(effect, G, 0);
  assert.ok(result.success, 'heal should succeed');
  assert.equal(G.players[0].hp, 100, 'HP should be 100 after heal');
  console.log('  ✓ heal: 80 + 20 = 100');
}

// heal cap
{
  const G = makeTestState();
  G.players[0].hp = 95;
  const effect: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    action: { type: 'heal', params: { value: 20 } },
    rawText: 'HPを20回復',
  };
  executeEffect(effect, G, 0);
  assert.equal(G.players[0].hp, 100, 'HP should cap at 100');
  console.log('  ✓ heal cap: 95 + 20 = 100');
}

// directDamage
{
  const G = makeTestState();
  G.players[1].hp = 100;
  const effect: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    action: { type: 'directDamage', params: { value: 25 } },
    rawText: '25ダメージ',
  };
  executeEffect(effect, G, 0);
  assert.equal(G.players[1].hp, 75, 'Opponent HP should be 75');
  console.log('  ✓ directDamage: 100 - 25 = 75');
}

// clockReset
{
  const G = makeTestState();
  G.chronos.position = 8;
  const effect: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    action: { type: 'clockReset', params: {} },
    rawText: '時計を無効',
  };
  executeEffect(effect, G, 0);
  assert.equal(G.chronos.position, 0, 'Chronos should reset to 0');
  console.log('  ✓ clockReset: 8 → 0');
}

// condition not met
{
  const G = makeTestState();
  G.chronos.position = 8; // day
  const effect: ParsedEffect = {
    trigger: 'onBattle',
    conditions: [{ type: 'chronos', value: 'night' }],
    action: { type: 'boostAttack', params: { value: 30 } },
    rawText: '夜なら攻撃力+30',
  };
  const result = executeEffect(effect, G, 0);
  assert.equal(result.success, false, 'Should fail when condition not met');
  console.log('  ✓ condition check: night fails during day');
}

// ===== Test 4: Full game flow =====
console.log('\n=== Test 4: Full Flow ===');
{
  const G = setupGame();
  resolveJanken(G, 'rock', 'scissors');
  assert.equal(G.chronos.nightSidePlayer, 0, 'Player 0 should be night side');
  console.log('  ✓ Janken resolved');

  finishMulligan(G, 0, []);
  finishMulligan(G, 1, []);
  console.log('  ✓ Mulligan completed');

  setInitialCard(G, 0, 0);
  setInitialCard(G, 1, 0);
  console.log('  ✓ Initial cards set');

  // Check chronos time is determined
  const time = getChronosTime(G);
  assert.ok(time === 'night' || time === 'day', 'Chronos time should be determined');
  console.log(`  ✓ Chronos time: ${time}`);
}

// ===== Summary =====
console.log('\n=== Summary ===');
console.log(`Parser coverage: ${parsed}/${effectCards.length} (${Math.round((parsed / effectCards.length) * 100)}%)`);
console.log(`Parser structure: all passed`);
console.log(`Executor tests: all passed`);
console.log(`Full flow: passed`);
console.log('\n✅ All effect tests passed!');
