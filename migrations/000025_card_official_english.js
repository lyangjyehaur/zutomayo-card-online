/** Track the official English card name/effect fields used by every card reader. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns(
    'cards',
    {
      en_name_official: { type: 'text', default: '' },
      en_effect_official: { type: 'text', default: '' },
    },
    { ifNotExists: true },
  );
};

// Existing databases may already own these columns and their translations.
// Since up adopts them with ifNotExists, down cannot safely identify which
// columns this migration created; rollback must preserve data and use a forward fix.
export const down = false;
