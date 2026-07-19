import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CardDef, CardType, Element } from '../src/game/types';

const PRESET_ELEMENTS: Array<{ code: string; element: Element }> = [
  { code: 'dark', element: '闇' },
  { code: 'flame', element: '炎' },
  { code: 'electric', element: '電気' },
  { code: 'wind', element: '風' },
];

const TUTORIAL_IDS: Array<{ id: string; type: CardType }> = [
  { id: '1st_2', type: 'Character' },
  { id: '1st_34', type: 'Character' },
  { id: '1st_35', type: 'Character' },
  { id: '1st_66', type: 'Character' },
  { id: '1st_67', type: 'Character' },
  { id: '1st_68', type: 'Character' },
  { id: '1st_70', type: 'Character' },
  { id: '1st_98', type: 'Enchant' },
  { id: '2nd_86', type: 'Area Enchant' },
  { id: '2nd_92', type: 'Character' },
];

// Preserve only the mechanics required by the deterministic tutorial. The rest of the
// E2E fixture remains synthetic and must not be mistaken for production card data.
const TUTORIAL_OVERRIDES: Record<string, Partial<CardDef>> = {
  '1st_2': { clock: 1, attack: { night: 60, day: 60 }, powerCost: 7, sendToPower: 1 },
  '1st_34': { clock: 1, attack: { night: 70, day: 70 }, powerCost: 1, sendToPower: 1 },
  '1st_67': { clock: 1, attack: { night: 50, day: 50 }, powerCost: 0, sendToPower: 1 },
  '1st_70': { clock: 2, attack: { night: 30, day: 30 }, powerCost: 0, sendToPower: 2 },
  '1st_98': { clock: 4, sendToPower: 0, effect: '攻撃力+30', enEffectOfficial: 'Attack +30' },
  '2nd_86': { clock: 2, sendToPower: 0, effect: '攻撃力+20', enEffectOfficial: 'Attack +20' },
};

function syntheticCard(id: string, element: Element, type: CardType, index: number): CardDef {
  return {
    id,
    name: `E2E CARD ${index}`,
    enNameOfficial: `E2E CARD ${index}`,
    pack: 'synthetic-e2e',
    song: '',
    illustrator: '',
    rarity: 'N',
    element,
    type,
    clock: 1,
    attack: type === 'Character' ? { night: 40, day: 40 } : null,
    powerCost: 0,
    sendToPower: 1,
    effect: '',
    enEffectOfficial: '',
    image: '/card-back.jpg',
    errata: '',
    ...TUTORIAL_OVERRIDES[id],
  };
}

export function createE2ECardSeed(): { schemaVersion: 2; cards: CardDef[]; texts: Record<string, never> } {
  const cards: CardDef[] = [];
  let index = 1;
  for (const { code, element } of PRESET_ELEMENTS) {
    for (let cardNumber = 1; cardNumber <= 20; cardNumber += 1) {
      cards.push(syntheticCard(`e2e_${code}_${String(cardNumber).padStart(2, '0')}`, element, 'Character', index));
      index += 1;
    }
  }
  for (const tutorial of TUTORIAL_IDS) {
    cards.push(syntheticCard(tutorial.id, 'カオス', tutorial.type, index));
    index += 1;
  }
  return { schemaVersion: 2, cards, texts: {} };
}

async function main(): Promise<void> {
  const target = resolve(process.cwd(), process.argv[2] || '/tmp/e2e-card-seed.json');
  const fixture = createE2ECardSeed();
  await writeFile(target, `${JSON.stringify(fixture)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Generated ${fixture.cards.length} synthetic E2E cards at ${target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
