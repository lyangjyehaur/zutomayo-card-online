/**
 * Enforce the derived-language and review-status contract at the PostgreSQL
 * boundary instead of relying only on API validation.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM card_texts_i18n
         WHERE lang NOT IN ('zh-TW', 'zh-CN', 'zh-HK', 'ko')
            OR review_status NOT IN ('verified', 'pending_review')
      ) THEN
        RAISE EXCEPTION
          'card_texts_i18n contains unsupported language or review status; resolve data before migration 000036';
      END IF;
    END $$;

    ALTER TABLE card_texts_i18n
      DROP CONSTRAINT IF EXISTS card_texts_i18n_derived_lang_check,
      DROP CONSTRAINT IF EXISTS card_texts_i18n_chck,
      DROP CONSTRAINT IF EXISTS card_texts_i18n_review_status_check,
      DROP CONSTRAINT IF EXISTS card_texts_i18n_derived_review_status_check;

    ALTER TABLE card_texts_i18n
      ADD CONSTRAINT card_texts_i18n_derived_lang_check
        CHECK (lang IN ('zh-TW', 'zh-CN', 'zh-HK', 'ko')),
      ADD CONSTRAINT card_texts_i18n_derived_review_status_check
        CHECK (review_status IN ('verified', 'pending_review'));
  `);
};

export const down = false;
