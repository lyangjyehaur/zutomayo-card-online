import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const DERIVED_NAME_LANGS = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;
export const SONG_TITLE_LANGS = ['en', ...DERIVED_NAME_LANGS] as const;

export type DerivedNameLang = (typeof DERIVED_NAME_LANGS)[number];
export type SongTitleLang = (typeof SONG_TITLE_LANGS)[number];
export type LocalizedCardName = { ja: string; en: string } & Record<DerivedNameLang, string>;
export type LocalizedSongTitle = Record<SongTitleLang, string>;

export type CardNamesSource = {
  schemaVersion: 1;
  cards: Record<string, LocalizedCardName>;
};

export type SongTitlesSource = Record<string, LocalizedSongTitle>;

export type ExtractedNameCard = {
  id: string;
  japaneseName: string;
  enNameOfficial: string;
  nameStatus: string;
};

export type SeedCard = {
  id: string;
  name: string;
  song: string;
};

export type NameErrata = {
  cardId: string;
  fields: Array<'name' | 'effect'>;
};

export type CardNamesReview = {
  schemaVersion: 1;
  reviewedAt: string;
  reviewScope: 'all_card_names_and_song_titles';
  reviewBasis: ['corrected_official_japanese', 'human_verified_official_printed_english', 'canonical_song_titles'];
  cardNamesSourceFile: string;
  songTitlesSourceFile: string;
  officialTextSourceFile: string;
  cardSeedSourceFile: string;
  cardNamesSourceSha256: string;
  songTitlesSourceSha256: string;
  officialTextSourceSha256: string;
  cardSeedSourceSha256: string;
  cardIdsSha256: string;
  songIdsSha256: string;
  cardCount: number;
  songCount: number;
  derivedNameLanguages: DerivedNameLang[];
  songTitleLanguages: SongTitleLang[];
};

export type CardNamesAuditInput = {
  cardNamesBytes: Buffer;
  songTitlesBytes: Buffer;
  officialTextBytes: Buffer;
  cardSeedBytes: Buffer;
  names: CardNamesSource;
  songs: SongTitlesSource;
  extraction: { cards: ExtractedNameCard[] };
  seed: { cards: SeedCard[] };
  errata: { errata: NameErrata[] };
  review: CardNamesReview;
};

export type DerivedNameRow = {
  cardId: string;
  lang: DerivedNameLang;
  nameText: string;
  nameSource: 'admin_bilingual_translation' | 'official_japanese_errata_translation';
};

const EMBEDDED_SONGS_BY_CARD = new Map([
  ['1st_46', '正義'],
  ['1st_101', '正義'],
  ['2nd_61', '正義'],
  ['3rd_53', '残機'],
]);

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function idListSha256(ids: string[]): string {
  return sha256(`${ids.join('\n')}\n`);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function translatedSongRequired(cardId: string, japaneseName: string, song: string): boolean {
  return (
    japaneseName === song ||
    japaneseName.endsWith(`（${song}）`) ||
    japaneseName.endsWith(`(${song})`) ||
    japaneseName.endsWith(` (${song})`) ||
    EMBEDDED_SONGS_BY_CARD.get(cardId) === song
  );
}

function auditReviewManifest(input: CardNamesAuditInput, problems: string[]): void {
  const { review } = input;
  if (review.schemaVersion !== 1) problems.push('review manifest schemaVersion must be 1');
  if (review.reviewScope !== 'all_card_names_and_song_titles') {
    problems.push('review manifest must cover all card names and song titles');
  }
  if (
    JSON.stringify(review.reviewBasis) !==
    JSON.stringify(['corrected_official_japanese', 'human_verified_official_printed_english', 'canonical_song_titles'])
  ) {
    problems.push('review manifest has an unsupported review basis');
  }
  const sourceChecks: Array<[string, string, Buffer]> = [
    ['card-name', review.cardNamesSourceSha256, input.cardNamesBytes],
    ['song-title', review.songTitlesSourceSha256, input.songTitlesBytes],
    ['official-text', review.officialTextSourceSha256, input.officialTextBytes],
    ['card-seed', review.cardSeedSourceSha256, input.cardSeedBytes],
  ];
  for (const [label, expected, bytes] of sourceChecks) {
    if (expected !== sha256(bytes)) problems.push(`${label} source SHA-256 does not match the reviewed manifest`);
  }
  if (JSON.stringify(review.derivedNameLanguages) !== JSON.stringify(DERIVED_NAME_LANGS)) {
    problems.push('review manifest derived-name languages must exactly match supported languages');
  }
  if (JSON.stringify(review.songTitleLanguages) !== JSON.stringify(SONG_TITLE_LANGS)) {
    problems.push('review manifest song-title languages must exactly match supported languages');
  }
}

export function auditCardNames(input: CardNamesAuditInput): string[] {
  const problems: string[] = [];
  auditReviewManifest(input, problems);

  const extractionIds = input.extraction.cards.map((card) => card.id);
  const sourceIds = Object.keys(input.names.cards).sort();
  const expectedIds = [...extractionIds].sort();
  const songIds = Object.keys(input.songs).sort();
  const referencedSongs = sortedUnique(input.seed.cards.map((card) => card.song).filter(Boolean));

  if (input.names.schemaVersion !== 1) problems.push('card-name source schemaVersion must be 1');
  if (input.extraction.cards.length !== 422 || input.review.cardCount !== 422) {
    problems.push(`expected 422 reviewed card names, got ${input.extraction.cards.length}`);
  }
  if (songIds.length !== 42 || input.review.songCount !== 42) {
    problems.push(`expected 42 reviewed song titles, got ${songIds.length}`);
  }
  if (JSON.stringify(sourceIds) !== JSON.stringify(expectedIds)) {
    problems.push('card-name IDs do not exactly match the official text source');
  }
  if (input.review.cardIdsSha256 !== idListSha256(extractionIds)) {
    problems.push('official card ID list does not match the reviewed manifest');
  }
  if (input.review.songIdsSha256 !== idListSha256(songIds)) {
    problems.push('song ID list does not match the reviewed manifest');
  }
  for (const song of referencedSongs) {
    if (!input.songs[song]) problems.push(`${song}: card data references a song missing from the canonical table`);
  }

  const seedById = new Map(input.seed.cards.map((card) => [card.id, card]));
  const translationsByJapanese = new Map<string, Array<{ cardId: string; row: LocalizedCardName }>>();
  for (const card of input.extraction.cards) {
    if (card.nameStatus !== 'human_verified' || !card.enNameOfficial.trim()) {
      problems.push(`${card.id}: official printed English name is not human-verified`);
    }
    const seedCard = seedById.get(card.id);
    if (!seedCard || seedCard.name !== card.japaneseName) {
      problems.push(`${card.id}: card seed differs from the corrected official Japanese name`);
    }
    const row = input.names.cards[card.id];
    if (!row) continue;
    if (!hasExactKeys(row, ['ja', 'en', ...DERIVED_NAME_LANGS])) {
      problems.push(`${card.id}: row must contain ja, en, and four derived languages only`);
    }
    if (row.ja !== card.japaneseName) {
      problems.push(`${card.id}: Japanese name differs from the corrected official source`);
    }
    if (row.en !== card.enNameOfficial) {
      problems.push(`${card.id}: English name differs from the human-verified official print`);
    }
    const duplicateGroup = translationsByJapanese.get(card.japaneseName) ?? [];
    duplicateGroup.push({ cardId: card.id, row });
    translationsByJapanese.set(card.japaneseName, duplicateGroup);

    for (const lang of DERIVED_NAME_LANGS) {
      const value = row[lang];
      if (typeof value !== 'string' || !value.trim()) {
        problems.push(`${card.id}/${lang}: reviewed name is empty`);
        continue;
      }
      if (lang.startsWith('zh') && /[ぁ-ゖァ-ヺ\p{Script=Hangul}]/u.test(value)) {
        problems.push(`${card.id}/${lang}: name contains Japanese kana or Korean text`);
      }
      if (lang === 'ko' && /[\p{Script=Han}ぁ-ゖァ-ヺ]/u.test(value)) {
        problems.push(`${card.id}/ko: name contains Japanese or Chinese text`);
      }
      if (lang === 'zh-HK' && value !== row['zh-TW']) {
        problems.push(`${card.id}/zh-HK: reviewed policy requires the Traditional Chinese card name`);
      }
      for (const [song, titles] of Object.entries(input.songs)) {
        if (translatedSongRequired(card.id, card.japaneseName, song) && !value.includes(titles[lang])) {
          problems.push(`${card.id}/${lang}: card-name song portion must use the canonical title for ${song}`);
        }
      }
    }
  }

  for (const group of translationsByJapanese.values()) {
    if (group.length < 2) continue;
    for (const lang of DERIVED_NAME_LANGS) {
      if (new Set(group.map(({ row }) => row[lang])).size > 1) {
        problems.push(
          `${group.map(({ cardId }) => cardId).join(',')}/${lang}: identical Japanese has inconsistent names`,
        );
      }
    }
  }

  for (const [song, titles] of Object.entries(input.songs)) {
    if (!hasExactKeys(titles, SONG_TITLE_LANGS)) {
      problems.push(`${song}: song row must contain exactly five supported languages`);
    }
    for (const lang of SONG_TITLE_LANGS) {
      const value = titles[lang];
      if (typeof value !== 'string' || !value.trim()) {
        problems.push(`${song}/${lang}: reviewed song title is empty`);
        continue;
      }
      if (lang.startsWith('zh') && /[ぁ-ゖァ-ヺ\p{Script=Hangul}]/u.test(value)) {
        problems.push(`${song}/${lang}: song title contains Japanese kana or Korean text`);
      }
      if (lang === 'ko' && /[\p{Script=Han}ぁ-ゖァ-ヺ]/u.test(value)) {
        problems.push(`${song}/ko: song title contains Japanese or Chinese text`);
      }
      if (lang === 'zh-HK' && value !== titles['zh-TW']) {
        problems.push(`${song}/zh-HK: reviewed policy requires the Traditional Chinese song title`);
      }
    }
  }

  return problems;
}

export function loadCardNamesAuditInput(
  cardNamesPath = 'data/card-names-i18n.json',
  songTitlesPath = 'data/card-song-titles-i18n.json',
  officialTextPath = 'data/card-english-extraction.json',
  cardSeedPath = 'data/e2e-card-seed.json',
  errataPath = 'data/card-official-errata.json',
  reviewPath = 'data/card-derived-names-review.json',
): CardNamesAuditInput {
  const cardNamesBytes = readFileSync(cardNamesPath);
  const songTitlesBytes = readFileSync(songTitlesPath);
  const officialTextBytes = readFileSync(officialTextPath);
  const cardSeedBytes = readFileSync(cardSeedPath);
  return {
    cardNamesBytes,
    songTitlesBytes,
    officialTextBytes,
    cardSeedBytes,
    names: JSON.parse(cardNamesBytes.toString('utf8')) as CardNamesSource,
    songs: JSON.parse(songTitlesBytes.toString('utf8')) as SongTitlesSource,
    extraction: JSON.parse(officialTextBytes.toString('utf8')) as { cards: ExtractedNameCard[] },
    seed: JSON.parse(cardSeedBytes.toString('utf8')) as { cards: SeedCard[] },
    errata: JSON.parse(readFileSync(errataPath, 'utf8')) as { errata: NameErrata[] },
    review: JSON.parse(readFileSync(reviewPath, 'utf8')) as CardNamesReview,
  };
}

export function buildDerivedNameRows(input: CardNamesAuditInput): DerivedNameRow[] {
  const errataNameIds = new Set(
    input.errata.errata.filter((entry) => entry.fields.includes('name')).map((entry) => entry.cardId),
  );
  const rows: DerivedNameRow[] = [];
  for (const cardId of Object.keys(input.names.cards).sort()) {
    for (const lang of DERIVED_NAME_LANGS) {
      rows.push({
        cardId,
        lang,
        nameText: input.names.cards[cardId][lang],
        nameSource: errataNameIds.has(cardId) ? 'official_japanese_errata_translation' : 'admin_bilingual_translation',
      });
    }
  }
  return rows;
}
