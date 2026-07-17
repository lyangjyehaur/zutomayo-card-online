#!/usr/bin/env node

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith('--')) throw new Error(`unknown argument: ${value}`);
  const key = value.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) throw new Error(`missing value for --${key}`);
  args.set(key, next);
  index += 1;
}

const host = args.get('host') || process.env.DEPLOY_HOST || '127.0.0.1';
const scheme = args.get('scheme') || process.env.DEPLOY_SCHEME || 'http';
const ports = {
  game: args.get('game-port') || process.env.GAME_PORT || '3000',
  api: args.get('api-port') || process.env.API_PORT || '3001',
  platform: args.get('platform-port') || process.env.PLATFORM_PORT || '3002',
};
const expectedBuildId = args.get('expected-build-id') || process.env.EXPECTED_BUILD_ID || '';
const checkBattleAssets = (args.get('check-battle-assets') || process.env.CHECK_BATTLE_ASSETS || 'false') === 'true';
const timeoutMs = Number(args.get('timeout-ms') || process.env.SMOKE_TIMEOUT_MS || 8_000);
const attempts = Number(args.get('attempts') || process.env.SMOKE_ATTEMPTS || 12);
const retryDelayMs = Number(args.get('retry-delay-ms') || process.env.SMOKE_RETRY_DELAY_MS || 5_000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be a positive number');
if (!Number.isInteger(attempts) || attempts <= 0) throw new Error('attempts must be a positive integer');
if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error('retry delay must be non-negative');

function endpoint(service, pathname) {
  return `${scheme}://${host}:${ports[service]}${pathname}`;
}

async function request(service, pathname) {
  const url = endpoint(service, pathname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) throw new Error(`${service}${pathname} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetry(service, pathname) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(service, pathname);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

async function requestAsset(pathname, expectedContentType) {
  const url = endpoint('game', pathname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: expectedContentType } });
    const contentType = response.headers.get('content-type') || '';
    const body = await response.arrayBuffer();
    if (!response.ok) throw new Error(`game${pathname} returned HTTP ${response.status}`);
    if (!contentType.toLowerCase().startsWith(expectedContentType)) {
      throw new Error(`game${pathname} returned unexpected content type: ${contentType || 'missing'}`);
    }
    if (body.byteLength === 0) throw new Error(`game${pathname} returned an empty asset`);
    return body.byteLength;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAssetWithRetry(pathname, expectedContentType) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestAsset(pathname, expectedContentType);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

function assertHealthy(service, pathname, body) {
  if (body?.ok === false || body?.status === 'down' || body?.status === 'degraded') {
    throw new Error(`${service}${pathname} is unhealthy: ${JSON.stringify(body)}`);
  }
}

const checks = [
  ['game', '/health'],
  ['game', '/ready'],
  ['api', '/health'],
  ['api', '/ready'],
  ['platform', '/health'],
  ['platform', '/ready'],
];
for (const [service, pathname] of checks) {
  const body = await requestWithRetry(service, pathname);
  assertHealthy(service, pathname, body);
  console.log(`smoke ok: ${service}${pathname}`);
}

const versions = await Promise.all([
  requestWithRetry('game', '/api/app-version').catch(() => requestWithRetry('game', '/api/version')),
  requestWithRetry('api', '/api/version'),
  requestWithRetry('platform', '/api/version'),
]);
const buildIds = versions.map((body) => String(body?.buildId || ''));
if (buildIds.some((value) => !value) || new Set(buildIds).size !== 1) {
  throw new Error(`runtime build IDs are inconsistent: ${JSON.stringify(buildIds)}`);
}
if (expectedBuildId && buildIds[0] !== expectedBuildId) {
  throw new Error(`runtime build ID ${buildIds[0]} does not match release ${expectedBuildId}`);
}
console.log(`smoke ok: buildId=${buildIds[0]}`);

if (checkBattleAssets) {
  for (const [pathname, contentType] of [
    ['/battle/chronos.svg', 'image/svg+xml'],
    ['/battle/medal.png', 'image/png'],
  ]) {
    const bytes = await requestAssetWithRetry(pathname, contentType);
    console.log(`smoke ok: game${pathname} (${bytes} bytes)`);
  }
}
