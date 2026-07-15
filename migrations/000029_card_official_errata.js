/** Canonical append-only replacement for the legacy 000008 errata migration. */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn(
    'cards',
    { has_official_errata: { type: 'boolean', notNull: true, default: false } },
    { ifNotExists: true },
  );
  pgm.addColumn('cards', { official_errata_id: { type: 'text' } }, { ifNotExists: true });
  pgm.addColumn(
    'cards',
    { official_errata_affects_name: { type: 'boolean', notNull: true, default: false } },
    { ifNotExists: true },
  );
  pgm.addColumn(
    'cards',
    { official_errata_affects_effect: { type: 'boolean', notNull: true, default: false } },
    { ifNotExists: true },
  );
  pgm.addColumn('cards', { official_errata_url: { type: 'text', notNull: true, default: '' } }, { ifNotExists: true });

  pgm.createTable(
    'card_official_errata',
    {
      errata_id: { type: 'text', primaryKey: true },
      card_id: {
        type: 'text',
        notNull: true,
        unique: true,
        references: 'cards(id)',
        onDelete: 'CASCADE',
      },
      published_at: { type: 'date', notNull: true },
      affects_name: { type: 'boolean', notNull: true, default: false },
      affects_effect: { type: 'boolean', notNull: true, default: false },
      incorrect_text: { type: 'text', notNull: true, default: '' },
      corrected_japanese_text: { type: 'text', notNull: true },
      corrected_english_text: { type: 'text', notNull: true, default: '' },
      corrected_english_status: { type: 'text', notNull: true, default: 'pending_review' },
      source_url: { type: 'text', notNull: true },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "(affects_name OR affects_effect) AND corrected_english_status IN ('official', 'verified', 'pending_review')",
      },
    },
  );
  pgm.createIndex('cards', ['has_official_errata'], {
    ifNotExists: true,
    name: 'idx_cards_has_official_errata',
  });
};

export const down = false;
