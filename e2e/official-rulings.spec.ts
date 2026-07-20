import { expect, test, type Page, type Route } from '@playwright/test';

const sourceQa = {
  question: 'このカードはいつ使えますか？',
  answer: '自分のターンに使用できます。',
};

const sourceErrata = {
  incorrectText: '古いテキスト',
  correctedText: '新しいテキスト',
  reason: 'カードのテキストに誤りがありました。',
  replacementPolicy: 'カード交換は行いません。',
  usagePolicy: '修正後のテキストとしてゲームを進行してください。',
};

const officialErrataCard = {
  id: '1st_6',
  name: 'カード名',
  pack: 'THE WORLD IS CHANGING',
  song: '測試歌曲',
  illustrator: '測試繪師',
  rarity: 'UR',
  element: '闇',
  type: 'Character',
  clock: 3,
  attack: { night: 2, day: 3 },
  powerCost: 2,
  sendToPower: 1,
  effect: '測試效果',
  image: '',
  errata: '',
  hasOfficialErrata: true,
  officialErrataId: '001',
  officialErrataAffectsEffect: true,
  officialErrataUrl: 'https://zutomayocard.net/errata/001/',
};

function qaItem(lang: string) {
  const japanese = lang === 'ja';
  return {
    id: 'qa_74',
    number: 74,
    publishedAt: '2026-04-04',
    tags: ['カード効果'],
    relatedCardIds: ['1st_6'],
    source: sourceQa,
    localized: japanese
      ? sourceQa
      : {
          question: '這張卡可以在什麼時候使用？',
          answer: '可以在自己的回合使用。',
        },
    requestedLocale: lang,
    effectiveLocale: japanese ? 'ja' : lang,
    translationStatus: japanese ? 'source' : 'verified',
    sourceUrl: 'https://zutomayocard.net/qa/',
    lastSyncedAt: '2026-07-20T00:00:00.000Z',
    contentVersion: 1,
  };
}

function errataItem(lang: string) {
  const japanese = lang === 'ja';
  return {
    errataId: '001',
    cardId: '1st_6',
    cardName: japanese ? 'カード名' : '測試卡牌',
    cardNameJa: 'カード名',
    pack: 'THE WORLD IS CHANGING',
    rarity: 'UR',
    cardNumber: '006/104',
    publishedAt: '2026-02-17',
    affectsName: false,
    affectsEffect: true,
    source: sourceErrata,
    localized: japanese
      ? sourceErrata
      : {
          incorrectText: '舊文字',
          correctedText: '修正後文字',
          reason: '卡牌文字有誤。',
          replacementPolicy: '不提供換卡。',
          usagePolicy: '請以修正後文字進行遊戲。',
        },
    requestedLocale: lang,
    effectiveLocale: japanese ? 'ja' : lang,
    translationStatus: japanese ? 'source' : 'machine',
    sourceUrl: 'https://zutomayocard.net/errata/001/',
    lastSyncedAt: '2026-07-20T00:00:00.000Z',
    contentVersion: 1,
  };
}

async function fulfillOfficialRoute(route: Route) {
  const url = new URL(route.request().url());
  const lang = url.searchParams.get('lang') || 'zh-TW';
  let body: unknown;
  if (/\/api\/official\/qa\/74$/.test(url.pathname)) body = { item: qaItem(lang) };
  else if (url.pathname.endsWith('/api/official/qa')) body = { items: [qaItem(lang)], total: 1, locale: lang };
  else if (/\/api\/official\/errata\/001$/.test(url.pathname)) body = { item: errataItem(lang) };
  else body = { items: [errataItem(lang)], total: 1, locale: lang };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function preparePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    localStorage.setItem('zutomayo_locale', 'zh-TW');
  });
  await page.route('**/api/official/**', fulfillOfficialRoute);
  await page.route('**/api/cards', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([officialErrataCard]) }),
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

test.describe('官方規則資料庫', () => {
  test.beforeEach(async ({ page }) => preparePage(page));

  test('可從首頁搜尋 Q&A、查看詳情並切回日文原文', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByText('CH.07', { exact: true }).click();

    await expect(page).toHaveURL(/\/rules\/qa$/);
    await expect(page.getByRole('heading', { name: '官方規則 Q&A' })).toBeVisible();
    await expect(page.getByText('這張卡可以在什麼時候使用？')).toBeVisible();

    const search = page.getByRole('searchbox', { name: '搜尋問題、答案或分類' });
    await search.fill('自己的回合');
    await expect(page).toHaveURL(/query=/);
    await page.getByRole('link', { name: /這張卡可以在什麼時候使用/ }).click();

    await expect(page).toHaveURL(/\/rules\/qa\/74$/);
    await expect(page.getByRole('heading', { name: '這張卡可以在什麼時候使用？' })).toBeVisible();
    await page.getByText('查看日文原文').click();
    await expect(page.getByText(sourceQa.answer)).toBeVisible();
    await expect(page.getByRole('link', { name: '前往官方來源' })).toHaveAttribute(
      'href',
      'https://zutomayocard.net/qa/',
    );

    await page.locator('select').first().selectOption('ja');
    await expect(page.getByRole('heading', { name: sourceQa.question })).toBeVisible();
    await expect(page.getByText('查看日文原文')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });

  test('勘誤詳情顯示修正對照、翻譯警示與關聯 Q&A', async ({ page }) => {
    await page.goto('/rules/errata');
    await expect(page.getByRole('heading', { name: '官方卡牌勘誤' })).toBeVisible();
    await page.getByRole('link', { name: /測試卡牌/ }).click();

    await expect(page).toHaveURL(/\/rules\/errata\/001$/);
    await expect(page.getByText('舊文字', { exact: true })).toBeVisible();
    await expect(page.getByText('修正後文字', { exact: true })).toBeVisible();
    await expect(page.getByText(/非官方機器翻譯/)).toBeVisible();
    await expect(page.getByRole('link', { name: '前往官方來源' })).toHaveAttribute(
      'href',
      'https://zutomayocard.net/errata/001/',
    );

    await page.getByRole('link', { name: '查看這張卡牌的相關 Q&A' }).click();
    await expect(page).toHaveURL(/\/rules\/qa\?cardId=1st_6$/);
    await expect(page.getByText(/目前只顯示關聯卡牌/)).toContainText('1st_6');
  });

  test('可從牌組編輯器的官方勘誤徽章開啟對應詳情', async ({ page }) => {
    await page.goto('/deck-builder');
    await expect(page.getByRole('button', { name: '新牌組' })).toBeVisible({ timeout: 30_000 });

    const errataLink = page.locator('a[href="/rules/errata/001"]').first();
    await expect(errataLink).toBeVisible();
    await errataLink.click();

    await expect(page).toHaveURL(/\/rules\/errata\/001$/);
    await expect(page.getByRole('heading', { name: '測試卡牌' })).toBeVisible();
    await expect(page.getByRole('img', { name: '測試卡牌' })).toBeVisible();
  });
});

test.describe('官方規則管理', () => {
  test('管理員可編輯、生成翻譯並檢查官方來源', async ({ page }) => {
    const item = {
      resourceType: 'qa',
      id: 'qa_74',
      number: 74,
      label: 'Q.74',
      contentVersion: 1,
      source: sourceQa,
      translation: { question: '原翻譯問題', answer: '原翻譯答案' },
      status: 'machine',
      provider: 'fixture-provider',
      model: 'fixture-model',
      reviewNote: '',
      updatedAt: '2026-07-20T00:00:00.000Z',
    };
    let saveBody: Record<string, string> | null = null;
    let generated = false;

    await page.addInitScript(() => {
      sessionStorage.setItem('zutomayo_admin_token', 'fixture-admin-token');
      sessionStorage.setItem('zutomayo_admin_role', 'admin');
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
    await page.route('**/api/admin/official-content/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/sync-status')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
        return;
      }
      if (url.pathname.endsWith('/sync')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            run: {
              id: 'sync-1',
              triggerSource: 'admin',
              status: 'changes',
              qaLocalCount: 74,
              qaRemoteCount: 75,
              errataLocalCount: 12,
              errataRemoteCount: 12,
              diff: { qa: { added: ['qa_75'], updated: [], removed: [] }, errata: {} },
              error: '',
              requestedByAdminUserId: 'admin-1',
              startedAt: '2026-07-20T00:00:00.000Z',
              finishedAt: '2026-07-20T00:00:01.000Z',
            },
          }),
        });
        return;
      }
      if (url.pathname.endsWith('/generate')) {
        generated = true;
        item.translation = { question: '機器翻譯問題', answer: '機器翻譯答案' };
        item.provider = 'generated-provider';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      if (request.method() === 'PUT') {
        saveBody = request.postDataJSON() as Record<string, string>;
        item.translation = { question: saveBody.question, answer: saveBody.answer };
        item.status = saveBody.status;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [item],
          coverage: { total: 1, translated: 1, verified: item.status === 'verified' ? 1 : 0, pending: 0, failed: 0 },
          locale: 'zh-TW',
        }),
      });
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: '官方規則' }).click();
    await expect(page.getByRole('heading', { name: '官方規則翻譯' })).toBeVisible();
    await expect(page.getByText('Q.74', { exact: true })).toBeVisible();

    await page.getByLabel('翻譯 · question').fill('人工複核問題');
    await page.getByLabel('翻譯 · answer').fill('人工複核答案');
    await page.getByLabel('狀態', { exact: true }).selectOption('verified');
    await page.getByLabel('複核備註').fill('已對照日文原文');
    await page.getByRole('button', { name: '儲存翻譯' }).click();
    await expect(page.getByText('翻譯已儲存並寫入管理稽核紀錄。')).toBeVisible();
    expect(saveBody).toMatchObject({
      question: '人工複核問題',
      answer: '人工複核答案',
      status: 'verified',
      reviewNote: '已對照日文原文',
    });

    await page.getByRole('button', { name: '重新產生機器翻譯' }).click();
    await expect(page.getByText('已產生機器翻譯，請核對日文原文後再標記為已複核。')).toBeVisible();
    expect(generated).toBe(true);
    await expect(page.getByLabel('翻譯 · question')).toHaveValue('機器翻譯問題');

    await page.getByRole('button', { name: '檢查官方來源' }).click();
    await expect(page.getByText('偵測到 1 筆來源差異，請先以同步 CLI 審查並套用。', { exact: true })).toBeVisible();
  });
});
