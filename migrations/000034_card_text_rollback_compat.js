/**
 * Keep the previous runtime images bootable after the canonical text migration
 * without restoring any duplicate text storage.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE card_official_errata
      ADD COLUMN corrected_japanese_text text,
      ADD COLUMN corrected_english_text text,
      ADD CONSTRAINT card_official_errata_no_corrected_text_cache
        CHECK (corrected_japanese_text IS NULL AND corrected_english_text IS NULL);

    COMMENT ON COLUMN card_official_errata.corrected_japanese_text IS
      'Deprecated rollback-compatibility tombstone; canonical text is stored in cards and this column must remain NULL.';
    COMMENT ON COLUMN card_official_errata.corrected_english_text IS
      'Deprecated rollback-compatibility tombstone; canonical text is stored in cards and this column must remain NULL.';

    CREATE VIEW card_effects_i18n AS
      SELECT card_id, lang, effect_text
        FROM card_texts_i18n
      UNION ALL
      SELECT id, 'ja'::text, effect
        FROM cards
      UNION ALL
      SELECT id, 'en'::text, en_effect_official
        FROM cards;

    COMMENT ON VIEW card_effects_i18n IS
      'Deprecated read-only rollback projection; no card text is stored in this relation.';
  `);
};

export const down = false;
