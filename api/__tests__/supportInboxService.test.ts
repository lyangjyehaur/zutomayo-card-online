import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { Webhook } = require('svix') as typeof import('svix');
const {
  normalizeReceivedEmail,
  plainTextFromHtml,
  replyToSupportEmail,
  syncSupportInbox,
  threadReferences,
  verifyResendWebhook,
} = require('../supportInboxService.cjs') as {
  normalizeReceivedEmail: (input: unknown) => Record<string, unknown>;
  plainTextFromHtml: (input: string) => string;
  replyToSupportEmail: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  syncSupportInbox: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  threadReferences: (headers: Record<string, unknown>, messageId: string) => string;
  verifyResendWebhook: (input: Record<string, unknown>) => Record<string, unknown>;
};

const receivedEmail = {
  id: 'received_1',
  message_id: '<message-1@example.com>',
  from: 'Player <player@example.com>',
  to: ['contact@mail.zutomayocard.online'],
  reply_to: ['reply@example.com'],
  subject: '網站詢問',
  text: '請問如何開始遊戲？',
  headers: { references: '<older@example.com>' },
  attachments: [],
  created_at: '2026-08-01T12:00:00.000Z',
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

describe('support inbox service', () => {
  it('normalizes Resend webhook and API payload identifiers', () => {
    expect(normalizeReceivedEmail({ ...receivedEmail, id: undefined, email_id: 'webhook_1' })).toMatchObject({
      id: 'webhook_1',
      messageId: '<message-1@example.com>',
      sender: 'Player <player@example.com>',
      replyTo: ['reply@example.com'],
    });
  });

  it('converts untrusted HTML to display-only plain text', () => {
    expect(plainTextFromHtml('<style>body{display:none}</style><p>Hello &amp; welcome</p><script>x()</script>')).toBe(
      'Hello & welcome',
    );
  });

  it('verifies the raw Resend webhook body with the signing secret', () => {
    const secret = `whsec_${Buffer.from('01234567890123456789012345678901').toString('base64')}`;
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'received_1' } });
    const id = 'msg_test';
    const timestamp = new Date();
    const signature = new Webhook(secret).sign(id, timestamp, payload);

    expect(
      verifyResendWebhook({
        rawBody: payload,
        headers: { id, timestamp: Math.floor(timestamp.getTime() / 1000), signature },
        webhookSecret: secret,
      }),
    ).toMatchObject({ type: 'email.received' });
    expect(() =>
      verifyResendWebhook({
        rawBody: `${payload} `,
        headers: { id, timestamp: Math.floor(timestamp.getTime() / 1000), signature },
        webhookSecret: secret,
      }),
    ).toThrow('Invalid Resend webhook signature');
  });

  it('imports existing received emails from the Resend list API', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
    const fetchImpl = vi.fn(async () => response({ object: 'list', has_more: false, data: [receivedEmail] }));

    await expect(syncSupportInbox({ pool, apiKey: 're_test', fetchImpl })).resolves.toEqual({
      count: 1,
      hasMore: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails/receiving',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO support_emails'), expect.any(Array));
  });

  it('sends replies to Reply-To with RFC thread headers and records an audit trail', async () => {
    const databaseRow = {
      id: 'received_1',
      message_id: '<message-1@example.com>',
      sender: 'Player <player@example.com>',
      recipients: ['contact@mail.zutomayocard.online'],
      reply_to: ['reply@example.com'],
      cc: [],
      bcc: [],
      subject: '網站詢問',
      text_body: '請問如何開始遊戲？',
      html_body: null,
      headers: { references: '<older@example.com>' },
      attachments: [],
      status: 'open',
      received_at: '2026-08-01T12:00:00.000Z',
      viewed_at: null,
      replied_at: null,
      archived_at: null,
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM support_emails') && sql.includes('WHERE id = $1')) return { rows: [{ ...databaseRow }] };
        if (sql.includes('FROM support_email_replies')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const fetchImpl = vi.fn(async () => response({ id: 'sent_1' }));

    await expect(
      replyToSupportEmail({
        pool,
        emailId: 'received_1',
        text: '您好，請先建立帳號後進入線上大廳。',
        adminUserId: 'admin_1',
        apiKey: 're_test',
        from: 'ZTMYCardOnline <contact@mail.zutomayocard.online>',
        fetchImpl,
      }),
    ).resolves.toMatchObject({ resendEmailId: 'sent_1', recipients: ['reply@example.com'], subject: 'Re: 網站詢問' });

    const sendBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sendBody).toMatchObject({
      from: 'ZTMYCardOnline <contact@mail.zutomayocard.online>',
      to: ['reply@example.com'],
      subject: 'Re: 網站詢問',
      headers: {
        'In-Reply-To': '<message-1@example.com>',
        References: '<older@example.com> <message-1@example.com>',
      },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO support_email_replies'),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), expect.any(Array));
  });

  it('deduplicates thread references', () => {
    expect(threadReferences({ References: '<a@example.com> <b@example.com>' }, '<b@example.com>')).toBe(
      '<a@example.com> <b@example.com>',
    );
  });
});
