import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type TestInfo } from '@playwright/test';
import { registerAuthenticatedOnlineAccount } from './helpers/online';

const TRUST_SURFACE_FLAG = 'E2E_TRUST_SURFACE';
const EVIDENCE_FLAG = 'E2E_TRUST_EVIDENCE';
const AUTH_PASSWORD = process.env.E2E_AUTH_PASSWORD || 'E2e-service-secret-123!';
const CONTACT_EMAIL = 'contact@mail.zutomayocard.online';
const AUTH_RATE_LIMIT_COOLDOWN_MS = 65_000;

function enabled(name: string): boolean {
  return ['1', 'true'].includes((process.env[name] || '').toLowerCase());
}

function requireEvidenceMode(testInfo: TestInfo): void {
  if (enabled(TRUST_SURFACE_FLAG)) return;
  const description = `${TRUST_SURFACE_FLAG}=1 was not supplied`;
  if (enabled(EVIDENCE_FLAG)) throw new Error(description);
  testInfo.annotations.push({ type: 'blocked', description });
  test.skip(true, description);
}

function recordLs10Evidence(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: 'ls10', description });
}

async function csrfToken(context: BrowserContext): Promise<string> {
  let token = (await context.cookies()).find((cookie) => cookie.name === 'zutomayo_csrf')?.value;
  if (!token) {
    await context.request.get('/api/csrf-token');
    token = (await context.cookies()).find((cookie) => cookie.name === 'zutomayo_csrf')?.value;
  }
  return token || '';
}

async function deleteSyntheticAccount(context: BrowserContext): Promise<void> {
  const csrf = await csrfToken(context);
  if (!csrf) return;
  await context.request
    .delete('/api/account', {
      data: { confirmation: 'DELETE', currentPassword: AUTH_PASSWORD },
      headers: { 'X-CSRF-Token': csrf },
    })
    .catch(() => undefined);
}

test.describe('Public trust surface @requires-backend @staging-only', () => {
  test('公開政策、帳號匯出與刪除處理 @ls10-trust', async ({ context, page }, testInfo) => {
    test.setTimeout(180_000);
    requireEvidenceMode(testInfo);

    await page.goto('/legal');
    await expect(page.getByRole('heading', { name: '非官方與非營利聲明' })).toBeVisible();
    await expect(page.getByText('營運名稱：ZUTOMAYO CARD ONLINE Community')).toBeVisible();

    await page.goto('/legal/privacy');
    await expect(page.getByRole('heading', { name: '隱私政策', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '保存期限' })).toBeVisible();
    await expect(page.getByText(/登入後可在個人頁匯出.*刪除帳號/)).toBeVisible();

    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: '服務條款', level: 1 })).toBeVisible();
    await expect(page.getByText(/玩家可使用封鎖、舉報與申訴管道/)).toBeVisible();

    await page.goto('/legal/contact');
    await expect(page.getByRole('heading', { name: '聯絡與下架申請', level: 1 })).toBeVisible();
    await expect(page.locator(`a[href="mailto:${CONTACT_EMAIL}"]`)).toBeVisible();
    await expect(page.getByText('[RIGHTS] 卡牌、圖片、名稱或其他權利人通知')).toBeVisible();
    await expect(page.getByText('[MODERATION] 聊天、舉報、封鎖或制裁申訴')).toBeVisible();
    await expect(page.getByRole('heading', { name: '處理方式' })).toBeVisible();
    recordLs10Evidence(testInfo, 'public-policy-routes');
    recordLs10Evidence(testInfo, 'operator-contact');
    recordLs10Evidence(testInfo, 'retention-deletion-copy');
    recordLs10Evidence(testInfo, 'moderation-appeal-copy');
    recordLs10Evidence(testInfo, 'rightsholder-takedown-copy');

    const account = await registerAuthenticatedOnlineAccount(context, 'E2E Trust Rehearsal');
    let deleted = false;
    try {
      await page.goto('/profile');
      await expect(page.getByText(account.email, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: '隱私政策' })).toBeVisible();
      await expect(page.getByRole('button', { name: '服務條款' })).toBeVisible();
      await expect(page.getByRole('button', { name: '聯絡' })).toBeVisible();
      recordLs10Evidence(testInfo, 'profile-policy-entry');

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '匯出我的資料' }).click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      if (!downloadPath) throw new Error('Account export did not produce a local artifact');
      const exported = JSON.parse(await readFile(downloadPath, 'utf8')) as Record<string, unknown>;
      const serialized = JSON.stringify(exported).toLowerCase();
      expect(serialized).toContain(account.email.toLowerCase());
      expect(serialized).not.toMatch(/password|access[_-]?token|refresh[_-]?token|jwt[_-]?secret/);
      recordLs10Evidence(testInfo, 'account-export');

      await page.getByRole('button', { name: '刪除帳號' }).click();
      const dialog = page.getByRole('dialog', { name: '永久刪除帳號' });
      await dialog.getByLabel('輸入 DELETE').fill('DELETE');
      await dialog.getByLabel('目前密碼').fill(AUTH_PASSWORD);
      await dialog.getByRole('button', { name: '永久刪除' }).click();
      await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });
      deleted = true;
      recordLs10Evidence(testInfo, 'account-deletion');

      const profileResponse = await context.request.get('/api/profile');
      expect(profileResponse.status()).toBe(401);
      recordLs10Evidence(testInfo, 'session-revocation');

      let loginResponse = await context.request.post('/api/login', {
        data: { email: account.email, password: AUTH_PASSWORD },
      });
      if (loginResponse.status() === 429) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_RATE_LIMIT_COOLDOWN_MS));
        loginResponse = await context.request.post('/api/login', {
          data: { email: account.email, password: AUTH_PASSWORD },
        });
      }
      expect([401, 410]).toContain(loginResponse.status());
      recordLs10Evidence(testInfo, 'deleted-account-rejected');
    } finally {
      if (!deleted) await deleteSyntheticAccount(context);
    }
  });
});
