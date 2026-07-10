import type { CardInstance, Element } from '../types';
import { createInstance, getAllCardDefs, getCardDef, isCardsInitialized } from './loader';
import { PRESET_DECKS } from './presetDecks';
import { CUSTOM_DECK_NAME, customDeckIdFromOption, loadCustomDeckIds, loadCustomDeckIdsForOption } from './customDeck';

export {
  CUSTOM_DECK_NAME,
  CUSTOM_DECK_STORAGE_KEY,
  customDeckIdFromOption,
  customDeckOptionId,
  loadCustomDeckIds,
} from './customDeck';

/**
 * 隨機牌組識別碼。lobby 預設選此選項，每次開局從完整 422 張卡池隨機抽取 20 張。
 * 與 preset/custom 不同，不預先固定任何卡牌，確保每次對戰牌組都不同。
 */
export const RANDOM_DECK_NAME = '__random__';

/**
 * 克制牌組識別碼。AI 對手專用，分析玩家牌組特性後從卡池組出克制牌組。
 * 僅用於 AI 對戰的對手牌組，玩家不可選。
 */
export const COUNTER_DECK_NAME = '__counter__';

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 防禦：卡牌未載入時直接 throw，避免產出空牌組導致開局崩潰。
 * 瀏覽器端 refreshCards() 是非同步，慢網路下可能在載入完成前就開局。
 */
function assertCardsLoaded(): void {
  if (!isCardsInitialized() || getAllCardDefs().length === 0) {
    throw new Error('Cards not loaded yet. Call refreshCards() before starting a game.');
  }
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
  if (name === RANDOM_DECK_NAME) return randomDeck();
  if (name === CUSTOM_DECK_NAME || customDeckIdFromOption(name)) {
    const ids = loadCustomDeckIdsForOption(name) ?? loadCustomDeckIds();
    if (!ids) throw new Error('No custom deck saved');
    const validationError = validateConstructedDeckIds(ids);
    if (validationError) throw new Error(`Custom deck is invalid: ${validationError}`);
    return buildDeck(ids);
  }
  const preset = PRESET_DECKS[name];
  if (!preset) throw new Error(`Unknown preset deck: ${name}`);
  // 同屬性隨機：從該屬性卡池隨機抽取 20 張，每次開局都不同。
  return randomElementDeck(preset.element);
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
  assertCardsLoaded();
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

/**
 * 從指定屬性卡池隨機產生 20 張牌組。
 *
 * 與 randomDeck() 同標準（20 張、同卡最多 2 張、Character >= 50% 推薦），
 * 但卡池限制為單一屬性。四個主要屬性（闇/炎/電気/風）各有 104-106 張卡、
 * 59-60 張角色卡，足以隨機抽出合法牌組。カオス 屬性僅 4 張，不支援。
 */
export function randomElementDeck(element: Element): CardInstance[] {
  assertCardsLoaded();
  const pool = getAllCardDefs().filter((c) => c.element === element);
  const characters = pool.filter((c) => c.type === 'Character');
  const others = pool.filter((c) => c.type !== 'Character');
  // 官方推薦 Character >= 50%（非強制）；隨機決定 10-15 張角色卡
  const charCount = 10 + Math.floor(Math.random() * 6); // 10-15
  const otherCount = 20 - charCount;
  const deckChars = shuffle(characters).slice(0, charCount);
  const deckOthers = shuffle(others).slice(0, otherCount);
  const deck = shuffle([...deckChars, ...deckOthers]);
  return deck.map((c) => createInstance(c.id));
}

/**
 * 分析玩家牌組特性後，從完整卡池組出克制牌組。
 *
 * 克制策略：
 * 1. 計算玩家角色卡的平均攻擊力（day+night 之和），挑攻擊力 >= 該平均的角色卡，
 *    確保戰鬥時攻擊力不輸（攻擊力壓制）
 * 2. 優先挑 sendToPower > 0 的附魔/區域附魔卡，搶奪 power 優勢，確保高費角色能發動
 * 3. 非角色卡若不足，從剩餘非角色卡補齊
 *
 * 輸出符合官方標準：20 張、Character >= 10、同卡最多 2 張。
 * 從 unique 卡定義抽，每張最多 1 張，必然符合同卡上限。
 * 最後走 validateConstructedDeckIds 驗證，確保合法。
 */
export function buildCounterDeck(playerDeck: CardInstance[]): CardInstance[] {
  const allCards = getAllCardDefs();
  const playerDefs = playerDeck
    .map((c) => getCardDef(c.defId))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const playerChars = playerDefs.filter((c) => c.type === 'Character' && c.attack);
  // 玩家角色卡平均總攻擊力（day + night），作為 AI 挑卡的门檻
  const playerAvgAttack =
    playerChars.length > 0
      ? playerChars.reduce((sum, c) => sum + (c.attack!.day + c.attack!.night), 0) / playerChars.length
      : 50;

  const aiChars = allCards.filter((c) => c.type === 'Character' && c.attack);
  // 攻擊力壓制：挑 day+night 總和 >= 玩家平均的角色卡，按攻擊力降序
  const strongChars = aiChars
    .filter((c) => c.attack!.day + c.attack!.night >= playerAvgAttack)
    .sort((a, b) => b.attack!.day + b.attack!.night - (a.attack!.day + a.attack!.night));
  // 若強卡不足，放寬到所有角色卡
  const charPool = strongChars.length >= 10 ? strongChars : aiChars;
  const charCount = 14; // 14 張角色卡，確保戰鬥力充足
  const deckChars = shuffle(charPool).slice(0, charCount);

  const aiOthers = allCards.filter((c) => c.type !== 'Character');
  // power 優勢：優先 sendToPower > 0 的卡；不足時從其餘非角色卡補齊。
  const powerCards = aiOthers.filter((c) => c.sendToPower > 0);
  const otherCount = 20 - charCount;
  let deckOthers = shuffle(powerCards).slice(0, otherCount);
  if (deckOthers.length < otherCount) {
    // 不足時從剩餘非角色卡補齊，避免牌組少於 20 張
    const usedIds = new Set(deckOthers.map((c) => c.id));
    const fillers = shuffle(aiOthers.filter((c) => !usedIds.has(c.id))).slice(0, otherCount - deckOthers.length);
    deckOthers = [...deckOthers, ...fillers];
  }

  const defIds = [...deckChars, ...deckOthers].map((c) => c.id);
  // 保險：走驗證確保合法，若不合法 fallback 到 randomDeck
  const validationError = validateConstructedDeckIds(defIds);
  if (validationError) {
    // 理論上不該發生，但保留 fallback 避免開局崩潰
    return randomDeck();
  }
  return defIds.map((id) => createInstance(id));
}

// Shuffle a deck
export function shuffleDeck(deck: CardInstance[]): CardInstance[] {
  return shuffle(deck);
}
