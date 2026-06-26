#!/usr/bin/env node
// Dump every card effect line with its live parser output for semantic audit.
import { getAllCardDefs } from '../src/game/cards/loader';
import { parseEffect, parseAllEffects } from '../src/game/effects/parser';

const cards = getAllCardDefs();
const out: any[] = [];

for (const card of cards) {
  if (!card.effect || card.effect.trim().length === 0) continue;
  const lines = card.effect.split('\n').map(l => l.trim()).filter(Boolean);
  const lineAnalysis = lines.map((line, idx) => {
    const parsed = parseEffect(line);
    return {
      lineIndex: idx,
      raw: line,
      parsed,
    };
  });

  // Also get the multi-line combined parse (what parseAllEffects sees)
  const combined = parseAllEffects([{ id: card.id, effect: card.effect }]).get(card.id) ?? [];

  out.push({
    id: card.id,
    name: card.name,
    pack: card.pack,
    type: card.type,
    element: card.element,
    powerCost: card.powerCost,
    sendToPower: card.sendToPower,
    clock: card.clock,
    effectFull: card.effect,
    lines: lineAnalysis,
    combinedParsed: combined,
  });
}

console.log(JSON.stringify(out, null, 2));
