import type { CardInstance } from '../types';
import { createInstance, getAllCardDefs, getCardDef } from './loader';
import { PRESET_DECKS } from './presetDecks';

export const CUSTOM_DECK_NAME = 'custom';
export const CUSTOM_DECK_STORAGE_KEY = 'zutomayo_custom_deck';

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
  const unknown = defIds.find(id => !getCardDef(id));
  if (unknown) throw new Error(`Unknown card in deck: ${unknown}`);
  return defIds.map(id => createInstance(id));
}

export function loadCustomDeckIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const data = localStorage.getItem(CUSTOM_DECK_STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function validateConstructedDeckIds(defIds: unknown): string | null {
  if (!Array.isArray(defIds)) return 'Deck must be an array of card IDs';
  if (defIds.some(id => typeof id !== 'string')) return 'Deck card IDs must be strings';
  if (defIds.length !== 20) return `Deck must have exactly 20 cards, got ${defIds.length}`;

  const counts = new Map<string, number>();
  for (const id of defIds) {
    const card = getCardDef(id);
    if (!card) return `Unknown card in deck: ${id}`;
    const count = (counts.get(id) ?? 0) + 1;
    if (count > 2) return `Deck cannot contain more than 2 copies of ${id}`;
    counts.set(id, count);
  }
  // 官方 start-guide：「キャラクターカードはデッキの50%以上にすることを推奨」——非強制，故不作為驗證錯誤。
  return null;
}

// 官方推薦 Character >= 50%，非強制；供 UI 顯示警告用。
export function getCharacterCountWarning(defIds: string[]): string | null {
  const characterCount = defIds.filter(id => getCardDef(id)?.type === 'Character').length;
  if (characterCount < 10) {
    return `Recommended: at least 10 Character cards, got ${characterCount}`;
  }
  return null;
}

export function isValidConstructedDeck(defIds: unknown): defIds is string[] {
  return validateConstructedDeckIds(defIds) === null;
}

export function hasCustomDeck(): boolean {
  const ids = loadCustomDeckIds();
  return !!ids && isValidConstructedDeck(ids);
}

// Get a preset deck by name
export function getPresetDeck(name: string): CardInstance[] {
  if (name === CUSTOM_DECK_NAME) {
    const ids = loadCustomDeckIds();
    if (!ids) throw new Error('No custom deck saved');
    const validationError = validateConstructedDeckIds(ids);
    if (validationError) throw new Error(`Custom deck is invalid: ${validationError}`);
    return buildDeck(ids);
  }
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
