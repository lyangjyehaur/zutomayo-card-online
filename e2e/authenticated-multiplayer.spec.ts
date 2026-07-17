import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  establishAuthenticatedFriendship,
  getAuthenticatedMatchHistory,
  loginAuthenticatedOnlineAccount,
  openAuthenticatedOnlineLobby,
  registerAuthenticatedOnlineAccount,
  selectAuthenticatedServerDeck,
} from './helpers/online';

/** These tests fail closed unless the runner declares a shared account-cookie topology. */
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

function requireAuthenticatedMultiplayer(baseURL: string, requireRankedHistory: boolean): void {
  const blockers = authenticatedMultiplayerBlockers(baseURL, requireRankedHistory);
  if (blockers.length === 0) return;
  throw new Error(`Authenticated multiplayer is required but misconfigured: ${blockers.join('; ')}`);
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

async function completeSetup(first: Page, second: Page): Promise<void> {
  await first.locator('[data-tut="janken-rock"]').click();
  await second.locator('[data-tut="janken-scissors"]').click();
  await Promise.all([
    expect(first.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 }),
    expect(second.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 }),
  ]);
  await Promise.all([
    first.getByRole('button', { name: '保留手牌' }).click(),
    second.getByRole('button', { name: '保留手牌' }).click(),
  ]);
  await Promise.all([
    expect(first.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 }),
    expect(second.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 }),
  ]);
  await Promise.all([
    first.locator('[data-zone="hand"] button').first().click(),
    second.locator('[data-zone="hand"] button').first().click(),
  ]);
  await Promise.all([
    first.getByRole('button', { name: /打出檢視中的牌/ }).click(),
    second.getByRole('button', { name: /打出檢視中的牌/ }).click(),
  ]);
  await Promise.all([
    first.getByRole('button', { name: /確認出牌/ }).click(),
    second.getByRole('button', { name: /確認出牌/ }).click(),
  ]);
  await Promise.all([
    expect(first.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
    expect(second.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
  ]);
}

async function completeSetupAndSurrender(loser: Page, winner: Page): Promise<void> {
  await completeSetup(loser, winner);

  await loser.getByRole('button', { name: '暫停' }).first().click();
  const surrenderDialog = loser.getByRole('dialog');
  await expect(surrenderDialog).toBeVisible();
  await surrenderDialog.getByRole('button', { name: '投降' }).click();
  await Promise.all([
    expect(loser.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 15_000 }),
    expect(winner.locator('[data-result-outcome="victory"]')).toBeVisible({ timeout: 15_000 }),
  ]);
}

async function waitForSettledOnlineState(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = page.locator('[data-online-connection-status]');
        if ((await status.count()) === 0) return 'ready';
        const value = await status.getAttribute('data-online-connection-status');
        return value === 'reconnecting' || value === 'disconnected' ? value : 'ready';
      },
      { timeout: 20_000, intervals: [100, 250, 500] },
    )
    .toBe('ready');
}

async function setFirstAvailableCard(page: Page): Promise<void> {
  await waitForSettledOnlineState(page);
  const card = page.locator('[data-zone="hand"] button').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  const setCard = page.getByRole('button', { name: /打出檢視中的牌/ });
  await expect(setCard).toBeEnabled({ timeout: 10_000 });
  await setCard.click();
}

async function setOptionalSecondCard(page: Page): Promise<void> {
  if (!(await page.getByText('最多 2', { exact: true }).isVisible())) return;
  await setFirstAvailableCard(page);
}

type NaturalMatchOutcome = 'victory' | 'defeat' | 'draw';

async function visibleOutcome(page: Page): Promise<NaturalMatchOutcome | null> {
  const result = page.locator('[data-result-outcome]');
  if (!(await result.isVisible())) return null;
  const outcome = await result.getAttribute('data-result-outcome');
  return outcome === 'victory' || outcome === 'defeat' || outcome === 'draw' ? outcome : null;
}

async function completeNaturally(first: Page, second: Page): Promise<[NaturalMatchOutcome, NaturalMatchOutcome]> {
  await completeSetup(first, second);

  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.all([
      expect(first.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
      expect(second.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 30_000 }),
    ]);
    await Promise.all([setFirstAvailableCard(first), setFirstAvailableCard(second)]);
    // The previous battle loser may set a second card. Taking that legal
    // option makes the two deck-consumption paths asymmetric, so a natural
    // overdraw produces a winner instead of relying on surrender or timeout.
    await Promise.all([setOptionalSecondCard(first), setOptionalSecondCard(second)]);
    await Promise.all([
      first.getByRole('button', { name: /確認出牌/ }).click(),
      second.getByRole('button', { name: /確認出牌/ }).click(),
    ]);

    await expect
      .poll(
        async () => {
          const [firstOutcome, secondOutcome] = await Promise.all([visibleOutcome(first), visibleOutcome(second)]);
          if (firstOutcome && secondOutcome) return 'finished';
          const firstConfirm = first.getByRole('button', { name: /確認出牌/ });
          const secondConfirm = second.getByRole('button', { name: /確認出牌/ });
          const nextTurnReady = (await firstConfirm.count()) > 0 && (await secondConfirm.count()) > 0;
          return nextTurnReady ? 'next-turn' : 'resolving';
        },
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .not.toBe('resolving');

    const outcomes = await Promise.all([visibleOutcome(first), visibleOutcome(second)]);
    if (outcomes[0] && outcomes[1]) return outcomes as [NaturalMatchOutcome, NaturalMatchOutcome];
  }

  throw new Error('Effect-free authenticated match did not finish naturally within 20 turns');
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
    requireAuthenticatedMultiplayer(baseURL, true);

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
        selectAuthenticatedServerDeck(page, hostAccount),
        selectAuthenticatedServerDeck(guestPage, guestAccount),
      ]);
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

  test('自然完成對局後雙方與新裝置 history 各只有一筆', async ({ browser, context, page }, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    requireAuthenticatedMultiplayer(baseURL, true);

    const guestContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('guest-video') },
    });
    let failed = false;
    try {
      const [hostAccount, guestAccount] = await Promise.all([
        registerAuthenticatedOnlineAccount(context, 'E2E Natural Host', { deckStrength: 'strong' }),
        registerAuthenticatedOnlineAccount(guestContext, 'E2E Natural Guest', { deckStrength: 'weak' }),
      ]);
      const guestPage = await guestContext.newPage();
      await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
      await Promise.all([
        selectAuthenticatedServerDeck(page, hostAccount),
        selectAuthenticatedServerDeck(guestPage, guestAccount),
      ]);
      await Promise.all([
        expectAuthenticatedLobby(page, hostAccount.nickname),
        expectAuthenticatedLobby(guestPage, guestAccount.nickname),
      ]);

      await Promise.all([
        page.getByRole('button', { name: '開始匹配' }).click(),
        guestPage.getByRole('button', { name: '開始匹配' }).click(),
      ]);
      const matchID = await expectSharedOnlineMatch(page, guestPage);
      const outcomes = await completeNaturally(page, guestPage);
      const expectedWinnerId =
        outcomes[0] === 'victory' ? hostAccount.id : outcomes[1] === 'victory' ? guestAccount.id : null;
      const expectedLoserId =
        outcomes[0] === 'defeat' ? hostAccount.id : outcomes[1] === 'defeat' ? guestAccount.id : null;
      expect(
        outcomes[0] === 'draw' ? outcomes[1] === 'draw' : outcomes.includes('victory') && outcomes.includes('defeat'),
      ).toBe(true);

      let canonicalHistoryId = '';
      await expect
        .poll(
          async () => {
            const [hostHistory, guestHistory] = await Promise.all([
              getAuthenticatedMatchHistory(context),
              getAuthenticatedMatchHistory(guestContext),
            ]);
            const hostEntries = hostHistory.filter((entry) => entry.sourceMatchId === matchID);
            const guestEntries = guestHistory.filter((entry) => entry.sourceMatchId === matchID);
            if (hostEntries.length === 1 && guestEntries.length === 1 && hostEntries[0].id === guestEntries[0].id) {
              canonicalHistoryId = hostEntries[0].id;
            }
            return {
              hostCount: hostEntries.length,
              guestCount: guestEntries.length,
              sameCanonicalId: hostEntries[0]?.id === guestEntries[0]?.id,
              hostWinnerId: hostEntries[0]?.winnerId ?? null,
              guestWinnerId: guestEntries[0]?.winnerId ?? null,
              hostLoserId: hostEntries[0]?.loserId ?? null,
              guestLoserId: guestEntries[0]?.loserId ?? null,
            };
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toEqual({
          hostCount: 1,
          guestCount: 1,
          sameCanonicalId: true,
          hostWinnerId: expectedWinnerId,
          guestWinnerId: expectedWinnerId,
          hostLoserId: expectedLoserId,
          guestLoserId: expectedLoserId,
        });
      expect(canonicalHistoryId).not.toBe('');

      const [hostMirrorContext, guestMirrorContext] = await Promise.all([
        browser.newContext({ baseURL }),
        browser.newContext({ baseURL }),
      ]);
      try {
        await Promise.all([
          loginAuthenticatedOnlineAccount(hostMirrorContext, hostAccount),
          loginAuthenticatedOnlineAccount(guestMirrorContext, guestAccount),
        ]);
        const [hostMirrorPage, guestMirrorPage] = await Promise.all([
          hostMirrorContext.newPage(),
          guestMirrorContext.newPage(),
        ]);
        await Promise.all([hostMirrorPage.goto('/history'), guestMirrorPage.goto('/history')]);
        await Promise.all([
          expect(hostMirrorPage.getByRole('article').first()).toBeVisible({ timeout: 20_000 }),
          expect(guestMirrorPage.getByRole('article').first()).toBeVisible({ timeout: 20_000 }),
        ]);
        const [hostMirrorHistory, guestMirrorHistory] = await Promise.all([
          getAuthenticatedMatchHistory(hostMirrorContext),
          getAuthenticatedMatchHistory(guestMirrorContext),
        ]);
        const hostMirrorEntries = hostMirrorHistory.filter((entry) => entry.sourceMatchId === matchID);
        const guestMirrorEntries = guestMirrorHistory.filter((entry) => entry.sourceMatchId === matchID);
        expect(hostMirrorEntries).toHaveLength(1);
        expect(guestMirrorEntries).toHaveLength(1);
        expect(hostMirrorEntries[0].id).toBe(canonicalHistoryId);
        expect(guestMirrorEntries[0].id).toBe(canonicalHistoryId);
      } finally {
        await Promise.all([hostMirrorContext.close(), guestMirrorContext.close()]);
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await closeGuestContext(guestContext, failed);
    }
  });

  test('好友邀請由兩個已登入帳號接力到同一個 boardgame 對局', async ({ browser, context, page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    requireAuthenticatedMultiplayer(baseURL, false);

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
        selectAuthenticatedServerDeck(page, inviter),
        selectAuthenticatedServerDeck(guestPage, recipient),
      ]);
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
      await expect(acceptInvite).toHaveAttribute('title', '收到好友對戰邀請', { timeout: 30_000 });
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
