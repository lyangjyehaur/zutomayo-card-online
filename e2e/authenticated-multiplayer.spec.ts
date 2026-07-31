import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  assertSecureAuthenticatedCookies,
  establishAuthenticatedFriendship,
  getAuthenticatedMatchHistory,
  openAuthenticatedOnlineLobby,
  registerAuthenticatedOnlineAccount,
  type AuthenticatedMatchHistoryEntry,
} from './helpers/online';
import { QUICK_MATCH_ENABLED } from '../src/featureFlags';

/**
 * These tests require the API and Colyseus endpoint to receive the same
 * HttpOnly account session. The stock Docker E2E overlay serves the app from
 * `game` but builds the platform URL as `platform`, so its host-only Lax cookie
 * cannot authenticate cross-host matchmaking. A staging/reverse-proxy run
 * must opt in explicitly and describe the endpoint topology below.
 */
const AUTHENTICATED_MULTIPLAYER_FLAG = 'E2E_AUTHENTICATED_MULTIPLAYER';
const RANKED_HISTORY_FLAG = 'E2E_RANKED_MATCHES_ENABLED';
const EVIDENCE_FLAG = 'E2E_AUTHENTICATED_EVIDENCE';

function recordLs05Evidence(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: 'ls05', description });
}

const FORBIDDEN_REPLAY_KEYS = new Set([
  'state',
  'initialstate',
  'deck',
  'decks',
  'deckdefids',
  'rng',
  'rngstate',
  'rngseed',
  'seed',
  'replaymanifest',
  'hand',
  'hands',
  'handcardids',
]);

function assertSanitizedReplayPayload(payload: unknown): void {
  let revealedHandsSeen = false;
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
      const childPath = `${path}.${key}`;
      if (normalizedKey === 'revealedhands') {
        revealedHandsSeen = true;
      } else if (
        FORBIDDEN_REPLAY_KEYS.has(normalizedKey) ||
        normalizedKey.startsWith('rng') ||
        normalizedKey.endsWith('manifest')
      ) {
        throw new Error(`Replay payload exposes forbidden field ${childPath}`);
      }
      visit(child, childPath);
    }
  };

  expect(payload).toMatchObject({
    matchId: expect.any(String),
    replay: {
      schemaVersion: 1,
      result: expect.any(Object),
      decisions: expect.any(Array),
      effects: expect.any(Array),
      timeline: expect.any(Array),
    },
  });
  visit(payload, 'response');
  expect(revealedHandsSeen).toBe(true);
}

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
  if (enabled(EVIDENCE_FLAG)) throw new Error(description);
  testInfo.annotations.push({ type: 'blocked', description });
  test.skip(true, description);
}

async function expectAuthenticatedLobby(page: Page, nickname: string): Promise<void> {
  await expect(page.getByText(`${nickname} · ELO`).first()).toBeVisible({ timeout: 30_000 });
}

async function selectFirstAvailableDeck(page: Page): Promise<void> {
  const deckPanel = page.locator('[data-room-panel="deck"]');
  const deckOptions = deckPanel.locator('details[data-deck-options]');
  const deck = deckOptions.locator('button[aria-pressed]:not([disabled])').first();
  await expect(deck).toBeVisible({ timeout: 30_000 });
  await deck.click();
  await expect(deck).toHaveAttribute('aria-pressed', 'true');
}

async function expectProductionWebSocket(page: Page, websocketUrls: string[]): Promise<void> {
  await expect.poll(() => websocketUrls.find((value) => value.startsWith('wss://')), { timeout: 30_000 }).toBeTruthy();
  const base = new URL(process.env.E2E_BASE_URL || page.url());
  for (const value of websocketUrls) {
    const socket = new URL(value);
    if (socket.protocol === 'wss:' && socket.host !== base.host) {
      throw new Error(`WebSocket ${socket.host} is not routed through the app origin ${base.host}`);
    }
  }
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

async function completeSetupAndSurrender(loser: Page, winner: Page, spectator?: Page): Promise<void> {
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
  if (spectator) {
    await expect(spectator.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 });
    const spectatorHand = spectator.locator('[data-zone="hand"] [data-face-up]');
    await expect(spectatorHand).toHaveCount(5);
    await expect(spectator.locator('[data-zone="hand"] button')).toHaveCount(0);
    expect(
      await spectatorHand.evaluateAll((cards) => cards.every((card) => card.getAttribute('data-face-up') === 'false')),
    ).toBe(true);
  }
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

test.describe('Authenticated 雙瀏覽器線上流程 @requires-backend @staging-only', () => {
  test('Quick Match、牌組選擇、聊天、重連、觀戰資訊隱藏、完整結算與雙方 server history @rr05-core', async ({
    browser,
    context,
    page,
  }, testInfo) => {
    test.skip(!QUICK_MATCH_ENABLED, 'Quick Match UI is temporarily disabled');
    test.setTimeout(180_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    skipWhenBlocked(testInfo, baseURL, true);

    const guestContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('guest-video') },
    });
    const spectatorContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('spectator-video') },
    });
    const nonParticipantContext = await browser.newContext({ baseURL });
    const websocketUrls: string[] = [];
    page.on('websocket', (socket) => websocketUrls.push(socket.url()));
    let failed = false;
    try {
      const [hostAccount, guestAccount] = await Promise.all([
        registerAuthenticatedOnlineAccount(context, 'E2E Ranked Host'),
        registerAuthenticatedOnlineAccount(guestContext, 'E2E Ranked Guest'),
        registerAuthenticatedOnlineAccount(nonParticipantContext, 'E2E Replay Outsider'),
      ]);
      recordLs05Evidence(testInfo, 'authenticated-sessions');
      await Promise.all([
        assertSecureAuthenticatedCookies(context, baseURL),
        assertSecureAuthenticatedCookies(guestContext, baseURL),
      ]);
      recordLs05Evidence(testInfo, 'secure-cookies');
      const guestPage = await guestContext.newPage();
      await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
      await Promise.all([
        expectAuthenticatedLobby(page, hostAccount.nickname),
        expectAuthenticatedLobby(guestPage, guestAccount.nickname),
      ]);
      await Promise.all([selectFirstAvailableDeck(page), selectFirstAvailableDeck(guestPage)]);
      recordLs05Evidence(testInfo, 'server-backed-decks');

      await Promise.all([
        page.getByRole('button', { name: '開始匹配' }).click(),
        guestPage.getByRole('button', { name: '開始匹配' }).click(),
      ]);
      const matchID = await expectSharedOnlineMatch(page, guestPage);
      recordLs05Evidence(testInfo, 'quick-match');
      await expectProductionWebSocket(page, websocketUrls);
      recordLs05Evidence(testInfo, 'same-origin-websocket');

      const spectatorPage = await spectatorContext.newPage();
      const spectatorMatchSubmissions: string[] = [];
      spectatorPage.on('request', (request) => {
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === '/api/matches')
          spectatorMatchSubmissions.push(request.url());
      });
      await spectatorPage.goto(`/play/online/${encodeURIComponent(matchID)}?spectate=1`);
      await expect(spectatorPage.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });
      await expect(spectatorPage.locator('[data-tut^="janken-"]')).toHaveCount(0);

      await page.getByRole('button', { name: '顯示對戰聊天' }).click();
      const chatMessage = `authenticated-chat-${Date.now()}`;
      const chatInput = page.getByRole('textbox', { name: '對戰聊天訊息' });
      await expect(chatInput).toBeEnabled({ timeout: 20_000 });
      await chatInput.fill(chatMessage);
      await page.getByRole('button', { name: '發送對戰聊天訊息' }).click();
      await expect(guestPage.locator('[data-chat-unread-count="1"]')).toBeVisible({ timeout: 20_000 });
      await guestPage.locator('.online-chat-toggle').click();
      await expect(guestPage.locator('.online-chat-bubble', { hasText: chatMessage })).toBeVisible({ timeout: 20_000 });
      await expect(guestPage.locator('[data-chat-unread-count]')).toHaveCount(0);
      recordLs05Evidence(testInfo, 'chat-authorization');

      await context.setOffline(true);
      await expect(page.locator('[data-online-connection-status="disconnected"]')).toBeVisible({ timeout: 15_000 });
      await context.setOffline(false);
      await expect(page.locator('[data-online-connection-status="rejoined"]')).toBeVisible({ timeout: 25_000 });
      recordLs05Evidence(testInfo, 'disconnect-reconnect');

      await completeSetupAndSurrender(page, guestPage, spectatorPage);

      await expect(spectatorPage.locator('[data-result-outcome="spectator"]')).toBeVisible({ timeout: 20_000 });
      expect(spectatorMatchSubmissions).toEqual([]);
      recordLs05Evidence(testInfo, 'spectator-hidden-information');

      let hostMatch: AuthenticatedMatchHistoryEntry | undefined;
      let guestMatch: AuthenticatedMatchHistoryEntry | undefined;
      await expect
        .poll(
          async () => {
            const [hostHistory, guestHistory] = await Promise.all([
              getAuthenticatedMatchHistory(context),
              getAuthenticatedMatchHistory(guestContext),
            ]);
            hostMatch = hostHistory.find((entry) => entry.sourceMatchId === matchID);
            guestMatch = guestHistory.find((entry) => entry.sourceMatchId === matchID);
            return {
              host: hostMatch,
              guest: guestMatch,
            };
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toEqual({
          host: expect.objectContaining({
            winnerId: guestAccount.id,
            loserId: hostAccount.id,
            replayAvailable: true,
          }),
          guest: expect.objectContaining({
            winnerId: guestAccount.id,
            loserId: hostAccount.id,
            replayAvailable: true,
          }),
        });
      recordLs05Evidence(testInfo, 'result-submission');

      expect(hostMatch?.id).toBeTruthy();
      expect(guestMatch?.id).toBe(hostMatch?.id);
      const replayPath = `/api/matches/${encodeURIComponent(hostMatch!.id)}/replay`;
      const [hostReplayResponse, guestReplayResponse, outsiderReplayResponse] = await Promise.all([
        context.request.get(replayPath),
        guestContext.request.get(replayPath),
        nonParticipantContext.request.get(replayPath),
      ]);
      expect(hostReplayResponse.status()).toBe(200);
      expect(guestReplayResponse.status()).toBe(200);
      expect(outsiderReplayResponse.status()).toBe(403);
      const [hostReplay, guestReplay] = await Promise.all([hostReplayResponse.json(), guestReplayResponse.json()]);
      assertSanitizedReplayPayload(hostReplay);
      assertSanitizedReplayPayload(guestReplay);
      expect(guestReplay).toEqual(hostReplay);
      recordLs05Evidence(testInfo, 'replay-privacy');

      await Promise.all([page.goto('/history'), guestPage.goto('/history')]);
      await Promise.all([
        expect(page.getByRole('article').filter({ hasText: '敗北' }).first()).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.getByRole('article').filter({ hasText: '勝利' }).first()).toBeVisible({ timeout: 20_000 }),
      ]);
      await Promise.all([
        page.getByRole('article').filter({ hasText: '敗北' }).first().getByRole('button', { name: '查看軌跡' }).click(),
        guestPage
          .getByRole('article')
          .filter({ hasText: '勝利' })
          .first()
          .getByRole('button', { name: '查看軌跡' })
          .click(),
      ]);
      await Promise.all([
        expect(page.getByText('完整決策紀錄')).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.getByText('完整決策紀錄')).toBeVisible({ timeout: 20_000 }),
      ]);
      recordLs05Evidence(testInfo, 'match-history');
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await context.setOffline(false).catch(() => undefined);
      await Promise.all([
        closeGuestContext(guestContext, failed),
        closeGuestContext(spectatorContext, failed),
        closeGuestContext(nonParticipantContext, failed),
      ]);
    }
  });

  test('好友邀請由兩個已登入帳號接力到同一個 boardgame 對局 @rr05-invite', async ({
    browser,
    context,
    page,
  }, testInfo) => {
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
      await Promise.all([
        assertSecureAuthenticatedCookies(context, baseURL),
        assertSecureAuthenticatedCookies(guestContext, baseURL),
      ]);
      await establishAuthenticatedFriendship(context, inviter, guestContext, recipient);

      const guestPage = await guestContext.newPage();
      await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
      await Promise.all([
        expectAuthenticatedLobby(page, inviter.nickname),
        expectAuthenticatedLobby(guestPage, recipient.nickname),
      ]);
      await Promise.all([selectFirstAvailableDeck(page), selectFirstAvailableDeck(guestPage)]);

      await Promise.all([
        page.locator('[data-friend-invites] summary').click(),
        guestPage.locator('[data-friend-invites] summary').click(),
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
      recordLs05Evidence(testInfo, 'friend-invite');
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await closeGuestContext(guestContext, failed);
    }
  });
});
