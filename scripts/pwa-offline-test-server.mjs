import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PWA_TEST_PORT || 4173);
let officialApiOnline = true;

const qaResponse = JSON.stringify({
  items: [
    {
      id: 'qa_offline',
      number: 999,
      publishedAt: '2026-07-20',
      tags: ['PWA'],
      relatedCardIds: [],
      source: { question: 'オフラインキャッシュテスト', answer: 'キャッシュから表示します。' },
      localized: { question: '離線快取測試問題', answer: 'API 中斷時仍從快取顯示。' },
      requestedLocale: 'zh-TW',
      effectiveLocale: 'zh-TW',
      translationStatus: 'verified',
      sourceUrl: 'https://zutomayocard.net/qa/',
      lastSyncedAt: '2026-07-20T00:00:00.000Z',
      contentVersion: 1,
    },
  ],
  total: 1,
  locale: 'zh-TW',
});

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function staticPath(pathname) {
  const clean = normalize(decodeURIComponent(pathname))
    .replace(/^(?:\.\.(?:\/|\\|$))+/, '')
    .replace(/^[/\\]+/, '');
  const candidate = join(root, clean || 'index.html');
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(root, 'index.html');
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/__test/health') return sendJson(res, 200, { ok: true });
  if (url.pathname === '/__test/reset' && req.method === 'POST') {
    officialApiOnline = true;
    return sendJson(res, 200, { online: true });
  }
  if (url.pathname === '/__test/offline' && req.method === 'POST') {
    officialApiOnline = false;
    return sendJson(res, 200, { online: false });
  }
  if (url.pathname === '/api/official/qa') {
    if (!officialApiOnline) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0',
    });
    res.end(qaResponse);
    return;
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

  const file = staticPath(url.pathname);
  if (!file || !existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream',
    'Cache-Control': file.endsWith('sw.js') ? 'no-cache' : 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`PWA offline test server listening on http://127.0.0.1:${port}\n`);
});
