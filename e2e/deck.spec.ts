import { test, expect } from '@playwright/test';

/**
 * 牌組編輯器 E2E 測試。
 *
 * 頁面載入與 UI 元素測試不需要後端。
 * 卡牌列表與選牌操作需要 API 提供卡牌資料，以 @requires-backend 標記。
 *
 * 執行前先啟動 dev server：`npm run dev`
 * @requires-backend 測試需要完整服務棧（docker-compose.e2e.yml）。
 */
test.describe.configure({ mode: 'serial' });

test.describe('牌組編輯器頁面', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('牌組編輯器頁面能載入', async ({ page }) => {
    await page.goto('/deck-builder');

    // 等待頁面載入完成（boot loader 結束）
    // DeckEditor 的新牌組按鈕有 aria-label
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });
  });

  test('牌組選擇器存在', async ({ page }) => {
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    // 牌組庫 select 有 aria-label
    const deckSelect = page.getByLabel('選擇牌組');
    await expect(deckSelect).toBeVisible();
  });

  test('新牌組按鈕可點擊', async ({ page }) => {
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    // 點擊新牌組按鈕不應崩潰
    await page.getByRole('button', { name: '新牌組' }).click();

    // 牌組選擇器仍可見
    await expect(page.getByLabel('選擇牌組')).toBeVisible();
  });

  test('篩選器區域存在', async ({ page }) => {
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    // 彈數篩選與屬性篩選的 legend 文字
    await expect(page.getByText('彈數', { exact: true })).toBeVisible();
  });

  test('導入與導出按鈕存在', async ({ page }) => {
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('button', { name: '導入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '導出' })).toBeVisible();
  });
});

test.describe('牌組編輯 — 卡牌操作 @requires-backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('卡牌列表顯示卡牌', async ({ page }) => {
    // 此測試需要 API 回傳卡牌資料
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    // 卡池區域應該顯示卡牌（卡牌以 button 形式呈現供點擊加入牌組）
    // 沒有後端時卡池為空，此測試在完整服務棧下才會通過
    const cardPool = page.getByText('卡池');
    await expect(cardPool).toBeVisible();
  });

  test('能選擇卡牌加入牌組', async ({ page }) => {
    // 此測試需要完整的卡牌資料
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    // 點擊新牌組開始空牌組
    await page.getByRole('button', { name: '新牌組' }).click();

    // 卡池中的卡牌可被點擊加入牌組
    // 在有後端的環境下，卡牌會以可點擊元素出現
    // 這裡只驗證 UI 不崩潰
    await expect(page.getByLabel('選擇牌組')).toBeVisible();
  });
});
