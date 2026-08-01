import type { Page } from '@playwright/test';

interface AppVersionInfo {
  appVersion: string;
  buildId: string;
  rulesVersion: string;
}

function isAppVersionInfo(value: unknown): value is AppVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppVersionInfo>;
  return Boolean(candidate.appVersion && candidate.buildId && candidate.rulesVersion);
}

export async function cardDataHeaders(page: Page, cardCount: number): Promise<Record<string, string>> {
  const response = await page.request.get('/api/app-version');
  if (!response.ok()) throw new Error(`Unable to read app version: HTTP ${response.status()}`);

  const body = (await response.json()) as unknown;
  const version = isAppVersionInfo(body)
    ? body
    : body && typeof body === 'object' && 'version' in body && isAppVersionInfo(body.version)
      ? body.version
      : null;
  if (!version) throw new Error('The app version response does not contain a valid version contract');

  const releaseSha = /^[a-f0-9]{40}$/.test(version.buildId) ? version.buildId : 'b'.repeat(40);
  return {
    'Content-Type': 'application/json',
    'X-Card-Dataset-Sha256': 'a'.repeat(64),
    'X-Card-Dataset-Release-Sha': releaseSha,
    'X-Card-Dataset-Count': String(cardCount),
    'X-Card-Data-App-Version': version.appVersion,
    'X-Card-Data-Build-Id': version.buildId,
    'X-Card-Data-Rules-Version': version.rulesVersion,
  };
}
