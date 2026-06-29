// 卡牌效果 i18n 共享模組。
// 資料來源優先順序：API（PG-backed）→ 靜態 JSON（伺服器提供）。

let effectI18n: Record<string, Record<string, string>> = {};
let _initialized = false;

export function isI18nInitialized(): boolean {
  return _initialized;
}

/**
 * 從外部載入翻譯數據（遊戲伺服器啟動時呼叫，讀取 data/card-effects-i18n.json 檔案系統）。
 */
export function initEffectI18n(data: Record<string, Record<string, string>>): void {
  effectI18n = data;
  _initialized = true;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(path, { cache: 'force-cache' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 從 API 載入所有卡牌翻譯（批次）。
 * API 不可用時 fallback 到靜態 /data/card-effects-i18n.json。
 */
export async function loadEffectI18nFromAPI(): Promise<void> {
  // 先試 PG-backed API 批次端點
  const data = await fetchJson<Record<string, Record<string, string>>>('/api/cards/i18n');
  if (data && typeof data === 'object') {
    initEffectI18n(data);
    return;
  }
  // Fallback：靜態 JSON（Vite dev / game server 提供）
  const staticData = await fetchJson<Record<string, Record<string, string>>>('/data/card-effects-i18n.json');
  if (staticData && typeof staticData === 'object') {
    initEffectI18n(staticData);
  }
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
