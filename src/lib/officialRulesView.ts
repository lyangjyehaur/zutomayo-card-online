import type { OfficialErrataItem, OfficialQaItem } from '../api/client';
import { getCardDef } from '../game/cards/loader';
import { getLocalizedCardName } from '../game/cards/i18n';
import { officialQaItemMatchesTag } from './officialQaTags';

export type OfficialQaSort = 'official' | 'latest';
export type OfficialErrataChangeFilter = 'all' | 'name' | 'effect';

export interface OfficialQaViewFilters {
  query: string;
  tag: string;
  cardId: string;
  locale: string;
  sort: OfficialQaSort;
}

export interface OfficialErrataViewFilters {
  query: string;
  change: OfficialErrataChangeFilter;
  pack: string;
  locale: string;
}

function normalized(value: string, locale: string): string {
  return value.trim().toLocaleLowerCase(locale);
}

export function filterAndSortOfficialQa(
  items: OfficialQaItem[],
  { query, tag, cardId, locale, sort }: OfficialQaViewFilters,
): OfficialQaItem[] {
  const needle = normalized(query, locale);
  const filtered = items.filter((item) => {
    if (!officialQaItemMatchesTag(item, tag)) return false;
    if (cardId && !item.relatedCardIds.includes(cardId)) return false;
    if (!needle) return true;

    const relatedCardNames = item.relatedCardIds.flatMap((relatedCardId) => {
      const card = getCardDef(relatedCardId);
      return card ? [getLocalizedCardName(card, locale), card.name] : [];
    });
    return [
      item.localized.question,
      item.localized.answer,
      item.source.question,
      item.source.answer,
      ...item.tags,
      ...item.tagIds,
      ...item.relatedCardIds,
      ...relatedCardNames,
    ]
      .join('\n')
      .toLocaleLowerCase(locale)
      .includes(needle);
  });

  return filtered.sort((left, right) => {
    if (sort === 'latest') {
      return right.publishedAt.localeCompare(left.publishedAt) || right.number - left.number;
    }
    return left.number - right.number;
  });
}

export function officialErrataPacks(items: OfficialErrataItem[]): string[] {
  return [...new Set(items.map((item) => item.pack).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function filterOfficialErrata(
  items: OfficialErrataItem[],
  { query, change, pack, locale }: OfficialErrataViewFilters,
): OfficialErrataItem[] {
  const needle = normalized(query, locale);
  return items
    .filter((item) => {
      if (change === 'name' && !item.affectsName) return false;
      if (change === 'effect' && !item.affectsEffect) return false;
      if (pack && item.pack !== pack) return false;
      if (!needle) return true;
      return [
        item.cardName,
        item.cardNameJa,
        item.cardId,
        item.cardNumber,
        item.pack,
        item.rarity,
        item.localized.incorrectText,
        item.localized.correctedText,
        item.source.incorrectText,
        item.source.correctedText,
      ]
        .join('\n')
        .toLocaleLowerCase(locale)
        .includes(needle);
    })
    .sort(
      (left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.errataId.localeCompare(left.errataId),
    );
}
