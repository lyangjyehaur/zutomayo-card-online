import { test, expect } from '@playwright/test';

/**
 * 煙霧測試 — 只驗證前端能正確載入，不需要後端服務棧。
 *
 * 執行前先啟動 dev server：`npm run dev`
 * 這些測試僅依賴 Vite dev server（port 3000），API 呼叫會失敗但不影響頁面渲染。
 */
test.describe.configure({ mode: 'serial' });

test.describe('首頁煙霧測試', () => {
  test.beforeEach(async ({ page }) => {
    // 跳過首次造訪的牌組介紹浮層，避免遮擋主要內容。
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('首頁能載入且標題正確', async ({ page }) => {
    await page.goto('/');

    // 等待 AppBootLoader 結束、主內容出現。
    // 頻道列 "Channels" 文字只出現在主大廳頁面。
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // 瀏覽器分頁標題
    await expect(page).toHaveTitle(/ZUTOMAYO CARD ONLINE/i);
  });

  test('主視覺 wordmark 可見', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // 主標題包含 ZUTOMAYO / CARD / ONLINE 三行
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('ZUTOMAYO');
    await expect(heading).toContainText('CARD');
    await expect(heading).toContainText('ONLINE');
  });

  test('頻道導覽按鈕存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // 五個頻道入口（CH.01 ~ CH.05）
    for (const no of ['01', '02', '03', '04', '05']) {
      await expect(page.getByText(`CH.${no}`, { exact: true })).toBeVisible();
    }
  });

  test('主要導覽元素存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Hero 區的線上對戰與教學按鈕
    await expect(page.getByRole('button', { name: '線上房間 →', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新手教學', exact: true })).toBeVisible();
  });

  test('能導覽到牌組編輯器頁面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // 點擊 CH.03 牌組編輯器頻道
    await page.getByText('CH.03', { exact: true }).click();

    // 牌組編輯器頁面應該載入（URL 變更）
    await expect(page).toHaveURL(/\/deck-builder/);
  });

  test('能導覽到教學頁面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    // 點擊 Hero 區的教學按鈕
    await page
      .getByRole('button', { name: /新手教學/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/tutorial/);
  });

  test('未知路由顯示 404 頁面', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    // 404 頁面的返回大廳按鈕
    await expect(page.getByRole('button', { name: /返回大廳/ })).toBeVisible({ timeout: 30_000 });
  });
});
