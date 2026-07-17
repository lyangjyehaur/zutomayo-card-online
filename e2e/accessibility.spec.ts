import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  openOnlineSeat,
  provisionAuthenticatedOnlineMatch,
  registerAuthenticatedOnlineAccount,
} from './helpers/online';

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

async function createAnonymousFeedbackPost(page: Page, title: string): Promise<void> {
  const anonymousId = `e2e_a11y_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await page.addInitScript((id) => {
    localStorage.setItem('zutomayo_feedback_anon_id', id);
    localStorage.setItem('zutomayo_locale', 'zh-TW');
  }, anonymousId);

  const csrfResponse = await page.request.get('/api/csrf-token');
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfBody = (await csrfResponse.json()) as { token?: unknown };
  expect(typeof csrfBody.token).toBe('string');
  const csrfToken = String(csrfBody.token);

  const response = await page.request.post('/api/feedback/posts', {
    data: {
      title,
      description: '用於驗證詳情 dialog 的鍵盤操作與無障礙語意。',
      anonymousId,
    },
    headers: {
      Cookie: `zutomayo_csrf=${encodeURIComponent(csrfToken)}`,
      'X-CSRF-Token': csrfToken,
    },
  });
  expect(response.ok(), `建立 feedback 測試資料失敗：${response.status()} ${await response.text()}`).toBeTruthy();
}

test.describe('核心頁面無障礙 @a11y', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  for (const route of ['/', '/online', '/deck-builder', '/feedback', '/profile', '/leaderboard']) {
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

test.describe('Feedback 詳情 dialog 無障礙 @a11y @requires-backend', () => {
  test('通過 axe 並維持焦點循環、背景 inert 與 trigger focus restore', async ({ page }) => {
    const title = `E2E Feedback dialog ${Date.now().toString(36)}`;
    await createAnonymousFeedbackPost(page, title);
    await page.goto('/feedback');

    const trigger = page.getByRole('button', { name: `查看詳情: ${title}` });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expectNoBlockingAxeViolations(page, 'Feedback 詳情 dialog');

    const root = page.locator('#root');
    await expect(root).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => root.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

    const focusable = dialog.locator(FOCUSABLE_SELECTOR);
    expect(await focusable.count()).toBeGreaterThan(2);
    const first = focusable.first();
    const last = focusable.last();
    await expect(first).toHaveAccessibleName('關閉');
    await expect(first).toBeFocused();

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

test.describe('線上 Battle/Result 無障礙 @a11y @requires-backend', () => {
  test('正式 Battle 與結算 Result 通過 axe，且 Battle drawer 維持焦點隔離', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    const guestContext = await browser.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    const syncWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('[online-sync] detected')) syncWarnings.push(message.text());
    });

    try {
      const [hostAccount, guestAccount] = await Promise.all([
        registerAuthenticatedOnlineAccount(page.context(), 'E2E A11y Host'),
        registerAuthenticatedOnlineAccount(guestContext, 'E2E A11y Guest'),
      ]);
      const match = await provisionAuthenticatedOnlineMatch(page.context(), hostAccount, guestContext, guestAccount);
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
        page.locator('[data-zone="hand"] button').first().click(),
        guestPage.locator('[data-zone="hand"] button').first().click(),
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

      const matchSubmissionResponses = Promise.all([
        page.waitForResponse(
          (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/matches',
          { timeout: 30_000 },
        ),
        guestPage.waitForResponse(
          (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/matches',
          { timeout: 30_000 },
        ),
      ]);
      await pause.click();
      await page.getByRole('dialog').getByRole('button', { name: '投降' }).click();
      await Promise.all([
        expect(page.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.locator('[data-result-outcome="victory"]')).toBeVisible({ timeout: 20_000 }),
      ]);
      const responses = await matchSubmissionResponses;
      expect(
        responses.map((response) => response.status()),
        'Both authenticated result submissions should satisfy the integer/durable source-match contract',
      ).toEqual([200, 200]);
      expect(syncWarnings).toEqual([]);
      await expectNoBlockingAxeViolations(page, 'Result defeat');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 20_000 });
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
