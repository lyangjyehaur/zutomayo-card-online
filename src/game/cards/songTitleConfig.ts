export const CARD_SONG_TITLES_I18N_CONFIG_KEY = 'card_song_titles_i18n';

export type SongTitleConfig = Record<string, Record<string, string>>;

export function normalizeSongTitleConfig(value: unknown): SongTitleConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([song, translations]) => {
      if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return [];
      return [
        [
          song,
          Object.fromEntries(
            Object.entries(translations).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          ),
        ],
      ];
    }),
  );
}
