import { expect, test } from '@playwright/test';

const catalogCard = {
  id: '4th_106',
  name: '海膽栗子',
  pack: 'Fantasy Is Reality',
  song: '海膽栗子',
  illustrator: '測試繪師',
  rarity: 'R',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 10 },
  powerCost: 1,
  sendToPower: 1,
  effect: '測試效果',
  image: '',
};
const catalogCards = Array.from({ length: 120 }, (_, index) => ({
  ...catalogCard,
  id: `4th_${String(index + 1).padStart(3, '0')}`,
}));

test.describe('卡牌圖鑑搜尋', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    await page.route('**/api/catalog/cards', (route) => route.fulfill({ json: catalogCards }));
    await page.route('**/api/cards/texts', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/config', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/search/ids?*', (route) =>
      route.fulfill({
        json: {
          ids: catalogCards.map((card) => card.id),
          estimatedTotalHits: catalogCards.length,
          engine: 'meilisearch',
        },
      }),
    );
  });

  test('防抖後才同步 URL 並重設分頁 @core', async ({ page }) => {
    await page.goto('/cards?page=3&rarity=R');

    const search = page.getByRole('searchbox');
    await search.fill('海膽');

    await expect(page).toHaveURL(/page=3/);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/q=%E6%B5%B7%E8%86%BD/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page).toHaveURL(/rarity=R/);
  });

  test('輸入法組字期間不觸發搜尋 @core', async ({ page }) => {
    await page.goto('/cards');

    const search = page.getByRole('searchbox');
    await search.dispatchEvent('compositionstart');
    await search.pressSequentially('海膽');
    await page.waitForTimeout(300);
    await expect(page).not.toHaveURL(/q=/);

    await search.dispatchEvent('compositionend');
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/q=%E6%B5%B7%E8%86%BD/);
  });
});
