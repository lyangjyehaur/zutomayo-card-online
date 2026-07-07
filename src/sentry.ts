import * as Sentry from '@sentry/react';
import { APP_VERSION_INFO } from './version';

// Vite 環境下 import.meta.env 存在；scripts/tsconfig.scripts.json 只有 node types，
// 因此用型別斷言安全存取，避免 scripts typecheck 報錯。
const importMeta = import.meta as unknown as { env?: Record<string, unknown> };
const dsn = importMeta.env?.VITE_SENTRY_DSN as string | undefined;

// 敏感欄位名稱（小寫比對），出現在 event 的 extra / context / request 中時一律遮罩。
const SENSITIVE_KEY_PATTERNS = [/password/i, /token/i, /secret/i, /authorization/i, /cookie/i, /session/i];

const IGNORE_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Network request failed',
  'Failed to fetch',
  'Load failed',
  'Non-Error promise rejection captured',
  // 動態 import chunk 載入失敗（通常是使用者網路問題或新版部署後舊版載入中）
  'Loading chunk',
  'Loading CSS chunk',
  'Importing a module script failed',
  // 瀏覽器擴充功能常見錯誤
  'extension',
  'googletagmanager',
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function scrubSensitive(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => scrubSensitive(v, depth + 1));
  if (typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      cleaned[key] = isSensitiveKey(key) ? '[Filtered]' : scrubSensitive(val, depth + 1);
    }
    return cleaned;
  }
  return value;
}

/** Initialize GlitchTip/Sentry error tracking. No-op when VITE_SENTRY_DSN is unset. */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // 支援 staging/preview 等環境：若顯式設定 SENTRY_ENVIRONMENT 則優先使用，否則退回 Vite MODE。
    environment:
      (importMeta.env?.VITE_SENTRY_ENVIRONMENT as string | undefined) ||
      (importMeta.env?.MODE as string | undefined) ||
      'development',
    release: `${APP_VERSION_INFO.appVersion}@${APP_VERSION_INFO.buildId}`,
    tracesSampleRate: Number(importMeta.env?.VITE_SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    // GlitchTip 不支援 session replay；@sentry/react 10.x browser SDK 預設不啟用 session tracking。
    normalizeDepth: 5,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    // denyUrls：來自這些 URL 的腳本錯誤不上報（瀏覽器擴充功能、第三方分析、廣告腳本等）。
    denyUrls: [
      // 瀏覽器擴充功能
      /extensions\//i,
      /^chrome-extension:/i,
      /^moz-extension:/i,
      /^safari-extension:/i,
      // 第三方分析 / 廣告
      /googletagmanager\.com\//i,
      /google-analytics\.com\//i,
      /doubleclick\.net\//i,
      /facebook\.net\//i,
      /connect\.facebook\.net\//i,
      // Umami（已透過 ignoreErrors 過濾，denyUrls 作為第二層防護）
      /umami\.is\//i,
    ],
    beforeSend(event) {
      // 移除 request 中的敏感 header / cookie / body
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      if (event.contexts) {
        event.contexts = scrubSensitive(event.contexts) as typeof event.contexts;
      }
      if (event.extra) {
        event.extra = scrubSensitive(event.extra) as typeof event.extra;
      }
      return event;
    },
    initialScope: {
      tags: {
        service: 'frontend',
        app: 'zutomayo-card',
      },
    },
  });
}

export { Sentry };
