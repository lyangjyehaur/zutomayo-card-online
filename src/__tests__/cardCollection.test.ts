import { describe, expect, it } from 'vitest';
import {
  clearLocalOwnedCardIds,
  readLocalOwnedCardIds,
  setLocalCardOwned,
  writeLocalOwnedCardIds,
} from '../cardCollection';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('local card collection', () => {
  it('normalizes, toggles, and clears owned card ids', () => {
    const storage = memoryStorage();
    expect(writeLocalOwnedCardIds(['2nd_010', '1st_001', '2nd_010'], storage)).toEqual(['1st_001', '2nd_010']);
    expect(setLocalCardOwned('promo_001', true, storage)).toEqual(['1st_001', '2nd_010', 'promo_001']);
    expect(setLocalCardOwned('2nd_010', false, storage)).toEqual(['1st_001', 'promo_001']);
    clearLocalOwnedCardIds(storage);
    expect(readLocalOwnedCardIds(storage)).toEqual([]);
  });

  it('fails closed for malformed local data', () => {
    const storage = memoryStorage();
    storage.setItem('zutomayo_card_collection_v1', '{bad json');
    expect(readLocalOwnedCardIds(storage)).toEqual([]);
  });

  it('keeps normalized UI state when browser storage rejects writes', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
    storage.removeItem = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };

    expect(writeLocalOwnedCardIds(['2nd_2', '1st_1', '2nd_2'], storage)).toEqual(['1st_1', '2nd_2']);
    expect(() => clearLocalOwnedCardIds(storage)).not.toThrow();
  });
});
