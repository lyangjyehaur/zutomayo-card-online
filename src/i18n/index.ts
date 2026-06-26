import { useSyncExternalStore } from 'react';
import { en } from './en';
import { ja } from './ja';
import { zhCN } from './zh-CN';
import { zhHK } from './zh-HK';
import { zhTW, type TranslationKey } from './zh-TW';

export const availableLocales = ['zh-TW', 'zh-HK', 'zh-CN', 'ja', 'en'] as const;
export type Locale = typeof availableLocales[number];

const DEFAULT_LOCALE: Locale = 'zh-TW';
const LOCALE_STORAGE_KEY = 'zutomayo_locale';

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'zh-TW': zhTW,
  'zh-HK': zhHK,
  'zh-CN': zhCN,
  ja,
  en,
};

const localeLabels: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  'zh-HK': '粵語',
  'zh-CN': '简体中文',
  ja: '日本語',
  en: 'English',
};

const localeFlags: Record<Locale, string> = {
  'zh-TW': '🇹🇼',
  'zh-HK': '🇭🇰',
  'zh-CN': '🇨🇳',
  ja: '🇯🇵',
  en: '🇬🇧',
};

const listeners = new Set<() => void>();

function isLocale(value: string): value is Locale {
  return availableLocales.includes(value as Locale);
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function readStoredLocale(): Locale | null {
  try {
    const value = getStorage()?.getItem(LOCALE_STORAGE_KEY);
    return value && isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    getStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function matchBrowserLocale(language: string): Locale | null {
  const value = language.toLowerCase();
  if (value.startsWith('ja')) return 'ja';
  if (!value.startsWith('zh')) return null;
  if (value.includes('hans') || value.includes('-cn') || value.includes('-sg') || value.includes('-my')) return 'zh-CN';
  if (value.includes('-hk') || value.includes('-mo')) return 'zh-HK';
  if (value.includes('hant') || value.includes('-tw')) return 'zh-TW';
  return 'zh-TW';
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const languages = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
  for (const language of languages) {
    const locale = matchBrowserLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = readStoredLocale() ?? detectBrowserLocale();

// Set initial HTML lang attribute
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLocale;
}

function emitLocaleChange(): void {
  for (const listener of listeners) listener();
}

function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getLocaleLabel(locale: Locale): string {
  return localeLabels[locale];
}

export function getLocaleFlag(locale: Locale): string {
  return localeFlags[locale];
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  writeStoredLocale(locale);
  document.documentElement.lang = locale;
  emitLocaleChange();
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function t(key: TranslationKey): string {
  return dictionaries[currentLocale][key] ?? key;
}

export type { TranslationKey };
