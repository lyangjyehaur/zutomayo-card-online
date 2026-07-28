import type { CardPlayStatus, CardType, Element } from '../src/game/types';
import type { SynergyCard } from './cardSynergyModel';

const validElements = new Set<Element>(['闇', '炎', '電気', '風', 'カオス']);
const validTypes = new Set<CardType>(['Character', 'Enchant', 'Area Enchant']);
const validPlayStatuses = new Set<CardPlayStatus>(['playable', 'display_only', 'disabled']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Converts an unlisted-card review into analysis input only after a human has
 * explicitly verified its text. OCR and machine-suggestion drafts must never
 * influence candidate relations, including metadata-only relations.
 */
export function toVerifiedUnlistedSynergyCard(
  candidateId: string,
  machineSuggestion: Record<string, unknown>,
  humanReview: Record<string, unknown> | undefined,
): SynergyCard | null {
  if (humanReview?.textReviewStatus !== 'verified') return null;

  const review = { ...machineSuggestion, ...humanReview };
  const element = optionalString(review.element);
  const type = optionalString(review.type);
  const playStatus = optionalString(review.playStatus);
  return {
    id: optionalString(review.cardId) || candidateId,
    name: optionalString(review.nameJa) || candidateId,
    effect: optionalString(review.effectJa) || '',
    ...(element && validElements.has(element as Element) ? { element: element as Element } : {}),
    ...(type && validTypes.has(type as CardType) ? { type: type as CardType } : {}),
    ...(playStatus && validPlayStatuses.has(playStatus as CardPlayStatus)
      ? { playStatus: playStatus as CardPlayStatus }
      : { playStatus: 'disabled' as const }),
    source: 'unlisted-review',
  };
}
