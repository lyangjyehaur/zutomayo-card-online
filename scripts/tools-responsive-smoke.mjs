import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const outDir = process.env.OUT_DIR ?? '/private/tmp/zutomayo-tools-responsive-screenshots';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-tools-responsive-report.json';
const port = Number(process.env.CDP_PORT ?? 9911);
const profileDir = `/private/tmp/zutomayo-tools-responsive-profile-${process.pid}-${Date.now()}`;

const cases = [
  { name: 'feedback-360x740', path: '/feedback', width: 360, height: 740, waitFor: '.feedback-toolbar' },
  { name: 'feedback-768x1024', path: '/feedback', width: 768, height: 1024, waitFor: '.feedback-toolbar' },
  { name: 'leaderboard-390x844', path: '/leaderboard', width: 390, height: 844, text: 'Visual QA Leader' },
  { name: 'leaderboard-1024x768', path: '/leaderboard', width: 1024, height: 768, text: 'Visual QA Leader' },
  { name: 'history-390x844', path: '/history', width: 390, height: 844, waitFor: 'article' },
  { name: 'i18n-390x844', path: '/admin/i18n', width: 390, height: 844, waitFor: '.i18n-responsive-table' },
];

await fs.mkdir(outDir, { recursive: true });

let chromeStderr = '';
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

chrome.stderr.on('data', (chunk) => {
  chromeStderr += chunk.toString();
});

function getJson(path) {
  return new Promise((resolve, reject) => {
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
  });
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
  return new Promise((resolve, reject) => {
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
  });
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

async function waitForCondition(client, testCase, timeoutMs = 12000) {
  const started = Date.now();
  const expression = testCase.waitFor
    ? `Boolean(document.querySelector(${JSON.stringify(testCase.waitFor)}))`
    : `document.body?.innerText?.includes(${JSON.stringify(testCase.text)})`;
  while (Date.now() - started < timeoutMs) {
    if (await evalChecked(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const debug = await evalChecked(
    client,
    `({ href: location.href, text: document.body?.innerText?.slice(0, 700) ?? '' })`,
  );
  throw new Error(`Timed out waiting for ${testCase.waitFor ?? testCase.text}\n${JSON.stringify(debug, null, 2)}`);
}

const setup = `
(() => {
  sessionStorage.setItem('zutomayo_admin_token', 'tools-responsive-admin');
  localStorage.setItem('zutomayo_match_records', JSON.stringify([
    {
      id: 'visual_qa_history_001',
      date: '2026-07-03T01:23:45.000Z',
      duration: 731,
      winner: 0,
      players: [
        { hp: 7, deckSize: 24, cardsPlayed: 5 },
        { hp: 0, deckSize: 19, cardsPlayed: 8 }
      ],
      chronos: { nightSidePlayer: 1, finalPosition: 8 },
      turns: 12,
      log: ['Visual QA history record'],
      actionLog: [
        {
          id: 1,
          timestamp: 1000,
          turn: 1,
          player: 0,
          action: 'setup',
          step: 'visual-smoke',
          payload: { card: 'QA' },
          result: { ok: true, message: 'Visual QA action' }
        }
      ]
    }
  ]));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/feedback/posts')) {
      return new Response(JSON.stringify({
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
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/feedback/stats')) {
      return new Response(JSON.stringify({
        open: '1',
        planned: '1',
        started: '0',
        completed: '0',
        declined: '0',
        duplicate: '0',
        total: '2',
        total_votes: '12'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/feedback/tags')) {
      return new Response(JSON.stringify({
        tags: [
          { id: 'tag_ui', name: 'ui', color: '#d9a93d', createdAt: '2026-07-03T00:00:00.000Z' },
          { id: 'tag_mobile', name: 'mobile', color: '#2ec4b6', createdAt: '2026-07-03T00:00:00.000Z' }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/leaderboard')) {
      return new Response(JSON.stringify({
        leaderboard: [
          { id: 'leader_visual_qa', nickname: 'Visual QA Leader', elo: 1688, matchCount: 44, wins: 31, winRate: 70 },
          { id: 'leader_mobile_qa', nickname: 'Mobile Layout QA', elo: 1412, matchCount: 16, wins: 8, winRate: 50 }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/profile')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
})()
`;

const metricsExpression = `
(() => {
  const isVisible = (el) => {
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
  const targetElements = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
    .filter((el) => {
      const type = el.getAttribute('type');
      return type !== 'checkbox' && type !== 'radio';
    });
  const targets = targetElements.filter(isVisible).map(box);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    doc: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    },
    shell: visible('main').slice(0, 1),
    toolbar: visible('.feedback-toolbar, .responsive-data-list, .i18n-responsive-table, article').slice(0, 8),
    smallTargets: targets.filter((item) => item.width < 44 || item.height < 44).slice(0, 12),
    offscreen: [...document.body.querySelectorAll('*')]
      .filter(isVisible)
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
  if (!metrics.toolbar.length) failures.push('missing checked surface');
  if (metrics.offscreen.length) failures.push(`offscreenX: ${metrics.offscreen.map((item) => item.text).join(', ')}`);
  if (testCase.width <= 768 && metrics.smallTargets.length) {
    failures.push(
      `small touch targets: ${metrics.smallTargets
        .map((item) => item.text || `${item.width}x${item.height}`)
        .slice(0, 8)
        .join(', ')}`,
    );
  }
  return [...new Set(failures)];
}

let exitCode = 0;

try {
  await waitForCdp();
  const tabs = await getJson('/json/list');
  const pageTab = tabs.find((tab) => tab.type === 'page' && !tab.url?.startsWith('chrome-extension://')) ?? tabs[0];
  const client = await connect(pageTab.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: setup });

  const results = [];
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
    await client.send('Page.navigate', { url: `${baseUrl}/` });
    await waitForCondition(client, { waitFor: 'main' });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await evalChecked(
      client,
      `history.pushState({}, '', ${JSON.stringify(testCase.path)}); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));`,
    );
    await waitForCondition(client, testCase);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const metrics = await evalChecked(client, metricsExpression);
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotPath = `${outDir}/${testCase.name}.png`;
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    const failures = failuresFor(testCase, metrics);
    if (failures.length) exitCode = 1;
    results.push({ ...testCase, screenshot: screenshotPath, metrics, failures });
  }

  client.close();
  await fs.writeFile(reportPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(reportPath);
  for (const result of results) {
    console.log(
      `${result.failures.length ? 'FAIL' : 'PASS'} ${result.name}${result.failures.length ? `: ${result.failures.join('; ')}` : ''}`,
    );
  }
} finally {
  chrome.kill('SIGTERM');
}

process.exit(exitCode);
