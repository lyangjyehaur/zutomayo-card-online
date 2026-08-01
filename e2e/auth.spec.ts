import { test, expect, type Locator, type Page } from '@playwright/test';

async function authEntryButton(page: Page): Promise<Locator> {
  const desktopEntry = page.getByRole('button', { name: /^登入$/ }).first();
  if (await desktopEntry.isVisible()) return desktopEntry;

  await page.getByRole('button', { name: '主選單' }).click();
  const mobileEntry = page.getByRole('button', { name: '登入 / 註冊', exact: true });
  await expect(mobileEntry).toBeVisible();
  return mobileEntry;
}

async function openAuthForm(page: Page): Promise<Locator> {
  await (await authEntryButton(page)).click();
  const form = page.locator('form[aria-label="登入表單"]');
  await expect(form).toBeVisible();
  return form;
}

/**
 * 認證流程 E2E 測試。
 *
 * 純前端表單測試不需要後端（標記為無 tag）。
 * 實際登入/註冊流程需要 API 服務，以 @requires-backend 標記。
 *
 * 執行前先啟動 dev server：`npm run dev`
 * @requires-backend 測試需要完整服務棧（docker-compose.e2e.yml）。
 */
test.describe.configure({ mode: 'serial' });

test.describe('認證 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('首頁提供符合 viewport 的登入入口', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await expect(await authEntryButton(page)).toBeVisible();
  });

  test('點擊登入開啟認證介面 @core', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const form = await openAuthForm(page);
    await expect(form.getByRole('tab', { name: '登入' })).toBeVisible();
    await expect(form.getByRole('tab', { name: '註冊' })).toBeVisible();
  });

  test('登入表單包含 email 與 password 欄位', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const form = await openAuthForm(page);

    // email 欄位
    const emailInput = form.getByLabel(/電子郵件/);
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('required', '');

    // password 欄位
    const passwordInput = form.getByLabel(/密碼/);
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('required', '');
  });

  test('可切換到註冊模式並顯示暱稱欄位', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const form = await openAuthForm(page);

    // 切換到註冊分頁
    await form.getByRole('tab', { name: '註冊' }).click();

    // 註冊模式多了暱稱欄位
    const registerForm = page.locator('form[aria-label="註冊表單"]');
    await expect(registerForm).toBeVisible();
    const nicknameInput = registerForm.getByLabel(/暱稱/);
    await expect(nicknameInput).toBeVisible();
    await expect(nicknameInput).toHaveAttribute('required', '');
  });

  test('空提交表單顯示瀏覽器驗證（不送出 API）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const form = await openAuthForm(page);

    // 攔截 API 呼叫，確認空表單不會觸發
    let apiCalled = false;
    page.on('request', (request) => {
      if (request.url().includes('/api/')) apiCalled = true;
    });

    // 直接點擊提交按鈕（欄位皆為空 + required）
    await form.getByRole('button', { name: /^登入$/ }).click();

    // 等待一小段時間確認沒有 API 呼叫
    await page.waitForTimeout(500);
    expect(apiCalled).toBe(false);

    await expect(form).toBeVisible();
  });
});

test.describe('認證流程 @requires-backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('空密碼提交時 email 欄位標記為 invalid', async ({ page }) => {
    // 這個測試驗證 HTML5 表單驗證：填了 email 但沒填 password，
    // 提交時 password 欄位應該是 :invalid 狀態。
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const form = await openAuthForm(page);

    // 只填 email，不填 password
    await form.getByLabel(/電子郵件/).fill('test@example.com');

    // 嘗試提交
    await form.getByRole('button', { name: /^登入$/ }).click();

    // password 欄位應為 invalid（瀏覽器原生驗證）
    const passwordInput = form.getByLabel(/密碼/);
    const isValid = await passwordInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);
  });
});
