/**
 * Store immutable message evidence on chat reports.
 *
 * Reports must remain useful even if the original message is later edited,
 * hidden, or no longer returned in normal user history.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumn(
    'chat_reports',
    {
      reported_message_content: { type: 'text', notNull: true, default: '' },
      reported_message_author_user_id: { type: 'text' },
      reported_message_author_display_name: { type: 'text', notNull: true, default: '' },
      reported_message_author_role: { type: 'text', notNull: true, default: 'spectator' },
      reported_message_moderation_status: { type: 'text', notNull: true, default: 'visible' },
      reported_message_created_at: { type: 'timestamptz' },
    },
    { ifNotExists: true },
  );
};

export const down = false;
