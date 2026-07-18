/**
 * Make `cards` the sole authority for effective Japanese and English text.
 * Derived translations remain in `card_texts_i18n`; errata keeps history and
 * provenance without duplicating the corrected values.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    UPDATE cards AS card
       SET name = CASE
                    WHEN errata.affects_name THEN errata.corrected_japanese_text
                    ELSE card.name
                  END,
           effect = CASE
                      WHEN errata.affects_effect THEN errata.corrected_japanese_text
                      ELSE card.effect
                    END,
           en_name_official = CASE
                                WHEN errata.affects_name THEN errata.corrected_english_text
                                ELSE card.en_name_official
                              END,
           en_effect_official = CASE
                                  WHEN errata.affects_effect THEN errata.corrected_english_text
                                  ELSE card.en_effect_official
                                END,
           updated_at = NOW()
      FROM card_official_errata AS errata
     WHERE errata.card_id = card.id;

    DELETE FROM card_texts_i18n WHERE lang IN ('ja', 'en');

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'card_texts_i18n_derived_lang_check'
           AND conrelid = 'public.card_texts_i18n'::regclass
      ) THEN
        ALTER TABLE card_texts_i18n
          ADD CONSTRAINT card_texts_i18n_derived_lang_check
          CHECK (lang NOT IN ('ja', 'en'));
      END IF;
    END $$;

    DROP TABLE IF EXISTS card_effects_i18n;

    ALTER TABLE card_official_errata
      DROP COLUMN IF EXISTS corrected_japanese_text,
      DROP COLUMN IF EXISTS corrected_english_text;

    COMMENT ON COLUMN cards.name IS
      'Canonical effective official Japanese name, including official errata.';
    COMMENT ON COLUMN cards.effect IS
      'Canonical effective official Japanese effect, including official errata.';
    COMMENT ON COLUMN cards.en_name_official IS
      'Canonical effective official English name, including official errata.';
    COMMENT ON COLUMN cards.en_effect_official IS
      'Canonical effective official English effect, including official errata.';
    COMMENT ON TABLE card_texts_i18n IS
      'Reviewed derived-language card names and effects; Japanese and English are stored only in cards.';
  `);
};

export const down = false;
