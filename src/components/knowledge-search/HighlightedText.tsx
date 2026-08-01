import type { ReactNode } from 'react';
import type { KnowledgeSearchHighlight } from '../../api/client';

export function HighlightedText({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: KnowledgeSearchHighlight[];
}): ReactNode {
  const safeRanges = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(text.length, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<KnowledgeSearchHighlight[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
  if (safeRanges.length === 0) return text;

  const parts: ReactNode[] = [];
  let offset = 0;
  for (const range of safeRanges) {
    if (range.start > offset) parts.push(text.slice(offset, range.start));
    parts.push(
      <mark key={`${range.start}:${range.end}`} className="bg-accent-primary/20 text-inherit">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    offset = range.end;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}
