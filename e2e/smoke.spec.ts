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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // 瀏覽器分頁標題
    await expect(page).toHaveTitle(/ZUTOMAYO CARD ONLINE/i);
  });

  test('主視覺 wordmark 可見', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // 主標題包含 ZUTOMAYO / CARD / ONLINE 三行
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('ZUTOMAYO');
    await expect(heading).toContainText('CARD');
    await expect(heading).toContainText('ONLINE');
  });

  test('頻道導覽按鈕存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // 核心頻道編號不可重複；CH.04 由牌組分享功能旗標控制。
    for (const no of ['01', '02', '03', '05', '06', '07', '08']) {
      await expect(page.getByText(`CH.${no}`, { exact: true })).toBeVisible();
      await expect(page.getByText(`CH.${no}`, { exact: true })).toHaveCount(1);
    }
    expect(await page.getByText('CH.04', { exact: true }).count()).toBeLessThanOrEqual(1);
  });

  test('主要導覽元素存在', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // Hero 區的線上對戰與教學按鈕
    await expect(page.getByRole('button', { name: /CH\.01.*線上房間/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /GUIDE.*新手教學/ })).toBeVisible();
  });

  test('頁尾連結使用斜線完整分隔', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    const separators = page.locator('.lobby-home-footer span[aria-hidden="true"]').filter({ hasText: /^\/$/ });
    await expect(separators).toHaveCount(2);
    await expect(page.getByRole('button', { name: '政策與支援', exact: true })).toBeVisible();
  });

  test('能導覽到牌組編輯器頁面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // 點擊 CH.03 牌組編輯器頻道
    await page.getByText('CH.03', { exact: true }).click();

    // 牌組編輯器頁面應該載入（URL 變更）
    await expect(page).toHaveURL(/\/deck-builder/);
  });

  test('能導覽到教學頁面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    // 點擊 Hero 區的教學按鈕
    await page
      .getByRole('button', { name: /新手教學/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/tutorial/);
  });

  test('排行榜頻道開啟實際排行榜頁面', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ZUTOMAYO', { timeout: 30_000 });

    await page.getByText('CH.06', { exact: true }).click();
    await expect(page).toHaveURL(/\/leaderboard/);
    await expect(page.getByText('排行榜', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: '全域排行', exact: true })).toBeVisible();
  });

  test('未登入也能查看政策、條款與聯絡方式', async ({ page }) => {
    for (const route of ['/legal', '/legal/privacy', '/legal/terms', '/legal/contact']) {
      await page.goto(route);
      await expect(page.getByText('ZUTOMAYO CARD ONLINE Community', { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('link', { name: /contact@mail\.zutomayocard\.online/ })).toBeVisible();
    }
  });

  test('政策、條款與聯絡頁面可垂直滾動', async ({ page }) => {
    for (const route of ['/legal/privacy', '/legal/terms', '/legal/contact']) {
      await page.goto(route);
      const shell = page.locator('[data-page-shell="scroll"]');
      await expect(shell).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => shell.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await shell.evaluate((element) => {
        element.scrollTop = 120;
      });
      await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    }
  });

  test('未知路由顯示 404 頁面', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    // 404 頁面的返回大廳按鈕
    await expect(page.getByRole('button', { name: /返回大廳/ })).toBeVisible({ timeout: 30_000 });
  });
});
