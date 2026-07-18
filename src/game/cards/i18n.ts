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

let cardTextsI18n: Record<string, Record<string, CardTextI18nEntry>> = {};
let _initialized = false;

export function isI18nInitialized(): boolean {
  return _initialized;
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

export async function loadCardTextsI18nFromAPI(): Promise<void> {
  const data = await fetchJson<Record<string, Record<string, CardTextI18nEntry>>>('/api/cards/texts');
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    initCardTextsI18n(data);
  }
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
  return configuredSongTitle(song, locale) ?? song;
}

function configuredSongTitle(song: string, locale: string): string | null {
  if (!song || locale === 'ja') return null;
  const titles = songTitlesI18n()[song];
  if (!titles || typeof titles !== 'object') return null;
  return titles[locale] || (locale === 'zh-HK' ? titles['zh-TW'] : undefined) || null;
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
  const title = configuredSongTitle(card.song, locale);
  if (!title) return text;
  const sourceSegments = delimitedSegments(card.name);
  const sourceSongIndex = sourceSegments.map((segment) => segment.inner).lastIndexOf(card.song);
  if (sourceSongIndex < 0) return text;

  const targetSegments = delimitedSegments(text);
  const targetIndex = targetSegments.length - (sourceSegments.length - sourceSongIndex);
  if (targetIndex < 0) return text;
  return replaceDelimitedSegments(text, targetSegments, [targetIndex], title);
}

function canonicalizeSongTitleInCardEffect(text: string, card: CardDef, locale: string): string {
  const title = configuredSongTitle(card.song, locale);
  if (!title) return text;
  const sourceSongIndexes = delimitedSegments(card.effect).flatMap((segment, index) =>
    segment.inner === card.song ? [index] : [],
  );
  if (sourceSongIndexes.length === 0) return text;

  const targetSegments = delimitedSegments(text);
  if (sourceSongIndexes.some((index) => index >= targetSegments.length)) return text;
  return replaceDelimitedSegments(text, targetSegments, sourceSongIndexes, title);
}

type DelimitedSegment = {
  start: number;
  end: number;
  open: string;
  inner: string;
  close: string;
};

function delimitedSegments(text: string): DelimitedSegment[] {
  return [...text.matchAll(/（([^（）]+)）|\(([^()]+)\)|《([^《》]+)》/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    open: match[0][0],
    inner: match[1] ?? match[2] ?? match[3] ?? '',
    close: match[0][match[0].length - 1] ?? '',
  }));
}

function replaceDelimitedSegments(
  text: string,
  segments: DelimitedSegment[],
  indexes: readonly number[],
  replacement: string,
): string {
  let result = text;
  for (const index of [...indexes].sort((left, right) => right - left)) {
    const segment = segments[index];
    result = `${result.slice(0, segment.start)}${segment.open}${replacement}${segment.close}${result.slice(segment.end)}`;
  }
  return result;
}

/**
 * 依 locale 取得卡牌效果翻譯。
 * 找不到對應語言時 fallback 到已發布英文，再 fallback 到官方日文；都沒有時回傳 null。
 */
export function getTranslatedEffect(cardId: string, locale: string): string | null {
  const entries = cardTextsI18n[cardId];
  if (!entries) return null;
  for (const language of [locale, 'en', 'ja']) {
    const entry = reviewedTranslation(cardId, language);
    if (entry?.effect) return entry.effect;
  }
  return null;
}
