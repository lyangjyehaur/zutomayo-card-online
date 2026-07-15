import { test, expect } from '@playwright/test';

/**
 * 教學模式 E2E 測試。
 *
 * 頁面載入測試不需要後端（卡牌未載入時會顯示錯誤狀態）。
 * 教學覆蓋層與互動需要卡牌資料，以 @requires-backend 標記。
 *
 * 執行前先啟動 dev server：`npm run dev`
 * @requires-backend 測試需要完整服務棧（docker-compose.e2e.yml）。
 */
test.describe.configure({ mode: 'serial' });

async function simulateCardApiOutage(page: import('@playwright/test').Page) {
  await page.route('**/api/cards', (route) => route.abort());
  await page.route('**/cards.json', (route) => route.abort());
}

test.describe('教學頁面載入', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('教學頁面能載入', async ({ page }) => {
    await page.goto('/tutorial');

    // 完整服務棧會進入遊戲，無後端時則停在 loading/error 狀態。
    const readyState = page
      .locator('[data-game-step]')
      .first()
      .or(page.getByText(/卡牌資料載入失敗|載入對戰中/));
    await expect(readyState).toBeVisible({ timeout: 30_000 });
  });

  test('無後端時顯示卡牌載入失敗訊息', async ({ page }) => {
    // 沒有後端 API 時，卡牌無法載入，應顯示錯誤狀態與重試按鈕
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');

    // 等待卡牌載入失敗（可能需要等 boot timeout）
    await expect(page.getByText('卡牌資料載入失敗')).toBeVisible({ timeout: 30_000 });

    // 重試按鈕應存在
    await expect(page.getByRole('button', { name: /重試/ })).toBeVisible();
  });

  test('重試按鈕可點擊', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await expect(page.getByText('卡牌資料載入失敗')).toBeVisible({ timeout: 30_000 });

    // 點擊重試按鈕不應崩潰
    await page.getByRole('button', { name: /重試/ }).click();

    // 重試後會重新進入 loading 狀態
    await expect(page.getByText(/卡牌資料載入失敗|載入對戰中/)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('教學覆蓋層與互動 @requires-backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('教學覆蓋層顯示', async ({ page }) => {
    // 此測試需要卡牌資料載入成功
    await page.goto('/tutorial');

    // 卡牌載入成功後，教學覆蓋層（dialog）應該出現
    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });
  });

  test('能點擊下一步推進教學', async ({ page }) => {
    await page.goto('/tutorial');

    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });

    // 教學 tooltip 中的 "下一頁" 按鈕
    // 並非所有步驟都有下一步按鈕（action step 顯示 "繼續" 提示），
    // 但第一步通常是導覽，會有下一頁按鈕。
    const nextButton = page.getByRole('button', { name: '下一頁' });
    if (await nextButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nextButton.click();
      // 點擊後教學仍在進行中（覆蓋層仍在）
      await expect(overlay).toBeVisible();
    }
  });

  test('能關閉教學並返回首頁', async ({ page }) => {
    await page.goto('/tutorial');

    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });

    // 點擊 "關閉" 按鈕（tutorial-tooltip-close）
    const closeButton = page.locator('.tutorial-tooltip-close').first();
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // 應彈出跳過確認對話框
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();

    // 點擊確認跳過
    await confirmDialog.getByRole('button', { name: '確認' }).click();

    // 應返回首頁
    await expect(page).toHaveURL(/\/$/);
  });
});
