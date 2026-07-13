/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns('matches', {
    rules_version: { type: 'text', notNull: true, default: 'legacy' },
  });
  pgm.addColumns('bjg_match_result_outbox', {
    rules_version: { type: 'text', notNull: true, default: 'legacy' },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropColumns('bjg_match_result_outbox', ['rules_version'], { ifExists: true });
  pgm.dropColumns('matches', ['rules_version'], { ifExists: true });
};
