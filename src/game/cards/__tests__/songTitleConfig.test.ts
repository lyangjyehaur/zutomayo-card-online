import { describe, expect, it } from 'vitest';
import { CARD_SONG_TITLES_I18N_CONFIG_KEY, normalizeSongTitleConfig } from '../songTitleConfig';

describe('song title config', () => {
  it('uses the production game config key', () => {
    expect(CARD_SONG_TITLES_I18N_CONFIG_KEY).toBe('card_song_titles_i18n');
  });

  it('keeps string translations and drops malformed entries', () => {
    expect(
      normalizeSongTitleConfig({
        袖のキルト: { 'zh-CN': '袖中棉绒', en: 'QUILT', ko: null, unsupported: 'ignored' },
        猫リセット: 'invalid',
        '': { en: 'invalid' },
      }),
    ).toEqual({
      袖のキルト: { 'zh-CN': '袖中棉绒', en: 'QUILT' },
    });
  });

  it('returns an empty config for non-object values', () => {
    expect(normalizeSongTitleConfig(null)).toEqual({});
    expect(normalizeSongTitleConfig([])).toEqual({});
  });
});
