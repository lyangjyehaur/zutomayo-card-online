import { zhTW, type TranslationKey } from './zh-TW';

const dictionaries = {
  'zh-TW': zhTW,
} as const;

let currentLocale: keyof typeof dictionaries = 'zh-TW';

export function setLocale(locale: keyof typeof dictionaries): void {
  currentLocale = locale;
}

export function t(key: TranslationKey): string {
  return dictionaries[currentLocale][key] ?? key;
}

export type { TranslationKey };
