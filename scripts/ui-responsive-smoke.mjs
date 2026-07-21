import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const outDir = process.env.OUT_DIR ?? '/private/tmp/zutomayo-ui-responsive-screenshots';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-ui-responsive-report.json';
const port = Number(process.env.CDP_PORT ?? 9947);
const profileDir = `/private/tmp/zutomayo-ui-responsive-profile-${process.pid}-${Date.now()}`;
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof packageJson.version !== 'string' || !packageJson.version) {
  throw new Error('package.json version is required');
}
const smokeVersion = packageJson.version;

const viewports = [
  { viewportId: '1920x1080', width: 1920, height: 1080 },
  { viewportId: '1536x864', width: 1536, height: 864 },
  { viewportId: '1366x768', width: 1366, height: 768 },
  { viewportId: '1280x720', width: 1280, height: 720 },
  { viewportId: '1180x820', width: 1180, height: 820 },
  { viewportId: '1024x768', width: 1024, height: 768 },
  { viewportId: '820x1180', width: 820, height: 1180 },
  { viewportId: '768x1024', width: 768, height: 1024 },
  { viewportId: '430x932', width: 430, height: 932 },
  { viewportId: '390x844', width: 390, height: 844 },
  { viewportId: '375x812', width: 375, height: 812 },
  { viewportId: '360x740', width: 360, height: 740 },
];

const pages = [
  { pageId: 'landing', path: '/', waitFor: 'nav[aria-label] button' },
  { pageId: 'ai-lobby', path: '/ai', waitForText: '與電腦對戰' },
  { pageId: 'online-lobby', path: '/online', waitForText: '線上房間' },
  { pageId: 'tutorial', path: '/tutorial', waitForText: '新手教學' },
  { pageId: 'community', path: '/community', waitForText: '登入後進入社群' },
  { pageId: 'profile', path: '/profile', waitForText: '需要先登入' },
  { pageId: 'history', path: '/history', waitForText: '對戰紀錄' },
  { pageId: 'deck-builder', path: '/deck-builder', waitForText: '牌組' },
  { pageId: 'deck-shares', path: '/deck-shares', waitForText: '分享大廳' },
  { pageId: 'official-qa', path: '/rules/qa', waitForText: '官方規則 Q&A' },
  { pageId: 'official-errata', path: '/rules/errata', waitForText: '官方卡牌勘誤' },
  { pageId: 'battle-turn-set', path: '/qa/battle?state=turn-set&controls=0', waitFor: '.bf-root' },
  { pageId: 'feedback', path: '/feedback', waitFor: '.feedback-toolbar' },
  { pageId: 'legal-privacy', path: '/legal/privacy', waitForText: '隱私政策' },
];

const cases = pages.flatMap((page) =>
  viewports.map((viewport) => ({
    name: `${page.pageId}-${viewport.viewportId}`,
    ...page,
    ...viewport,
  })),
);

await fs.mkdir(outDir, { recursive: true });

let chromeStderr = '';
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

chrome.stderr.on('data', (chunk) => {
  chromeStderr += chunk.toString();
});

function timeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms));
}

function getJson(path) {
  return Promise.race([
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(error);
            }
          });
        })
        .on('error', reject);
    }),
    timeout(2000, `GET ${path}`),
  ]);
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      await getJson('/json/version');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Chrome DevTools did not start\n${chromeStderr}`);
}

let nextId = 1;
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve({
          send(method, params = {}, timeoutMs = 10000) {
            const id = nextId++;
            socket.send(JSON.stringify({ id, method, params }));
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
              }, timeoutMs);
              pending.set(id, { resolve, reject, timer });
            });
          },
          close() {
            socket.close();
          },
        });
      });
      socket.addEventListener('error', reject);
    }),
    timeout(3000, 'websocket open'),
  ]);
}

async function evalChecked(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluate failed',
    );
  }
  return result.result.value;
}

function isTransientNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Inspected target navigated or closed') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id')
  );
}

async function navigateTo(client, url) {
  try {
    await client.send('Page.navigate', { url });
  } catch (error) {
    if (!isTransientNavigationError(error)) throw error;
  }
}

async function reloadPage(client) {
  try {
    await client.send('Page.reload', { ignoreCache: true });
  } catch (error) {
    if (!isTransientNavigationError(error)) throw error;
  }
}

const setup = `
(() => {
  const smokeVersion = ${JSON.stringify(smokeVersion)};
  localStorage.setItem('zutomayo_deck_intro_seen', 'true');
  localStorage.removeItem('zutomayo_online_session');
  localStorage.removeItem('zutomayo_token');
  sessionStorage.setItem('zutomayo_admin_token', 'ui-responsive-admin');
  sessionStorage.setItem('zutomayo_anonymous_name_prompt_seen', 'true');
  sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
  localStorage.setItem('zutomayo_match_records', JSON.stringify([
    {
      id: 'ui_responsive_history_001',
      date: '2026-07-03T01:23:45.000Z',
      duration: 731,
      winner: 0,
      players: [
        { hp: 7, deckSize: 24, cardsPlayed: 5 },
        { hp: 0, deckSize: 19, cardsPlayed: 8 }
      ],
      chronos: { nightSidePlayer: 1, finalPosition: 8 },
      turns: 12,
      log: ['UI responsive history record'],
      actionLog: [
        {
          id: 1,
          timestamp: 1000,
          turn: 1,
          player: 0,
          action: 'setup',
          step: 'ui-responsive',
          payload: { card: 'QA' },
          result: { ok: true, message: 'Responsive QA action' }
        }
      ]
    }
  ]));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/profile')) return json({ error: 'unauthorized' }, 401);
    if (url.includes('/api/decks')) return json({ decks: [] });
    if (url.includes('/api/preset-decks')) return json([]);
    if (url.includes('/api/presence')) return json({ onlineCount: 7, activeWindowSeconds: 90 });
    if (url.includes('/api/config')) return json({ deck_sharing_enabled: true });
    if (url.includes('/api/cards/texts')) return json({});
    if (url.includes('/api/app-version')) {
      return json({ appVersion: smokeVersion, buildId: smokeVersion, rulesVersion: smokeVersion });
    }
    if (url.includes('/api/feedback/posts')) {
      return json({
        posts: [
          {
            id: 'feedback_visual_qa_001',
            title: 'Feedback visual QA toolbar wraps correctly',
            description: 'Long feedback body used by responsive smoke.',
            status: 'open',
            tag: 'ui',
            authorUserId: null,
            authorNickname: 'Visual QA',
            anonymousId: 'anon_visual_qa',
            voteCount: 12,
            commentCount: 2,
            hasVoted: false,
            createdAt: '2026-07-03T00:00:00.000Z',
            updatedAt: '2026-07-03T00:00:00.000Z',
            editedAt: null,
            originalPostId: null,
            originalPostTitle: null,
            originalPostStatus: null
          }
        ]
      });
    }
    if (url.includes('/api/feedback/stats')) {
      return json({ open: '1', planned: '1', started: '0', completed: '0', declined: '0', duplicate: '0', total: '2', total_votes: '12' });
    }
    if (url.includes('/api/feedback/tags')) {
      return json({ tags: [
        { id: 'tag_ui', name: 'ui', color: '#d9a93d', createdAt: '2026-07-03T00:00:00.000Z' },
        { id: 'tag_mobile', name: 'mobile', color: '#2ec4b6', createdAt: '2026-07-03T00:00:00.000Z' }
      ] });
    }
    if (url.includes('/api/leaderboard')) {
      return json({ leaderboard: [
        { id: 'leader_visual_qa', nickname: 'Visual QA Leader', elo: 1688, matchCount: 44, wins: 31, winRate: 70 },
        { id: 'leader_mobile_qa', nickname: 'Mobile Layout QA', elo: 1412, matchCount: 16, wins: 8, winRate: 50 }
      ] });
    }
    if (url.includes('/api/admin/users')) {
      return json({ users: [
        {
          id: 'user_very_long_identifier_0000000000001',
          email: 'very.long.admin.visual.qa.user@example-card-online.test',
          nickname: '觸控測試管理者',
          elo: 1532,
          matchCount: 128,
          wins: 73,
          winRate: 57,
          createdAt: '2026-07-03T00:00:00.000Z'
        }
      ] });
    }
    if (url.includes('/api/admin/matches')) {
      return json({ matches: [
        {
          id: 'match_extremely_long_identifier_for_responsive_table_0001',
          winnerId: 'winner_long_id',
          winnerNickname: '勝者暱稱很長但應該換行',
          loserId: 'loser_long_id',
          loserNickname: '敗者暱稱',
          winnerEloChange: 24,
          loserEloChange: -24,
          turns: 12,
          duration: 731,
          createdAt: '2026-07-03T01:23:45.000Z'
        }
      ] });
    }
    if (url.includes('/games/zutomayo-card/create')) return json({ matchID: 'ui-responsive-room' });
    if (url.includes('/games/zutomayo-card/ui-responsive-room/join')) return json({ playerCredentials: 'ui-responsive-credentials' });
    return originalFetch(input, init);
  };
})()
`;

async function waitForPage(client, testCase, timeoutMs = 16000) {
  const expectedUrl = new URL(testCase.path, baseUrl);
  const expectedPath = `${expectedUrl.pathname}${expectedUrl.search}`;
  const contentExpression = testCase.waitFor
    ? `Boolean(document.querySelector(${JSON.stringify(testCase.waitFor)}))`
    : `document.body?.innerText?.includes(${JSON.stringify(testCase.waitForText)})`;
  const expression = `location.pathname + location.search === ${JSON.stringify(expectedPath)} && (${contentExpression})`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evalChecked(client, expression)) return;
    } catch (error) {
      if (!isTransientNavigationError(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const debug = await evalChecked(
    client,
    `({ href: location.href, text: document.body?.innerText?.slice(0, 1000) ?? '' })`,
  );
  throw new Error(
    `Timed out waiting for ${testCase.waitFor ?? testCase.waitForText}\n${JSON.stringify(debug, null, 2)}`,
  );
}

const metricsExpression = `
(() => {
  const isVisible = (el) => {
    if (el.closest('[aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 90),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      visible: isVisible(el),
      overflowX: el.scrollWidth > el.clientWidth + 1,
      offscreenX: rect.left < -1 || rect.right > innerWidth + 1,
    };
  };
  const visible = (selector) => [...document.querySelectorAll(selector)].filter(isVisible).map(box);
  const hasHorizontalScrollAncestor = (element) => {
    let current = element.parentElement;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      if (
        current.scrollWidth > current.clientWidth + 1 &&
        (style.overflowX === 'auto' || style.overflowX === 'scroll')
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const targets = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
    .filter((el) => {
      const type = el.getAttribute('type');
      return type !== 'checkbox' && type !== 'radio';
    })
    .filter(isVisible)
    .map(box);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    doc: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    },
    shell: visible('[data-page-shell], main, .app-shell, .bf-root').slice(0, 3),
    checkedSurface: visible(
      'nav[aria-label] button, .bf-main, .feedback-toolbar, .admin-page, .i18n-responsive-table, .deck-editor, .card-browser, [data-room-panel], [data-chat-surface], [data-ui-panel], [aria-label="Card Pool"], main > section, article',
    ).slice(0, 8),
    smallTargets: targets.filter((item) => item.width < 44 || item.height < 44).slice(0, 12),
    offscreen: [...document.body.querySelectorAll('*')]
      .filter(isVisible)
      .filter((element) => !hasHorizontalScrollAncestor(element))
      .map(box)
      .filter((item) => item.offscreenX)
      .slice(0, 20),
  };
})()
`;

function failuresFor(testCase, metrics) {
  const failures = [];
  if (metrics.doc.overflowX) failures.push('document overflowX');
  if (!metrics.shell.length) failures.push('missing page shell');
  if (!metrics.checkedSurface.length && testCase.pageId !== 'ai-lobby' && testCase.pageId !== 'online-lobby') {
    failures.push('missing checked surface');
  }
  if (metrics.offscreen.length)
    failures.push(
      `offscreenX: ${metrics.offscreen.map((item) => item.text || `${item.width}x${item.height}`).join(', ')}`,
    );
  if (testCase.width <= 820 && metrics.smallTargets.length) {
    failures.push(
      `small touch targets: ${metrics.smallTargets
        .map((item) => item.text || `${item.width}x${item.height}`)
        .slice(0, 8)
        .join(', ')}`,
    );
  }
  return [...new Set(failures)];
}

let client;
const results = [];
try {
  await waitForCdp();
  const tabs = await getJson('/json/list');
  const tab =
    tabs.find((item) => item.type === 'page' && item.url === 'about:blank') ??
    tabs.find((item) => item.type === 'page');
  if (!tab) throw new Error(`No debuggable page target\n${JSON.stringify(tabs, null, 2)}`);
  client = await connect(tab.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: setup });

  for (const testCase of cases) {
    console.log(`case ${testCase.name}`);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: testCase.width,
      height: testCase.height,
      deviceScaleFactor: 1,
      mobile: testCase.width <= 768,
      screenWidth: testCase.width,
      screenHeight: testCase.height,
    });
    await navigateTo(client, `${baseUrl}${testCase.path}`);
    await waitForPage(client, testCase);
    await new Promise((resolve) => setTimeout(resolve, 300));
    let metrics = await evalChecked(client, metricsExpression);
    let failures = failuresFor(testCase, metrics);
    const requiresCheckedSurface = testCase.pageId !== 'ai-lobby' && testCase.pageId !== 'online-lobby';
    for (
      let attempt = 0;
      attempt < 2 && (!metrics.shell.length || (requiresCheckedSurface && !metrics.checkedSurface.length));
      attempt += 1
    ) {
      await reloadPage(client);
      await waitForPage(client, testCase);
      await new Promise((resolve) => setTimeout(resolve, 500));
      metrics = await evalChecked(client, metricsExpression);
      failures = failuresFor(testCase, metrics);
    }
    const screenshot = `${outDir}/${testCase.name}.png`;
    if (failures.length) {
      const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
    }
    results.push({
      name: testCase.name,
      path: testCase.path,
      width: testCase.width,
      height: testCase.height,
      screenshot: failures.length ? screenshot : null,
      metrics,
      failures,
    });
  }
} finally {
  if (client) client.close();
  chrome.kill('SIGTERM');
}

await fs.writeFile(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
console.log(reportPath);
for (const result of results) {
  if (result.failures.length) console.error(`FAIL ${result.name}: ${result.failures.join('; ')}`);
  else console.log(`PASS ${result.name}`);
}
const failed = results.filter((result) => result.failures.length);
if (failed.length) process.exit(1);
