import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  getAuthenticatedMatchHistory,
  openAuthenticatedOnlineLobby,
  registerAuthenticatedOnlineAccount,
  selectAuthenticatedServerDeck,
} from './helpers/online';

const readyMarker = resolve('test-results/game-process-restart.ready');
const restartedMarker = resolve('test-results/game-process-restart.restarted.json');

async function expectLobby(page: Page, nickname: string): Promise<void> {
  await expect(page.getByText(`${nickname} · ELO`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '開始匹配' })).toBeEnabled({ timeout: 30_000 });
}

async function sharedMatch(first: Page, second: Page): Promise<string> {
  await Promise.all([
    first.waitForURL(/\/play\/online\/[^/?#]+/, { timeout: 45_000 }),
    second.waitForURL(/\/play\/online\/[^/?#]+/, { timeout: 45_000 }),
  ]);
  const firstID = decodeURIComponent(new URL(first.url()).pathname.split('/').pop() || '');
  const secondID = decodeURIComponent(new URL(second.url()).pathname.split('/').pop() || '');
  expect(firstID).not.toBe('');
  expect(secondID).toBe(firstID);
  await Promise.all([
    expect(first.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 }),
    expect(second.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 }),
  ]);
  return firstID;
}

async function waitForRestartEvidence(): Promise<{ game: unknown; platform: unknown }> {
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(restartedMarker, 'utf8')) as { game: unknown; platform: unknown };
        } catch {
          return null;
        }
      },
      { timeout: 90_000, intervals: [100, 250, 500, 1_000] },
    )
    .not.toBeNull();
  return JSON.parse(await readFile(restartedMarker, 'utf8')) as { game: unknown; platform: unknown };
}

async function finishSetup(loser: Page, winner: Page): Promise<void> {
  await Promise.all([
    expect(loser.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 30_000 }),
    expect(winner.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 30_000 }),
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
}

async function surrender(loser: Page, winner: Page): Promise<void> {
  await loser.getByRole('button', { name: '暫停' }).first().click();
  await loser.getByRole('dialog').getByRole('button', { name: '投降' }).click();
  await Promise.all([
    expect(loser.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 20_000 }),
    expect(winner.locator('[data-result-outcome="victory"]')).toBeVisible({ timeout: 20_000 }),
  ]);
}

async function waitForBoardgameReconnect(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = page.locator('[data-online-connection-status]');
        if ((await status.count()) === 0) return 'ready';
        const value = await status.getAttribute('data-online-connection-status');
        return value === 'disconnected' || value === 'reconnecting' ? value : 'ready';
      },
      { timeout: 60_000, intervals: [100, 250, 500, 1_000] },
    )
    .toBe('ready');
}

test('game/platform process restart preserves the authoritative match and one canonical history row', async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000);
  expect(process.env.E2E_AUTHENTICATED_MULTIPLAYER).toBe('1');
  expect(process.env.E2E_RANKED_MATCHES_ENABLED).toBe('1');
  await Promise.all([rm(readyMarker, { force: true }), rm(restartedMarker, { force: true })]);

  const guestContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    const [host, guest] = await Promise.all([
      registerAuthenticatedOnlineAccount(context, 'E2E Restart Host'),
      registerAuthenticatedOnlineAccount(guestContext, 'E2E Restart Guest'),
    ]);
    const guestPage = await guestContext.newPage();
    await Promise.all([openAuthenticatedOnlineLobby(page), openAuthenticatedOnlineLobby(guestPage)]);
    await Promise.all([selectAuthenticatedServerDeck(page, host), selectAuthenticatedServerDeck(guestPage, guest)]);
    await Promise.all([expectLobby(page, host.nickname), expectLobby(guestPage, guest.nickname)]);
    await Promise.all([
      page.getByRole('button', { name: '開始匹配' }).click(),
      guestPage.getByRole('button', { name: '開始匹配' }).click(),
    ]);
    const matchID = await sharedMatch(page, guestPage);

    await page.locator('[data-tut="janken-rock"]').click();
    await guestPage.locator('[data-tut="janken-scissors"]').click();
    await finishSetup(page, guestPage);
    await writeFile(readyMarker, `${matchID}\n`, { flag: 'wx' });
    const restartEvidence = await waitForRestartEvidence();
    expect(restartEvidence).toEqual({
      game: expect.objectContaining({ startedAtChanged: true, healthy: true }),
      platform: expect.objectContaining({ startedAtChanged: true, healthy: true }),
    });

    await Promise.all([
      expect(page.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 45_000 }),
      expect(guestPage.locator('[data-game-step="turnSet"]')).toBeVisible({ timeout: 45_000 }),
      waitForBoardgameReconnect(page),
      waitForBoardgameReconnect(guestPage),
    ]);
    await surrender(page, guestPage);

    await expect
      .poll(
        async () => {
          const [hostHistory, guestHistory] = await Promise.all([
            getAuthenticatedMatchHistory(context),
            getAuthenticatedMatchHistory(guestContext),
          ]);
          const hostRows = hostHistory.filter((row) => row.sourceMatchId === matchID);
          const guestRows = guestHistory.filter((row) => row.sourceMatchId === matchID);
          return {
            hostCount: hostRows.length,
            guestCount: guestRows.length,
            hostWinner: hostRows[0]?.winnerId,
            guestWinner: guestRows[0]?.winnerId,
            sameHistory: hostRows[0]?.id === guestRows[0]?.id,
          };
        },
        { timeout: 45_000, intervals: [500, 1_000, 2_000] },
      )
      .toEqual({
        hostCount: 1,
        guestCount: 1,
        hostWinner: guest.id,
        guestWinner: guest.id,
        sameHistory: true,
      });
  } finally {
    await guestContext.close();
    await Promise.all([rm(readyMarker, { force: true }), rm(restartedMarker, { force: true })]);
  }
});
