import { createHash } from 'node:crypto';
import { initCards } from '../src/game/cards/loader';
import { validateConstructedDeckIds } from '../src/game/cards/deckBuilder';
import type { CardDef } from '../src/game/types';
import { auditRuleEffects, ruleAuditFailures, type RuleAuditReport } from './rule-audit';

export const DERIVED_CARD_LANGUAGES = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;

export interface CardTranslationSnapshot {
  cardId: string;
  lang: string;
  nameText: string;
  effectText: string;
  reviewStatus: string;
}

export interface PresetDeckSnapshot {
  id: string;
  name: string;
  cardIds: string[];
}

export interface CardDatasetSnapshot {
  cards: CardDef[];
  translations: CardTranslationSnapshot[];
  presetDecks: PresetDeckSnapshot[];
  gameConfig: Record<string, unknown>;
}

export interface CardDatasetGateReport {
  datasetSha256: string;
  metrics: {
    cards: number;
    effectCards: number;
    effectLines: number;
    parsedEffectLines: number;
    verifiedTranslationRows: number;
    presetDecks: number;
  };
  checks: {
    expectedCardCount: boolean;
    uniqueCardIds: boolean;
    officialEnglishComplete: boolean;
    derivedTranslationsComplete: boolean;
    textIntegrity: boolean;
    presetDecksValid: boolean;
    gameConfigValid: boolean;
    serializationRoundTrip: boolean;
    ruleAuditPassed: boolean;
    gameSmokePassed: boolean;
  };
  ruleAudit: RuleAuditReport;
  failures: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function canonicalSnapshot(snapshot: CardDatasetSnapshot): CardDatasetSnapshot {
  return {
    cards: [...snapshot.cards].sort((left, right) => left.id.localeCompare(right.id)),
    translations: [...snapshot.translations].sort(
      (left, right) => left.cardId.localeCompare(right.cardId) || left.lang.localeCompare(right.lang),
    ),
    presetDecks: [...snapshot.presetDecks]
      .map((deck) => ({ ...deck, cardIds: [...deck.cardIds] }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    gameConfig: snapshot.gameConfig,
  };
}

export function cardDatasetSha256(snapshot: CardDatasetSnapshot): string {
  return createHash('sha256')
    .update(stableStringify(canonicalSnapshot(snapshot)))
    .digest('hex');
}

function validateTranslations(snapshot: CardDatasetSnapshot, failures: string[]): boolean {
  const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const rows = new Map<string, CardTranslationSnapshot>();
  let valid = true;

  for (const row of snapshot.translations) {
    const key = `${row.cardId}\u0000${row.lang}`;
    if (rows.has(key)) {
      failures.push(`duplicate translation row: ${row.cardId}/${row.lang}`);
      valid = false;
    }
    rows.set(key, row);
    if (!cardsById.has(row.cardId)) {
      failures.push(`translation references unknown card: ${row.cardId}/${row.lang}`);
      valid = false;
    }
  }

  for (const card of snapshot.cards) {
    for (const lang of DERIVED_CARD_LANGUAGES) {
      const row = rows.get(`${card.id}\u0000${lang}`);
      if (!row) {
        failures.push(`missing derived translation: ${card.id}/${lang}`);
        valid = false;
        continue;
      }
      if (row.reviewStatus !== 'verified' || !row.nameText.trim()) {
        failures.push(`unverified or empty translated name: ${card.id}/${lang}`);
        valid = false;
      }
      if (card.effect.trim() && !row.effectText.trim()) {
        failures.push(`empty translated effect: ${card.id}/${lang}`);
        valid = false;
      }
    }
  }

  const forbiddenRows = snapshot.translations.filter((row) => row.lang === 'ja' || row.lang === 'en');
  if (forbiddenRows.length > 0) {
    failures.push(`card_texts_i18n contains ${forbiddenRows.length} forbidden ja/en rows`);
    valid = false;
  }
  return valid;
}

function containsCorruptText(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0xfffd || codePoint === 0x7f || codePoint <= 0x08 || (codePoint >= 0x0b && codePoint <= 0x1f)) {
      return true;
    }
  }
  return false;
}

function validateTextIntegrity(snapshot: CardDatasetSnapshot, failures: string[]): boolean {
  const corruptFields: string[] = [];
  for (const card of snapshot.cards) {
    for (const field of [
      'name',
      'enNameOfficial',
      'song',
      'illustrator',
      'effect',
      'enEffectOfficial',
      'errata',
    ] as const) {
      if (containsCorruptText(card[field])) corruptFields.push(`card ${card.id}.${field}`);
    }
  }
  for (const row of snapshot.translations) {
    if (containsCorruptText(row.nameText)) corruptFields.push(`translation ${row.cardId}/${row.lang}.nameText`);
    if (containsCorruptText(row.effectText)) corruptFields.push(`translation ${row.cardId}/${row.lang}.effectText`);
  }
  if (corruptFields.length > 0) {
    failures.push(`corrupt Unicode text detected: ${corruptFields.join(', ')}`);
    return false;
  }
  return true;
}

function validatePresetDecks(snapshot: CardDatasetSnapshot, failures: string[]): boolean {
  initCards(snapshot.cards);
  if (snapshot.presetDecks.length === 0) {
    failures.push('no preset decks found');
    return false;
  }
  let valid = true;
  for (const deck of snapshot.presetDecks) {
    const problem = validateConstructedDeckIds(deck.cardIds);
    if (problem) {
      failures.push(`preset deck ${deck.id}: ${problem}`);
      valid = false;
    }
  }
  return valid;
}

export function evaluateCardDataset(
  snapshot: CardDatasetSnapshot,
  options: { expectedCardCount: number; expectedDatasetSha256?: string; gameSmokePassed: boolean },
): CardDatasetGateReport {
  const failures: string[] = [];
  const cardIds = snapshot.cards.map((card) => card.id);
  const expectedCardCount = snapshot.cards.length === options.expectedCardCount;
  if (!expectedCardCount) {
    failures.push(`expected ${options.expectedCardCount} cards, found ${snapshot.cards.length}`);
  }
  const uniqueCardIds = new Set(cardIds).size === cardIds.length;
  if (!uniqueCardIds) failures.push('card IDs are not unique');

  const missingOfficialEnglish = snapshot.cards.filter(
    (card) => !card.enNameOfficial?.trim() || (card.effect.trim() && !card.enEffectOfficial?.trim()),
  );
  const officialEnglishComplete = missingOfficialEnglish.length === 0;
  if (!officialEnglishComplete) {
    failures.push(`${missingOfficialEnglish.length} cards are missing required official English text`);
  }

  const derivedTranslationsComplete = validateTranslations(snapshot, failures);
  const textIntegrity = validateTextIntegrity(snapshot, failures);
  const presetDecksValid = validatePresetDecks(snapshot, failures);
  const gameConfigValid = snapshot.gameConfig.deckSize === 20 && snapshot.gameConfig.maxCopies === 2;
  if (!gameConfigValid) failures.push('game_config must set deckSize=20 and maxCopies=2');

  const canonical = canonicalSnapshot(snapshot);
  const serialized = stableStringify(canonical);
  const serializationRoundTrip = stableStringify(JSON.parse(serialized) as unknown) === serialized;
  if (!serializationRoundTrip) failures.push('dataset serialization is not deterministic');

  const datasetSha256 = cardDatasetSha256(snapshot);
  if (options.expectedDatasetSha256 && datasetSha256 !== options.expectedDatasetSha256.toLowerCase()) {
    failures.push(`dataset SHA-256 ${datasetSha256} does not match expected ${options.expectedDatasetSha256}`);
  }

  const ruleAudit = auditRuleEffects(snapshot.cards);
  const ruleFailures = ruleAuditFailures(ruleAudit);
  failures.push(...ruleFailures);
  const ruleAuditPassed = ruleFailures.length === 0;
  if (!options.gameSmokePassed) failures.push('game smoke failed against the release dataset');

  return {
    datasetSha256,
    metrics: {
      cards: snapshot.cards.length,
      effectCards: ruleAudit.effectCards,
      effectLines: ruleAudit.effectLines,
      parsedEffectLines: ruleAudit.parsedLines,
      verifiedTranslationRows: snapshot.translations.filter((row) => row.reviewStatus === 'verified').length,
      presetDecks: snapshot.presetDecks.length,
    },
    checks: {
      expectedCardCount,
      uniqueCardIds,
      officialEnglishComplete,
      derivedTranslationsComplete,
      textIntegrity,
      presetDecksValid,
      gameConfigValid,
      serializationRoundTrip,
      ruleAuditPassed,
      gameSmokePassed: options.gameSmokePassed,
    },
    ruleAudit,
    failures,
  };
}
