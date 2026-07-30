/* global module */

const crypto = require('crypto');
const { KNOWLEDGE_SEARCH_TYPES, buildKnowledgeDocuments } = require('./knowledgeSearchDocuments.cjs');
const { buildTerminologySynonyms } = require('./knowledgeSearchSynonyms.cjs');

const DEFAULT_INDEX_UID = 'zutomayo_knowledge';
const DEFAULT_SEARCH_TIMEOUT_MS = 2500;
const DEFAULT_REINDEX_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_REINDEX_DEBOUNCE_MS = 2000;
const DEFAULT_FALLBACK_CACHE_MS = 60 * 1000;
const SEARCH_SYNC_LOCK_KEY = 'search:index:rebuild';
const HIGHLIGHT_PRE_TAG = '\uE000';
const HIGHLIGHT_POST_TAG = '\uE001';

const INDEX_SETTINGS = Object.freeze({
  searchableAttributes: ['sourceId', 'title', 'aliases', 'keywords', 'tags', 'subtitle', 'body', 'relatedCardIds'],
  filterableAttributes: [
    'type',
    'locale',
    'pack',
    'rarity',
    'element',
    'cardType',
    'distributionType',
    'documentId',
    'tags',
    'relatedCardIds',
  ],
  sortableAttributes: ['sortNumber', 'publishedAt', 'updatedAt'],
  displayedAttributes: [
    'uid',
    'type',
    'locale',
    'sourceId',
    'title',
    'subtitle',
    'body',
    'tags',
    'relatedCardIds',
    'url',
    'image',
    'pack',
    'rarity',
    'element',
    'cardType',
    'distributionType',
    'documentId',
    'sortNumber',
    'publishedAt',
    'updatedAt',
  ],
  typoTolerance: { enabled: true, disableOnAttributes: ['sourceId', 'relatedCardIds'] },
  pagination: { maxTotalHits: 10000 },
  faceting: { maxValuesPerFacet: 200, sortFacetValuesBy: { '*': 'alpha' } },
  synonyms: buildTerminologySynonyms(),
});

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function knowledgeSearchConfig(env = process.env) {
  const host = String(env.MEILI_HOST || env.MEILISEARCH_URL || '')
    .trim()
    .replace(/\/+$/, '');
  return {
    enabled: Boolean(host),
    host,
    apiKey: String(env.MEILI_MASTER_KEY || '').trim(),
    indexUid: String(env.MEILI_INDEX_UID || DEFAULT_INDEX_UID).trim() || DEFAULT_INDEX_UID,
    timeoutMs: boundedNumber(env.MEILI_TIMEOUT_MS, DEFAULT_SEARCH_TIMEOUT_MS, 250, 15000),
    fallbackCacheMs: boundedNumber(env.SEARCH_FALLBACK_CACHE_MS, DEFAULT_FALLBACK_CACHE_MS, 1000, 3600000),
    reindexIntervalMs: boundedNumber(
      env.SEARCH_REINDEX_INTERVAL_MS,
      DEFAULT_REINDEX_INTERVAL_MS,
      30000,
      24 * 60 * 60 * 1000,
    ),
    reindexDebounceMs: boundedNumber(env.SEARCH_REINDEX_DEBOUNCE_MS, DEFAULT_REINDEX_DEBOUNCE_MS, 250, 30000),
  };
}

function validateKnowledgeSearchConfig(env = process.env) {
  const config = knowledgeSearchConfig(env);
  if (!config.enabled) return config;
  let parsed;
  try {
    parsed = new URL(config.host);
  } catch {
    throw new Error('MEILI_HOST must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('MEILI_HOST must use HTTP or HTTPS');
  if (env.NODE_ENV === 'production' && config.apiKey.length < 16) {
    throw new Error('MEILI_MASTER_KEY must contain at least 16 characters when Meilisearch is enabled in production');
  }
  return config;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function filterLiteral(value) {
  return JSON.stringify(String(value));
}

function buildMeiliFilter(params) {
  const filters = [`locale = ${filterLiteral(params.locale)}`];
  const scopes = params.scopes?.length ? params.scopes : KNOWLEDGE_SEARCH_TYPES;
  filters.push(`type IN [${scopes.map(filterLiteral).join(', ')}]`);
  for (const [param, attribute] of [
    ['pack', 'pack'],
    ['rarity', 'rarity'],
    ['element', 'element'],
    ['cardType', 'cardType'],
    ['distributionType', 'distributionType'],
    ['documentId', 'documentId'],
    ['tag', 'tags'],
    ['cardId', 'relatedCardIds'],
  ]) {
    if (params[param]) filters.push(`${attribute} = ${filterLiteral(params[param])}`);
  }
  return filters;
}

function parseKnowledgeSearchScopes(value) {
  const raw = String(value || 'all').trim();
  if (!raw || raw === 'all') return [];
  const scopes = [
    ...new Set(
      raw
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
  return scopes.length > 0 && scopes.every((scope) => KNOWLEDGE_SEARCH_TYPES.includes(scope)) ? scopes : null;
}

function documentMatchesFilters(document, params) {
  if (document.locale !== params.locale) return false;
  if (params.scopes?.length && !params.scopes.includes(document.type)) return false;
  for (const [param, attribute] of [
    ['pack', 'pack'],
    ['rarity', 'rarity'],
    ['element', 'element'],
    ['cardType', 'cardType'],
    ['distributionType', 'distributionType'],
    ['documentId', 'documentId'],
  ]) {
    if (params[param] && document[attribute] !== params[param]) return false;
  }
  if (params.tag && !document.tags.includes(params.tag)) return false;
  if (params.cardId && !document.relatedCardIds.includes(params.cardId)) return false;
  return true;
}

function fallbackRank(document, query) {
  const sourceId = normalizeSearchText(document.sourceId);
  const title = normalizeSearchText(document.title);
  if (sourceId === query) return 0;
  if (title === query) return 1;
  if (sourceId.startsWith(query)) return 2;
  if (title.startsWith(query)) return 3;
  if (title.includes(query)) return 4;
  if (document.aliases.some((value) => normalizeSearchText(value).includes(query))) return 5;
  return 6;
}

function documentSearchText(document) {
  return normalizeSearchText(
    [
      document.sourceId,
      document.title,
      document.subtitle,
      document.body,
      ...document.aliases,
      ...document.tags,
      ...document.keywords,
      ...document.relatedCardIds,
    ].join('\n'),
  );
}

function literalHighlightRanges(value, query) {
  const source = String(value || '');
  const haystack = source.toLocaleLowerCase();
  const needles = [
    ...new Set(
      String(query || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
  const ranges = [];
  for (const needle of needles) {
    let offset = 0;
    while (offset < haystack.length) {
      const start = haystack.indexOf(needle, offset);
      if (start < 0) break;
      ranges.push({ start, end: start + needle.length });
      offset = start + Math.max(1, needle.length);
    }
  }
  return ranges
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
}

function parseHighlightedText(value, fallback, query) {
  const formatted = String(value ?? fallback ?? '');
  let text = '';
  let rangeStart = -1;
  const ranges = [];
  for (const character of formatted) {
    if (character === HIGHLIGHT_PRE_TAG) {
      if (rangeStart < 0) rangeStart = text.length;
    } else if (character === HIGHLIGHT_POST_TAG) {
      if (rangeStart >= 0 && text.length > rangeStart) ranges.push({ start: rangeStart, end: text.length });
      rangeStart = -1;
    } else {
      text += character;
    }
  }
  if (rangeStart >= 0 && text.length > rangeStart) ranges.push({ start: rangeStart, end: text.length });
  return { text, ranges: ranges.length > 0 ? ranges : literalHighlightRanges(text, query) };
}

function fallbackSnippet(body, query, maximumLength = 600) {
  const source = String(body || '');
  if (source.length <= maximumLength) return source;
  const needle = String(query || '')
    .trim()
    .toLocaleLowerCase();
  const matchAt = needle ? source.toLocaleLowerCase().indexOf(needle) : -1;
  const start = Math.max(0, matchAt >= 0 ? matchAt - Math.floor(maximumLength / 3) : 0);
  const end = Math.min(source.length, start + maximumLength);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

function resultHit(document, formatted = {}, query = '') {
  const formattedRecord = formatted && typeof formatted === 'object' ? formatted : { body: formatted };
  const title = parseHighlightedText(formattedRecord.title, document.title, query);
  const snippet = parseHighlightedText(formattedRecord.body, fallbackSnippet(document.body, query), query);
  return {
    uid: document.uid,
    type: document.type,
    sourceId: document.sourceId,
    title: title.text,
    titleHighlights: title.ranges,
    subtitle: document.subtitle,
    snippet: snippet.text.slice(0, 600),
    snippetHighlights: snippet.ranges
      .filter((range) => range.start < 600)
      .map((range) => ({
        start: range.start,
        end: Math.min(range.end, 600),
      })),
    tags: document.tags,
    relatedCardIds: document.relatedCardIds,
    url: document.url,
    image: document.image,
    pack: document.pack,
    rarity: document.rarity,
    element: document.element,
    cardType: document.cardType,
    distributionType: document.distributionType,
    documentId: document.documentId,
    sortNumber: document.sortNumber,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt,
  };
}

async function responseBody(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

function createMeiliHttpClient(config, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Meilisearch');

  async function request(path, options = {}) {
    const response = await fetchImpl(`${config.host}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...(options.headers || {}),
      },
      signal: options.signal || AbortSignal.timeout(config.timeoutMs),
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const error = new Error(`Meilisearch ${response.status}: ${body.message || body.code || 'request failed'}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function waitForTask(taskUid, timeoutMs = Math.max(config.timeoutMs * 4, 10000)) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const task = await request(`/tasks/${encodeURIComponent(String(taskUid))}`);
      if (task.status === 'succeeded') return task;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new Error(`Meilisearch task ${taskUid} ${task.status}: ${task.error?.message || 'unknown error'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Meilisearch task ${taskUid} timed out`);
  }

  async function taskRequest(path, options) {
    const task = await request(path, options);
    if (!Number.isInteger(task.taskUid)) throw new Error('Meilisearch response did not include taskUid');
    return waitForTask(task.taskUid);
  }

  return { request, taskRequest, waitForTask };
}

async function ensureIndex(client, indexUid) {
  try {
    await client.request(`/indexes/${encodeURIComponent(indexUid)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await client.taskRequest('/indexes', {
      method: 'POST',
      body: JSON.stringify({ uid: indexUid, primaryKey: 'uid' }),
    });
  }
}

async function replaceIndex(client, indexUid, documents, settings = INDEX_SETTINGS, now = Date.now) {
  await ensureIndex(client, indexUid);
  const temporaryUid = `${indexUid}_build_${now()}_${crypto.randomBytes(4).toString('hex')}`;
  try {
    await client.taskRequest('/indexes', {
      method: 'POST',
      body: JSON.stringify({ uid: temporaryUid, primaryKey: 'uid' }),
    });
    await client.taskRequest(`/indexes/${encodeURIComponent(temporaryUid)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
    for (let offset = 0; offset < documents.length; offset += 500) {
      await client.taskRequest(`/indexes/${encodeURIComponent(temporaryUid)}/documents?primaryKey=uid`, {
        method: 'POST',
        body: JSON.stringify(documents.slice(offset, offset + 500)),
      });
    }
    await client.taskRequest('/swap-indexes', {
      method: 'POST',
      body: JSON.stringify([{ indexes: [indexUid, temporaryUid] }]),
    });
    await client.taskRequest(`/indexes/${encodeURIComponent(temporaryUid)}`, { method: 'DELETE' });
  } catch (error) {
    await client
      .taskRequest(`/indexes/${encodeURIComponent(temporaryUid)}`, { method: 'DELETE' })
      .catch(() => undefined);
    throw error;
  }
}

function createKnowledgeSearchService({
  pool,
  redis,
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  documentLoader = buildKnowledgeDocuments,
  now = Date.now,
  onSync = () => undefined,
} = {}) {
  if (!pool) throw new Error('Knowledge search requires a PostgreSQL pool');
  const config = knowledgeSearchConfig(env);
  const client = config.enabled ? createMeiliHttpClient(config, fetchImpl) : null;
  let fallbackDocuments = [];
  let fallbackLoadedAt = 0;
  let fallbackLoadPromise = null;
  let lastSuccessfulSyncAt = 0;
  let lastSyncError = '';
  let indexedDocumentCount = 0;
  let syncTimer = null;
  let scheduledSyncTimer = null;

  async function loadFallbackDocuments(force = false) {
    if (!force && fallbackDocuments.length > 0 && now() - fallbackLoadedAt < config.fallbackCacheMs) {
      return fallbackDocuments;
    }
    if (fallbackLoadPromise) return fallbackLoadPromise;
    fallbackLoadPromise = Promise.resolve(documentLoader(pool))
      .then((documents) => {
        fallbackDocuments = documents;
        fallbackLoadedAt = now();
        return documents;
      })
      .finally(() => {
        fallbackLoadPromise = null;
      });
    return fallbackLoadPromise;
  }

  async function fallbackSearch(params) {
    const documents = await loadFallbackDocuments();
    const query = normalizeSearchText(params.query);
    const matched = documents
      .filter((document) => documentMatchesFilters(document, params))
      .filter((document) => !query || documentSearchText(document).includes(query))
      .sort(
        (left, right) =>
          fallbackRank(left, query) - fallbackRank(right, query) ||
          left.sortNumber - right.sortNumber ||
          left.sourceId.localeCompare(right.sourceId, 'en', { numeric: true }),
      );
    const offset = params.offset || 0;
    const limit = params.limit || 24;
    return {
      hits: matched.slice(offset, offset + limit).map((document) => resultHit(document, {}, params.query)),
      estimatedTotalHits: matched.length,
      limit,
      offset,
      processingTimeMs: 0,
      engine: 'postgres-fallback',
    };
  }

  async function search(params) {
    if (!normalizeSearchText(params.query)) {
      return {
        hits: [],
        estimatedTotalHits: 0,
        limit: params.limit || 24,
        offset: params.offset || 0,
        processingTimeMs: 0,
        engine: config.enabled ? 'meilisearch' : 'postgres-fallback',
      };
    }
    if (!config.enabled || !client) return fallbackSearch(params);
    const started = now();
    try {
      const response = await client.request(`/indexes/${encodeURIComponent(config.indexUid)}/search`, {
        method: 'POST',
        body: JSON.stringify({
          q: params.query,
          filter: buildMeiliFilter(params),
          limit: params.limit || 24,
          offset: params.offset || 0,
          attributesToCrop: ['body'],
          attributesToHighlight: ['title', 'body'],
          cropLength: 48,
          cropMarker: '…',
          highlightPreTag: HIGHLIGHT_PRE_TAG,
          highlightPostTag: HIGHLIGHT_POST_TAG,
          showRankingScore: false,
        }),
      });
      return {
        hits: (response.hits || []).map((hit) => resultHit(hit, hit._formatted, params.query)),
        estimatedTotalHits: Number(response.estimatedTotalHits) || 0,
        limit: params.limit || 24,
        offset: params.offset || 0,
        processingTimeMs: Number(response.processingTimeMs) || Math.max(0, now() - started),
        engine: 'meilisearch',
      };
    } catch (error) {
      logger.warn?.({ err: error }, 'Meilisearch query failed; using PostgreSQL fallback');
      return fallbackSearch(params);
    }
  }

  async function suggest(params) {
    const limit = Math.max(1, Math.min(Number(params.limit) || 8, 8));
    const result = await search({ ...params, limit: Math.min(100, limit * 4), offset: 0 });
    const seen = new Set();
    const suggestions = [];
    for (const hit of result.hits) {
      const key = `${hit.type}:${hit.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        uid: hit.uid,
        type: hit.type,
        sourceId: hit.sourceId,
        title: hit.title,
        titleHighlights: hit.titleHighlights,
        subtitle: hit.subtitle,
        url: hit.url,
      });
      if (suggestions.length >= limit) break;
    }
    return { suggestions, engine: result.engine, processingTimeMs: result.processingTimeMs };
  }

  async function reindex() {
    const documents = await loadFallbackDocuments(true);
    if (!config.enabled || !client) {
      indexedDocumentCount = documents.length;
      lastSuccessfulSyncAt = now();
      lastSyncError = '';
      const result = { enabled: false, documentCount: documents.length };
      onSync('success', result);
      return result;
    }
    try {
      await replaceIndex(client, config.indexUid, documents, INDEX_SETTINGS, now);
      indexedDocumentCount = documents.length;
      lastSuccessfulSyncAt = now();
      lastSyncError = '';
      const result = { enabled: true, documentCount: documents.length, indexUid: config.indexUid };
      onSync('success', result);
      return result;
    } catch (error) {
      lastSyncError = error instanceof Error ? error.message : String(error);
      onSync('error', { enabled: true, documentCount: documents.length, error: lastSyncError });
      throw error;
    }
  }

  async function acquireSyncLock() {
    if (!redis) return { acquired: true, token: '' };
    const token = crypto.randomUUID();
    try {
      const result = await redis.set(
        SEARCH_SYNC_LOCK_KEY,
        token,
        'PX',
        Math.max(config.reindexIntervalMs, 60000),
        'NX',
      );
      return { acquired: result === 'OK', token };
    } catch {
      return { acquired: false, token };
    }
  }

  async function releaseSyncLock(token) {
    if (!redis || !token) return;
    await redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        SEARCH_SYNC_LOCK_KEY,
        token,
      )
      .catch(() => undefined);
  }

  async function synchronizedReindex() {
    const lock = await acquireSyncLock();
    if (!lock.acquired) return { skipped: true };
    try {
      return await reindex();
    } finally {
      await releaseSyncLock(lock.token);
    }
  }

  function scheduleReindex() {
    fallbackDocuments = [];
    fallbackLoadedAt = 0;
    if (!config.enabled || scheduledSyncTimer) return;
    scheduledSyncTimer = setTimeout(() => {
      scheduledSyncTimer = null;
      void synchronizedReindex().catch((error) =>
        logger.error?.({ err: error }, 'Knowledge search mutation sync failed'),
      );
    }, config.reindexDebounceMs);
    scheduledSyncTimer.unref?.();
  }

  function start() {
    if (syncTimer || !config.enabled) return;
    void synchronizedReindex().catch((error) => logger.error?.({ err: error }, 'Knowledge search initial sync failed'));
    syncTimer = setInterval(() => {
      void synchronizedReindex().catch((error) => logger.error?.({ err: error }, 'Knowledge search reconcile failed'));
    }, config.reindexIntervalMs);
    syncTimer.unref?.();
  }

  function stop() {
    if (syncTimer) clearInterval(syncTimer);
    if (scheduledSyncTimer) clearTimeout(scheduledSyncTimer);
    syncTimer = null;
    scheduledSyncTimer = null;
  }

  function status() {
    return {
      enabled: config.enabled,
      indexUid: config.indexUid,
      lastSuccessfulSyncAt: lastSuccessfulSyncAt ? new Date(lastSuccessfulSyncAt).toISOString() : null,
      documentCount: indexedDocumentCount || fallbackDocuments.length,
      lastSyncError,
      fallbackReady: fallbackDocuments.length > 0,
    };
  }

  return {
    config,
    fallbackSearch,
    reindex,
    scheduleReindex,
    search,
    start,
    status,
    stop,
    suggest,
    synchronizedReindex,
  };
}

module.exports = {
  DEFAULT_INDEX_UID,
  HIGHLIGHT_POST_TAG,
  HIGHLIGHT_PRE_TAG,
  INDEX_SETTINGS,
  SEARCH_SYNC_LOCK_KEY,
  buildMeiliFilter,
  createKnowledgeSearchService,
  createMeiliHttpClient,
  documentMatchesFilters,
  filterLiteral,
  knowledgeSearchConfig,
  literalHighlightRanges,
  normalizeSearchText,
  parseKnowledgeSearchScopes,
  parseHighlightedText,
  replaceIndex,
  resultHit,
  validateKnowledgeSearchConfig,
};
