import type { OfficialQaItem } from '../api/client';

export interface OfficialQaTagOption {
  id: string;
  label: string;
}

type QaTagItem = Pick<OfficialQaItem, 'tagIds' | 'tags'>;

export function officialQaTagOptions(items: QaTagItem[], locale: string): OfficialQaTagOption[] {
  const labelsById = new Map<string, string>();
  for (const item of items) {
    item.tags.forEach((label, index) => {
      const id = item.tagIds?.[index] || label;
      if (id && label && !labelsById.has(id)) labelsById.set(id, label);
    });
  }
  return [...labelsById]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
}

export function officialQaItemMatchesTag(item: QaTagItem, selectedTag: string): boolean {
  return !selectedTag || item.tagIds?.includes(selectedTag) || item.tags.includes(selectedTag);
}

export function officialQaTagOptionIsSelected(option: OfficialQaTagOption, selectedTag: string): boolean {
  return option.id === selectedTag || option.label === selectedTag;
}
