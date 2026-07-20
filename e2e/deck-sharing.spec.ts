import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const cardIds = Array.from({ length: 20 }, (_, index) => `card_${index}`);
const cards = cardIds.map((id, index) => ({
  id,
  name: `Test Card ${index}`,
  pack: 'Test Pack',
  song: 'Test Song',
  illustrator: 'Test Artist',
  rarity: 'N',
  element: index % 2 === 0 ? '炎' : '風',
  type: 'Character',
  clock: index % 18,
  attack: { night: 10 + index, day: 20 + index },
  powerCost: index % 5,
  sendToPower: 0,
  effect: `Test effect ${index}`,
  image: '',
  errata: '',
}));

const share = {
  id: 'ds_share_12345678',
  name: '真夜中炎風牌組',
  visibility: 'public',
  publicationStatus: 'published',
  moderationStatus: 'visible',
  publishedRulesVersion: '0.2.1',
  publishedAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T01:00:00.000Z',
  owner: { userId: 'u_owner', nickname: '夜行玩家' },
  elements: ['炎', '風'],
  characterCount: 20,
  representativeCardIds: cardIds.slice(0, 3),
  likeCount: 18,
  copyCount: 7,
  viewerHasLiked: false,
};

const detail = { ...share, cardIds };
const serverDeck = { id: 'd_source_1234', name: '我的測試牌組', cardIds };

function ownedShare(overrides: Record<string, unknown> = {}) {
  return {
    ...detail,
    sourceDeckId: serverDeck.id,
    sourceDeckExists: true,
    sourceChanged: false,
    unpublishedAt: null,
    moderationReason: '',
    ...overrides,
  };
}

async function enableLoggedInSession(page: Page, userId = 'u_viewer') {
  await page.addInitScript((id) => {
    localStorage.setItem('zutomayo_session', '1');
    localStorage.setItem('deck_share_test_user_id', id);
  }, userId);
}

async function expectNoBlockingAxeViolations(page: Page, surface: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking,
    `${surface}: ${blocking.map((violation) => `${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`).join('\n')}`,
  ).toEqual([]);
}

test.describe('牌組分享大廳', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    await page.route('**/api/config', (route) => route.fulfill({ json: { deck_sharing_enabled: true } }));
    await page.route('**/api/cards', (route) => route.fulfill({ json: cards }));
    await page.route('**/api/cards/texts', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/cards/*/texts', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/csrf-token', (route) => route.fulfill({ json: { token: 'deck-share-test-csrf' } }));
    await page.route('**/api/imgproxy/**', (route) => route.fulfill({ status: 404, json: { error: 'not mocked' } }));
    await page.route('**/api/profile', async (route) => {
      const userId = await page.evaluate(() => localStorage.getItem('deck_share_test_user_id') || 'u_viewer');
      await route.fulfill({ json: { id: userId, nickname: 'Viewer' } });
    });
    await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [] } }));
    await page.route('**/api/decks/*/share', (route) =>
      route.fulfill({ status: 404, json: { error: 'Deck share not found' } }),
    );
    await page.route('**/api/deck-shares**', (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === `/api/deck-shares/${share.id}/like`) {
        return route.fulfill({ json: { liked: method === 'PUT', likeCount: method === 'PUT' ? 19 : 18 } });
      }
      if (url.pathname === `/api/deck-shares/${share.id}/reports`) {
        return route.fulfill({ status: 201, json: { report: { id: 'dsr_test', status: 'pending' } } });
      }
      if (url.pathname === `/api/deck-shares/${share.id}/copy`) {
        return route.fulfill({ status: 201, json: { deck: { ...serverDeck, id: 'd_copied_1234' }, copyCount: 8 } });
      }
      if (url.pathname === `/api/deck-shares/${share.id}`) return route.fulfill({ json: detail });
      return route.fulfill({ json: { shares: [share], nextCursor: null } });
    });
  });

  test('訪客可用鍵盤從大廳開啟詳情與卡牌 Sheet', async ({ page }) => {
    await page.goto('/deck-shares');
    await expect(page.getByRole('heading', { name: '探索玩家分享的牌組' })).toBeVisible({ timeout: 30_000 });

    const shareCard = page.getByRole('link', { name: '真夜中炎風牌組 · 夜行玩家' });
    await shareCard.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/deck-shares/${share.id}$`));
    await expect(page.getByText('發布時間:')).toBeVisible();
    await page.getByRole('button', { name: '查看卡牌 Test Card 0' }).click();
    const sheet = page.getByRole('dialog', { name: 'Test Card 0' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Test effect 0')).toBeVisible();
    await expectNoBlockingAxeViolations(page, '分享卡牌詳情 Sheet');
    await sheet.getByRole('button', { name: '關閉' }).click();
    await page.getByRole('button', { name: '分享連結' }).first().click();
    await expect(page.getByText('分享連結已複製', { exact: true })).toBeVisible();
  });

  test('登入玩家可按讚、檢舉與複製到伺服器牌組', async ({ page }) => {
    await enableLoggedInSession(page);
    await page.goto(`/deck-shares/${share.id}`);

    await page.getByRole('button', { name: '按讚' }).click();
    await expect(page.getByRole('button', { name: '取消讚' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: '檢舉' }).click();
    const reportDialog = page.getByRole('dialog', { name: '檢舉牌組分享' });
    await reportDialog.getByRole('combobox').selectOption('spam');
    await reportDialog.getByRole('textbox').fill('重複發布內容');
    await reportDialog.getByRole('button', { name: '送出檢舉' }).click();
    await expect(page.getByRole('button', { name: '已檢舉' })).toBeDisabled();

    const copyRequest = page.waitForRequest(
      (request) => request.url().endsWith(`/api/deck-shares/${share.id}/copy`) && request.method() === 'POST',
    );
    await page.getByRole('button', { name: '複製到我的牌組' }).click();
    await copyRequest;
    await expect(page).toHaveURL(/\/deck-builder$/);
  });

  test('擁有者不會看到自讚或自我檢舉控制', async ({ page }) => {
    await enableLoggedInSession(page, 'u_owner');
    await page.goto(`/deck-shares/${share.id}`);
    await expect(page.getByRole('heading', { name: share.name, level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '按讚' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '檢舉' })).toHaveCount(0);
  });

  test('僅連結分享不出現在大廳，訪客仍可直接開啟並複製到本機', async ({ page }) => {
    await page.unroute('**/api/deck-shares**');
    await page.route('**/api/deck-shares**', (route) => {
      const url = new URL(route.request().url());
      return url.pathname === '/api/deck-shares'
        ? route.fulfill({ json: { shares: [], nextCursor: null } })
        : route.fulfill({ json: { ...detail, visibility: 'unlisted' } });
    });

    await page.goto('/deck-shares');
    await expect(page.getByText('目前還沒有公開牌組', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto(`/deck-shares/${share.id}`);
    await expect(page.getByText('僅連結分享', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '複製到我的牌組' }).click();
    await expect(page).toHaveURL(/\/deck-builder$/);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = localStorage.getItem('zutomayo_custom_decks_v2');
          return stored ? (JSON.parse(stored) as Array<{ name: string }>)[0]?.name : '';
        }),
      )
      .toContain(share.name);
  });

  test('登入擁有者可完成發布、更新、取消與重新發布', async ({ page }) => {
    await enableLoggedInSession(page, 'u_owner');
    let state: ReturnType<typeof ownedShare> | null = null;
    await page.unroute('**/api/decks');
    await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [serverDeck] } }));
    await page.route(`**/api/decks/${serverDeck.id}/share`, (route) =>
      state ? route.fulfill({ json: state }) : route.fulfill({ status: 404, json: { error: 'Deck share not found' } }),
    );
    await page.unroute('**/api/deck-shares**');
    await page.route('**/api/deck-shares**', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        state = ownedShare({ sourceChanged: true });
        return route.fulfill({ status: 201, json: state });
      }
      if (method === 'PUT') {
        const body = route.request().postDataJSON() as { published?: boolean; publishLatest?: boolean };
        state = ownedShare({
          ...(state || {}),
          publicationStatus: body.published === false ? 'unpublished' : 'published',
          sourceChanged: body.publishLatest ? false : state?.sourceChanged,
          unpublishedAt: body.published === false ? new Date().toISOString() : null,
        });
        return route.fulfill({ json: state });
      }
      if (method === 'DELETE') {
        state = ownedShare({
          ...(state || {}),
          publicationStatus: 'unpublished',
          unpublishedAt: new Date().toISOString(),
        });
        return route.fulfill({ json: { unpublished: true, shareId: share.id } });
      }
      return route.fulfill({ json: detail });
    });
    page.on('dialog', (dialog) => void dialog.accept());

    await page.goto('/deck-builder');
    await page.getByRole('button', { name: '分享' }).click();
    const manager = page.getByRole('dialog', { name: '發布牌組分享' });
    await manager.getByRole('button', { name: '發布牌組' }).click();
    await expect(page.getByRole('dialog', { name: '管理牌組分享' })).toBeVisible();

    await page.getByRole('button', { name: '更新分享' }).click();
    await expect(page.getByText('有尚未發布的變更')).toHaveCount(0);

    await page.getByRole('button', { name: '取消發布' }).click();
    await expect(page.getByText('已取消發布', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重新發布' }).click();
    await expect(page.getByText('已發布', { exact: true })).toBeVisible();
  });

  test('被封鎖或隱藏的分享在大廳與直接連結都不洩漏', async ({ page }) => {
    await enableLoggedInSession(page);
    await page.unroute('**/api/deck-shares**');
    await page.route('**/api/deck-shares**', (route) => {
      const url = new URL(route.request().url());
      return url.pathname === '/api/deck-shares'
        ? route.fulfill({ json: { shares: [], nextCursor: null } })
        : route.fulfill({ status: 404, json: { error: 'Deck share not found' } });
    });

    await page.goto('/deck-shares');
    await expect(page.getByText('目前還沒有公開牌組', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto(`/deck-shares/${share.id}`);
    await expect(page.getByText('找不到這個分享', { exact: true })).toBeVisible();
  });

  test('管理員可處理檢舉、隱藏並恢復分享', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('zutomayo_admin_token', 'admin-test-token');
      sessionStorage.setItem('zutomayo_admin_role', 'moderator');
    });
    let moderationStatus: 'visible' | 'hidden' = 'visible';
    let reportStatus: 'pending' | 'resolved' = 'pending';
    const report = () => ({
      id: 'dsr_test_report',
      shareId: share.id,
      reporterUserId: 'u_reporter',
      reporterNickname: '檢舉玩家',
      reason: 'spam',
      note: '重複發布',
      status: reportStatus,
      resolutionNote: '',
      createdAt: '2026-07-20T02:00:00.000Z',
      updatedAt: '2026-07-20T02:00:00.000Z',
      resolvedAt: reportStatus === 'resolved' ? '2026-07-20T03:00:00.000Z' : null,
      share: {
        name: share.name,
        ownerUserId: share.owner.userId,
        ownerNickname: share.owner.nickname,
        publicationStatus: 'published',
        moderationStatus,
        moderationReason: moderationStatus === 'hidden' ? 'spam' : '',
        cardIds,
      },
    });
    await page.route('**/api/admin/deck-share-reports**', (route) => {
      const status = new URL(route.request().url()).searchParams.get('status');
      const reports = status === reportStatus ? [report()] : [];
      return route.fulfill({ json: { reports } });
    });
    await page.route('**/api/admin/deck-shares/**/moderation', async (route) => {
      const body = route.request().postDataJSON() as { moderationStatus: 'visible' | 'hidden' };
      moderationStatus = body.moderationStatus;
      reportStatus = 'resolved';
      await route.fulfill({ json: { shareId: share.id, moderationStatus, moderationReason: body.moderationStatus } });
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: '牌組分享' }).click();
    await expect(page.getByRole('heading', { name: '牌組分享審核' })).toBeVisible();
    await page.getByRole('button', { name: '隱藏分享' }).click();
    await expect(page.getByText('沒有牌組分享檢舉', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Resolved' }).click();
    await page.getByRole('button', { name: '恢復分享' }).click();
    await expect(page.getByRole('button', { name: '隱藏分享' })).toBeVisible();
    await expectNoBlockingAxeViolations(page, '牌組分享管理審核');
  });

  test('在 360px、平板與寬螢幕下無水平溢出且通過 axe', async ({ page }) => {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/deck-shares');
      await expect(page.getByRole('searchbox', { name: '搜尋牌組或作者…' })).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true);
    }
    await expectNoBlockingAxeViolations(page, '分享大廳');
  });
});
