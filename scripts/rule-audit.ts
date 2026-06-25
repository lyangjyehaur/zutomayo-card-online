import { getAllCardDefs } from '../src/game/cards/loader';
import { parseEffect } from '../src/game/effects/parser';

const parsedButPartialPatterns = [
  /選/,
  /好きな/,
  /まで/,
  /入れ替え/,
  /そうしない場合/,
  /見て.*順番/,
  /ターンの終了時.*(?:アビス|パワーチャージャー)に置く/,
  /じゃなくなったら.*(?:アビス|パワーチャージャー)に置く/,
];

const cards = getAllCardDefs();
let effectLines = 0;
let parsedLines = 0;
const unparsed: { id: string; text: string }[] = [];
const parsedButPartial: { id: string; action: string; text: string }[] = [];
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
    if (parsedButPartialPatterns.some(pattern => pattern.test(text))) {
      parsedButPartial.push({ id: card.id, action: parsed.action.type, text });
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
