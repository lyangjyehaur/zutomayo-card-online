import { expect, test, type Page } from '@playwright/test';

const SEARCH_PLACEHOLDER = '搜尋卡牌名稱、效果、Q&A 或規則內容';

function resultFor(query: string, scope: string | null) {
  const type = scope === 'qa' ? 'qa' : 'card';
  return {
    hits: [
      {
        uid: `${type}__fixture__zh-TW`,
        type,
        sourceId: type === 'qa' ? '74' : '4th_106',
        title: type === 'qa' ? 'Chronos 如何推進？' : query === '海膽栗子' ? '海膽栗子' : `結果：${query}`,
        titleHighlights: query ? [{ start: type === 'qa' ? 0 : 3, end: type === 'qa' ? 7 : 3 + query.length }] : [],
        subtitle: type === 'qa' ? 'Q.74' : 'うにぐり',
        snippet: '搜尋結果內容',
        snippetHighlights: [],
        tags: [],
        relatedCardIds: type === 'qa' ? ['4th_106'] : ['4th_106'],
        url: type === 'qa' ? '/rules/qa/74' : '/cards/4th_106',
        image: '',
        pack: '4th',
        rarity: 'R',
        element: '闇',
        cardType: 'Character',
        distributionType: 'standard',
        documentId: '',
        sortNumber: 106,
        publishedAt: 0,
        updatedAt: 0,
      },
    ],
    estimatedTotalHits: 1,
    limit: 40,
    offset: 0,
    processingTimeMs: 1,
    engine: 'meilisearch',
  };
}

async function installSearchMock(page: Page, requests: URL[]) {
  await page.route('**/api/search?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const query = url.searchParams.get('q') || '';
    if (query === '舊查詢') await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resultFor(query, url.searchParams.get('scope'))),
    });
  });
}

async function installSuggestionMock(page: Page, requests: URL[]) {
  await page.route('**/api/search/suggest?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const query = url.searchParams.get('q') || '';
    if (query === '舊建議') await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          {
            uid: `card__${query}__zh-TW`,
            type: 'card',
            sourceId: '4th_106',
            title: query === '危險文字' ? '<img src=x onerror=alert(1)> 危險文字' : `${query} 建議`,
            titleHighlights: query === '危險文字' ? [{ start: 29, end: 31 }] : [{ start: 0, end: query.length }],
            subtitle: '4th_106',
            url: '/cards/4th_106',
          },
        ],
        engine: 'meilisearch',
        processingTimeMs: 1,
      }),
    });
  });
}

test.describe('統一知識搜尋', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zutomayo_locale', 'zh-TW'));
  });

  test('IME 組字完成後才同步 URL 並搜尋最後內容 @core', async ({ page }) => {
    const requests: URL[] = [];
    const suggestionRequests: URL[] = [];
    await installSuggestionMock(page, suggestionRequests);
    await installSearchMock(page, requests);
    await page.goto('/search');
    const input = page.getByRole('combobox', { name: SEARCH_PLACEHOLDER });
    await expect(input).toBeVisible();

    await input.dispatchEvent('compositionstart');
    await input.fill('海膽栗子');
    await page.waitForTimeout(350);
    expect(requests).toHaveLength(0);
    expect(suggestionRequests).toHaveLength(0);
    await expect(page).not.toHaveURL(/q=/);

    await input.dispatchEvent('compositionend');
    await page.waitForTimeout(100);
    expect(requests).toHaveLength(0);
    expect(suggestionRequests).toHaveLength(0);
    await expect(page).not.toHaveURL(/q=/);

    await expect(page).toHaveURL(/q=%E6%B5%B7%E8%86%BD%E6%A0%97%E5%AD%90/);
    await expect(page.getByRole('link', { name: /海膽栗子/ })).toBeVisible();
    expect(requests.map((url) => url.searchParams.get('q'))).toEqual(['海膽栗子']);
    expect(suggestionRequests.map((url) => url.searchParams.get('q'))).toEqual(['海膽栗子']);
  });

  test('搜尋建議支援鍵盤選擇、Escape 與安全文字高亮 @core', async ({ page }) => {
    const requests: URL[] = [];
    const suggestionRequests: URL[] = [];
    await installSuggestionMock(page, suggestionRequests);
    await installSearchMock(page, requests);
    await page.goto('/search');
    const input = page.getByRole('combobox', { name: SEARCH_PLACEHOLDER });

    await input.fill('危險文字');
    const listbox = page.getByRole('listbox', { name: '搜尋建議' });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByText('<img src=x onerror=alert(1)> 危險文字', { exact: true })).toBeVisible();
    await expect(listbox.locator('img')).toHaveCount(0);
    await expect(listbox.locator('mark')).toHaveText('危險');

    await input.press('Escape');
    await expect(listbox).toBeHidden();
    await input.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await expect(input).toHaveAttribute('aria-activedescendant', /.+-0$/);
    await input.press('Enter');
    await expect(page).toHaveURL(/\/cards\/4th_106$/);
    expect(suggestionRequests.map((url) => url.searchParams.get('q'))).toContain('危險文字');
  });

  test('切換範圍保留查詢，較舊請求不能覆蓋新結果', async ({ page }) => {
    const requests: URL[] = [];
    await installSearchMock(page, requests);
    await page.goto('/search');
    const input = page.getByRole('combobox', { name: SEARCH_PLACEHOLDER });

    await input.fill('舊查詢');
    await page.waitForTimeout(300);
    await input.fill('新查詢');
    await expect(page.getByText('結果：新查詢', { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByText('結果：新查詢', { exact: true })).toBeVisible();
    await expect(page.getByText('結果：舊查詢', { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Q&A', exact: true }).click();
    await expect(page).toHaveURL(/scope=qa/);
    await expect(page).toHaveURL(/q=%E6%96%B0%E6%9F%A5%E8%A9%A2/);
    await expect(page.getByText('Chronos 如何推進？', { exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get('scope')).toBe('qa');
  });

  test('手機版不產生整頁橫向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests: URL[] = [];
    const suggestionRequests: URL[] = [];
    await installSuggestionMock(page, suggestionRequests);
    await installSearchMock(page, requests);
    await page.goto('/search?q=Chronos');
    await expect(page.getByText('結果：Chronos', { exact: true })).toBeVisible();
    const input = page.getByRole('combobox', { name: SEARCH_PLACEHOLDER });
    await input.focus();
    const listbox = page.getByRole('listbox', { name: '搜尋建議' });
    await expect(listbox).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    const box = await listbox.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
