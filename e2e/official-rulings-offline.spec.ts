import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_PWA_OFFLINE !== '1', 'Requires the production PWA preview harness');

test('production PWA 可在官方規則 API 中斷後使用已暖機的快取', async ({ page, request }) => {
  await request.post('/__test/reset');
  await page.addInitScript(() => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    localStorage.setItem('zutomayo_locale', 'zh-TW');
  });

  await page.goto('/rules/qa');
  await expect(page.getByRole('heading', { name: '官方規則 Q&A' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('離線快取測試問題')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // The first reload puts the page under the newly installed service worker and warms runtimeCaching.
  await page.reload();
  await expect(page.getByText('離線快取測試問題')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await request.post('/__test/offline');
  await page.reload();

  await expect(page.getByRole('heading', { name: '官方規則 Q&A' })).toBeVisible();
  await expect(page.getByText('離線快取測試問題')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
