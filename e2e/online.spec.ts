import { expect, test } from '@playwright/test';
import { getOnlineRoom, openOnlineSeat, openOnlineSpectator, provisionOnlineMatch } from './helpers/online';

test.describe.configure({ mode: 'serial' });

test.describe('雙瀏覽器線上對戰 @requires-backend @core', () => {
  test('建立房間、加入、唯讀觀戰與斷線重連', async ({ browser, context, page, request }, testInfo) => {
    test.setTimeout(90_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
    const guestContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('guest-video') },
    });
    const spectatorContext = await browser.newContext({
      baseURL,
      recordVideo: { dir: testInfo.outputPath('spectator-video') },
    });
    const guestPage = await guestContext.newPage();
    const spectatorPage = await spectatorContext.newPage();
    const guestVideo = guestPage.video();
    const spectatorVideo = spectatorPage.video();
    const spectatorSubmissions: string[] = [];
    spectatorPage.on('request', (outgoing) => {
      const url = new URL(outgoing.url());
      if (outgoing.method() === 'POST' && url.pathname === '/api/matches') {
        spectatorSubmissions.push(outgoing.url());
      }
    });

    let failed = false;
    try {
      const match = await provisionOnlineMatch(request);
      const room = await getOnlineRoom(request, match.matchID);
      expect(room.players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 0, name: 'E2E Host' }),
          expect.objectContaining({ id: 1, name: 'E2E Guest' }),
        ]),
      );

      await Promise.all([openOnlineSeat(page, match, '0'), openOnlineSeat(guestPage, match, '1')]);
      await expect(page.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });
      await expect(guestPage.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-tut="janken-panel"]')).toBeVisible();
      await expect(guestPage.locator('[data-tut="janken-panel"]')).toBeVisible();

      await Promise.all([
        page.getByRole('button', { name: '顯示對戰聊天' }).click(),
        guestPage.getByRole('button', { name: '顯示對戰聊天' }).click(),
      ]);
      await Promise.all([
        expect(page.locator('[data-chat-status="ready"]')).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.locator('[data-chat-status="ready"]')).toBeVisible({ timeout: 20_000 }),
      ]);
      const hostMessage = `guest-host-${Date.now()}`;
      const guestMessage = `guest-reply-${Date.now()}`;
      await page.getByRole('textbox', { name: '對戰聊天訊息' }).fill(hostMessage);
      await page.getByRole('button', { name: '發送對戰聊天訊息' }).click();
      await expect(guestPage.locator('.online-chat-bubble', { hasText: hostMessage })).toBeVisible({ timeout: 20_000 });
      await guestPage.getByRole('textbox', { name: '對戰聊天訊息' }).fill(guestMessage);
      await guestPage.getByRole('button', { name: '發送對戰聊天訊息' }).click();
      await expect(page.locator('.online-chat-bubble', { hasText: guestMessage })).toBeVisible({ timeout: 20_000 });

      await openOnlineSpectator(spectatorPage, match.matchID);
      await expect(spectatorPage.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 30_000 });
      await expect(spectatorPage.locator('[data-tut="janken-panel"]')).toHaveCount(0);
      await expect(spectatorPage.locator('[data-tut^="janken-"]')).toHaveCount(0);

      await page.evaluate(() => {
        const statuses: string[] = [];
        (window as typeof window & { __e2eOnlineConnectionStatuses?: string[] }).__e2eOnlineConnectionStatuses =
          statuses;
        const recordStatus = () => {
          const status = document
            .querySelector('[data-online-connection-status]')
            ?.getAttribute('data-online-connection-status');
          if (status) statuses.push(status);
        };
        new MutationObserver(recordStatus).observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        recordStatus();
      });
      await context.setOffline(true);
      await page.evaluate(() => fetch('/api/app-version').catch(() => undefined));
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (
                window as typeof window & { __e2eOnlineConnectionStatuses?: string[] }
              ).__e2eOnlineConnectionStatuses?.includes('disconnected'),
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
      await context.setOffline(false);
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (
                window as typeof window & { __e2eOnlineConnectionStatuses?: string[] }
              ).__e2eOnlineConnectionStatuses?.includes('rejoined'),
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect(page.locator('[data-game-step="janken"]')).toBeVisible();

      await page.locator('[data-tut="janken-rock"]').click();
      await expect(page.locator('[data-tut="janken-rock"]')).toHaveCount(0);
      await guestPage.locator('[data-tut="janken-scissors"]').click();

      await expect(page.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 });
      await expect(guestPage.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 });
      await expect(spectatorPage.locator('[data-game-step="mulligan"]')).toBeVisible({ timeout: 20_000 });
      await expect(spectatorPage.locator('[data-tut="mulligan-panel"]')).toHaveCount(0);
      await expect(spectatorPage.locator('[data-tut="mulligan-keep"], [data-tut="mulligan-redraw"]')).toHaveCount(0);

      expect(spectatorSubmissions).toEqual([]);
      await expect.poll(() => spectatorPage.evaluate(() => localStorage.getItem('zutomayo_match_records'))).toBeNull();

      // 完成 setup，確認兩個獨立 client 能進入正式回合；對手手牌只能以牌背呈現。
      await Promise.all([
        page.getByRole('button', { name: '保留手牌' }).click(),
        guestPage.getByRole('button', { name: '保留手牌' }).click(),
      ]);
      await expect(page.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 });
      await expect(guestPage.locator('[data-game-step="initialSet"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.bf-opponent-handbacks img')).toHaveCount(5);
      await expect(page.locator('.bf-opponent-handbacks img').first()).toHaveAttribute('src', /card-back/);

      // 每位玩家放置一張初始牌並確認，進入 turnSet 後由玩家 0 投降，驗證完整結算流程。
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

      await page.getByRole('button', { name: '暫停' }).first().click();
      const surrenderDialog = page.getByRole('dialog');
      await expect(surrenderDialog).toBeVisible();
      await surrenderDialog.getByRole('button', { name: '投降' }).click();
      await expect(page.locator('[data-result-outcome="defeat"]')).toBeVisible({ timeout: 10_000 });
      await expect(guestPage.locator('[data-result-outcome="victory"]')).toBeVisible({ timeout: 10_000 });
      await expect(spectatorPage.locator('[data-result-outcome="spectator"]')).toBeVisible({ timeout: 20_000 });
      expect(spectatorSubmissions).toEqual([]);

      await Promise.all([
        page.getByRole('button', { name: '再戰一局' }).click(),
        guestPage.getByRole('button', { name: '再戰一局' }).click(),
      ]);
      await Promise.all([
        expect
          .poll(() => decodeURIComponent(new URL(page.url()).pathname.split('/').pop() || ''), { timeout: 20_000 })
          .not.toBe(match.matchID),
        expect
          .poll(() => decodeURIComponent(new URL(guestPage.url()).pathname.split('/').pop() || ''), {
            timeout: 20_000,
          })
          .not.toBe(match.matchID),
      ]);
      const hostRematchID = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() || '');
      const guestRematchID = decodeURIComponent(new URL(guestPage.url()).pathname.split('/').pop() || '');
      expect(hostRematchID).not.toBe(match.matchID);
      expect(guestRematchID).toBe(hostRematchID);
      await Promise.all([
        expect(page.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 20_000 }),
        expect(guestPage.locator('[data-game-step="janken"]')).toBeVisible({ timeout: 20_000 }),
      ]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await context.setOffline(false).catch(() => undefined);
      await Promise.all([guestContext.close(), spectatorContext.close()]);
      if (!failed) await Promise.all([guestVideo?.delete(), spectatorVideo?.delete()]);
    }
  });
});
