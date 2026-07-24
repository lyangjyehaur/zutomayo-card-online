/* global module, require */

const { normalizeOfficialLocale } = require('./officialRulingsService.cjs');

const PUBLIC_TRANSLATION_STATUSES = new Set(['machine', 'verified']);

function text(value) {
  return typeof value === 'string' ? value : '';
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function mapRuleDocumentRows(rows, requestedLocale) {
  if (rows.length === 0) return null;
  const translated = requestedLocale !== 'ja';
  const sections = rows.map((row) => {
    const hasTranslation =
      translated &&
      PUBLIC_TRANSLATION_STATUSES.has(row.translation_status) &&
      text(row.translated_title).trim() &&
      text(row.translated_body).trim();
    return {
      id: text(row.section_id),
      number: text(row.section_number),
      parentId: text(row.parent_section_id) || null,
      level: Number(row.level) || 1,
      order: Number(row.sort_order) || 0,
      pages: { start: Number(row.page_start) || 1, end: Number(row.page_end) || 1 },
      source: { title: text(row.section_title_ja), body: text(row.body_ja) },
      localized: {
        title: hasTranslation ? text(row.translated_title) : text(row.section_title_ja),
        body: hasTranslation ? text(row.translated_body) : text(row.body_ja),
      },
      effectiveLocale: hasTranslation ? requestedLocale : 'ja',
      translationStatus: hasTranslation ? text(row.translation_status) : 'source',
    };
  });
  return {
    id: text(rows[0].document_id),
    version: text(rows[0].document_version),
    publishedAt: dateOnly(rows[0].published_at),
    sourceUrl: text(rows[0].source_url),
    sourceSha256: text(rows[0].source_sha256),
    pageCount: Number(rows[0].source_page_count) || 0,
    sourceCheckedAt: isoDate(rows[0].source_checked_at),
    activatedAt: isoDate(rows[0].activated_at),
    requestedLocale,
    source: { title: text(rows[0].title_ja), summary: text(rows[0].summary_ja) },
    localized: {
      title: sections[0]?.localized.title || text(rows[0].title_ja),
      summary: sections[0]?.localized.body || text(rows[0].summary_ja),
    },
    translationStatus: translated ? sections[0]?.translationStatus || 'source' : 'source',
    sections: sections.slice(1),
  };
}

async function getPublicRuleDocument({ pool, language, documentId }) {
  const cleanId = text(documentId).trim();
  if (!['grand', 'floor'].includes(cleanId)) {
    return { ok: false, status: 400, error: 'Invalid official rule document id' };
  }
  try {
    const locale = normalizeOfficialLocale(language);
    const { rows } = await pool.query(
      `SELECT document.*, active.activated_at,
              section.section_id, section.section_number, section.parent_section_id,
              section.level, section.sort_order, section.page_start, section.page_end,
              section.title_ja AS section_title_ja, section.body_ja,
              translation.title_text AS translated_title,
              translation.body_text AS translated_body,
              translation.status AS translation_status
         FROM official_rule_active_versions active
         JOIN official_rule_documents document
           ON document.document_id=active.document_id
          AND document.document_version=active.document_version
         JOIN official_rule_sections section
           ON section.document_id=document.document_id
          AND section.document_version=document.document_version
         LEFT JOIN official_rule_section_translations translation
           ON translation.document_id=section.document_id
          AND translation.document_version=section.document_version
          AND translation.section_id=section.section_id
          AND translation.locale=$1
          AND translation.status IN ('machine', 'verified')
        WHERE active.document_id=$2 AND document.publication_status='active'
        ORDER BY section.sort_order ASC`,
      [locale, cleanId],
    );
    const document = mapRuleDocumentRows(rows, locale);
    if (!document) return { ok: false, status: 404, error: 'Official rule document not found' };
    if (locale !== 'ja' && document.sections.some((section) => section.effectiveLocale !== locale)) {
      return { ok: false, status: 503, error: 'Official rule document translation release is incomplete' };
    }
    if (locale !== 'ja' && document.translationStatus === 'source') {
      return { ok: false, status: 503, error: 'Official rule document translation release is incomplete' };
    }
    return { ok: true, body: { document } };
  } catch {
    return { ok: false, status: 503, error: 'Official rule document unavailable' };
  }
}

module.exports = { getPublicRuleDocument, mapRuleDocumentRows };
