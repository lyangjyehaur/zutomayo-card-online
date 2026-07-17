import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const reportPath = process.env.REPORT_PATH ?? path.join(tmpdir(), 'zutomayo-pwa-standalone-report.json');
const port = Number(process.env.CDP_PORT ?? 9000 + Math.floor(Math.random() * 900));
const profileDir = path.join(tmpdir(), `zutomayo-pwa-standalone-profile-${process.pid}-${Date.now()}`);
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const appVersion = process.env.APP_VERSION ?? packageJson.version;
const buildId = process.env.APP_BUILD_ID ?? appVersion;
const rulesVersion = process.env.GAME_RULES_VERSION ?? appVersion;
const cacheKey = `${buildId}-${rulesVersion}`.replace(/[^a-zA-Z0-9._-]/g, '_');
const datasetSha256 = 'a'.repeat(64);
const releaseSha = /^[a-f0-9]{40}$/.test(buildId) ? buildId : 'b'.repeat(40);

let chromeStderr = '';
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--app=${baseUrl}/`,
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
        .get({ host: '127.0.0.1', port, path }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
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

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(client, expression, label, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const debug = await evaluate(
    client,
    `(async () => ({ href: location.href, text: document.body?.innerText?.slice(0, 1200) ?? '', caches: await caches.keys() }))()`,
  );
  throw new Error(`Timed out waiting for ${label}\n${JSON.stringify(debug, null, 2)}`);
}

let client;
let workerClient;
try {
  await waitForCdp();
  const targets = await getJson('/json/list');
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error(`No page target\n${JSON.stringify(targets, null, 2)}`);
  client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Page.navigate', { url: `${baseUrl}/` });

  await waitFor(client, `document.readyState === 'complete'`, 'initial document load');
  const manifest = await evaluate(
    client,
    `(async () => {
      const response = await fetch('/manifest.webmanifest');
      if (!response.ok) throw new Error('manifest request failed: ' + response.status);
      return response.json();
    })()`,
  );
  if (manifest.display !== 'standalone') throw new Error(`manifest display is ${manifest.display}`);
  if (!manifest.start_url) throw new Error('manifest start_url is missing');

  await waitFor(
    client,
    `Boolean(navigator.serviceWorker) && navigator.serviceWorker.ready.then(() => true)`,
    'service worker ready',
  );
  await client.send('Page.reload');
  await waitFor(
    client,
    `document.readyState === 'complete' && Boolean(navigator.serviceWorker?.controller)`,
    'service worker controlled reload',
  );
  const controlledTargets = await getJson('/json/list');
  const serviceWorker = controlledTargets.find(
    (target) => target.type === 'service_worker' && target.url === `${baseUrl}/sw.js`,
  );
  if (!serviceWorker)
    throw new Error(`No application service worker target\n${JSON.stringify(controlledTargets, null, 2)}`);
  workerClient = await connect(serviceWorker.webSocketDebuggerUrl);
  await workerClient.send('Network.enable');

  const online = await evaluate(
    client,
    `({
      standalone: matchMedia('(display-mode: standalone)').matches,
      controlled: Boolean(navigator.serviceWorker?.controller),
      hasShell: Boolean(document.querySelector('#root')) && document.body.innerText.trim().length > 0,
      href: location.href
    })`,
  );
  if (!online.standalone) throw new Error('Chrome app window is not in standalone display mode');
  if (!online.controlled) throw new Error('page is not controlled by the service worker');
  if (!online.hasShell) throw new Error('application shell is empty before offline reload');

  await client.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  });
  await workerClient.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const warmedCardData = await evaluate(
    client,
    `(async () => {
      const cards = Array.from({ length: 40 }, (_, index) => ({
        id: 'offline-card-' + String(index + 1).padStart(3, '0'),
        name: 'Offline Card ' + (index + 1),
        pack: 'offline-smoke',
        song: 'offline-smoke',
        illustrator: 'offline-smoke',
        rarity: 'N',
        element: ['闇', '炎', '電気', '風'][index % 4],
        type: index < 24 ? 'Character' : 'Enchant',
        clock: 1,
        attack: index < 24 ? { night: 100 + index, day: 100 + index } : null,
        powerCost: 1,
        sendToPower: index < 24 ? 1 : 0,
        effect: '',
        image: '',
        errata: ''
      }));
      const headers = {
        'Content-Type': 'application/json',
        'X-Card-Dataset-Sha256': ${JSON.stringify(datasetSha256)},
        'X-Card-Dataset-Release-Sha': ${JSON.stringify(releaseSha)},
        'X-Card-Dataset-Count': String(cards.length),
        'X-Card-Data-App-Version': ${JSON.stringify(appVersion)},
        'X-Card-Data-Build-Id': ${JSON.stringify(buildId)},
        'X-Card-Data-Rules-Version': ${JSON.stringify(rulesVersion)}
      };
      const cacheName = ${JSON.stringify(`card-data-${cacheKey}`)};
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (['/api/cards', '/api/cards/i18n', '/api/cards/texts'].includes(new URL(request.url).pathname)) {
          await cache.delete(request, { ignoreVary: true });
        }
      }
      await Promise.all([
        cache.put('/api/cards', new Response(JSON.stringify(cards), { status: 200, headers })),
        cache.put('/api/cards/i18n', new Response('{}', { status: 200, headers })),
        cache.put('/api/cards/texts', new Response('{}', { status: 200, headers }))
      ]);
      const stored = await cache.match('/api/cards');
      return {
        cacheName,
        entries: (await cache.keys()).map((request) => new URL(request.url).pathname),
        cardCount: cards.length,
        storedDataset: stored?.headers.get('X-Card-Dataset-Sha256') ?? null
      };
    })()`,
  );
  if (
    warmedCardData.entries.length !== 3 ||
    warmedCardData.cardCount !== 40 ||
    warmedCardData.storedDataset !== datasetSha256
  ) {
    throw new Error(`card data cache warmup failed: ${JSON.stringify(warmedCardData)}`);
  }

  const offlineCardProbe = await evaluate(
    client,
    `(async () => {
      try {
        const response = await fetch('/api/cards', { cache: 'no-store' });
        const data = await response.json();
        return {
          ok: response.ok,
          status: response.status,
          dataset: response.headers.get('X-Card-Dataset-Sha256'),
          count: Array.isArray(data) ? data.length : 'invalid',
          firstId: Array.isArray(data) ? data[0]?.id ?? null : null
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    })()`,
  );
  if (!offlineCardProbe.ok || offlineCardProbe.dataset !== datasetSha256 || offlineCardProbe.count !== 40) {
    throw new Error(`offline card cache probe failed: ${JSON.stringify(offlineCardProbe)}`);
  }
  await client.send('Page.reload');
  await waitFor(
    client,
    `document.readyState === 'complete' && Boolean(navigator.serviceWorker?.controller) && Boolean(document.querySelector('#root')) && document.body.innerText.trim().length > 0`,
    'offline cached application shell',
  );
  const offline = await evaluate(
    client,
    `({
      standalone: matchMedia('(display-mode: standalone)').matches,
      controlled: Boolean(navigator.serviceWorker?.controller),
      hasShell: Boolean(document.querySelector('#root')) && document.body.innerText.trim().length > 0,
      href: location.href
    })`,
  );
  if (!offline.standalone || !offline.controlled || !offline.hasShell) {
    throw new Error(`offline standalone invariant failed: ${JSON.stringify(offline)}`);
  }
  await evaluate(client, `window.dispatchEvent(new Event('offline'))`);
  await waitFor(
    client,
    `document.querySelector('[data-offline-requires-network="online"]')?.disabled === true && document.querySelector('[data-offline-requires-network="leaderboard"]')?.disabled === true`,
    'offline-only navigation policy',
  );

  await client.send('Page.navigate', { url: `${baseUrl}/ai` });
  await waitFor(
    client,
    `location.pathname === '/ai' && document.readyState === 'complete' && Boolean(document.querySelector('section[aria-label^="01"] button:not([disabled])'))`,
    'offline AI lobby with cached cards',
  );
  await evaluate(client, `document.querySelector('section[aria-label^="01"] button:not([disabled])')?.click()`);
  await waitFor(
    client,
    `Boolean(document.querySelector('section[aria-label^="01"] button[aria-pressed="true"]'))`,
    'player deck selected',
  );
  await evaluate(client, `document.querySelector('section[aria-label^="02"] button:not([disabled])')?.click()`);
  await waitFor(
    client,
    `Boolean(document.querySelector('section[aria-label^="02"] button[aria-pressed="true"]'))`,
    'opponent deck selected',
  );
  await waitFor(
    client,
    `Boolean(document.querySelector('section[aria-label^="03"] button:not([disabled])'))`,
    'AI start enabled',
  );
  await evaluate(client, `document.querySelector('section[aria-label^="03"] button:not([disabled])')?.click()`);
  await waitFor(
    client,
    `location.pathname === '/play/ai' && Boolean(document.querySelector('.bf-root'))`,
    'offline AI match start',
  );
  const offlineAi = await evaluate(
    client,
    `({ href: location.href, hasBoard: Boolean(document.querySelector('.bf-root')), controlled: Boolean(navigator.serviceWorker?.controller) })`,
  );

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      { checkedAt: new Date().toISOString(), manifest, online, warmedCardData, offlineCardProbe, offline, offlineAi },
      null,
      2,
    ),
  );
  console.log(`PWA standalone smoke: valid (${reportPath})`);
} finally {
  if (client) client.close();
  if (workerClient) workerClient.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  await fs.rm(profileDir, { recursive: true, force: true });
}
