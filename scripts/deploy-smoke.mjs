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

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function decodeImageDimensions(buffer, format) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (format === 'jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('imgproxy original output is not a JPEG');
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += Math.max(2, length + 2);
    }
    throw new Error('JPEG dimensions were not found');
  }
  if (format === 'webp') {
    if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
      throw new Error('imgproxy WebP output has an invalid header');
    }
    const chunk = readAscii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
    }
    if (chunk === 'VP8L') {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    throw new Error(`unsupported WebP chunk ${chunk}`);
  }
  if (format === 'avif') {
    for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
      if (readAscii(bytes, offset, 4) !== 'ispe') continue;
      return { width: view.getUint32(offset + 8), height: view.getUint32(offset + 12) };
    }
    throw new Error('AVIF dimensions were not found');
  }
  throw new Error(`unsupported image format ${format}`);
}

async function requestImgproxyWithRetry(pathname, expectedContentType, format) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint('api', pathname), { signal: controller.signal });
      const contentType = response.headers.get('content-type') || '';
      const body = await response.arrayBuffer();
      if (!response.ok) throw new Error(`api${pathname} returned HTTP ${response.status}`);
      if (!contentType.toLowerCase().startsWith(expectedContentType)) {
        throw new Error(`api${pathname} returned unexpected content type: ${contentType || 'missing'}`);
      }
      if (body.byteLength <= 100) throw new Error(`api${pathname} returned an unexpectedly small image`);
      const dimensions = decodeImageDimensions(body, format);
      if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error(`api${pathname} has invalid dimensions`);
      return { bytes: body.byteLength, ...dimensions };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    } finally {
      clearTimeout(timeout);
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

const representativeCard = encodeURI('https://r2.dan.tw/cards/all-along-the-watchtower/zutomayocard_2nd_40.jpg')
  .replace(/@/g, '%40')
  .replace(/\?/g, '%3F')
  .replace(/#/g, '%23');
for (const [suffix, contentType, format] of [
  ['', 'image/jpeg', 'jpeg'],
  ['@webp', 'image/webp', 'webp'],
  ['@avif', 'image/avif', 'avif'],
]) {
  const pathname = `/api/imgproxy/rs:fit:320:0/plain/${representativeCard}${suffix}`;
  const result = await requestImgproxyWithRetry(pathname, contentType, format);
  console.log(`smoke ok: imgproxy ${format} (${result.width}x${result.height}, ${result.bytes} bytes)`);
}

if (checkBattleAssets) {
  for (const [pathname, contentType] of [
    ['/battle/chronos.svg', 'image/svg+xml'],
    ['/battle/medal.png', 'image/png'],
  ]) {
    const bytes = await requestAssetWithRetry(pathname, contentType);
    console.log(`smoke ok: game${pathname} (${bytes} bytes)`);
  }
}
