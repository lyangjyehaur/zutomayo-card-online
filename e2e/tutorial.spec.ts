import { test, expect } from '@playwright/test';

/**
 * 教學模式 E2E 測試。
 *
 * 頁面載入測試不需要後端（卡牌未載入時會顯示錯誤狀態）。
 * 教學覆蓋層與互動需要卡牌資料，以 @requires-backend 標記。
 *
 * 執行前先啟動 dev server：`npm run dev`
 * @requires-backend 測試需要完整服務棧（docker-compose.e2e.yml）。
 */
test.describe.configure({ mode: 'serial' });

async function simulateCardApiOutage(page: import('@playwright/test').Page) {
  await page.route('**/api/cards', (route) => route.abort());
  await page.route('**/cards.json', (route) => route.abort());
}

async function expectTutorialPhase(page: import('@playwright/test').Page, phase: string) {
  const overlay = page.locator('.tutorial-game-overlay');
  await expect(overlay).toHaveAttribute('data-tutorial-phase', phase, { timeout: 15_000 });
  return overlay;
}

async function expectDecodedImages(images: import('@playwright/test').Locator) {
  await expect
    .poll(async () =>
      images.evaluateAll((elements) =>
        elements.every((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
        }),
      ),
    )
    .toBe(true);
}

async function expectTooltipContentUsable(page: import('@playwright/test').Page, requireInstruction = false) {
  const tooltip = page.locator('.tutorial-tooltip');
  const title = tooltip.getByRole('heading');
  await expect(title).toBeVisible();
  if (requireInstruction) await expect(tooltip.getByTestId('tutorial-fixed-instruction')).toBeVisible();
  const geometry = await tooltip.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.tutorial-tooltip-body');
    const heading = element.querySelector<HTMLElement>('h3');
    if (!body || !heading) return null;
    const tooltipRect = element.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return {
      bodyHeight: body.getBoundingClientRect().height,
      headingTop: headingRect.top,
      headingBottom: headingRect.bottom,
      tooltipTop: tooltipRect.top,
      tooltipBottom: tooltipRect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.bodyHeight).toBeGreaterThanOrEqual(requireInstruction ? 16 : 72);
  expect(geometry!.headingTop).toBeGreaterThanOrEqual(geometry!.tooltipTop);
  expect(geometry!.headingBottom).toBeLessThanOrEqual(geometry!.tooltipBottom);
  expect(geometry!.tooltipTop).toBeGreaterThanOrEqual(0);
  expect(geometry!.tooltipBottom).toBeLessThanOrEqual(geometry!.viewportHeight);
}

async function expectSingleActionHighlight(page: import('@playwright/test').Page) {
  const overlay = page.locator('.tutorial-game-overlay');
  const highlight = overlay.locator('.tutorial-interaction-target');
  await expect(highlight).toHaveCount(1);
  await expect(overlay.locator('svg > rect[stroke]:not(.tutorial-interaction-target)')).toHaveCount(0);
  await expectHighlightOutsideTooltip(page, highlight);
}

async function expectSingleContextHighlight(page: import('@playwright/test').Page) {
  const overlay = page.locator('.tutorial-game-overlay');
  const highlight = overlay.locator('svg > rect[stroke]:not(.tutorial-interaction-target)');
  await expect(highlight).toHaveCount(1);
  await expect(overlay.locator('.tutorial-interaction-target')).toHaveCount(0);
  await expectHighlightOutsideTooltip(page, highlight);
}

async function expectHighlightOutsideTooltip(
  page: import('@playwright/test').Page,
  highlight: import('@playwright/test').Locator,
) {
  await expect
    .poll(async () => {
      const highlightBox = await highlight.boundingBox();
      const tooltipBox = await page.locator('.tutorial-game-overlay .tutorial-tooltip').boundingBox();
      if (!highlightBox || !tooltipBox) return Number.POSITIVE_INFINITY;
      const overlapWidth = Math.max(
        0,
        Math.min(highlightBox.x + highlightBox.width, tooltipBox.x + tooltipBox.width) -
          Math.max(highlightBox.x, tooltipBox.x),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(highlightBox.y + highlightBox.height, tooltipBox.y + tooltipBox.height) -
          Math.max(highlightBox.y, tooltipBox.y),
      );
      return overlapWidth * overlapHeight;
    })
    .toBe(0);
}

async function startTutorialBattle(page: import('@playwright/test').Page) {
  await page.goto('/tutorial');
  await expect(page.getByRole('heading', { name: '新手教學', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /戰鬥準備/ }).click();
  await page.getByRole('button', { name: '開始戰鬥準備', exact: true }).click();
}

async function confirmTutorialRewind(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: '返回上一段教學？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('最近的安全檢查點');
  await dialog.getByRole('button', { name: '返回並重建', exact: true }).click();
}

test.describe('教學頁面載入', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('教學頁面能載入', async ({ page }) => {
    await page.goto('/tutorial');
    await expect(page.getByRole('heading', { name: '新手教學', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '兩人對戰的卡牌遊戲', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '遊戲目標', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '夜與晝的特色', exact: true })).toBeVisible();
    await expect(page.getByText('落後方的追趕', { exact: true })).toHaveCount(0);
    await expect(page.getByText('18 CHRONOS', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '牌組組成', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /卡牌介紹/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /戰場介紹/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /戰鬥準備/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /對戰流程/ })).toBeVisible();
  });

  test('戰鬥準備章節從真實對局入口開始', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await page.getByTestId('tutorial-chapter-tab-preparation').click();

    const startButton = page.getByRole('button', { name: '開始戰鬥準備', exact: true });
    await expect(startButton).toBeVisible();
    await startButton.click();

    await expect(page.getByRole('alert')).toContainText('卡牌資料載入失敗');
    const completed = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('zutomayo_tutorial_chapters_v3') || '[]'),
    );
    expect(completed).not.toContain('preparation');
  });

  test('手機章節導覽保持單列緊湊並可橫向切換', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tutorial');

    const navigation = page.getByTestId('tutorial-chapter-navigation');
    const list = page.getByTestId('tutorial-chapter-list');
    const tabs = list.locator('[data-testid^="tutorial-chapter-tab-"]');
    await expect(tabs).toHaveCount(5);

    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(navigationBox!.height).toBeLessThanOrEqual(90);
    await expect(navigation.getByText('認識遊戲目標與牌組準備', { exact: true })).toBeHidden();

    const scrollMetrics = await list.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
    expect(scrollMetrics.scrollHeight).toBeLessThanOrEqual(88);

    await page.getByTestId('tutorial-chapter-tab-flow').click();
    await expect(page.getByTestId('tutorial-chapter-tab-flow')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: '對戰流程', exact: true })).toBeVisible();
    await expect(page.getByTestId('tutorial-flow-first-turn')).toContainText('第 1 回合不再進行 A／B 區設置');
    await expect(page.getByTestId('tutorial-flow-following-turns')).toContainText('第 2 回合起：重複以下流程');
  });

  test('卡牌與戰場章節在無後端時仍顯示真實卡圖', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await expect(page.getByRole('heading', { name: '遊戲概要', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /卡牌介紹/ }).click();
    for (const id of ['2nd_40', '1st_100', '2nd_86']) {
      await page.getByTestId(`tutorial-card-selector-${id}`).click();
      const card = page.getByTestId('tutorial-card-example');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-card-image-delivery', 'imgproxy');
      await expect(card).toHaveAttribute('src', /^\/api\/imgproxy\//);
      await expect(card).toHaveAttribute('src', new RegExp(`r2\\.dan\\.tw/cards/.*${id}`), {
        timeout: 10_000,
      });
    }

    await page.getByRole('button', { name: /戰場介紹/ }).click();
    const board = page.getByTestId('tutorial-real-board-preview');
    await expect(board).toBeVisible();
    await expect(board.locator('[data-board-layout="tutorial-simplified"]')).toBeVisible();
    await expect(board.locator('[data-tut="player-battle-zone"]')).toBeVisible();
    await expect(board.locator('[data-tut="opponent-battle-zone"]')).toBeVisible();
    await expect(board.locator('[data-tut="player-power"]')).toBeVisible();
    await expect(board.locator('[data-tut="opponent-power"]')).toBeVisible();
    await expect(board.locator('[data-tut="player-abyss"]')).toBeVisible();
    await expect(board.locator('[data-tut="opponent-abyss"]')).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-hp')).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-hp-opponent')).toBeVisible();
    await expect(board.locator('.chronosdial')).toBeVisible();
    await expect(board.locator('img[src*="zutomayocard_1st_34"]')).toBeVisible();
    await expect(board.getByLabel('對手 攻擊力 50')).toBeVisible();
    await expect(board.getByLabel('我方 攻擊力 70')).toBeVisible();
    await expect(board.getByRole('button', { name: '充能區: 2 (2)', exact: true })).toBeVisible();
    await expect(
      board.getByRole('button', { name: '我方 區域附魔' }).locator('img[data-card-image-delivery="imgproxy"]'),
    ).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-power')).toHaveAttribute('data-card-ids', '2nd_40,2nd_40');
    await expect(page.getByTestId('tutorial-field-target-abyss')).toHaveAttribute('data-card-ids', '1st_67');
    await expect(page.getByTestId('tutorial-field-target-power-opponent')).toHaveAttribute('data-card-ids', '3rd_58');
    await expect(page.getByTestId('tutorial-field-target-deck-opponent')).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-abyss-opponent')).toHaveAttribute('data-card-ids', '2nd_40');
    await expect(page.getByTestId('tutorial-field-opponent-upper-row')).toHaveCSS('display', 'contents');
    await expect(page.getByTestId('tutorial-field-opponent-lower-row')).toHaveCSS('display', 'contents');
    const opponentRowTargetBoxes = await Promise.all(
      ['abyss-opponent', 'deck-opponent', 'set', 'power-opponent'].map((id) =>
        page.getByTestId(`tutorial-field-target-${id}`).boundingBox(),
      ),
    );
    expect(opponentRowTargetBoxes.every(Boolean)).toBe(true);
    const opponentRowBottoms = opponentRowTargetBoxes.map((box) => box!.y + box!.height);
    expect(Math.max(...opponentRowBottoms) - Math.min(...opponentRowBottoms)).toBeLessThanOrEqual(1);
  });

  test('卡牌數值與戰場區域可互動探索', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');

    await expect(page.getByTestId('tutorial-deck-rules')).toContainText('牌組由 20 張卡牌組成');
    await expect(page.getByTestId('tutorial-deck-rules')).toContainText('官方建議角色卡佔牌組一半以上');
    await expect(page.getByText('10 角色卡', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /戰鬥準備/ }).click();
    await expect(page.getByText('先猜拳決定夜側玩家')).toBeVisible();
    await expect(page.getByText('雙方各從牌頂抽 5 張作為起手牌')).toBeVisible();
    await expect(page.getByText('起手時可進行一次重抽')).toBeVisible();
    await expect(page.getByText('若翻開的是非角色卡')).toBeVisible();

    await page.getByRole('button', { name: /卡牌介紹/ }).click();
    const characterTab = page.getByTestId('tutorial-card-selector-2nd_40');
    await expect(characterTab).toHaveAttribute('id', 'tutorial-card-tab-2nd_40');
    await expect(characterTab).toHaveAttribute('aria-controls', 'tutorial-card-panel');
    await characterTab.click();
    const cardPanel = page.locator('#tutorial-card-panel');
    await expect(cardPanel).toHaveAttribute('role', 'tabpanel');
    await expect(cardPanel).toHaveAttribute('aria-labelledby', 'tutorial-card-tab-2nd_40');
    await expect(page.getByTestId('tutorial-card-example')).toHaveAttribute('alt', '角色卡 — 牛奶和混凝土製成的貓');
    const enchantTab = page.getByTestId('tutorial-card-selector-1st_100');
    await characterTab.press('ArrowRight');
    await expect(enchantTab).toHaveAttribute('aria-selected', 'true');
    await expect(enchantTab).toBeFocused();
    await expect(cardPanel).toHaveAttribute('aria-labelledby', 'tutorial-card-tab-1st_100');
    await enchantTab.press('Home');
    await expect(characterTab).toHaveAttribute('aria-selected', 'true');
    await expect(characterTab).toBeFocused();
    await expect(cardPanel).toHaveAttribute('aria-labelledby', 'tutorial-card-tab-2nd_40');
    const cardFactDetail = page.locator('#tutorial-card-fact-detail');
    await expect(cardPanel.locator('[data-testid^="tutorial-card-fact-"]')).toHaveText([
      '卡牌種類／卡號',
      '卡牌名稱',
      '屬性',
      '時計',
      '攻擊力',
      '效果',
      'Power Cost',
      'SEND TO POWER',
    ]);
    await expect(page.locator('[data-marker-style="contrast-frame"]')).toHaveCount(8);
    await expect(page.getByText('這張卡標示為「Character」，即角色卡。', { exact: false })).toBeVisible();
    await page.getByTestId('tutorial-card-fact-name').click();
    await expect(page.getByText('這張卡的名稱是「牛奶和混凝土製成的貓」。', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('一起確認收錄包與卡號', { exact: false })).toBeVisible();
    await page.getByTestId('tutorial-card-fact-effect').click();
    await expect(cardFactDetail.getByText('並非所有角色卡都有文字效果。', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('沒有效果的角色仍會正常進行攻擊力比較。', { exact: false })).toBeVisible();
    await page.getByTestId('tutorial-card-fact-element').click();
    await expect(page.locator('img[src*="/tutorial/card-elements/"]')).toHaveCount(5);
    await expect(page.locator('button img[src*="/tutorial/card-elements/"]')).toHaveCount(0);
    await expect(cardFactDetail.getByText('以下是目前牌池的整體傾向', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('整體在夜間表現較強', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('攻擊性較強，但 Power Cost 通常也較高', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('整體在晝間表現較強', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('Power Cost 通常較低', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('以深淵為核心', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('回收其中的卡牌發動強力效果', { exact: false })).toBeVisible();
    await page.getByTestId('tutorial-card-fact-powerCost').click();
    await expect(cardFactDetail.getByText('Power 會累積在「充能區」', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('達到門檻後，Power 也不會被扣除', { exact: false })).toBeVisible();
    await expect(page.getByText('這張角色卡的 Power Cost 是 3', { exact: false })).toBeVisible();
    await expect(page.getByText('攻擊力以 0 計算。', { exact: false })).toBeVisible();

    await enchantTab.click();
    await expect(cardPanel).toHaveAttribute('aria-labelledby', 'tutorial-card-tab-1st_100');
    await expect(page.getByRole('heading', { name: '附魔卡', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '植物化', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-marker-style="contrast-frame"]')).toHaveCount(7);
    await expect(page.getByTestId('tutorial-card-hotspot-attack')).toHaveCount(0);
    await expect(page.getByTestId('tutorial-card-fact-attack')).toHaveCount(0);
    await expect(page.getByTestId('tutorial-card-hotspot-clock')).toHaveText('');
    await expect(
      page.getByText('附魔提供本回合的一次性強化、干擾或資源效果，通常會影響接下來的戰鬥，並在回合結束時離場。', {
        exact: true,
      }),
    ).toHaveCount(1);
    await page.getByTestId('tutorial-card-fact-effect').click();
    await expect(cardFactDetail.getByText('於效果處理階段發動', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('回合結束時離場', { exact: false })).toBeVisible();
    await page.getByTestId('tutorial-card-hotspot-sendToPower').click();
    await expect(page.getByTestId('tutorial-card-hotspot-sendToPower')).toHaveAttribute('aria-pressed', 'true');
    await expect(cardFactDetail.getByText('離場後能為充能區增加多少 Power', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('持續提供 1 Power', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('SEND TO POWER 為 0 的卡', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('會送往「深淵」', { exact: false })).toBeVisible();

    const areaEnchantTab = page.getByTestId('tutorial-card-selector-2nd_86');
    await areaEnchantTab.click();
    await expect(cardPanel).toHaveAttribute('aria-labelledby', 'tutorial-card-tab-2nd_86');
    await expect(page.locator('[data-marker-style="contrast-frame"]')).toHaveCount(7);
    await expect(page.getByTestId('tutorial-card-hotspot-attack')).toHaveCount(0);
    await expect(page.getByTestId('tutorial-card-fact-attack')).toHaveCount(0);
    await expect(
      page.getByText('與附魔不同，區域附魔不會在結算後立即離場，而會留在場上跨回合持續發揮效果。', {
        exact: true,
      }),
    ).toHaveCount(1);
    await page.getByTestId('tutorial-card-fact-effect').click();
    await expect(cardFactDetail.getByText('不是只處理一次', { exact: false })).toBeVisible();
    await expect(cardFactDetail.getByText('之後各回合的效果處理階段', { exact: false })).toBeVisible();
    await expect(page.getByText('設置區 C', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /戰場介紹/ }).click();
    await expect(
      page
        .getByRole('heading', { name: '戰場介紹', exact: true })
        .locator('..')
        .getByText('理解戰鬥區、設置區、充能區、牌組區、深淵、HP 與 Chronos', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-battle')).toHaveClass(/ring-inset/);
    await page.getByTestId('tutorial-field-target-set-player').click();
    await expect(page.getByTestId('tutorial-field-description').locator('p')).toHaveCount(3);

    await page.getByTestId('tutorial-field-target-chronos').click();
    await expect(page.getByText('藍色區域代表夜，紅色區域代表晝', { exact: false })).toBeVisible();
    await expect(page.getByText('由 Chronos 標記所在側的玩家先處理', { exact: false })).toBeVisible();

    await page.getByTestId('tutorial-field-target-power').click();
    await expect(page.getByText('Power Cost 只檢查總量是否達到門檻', { exact: false })).toBeVisible();
    await expect(page.getByText('都不會扣除 Power', { exact: false })).toBeVisible();

    await page.getByTestId('tutorial-field-target-deck').click();
    await expect(page.getByText('若無法抽足本回合需要的張數', { exact: false })).toBeVisible();

    for (const zone of ['abyss', 'hp']) {
      await page.getByTestId(`tutorial-field-target-${zone}`).click();
    }

    await expect(page.getByText('7 / 7', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tutorial-field-description').locator('..').getByText('HP 指示器')).toBeVisible();
    await expect(page.getByTestId('tutorial-field-description').locator('p')).toHaveCount(3);
    await expect(
      page.getByTestId('tutorial-field-description').getByText('雙方都從 100 開始', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByTestId('tutorial-field-description').getByText('攻擊力差值扣除 HP', { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId('tutorial-field-target-battle')).toHaveAttribute('data-explored', 'true');
    await expect(page.getByTestId('tutorial-field-target-deck')).toHaveAttribute('data-explored', 'true');
  });

  test('卡牌與戰場章節必須完成最低探索要求並保留進度', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await page.getByTestId('tutorial-chapter-tab-cards').click();

    const completeButton = page.getByRole('button', { name: '完成並進入下一章', exact: true });
    await expect(completeButton).toBeDisabled();
    await expect(page.getByText('完成本章前還需查看：卡牌種類 / 核心欄位', { exact: false })).toBeVisible();

    for (const cardId of ['2nd_40', '1st_100', '2nd_86']) {
      await page.getByTestId(`tutorial-card-selector-${cardId}`).click();
    }
    await page.getByTestId('tutorial-card-selector-2nd_40').click();
    for (const fact of ['clock', 'powerCost', 'sendToPower', 'effect']) {
      await page.getByTestId(`tutorial-card-fact-${fact}`).click();
    }
    await expect(completeButton).toBeEnabled();
    await completeButton.click();
    await expect(page.getByRole('heading', { name: '戰場介紹', exact: true })).toBeVisible();

    await expect(completeButton).toBeDisabled();
    for (const zone of ['chronos', 'set-player', 'power', 'deck', 'abyss', 'hp']) {
      await page.getByTestId(`tutorial-field-target-${zone}`).click();
    }
    await expect(completeButton).toBeEnabled();

    await page.reload();
    await page.getByTestId('tutorial-chapter-tab-field').click();
    await expect(page.getByText('7 / 7', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '完成並進入下一章', exact: true })).toBeEnabled();
  });

  test('手機寬度完整顯示對手充能區、牌組與深淵', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await page.getByRole('button', { name: /戰場介紹/ }).click();

    const board = page.getByTestId('tutorial-real-board-preview');
    const opponentResources = [
      page.getByTestId('tutorial-field-target-power-opponent'),
      page.getByTestId('tutorial-field-target-deck-opponent'),
      page.getByTestId('tutorial-field-target-abyss-opponent'),
    ];
    await page.waitForTimeout(300);
    const boardBox = await board.boundingBox();
    expect(boardBox).not.toBeNull();

    const opponentStackBackground = await board.locator('.bf-opponent .cardstack-well').first().boundingBox();
    const playerStackBackground = await board.locator('.bf-player .cardstack-well').first().boundingBox();
    expect(opponentStackBackground).not.toBeNull();
    expect(playerStackBackground).not.toBeNull();
    expect(opponentStackBackground!.width).toBeLessThan(playerStackBackground!.width);

    const upperRowBox = await page.getByTestId('tutorial-field-opponent-upper-row').boundingBox();
    const lowerRowBox = await page.getByTestId('tutorial-field-opponent-lower-row').boundingBox();
    await expect(page.getByTestId('tutorial-field-opponent-upper-row')).toHaveCSS('display', 'flex');
    await expect(page.getByTestId('tutorial-field-opponent-lower-row')).toHaveCSS('display', 'flex');
    expect(upperRowBox).not.toBeNull();
    expect(lowerRowBox).not.toBeNull();
    expect(upperRowBox!.y + upperRowBox!.height).toBeLessThanOrEqual(lowerRowBox!.y + 1);

    for (const resource of opponentResources) {
      await expect(resource).toBeVisible();
      const resourceBox = await resource.boundingBox();
      expect(resourceBox).not.toBeNull();
      expect(resourceBox!.x).toBeGreaterThanOrEqual(boardBox!.x - 1);
      expect(resourceBox!.x + resourceBox!.width).toBeLessThanOrEqual(boardBox!.x + boardBox!.width + 1);
    }

    const playerDeckAbyssGroup = page.getByTestId('tutorial-field-player-deck-abyss-group');
    await expect(playerDeckAbyssGroup).toHaveCSS('display', 'flex');
    const playerDeckBox = await page.getByTestId('tutorial-field-target-deck').boundingBox();
    const playerAbyssBox = await page.getByTestId('tutorial-field-target-abyss').boundingBox();
    const playerGroupBox = await playerDeckAbyssGroup.boundingBox();
    expect(playerDeckBox).not.toBeNull();
    expect(playerAbyssBox).not.toBeNull();
    expect(playerGroupBox).not.toBeNull();
    expect(Math.abs(playerDeckBox!.y - playerAbyssBox!.y)).toBeLessThanOrEqual(1);
    expect(playerGroupBox!.x).toBeGreaterThanOrEqual(boardBox!.x - 1);
    expect(playerGroupBox!.x + playerGroupBox!.width).toBeLessThanOrEqual(boardBox!.x + boardBox!.width + 1);
  });

  test('中等寬度足夠時將對手資源展平成單排', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 812 });
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await page.getByRole('button', { name: /戰場介紹/ }).click();

    await page.waitForTimeout(300);
    const boardBox = await page.getByTestId('tutorial-real-board-preview').boundingBox();
    expect(boardBox).not.toBeNull();
    await expect(page.getByTestId('tutorial-field-opponent-upper-row')).toHaveCSS('display', 'contents');
    await expect(page.getByTestId('tutorial-field-opponent-lower-row')).toHaveCSS('display', 'contents');

    for (const id of ['abyss', 'deck', 'set', 'power']) {
      const target = page.getByTestId(`tutorial-field-target-${id}${id === 'set' ? '' : '-opponent'}`);
      const targetBox = await target.boundingBox();
      expect(targetBox).not.toBeNull();
      expect(targetBox!.x).toBeGreaterThanOrEqual(boardBox!.x - 1);
      expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(boardBox!.x + boardBox!.width + 1);
    }
  });

  test('常見解析度下中央戰場與上下區域保持淨空', async ({ page }) => {
    await simulateCardApiOutage(page);
    await page.goto('/tutorial');
    await page.getByRole('button', { name: /戰場介紹/ }).click();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 479, height: 800 },
      { width: 480, height: 800 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(120);

      const board = page.getByTestId('tutorial-real-board-preview');
      const boardBox = await board.boundingBox();
      const opponentBox = await board.locator('.bf-opponent').boundingBox();
      const playerBox = await board.locator('.bf-player').boundingBox();
      const opponentBattleBox = await page.getByTestId('tutorial-field-target-battle').boundingBox();
      const chronosBox = await page.getByTestId('tutorial-field-target-chronos').boundingBox();
      const playerBattleBox = await page.getByTestId('tutorial-field-target-battle-player').boundingBox();

      expect(boardBox, JSON.stringify(viewport)).not.toBeNull();
      expect(opponentBox, JSON.stringify(viewport)).not.toBeNull();
      expect(playerBox, JSON.stringify(viewport)).not.toBeNull();
      expect(opponentBattleBox, JSON.stringify(viewport)).not.toBeNull();
      expect(chronosBox, JSON.stringify(viewport)).not.toBeNull();
      expect(playerBattleBox, JSON.stringify(viewport)).not.toBeNull();

      const centralTop = Math.min(opponentBattleBox!.y, chronosBox!.y, playerBattleBox!.y);
      const centralBottom = Math.max(
        opponentBattleBox!.y + opponentBattleBox!.height,
        chronosBox!.y + chronosBox!.height,
        playerBattleBox!.y + playerBattleBox!.height,
      );
      expect(centralTop - (opponentBox!.y + opponentBox!.height), JSON.stringify(viewport)).toBeGreaterThanOrEqual(8);
      expect(playerBox!.y - centralBottom, JSON.stringify(viewport)).toBeGreaterThanOrEqual(8);
      expect(
        chronosBox!.x - (opponentBattleBox!.x + opponentBattleBox!.width),
        JSON.stringify(viewport),
      ).toBeGreaterThanOrEqual(8);
      expect(playerBattleBox!.x - (chronosBox!.x + chronosBox!.width), JSON.stringify(viewport)).toBeGreaterThanOrEqual(
        8,
      );
      expect(playerBox!.y + playerBox!.height, JSON.stringify(viewport)).toBeLessThanOrEqual(
        boardBox!.y + boardBox!.height + 1,
      );
    }
  });

  test('無後端時顯示卡牌載入失敗訊息', async ({ page }) => {
    // 沒有後端 API 時，卡牌無法載入，應顯示錯誤狀態與重試按鈕
    await simulateCardApiOutage(page);
    await startTutorialBattle(page);

    // 等待卡牌載入失敗（可能需要等 boot timeout）
    await expect(page.getByText('卡牌資料載入失敗')).toBeVisible({ timeout: 30_000 });

    // 重試按鈕應存在
    await expect(page.getByRole('button', { name: /重試/ })).toBeVisible();
  });

  test('重試按鈕可點擊', async ({ page }) => {
    await simulateCardApiOutage(page);
    await startTutorialBattle(page);
    await expect(page.getByText('卡牌資料載入失敗')).toBeVisible({ timeout: 30_000 });

    // 點擊重試按鈕不應崩潰
    await page.getByRole('button', { name: /重試/ }).click();

    // 重試後會重新進入 loading 狀態
    await expect(page.getByText(/卡牌資料載入失敗|載入對戰中/)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('教學覆蓋層與互動 @requires-backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('zutomayo_deck_intro_seen', 'true');
      localStorage.setItem('zutomayo_locale', 'zh-TW');
    });
  });

  test('教學覆蓋層顯示', async ({ page }) => {
    // 此測試需要卡牌資料載入成功
    await startTutorialBattle(page);

    // 卡牌載入成功後，教學覆蓋層（dialog）應該出現
    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('遊戲結束', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/線上對戰已結束/)).toHaveCount(0);
  });

  test('固定教學卡圖與 imgproxy 格式都能實際解碼', async ({ page }) => {
    await page.goto('/tutorial');
    await page.getByTestId('tutorial-chapter-tab-cards').click();

    for (const id of ['2nd_40', '1st_100', '2nd_86']) {
      await page.getByTestId(`tutorial-card-selector-${id}`).click();
      await expectDecodedImages(page.getByTestId('tutorial-card-example'));
    }

    const picture = page.getByTestId('tutorial-card-example').locator('xpath=..');
    const sources = await picture.evaluate((element) => {
      const firstUrl = (srcset: string) => srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? '';
      const avif = element.querySelector<HTMLSourceElement>('source[type="image/avif"]');
      const webp = element.querySelector<HTMLSourceElement>('source[type="image/webp"]');
      const image = element.querySelector<HTMLImageElement>('img');
      return [firstUrl(avif?.srcset ?? ''), firstUrl(webp?.srcset ?? ''), image?.src ?? ''].filter(Boolean);
    });
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      const response = await page.request.get(source);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/^image\//);
      expect((await response.body()).byteLength).toBeGreaterThan(100);
      const decoded = await page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, source);
      expect(decoded.width).toBeGreaterThan(0);
      expect(decoded.height).toBeGreaterThan(0);
    }
  });

  test('能點擊下一步推進教學', async ({ page }) => {
    await startTutorialBattle(page);

    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });

    await expect(overlay).toHaveAttribute('data-tutorial-phase', 'janken');
    await expect(overlay).toHaveAttribute('data-tutorial-step', '1');
    await expect(overlay).toHaveAttribute('data-tutorial-total', '7');
    await expect(overlay).toHaveAttribute('data-tutorial-global-total', '25');
    await expect(page.locator('[data-tut="janken-rock"]').first()).toBeVisible();
  });

  test('手機與常見筆電高度都能看見標題、說明與固定操作提示', async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await startTutorialBattle(page);
      await expectTutorialPhase(page, 'janken');
      await expectTooltipContentUsable(page, true);
      await page.locator('[data-tut="janken-rock"]').first().click();
      await expectTutorialPhase(page, 'janken-result');
      await expectTooltipContentUsable(page, true);
      await page.locator('[data-tut="setup-feedback"]').first().getByRole('button').click();
      await expectTutorialPhase(page, 'opening-hand');
      await expectTooltipContentUsable(page, true);
    }
  });

  test('能關閉實戰教學並返回章節', async ({ page }) => {
    await startTutorialBattle(page);

    const overlay = page.locator('.tutorial-game-overlay, [role="dialog"]').first();
    await expect(overlay).toBeVisible({ timeout: 30_000 });

    // 點擊 "關閉" 按鈕（tutorial-tooltip-close）
    const closeButton = page.locator('.tutorial-tooltip-close').first();
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // 應彈出跳過確認對話框
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();

    // 點擊確認跳過
    await confirmDialog.getByRole('button', { name: '確認' }).click();

    // 應返回教學章節
    await expect(page).toHaveURL(/\/tutorial/);
    await expect(page.getByRole('heading', { name: '新手教學', exact: true })).toBeVisible();
  });

  test('直接進入對戰流程時先回顧準備狀態再開始第一回合結算', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tutorial');
    await page.getByTestId('tutorial-chapter-tab-flow').click();
    await page.getByRole('button', { name: '開始實戰教學', exact: true }).click();

    const overlay = await expectTutorialPhase(page, 'flow-recap');
    await expect(overlay).toHaveAttribute('data-tutorial-step', '1');
    await expect(overlay).toHaveAttribute('data-tutorial-total', '18');
    await expect(overlay).toContainText('雙方 HP 都是 100');
    await expect(overlay).toContainText('Chronos 從 0');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('01');
    await expect(page.locator('[data-tut="player-hp"][aria-label="玩家 · 生命 100/100"]')).toBeVisible();
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 100/100"]')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Chronos 時鐘 0/18 · 夜', exact: true })).toBeVisible();
    await expectTooltipContentUsable(page);
    await expect(page.getByRole('dialog', { name: '猜拳決定先後手' })).toHaveCount(0);

    await overlay.getByRole('button', { name: '下一頁' }).click();
    const clockOverlay = await expectTutorialPhase(page, 'clock-advance');
    await expect(clockOverlay).toHaveAttribute('data-tutorial-step', '2');
    await expect(clockOverlay).toContainText('2 + 1 = 3');
    await expect(clockOverlay).toContainText('從 0 推進到 3');
    await expect(page.locator('[data-tut="game-notice-panel"]').first()).toBeVisible();
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('01');
    await expect(page.locator('[data-tut="player-hp"][aria-label="玩家 · 生命 100/100"]')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Chronos 時鐘 3/18 · 夜', exact: true })).toBeVisible();
    await expectTooltipContentUsable(page, true);

    await clockOverlay.getByRole('button', { name: '上一頁', exact: true }).click();
    await expectTutorialPhase(page, 'flow-recap');
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    await expectTutorialPhase(page, 'clock-advance');
    await page.locator('[data-tut="game-notice-panel"]').first().getByRole('button', { name: '確認' }).click();

    const hpOverlay = await expectTutorialPhase(page, 'hp-calc');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('01');
    await expect(page.locator('[data-tut="player-hp"][aria-label="玩家 · 生命 80/100"]')).toBeVisible();
    await hpOverlay.getByRole('button', { name: '上一頁', exact: true }).click();
    await confirmTutorialRewind(page);
    const rebuiltFlow = await expectTutorialPhase(page, 'flow-recap');
    await expect(rebuiltFlow).toContainText('雙方 HP 都是 100');
    const completed = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('zutomayo_tutorial_chapters_v3') || '[]'),
    );
    expect(completed).not.toContain('preparation');
  });

  test('能從戰鬥準備完成整個固定劇本', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await startTutorialBattle(page);

    await expectTutorialPhase(page, 'janken');
    const blockedPaper = await page.locator('[data-tut="janken-paper"]').first().boundingBox();
    expect(blockedPaper).not.toBeNull();
    await page.mouse.click(blockedPaper!.x + blockedPaper!.width / 2, blockedPaper!.y + blockedPaper!.height / 2);
    await expectTutorialPhase(page, 'janken');
    await page.locator('[data-tut="janken-rock"]').first().click();

    await expectTutorialPhase(page, 'janken-result');
    await page.locator('[data-tut="setup-feedback"]').first().getByRole('button').click();

    await expectTutorialPhase(page, 'opening-hand');
    await expectTooltipContentUsable(page, true);
    await expect(page.locator('.tutorial-tooltip')).toContainText('0 < 7');
    await expect(page.locator('.tutorial-tooltip')).toContainText('攻擊力會視為 0');
    const blockedMulliganCard = await page.locator('[data-tut-mulligan-card="1st_70"]').first().boundingBox();
    expect(blockedMulliganCard).not.toBeNull();
    await page.mouse.click(
      blockedMulliganCard!.x + blockedMulliganCard!.width / 2,
      blockedMulliganCard!.y + blockedMulliganCard!.height / 2,
    );
    await expectTutorialPhase(page, 'opening-hand');
    await expect(page.locator('[data-tut-mulligan-card="1st_70"]').first()).toHaveAttribute(
      'data-tut-selected',
      'false',
    );
    await page.locator('[data-tut-mulligan-card="1st_2"]').first().getByRole('button').click();

    await expectTutorialPhase(page, 'mulligan-confirm');
    const blockedKeepHand = await page.locator('[data-tut="mulligan-keep"]').first().boundingBox();
    expect(blockedKeepHand).not.toBeNull();
    await page.mouse.click(
      blockedKeepHand!.x + blockedKeepHand!.width / 2,
      blockedKeepHand!.y + blockedKeepHand!.height / 2,
    );
    await expectTutorialPhase(page, 'mulligan-confirm');
    await page.locator('[data-tut="mulligan-redraw"]').first().click();

    await expectTutorialPhase(page, 'initialSet-select');
    const blockedInitialCard = await page.locator('[data-tut-card="1st_46"]').first().boundingBox();
    expect(blockedInitialCard).not.toBeNull();
    await page.mouse.click(
      blockedInitialCard!.x + blockedInitialCard!.width / 2,
      blockedInitialCard!.y + blockedInitialCard!.height / 2,
    );
    await expectTutorialPhase(page, 'initialSet-select');
    await expect(page.locator('[data-tut="set-selected-card"]')).toHaveCount(0);
    await page.locator('[data-tut-card="1st_70"]').first().click();

    await expectTutorialPhase(page, 'initialSet-place');
    await page.locator('[data-tut="set-selected-card"]').first().click();

    await expectTutorialPhase(page, 'initialSet-confirm');
    await page.locator('[data-tut="confirm-set"]').first().click();

    const preparationCompleteDialog = page.getByRole('dialog', { name: '戰鬥準備完成' });
    await expect(preparationCompleteDialog).toBeVisible();
    await expect(preparationCompleteDialog).toContainText('猜拳、起手牌重抽與初始放置');
    await preparationCompleteDialog.getByRole('button', { name: '返回教學進度', exact: true }).click();

    await expect(page.getByRole('heading', { name: '新手教學', exact: true })).toBeVisible();
    await expect(page.getByTestId('tutorial-chapter-tab-flow')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: '對戰流程', exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zutomayo_tutorial_chapters_v3') || '[]')))
      .toContain('preparation');

    const hiddenFlowOverlay = page.locator('.tutorial-game-overlay');
    await expect(hiddenFlowOverlay).toHaveAttribute('data-tutorial-phase', 'flow-recap', { timeout: 15_000 });
    await expect(hiddenFlowOverlay).toBeHidden();

    await page.getByTestId('tutorial-chapter-tab-flow').click();
    await page.getByRole('button', { name: '開始實戰教學', exact: true }).click();

    const flowOverlay = await expectTutorialPhase(page, 'flow-recap');
    await expect(flowOverlay).toHaveAttribute('data-tutorial-step', '1');
    await expect(flowOverlay).toHaveAttribute('data-tutorial-total', '18');
    await expect(flowOverlay).toContainText('雙方 HP 都是 100');
    await flowOverlay.getByRole('button', { name: '下一頁' }).click();

    const clockOverlay = await expectTutorialPhase(page, 'clock-advance');
    await expect(clockOverlay).toHaveAttribute('data-tutorial-step', '2');
    await expect(clockOverlay).toContainText('2 + 1 = 3');
    await expect(clockOverlay).toContainText('從 0 推進到 3');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="game-notice-panel"]').first().getByRole('button', { name: '確認' }).click();

    await expectTutorialPhase(page, 'hp-calc');
    await expect(page.locator('.tutorial-tooltip')).toContainText('50 - 30 = 20');
    await expect(page.locator('.tutorial-tooltip')).toContainText('100 - 20 = 80');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="game-notice-panel"]').first().getByRole('button', { name: '確認' }).click();

    await expectTutorialPhase(page, 'turn-end-draw-t1');
    await expectSingleContextHighlight(page);
    await page.getByRole('button', { name: '下一頁' }).click();

    await expectTutorialPhase(page, 'turnSet-character-select');
    await expectSingleActionHighlight(page);
    const blockedTurnCard = await page.locator('[data-tut-card="1st_66"]').first().boundingBox();
    expect(blockedTurnCard).not.toBeNull();
    await page.mouse.click(
      blockedTurnCard!.x + blockedTurnCard!.width / 2,
      blockedTurnCard!.y + blockedTurnCard!.height / 2,
    );
    await expectTutorialPhase(page, 'turnSet-character-select');
    await page.locator('[data-tut-card="1st_46"]').first().click();

    await expectTutorialPhase(page, 'turnSet-character-place');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="set-selected-card"]').first().click();

    await expectTutorialPhase(page, 'turnSet-area-select');
    await expectSingleActionHighlight(page);
    await page.getByRole('button', { name: '上一頁', exact: true }).click();
    await confirmTutorialRewind(page);

    await expectTutorialPhase(page, 'turnSet-character-select');
    await expect(page.locator('[data-tut="player-hp"][aria-label="玩家 · 生命 80/100"]')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Chronos 時鐘 3/18 · 夜', exact: true })).toBeVisible();
    await expect(page.locator('[data-tut="confirm-set"]').first()).toBeDisabled();
    await page.locator('[data-tut-card="1st_46"]').first().click();

    await expectTutorialPhase(page, 'turnSet-character-place');
    await page.locator('[data-tut="set-selected-card"]').first().click();

    await expectTutorialPhase(page, 'turnSet-area-select');
    await expectSingleActionHighlight(page);
    await expect(page.locator('[data-tut="confirm-set"]').first()).toBeDisabled();
    const blockedAreaCard = await page.locator('[data-tut-card="1st_66"]').first().boundingBox();
    expect(blockedAreaCard).not.toBeNull();
    await page.mouse.click(
      blockedAreaCard!.x + blockedAreaCard!.width / 2,
      blockedAreaCard!.y + blockedAreaCard!.height / 2,
    );
    await expectTutorialPhase(page, 'turnSet-area-select');
    await page.locator('[data-tut-card="2nd_98"]').first().click();

    await expectTutorialPhase(page, 'turnSet-area-place');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="set-selected-card"]').first().click();

    await expectTutorialPhase(page, 'turnSet-confirm');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="confirm-set"]').first().click();

    await expectTutorialPhase(page, 'reveal-clock');
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="game-notice-panel"]').first().getByRole('button', { name: '確認' }).click();

    await expectTutorialPhase(page, 'character-replacement');
    await expectSingleContextHighlight(page);
    await expect(page.locator('.effect-order-panel')).toHaveCount(0);
    await page.getByRole('button', { name: '下一頁' }).click();

    await expectTutorialPhase(page, 'power-charging');
    await expectSingleContextHighlight(page);
    await expect(page.locator('.effect-order-panel')).toHaveCount(0);
    await page.getByRole('button', { name: '下一頁' }).click();

    await expectTutorialPhase(page, 'area-enchant');
    await expectSingleContextHighlight(page);
    await expect(page.locator('.effect-order-panel')).toHaveCount(0);
    await page.getByRole('button', { name: '下一頁' }).click();

    await expectTutorialPhase(page, 'effectOrder-action');
    await expectSingleActionHighlight(page);
    await expect(page.locator('.effect-order-panel:visible')).toHaveCount(1);
    await page.locator('[data-tut-effect-card="2nd_98"]').first().click();

    await expectTutorialPhase(page, 'choice-mechanics');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('02');
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 100/100"]')).toBeVisible();
    await page.getByRole('button', { name: '上一頁', exact: true }).click();
    await confirmTutorialRewind(page);

    await expectTutorialPhase(page, 'effectOrder-action');
    await expect(page.locator('[data-tut="player-hp"][aria-label="玩家 · 生命 80/100"]')).toBeVisible();
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 100/100"]')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Chronos 時鐘 10/18 · 晝', exact: true })).toBeVisible();
    await expect(page.locator('.effect-order-panel:visible')).toHaveCount(1);
    await page.locator('[data-tut-effect-card="2nd_98"]').first().click();

    await expectTutorialPhase(page, 'choice-mechanics');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('02');
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 100/100"]')).toBeVisible();
    await page.getByRole('button', { name: '下一頁' }).click();

    await expectTutorialPhase(page, 'hp-calc');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('02');
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 30/100"]')).toBeVisible();
    await expectSingleActionHighlight(page);
    await page.locator('[data-tut="game-notice-panel"]').first().getByRole('button', { name: '確認' }).click();

    await expectTutorialPhase(page, 'turn-end-cleanup');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('02');
    await expectSingleContextHighlight(page);
    await expect(page.locator('[data-tut="opponent-hp"][aria-label="電腦 · 生命 30/100"]')).toBeVisible();
    await page.getByRole('button', { name: '下一頁' }).click();

    let completeOverlay = await expectTutorialPhase(page, 'complete');
    await completeOverlay.getByRole('button', { name: '上一頁', exact: true }).click();
    await expectTutorialPhase(page, 'turn-end-cleanup');
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    completeOverlay = await expectTutorialPhase(page, 'complete');
    await expect(page.locator('.bf-root:visible .bf-hud-turn-value')).toHaveText('03');
    await expectTooltipContentUsable(page);
    await expect(completeOverlay.getByRole('button', { name: '返回教學', exact: true })).toBeVisible();
    const continueBattle = completeOverlay.getByRole('button', { name: '繼續完成教學關卡', exact: true });
    await expect(continueBattle).toBeVisible();
    await continueBattle.click();

    await expect(page.locator('.tutorial-game-overlay')).toHaveCount(0);
    await expect(page.locator('[data-tut="player-hand"] button').first()).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zutomayo_tutorial_chapters_v3') || '[]')))
      .toContain('flow');

    await page.goto('/tutorial');
    await expect(page.getByText('2 / 5', { exact: true })).toBeVisible();
  });
});
