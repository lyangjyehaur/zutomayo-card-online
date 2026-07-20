import type { CardDef, CardInstance } from '../types';
import { Sentry } from '../../sentry';

const cardMap = new Map<string, CardDef>();
const fallbackCardMap = new Map<string, CardDef>();
let currentCards: CardDef[] = [];
let currentConfig: Record<string, unknown> = {};
let cardsRefreshPromise: Promise<CardDef[]> | null = null;
let _initialized = false;
const CARD_FETCH_TIMEOUT_MS = 2500;

export function isCardsInitialized(): boolean {
  return _initialized;
}

/**
 * 從外部載入卡牌數據（遊戲伺服器啟動時呼叫，server 端從 PostgreSQL 讀取）。
 * 瀏覽器端請使用 loadCardsFromAPI() / refreshCards()。
 */
export function initCards(cards: CardDef[]): void {
  currentCards = cards;
  cardMap.clear();
  for (const card of cards) {
    cardMap.set(card.id, card);
  }
  _initialized = true;
}

function isCardDefArray(value: unknown): value is CardDef[] {
  return (
    Array.isArray(value) &&
    value.every((card) =>
      Boolean(card && typeof card === 'object' && typeof (card as { id?: unknown }).id === 'string'),
    )
  );
}

async function fetchJson<T>(
  path: string,
  cache: RequestCache = 'no-store',
  timeoutMs = CARD_FETCH_TIMEOUT_MS,
): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(path, { cache, signal: controller?.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (err) {
    // 卡牌載入失敗會導致空牌組崩潰，記錄 breadcrumb 以利追蹤載入問題。
    Sentry.addBreadcrumb({
      category: 'card-loader',
      message: `fetchJson failed: ${path}`,
      level: 'warning',
      data: { path, error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  } finally {
    if (timeout !== null) globalThis.clearTimeout(timeout);
  }
}

/**
 * 從 PG-backed API 載入卡牌數據（瀏覽器端）。
 * API 不可用時保留既有（可能為空）的卡牌資料。
 */
async function loadCardsFromAPI(): Promise<CardDef[]> {
  const cards = await fetchJson<unknown>('/api/cards');
  if (isCardDefArray(cards)) {
    initCards(cards);
  }
  return getAllCardDefs();
}

export async function loadConfigFromAPI(): Promise<Record<string, unknown>> {
  const config = await fetchJson<unknown>('/api/config');
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    currentConfig = config as Record<string, unknown>;
  }
  return currentConfig;
}

export async function refreshCards(): Promise<CardDef[]> {
  cardsRefreshPromise ??= loadCardsFromAPI().finally(() => {
    cardsRefreshPromise = null;
  });
  return cardsRefreshPromise;
}

export function getGameConfig(): Record<string, unknown> {
  return currentConfig;
}

export function getCardDef(id: string): CardDef | undefined {
  return cardMap.get(id) ?? fallbackCardMap.get(id);
}

/**
 * Register presentation-only card definitions without marking the gameplay dataset as initialized.
 * Real API data always wins and getAllCardDefs() remains limited to the authoritative dataset.
 */
export function registerCardDefFallbacks(cards: CardDef[]): void {
  for (const card of cards) fallbackCardMap.set(card.id, card);
}

export function getAllCardDefs(): CardDef[] {
  return [...currentCards];
}

export function getCardsByPack(pack: string): CardDef[] {
  return currentCards.filter((c) => c.pack === pack);
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
