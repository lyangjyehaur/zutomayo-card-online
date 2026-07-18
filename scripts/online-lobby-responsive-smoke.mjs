import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const outDir = process.env.OUT_DIR ?? join(tmpdir(), 'zutomayo-online-lobby-responsive-screenshots');
const reportPath = process.env.REPORT_PATH ?? join(tmpdir(), 'zutomayo-online-lobby-responsive-report.json');
const port = Number(process.env.CDP_PORT ?? 9931);
const profileDir = join(tmpdir(), `zutomayo-online-lobby-responsive-profile-${process.pid}-${Date.now()}`);
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof packageJson.version !== 'string' || !packageJson.version) {
  throw new Error('package.json version is required');
}
const smokeVersion = packageJson.version;
const smokeBuildId = process.env.APP_BUILD_ID ?? smokeVersion;
const smokeRulesVersion = process.env.GAME_RULES_VERSION ?? smokeVersion;
const smokeReleaseSha = /^[a-f0-9]{40}$/.test(smokeBuildId) ? smokeBuildId : 'b'.repeat(40);
const smokeDatasetSha256 = 'a'.repeat(64);

const cases = [
  { name: 'online-lobby-360x740', width: 360, height: 740, createRoom: true },
  { name: 'online-lobby-768x1024', width: 768, height: 1024, createRoom: true },
  { name: 'online-lobby-1024x768', width: 1024, height: 768, createRoom: true },
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

async function waitFor(client, expression, timeoutMs = 14000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evalChecked(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const debug = await evalChecked(
    client,
    `({ href: location.href, text: document.body?.innerText?.slice(0, 700) ?? '' })`,
  );
  throw new Error(`Timed out waiting for ${expression}\n${JSON.stringify(debug, null, 2)}`);
}

const setup = `
(() => {
  const smokeVersion = ${JSON.stringify(smokeVersion)};
  const smokeAccount = new URL(location.href).searchParams.get('smokeAccount') === '1';
  const directSubjectId = 'v1:u_friend:u_smoke';
  window.__zutomayoOnlineLobbySmoke = { requests: [] };
  localStorage.removeItem('zutomayo_token');
  if (smokeAccount) localStorage.setItem('zutomayo_session', 'smoke-session');
  else localStorage.removeItem('zutomayo_session');
  localStorage.removeItem('zutomayo_online_session');
  localStorage.removeItem('zutomayo_custom_deck');
  sessionStorage.setItem('zutomayo_anonymous_name_prompt_seen', 'true');
  sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
  const originalPushState = history.pushState.bind(history);
  history.pushState = (state, unused, url) => {
    if (String(url ?? '').includes('/play/online/')) return;
    return originalPushState(state, unused, url);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    window.__zutomayoOnlineLobbySmoke.requests.push({
      method,
      url,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url.includes('/api/cards')) {
      return new Response(JSON.stringify([
        { id: 'qa-card-001', name: 'QA Card', type: 'Character', element: '闇', cost: 1, power: 1000, image: '' }
      ]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Card-Dataset-Sha256': ${JSON.stringify(smokeDatasetSha256)},
          'X-Card-Dataset-Release-Sha': ${JSON.stringify(smokeReleaseSha)},
          'X-Card-Dataset-Count': '1',
          'X-Card-Data-App-Version': ${JSON.stringify(smokeVersion)},
          'X-Card-Data-Build-Id': ${JSON.stringify(smokeBuildId)},
          'X-Card-Data-Rules-Version': ${JSON.stringify(smokeRulesVersion)}
        }
      });
    }
    if (url.includes('/api/config')) {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/app-version')) {
      const headers = init?.headers ?? {};
      const getHeader = (name) =>
        typeof headers.get === 'function' ? headers.get(name) : headers[name] || headers[name.toLowerCase()];
      return new Response(JSON.stringify({
        appVersion: getHeader('X-Client-App-Version') || smokeVersion,
        buildId: getHeader('X-Client-Build-Id') || smokeVersion,
        rulesVersion: getHeader('X-Client-Rules-Version') || smokeVersion
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/preset-decks')) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/presence')) {
      return new Response(JSON.stringify({ onlineCount: 7, activeWindowSeconds: 90 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/decks')) {
      return new Response(JSON.stringify({ decks: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/profile')) {
      if (smokeAccount) {
        return new Response(JSON.stringify({
          id: 'u_smoke',
          email: 'smoke@example.test',
          nickname: 'Smoke Player',
          elo: 1500,
          matchCount: 12,
          wins: 7,
          winRate: 58,
          createdAt: '2026-07-12T00:00:00.000Z'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/friends')) {
      return new Response(JSON.stringify({
        friends: [
          { userId: 'u_friend', nickname: 'Smoke Friend', elo: 1510, matchCount: 8, wins: 5, createdAt: '2026-07-12T00:00:00.000Z' }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/chat/unread')) {
      return new Response(JSON.stringify({
        conversations: [
          {
            id: 'chat_conv_global_online_lobby',
            type: 'global',
            subjectId: 'online-lobby',
            title: 'Online Lobby',
            status: 'active',
            createdAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:01:00.000Z',
            unreadCount: 1,
            latestMessageAt: '2026-07-12T00:01:00.000Z',
            latestMessageId: 'chat_msg_global_1'
          },
          {
            id: 'chat_conv_direct_smoke_friend',
            type: 'direct',
            subjectId: directSubjectId,
            title: 'Smoke Friend',
            status: 'active',
            createdAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:02:00.000Z',
            unreadCount: 2,
            latestMessageAt: '2026-07-12T00:02:00.000Z',
            latestMessageId: 'chat_msg_direct_1'
          },
          {
            id: 'chat_conv_room_42',
            type: 'room',
            subjectId: 'ROOM42',
            title: 'Room ROOM42',
            status: 'active',
            createdAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:03:00.000Z',
            unreadCount: 1,
            latestMessageAt: '2026-07-12T00:03:00.000Z',
            latestMessageId: 'chat_msg_room_1'
          }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/chat/messages') && method === 'GET') {
      const parsed = new URL(url, location.origin);
      const type = parsed.searchParams.get('type');
      const subjectId = parsed.searchParams.get('subjectId');
      const message = (id, content, role = 'player') => ({
        id,
        conversationId: \`chat_conv_\${type}_\${subjectId}\`,
        authorUserId: role === 'player' ? 'u_friend' : 'u_smoke',
        authorDisplayName: role === 'player' ? 'Smoke Friend' : 'Smoke Player',
        authorRole: role,
        content,
        sourceLanguage: 'zh-TW',
        moderationStatus: 'visible',
        moderationReason: '',
        metadata: {},
        createdAt: '2026-07-12T00:04:00.000Z',
        editedAt: null,
        deletedAt: null
      });
      if (type === 'global' && subjectId === 'online-lobby') {
        return new Response(JSON.stringify({ messages: [message('chat_msg_global_1', 'global durable smoke')] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (type === 'direct' && subjectId === directSubjectId) {
        return new Response(JSON.stringify({ messages: [message('chat_msg_direct_1', 'direct durable smoke')] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (type === 'room' && subjectId === 'ROOM42') {
        return new Response(JSON.stringify({ messages: [message('chat_msg_room_1', 'room durable smoke')] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ messages: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/chat/read')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/matchmaking/')) {
      throw new Error('Online lobby smoke should not call legacy REST matchmaking');
    }
    if (url.includes('/games/zutomayo-card/create')) {
      return new Response(JSON.stringify({ matchID: 'visual-room-0001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/games/zutomayo-card/visual-room-0001/join')) {
      return new Response(JSON.stringify({ playerCredentials: 'visual-credentials' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
})()
`;

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
    panels: visible('[data-room-panel]').slice(0, 10),
    quick: visible('[data-room-panel="quick"]').slice(0, 2),
    deck: visible('[data-room-panel="deck"]').slice(0, 2),
    custom: visible('[data-room-panel="custom"]').slice(0, 2),
    status: visible('[data-room-panel="status"]').slice(0, 2),
    platformError: visible('[role="alert"]').slice(0, 3),
    smallTargets: targets.filter((item) => item.width < 44 || item.height < 44).slice(0, 12),
    offscreen: [...document.body.querySelectorAll('*')]
      .filter(isVisible)
      .map(box)
      .filter((item) => item.offscreenX)
      .slice(0, 20),
  };
})()
`;

const accountWorkflowExpression = `
(() => {
  const requests = window.__zutomayoOnlineLobbySmoke?.requests ?? [];
  const hasRequest = (matcher) => requests.some((request) => matcher(request));
  return {
    visibleSurfaces: [...document.querySelectorAll('[data-chat-surface]')].map((element) => ({
      surface: element.getAttribute('data-chat-surface'),
      text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 160),
    })),
    unreadTypes: [...document.querySelectorAll('[data-unread-conversation]')].map((element) => ({
      type: element.getAttribute('data-unread-conversation'),
      subject: element.getAttribute('data-unread-subject'),
      text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120),
    })),
    friendInviteControls: [...document.querySelectorAll('[data-friend-invite-action]')].map((element) => ({
      action: element.getAttribute('data-friend-invite-action'),
      friend: element.getAttribute('data-friend-user-id'),
      disabled: element.disabled,
    })),
    messages: [...document.querySelectorAll('[data-chat-message]')].map((element) => ({
      type: element.getAttribute('data-chat-message'),
      text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120),
    })),
    requestChecks: {
      profile: hasRequest((request) => request.url.includes('/api/profile')),
      friends: hasRequest((request) => request.url.includes('/api/friends')),
      unread: hasRequest((request) => request.url.includes('/api/chat/unread')),
      globalHistory: hasRequest((request) =>
        request.url.includes('/api/chat/messages') &&
        request.url.includes('type=global') &&
        request.url.includes('subjectId=online-lobby')
      ),
      directHistory: hasRequest((request) =>
        request.url.includes('/api/chat/messages') &&
        request.url.includes('type=direct') &&
        request.url.includes('subjectId=v1%3Au_friend%3Au_smoke')
      ),
      roomHistory: hasRequest((request) =>
        request.url.includes('/api/chat/messages') &&
        request.url.includes('type=room') &&
        request.url.includes('subjectId=ROOM42')
      ),
      globalRead: hasRequest((request) =>
        request.url.includes('/api/chat/read') &&
        request.body.includes('"conversationType":"global"') &&
        request.body.includes('"subjectId":"online-lobby"')
      ),
      directRead: hasRequest((request) =>
        request.url.includes('/api/chat/read') &&
        request.body.includes('"conversationType":"direct"') &&
        request.body.includes('"subjectId":"v1:u_friend:u_smoke"')
      ),
      roomRead: hasRequest((request) =>
        request.url.includes('/api/chat/read') &&
        request.body.includes('"conversationType":"room"') &&
        request.body.includes('"subjectId":"ROOM42"')
      ),
      noLegacyMatchmaking: !requests.some((request) => request.url.includes('/api/matchmaking/')),
    },
    requests,
  };
})()
`;

function failuresFor(metrics) {
  const failures = [];
  if (metrics.doc.overflowX) failures.push('document overflowX');
  if (!metrics.quick.length) failures.push('missing quick room panel');
  if (!metrics.deck.length) failures.push('missing deck room panel');
  if (!metrics.custom.length) failures.push('missing custom room panel');
  if (!metrics.status.length && !metrics.platformError.length) {
    failures.push('missing created-room status panel or retryable platform error');
  }
  if (metrics.offscreen.length) failures.push(`offscreenX: ${metrics.offscreen.map((item) => item.text).join(', ')}`);
  if (metrics.viewport.width <= 768 && metrics.smallTargets.length) {
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
    await client.send('Page.navigate', { url: `${baseUrl}/online` });
    await waitFor(client, `Boolean(document.querySelector('[data-room-panel="deck"] button:not([disabled])'))`);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await evalChecked(client, `document.querySelector('[data-room-panel="deck"] button:not([disabled])')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (testCase.createRoom) {
      await evalChecked(
        client,
        `[...document.querySelectorAll('button')].find((button) => button.textContent.includes('建立房間') || button.textContent.includes('創建房間') || button.textContent.includes('Create Room'))?.click()`,
      );
      await waitFor(client, `Boolean(document.querySelector('[data-room-panel="status"], [role="alert"]'))`);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const metrics = await evalChecked(client, metricsExpression);
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotPath = `${outDir}/${testCase.name}.png`;
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    const failures = failuresFor(metrics);
    if (failures.length) exitCode = 1;
    results.push({ ...testCase, screenshot: screenshotPath, metrics, failures });
  }

  const workflowName = 'online-lobby-account-chat-workflow';
  console.log(`case ${workflowName}`);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1024,
    screenHeight: 900,
  });
  await client.send('Page.navigate', { url: `${baseUrl}/community?smokeAccount=1` });
  await waitFor(client, `Boolean(document.querySelector('[data-chat-surface="global"]'))`);
  await waitFor(client, `Boolean(document.querySelector('[data-chat-message="global"]'))`);
  await waitFor(client, `Boolean(document.querySelector('[data-friend-user-id="u_friend"]'))`);
  const globalEvidence = await evalChecked(client, accountWorkflowExpression);
  await evalChecked(client, `document.querySelector('[data-direct-chat-open="u_friend"]')?.click()`);
  await waitFor(client, `Boolean(document.querySelector('[data-chat-message="direct"]'))`);
  const directEvidence = await evalChecked(client, accountWorkflowExpression);
  await evalChecked(
    client,
    `document.querySelector('[data-unread-conversation="room"][data-unread-subject="ROOM42"]')?.click()`,
  );
  await waitFor(
    client,
    `Boolean(document.querySelector('[data-chat-surface="room"][data-chat-subject="ROOM42"] [data-chat-message="room"]'))`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const workflow = await evalChecked(client, accountWorkflowExpression);
  workflow.visibleSurfaces = [
    ...globalEvidence.visibleSurfaces,
    ...directEvidence.visibleSurfaces,
    ...workflow.visibleSurfaces,
  ];
  workflow.unreadTypes = globalEvidence.unreadTypes;
  workflow.messages = [...globalEvidence.messages, ...directEvidence.messages, ...workflow.messages];
  const workflowFailures = [];
  for (const [name, ok] of Object.entries(workflow.requestChecks)) {
    if (!ok) workflowFailures.push(`missing request check: ${name}`);
  }
  const unreadTypes = new Set(workflow.unreadTypes.map((item) => item.type));
  for (const type of ['global', 'direct', 'room']) {
    if (!unreadTypes.has(type)) workflowFailures.push(`missing unread type: ${type}`);
  }
  const messageTypes = new Set(workflow.messages.map((item) => item.type));
  for (const type of ['global', 'direct', 'room']) {
    if (!messageTypes.has(type)) workflowFailures.push(`missing chat message: ${type}`);
  }
  if (!workflow.friendInviteControls.some((item) => item.action === 'send' && item.friend === 'u_friend')) {
    workflowFailures.push('missing friend invite send control');
  }
  if (!workflow.friendInviteControls.some((item) => item.action === 'accept' && item.friend === 'u_friend')) {
    workflowFailures.push('missing friend invite accept control');
  }
  if (workflowFailures.length) exitCode = 1;
  results.push({
    name: workflowName,
    width: 1024,
    height: 900,
    screenshot: null,
    metrics: workflow,
    failures: workflowFailures,
  });

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
