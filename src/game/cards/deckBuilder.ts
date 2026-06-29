import type { CardInstance } from '../types';
import { createInstance, getAllCardDefs, getCardDef } from './loader';
import { PRESET_DECKS } from './presetDecks';
import { CUSTOM_DECK_NAME, loadCustomDeckIds } from './customDeck';

export { CUSTOM_DECK_NAME, CUSTOM_DECK_STORAGE_KEY, loadCustomDeckIds } from './customDeck';

/**
 * 隨機牌組識別碼。lobby 預設選此選項，每次開局從完整 422 張卡池隨機抽取 20 張。
 * 與 preset/custom 不同，不預先固定任何卡牌，確保每次對戰牌組都不同。
 */
export const RANDOM_DECK_NAME = '__random__';

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
  // 所有牌組建構路徑（custom / preset / randomDeck）統一走驗證，確保不合規牌組無法進入遊戲。
  const validationError = validateConstructedDeckIds(defIds);
  if (validationError) throw new Error(validationError);
  return defIds.map((id) => createInstance(id));
}

export function validateConstructedDeckIds(defIds: unknown): string | null {
  if (!Array.isArray(defIds)) return 'Deck must be an array of card IDs';
  if (defIds.some((id) => typeof id !== 'string')) return 'Deck card IDs must be strings';
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
  const characterCount = defIds.filter((id) => getCardDef(id)?.type === 'Character').length;
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

/**
 * 從完整卡池隨機產生符合官方標準的 20 張牌組。
 *
 * 官方規則：
 * - 牌組正好 20 張
 * - 同卡最多 2 張（從 unique 卡定義抽，必然符合）
 * - Character >= 50% 為推薦（非強制），這裡軟性確保 10-15 張角色卡
 *
 * 卡池涵蓋全部 422 張卡（Character 242 + Enchant 153 + Area Enchant 27），
 * 每次呼叫都重新隨機，確保每次對戰牌組都不同。
 */
export function randomDeck(): CardInstance[] {
  const allCards = getAllCardDefs();
  const characters = allCards.filter((c) => c.type === 'Character');
  const others = allCards.filter((c) => c.type !== 'Character');
  // 官方推薦 Character >= 50%（非強制）；隨機決定 10-15 張角色卡，其餘從非角色卡隨機抽取
  const charCount = 10 + Math.floor(Math.random() * 6); // 10-15
  const otherCount = 20 - charCount;
  const deckChars = shuffle(characters).slice(0, charCount);
  const deckOthers = shuffle(others).slice(0, otherCount);
  const deck = shuffle([...deckChars, ...deckOthers]);
  return deck.map((c) => createInstance(c.id));
}

// Shuffle a deck
export function shuffleDeck(deck: CardInstance[]): CardInstance[] {
  return shuffle(deck);
}
