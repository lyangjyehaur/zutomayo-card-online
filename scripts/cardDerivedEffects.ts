import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const DERIVED_EFFECT_LANGS = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;
export type DerivedEffectLang = (typeof DERIVED_EFFECT_LANGS)[number];

export type DerivedEffects = Record<string, Record<string, string>>;

export type ExtractedEffectCard = {
  id: string;
  japaneseEffect: string;
  enEffectOfficial: string;
  effectStatus: string;
};

export type EffectErrata = {
  cardId: string;
  fields: Array<'name' | 'effect'>;
};

export type DerivedEffectsReview = {
  schemaVersion: 1;
  reviewedAt: string;
  reviewScope: 'all_effect_rows';
  reviewBasis: ['corrected_official_japanese', 'human_verified_official_printed_english'];
  sourceFile: string;
  sourceSha256: string;
  effectCardIdsSha256: string;
  effectErrataCardIdsSha256: string;
  cardCount: number;
  languages: DerivedEffectLang[];
};

export type DerivedEffectRow = {
  cardId: string;
  lang: DerivedEffectLang;
  effectText: string;
  effectSource: 'admin_bilingual_translation' | 'official_japanese_errata_translation';
};

export type DerivedEffectsAuditInput = {
  sourceBytes: Buffer;
  effects: DerivedEffects;
  extraction: { cards: ExtractedEffectCard[] };
  errata: { errata: EffectErrata[] };
  review: DerivedEffectsReview;
};

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function idListSha256(ids: string[]): string {
  return sha256(`${ids.join('\n')}\n`);
}

function mechanicNumbers(value: string, lang: 'ja' | DerivedEffectLang): string[] {
  let normalized = value.normalize('NFKC').toLowerCase();
  if (lang === 'ja') {
    normalized = normalized
      .replace(/★(?=\d)/g, '')
      .replace(/★+/g, (stars) => ` ${stars.length} `)
      .replace(/1(?=枚|つ|個)/g, '');
  } else {
    normalized = normalized
      .replace(/◆+/g, (symbols) => ` ${symbols.length} `)
      .replace(/★+/g, (symbols) => ` ${symbols.length} `)
      .replace(/\+{2,}/g, (symbols) => ` ${symbols.length} `);
    if (lang !== 'ko') {
      normalized = normalized
        .replace(/[兩两二](?=[種种張张枚個个])/g, '2')
        .replace(/三(?=[種种張张枚個个])/g, '3')
        .replace(/四(?=[種种張张枚個个])/g, '4')
        .replace(/五(?=[種种張张枚個个])/g, '5')
        .replace(/六(?=[種种張张枚個个])/g, '6');
    }
  }
  return sortedUnique(
    [...normalized.matchAll(/\d+/g)].map((match) => String(Number(match[0]))).filter((number) => number !== '1'),
  );
}

function attackAdjustment(value: string, lang: 'ja' | DerivedEffectLang): string | null {
  const match =
    lang === 'ja'
      ? value.normalize('NFKC').match(/攻撃力\s*([+-])\s*(\d+)/)
      : lang === 'ko'
        ? value.normalize('NFKC').match(/공격력\s*([+-])\s*(\d+)/)
        : value.normalize('NFKC').match(/攻[擊击]力\s*([+-])\s*(\d+)/);
  return match ? `${match[1]}${Number(match[2])}` : null;
}

function exactKeys(value: Record<string, string>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function auditDerivedEffects(input: DerivedEffectsAuditInput): string[] {
  const problems: string[] = [];
  const effectCards = input.extraction.cards.filter((card) => card.japaneseEffect.trim());
  const effectIds = effectCards.map((card) => card.id);
  const effectIdSet = new Set(effectIds);
  const sourceIds = Object.keys(input.effects).sort();
  const expectedIds = [...effectIds].sort();
  const effectErrataIds = input.errata.errata
    .filter((entry) => entry.fields.includes('effect'))
    .map((entry) => entry.cardId)
    .sort();

  if (input.review.schemaVersion !== 1) problems.push('review manifest schemaVersion must be 1');
  if (input.review.reviewScope !== 'all_effect_rows') {
    problems.push('review manifest must cover all effect rows');
  }
  if (
    JSON.stringify(input.review.reviewBasis) !==
    JSON.stringify(['corrected_official_japanese', 'human_verified_official_printed_english'])
  ) {
    problems.push('review manifest has an unsupported review basis');
  }
  if (input.review.sourceSha256 !== sha256(input.sourceBytes)) {
    problems.push('derived-effect source SHA-256 does not match the reviewed manifest');
  }
  if (input.review.effectCardIdsSha256 !== idListSha256(effectIds)) {
    problems.push('official effect-card ID list does not match the reviewed manifest');
  }
  if (input.review.effectErrataCardIdsSha256 !== idListSha256(effectErrataIds)) {
    problems.push('effect errata ID list does not match the reviewed manifest');
  }
  if (input.review.cardCount !== effectCards.length || effectCards.length !== 250) {
    problems.push(`expected 250 reviewed effect cards, got ${effectCards.length}`);
  }
  if (JSON.stringify(input.review.languages) !== JSON.stringify(DERIVED_EFFECT_LANGS)) {
    problems.push('review manifest languages must exactly match the supported derived languages');
  }
  if (JSON.stringify(sourceIds) !== JSON.stringify(expectedIds)) {
    problems.push('derived-effect card IDs do not exactly match official effect-card IDs');
  }

  const translationsByJapanese = new Map<string, Array<{ cardId: string; row: Record<string, string> }>>();
  for (const card of effectCards) {
    if (card.effectStatus !== 'human_verified' || !card.enEffectOfficial.trim()) {
      problems.push(`${card.id}: official printed English effect is not human-verified`);
    }
    const row = input.effects[card.id];
    if (!row) continue;
    if (!exactKeys(row, ['ja', ...DERIVED_EFFECT_LANGS])) {
      problems.push(`${card.id}: row must contain ja and four derived languages only (legacy en is forbidden)`);
    }
    if (row.ja !== card.japaneseEffect) {
      problems.push(`${card.id}: Japanese effect differs from the corrected official source`);
    }
    const duplicateGroup = translationsByJapanese.get(card.japaneseEffect) ?? [];
    duplicateGroup.push({ cardId: card.id, row });
    translationsByJapanese.set(card.japaneseEffect, duplicateGroup);

    for (const lang of DERIVED_EFFECT_LANGS) {
      const text = row[lang];
      if (typeof text !== 'string' || !text.trim()) {
        problems.push(`${card.id}/${lang}: reviewed effect is empty`);
        continue;
      }
      if (text.includes('\\n') || text.includes('\r')) {
        problems.push(`${card.id}/${lang}: effect contains an escaped or CR newline`);
      }
      if (lang.startsWith('zh') && /[ぁ-ゖァ-ヺ\p{Script=Hangul}]/u.test(text)) {
        problems.push(`${card.id}/${lang}: effect contains Japanese kana or Korean text`);
      }
      if (lang === 'ko' && /[\p{Script=Han}ぁ-ゖァ-ヺ，。；：！？（）【】「」]/u.test(text)) {
        problems.push(`${card.id}/ko: effect contains Japanese/Chinese text or punctuation`);
      }
      const japaneseNumbers = mechanicNumbers(card.japaneseEffect, 'ja');
      const translatedNumbers = mechanicNumbers(text, lang);
      if (JSON.stringify(japaneseNumbers) !== JSON.stringify(translatedNumbers)) {
        problems.push(
          `${card.id}/${lang}: mechanic numbers differ ja=[${japaneseNumbers}] translation=[${translatedNumbers}]`,
        );
      }
      const japaneseAttack = attackAdjustment(card.japaneseEffect, 'ja');
      const translatedAttack = attackAdjustment(text, lang);
      if (japaneseAttack && translatedAttack && japaneseAttack !== translatedAttack) {
        problems.push(
          `${card.id}/${lang}: attack adjustment differs ja=${japaneseAttack} translation=${translatedAttack}`,
        );
      }
    }
  }

  for (const group of translationsByJapanese.values()) {
    if (group.length < 2) continue;
    for (const lang of DERIVED_EFFECT_LANGS) {
      if (new Set(group.map(({ row }) => row[lang])).size > 1) {
        problems.push(
          `${group.map(({ cardId }) => cardId).join(',')}/${lang}: identical Japanese has inconsistent text`,
        );
      }
    }
  }

  for (const cardId of effectErrataIds) {
    if (!effectIdSet.has(cardId)) problems.push(`${cardId}: effect errata card has no official effect`);
  }

  const allKorean = Object.values(input.effects)
    .map((row) => row.ko || '')
    .join('\n');
  for (const forbidden of ['번개', '파워 충전소', '배틀필드', '핸드', '불 속성', '암속성', '전기속성']) {
    if (allKorean.includes(forbidden)) problems.push(`ko: legacy term remains: ${forbidden}`);
  }

  return problems;
}

export function loadDerivedEffectsAuditInput(
  sourcePath = 'data/card-effects-i18n.json',
  extractionPath = 'data/card-english-extraction.json',
  errataPath = 'data/card-official-errata.json',
  reviewPath = 'data/card-derived-effects-review.json',
): DerivedEffectsAuditInput {
  const sourceBytes = readFileSync(sourcePath);
  return {
    sourceBytes,
    effects: JSON.parse(sourceBytes.toString('utf8')) as DerivedEffects,
    extraction: JSON.parse(readFileSync(extractionPath, 'utf8')) as { cards: ExtractedEffectCard[] },
    errata: JSON.parse(readFileSync(errataPath, 'utf8')) as { errata: EffectErrata[] },
    review: JSON.parse(readFileSync(reviewPath, 'utf8')) as DerivedEffectsReview,
  };
}

export function buildDerivedEffectRows(input: DerivedEffectsAuditInput): DerivedEffectRow[] {
  const errataEffectIds = new Set(
    input.errata.errata.filter((entry) => entry.fields.includes('effect')).map((entry) => entry.cardId),
  );
  const rows: DerivedEffectRow[] = [];
  for (const cardId of Object.keys(input.effects).sort()) {
    for (const lang of DERIVED_EFFECT_LANGS) {
      rows.push({
        cardId,
        lang,
        effectText: input.effects[cardId][lang],
        effectSource: errataEffectIds.has(cardId)
          ? 'official_japanese_errata_translation'
          : 'admin_bilingual_translation',
      });
    }
  }
  return rows;
}
