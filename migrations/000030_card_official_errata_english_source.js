/** Canonical append-only replacement for the legacy 000009 errata-source migration. */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn(
    'card_official_errata',
    {
      corrected_english_source: {
        type: 'text',
        default: 'official_japanese_errata_translation',
      },
    },
    { ifNotExists: true },
  );
  pgm.sql(`
    UPDATE card_official_errata
       SET corrected_english_source = 'official_japanese_errata_translation'
     WHERE corrected_english_source IS NULL;
    ALTER TABLE card_official_errata
      ALTER COLUMN corrected_english_source SET DEFAULT 'official_japanese_errata_translation',
      ALTER COLUMN corrected_english_source SET NOT NULL;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'card_official_errata_english_source_check'
           AND conrelid = 'public.card_official_errata'::regclass
      ) THEN
        ALTER TABLE card_official_errata
          ADD CONSTRAINT card_official_errata_english_source_check
          CHECK (corrected_english_source IN (
            'official_errata_notice',
            'official_card_print_unaffected',
            'official_card_print_corrected',
            'official_japanese_errata_translation'
          ));
      END IF;
    END $$;
  `);
};

export const down = false;
