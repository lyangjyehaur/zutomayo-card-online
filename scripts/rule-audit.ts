import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CardDef } from '../src/game/types';
import { parseAllEffects, parseEffect } from '../src/game/effects/parser';
import type { ParsedEffect } from '../src/game/effects/types';
import { loadCardsForScript } from './cardSource';

const executorSupportedActions = new Set([
  'boostAttack',
  'boostBothAttackByOwnHp',
  'boostPower',
  'reduceAttack',
  'setOpponentAttack',
  'setOpponentElement',
  'directDamage',
  'heal',
  'healOpponent',
  'healBoth',
  'damageReduce',
  'drawCards',
  'swapAttack',
  'forceOwnAttackTime',
  'clockReset',
  'nullifyOpponentClock',
  'clockRewindOpponentCharacter',
  'clockSet',
  'expandMidnightRange',
  'clockSetFromTurnStartMinusOpponentClock',
  'setAllCardClocks',
  'clockAdvance',
  'recoverFromAbyss',
  'sendToAbyss',
  'millDeckToAbyss',
  'moveOwnDeckTopByPower',
  'moveOpponentDeckTopByPowerCost',
  'revealOpponentDeckTopBySendToPower',
  'revealOpponentHand',
  'returnAreaEnchantToDeck',
  'moveSelfAreaEnchant',
  'useFromAbyss',
  'handSizeModifier',
  'setPowerCost',
  'requestChoice',
  'suppressEffectActivation',
  'noEffect',
  'addSettableCard',
]);

const executorSupportedChoiceTypes = new Set([
  'revealHandAttackBoost',
  'nameGuessOpponentHandReveal',
  'optionalHandMoveThenDraw',
  'useFromHand',
  'cardMove',
  'abyssToDeckBottomOrLose',
  'reorderOpponentDeckTop',
  'opponentPowerCharacterSwap',
  'handAbyssSwap',
  'clockPosition',
  'clockAdvance',
  'handToDeckBottomThenDraw',
]);

export function unsupportedExecutorReason(effect: ParsedEffect): string | null {
  if (!executorSupportedActions.has(effect.action.type)) {
    return `unsupported action ${effect.action.type}`;
  }

  if (effect.action.type !== 'requestChoice') return null;

  const choiceType = effect.action.params.choiceType;
  if (typeof choiceType !== 'string') return 'requestChoice missing choiceType';
  if (!executorSupportedChoiceTypes.has(choiceType)) {
    return `unsupported choiceType ${choiceType}`;
  }
  return null;
}

export interface RuleAuditReport {
  totalCards: number;
  effectCards: number;
  effectLines: number;
  parsedLines: number;
  runtimeParsedEffects: number;
  unparsedLines: number;
  parsedButPartial: number;
  falseDraw: number;
  samples: {
    unparsed: Array<{ id: string; text: string }>;
    parsedButPartial: Array<{ id: string; action: string; reason: string; text: string }>;
    falseDraw: Array<{ id: string; text: string }>;
  };
}

export function auditRuleEffects(cards: CardDef[]): RuleAuditReport {
  const runtimeEffects = parseAllEffects(cards.map((card) => ({ id: card.id, effect: card.effect || '' })));
  let effectLines = 0;
  let parsedLines = 0;
  let runtimeParsedEffects = 0;
  const unparsed: { id: string; text: string }[] = [];
  const parsedButPartial: { id: string; action: string; reason: string; text: string }[] = [];
  const falseDraw: { id: string; text: string }[] = [];

  for (const card of cards) {
    for (const text of (card.effect || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      effectLines++;
      const parsed = parseEffect(text);
      if (!parsed) {
        unparsed.push({ id: card.id, text });
        continue;
      }
      parsedLines++;
      if (
        parsed.action.type === 'drawCards' &&
        !/(カード[をが][0-9０-９]+枚(?:引|ドロー)|デッキから[0-9０-９]+枚カードを引|カードを引)/.test(text)
      ) {
        falseDraw.push({ id: card.id, text });
      }
    }
  }

  for (const [id, effects] of runtimeEffects.entries()) {
    for (const effect of effects) {
      runtimeParsedEffects++;
      const unsupportedReason = unsupportedExecutorReason(effect);
      if (unsupportedReason) {
        parsedButPartial.push({ id, action: effect.action.type, reason: unsupportedReason, text: effect.rawText });
      }
    }
  }

  return {
    totalCards: cards.length,
    effectCards: cards.filter((card) => card.effect?.trim()).length,
    effectLines,
    parsedLines,
    runtimeParsedEffects,
    unparsedLines: unparsed.length,
    parsedButPartial: parsedButPartial.length,
    falseDraw: falseDraw.length,
    samples: {
      unparsed: unparsed.slice(0, 20),
      parsedButPartial: parsedButPartial.slice(0, 20),
      falseDraw,
    },
  };
}

export function ruleAuditFailures(report: RuleAuditReport): string[] {
  const failures: string[] = [];
  if (report.unparsedLines > 0) failures.push(`${report.unparsedLines} effect lines are not parsed`);
  if (report.parsedButPartial > 0) failures.push(`${report.parsedButPartial} parsed effects are not executable`);
  if (report.falseDraw > 0) failures.push(`${report.falseDraw} effects were falsely parsed as card draws`);
  return failures;
}

async function main(): Promise<void> {
  const report = auditRuleEffects(await loadCardsForScript());
  console.log(JSON.stringify(report, null, 2));
  const failures = ruleAuditFailures(report);
  if (failures.length > 0) {
    console.error(`rule audit failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
