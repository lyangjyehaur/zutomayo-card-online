import { expect, test, type Page } from '@playwright/test';

async function prepareGuest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    localStorage.setItem('zutomayo_locale', 'zh-TW');
    localStorage.removeItem('zutomayo_token');
    localStorage.removeItem('zutomayo_session');
    localStorage.removeItem('zutomayo_match_records');
    sessionStorage.setItem('zutomayo_anonymous_name_prompt_seen', 'true');
    sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
  });
  await page.route('**/api/oauth/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authMode: 'local', localAuthEnabled: true, providers: [] }),
    }),
  );
}

async function topOf(locator: import('@playwright/test').Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.y;
}

async function textContrastRatio(locator: import('@playwright/test').Locator): Promise<number> {
  return locator.evaluate((element) => {
    const parseColor = (value: string): [number, number, number] => {
      const components = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      if (value.startsWith('color(srgb') && components.length >= 3) {
        return [components[0] * 255, components[1] * 255, components[2] * 255];
      }
      if (value.startsWith('rgb') && components.length >= 3) {
        return [components[0], components[1], components[2]];
      }
      throw new Error(`Unsupported computed color: ${value}`);
    };
    const luminance = (rgb: [number, number, number]) => {
      const [red, green, blue] = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parseColor(style.color));
    const background = luminance(parseColor(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

test.describe('首次造訪流程回歸', () => {
  test.beforeEach(async ({ page }) => {
    await prepareGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('線上大廳先選牌組，選擇後帶到快速配對', async ({ page }) => {
    await page.goto('/online');
    const deckPanel = page.locator('[data-room-panel="deck"]');
    const quickPanel = page.locator('[data-room-panel="quick"]');
    const customPanel = page.locator('[data-room-panel="custom"]').first();
    await expect(deckPanel).toBeVisible({ timeout: 30_000 });
    expect(await topOf(deckPanel)).toBeLessThan(await topOf(quickPanel));
    expect(await topOf(quickPanel)).toBeLessThan(await topOf(customPanel));

    await deckPanel.getByRole('button', { name: /隨機牌組/ }).click();
    await expect
      .poll(() => quickPanel.evaluate((element) => Math.abs(element.getBoundingClientRect().top)))
      .toBeLessThanOrEqual(110);
  });

  test('AI 大廳依序把下一個決策帶入視窗', async ({ page }) => {
    await page.goto('/ai');
    const steps = page.locator('main section[aria-label^="0"]');
    await expect(steps).toHaveCount(3, { timeout: 30_000 });

    await steps
      .nth(0)
      .getByRole('button', { name: /隨機牌組/ })
      .click();
    await expect.poll(() => steps.nth(1).evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(500);

    await steps
      .nth(1)
      .getByRole('button', { name: /克制牌組/ })
      .click();
    await expect.poll(() => steps.nth(2).evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(500);
    await expect(steps.nth(2).getByRole('button', { name: /簡單/ })).toBeVisible();
  });

  test('空白對戰紀錄只顯示必要資訊', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByText('尚無對戰紀錄', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '清除紀錄', exact: true })).toHaveCount(0);
    await expect(page.getByText(/1\/1/)).toHaveCount(0);

    const statCards = page.locator('main').getByText(/^(總場次|玩家一勝|玩家二勝|平均回合)$/);
    await expect(statCards).toHaveCount(4);
    const first = await statCards.nth(0).boundingBox();
    const second = await statCards.nth(1).boundingBox();
    const third = await statCards.nth(2).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(2);
    expect(third!.y).toBeGreaterThan(first!.y + 20);
  });

  for (const route of ['/community', '/profile']) {
    test(`${route} 未登入狀態提供直接登入入口`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: /登入後進入社群|需要先登入/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('button', { name: '登入 / 註冊', exact: true }).last()).toBeVisible();
    });
  }
});

test.describe('對戰操作辨識度回歸', () => {
  test('晝側選牌後的出牌與檢視按鈕符合文字對比標準', async ({ page }) => {
    await prepareGuest(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 740 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/qa/battle?state=initial-select&side=day&time=day&controls=0');
      await page.locator('[data-zone="hand"] .cardview[data-state="playable"]').first().click();

      const dock = page.locator('.actiondock');
      const setButton = page.getByRole('button', { name: '打出檢視中的牌', exact: true });
      const detailButton = page.getByRole('button', { name: '檢視手牌', exact: true });
      await expect(setButton).toBeVisible();
      await expect(detailButton).toBeVisible();
      expect(await textContrastRatio(setButton)).toBeGreaterThanOrEqual(4.5);
      expect(await textContrastRatio(detailButton)).toBeGreaterThanOrEqual(4.5);
      expect(await dock.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

      for (const button of [setButton, detailButton]) {
        const size = await button.boundingBox();
        expect(size).not.toBeNull();
        expect(size!.height).toBeGreaterThanOrEqual(44);
        expect(
          await button.evaluate(
            (element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
          ),
        ).toBe(true);
      }
    }
  });
});
