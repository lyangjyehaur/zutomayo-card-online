import type { CardInstance } from '../types';
import { createInstance, getAllCardDefs, getCardDef } from './loader';
import { PRESET_DECKS } from './presetDecks';

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a deck from a list of card def IDs (must be 20 cards)
export function buildDeck(defIds: string[]): CardInstance[] {
  if (defIds.length !== 20) {
    throw new Error(`Deck must have exactly 20 cards, got ${defIds.length}`);
  }
  return defIds.map(id => createInstance(id));
}

// Get a preset deck by name
export function getPresetDeck(name: string): CardInstance[] {
  const preset = PRESET_DECKS[name];
  if (!preset) throw new Error(`Unknown preset deck: ${name}`);
  return buildDeck(preset.ids);
}

// Get all preset deck names
export function getPresetDeckNames(): string[] {
  return Object.keys(PRESET_DECKS);
}

// Generate a random deck from all available cards
export function randomDeck(): CardInstance[] {
  const allCards = getAllCardDefs();
  const characters = allCards.filter(c => c.type === 'Character');
  const enchants = allCards.filter(c => c.type === 'Enchant');
  const areaEnchants = allCards.filter(c => c.type === 'Area Enchant');

  const deckChars = shuffle(characters).slice(0, 12);
  const deckEnchants = shuffle(enchants).slice(0, 6);
  const deckAE = shuffle(areaEnchants).slice(0, 2);
  const deck = shuffle([...deckChars, ...deckEnchants, ...deckAE]);

  return deck.map(c => createInstance(c.id));
}

// Shuffle a deck
export function shuffleDeck(deck: CardInstance[]): CardInstance[] {
  return shuffle(deck);
}
