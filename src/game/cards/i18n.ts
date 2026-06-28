// 卡牌效果 i18n 共享模組。
// 翻譯資料由 scripts/translate-effects.ts 產生於 data/card-effects-i18n.json。
import effectI18nData from '../../../data/card-effects-i18n.json';

const effectI18n: Record<string, Record<string, string>> = effectI18nData as unknown as Record<
  string,
  Record<string, string>
>;

/**
 * 依 locale 取得卡牌效果翻譯。
 * 找不到對應語言時 fallback 到日文原文，再找不到回傳 null。
 */
export function getTranslatedEffect(cardId: string, locale: string): string | null {
  const entry = effectI18n[cardId];
  if (!entry) return null;
  return entry[locale] || entry['ja'] || null;
}
