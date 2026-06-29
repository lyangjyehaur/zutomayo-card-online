export const CUSTOM_DECK_NAME = 'custom';
export const CUSTOM_DECK_STORAGE_KEY = 'zutomayo_custom_deck';

export function loadCustomDeckIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const data = localStorage.getItem(CUSTOM_DECK_STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasStoredCustomDeck(): boolean {
  const ids = loadCustomDeckIds();
  if (!ids || ids.length !== 20) return false;
  const counts = new Map<string, number>();
  for (const id of ids) {
    const count = (counts.get(id) ?? 0) + 1;
    if (count > 2) return false;
    counts.set(id, count);
  }
  return true;
}
