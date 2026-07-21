import { test, expect } from '@playwright/test';

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

  test('登入按鈕可在首頁看到', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // compact 模式的登入按鈕（header 區）
    await expect(page.getByRole('button', { name: /^登入$/ })).toBeVisible();
  });

  test('點擊登入開啟認證對話框', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await page.getByRole('button', { name: /^登入$/ }).click();

    // 對話框標題
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('登入 / 註冊')).toBeVisible();
  });

  test('登入表單包含 email 與 password 欄位', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await page.getByRole('button', { name: /^登入$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // email 欄位
    const emailInput = dialog.getByLabel(/電子郵件/);
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('required', '');

    // password 欄位
    const passwordInput = dialog.getByLabel(/密碼/);
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('required', '');
  });

  test('可切換到註冊模式並顯示暱稱欄位', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await page.getByRole('button', { name: /^登入$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 切換到註冊分頁
    await dialog.getByRole('tab', { name: '註冊' }).click();

    // 註冊模式多了暱稱欄位
    const nicknameInput = dialog.getByLabel(/暱稱/);
    await expect(nicknameInput).toBeVisible();
    await expect(nicknameInput).toHaveAttribute('required', '');
  });

  test('空提交表單顯示瀏覽器驗證（不送出 API）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await page.getByRole('button', { name: /^登入$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 攔截 API 呼叫，確認空表單不會觸發
    let apiCalled = false;
    page.on('request', (request) => {
      if (request.url().includes('/api/')) apiCalled = true;
    });

    // 直接點擊提交按鈕（欄位皆為空 + required）
    await dialog.getByRole('button', { name: /^登入$/ }).click();

    // 等待一小段時間確認沒有 API 呼叫
    await page.waitForTimeout(500);
    expect(apiCalled).toBe(false);

    // 對話框仍開啟（未成功提交）
    await expect(dialog).toBeVisible();
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

    await page.getByRole('button', { name: /^登入$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 只填 email，不填 password
    await dialog.getByLabel(/電子郵件/).fill('test@example.com');

    // 嘗試提交
    await dialog.getByRole('button', { name: /^登入$/ }).click();

    // password 欄位應為 invalid（瀏覽器原生驗證）
    const passwordInput = dialog.getByLabel(/密碼/);
    const isValid = await passwordInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);
  });
});
