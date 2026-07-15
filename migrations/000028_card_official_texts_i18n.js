/**
 * Canonical append-only replacement for the legacy 000007 card-text migration.
 * Existing P0-P5 databases already contain 000010+ migrations, so inserting a
 * new 000007 entry would violate node-pg-migrate's ordering invariant.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('cards', { en_name_official: { type: 'text', default: '' } }, { ifNotExists: true });
  pgm.addColumn('cards', { en_effect_official: { type: 'text', default: '' } }, { ifNotExists: true });
  // Legacy histories may already contain reviewed translations and corrected
  // errata text. This migration only fills missing language rows; content
  // synchronization belongs to the explicit reviewed-data import workflow.
  pgm.sql(`
    UPDATE cards SET en_name_official = '' WHERE en_name_official IS NULL;
    UPDATE cards SET en_effect_official = '' WHERE en_effect_official IS NULL;
    ALTER TABLE cards
      ALTER COLUMN en_name_official SET DEFAULT '',
      ALTER COLUMN en_name_official SET NOT NULL,
      ALTER COLUMN en_effect_official SET DEFAULT '',
      ALTER COLUMN en_effect_official SET NOT NULL;
  `);

  pgm.createTable(
    'card_texts_i18n',
    {
      card_id: {
        type: 'text',
        notNull: true,
        references: 'cards(id)',
        onDelete: 'CASCADE',
      },
      lang: { type: 'text', notNull: true },
      name_text: { type: 'text', notNull: true, default: '' },
      effect_text: { type: 'text', notNull: true, default: '' },
      name_source: { type: 'text', notNull: true, default: '' },
      effect_source: { type: 'text', notNull: true, default: '' },
      review_status: { type: 'text', notNull: true, default: 'pending_review' },
      review_note: { type: 'text', notNull: true, default: '' },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['card_id', 'lang'],
        check: "review_status IN ('official', 'verified', 'pending_review')",
      },
    },
  );
  pgm.createIndex('card_texts_i18n', ['lang', 'review_status'], {
    ifNotExists: true,
    name: 'idx_card_texts_i18n_lang_review',
  });

  pgm.sql(`
    INSERT INTO card_texts_i18n (
      card_id, lang, name_text, effect_text, name_source, effect_source, review_status
    )
    SELECT id, 'ja', name, effect, 'official_card_print', 'official_card_print', 'official'
    FROM cards
    ON CONFLICT (card_id, lang) DO NOTHING;

    INSERT INTO card_texts_i18n (
      card_id, lang, name_text, effect_text, name_source, effect_source, review_status
    )
    SELECT id, 'en', en_name_official, en_effect_official,
           'official_card_print', 'official_card_print', 'official'
    FROM cards
    ON CONFLICT (card_id, lang) DO NOTHING;

    INSERT INTO card_texts_i18n (
      card_id, lang, effect_text, effect_source, review_status
    )
    SELECT legacy.card_id, legacy.lang, legacy.effect_text,
           'legacy_card_effects_i18n', 'pending_review'
    FROM card_effects_i18n legacy
    JOIN cards ON cards.id = legacy.card_id
    WHERE legacy.lang NOT IN ('ja', 'en')
    ON CONFLICT (card_id, lang) DO NOTHING;
  `);
};

export const down = false;
