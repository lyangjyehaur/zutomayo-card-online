// 卡牌文本 i18n 共享模組。
// 日英有效官方文本來自 PG cards，其餘語言來自 card_texts_i18n。

import type { CardDef } from '../types';
import { getGameConfig } from './loader';
import { CARD_SONG_TITLES_I18N_CONFIG_KEY, normalizeSongTitleConfig } from './songTitleConfig';

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

function isCorrectedErrataSource(source: string): boolean {
  return (
    source === 'official_errata_notice' ||
    source === 'official_card_print_unaffected' ||
    source === 'official_card_print_corrected' ||
    source === 'official_japanese_errata_translation'
  );
}

function correctedTranslation(cardId: string, locale: string, field: 'name' | 'effect'): CardTextI18nEntry | null {
  const entry = reviewedTranslation(cardId, locale);
  if (!entry) return null;
  const source = field === 'name' ? entry.nameSource : entry.effectSource;
  return isCorrectedErrataSource(source) ? entry : null;
}

/**
 * Card-name display policy:
 * - Japanese uses the corrected official source text.
 * - English uses the effective official text stored on the card, including errata.
 * - Other locales use only reviewed derived translations.
 */
export function getLocalizedCardName(card: CardDef, locale: string): string {
  if (locale === 'ja') return card.name;
  if (locale === 'en') return canonicalizeSongTitleInCardName(card.enNameOfficial || card.name, card, locale);
  if (card.officialErrataAffectsName) {
    return canonicalizeSongTitleInCardName(
      correctedTranslation(card.id, locale, 'name')?.name || card.enNameOfficial || card.name,
      card,
      locale,
    );
  }
  return canonicalizeSongTitleInCardName(
    reviewedTranslation(card.id, locale)?.name || card.enNameOfficial || card.name,
    card,
    locale,
  );
}

/** Same provenance policy as getLocalizedCardName, applied to effects. */
export function getLocalizedCardEffect(card: CardDef, locale: string): string {
  if (locale === 'ja') return card.effect;
  if (locale === 'en') return canonicalizeSongTitleInCardEffect(card.enEffectOfficial || card.effect, card, locale);
  if (card.officialErrataAffectsEffect) {
    return canonicalizeSongTitleInCardEffect(
      correctedTranslation(card.id, locale, 'effect')?.effect || card.enEffectOfficial || card.effect,
      card,
      locale,
    );
  }
  return canonicalizeSongTitleInCardEffect(
    reviewedTranslation(card.id, locale)?.effect || card.enEffectOfficial || card.effect,
    card,
    locale,
  );
}

function songTitlesI18n(): Record<string, Record<string, string>> {
  return normalizeSongTitleConfig(getGameConfig()[CARD_SONG_TITLES_I18N_CONFIG_KEY]);
}

export function getLocalizedSongTitle(song: string, locale: string): string {
  if (!song || locale === 'ja') return song;
  const titles = songTitlesI18n()[song];
  if (!titles || typeof titles !== 'object') return song;
  return titles[locale] || (locale === 'zh-HK' ? titles['zh-TW'] : undefined) || song;
}

export function getLocalizedCardSearchTerms(card: CardDef, locales: readonly string[]): string[] {
  return locales.flatMap((locale) => [
    getLocalizedCardName(card, locale),
    getLocalizedSongTitle(card.song, locale),
    getLocalizedCardEffect(card, locale),
  ]);
}

export function matchesLocalizedCardSearch(card: CardDef, searchText: string, locales: readonly string[]): boolean {
  const query = searchText.toLowerCase();
  const normalizedCardNumberQuery = query.replace(/[^a-z0-9]/g, '');
  const isCardNumberQuery = /^[a-z0-9_-]+$/.test(query);
  return (
    getLocalizedCardSearchTerms(card, locales).some((term) => term.toLowerCase().includes(query)) ||
    card.id.toLowerCase().includes(query) ||
    (isCardNumberQuery &&
      card.id
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .includes(normalizedCardNumberQuery)) ||
    card.pack.toLowerCase().includes(query)
  );
}

function canonicalizeSongTitleInCardName(text: string, card: CardDef, locale: string): string {
  if (!card.song || !card.name.includes(card.song)) return text;
  const title = getLocalizedSongTitle(card.song, locale);
  if (!title || title === card.song) return text;
  return text.replace(/([（(《])([^（）()《》]+)([）)》])/, `$1${title}$3`);
}

function canonicalizeSongTitleInCardEffect(text: string, card: CardDef, locale: string): string {
  if (!card.song || !card.effect.includes(card.song)) return text;
  const title = getLocalizedSongTitle(card.song, locale);
  if (!title || title === card.song) return text;
  const occurrences = card.effect.split(card.song).length - 1;
  let replaced = 0;
  return text.replace(/([（(《])([^（）()《》]+)([）)》])/g, (match, open: string, _inner: string, close: string) => {
    if (replaced >= occurrences) return match;
    replaced += 1;
    return `${open}${title}${close}`;
  });
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
