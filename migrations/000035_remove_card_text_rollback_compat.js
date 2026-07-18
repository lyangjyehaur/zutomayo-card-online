/**
 * Remove the temporary compatibility objects retained for pre-canonical card
 * text runtime images. Effective text remains in cards and card_texts_i18n.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS card_effects_i18n;

    ALTER TABLE card_official_errata
      DROP CONSTRAINT IF EXISTS card_official_errata_no_corrected_text_cache,
      DROP COLUMN IF EXISTS corrected_japanese_text,
      DROP COLUMN IF EXISTS corrected_english_text;
  `);
};

export const down = false;
