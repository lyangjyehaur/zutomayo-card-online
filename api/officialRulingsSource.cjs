/* global AbortSignal, module */

const crypto = require('node:crypto');

const QA_DATA_URL =
  'https://script.google.com/macros/s/AKfycbxezC8Yd98DvURUQCOVlPawdRyu2XHCsBIRbWCGx_IKlqv6DTX2behOrEx0r8HiWhtTxw/exec';
const ERRATA_BASE_URL = 'https://zutomayocard.net/errata/';
const PACK_PREFIX = new Map([
  ['THE WORLD IS CHANGING', '1st'],
  ['ALL ALONG THE WATCHTOWER', '2nd'],
  ['Off Minor', '3rd'],
  ['Fantasy Is Reality', '4th'],
]);
const HTML_ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

function normalizeOfficialText(value) {
  return String(value ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (entity) => HTML_ENTITIES[entity] || entity)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeOfficialCardName(value) {
  return normalizeOfficialText(value).normalize('NFKC').replace(/\s+/g, '');
}

function officialCorrectedNameMatches(correctedText, canonicalName) {
  const corrected = normalizeOfficialCardName(correctedText);
  const canonical = normalizeOfficialCardName(canonicalName);
  return Boolean(canonical) && corrected.includes(canonical);
}

function strings(value) {
  return Array.isArray(value) ? value.map(normalizeOfficialText).filter(Boolean) : [];
}

function normalizeQaRows(raw) {
  if (!Array.isArray(raw)) throw new Error('Official Q&A response must contain an array');
  const rows = raw
    .filter((item) => item && typeof item === 'object' && item.public === '公開')
    .map((item) => ({
      id: normalizeOfficialText(item.id),
      number: Number(item.number),
      date: normalizeOfficialText(item.date).slice(0, 10),
      question: normalizeOfficialText(item.question),
      answer: normalizeOfficialText(item.answer),
      tags: strings(item.tags),
      relatedCards: strings(item.relatedCards || item.card),
    }))
    .sort((left, right) => left.number - right.number);
  const ids = new Set();
  const numbers = new Set();
  for (const row of rows) {
    if (!/^qa_\d+$/.test(row.id)) throw new Error(`Invalid official Q&A id: ${row.id || '(empty)'}`);
    if (!Number.isInteger(row.number) || row.number <= 0) throw new Error(`Invalid official Q&A number: ${row.number}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid official Q&A date: ${row.id}`);
    if (!row.question || !row.answer) throw new Error(`Official Q&A question/answer is empty: ${row.id}`);
    if (ids.has(row.id) || numbers.has(row.number)) throw new Error(`Duplicate official Q&A row: ${row.id}`);
    ids.add(row.id);
    numbers.add(row.number);
  }
  if (rows.length < 50) throw new Error(`Official Q&A source unexpectedly returned only ${rows.length} public rows`);
  return rows;
}

function mainHtml(html) {
  const match = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!match) throw new Error('Official page is missing <main>');
  return match[1];
}

function paragraphs(html) {
  return [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeOfficialText(match[1]))
    .filter(Boolean);
}

function parseErrataList(html) {
  const items = [
    ...mainHtml(html).matchAll(
      /<a\b[^>]*href=["'](?:https:\/\/zutomayocard\.net)?\/errata\/(\d{3})\/["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ]
    .map((match) => ({ errataId: match[1], publishedAt: paragraphs(match[2])[0] || '' }))
    .filter((item) => /^\d{4}\.\d{2}\.\d{2}$/.test(item.publishedAt))
    .map((item) => ({ ...item, publishedAt: item.publishedAt.replaceAll('.', '-') }));
  if (items.length === 0) throw new Error('Official errata list parser found no entries');
  return items;
}

function cardIdFor(pack, cardNumber) {
  const prefix = PACK_PREFIX.get(pack);
  const number = Number(String(cardNumber).split('/')[0]);
  if (!prefix || !Number.isInteger(number) || number <= 0) {
    throw new Error(`Cannot map official errata card: ${pack} ${cardNumber}`);
  }
  return `${prefix}_${number}`;
}

function parseErrataDetail(html, meta) {
  const values = paragraphs(mainHtml(html));
  if (values[0] !== '誤' || values[2] !== '正') {
    throw new Error(`Official errata ${meta.errataId} has an unexpected correction layout`);
  }
  const row = {
    errataId: meta.errataId,
    cardId: cardIdFor(values[9] || '', values[11] || ''),
    publishedAt: meta.publishedAt,
    cardName: values[5] || '',
    rarity: values[7] || '',
    pack: values[9] || '',
    cardNumber: values[11] || '',
    incorrectText: values[1] || '',
    correctedText: values[3] || '',
    reason: values[12] || '',
    replacementPolicy: values[13] || '',
    usagePolicy: values.slice(14).join('\n'),
    sourceUrl: `${ERRATA_BASE_URL}${meta.errataId}/`,
  };
  for (const [field, value] of Object.entries(row)) {
    if (!value) throw new Error(`Official errata ${meta.errataId} has empty ${field}`);
  }
  return row;
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'text/html,application/json', 'User-Agent': 'zutomayo-card-online-official-sync/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}: ${url}`);
  return response.text();
}

async function fetchOfficialQa(fetchImpl) {
  const raw = JSON.parse(await fetchText(fetchImpl, QA_DATA_URL));
  return normalizeQaRows(raw.qa);
}

async function fetchOfficialErrata(fetchImpl) {
  const entries = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const url = page === 1 ? ERRATA_BASE_URL : `${ERRATA_BASE_URL}?page=${page}`;
    const html = await fetchText(fetchImpl, url);
    for (const item of parseErrataList(html)) entries.set(item.errataId, item);
    if (!html.includes(`errata?page=${page + 1}`)) break;
  }
  const rows = await Promise.all(
    [...entries.values()].map(async (meta) =>
      parseErrataDetail(await fetchText(fetchImpl, `${ERRATA_BASE_URL}${meta.errataId}/`), meta),
    ),
  );
  if (rows.length === 0) throw new Error('Official errata source returned no notices');
  return rows.sort((left, right) => left.errataId.localeCompare(right.errataId));
}

function officialContentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function qaHashInput(row) {
  return {
    number: row.number,
    date: row.date,
    question: row.question,
    answer: row.answer,
    tags: row.tags,
    relatedCards: row.relatedCards,
  };
}

function errataHashInput(row) {
  return {
    publishedAt: row.publishedAt,
    cardId: row.cardId,
    cardNumber: row.cardNumber,
    incorrectText: row.incorrectText,
    correctedText: row.correctedText,
    reason: row.reason,
    replacementPolicy: row.replacementPolicy,
    usagePolicy: row.usagePolicy,
  };
}

async function fetchOfficialSourceSnapshot(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Official source fetch is unavailable');
  const [qa, errata] = await Promise.all([fetchOfficialQa(fetchImpl), fetchOfficialErrata(fetchImpl)]);
  return { qa, errata };
}

module.exports = {
  ERRATA_BASE_URL,
  QA_DATA_URL,
  errataHashInput,
  fetchOfficialSourceSnapshot,
  normalizeOfficialText,
  officialCorrectedNameMatches,
  normalizeQaRows,
  officialContentHash,
  parseErrataDetail,
  parseErrataList,
  qaHashInput,
};
