/* global module */

const SUPPORTED_LANGUAGES = new Set(['ja', 'zh-tw', 'zh-cn', 'zh-hk', 'en', 'ko']);
const STATUSES = new Set(['draft', 'published', 'archived']);

function normalizeLanguage(value) {
  const language = typeof value === 'string' ? value.trim().toLowerCase().replace('_', '-') : '';
  return SUPPORTED_LANGUAGES.has(language) ? language : 'zh-tw';
}

function mapAnnouncement(row, translation) {
  const ready = translation?.status === 'ready';
  return {
    id: row.id,
    title: ready ? translation.translated_title : row.title,
    content: ready ? translation.translated_content : row.content,
    sourceLanguage: row.source_language,
    language: ready ? translation.target_language : row.source_language,
    status: row.status,
    contentVersion: row.content_version,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    translationStatus: ready ? 'ready' : translation?.status || 'source',
  };
}

function translatedParts(value) {
  const clean = String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(clean);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid announcement translation');
  const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 300) : '';
  const content = typeof parsed.content === 'string' ? parsed.content.trim().slice(0, 10_000) : '';
  if (!title || !content) throw new Error('Incomplete announcement translation');
  return { title, content };
}

async function translateAnnouncement({ pool, announcement, targetLanguage, translateText }) {
  const language = normalizeLanguage(targetLanguage);
  if (language === announcement.source_language) return null;
  const existing = (
    await pool.query(
      `SELECT * FROM announcement_translations
        WHERE announcement_id = $1 AND content_version = $2 AND target_language = $3`,
      [announcement.id, announcement.content_version, language],
    )
  ).rows[0];
  if (existing?.status === 'ready') return existing;
  if (typeof translateText !== 'function') return existing || { status: 'pending', target_language: language };

  try {
    const result = await translateText({
      text: JSON.stringify({ title: announcement.title, content: announcement.content }),
      sourceLanguage: announcement.source_language,
      targetLanguage: language,
      purpose: 'announcement',
      resourceType: 'announcement',
      resourceId: announcement.id,
      maxLength: 12_000,
    });
    const translated = translatedParts(result?.translatedContent);
    return (
      await pool.query(
        `INSERT INTO announcement_translations (
           announcement_id, content_version, target_language, translated_title, translated_content,
           provider, model, status, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', NOW())
         ON CONFLICT (announcement_id, content_version, target_language)
         DO UPDATE SET translated_title = EXCLUDED.translated_title,
                       translated_content = EXCLUDED.translated_content,
                       provider = EXCLUDED.provider, model = EXCLUDED.model,
                       status = 'ready', updated_at = NOW()
         RETURNING *`,
        [
          announcement.id,
          announcement.content_version,
          language,
          translated.title,
          translated.content,
          String(result?.provider || 'llm').slice(0, 60),
          String(result?.model || '').slice(0, 120),
        ],
      )
    ).rows[0];
  } catch {
    return (
      await pool.query(
        `INSERT INTO announcement_translations (
           announcement_id, content_version, target_language, status, updated_at
         ) VALUES ($1, $2, $3, 'pending', NOW())
         ON CONFLICT (announcement_id, content_version, target_language)
         DO UPDATE SET status = 'pending', updated_at = NOW()
         RETURNING *`,
        [announcement.id, announcement.content_version, language],
      )
    ).rows[0];
  }
}

async function listPublicAnnouncements({ pool, language, translateText, limit = 5 }) {
  const rows = (
    await pool.query(
      `SELECT * FROM announcements
        WHERE status = 'published'
          AND (published_at IS NULL OR published_at <= NOW())
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 5, 1), 20)],
    )
  ).rows;
  const targetLanguage = normalizeLanguage(language);
  const announcements = [];
  for (const announcement of rows) {
    const translation = await translateAnnouncement({ pool, announcement, targetLanguage, translateText });
    announcements.push(mapAnnouncement(announcement, translation));
  }
  return { ok: true, body: { announcements } };
}

async function listAdminAnnouncements({ pool }) {
  const { rows } = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100');
  return { ok: true, body: { announcements: rows.map((row) => mapAnnouncement(row, null)) } };
}

async function createAnnouncement({ pool, id, adminUserId, body, sanitizeText }) {
  const title = sanitizeText(body.title || '', 300).trim();
  const content = sanitizeText(body.content || '', 10_000).trim();
  const status = STATUSES.has(body.status) ? body.status : 'draft';
  if (!title || !content) return { ok: false, status: 400, error: 'Title and content are required' };
  const { rows } = await pool.query(
    `INSERT INTO announcements (
       id, title, content, source_language, status, published_at, expires_at,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING *`,
    [
      id,
      title,
      content,
      normalizeLanguage(body.sourceLanguage),
      status,
      body.publishedAt || (status === 'published' ? new Date().toISOString() : null),
      body.expiresAt || null,
      adminUserId,
    ],
  );
  return { ok: true, body: { announcement: mapAnnouncement(rows[0], null) } };
}

async function updateAnnouncement({ pool, id, adminUserId, body, sanitizeText }) {
  const title = sanitizeText(body.title || '', 300).trim();
  const content = sanitizeText(body.content || '', 10_000).trim();
  const status = STATUSES.has(body.status) ? body.status : 'draft';
  if (!title || !content) return { ok: false, status: 400, error: 'Title and content are required' };
  const { rows } = await pool.query(
    `WITH updated AS (
       UPDATE announcements
          SET title = $2, content = $3, source_language = $4, status = $5,
              published_at = $6, expires_at = $7, updated_by_user_id = $8,
              content_version = content_version + CASE
                WHEN title IS DISTINCT FROM $2 OR content IS DISTINCT FROM $3 OR source_language IS DISTINCT FROM $4
                THEN 1 ELSE 0 END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *
     ), purged AS (
       DELETE FROM announcement_translations t USING updated u
        WHERE t.announcement_id = u.id AND t.content_version <> u.content_version
     )
     SELECT * FROM updated`,
    [
      id,
      title,
      content,
      normalizeLanguage(body.sourceLanguage),
      status,
      body.publishedAt || (status === 'published' ? new Date().toISOString() : null),
      body.expiresAt || null,
      adminUserId,
    ],
  );
  if (!rows[0]) return { ok: false, status: 404, error: 'Announcement not found' };
  return { ok: true, body: { announcement: mapAnnouncement(rows[0], null) } };
}

async function deleteAnnouncement({ pool, id }) {
  const result = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
  if (result.rowCount === 0) return { ok: false, status: 404, error: 'Announcement not found' };
  return { ok: true, body: { ok: true } };
}

module.exports = {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  listPublicAnnouncements,
  normalizeLanguage,
  translateAnnouncement,
  translatedParts,
  updateAnnouncement,
};
