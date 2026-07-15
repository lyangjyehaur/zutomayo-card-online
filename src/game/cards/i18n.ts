// 卡牌效果 i18n 共享模組。
// 資料來源：PG-backed API（伺服器於啟動時從 PostgreSQL 載入並提供）。

import type { CardDef } from '../types';

export interface CardTextI18nEntry {
  name: string;
  effect: string;
  nameSource: string;
  effectSource: string;
  reviewStatus: 'official' | 'verified' | 'pending_review';
  reviewNote: string;
}

let effectI18n: Record<string, Record<string, string>> = {};
let cardTextsI18n: Record<string, Record<string, CardTextI18nEntry>> = {};
let _initialized = false;

export function isI18nInitialized(): boolean {
  return _initialized;
}

/**
 * 從外部載入翻譯數據（遊戲伺服器啟動時呼叫，從 PostgreSQL 讀取）。
 */
export function initEffectI18n(data: Record<string, Record<string, string>>): void {
  effectI18n = data;
  _initialized = true;
}

export function initCardTextsI18n(data: Record<string, Record<string, CardTextI18nEntry>>): void {
  cardTextsI18n = data;
  _initialized = true;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 從 PG-backed API 載入所有卡牌翻譯（批次）。
 * API 不可用時保留既有（可能為空）的翻譯資料。
 */
export async function loadEffectI18nFromAPI(): Promise<void> {
  const data = await fetchJson<Record<string, Record<string, string>>>('/api/cards/i18n');
  if (data && typeof data === 'object') {
    initEffectI18n(data);
  }
}

export async function loadCardTextsI18nFromAPI(): Promise<void> {
  const data = await fetchJson<Record<string, Record<string, CardTextI18nEntry>>>('/api/cards/texts');
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    initCardTextsI18n(data);
    return;
  }
  await loadEffectI18nFromAPI();
}

function reviewedTranslation(cardId: string, locale: string): CardTextI18nEntry | null {
  const entry = cardTextsI18n[cardId]?.[locale];
  if (!entry || entry.reviewStatus === 'pending_review') return null;
  return entry;
}

/**
 * Card-name display policy:
 * - Japanese and English always use official card-print text.
 * - Other locales use only reviewed derived translations.
 * - Missing/unreviewed translations fall back to official English, then Japanese.
 */
export function getLocalizedCardName(card: CardDef, locale: string): string {
  if (locale === 'ja') return card.name;
  if (locale === 'en') return card.enNameOfficial || card.name;
  return reviewedTranslation(card.id, locale)?.name || card.enNameOfficial || card.name;
}

/** Same provenance policy as getLocalizedCardName, applied to effects. */
export function getLocalizedCardEffect(card: CardDef, locale: string): string {
  if (locale === 'ja') return card.effect;
  if (locale === 'en') return card.enEffectOfficial || card.effect;
  return reviewedTranslation(card.id, locale)?.effect || card.enEffectOfficial || card.effect;
}

/**
 * 依 locale 取得卡牌效果翻譯。
 * 找不到對應語言時 fallback 到日文原文，再找不到回傳 null。
 */
export function getTranslatedEffect(cardId: string, locale: string): string | null {
  const entry = effectI18n[cardId];
  if (!entry) return null;
  return entry[locale] || entry['ja'] || null;
}
