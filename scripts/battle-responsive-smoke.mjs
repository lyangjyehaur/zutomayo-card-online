import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const outDir = process.env.OUT_DIR ?? '/private/tmp/zutomayo-battle-responsive-screenshots';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-battle-responsive-report.json';
const port = Number(process.env.CDP_PORT ?? 9666);
const profileDir = `/private/tmp/zutomayo-battle-responsive-profile-${process.pid}-${Date.now()}`;

const cases = [
  { name: '1920x1080__turn-set', width: 1920, height: 1080, state: 'turn-set' },
  { name: '1366x768__turn-set', width: 1366, height: 768, state: 'turn-set' },
  { name: '1280x720__turn-set', width: 1280, height: 720, state: 'turn-set' },
  { name: '1024x768__turn-set', width: 1024, height: 768, state: 'turn-set' },
  { name: '768x1024__turn-set', width: 768, height: 1024, state: 'turn-set' },
  { name: '1366x768__turn-set__me-day', width: 1366, height: 768, state: 'turn-set', side: 'day' },
  { name: '390x844__turn-set__me-day', width: 390, height: 844, state: 'turn-set', side: 'day' },
  { name: '932x430__turn-set', width: 932, height: 430, state: 'turn-set' },
  { name: '844x390__turn-set', width: 844, height: 390, state: 'turn-set' },
  { name: '430x932__turn-set', width: 430, height: 932, state: 'turn-set' },
  { name: '390x844__turn-set', width: 390, height: 844, state: 'turn-set' },
  {
    name: '390x844__turn-set__reduced-motion',
    width: 390,
    height: 844,
    state: 'turn-set',
    reducedMotion: true,
  },
  { name: '360x740__turn-set', width: 360, height: 740, state: 'turn-set' },
  { name: '360x740__mulligan', width: 360, height: 740, state: 'mulligan' },
  { name: '360x740__effect-order', width: 360, height: 740, state: 'effect-order' },
  { name: '360x740__pending-choice', width: 360, height: 740, state: 'pending-choice' },
  { name: '360x740__game-over', width: 360, height: 740, state: 'game-over' },
  {
    name: '360x740__focus-sheet',
    width: 360,
    height: 740,
    state: 'turn-set',
    click: '.battle-side-panel-actions button:first-child',
  },
  {
    name: '1024x768__log-sheet',
    width: 1024,
    height: 768,
    state: 'turn-set',
    click: '.battle-side-panel-actions button:last-child',
  },
];

await fs.mkdir(outDir, { recursive: true });

let chromeStderr = '';
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
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

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve({
          send(method, params = {}, ms = 10000) {
            const id = nextId++;
            socket.send(JSON.stringify({ id, method, params }));
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timeout: ${method}`));
              }, ms);
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

const expression = `
(() => {
  const selectors = {
    board: '.bf-root',
    content: '.bf-main',
    field: '.bf-field',
    playerArea: '.bf-player',
    stage: '.bf-stage',
    hand: '.handzone',
    action: '.actiondock',
    actionButtons: '.actiondock button',
    pause: '.board-pause-button',
    sideActions: '.battle-side-panel-actions button',
    sideSheet: '.battle-side-sheet',
    effectPanel: '.effect-order-panel',
    effectItems: '.effect-order-item',
    pendingFooter: '.pending-choice-footer',
    mulliganPanel: '[data-tut="mulligan-panel"]',
    mulliganTitle: '[data-tut="mulligan-panel"] h2',
    mulliganHand: '.mulligan-hand',
    mulliganActions: '.mulligan-actions',
    mulliganActionButtons: '.mulligan-actions button',
    gameOverActions: '.game-over-panel button',
  };
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    return {
      text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      className: typeof el.className === 'string' ? el.className : '',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowX: el.scrollWidth > el.clientWidth + 1,
      overflowY: el.scrollHeight > el.clientHeight + 1,
      offscreenX: rect.left < -1 || rect.right > innerWidth + 1,
      offscreenY: rect.top < -1 || rect.bottom > innerHeight + 1,
      display: computed.display,
      computedWidth: computed.width,
      computedMinWidth: computed.minWidth,
      computedMaxWidth: computed.maxWidth,
      computedFlex: computed.flex,
      touchTargetToken: computed.getPropertyValue('--touch-target-min'),
    };
  };
  const boxes = Object.fromEntries(
    Object.entries(selectors).map(([key, selector]) => [key, [...document.querySelectorAll(selector)].map(box)]),
  );
  const touchTargets = [...document.querySelectorAll('button, [role="button"], a[href]')]
    .map(box)
    .filter((item) => item.width > 0 && item.height > 0 && (item.width < 44 || item.height < 44));
  return {
    viewport: { width: innerWidth, height: innerHeight },
    doc: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1 || document.body.scrollHeight > innerHeight + 1,
    },
    boxes,
    touchTargets: touchTargets.slice(0, 20),
    reducedMotionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    motion: {
      animationTargets: [...document.querySelectorAll('.cardview[data-state="playable"], .bf-hud-timer[data-urgent="true"]')].map(
        (el) => {
          const style = getComputedStyle(el);
          return { className: el.className, animationName: style.animationName, animationDuration: style.animationDuration };
        },
      ),
      transitionTargets: [...document.querySelectorAll('.cardview, .cardslot, .playerstatus-bar-fill')].map((el) => {
        const style = getComputedStyle(el);
        return { className: el.className, transitionDuration: style.transitionDuration };
      }),
    },
  };
})()
`;

function failuresFor(testCase, metrics) {
  const failures = [];
  if (metrics.doc.overflowX) failures.push('document overflowX');
  const requiredKeys = ['board', 'content'];
  if (testCase.state === 'turn-set') requiredKeys.push('field', 'playerArea', 'stage', 'hand', 'action');
  if (testCase.state === 'mulligan') requiredKeys.push('mulliganPanel', 'mulliganHand', 'mulliganActions');
  if (testCase.state === 'effect-order' || testCase.state === 'pending-choice') requiredKeys.push('effectPanel');
  if (testCase.click) requiredKeys.push('sideSheet');
  for (const key of requiredKeys) {
    for (const item of metrics.boxes[key] ?? []) {
      if (item.offscreenX) failures.push(`${key} offscreenX`);
      if (item.offscreenY && key !== 'content') failures.push(`${key} offscreenY`);
    }
  }
  if (testCase.width <= 820) {
    const badTargets = metrics.touchTargets.filter((item) => item.height < 44 || item.width < 44);
    if (badTargets.length) {
      failures.push(
        `small touch targets: ${badTargets.map((item) => item.text || `${item.width}x${item.height}`).join(', ')}`,
      );
    }
  }
  if (testCase.reducedMotion) {
    if (!metrics.reducedMotionMatches) failures.push('reduced-motion media query not active');
    if (!metrics.motion.animationTargets.length) failures.push('missing reduced-motion animation target');
    if (metrics.motion.animationTargets.some((item) => item.animationName !== 'none')) {
      failures.push('animation remains active under reduced motion');
    }
    if (
      metrics.motion.transitionTargets.some((item) =>
        item.transitionDuration.split(',').some((duration) => Number.parseFloat(duration) > 0.001),
      )
    ) {
      failures.push('transition remains active under reduced motion');
    }
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
    await client.send('Emulation.setEmulatedMedia', {
      features: [
        {
          name: 'prefers-reduced-motion',
          value: testCase.reducedMotion ? 'reduce' : 'no-preference',
        },
      ],
    });
    const sideParam = testCase.side ? `&side=${encodeURIComponent(testCase.side)}` : '';
    await client.send('Page.navigate', { url: `${baseUrl}/qa/battle?state=${testCase.state}${sideParam}&controls=0` });
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const ready = await client.send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('.bf-root, [data-tut="mulligan-panel"], .game-over-panel'))`,
        returnByValue: true,
      });
      if (ready.result.value === true) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (testCase.click) {
      await client.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(testCase.click)})?.click()`,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const metricsResult = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const screenshot = await client.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      60000,
    );
    const screenshotPath = `${outDir}/${testCase.name}.png`;
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    const metrics = metricsResult.result.value;
    const failures = failuresFor(testCase, metrics);
    if (failures.length) exitCode = 1;
    results.push({ ...testCase, screenshot: screenshotPath, metrics, failures });
  }
  client.close();
  await fs.writeFile(reportPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(reportPath);
  for (const result of results) {
    console.log(
      `${result.failures.length ? 'FAIL' : 'PASS'} ${result.name}${
        result.failures.length ? `: ${result.failures.join('; ')}` : ''
      }`,
    );
  }
} finally {
  chrome.kill('SIGTERM');
}

process.exit(exitCode);
