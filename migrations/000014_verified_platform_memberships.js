/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumn(
    'platform_match_participants',
    {
      access_verified: { type: 'boolean', notNull: true, default: false },
    },
    { ifNotExists: true },
  );
  pgm.addColumn(
    'platform_room_participants',
    {
      access_verified: { type: 'boolean', notNull: true, default: false },
    },
    { ifNotExists: true },
  );
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropColumn('platform_room_participants', 'access_verified', { ifExists: true });
  pgm.dropColumn('platform_match_participants', 'access_verified', { ifExists: true });
};
