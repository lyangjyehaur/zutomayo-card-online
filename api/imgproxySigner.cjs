/* global module, require, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');

const CARD_IMAGE_WIDTH_PATTERN = '(?:128|192|320|480|720|960)';
const SIGNABLE_PATH_RE = new RegExp(`^/rs:fit:${CARD_IMAGE_WIDTH_PATTERN}:0/plain/`);
const ALLOWED_OUTPUT_FORMATS = new Set(['avif', 'webp']);

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function parseAllowedSources(value) {
  return String(value || 'https://r2.dan.tw/cards/')
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean);
}

function splitPlainSource(path) {
  const marker = '/plain/';
  const index = path.indexOf(marker);
  if (index === -1) return null;

  const rawSourceWithFormat = path.slice(index + marker.length);
  const formatMatch = rawSourceWithFormat.match(/@([a-z0-9]+)$/i);
  const format = formatMatch?.[1]?.toLowerCase() || '';
  const rawSource = formatMatch ? rawSourceWithFormat.slice(0, -formatMatch[0].length) : rawSourceWithFormat;
  return { rawSource, format };
}

function sourceFromImgproxyPath(path) {
  const parsed = splitPlainSource(path);
  if (!parsed) return '';
  try {
    return decodeURIComponent(parsed.rawSource);
  } catch {
    return '';
  }
}

function isAllowedImgproxyPath(path, allowedSources) {
  if (path.includes('?')) return false;
  if (!SIGNABLE_PATH_RE.test(path)) return false;
  const parsed = splitPlainSource(path);
  if (!parsed) return false;
  if (parsed.format && !ALLOWED_OUTPUT_FORMATS.has(parsed.format)) return false;
  const source = sourceFromImgproxyPath(path);
  return allowedSources.some((allowed) => source.startsWith(allowed));
}

function signImgproxyPath(path, keyHex, saltHex) {
  const key = Buffer.from(keyHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  if (key.length === 0 || salt.length === 0) throw new Error('IMGPROXY_KEY and IMGPROXY_SALT must be hex strings');

  return crypto
    .createHmac('sha256', key)
    .update(Buffer.concat([salt, Buffer.from(path)]))
    .digest('base64url');
}

function buildSignedImgproxyUrl({ path, baseUrl, keyHex, saltHex, allowedSources }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl || !keyHex || !saltHex) return { ok: false, status: 503, error: 'imgproxy is not configured' };

  const sources = Array.isArray(allowedSources) ? allowedSources : parseAllowedSources(allowedSources);
  if (!isAllowedImgproxyPath(path, sources)) return { ok: false, status: 400, error: 'invalid imgproxy path' };

  const signature = signImgproxyPath(path, keyHex, saltHex);
  return { ok: true, url: `${normalizedBaseUrl}/${signature}${path}` };
}

module.exports = {
  buildSignedImgproxyUrl,
  isAllowedImgproxyPath,
  parseAllowedSources,
  signImgproxyPath,
};
