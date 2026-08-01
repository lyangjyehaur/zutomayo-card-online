/* global module, require */

const crypto = require('crypto');
const { Webhook } = require('svix');
const { writeAuditLog } = require('./adminService.cjs');

const RESEND_API_BASE_URL = 'https://api.resend.com';
const RESEND_TIMEOUT_MS = 10_000;

class SupportInboxError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'SupportInboxError';
    this.status = status;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeReceivedEmail(email) {
  const source = asObject(email) || {};
  const id = String(source.id || source.email_id || '').trim();
  const messageId = String(source.message_id || '').trim();
  const sender = String(source.from || '').trim();
  if (!id || !messageId || !sender) {
    throw new SupportInboxError('Resend received-email payload is missing required identifiers', 502);
  }
  const createdAt = new Date(String(source.created_at || ''));
  return {
    id,
    messageId,
    sender,
    recipients: asArray(source.to),
    replyTo: asArray(source.reply_to),
    cc: asArray(source.cc),
    bcc: asArray(source.bcc),
    subject: String(source.subject || ''),
    textBody: typeof source.text === 'string' ? source.text : null,
    htmlBody: typeof source.html === 'string' ? source.html : null,
    headers: asObject(source.headers),
    attachments: Array.isArray(source.attachments) ? source.attachments : [],
    receivedAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
  };
}

async function resendRequest({ apiKey, path, method = 'GET', body, fetchImpl = fetch }) {
  if (!apiKey) throw new SupportInboxError('Resend inbox is not configured', 503);
  let response;
  try {
    response = await fetchImpl(`${RESEND_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SupportInboxError(
      error instanceof Error && error.name === 'TimeoutError' ? 'Resend request timed out' : 'Unable to reach Resend',
      502,
    );
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const detail = String(data.message || data.error || '').trim();
    throw new SupportInboxError(detail ? `Resend request failed: ${detail}` : 'Resend request failed', 502);
  }
  return data;
}

async function upsertSupportEmail(pool, email) {
  const normalized = normalizeReceivedEmail(email);
  await pool.query(
    `INSERT INTO support_emails (
       id, message_id, sender, recipients, reply_to, cc, bcc, subject,
       text_body, html_body, headers, attachments, received_at, synced_at
     ) VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8,
       $9, $10, $11::jsonb, $12::jsonb, $13, NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       message_id = EXCLUDED.message_id,
       sender = EXCLUDED.sender,
       recipients = EXCLUDED.recipients,
       reply_to = CASE WHEN EXCLUDED.reply_to = '[]'::jsonb THEN support_emails.reply_to ELSE EXCLUDED.reply_to END,
       cc = EXCLUDED.cc,
       bcc = EXCLUDED.bcc,
       subject = EXCLUDED.subject,
       text_body = COALESCE(EXCLUDED.text_body, support_emails.text_body),
       html_body = COALESCE(EXCLUDED.html_body, support_emails.html_body),
       headers = COALESCE(EXCLUDED.headers, support_emails.headers),
       attachments = EXCLUDED.attachments,
       received_at = EXCLUDED.received_at,
       synced_at = NOW()`,
    [
      normalized.id,
      normalized.messageId,
      normalized.sender,
      JSON.stringify(normalized.recipients),
      JSON.stringify(normalized.replyTo),
      JSON.stringify(normalized.cc),
      JSON.stringify(normalized.bcc),
      normalized.subject,
      normalized.textBody,
      normalized.htmlBody,
      normalized.headers ? JSON.stringify(normalized.headers) : null,
      JSON.stringify(normalized.attachments),
      normalized.receivedAt,
    ],
  );
  return normalized;
}

async function syncSupportInbox({ pool, apiKey, fetchImpl = fetch }) {
  const response = await resendRequest({ apiKey, path: '/emails/receiving', fetchImpl });
  const emails = Array.isArray(response.data) ? response.data : [];
  for (const email of emails) await upsertSupportEmail(pool, email);
  return { count: emails.length, hasMore: Boolean(response.has_more) };
}

async function ingestReceivedWebhook({ pool, event }) {
  if (!event || event.type !== 'email.received') return { accepted: true, ignored: true };
  await upsertSupportEmail(pool, event.data);
  return { accepted: true, emailId: String(event.data?.email_id || '') };
}

function rowSummary(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    sender: row.sender,
    recipients: row.recipients || [],
    subject: row.subject || '',
    status: row.status,
    receivedAt: row.received_at,
    viewedAt: row.viewed_at,
    repliedAt: row.replied_at,
    archivedAt: row.archived_at,
    attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
    hasContent: Boolean(row.text_body || row.html_body),
  };
}

function plainTextFromHtml(value) {
  return String(value || '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rowDetail(row, replies) {
  return {
    ...rowSummary(row),
    replyTo: row.reply_to || [],
    cc: row.cc || [],
    body: row.text_body || plainTextFromHtml(row.html_body),
    attachments: row.attachments || [],
    replies: replies.map((reply) => ({
      id: reply.id,
      resendEmailId: reply.resend_email_id,
      adminUserId: reply.admin_user_id,
      recipients: reply.recipients || [],
      subject: reply.subject,
      textBody: reply.text_body,
      sentAt: reply.sent_at,
    })),
  };
}

async function listSupportEmails(pool, { status = 'open', limit = 100 } = {}) {
  const params = [];
  const where = status === 'all' ? '' : `WHERE status = $${params.push(status)}`;
  params.push(Math.max(1, Math.min(Number(limit) || 100, 200)));
  const result = await pool.query(
    `SELECT id, message_id, sender, recipients, subject, status, received_at,
            viewed_at, replied_at, archived_at, attachments, text_body, html_body
       FROM support_emails
       ${where}
      ORDER BY received_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(rowSummary);
}

async function loadSupportEmailRow(pool, emailId) {
  return (
    await pool.query(
      `SELECT id, message_id, sender, recipients, reply_to, cc, bcc, subject,
              text_body, html_body, headers, attachments, status, received_at,
              viewed_at, replied_at, archived_at
         FROM support_emails
        WHERE id = $1`,
      [emailId],
    )
  ).rows[0];
}

async function getSupportEmail({ pool, emailId, apiKey, fetchImpl = fetch, refresh = true }) {
  let row = await loadSupportEmailRow(pool, emailId);
  if (refresh && apiKey && (!row || (!row.text_body && !row.html_body))) {
    const remote = await resendRequest({
      apiKey,
      path: `/emails/receiving/${encodeURIComponent(emailId)}`,
      fetchImpl,
    });
    await upsertSupportEmail(pool, remote);
    row = await loadSupportEmailRow(pool, emailId);
  }
  if (!row) throw new SupportInboxError('Support email not found', 404);
  await pool.query('UPDATE support_emails SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = $1', [emailId]);
  row.viewed_at = row.viewed_at || new Date().toISOString();
  const replies = (
    await pool.query(
      `SELECT id, resend_email_id, admin_user_id, recipients, subject, text_body, sent_at
         FROM support_email_replies
        WHERE support_email_id = $1
        ORDER BY sent_at ASC, id ASC`,
      [emailId],
    )
  ).rows;
  return rowDetail(row, replies);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value.join(' ') : String(value || '');
}

function replySubject(subject) {
  const clean = String(subject || '').trim() || '(no subject)';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function threadReferences(headers, messageId) {
  const values = `${headerValue(headers, 'references')} ${messageId}`.trim().split(/\s+/).filter(Boolean);
  return [...new Set(values)].join(' ');
}

async function replyToSupportEmail({ pool, emailId, text, adminUserId, apiKey, from, fetchImpl = fetch }) {
  const body = String(text || '').trim();
  if (!body) throw new SupportInboxError('Reply text is required', 400);
  if (!from) throw new SupportInboxError('Resend contact sender is not configured', 503);
  await getSupportEmail({ pool, emailId, apiKey, fetchImpl, refresh: true });
  const row = await loadSupportEmailRow(pool, emailId);
  if (!row) throw new SupportInboxError('Support email not found', 404);
  const recipients = Array.isArray(row.reply_to) && row.reply_to.length ? row.reply_to : [row.sender];
  const subject = replySubject(row.subject);
  const headers = {
    'In-Reply-To': row.message_id,
    References: threadReferences(row.headers, row.message_id),
  };
  const sent = await resendRequest({
    apiKey,
    path: '/emails',
    method: 'POST',
    body: { from, to: recipients, subject, text: body, headers },
    fetchImpl,
  });
  const resendEmailId = String(sent.id || '').trim();
  if (!resendEmailId) throw new SupportInboxError('Resend response did not include an email ID', 502);
  const replyId = `support_reply_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO support_email_replies (
       id, support_email_id, resend_email_id, admin_user_id, recipients, subject, text_body, headers
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)`,
    [replyId, emailId, resendEmailId, adminUserId, JSON.stringify(recipients), subject, body, JSON.stringify(headers)],
  );
  await pool.query(
    `UPDATE support_emails
        SET status = 'replied', replied_at = NOW(), archived_at = NULL
      WHERE id = $1`,
    [emailId],
  );
  await writeAuditLog(pool, {
    adminUserId,
    action: 'reply_support_email',
    targetType: 'support_email',
    targetId: emailId,
    details: { resendEmailId },
  });
  return { id: replyId, resendEmailId, recipients, subject };
}

async function updateSupportEmailStatus({ pool, emailId, status, adminUserId }) {
  const result = await pool.query(
    `UPDATE support_emails
        SET status = $2,
            archived_at = CASE WHEN $2 = 'archived' THEN NOW() ELSE NULL END
      WHERE id = $1
      RETURNING id, status, archived_at`,
    [emailId, status],
  );
  if (!result.rows[0]) throw new SupportInboxError('Support email not found', 404);
  await writeAuditLog(pool, {
    adminUserId,
    action: 'update_support_email_status',
    targetType: 'support_email',
    targetId: emailId,
    details: { status },
  });
  return {
    id: result.rows[0].id,
    status: result.rows[0].status,
    archivedAt: result.rows[0].archived_at,
  };
}

function verifyResendWebhook({ rawBody, headers, webhookSecret }) {
  if (!webhookSecret) throw new SupportInboxError('Resend webhook is not configured', 503);
  try {
    return new Webhook(webhookSecret).verify(rawBody, {
      'svix-id': String(headers.id || ''),
      'svix-timestamp': String(headers.timestamp || ''),
      'svix-signature': String(headers.signature || ''),
    });
  } catch {
    throw new SupportInboxError('Invalid Resend webhook signature', 400);
  }
}

module.exports = {
  SupportInboxError,
  getSupportEmail,
  ingestReceivedWebhook,
  listSupportEmails,
  normalizeReceivedEmail,
  plainTextFromHtml,
  replySubject,
  replyToSupportEmail,
  syncSupportInbox,
  threadReferences,
  updateSupportEmailStatus,
  upsertSupportEmail,
  verifyResendWebhook,
};
