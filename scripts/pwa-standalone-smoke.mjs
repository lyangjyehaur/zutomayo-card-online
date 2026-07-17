import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-pwa-standalone-report.json';
const port = Number(process.env.CDP_PORT ?? 9959);
const profileDir = `/private/tmp/zutomayo-pwa-standalone-profile-${process.pid}-${Date.now()}`;

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
  throw new Error(`Timed out waiting for ${label}`);
}

let client;
try {
  await waitForCdp();
  const targets = await getJson('/json/list');
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error(`No page target\n${JSON.stringify(targets, null, 2)}`);
  client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

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

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify({ checkedAt: new Date().toISOString(), manifest, online, offline }, null, 2),
  );
  console.log(`PWA standalone smoke: valid (${reportPath})`);
} finally {
  if (client) client.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  await fs.rm(profileDir, { recursive: true, force: true });
}
