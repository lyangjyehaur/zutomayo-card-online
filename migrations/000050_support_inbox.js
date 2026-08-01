/** Resend-backed operator inbox with durable reply and audit history. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'support_emails',
    {
      id: { type: 'text', primaryKey: true },
      message_id: { type: 'text', notNull: true },
      sender: { type: 'text', notNull: true },
      recipients: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      reply_to: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      cc: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      bcc: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      subject: { type: 'text', notNull: true, default: '' },
      text_body: { type: 'text' },
      html_body: { type: 'text' },
      headers: { type: 'jsonb' },
      attachments: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      status: { type: 'text', notNull: true, default: 'open' },
      received_at: { type: 'timestamptz', notNull: true },
      synced_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      viewed_at: { type: 'timestamptz' },
      replied_at: { type: 'timestamptz' },
      archived_at: { type: 'timestamptz' },
    },
    {
      constraints: {
        check: [
          "id <> ''",
          "message_id <> ''",
          "sender <> ''",
          "status IN ('open', 'replied', 'archived')",
          "jsonb_typeof(recipients) = 'array'",
          "jsonb_typeof(reply_to) = 'array'",
          "jsonb_typeof(cc) = 'array'",
          "jsonb_typeof(bcc) = 'array'",
          "jsonb_typeof(attachments) = 'array'",
          "headers IS NULL OR jsonb_typeof(headers) = 'object'",
        ],
      },
    },
  );
  pgm.createIndex('support_emails', ['status', { name: 'received_at', sort: 'DESC' }], {
    name: 'idx_support_emails_status_received',
  });
  pgm.createIndex('support_emails', ['message_id'], { name: 'idx_support_emails_message_id' });

  pgm.createTable(
    'support_email_replies',
    {
      id: { type: 'text', primaryKey: true },
      support_email_id: {
        type: 'text',
        notNull: true,
        references: 'support_emails(id)',
        onDelete: 'CASCADE',
      },
      resend_email_id: { type: 'text', notNull: true, unique: true },
      admin_user_id: { type: 'text', notNull: true },
      recipients: { type: 'jsonb', notNull: true },
      subject: { type: 'text', notNull: true },
      text_body: { type: 'text', notNull: true },
      headers: { type: 'jsonb', notNull: true },
      sent_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        check: [
          "id <> ''",
          "resend_email_id <> ''",
          "admin_user_id <> ''",
          "text_body <> ''",
          "jsonb_typeof(recipients) = 'array'",
          "jsonb_typeof(headers) = 'object'",
        ],
      },
    },
  );
  pgm.createIndex('support_email_replies', ['support_email_id', { name: 'sent_at', sort: 'ASC' }], {
    name: 'idx_support_email_replies_thread',
  });
};

export const down = false;
