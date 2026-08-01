import type { CardDef, CardInstance } from '../types';
import { Sentry } from '../../sentry';
import { acceptCardDataResponse } from './dataContract';

const cardMap = new Map<string, CardDef>();
const fallbackCardMap = new Map<string, CardDef>();
let currentCards: CardDef[] = [];
let currentConfig: Record<string, unknown> = {};
let cardsRefreshPromise: Promise<CardDef[]> | null = null;
let _initialized = false;
let cardsRevision = 0;
const PUBLIC_DATA_FETCH_TIMEOUT_MS = 15_000;
const PUBLIC_DATA_FETCH_ATTEMPTS = 2;
const PUBLIC_DATA_RETRY_DELAY_MS = 250;

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
  cardsRevision += 1;
}

export function getCardsRevision(): number {
  return cardsRevision;
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
  timeoutMs = PUBLIC_DATA_FETCH_TIMEOUT_MS,
): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  let lastError: unknown = new Error('Request failed');

  for (let attempt = 1; attempt <= PUBLIC_DATA_FETCH_ATTEMPTS; attempt += 1) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(path, { cache, signal: controller?.signal });
      if (response.ok) {
        const contract = path.startsWith('/api/cards') ? acceptCardDataResponse(response) : null;
        if (path.startsWith('/api/cards') && !contract) return null;
        const data = (await response.json()) as T;
        if (path === '/api/cards' && Array.isArray(data) && contract && data.length !== contract.cardCount) return null;
        return data;
      }
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && ![408, 425, 429].includes(response.status)) return null;
    } catch (err) {
      lastError = err;
    } finally {
      if (timeout !== null) globalThis.clearTimeout(timeout);
    }

    if (attempt < PUBLIC_DATA_FETCH_ATTEMPTS) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, PUBLIC_DATA_RETRY_DELAY_MS));
    }
  }

  // 卡牌與遊戲配置是啟動基礎資料；重試耗盡後保留可觀測證據。
  Sentry.addBreadcrumb({
    category: 'card-loader',
    message: `fetchJson failed: ${path}`,
    level: 'warning',
    data: {
      path,
      attempts: PUBLIC_DATA_FETCH_ATTEMPTS,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    },
  });
  return null;
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
