import { getAllCardDefs } from '../src/game/cards/loader';
import { parseEffect } from '../src/game/effects/parser';
import type { ParsedEffect } from '../src/game/effects/types';

const executorSupportedActions = new Set([
  'boostAttack',
  'boostBothAttackByOwnHp',
  'reduceAttack',
  'setOpponentAttack',
  'directDamage',
  'heal',
  'damageReduce',
  'drawCards',
  'swapAttack',
  'forceOwnAttackTime',
  'clockReset',
  'clockSet',
  'clockSetFromTurnStartMinusOpponentClock',
  'setAllCardClocks',
  'clockAdvance',
  'recoverFromAbyss',
  'sendToAbyss',
  'millDeckToAbyss',
  'moveOwnDeckTopByPower',
  'moveOpponentDeckTopByPowerCost',
  'revealOpponentHand',
  'returnAreaEnchantToDeck',
  'moveSelfAreaEnchant',
  'useFromAbyss',
  'handSizeModifier',
  'setPowerCost',
  'requestChoice',
  'suppressEffectActivation',
  'noEffect',
]);

const executorSupportedChoiceTypes = new Set([
  'revealHandAttackBoost',
  'nameGuessOpponentHandReveal',
  'optionalHandMoveThenDraw',
  'cardMove',
  'abyssToDeckBottomOrLose',
  'opponentPowerCharacterSwap',
  'handAbyssSwap',
  'clockPosition',
  'clockAdvance',
  'handToDeckBottomThenDraw',
]);

function unsupportedExecutorReason(effect: ParsedEffect): string | null {
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

const cards = getAllCardDefs();
let effectLines = 0;
let parsedLines = 0;
const unparsed: { id: string; text: string }[] = [];
const parsedButPartial: { id: string; action: string; reason: string; text: string }[] = [];
const falseDraw: { id: string; text: string }[] = [];

for (const card of cards) {
  for (const text of (card.effect || '').split('\n').map(line => line.trim()).filter(Boolean)) {
    effectLines++;
    const parsed = parseEffect(text);
    if (!parsed) {
      unparsed.push({ id: card.id, text });
      continue;
    }
    parsedLines++;
    const unsupportedReason = unsupportedExecutorReason(parsed);
    if (unsupportedReason) {
      parsedButPartial.push({ id: card.id, action: parsed.action.type, reason: unsupportedReason, text });
    }
    if (
      parsed.action.type === 'drawCards'
      && !/(カード[をが][0-9０-９]+枚(?:引|ドロー)|デッキから[0-9０-９]+枚カードを引|カードを引)/.test(text)
    ) {
      falseDraw.push({ id: card.id, text });
    }
  }
}

console.log(JSON.stringify({
  totalCards: cards.length,
  effectCards: cards.filter(card => card.effect?.trim()).length,
  effectLines,
  parsedLines,
  unparsedLines: unparsed.length,
  parsedButPartial: parsedButPartial.length,
  falseDraw: falseDraw.length,
  samples: {
    unparsed: unparsed.slice(0, 20),
    parsedButPartial: parsedButPartial.slice(0, 20),
    falseDraw,
  },
}, null, 2));
