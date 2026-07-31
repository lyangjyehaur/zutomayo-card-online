import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ResponseSnapshot {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
  status: number;
  url: string;
}

interface RouteOptions {
  directAddress?: string;
  expectCloudflare?: boolean;
  expectedBuildId?: string;
  label: string;
}

function cacheControl(response: ResponseSnapshot): string {
  return String(response.headers['cache-control'] || '').toLowerCase();
}

function requireStatus(response: ResponseSnapshot, expected: number): void {
  if (response.status !== expected)
    throw new Error(`${response.url} returned HTTP ${response.status}, expected ${expected}`);
}

function requireCacheDirective(response: ResponseSnapshot, directive: string): void {
  if (!cacheControl(response).includes(directive.toLowerCase())) {
    throw new Error(
      `${response.url} is missing Cache-Control ${directive}: ${cacheControl(response) || 'header absent'}`,
    );
  }
}

function request(baseUrl: URL, pathname: string, directAddress?: string): Promise<ResponseSnapshot> {
  const url = new URL(pathname, baseUrl);
  const transport = url.protocol === 'https:' ? https : http;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('cache smoke URL must use HTTP or HTTPS');
  if (directAddress && net.isIP(directAddress) === 0) throw new Error('direct address must be an IPv4 or IPv6 literal');

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: directAddress || url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Accept: '*/*',
          Host: url.host,
          'User-Agent': 'zutomayo-cache-policy-smoke/1',
        },
        ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            req.destroy(new Error(`${url} exceeded the 8 MiB smoke response limit`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode || 0,
            url: url.toString(),
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${url} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

async function verifyRoute(baseUrl: URL, options: RouteOptions): Promise<string> {
  const get = (pathname: string) => request(baseUrl, pathname, options.directAddress);

  const version = await get('/api/app-version');
  requireStatus(version, 200);
  requireCacheDirective(version, 'no-store');
  const versionBody = JSON.parse(version.body.toString('utf8')) as { buildId?: string };
  const buildId = String(versionBody.buildId || '');
  if (!buildId) throw new Error(`${options.label} app version is missing buildId`);
  if (options.expectedBuildId && buildId !== options.expectedBuildId) {
    throw new Error(`${options.label} build ${buildId} does not match ${options.expectedBuildId}`);
  }

  const shell = await get('/');
  requireStatus(shell, 200);
  requireCacheDirective(shell, 'no-store');
  const html = shell.body.toString('utf8');
  const assetPath = html.match(/["'](\/assets\/[^"']+\.(?:js|css))["']/)?.[1];
  if (!assetPath) throw new Error(`${options.label} HTML does not reference a hashed Vite asset`);

  const asset = await get(assetPath);
  requireStatus(asset, 200);
  requireCacheDirective(asset, 'max-age=31536000');
  requireCacheDirective(asset, 'immutable');

  for (const pathname of ['/sw.js', '/manifest.webmanifest']) {
    const response = await get(pathname);
    requireStatus(response, 200);
    requireCacheDirective(response, 'max-age=0');
    requireCacheDirective(response, 'must-revalidate');
    if (cacheControl(response).includes('immutable')) throw new Error(`${response.url} must not be immutable`);
  }

  const versionedBattle = await get(`/battle/chronos.svg?v=${encodeURIComponent(buildId)}`);
  requireStatus(versionedBattle, 200);
  requireCacheDirective(versionedBattle, 'max-age=31536000');
  requireCacheDirective(versionedBattle, 'immutable');
  if (!String(versionedBattle.headers['content-type'] || '').includes('image/svg+xml')) {
    throw new Error(`${versionedBattle.url} did not return SVG content`);
  }

  const unversionedBattle = await get('/battle/chronos.svg');
  requireStatus(unversionedBattle, 200);
  requireCacheDirective(unversionedBattle, 'no-store');

  const missingAsset = await get(
    `/battle/__cache-smoke-missing-${encodeURIComponent(buildId)}.svg?v=${encodeURIComponent(buildId)}`,
  );
  requireStatus(missingAsset, 404);
  requireCacheDirective(missingAsset, 'no-store');
  if (String(missingAsset.headers['content-type'] || '').includes('text/html')) {
    throw new Error(`${missingAsset.url} returned the SPA shell for a missing asset`);
  }

  const officialStatus = await get('/api/official/status');
  requireStatus(officialStatus, 200);
  requireCacheDirective(officialStatus, 'max-age=0');
  requireCacheDirective(officialStatus, 's-maxage=60');

  const presence = await get('/api/presence');
  requireStatus(presence, 200);
  requireCacheDirective(presence, 'no-store');

  if (options.expectCloudflare) {
    let cfStatus = '';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const secondAsset = await get(assetPath);
      cfStatus = String(secondAsset.headers['cf-cache-status'] || '').toUpperCase();
      if (['HIT', 'REVALIDATED', 'STALE', 'UPDATING'].includes(cfStatus)) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!['HIT', 'REVALIDATED', 'STALE', 'UPDATING'].includes(cfStatus)) {
      throw new Error(`${options.label} immutable asset did not hit Cloudflare cache: ${cfStatus || 'header absent'}`);
    }
  }

  console.log(`cache smoke ok: ${options.label} build=${buildId}`);
  return buildId;
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error(`unknown argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${value}`);
    args.set(value.slice(2), next);
    index += 1;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrlValue = args.get('base-url') || process.env.CACHE_SMOKE_BASE_URL;
  if (!baseUrlValue) throw new Error('--base-url is required');
  const baseUrl = new URL(baseUrlValue);
  const expectedBuildId = args.get('expected-build-id') || process.env.EXPECTED_BUILD_ID;

  const publicBuild = await verifyRoute(baseUrl, {
    expectCloudflare: args.get('expect-cloudflare') === 'true',
    expectedBuildId,
    label: 'public DNS route',
  });

  const directAddress = args.get('direct-address') || process.env.DIRECT_SMOKE_ADDRESS;
  if (directAddress) {
    const directBuild = await verifyRoute(baseUrl, {
      directAddress,
      expectedBuildId,
      label: `direct route ${directAddress}`,
    });
    if (directBuild !== publicBuild)
      throw new Error(`DNS routes disagree: public=${publicBuild}, direct=${directBuild}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
