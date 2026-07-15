import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  establishAuthenticatedFriendship,
  getAuthenticatedMatchHistory,
  openAuthenticatedOnlineLobby,
  registerAuthenticatedOnlineAccount,
} from './helpers/online';

/**
 * These tests require the API and Colyseus endpoint to receive the same
 * HttpOnly account session. The stock Docker E2E overlay serves the app from
 * `game` but builds the platform URL as `platform`, so its host-only Lax cookie
 * cannot authenticate cross-host matchmaking. A staging/reverse-proxy run
 * must opt in explicitly and describe the endpoint topology below.
 */
const AUTHENTICATED_MULTIPLAYER_FLAG = 'E2E_AUTHENTICATED_MULTIPLAYER';
const RANKED_HISTORY_FLAG = 'E2E_RANKED_MATCHES_ENABLED';

function enabled(name: string): boolean {
  return ['1', 'true'].includes((process.env[name] || '').toLowerCase());
}

function authenticatedMultiplayerBlockers(baseURL: string, requireRankedHistory: boolean): string[] {
  const blockers: string[] = [];
  if (!enabled(AUTHENTICATED_MULTIPLAYER_FLAG)) {
    blockers.push(`${AUTHENTICATED_MULTIPLAYER_FLAG}=1 was not supplied`);
  }

  const platformURL = process.env.E2E_PLATFORM_URL;
  if (!platformURL) {
    blockers.push('E2E_PLATFORM_URL was not supplied, so the browser/platform cookie topology is unproven');
  } else {
    try {
      const appHost = new URL(baseURL).hostname;
      const platformHost = new URL(platformURL.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')).hostname;
      if (appHost !== platformHost && !enabled('E2E_PLATFORM_COOKIE_SHARED')) {
        blockers.push(
          `app host ${appHost} and platform host ${platformHost} differ without E2E_PLATFORM_COOKIE_SHARED=1`,
        );
      }
    } catch {
      blockers.push(`E2E_PLATFORM_URL is invalid: ${platformURL}`);
    }
  }

  if (requireRankedHistory && !enabled(RANKED_HISTORY_FLAG)) {
    blockers.push(`${RANKED_HISTORY_FLAG}=1 was not supplied; ranked result delivery and server history are disabled`);
  }
  return blockers;
}

function skipWhenBlocked(testInfo: TestInfo, baseURL: string, requireRankedHistory: boolean): void {
  const blockers = authenticatedMultiplayerBlockers(baseURL, requireRankedHistory);
  if (blockers.length === 0) return;
  const description = `Authenticated multiplayer blocked: ${blockers.join('; ')}`;
  testInfo.annotations.push({ type: 'blocked', description });
  test.skip(true, description);
}

async function expectAuthenticatedLobby(page: Page, nickname: string): Promise<void> {
  await expect(page.getByText(`${nickname} · ELO`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '開始匹配' })).toBeEnabled({ timeout: 30_000 });
}

async function expectSharedOnlineMatch(first: Page, second: Page): Promise<string> {
  await Promise.all([
    first.waitForURL(/\/play\/online\/[^/?#]+/, { timeout: 45_000 }),
    second.waitForURL(/\/play\/online\/[^/?#]+/, { timeout: 45_000 }),
  ]);
  const firstMatchID = decodeURIComponent(new URL(first.url()).pathname.split('/').pop() || '');
  const secondMatchID = decodeURIComponent(new URL(second.url()).pathname.split('/').pop() || '');
  expect(firstMatchID).not.toBe('');
  expect(secondMatchID).toBe(firstMatchID);
  await Promise.all([
    expect(first.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 }),
    expect(second.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 }),
  ]);
  return firstMatchID;
}

async function completeSetupAndSurrender(loser: Page, winner: Page): Promise<void> {
  await loser.locator('[data-tut="janken-rock"]').click();
  await winner.locator('[data-tut="janken-scissors"]').click();
  await Promise.all([
    expect(loser.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 }),
    expect(winner.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 }),
  ]);
  await Promise.all([
    loser.getByRole('button', { name: '保留手牌' }).click(),
    winner.getByRole('button', { name: '保留手牌' }).click(),
  ]);
  await Promise.all([
    expect(loser.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 }),
    expect(winner.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 }),
  ]);
  await Promise.all([
    loser.locator('[data-zone="hand"] button').first().click(),
    winner.locator('[data-zone="hand"] button').first().click(),
  ]);
  await Promise.all([
    loser.getByRole('button', { name: /打出檢視中的牌/ }).click(),
    winner.getByRole('button', { name: /打出檢視中的牌/ }).click(),
  ]);
  await Promise.all([
    loser.getByRole('button', { name: /確認出牌/ }).click(),
    winner.getByRole('button', { name: /確認出牌/ }).click(),
  ]);
  await Promise.all([
    expect(loser.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
    expect(winner.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
  ]);

  await loser.getByRole('button', { name: '暫停' }).first().click();
  const surrenderDialog = loser.getByRole('dialog');
  await expect(surrenderDialog).toBeVisible();
  await surrenderDialog.getByRole('button', { name: '投降' }).click();
  await Promise.all([
    expect(loser.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 15_000 }),
    expect(winner.locator('[data-result-outcome="victory"]')).toBeVisible({ timeout: 15_000 }),
  ]);
}

async function closeGuestContext(context: BrowserContext, failed: boolean): Promise<void> {
  const pages = context.pages();
  const videos = pages.map((page) => page.video()).filter((video) => video !== null);
  await context.close();
  if (!failed) await Promise.all(videos.map((video) => video.delete()));
}

test.describe.configure({ mode: 'serial' });

test.describe('Authenticated 雙瀏覽器線上流程 @requires-backend', () => {
  test('Quick Match、聊天、重連、完整結算與雙方 server history', async ({ browser, context, page }, testInfo) => {
    test.setTimeout(150_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    skipWhenBlocked(testInfo, baseURL, true);

    const guestContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('guest-video') },
    });
    let failed = false;
    try {
      const [hostAccount, guestAccount] = await Promise.all([
        registerAuthenticatedOnlineAccount(context, 'E2E Ranked Host'),
        registerAuthenticatedOnlineAccount(guestContext, 'E2E Ranked Guest'),
      ]);
      const guestPage = await guestContext.newPage();
      await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
      await Promise.all([
        expectAuthenticatedLobby(page, hostAccount.nickname),
        expectAuthenticatedLobby(guestPage, guestAccount.nickname),
      ]);

      await Promise.all([
        page.getByRole('button', { name: '開始匹配' }).click(),
        guestPage.getByRole('button', { name: '開始匹配' }).click(),
      ]);
      const matchID = await expectSharedOnlineMatch(page, guestPage);

      await Promise.all([
        page.getByRole('button', { name: '顯示對戰聊天' }).click(),
        guestPage.getByRole('button', { name: '顯示對戰聊天' }).click(),
      ]);
      const chatMessage = `authenticated-chat-${Date.now()}`;
      const chatInput = page.getByRole('textbox', { name: '對戰聊天訊息' });
      await expect(chatInput).toBeEnabled({ timeout: 20_000 });
      await chatInput.fill(chatMessage);
      await page.getByRole('button', { name: '發送對戰聊天訊息' }).click();
      await expect(guestPage.locator('.online-chat-bubble', { hasText: chatMessage })).toBeVisible({ timeout: 20_000 });

      await context.setOffline(true);
      await expect(page.locator('[data-online-connection-status="disconnected"]')).toBeVisible({ timeout: 15_000 });
      await context.setOffline(false);
      await expect(page.locator('[data-online-connection-status="rejoined"]')).toBeVisible({ timeout: 25_000 });

      await completeSetupAndSurrender(page, guestPage);

      await expect
        .poll(
          async () => {
            const [hostHistory, guestHistory] = await Promise.all([
              getAuthenticatedMatchHistory(context),
              getAuthenticatedMatchHistory(guestContext),
            ]);
            return {
              host: hostHistory.find((entry) => entry.sourceMatchId === matchID),
              guest: guestHistory.find((entry) => entry.sourceMatchId === matchID),
            };
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toEqual({
          host: expect.objectContaining({ winnerId: guestAccount.id, loserId: hostAccount.id }),
          guest: expect.objectContaining({ winnerId: guestAccount.id, loserId: hostAccount.id }),
        });

      await Promise.all([page.goto('/history'), guestPage.goto('/history')]);
      await Promise.all([
        expect(page.getByRole('article').filter({ hasText: '敗北' }).first()).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.getByRole('article').filter({ hasText: '勝利' }).first()).toBeVisible({ timeout: 20_000 }),
      ]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await context.setOffline(false).catch(() => undefined);
      await closeGuestContext(guestContext, failed);
    }
  });

  test('好友邀請由兩個已登入帳號接力到同一個 boardgame 對局', async ({ browser, context, page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    skipWhenBlocked(testInfo, baseURL, false);

    const guestContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('guest-video') },
    });
    let failed = false;
    try {
      const [inviter, recipient] = await Promise.all([
        registerAuthenticatedOnlineAccount(context, 'E2E Invite Host'),
        registerAuthenticatedOnlineAccount(guestContext, 'E2E Invite Guest'),
      ]);
      await establishAuthenticatedFriendship(context, inviter, guestContext, recipient);

      const guestPage = await guestContext.newPage();
      await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
      await Promise.all([
        expectAuthenticatedLobby(page, inviter.nickname),
        expectAuthenticatedLobby(guestPage, recipient.nickname),
      ]);

      const sendInvite = page.locator(`[data-friend-invite-action="send"][data-friend-user-id="${recipient.id}"]`);
      const acceptInvite = guestPage.locator(
        `[data-friend-invite-action="accept"][data-friend-user-id="${inviter.id}"]`,
      );
      await expect(sendInvite).toBeVisible({ timeout: 20_000 });
      await expect(acceptInvite).toBeVisible({ timeout: 20_000 });
      await sendInvite.click();
      await expect(guestPage.getByText('收到好友對戰邀請', { exact: true })).toBeVisible({ timeout: 20_000 });
      await acceptInvite.click();

      await expectSharedOnlineMatch(page, guestPage);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await closeGuestContext(guestContext, failed);
    }
  });
});
