// 4 themed preset decks by element.
// 每次開局從該屬性卡池隨機抽取 20 張，不再固定卡牌組成，確保同屬性對戰每次都不同。
// カオス 屬性卡池不足（僅 4 張），不提供 preset。

import type { Element } from '../types';

export const PRESET_DECKS: Record<string, { name: string; element: Element }> = {
  dark: {
    name: '闇デッキ — Dark Side',
    element: '闇',
  },
  flame: {
    name: '炎デッキ — Flame Burst',
    element: '炎',
  },
  electric: {
    name: '電気デッキ — Thunder Strike',
    element: '電気',
  },
  wind: {
    name: '風デッキ — Wind Rider',
    element: '風',
  },
};
