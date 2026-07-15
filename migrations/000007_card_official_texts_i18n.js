/**
 * Add official English card text and a unified localized card-text table.
 *
 * `cards` remains the source of truth for the two official print languages:
 * Japanese (`name` / `effect`) and English (`en_*_official`). Derived
 * translations live in `card_texts_i18n` with provenance and review status.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('cards', { en_name_official: { type: 'text', notNull: true, default: '' } }, { ifNotExists: true });
  pgm.addColumn('cards', { en_effect_official: { type: 'text', notNull: true, default: '' } }, { ifNotExists: true });

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
    ON CONFLICT (card_id, lang) DO UPDATE SET
      name_text = EXCLUDED.name_text,
      effect_text = EXCLUDED.effect_text,
      name_source = EXCLUDED.name_source,
      effect_source = EXCLUDED.effect_source,
      review_status = EXCLUDED.review_status,
      updated_at = NOW();

    INSERT INTO card_texts_i18n (
      card_id, lang, name_text, effect_text, name_source, effect_source, review_status
    )
    SELECT id, 'en', en_name_official, en_effect_official,
           'official_card_print', 'official_card_print', 'official'
    FROM cards
    ON CONFLICT (card_id, lang) DO UPDATE SET
      name_text = EXCLUDED.name_text,
      effect_text = EXCLUDED.effect_text,
      name_source = EXCLUDED.name_source,
      effect_source = EXCLUDED.effect_source,
      review_status = EXCLUDED.review_status,
      updated_at = NOW();

    INSERT INTO card_texts_i18n (
      card_id, lang, effect_text, effect_source, review_status
    )
    SELECT legacy.card_id, legacy.lang, legacy.effect_text,
           'legacy_card_effects_i18n', 'pending_review'
    FROM card_effects_i18n legacy
    JOIN cards ON cards.id = legacy.card_id
    WHERE legacy.lang NOT IN ('ja', 'en')
    ON CONFLICT (card_id, lang) DO UPDATE SET
      effect_text = EXCLUDED.effect_text,
      effect_source = EXCLUDED.effect_source,
      review_status = 'pending_review',
      updated_at = NOW();
  `);
};

export const down = (pgm) => {
  pgm.dropTable('card_texts_i18n', { ifExists: true, cascade: true });
  pgm.dropColumn('cards', 'en_effect_official', { ifExists: true });
  pgm.dropColumn('cards', 'en_name_official', { ifExists: true });
};
