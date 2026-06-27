#!/usr/bin/env node
import { getAllCardDefs } from '../src/game/cards/loader';
import { parseAllEffects, parseEffect } from '../src/game/effects/parser';

const cards = getAllCardDefs();
const runtime = parseAllEffects(cards.map(card => ({ id: card.id, effect: card.effect || '' })));

const rows = cards
  .filter(card => card.effect?.trim())
  .map(card => {
    const lines = card.effect.split('\n').map(line => line.trim()).filter(Boolean);
    return {
      id: card.id,
      name: card.name,
      pack: card.pack,
      type: card.type,
      song: card.song,
      element: card.element,
      powerCost: card.powerCost,
      sendToPower: card.sendToPower,
      clock: card.clock,
      attack: card.attack,
      effect: card.effect,
      lineParses: lines.map((line, index) => ({ index, line, parsed: parseEffect(line) })),
      runtimeEffects: runtime.get(card.id) ?? [],
    };
  });

console.log(JSON.stringify(rows, null, 2));
