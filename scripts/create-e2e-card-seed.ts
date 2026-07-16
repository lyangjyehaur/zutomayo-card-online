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
  };
}

export function createE2ECardSeed(): { schemaVersion: 1; cards: CardDef[]; i18n: Record<string, never> } {
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
  return { schemaVersion: 1, cards, i18n: {} };
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
