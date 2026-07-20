import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openOnlineSeat, provisionOnlineMatch } from './helpers/online';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

async function expectNoBlockingAxeViolations(page: Page, surface: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const details = blocking
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(' ')).join(', ');
      return `${violation.id}: ${violation.help} (${targets})`;
    })
    .join('\n');
  expect(blocking, `${surface} has blocking axe violations:\n${details}`).toEqual([]);
}

test.describe('核心頁面無障礙 @a11y', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    await page.route('**/api/official/**', async (route) => {
      const url = new URL(route.request().url());
      const qa = {
        id: 'qa_1',
        number: 1,
        publishedAt: '2026-02-17',
        tags: ['基本ルール'],
        relatedCardIds: [],
        source: { question: '質問', answer: '回答' },
        localized: { question: '問題', answer: '答案' },
        requestedLocale: 'zh-TW',
        effectiveLocale: 'zh-TW',
        translationStatus: 'verified',
        sourceUrl: 'https://zutomayocard.net/qa/',
        lastSyncedAt: '2026-07-20T00:00:00.000Z',
        contentVersion: 1,
      };
      const errata = {
        errataId: '001',
        cardId: '1st_6',
        cardName: '測試卡牌',
        cardNameJa: 'カード',
        pack: 'THE WORLD IS CHANGING',
        rarity: 'UR',
        cardNumber: '006/104',
        publishedAt: '2026-02-17',
        affectsName: false,
        affectsEffect: true,
        source: {
          incorrectText: '誤り',
          correctedText: '修正',
          reason: '理由',
          replacementPolicy: '交換',
          usagePolicy: '使用',
        },
        localized: {
          incorrectText: '錯誤',
          correctedText: '修正',
          reason: '原因',
          replacementPolicy: '交換政策',
          usagePolicy: '使用方式',
        },
        requestedLocale: 'zh-TW',
        effectiveLocale: 'zh-TW',
        translationStatus: 'machine',
        sourceUrl: 'https://zutomayocard.net/errata/001/',
        lastSyncedAt: '2026-07-20T00:00:00.000Z',
        contentVersion: 1,
      };
      const body = url.pathname.endsWith('/qa/1')
        ? { item: qa }
        : url.pathname.endsWith('/qa')
          ? { items: [qa], total: 1 }
          : url.pathname.endsWith('/errata/001')
            ? { item: errata }
            : { items: [errata], total: 1 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  });

  for (const route of [
    '/',
    '/online',
    '/deck-builder',
    '/feedback',
    '/profile',
    '/tutorial',
    '/legal',
    '/legal/privacy',
    '/legal/terms',
    '/legal/contact',
    '/rules/qa',
    '/rules/qa/1',
    '/rules/errata',
    '/rules/errata/001',
  ]) {
    test(`沒有 serious/critical axe violations: ${route}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expectNoBlockingAxeViolations(page, route);
    });
  }
});

test.describe('登入 dialog 無障礙 @a11y', () => {
  test('登入 dialog 通過 axe 並維持焦點循環與背景 inert', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    // 讓純前端 E2E 不依賴 OAuth provider 的環境設定，仍保留 local auth 表單。
    await page.route('**/api/oauth/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authMode: 'local', localAuthEnabled: true, providers: [] }),
      });
    });
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });

    const trigger = page.getByRole('button', { name: /^登入$/ }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectNoBlockingAxeViolations(page, '登入 dialog');

    const root = page.locator('#root');
    await expect(root).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => root.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

    const focusable = dialog.locator(FOCUSABLE_SELECTOR);
    const focusableCount = await focusable.count();
    expect(focusableCount).toBeGreaterThan(2);
    const first = focusable.first();
    const last = focusable.last();
    await expect(first).toBeFocused();

    // Shift+Tab/Tab 均不能離開 dialog，驗證共用 modal focus trap。
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(root).not.toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => root.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  });
});

test.describe('實戰教學覆蓋層無障礙 @a11y @requires-backend', () => {
  test('手機操作步驟通過 axe，焦點只在提示卡與允許的目標間移動', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tutorial');
    await page.getByTestId('tutorial-chapter-tab-preparation').click();
    await page.getByRole('button', { name: '開始戰鬥準備', exact: true }).click();

    const overlay = page.locator('.tutorial-game-overlay');
    await expect(overlay).toHaveAttribute('data-tutorial-phase', 'janken', { timeout: 30_000 });
    await expect(overlay.getByTestId('tutorial-fixed-instruction')).toBeVisible();
    await expectNoBlockingAxeViolations(page, 'Tutorial janken overlay');

    const tooltip = page.locator('.tutorial-tooltip');
    await expect(tooltip).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '關閉', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(tooltip).toBeFocused();
  });
});

test.describe('線上 Battle/Result 無障礙 @a11y @requires-backend', () => {
  test('正式 Battle 與結算 Result 通過 axe，且 Battle drawer 維持焦點隔離', async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    const guestContext = await browser.newContext({ baseURL });
    const guestPage = await guestContext.newPage();

    try {
      const match = await provisionOnlineMatch(request);
      await Promise.all([openOnlineSeat(page, match, '0'), openOnlineSeat(guestPage, match, '1')]);
      await expect(page.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });
      await expect(guestPage.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });

      await page.locator('[data-tut="janken-rock"]').click();
      await guestPage.locator('[data-tut="janken-scissors"]').click();
      await expect(page.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 });
      await expect(guestPage.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 });

      await Promise.all([
        page.getByRole('button', { name: '保留手牌' }).click(),
        guestPage.getByRole('button', { name: '保留手牌' }).click(),
      ]);
      await expect(page.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 });
      await expect(guestPage.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 });

      await Promise.all([
        page.locator('[data-zone="hand"] [data-tut-card^="e2e_"]').first().click(),
        guestPage.locator('[data-zone="hand"] [data-tut-card^="e2e_"]').first().click(),
      ]);
      await Promise.all([
        page.getByRole('button', { name: /打出檢視中的牌/ }).click(),
        guestPage.getByRole('button', { name: /打出檢視中的牌/ }).click(),
      ]);
      await Promise.all([
        page.getByRole('button', { name: /確認出牌/ }).click(),
        guestPage.getByRole('button', { name: /確認出牌/ }).click(),
      ]);
      await expect(page.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 });
      await expect(guestPage.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 });

      await expectNoBlockingAxeViolations(page, 'Battle turnSet');

      const pause = page.getByRole('button', { name: '暫停' }).first();
      await pause.click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      // Axe should measure the settled drawer, not colors composited mid-fade.
      await expect(page.locator('.app-drawer-overlay')).toHaveCSS('opacity', '1');
      await expect(drawer).toHaveCSS('opacity', '1');
      await expectNoBlockingAxeViolations(page, 'Battle pause drawer');

      const board = page.locator('[data-board-layout="responsive"]');
      await expect(board).toHaveAttribute('aria-hidden', 'true');
      await expect.poll(() => board.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

      const drawerFocusable = drawer.locator(FOCUSABLE_SELECTOR);
      const drawerFirst = drawerFocusable.first();
      const drawerLast = drawerFocusable.last();
      await expect(drawerFirst).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(drawerLast).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(drawerFirst).toBeFocused();

      await drawer.getByRole('button', { name: '取消' }).click();
      await expect(drawer).toBeHidden();
      await expect(pause).toBeFocused();
      await expect.poll(() => board.evaluate((element) => (element as HTMLElement).inert)).toBe(false);

      await pause.click();
      await page.getByRole('dialog').getByRole('button', { name: '投降' }).click();
      await expect(page.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 15_000 });
      await expectNoBlockingAxeViolations(page, 'Result defeat');
    } finally {
      await guestContext.close();
    }
  });
});

test('PWA manifest declares standalone install metadata @pwa', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = (await response.json()) as { display?: string; start_url?: string; icons?: unknown[] };
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBeTruthy();
  expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);
});
