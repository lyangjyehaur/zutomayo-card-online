/** Track whether corrected English was reused, minimally edited, or retranslated. */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn(
    'card_official_errata',
    {
      corrected_english_source: {
        type: 'text',
        notNull: true,
        default: 'official_japanese_errata_translation',
      },
    },
    { ifNotExists: true },
  );
  pgm.addConstraint('card_official_errata', 'card_official_errata_english_source_check', {
    check: `corrected_english_source IN (
      'official_errata_notice',
      'official_card_print_unaffected',
      'official_card_print_corrected',
      'official_japanese_errata_translation'
    )`,
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('card_official_errata', 'card_official_errata_english_source_check', { ifExists: true });
  pgm.dropColumn('card_official_errata', 'corrected_english_source', { ifExists: true });
};
