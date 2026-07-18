import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDef } from '../../types';
import {
  getLocalizedCardEffect,
  getLocalizedCardName,
  getLocalizedCardSearchTerms,
  initCardTextsI18n,
  matchesLocalizedCardSearch,
} from '../i18n';

const { gameConfig } = vi.hoisted(() => ({ gameConfig: {} as Record<string, unknown> }));

vi.mock('../loader', () => ({
  getGameConfig: () => gameConfig,
}));

const card: CardDef = {
  id: 'test_1',
  name: '公式日本語名',
  enNameOfficial: 'OFFICIAL ENGLISH NAME',
  pack: 'test',
  song: '',
  illustrator: '',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 20 },
  powerCost: 0,
  sendToPower: 1,
  effect: '公式日本語効果',
  enEffectOfficial: 'OFFICIAL ENGLISH EFFECT',
  image: '',
  errata: '',
};

describe('localized card text policy', () => {
  beforeEach(() => {
    initCardTextsI18n({});
    for (const key of Object.keys(gameConfig)) delete gameConfig[key];
  });

  it('uses effective official text for Japanese and English', () => {
    expect(getLocalizedCardName(card, 'ja')).toBe('公式日本語名');
    expect(getLocalizedCardEffect(card, 'ja')).toBe('公式日本語効果');
    expect(getLocalizedCardName(card, 'en')).toBe('OFFICIAL ENGLISH NAME');
    expect(getLocalizedCardEffect(card, 'en')).toBe('OFFICIAL ENGLISH EFFECT');
  });

  it('uses only reviewed derived translations for other locales', () => {
    initCardTextsI18n({
      test_1: {
        'zh-TW': {
          name: '已複核卡名',
          effect: '已複核效果',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(card, 'zh-TW')).toBe('已複核卡名');
    expect(getLocalizedCardEffect(card, 'zh-TW')).toBe('已複核效果');
  });

  it('falls back to official English when a translation is pending review', () => {
    initCardTextsI18n({
      test_1: {
        ko: {
          name: '미검수 이름',
          effect: '미검수 효과',
          nameSource: 'legacy',
          effectSource: 'legacy',
          reviewStatus: 'pending_review',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(card, 'ko')).toBe('OFFICIAL ENGLISH NAME');
    expect(getLocalizedCardEffect(card, 'ko')).toBe('OFFICIAL ENGLISH EFFECT');
  });

  it('falls back from missing English print text to Japanese', () => {
    const japaneseOnly = { ...card, enNameOfficial: '', enEffectOfficial: '' };
    expect(getLocalizedCardName(japaneseOnly, 'zh-CN')).toBe('公式日本語名');
    expect(getLocalizedCardEffect(japaneseOnly, 'zh-CN')).toBe('公式日本語効果');
  });

  it('uses the canonical card field for errata-corrected English', () => {
    const errataCard = {
      ...card,
      enEffectOfficial: 'CORRECTED ENGLISH EFFECT',
      officialErrataAffectsEffect: true,
    };
    initCardTextsI18n({
      test_1: {
        en: {
          name: 'OFFICIAL ENGLISH NAME',
          effect: 'UNCHECKED CORRECTED EFFECT',
          nameSource: 'official_card_print',
          effectSource: 'official_japanese_errata_translation',
          reviewStatus: 'pending_review',
          reviewNote: '',
        },
        'zh-TW': {
          name: '已複核卡名',
          effect: '舊版錯誤效果',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(errataCard, 'en')).toBe('OFFICIAL ENGLISH NAME');
    expect(getLocalizedCardEffect(errataCard, 'en')).toBe('CORRECTED ENGLISH EFFECT');
    expect(getLocalizedCardEffect(errataCard, 'zh-TW')).toBe('CORRECTED ENGLISH EFFECT');
  });

  it('uses reviewed translations derived from corrected Japanese errata', () => {
    const errataCard = {
      ...card,
      enNameOfficial: 'CORRECTED ENGLISH NAME',
      enEffectOfficial: 'CORRECTED ENGLISH EFFECT',
      officialErrataAffectsName: true,
      officialErrataAffectsEffect: true,
    };
    initCardTextsI18n({
      test_1: {
        ko: {
          name: '수정된 이름',
          effect: '수정된 효과',
          nameSource: 'official_japanese_errata_translation',
          effectSource: 'official_japanese_errata_translation',
          reviewStatus: 'verified',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(errataCard, 'en')).toBe('CORRECTED ENGLISH NAME');
    expect(getLocalizedCardEffect(errataCard, 'en')).toBe('CORRECTED ENGLISH EFFECT');
    expect(getLocalizedCardName(errataCard, 'ko')).toBe('수정된 이름');
    expect(getLocalizedCardEffect(errataCard, 'ko')).toBe('수정된 효과');
    expect(getLocalizedCardName(errataCard, 'zh-CN')).toBe('CORRECTED ENGLISH NAME');
  });

  it('allows reviewed card-print English when the errata did not affect it', () => {
    const errataCard = { ...card, officialErrataAffectsEffect: true };
    expect(getLocalizedCardEffect(errataCard, 'en')).toBe('OFFICIAL ENGLISH EFFECT');
  });

  it('builds search terms from card names, songs, and effects in every requested locale', () => {
    const songCard = {
      ...card,
      name: '角色（原曲）',
      song: '原曲',
      effect: '使用《原曲》的效果。',
    };
    initCardTextsI18n({
      test_1: {
        'zh-TW': {
          name: '繁中角色（舊歌名）',
          effect: '繁中效果《舊歌名》。',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
        'zh-CN': {
          name: '简中角色（旧歌名）',
          effect: '简中效果《旧歌名》。',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
        ko: {
          name: '한국어 카드（이전 곡명）',
          effect: '한국어 효과《이전 곡명》。',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
      },
    });
    gameConfig.card_song_titles_i18n = {
      原曲: {
        'zh-TW': '繁中歌名',
        'zh-CN': '简中歌名',
        en: 'English Song',
        ko: '한국어 곡명',
      },
    };

    const terms = getLocalizedCardSearchTerms(songCard, ['zh-TW', 'zh-CN', 'en', 'ko']);

    expect(terms).toContain('繁中角色（繁中歌名）');
    expect(terms).toContain('简中歌名');
    expect(terms).toContain('OFFICIAL ENGLISH EFFECT');
    expect(terms).toContain('한국어 카드（한국어 곡명）');
    expect(matchesLocalizedCardSearch(songCard, '한국어 곡명', ['zh-TW', 'zh-CN', 'en', 'ko'])).toBe(true);
    expect(matchesLocalizedCardSearch(songCard, '不存在的翻譯', ['zh-TW', 'zh-CN', 'en', 'ko'])).toBe(false);
    expect(
      matchesLocalizedCardSearch({ ...songCard, id: '1st_120' }, '존재하지 않는 효과 +20', [
        'zh-TW',
        'zh-CN',
        'en',
        'ko',
      ]),
    ).toBe(false);
    expect(matchesLocalizedCardSearch({ ...songCard, id: '1st_120' }, '1st120', ['zh-TW'])).toBe(true);
  });
});
