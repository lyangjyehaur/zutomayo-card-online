import type { CardDef, CardInstance } from '../types';
import cardsData from '../../../cards.json';

// Build lookup map from cards.json
const cardMap = new Map<string, CardDef>();

for (const card of cardsData as CardDef[]) {
  cardMap.set(card.id, card);
}

export function getCardDef(id: string): CardDef | undefined {
  return cardMap.get(id);
}

export function getAllCardDefs(): CardDef[] {
  return Array.from(cardMap.values());
}

export function getCardsByPack(pack: string): CardDef[] {
  return (cardsData as CardDef[]).filter((c) => c.pack === pack);
}

// Create a CardInstance from a CardDef
let instanceCounter = 0;

export function createInstance(defId: string, faceUp = false): CardInstance {
  return {
    instanceId: `inst_${defId}_${++instanceCounter}`,
    defId,
    faceUp,
  };
}

// Reset counter (for testing)
export function resetInstanceCounter(): void {
  instanceCounter = 0;
}
