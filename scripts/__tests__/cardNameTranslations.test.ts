import { describe, expect, it } from 'vitest';
import { auditCardNames, buildDerivedNameRows, sha256, type CardNamesAuditInput } from '../cardNameTranslations';

function auditInput(): CardNamesAuditInput {
  const names = {
    schemaVersion: 1 as const,
    cards: {
      card_1: {
        ja: '角色（原曲）',
        en: 'CHARACTER (ORIGINAL SONG)',
        'zh-TW': '角色（繁中歌名）',
        'zh-CN': '角色（简中歌名）',
        'zh-HK': '角色（繁中歌名）',
        ko: '캐릭터 (한국어 곡명)',
      },
    },
  };
  const songs = {
    原曲: {
      en: 'ORIGINAL SONG',
      'zh-TW': '繁中歌名',
      'zh-CN': '简中歌名',
      'zh-HK': '繁中歌名',
      ko: '한국어 곡명',
    },
  };
  const extraction = {
    cards: [
      {
        id: 'card_1',
        japaneseName: '角色（原曲）',
        enNameOfficial: 'CHARACTER (ORIGINAL SONG)',
        nameStatus: 'human_verified',
      },
    ],
  };
  const seed = { cards: [{ id: 'card_1', name: '角色（原曲）', song: '原曲' }] };
  const cardNamesBytes = Buffer.from(JSON.stringify(names));
  const songTitlesBytes = Buffer.from(JSON.stringify(songs));
  const officialTextBytes = Buffer.from(JSON.stringify(extraction));
  const cardSeedBytes = Buffer.from(JSON.stringify(seed));
  return {
    cardNamesBytes,
    songTitlesBytes,
    officialTextBytes,
    cardSeedBytes,
    names,
    songs,
    extraction,
    seed,
    errata: { errata: [] },
    review: {
      schemaVersion: 1,
      reviewedAt: '2026-07-18T00:00:00Z',
      reviewScope: 'all_card_names_and_song_titles',
      reviewBasis: ['corrected_official_japanese', 'human_verified_official_printed_english', 'canonical_song_titles'],
      cardNamesSourceFile: 'names.json',
      songTitlesSourceFile: 'songs.json',
      officialTextSourceFile: 'official.json',
      cardSeedSourceFile: 'seed.json',
      cardNamesSourceSha256: sha256(cardNamesBytes),
      songTitlesSourceSha256: sha256(songTitlesBytes),
      officialTextSourceSha256: sha256(officialTextBytes),
      cardSeedSourceSha256: sha256(cardSeedBytes),
      cardIdsSha256: sha256('card_1\n'),
      songIdsSha256: sha256('原曲\n'),
      cardCount: 1,
      songCount: 1,
      derivedNameLanguages: ['zh-TW', 'zh-CN', 'zh-HK', 'ko'],
      songTitleLanguages: ['en', 'zh-TW', 'zh-CN', 'zh-HK', 'ko'],
    },
  };
}

describe('derived card-name review data', () => {
  it('rejects source drift, mixed scripts, and a noncanonical song portion', () => {
    const input = auditInput();
    input.review.cardNamesSourceSha256 = 'stale';
    input.names.cards.card_1['zh-TW'] = '角色（錯誤歌名）';
    input.names.cards.card_1.ko = '角色 (한국어 곡명)';

    const problems = auditCardNames(input);

    expect(problems).toContain('card-name source SHA-256 does not match the reviewed manifest');
    expect(problems).toContain('card_1/zh-TW: card-name song portion must use the canonical title for 原曲');
    expect(problems).toContain('card_1/ko: name contains Japanese or Chinese text');
  });

  it('builds four derived rows and marks name errata provenance', () => {
    const input = auditInput();
    input.errata.errata = [{ cardId: 'card_1', fields: ['name'] }];

    const rows = buildDerivedNameRows(input);

    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardId: 'card_1',
          lang: 'zh-CN',
          nameText: '角色（简中歌名）',
          nameSource: 'official_japanese_errata_translation',
        }),
      ]),
    );
  });
});
