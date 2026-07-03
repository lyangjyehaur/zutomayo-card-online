import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const outDir = process.env.OUT_DIR ?? '/private/tmp/zutomayo-admin-responsive-screenshots';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-admin-responsive-report.json';
const port = Number(process.env.CDP_PORT ?? 9899);
const profileDir = `/private/tmp/zutomayo-admin-responsive-profile-${process.pid}-${Date.now()}`;

const cases = [
  { name: 'admin-360x740', width: 360, height: 740 },
  { name: 'admin-360x740-open-filters', width: 360, height: 740, openFilters: true },
  { name: 'admin-390x844', width: 390, height: 844 },
  { name: 'admin-768x1024', width: 768, height: 1024 },
  { name: 'admin-1024x768', width: 1024, height: 768 },
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
  return result;
}

async function waitForSelector(client, selector, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await evalChecked(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (result.result.value) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const debug = await evalChecked(
    client,
    `({ href: location.href, text: document.body?.innerText?.slice(0, 700) ?? '' })`,
  );
  throw new Error(`Timed out waiting for selector: ${selector}\n${JSON.stringify(debug.result.value, null, 2)}`);
}

const setupAuth = `
(() => {
  sessionStorage.setItem('zutomayo_admin_token', 'responsive-smoke-admin');
})()
`;

const pageMetrics = `
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
  const buttons = visible('button, a[href], [role="button"]');
  return {
    viewport: { width: innerWidth, height: innerHeight },
    doc: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    },
    header: visible('.admin-header'),
    tabs: visible('.admin-tablist'),
    summary: visible('.admin-mobile-filter-summary'),
    advanced: visible('.admin-filter-advanced'),
    filterRows: visible('.admin-filter-row'),
    cards: visible('.admin-card-grid > button').slice(0, 10),
    smallTargets: buttons.filter((item) => item.width < 40 || item.height < 40),
    offscreen: [...document.body.querySelectorAll('*')]
      .filter((el) => !el.closest('.admin-filter-row, .admin-tablist, .admin-card-modal-tabs'))
      .map(box)
      .filter((item) => item.visible && item.offscreenX)
      .slice(0, 20),
  };
})()
`;

function failuresFor(testCase, metrics) {
  const failures = [];
  if (metrics.doc.overflowX) failures.push('document overflowX');
  if (!metrics.cards.length) failures.push('no visible admin cards');
  if (metrics.offscreen.length) failures.push(`offscreenX: ${metrics.offscreen.map((item) => item.text).join(', ')}`);
  if (testCase.width <= 768 && !metrics.summary.length) failures.push('missing mobile filter summary');
  if (testCase.openFilters && !metrics.advanced.length) failures.push('opened filters are not visible');
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
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: setupAuth });

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
    await waitForSelector(client, 'main');
    await new Promise((resolve) => setTimeout(resolve, 3200));
    await evalChecked(
      client,
      `history.pushState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));`,
    );
    await waitForSelector(client, '.admin-card-grid');
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (testCase.openFilters) {
      await evalChecked(client, `document.querySelector('.admin-mobile-filter-summary button')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const metricsResult = await evalChecked(client, pageMetrics);
    const metrics = metricsResult.result.value;
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
