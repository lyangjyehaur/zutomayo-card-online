import pino, { type Logger } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { trace, context } from '@opentelemetry/api';
import type { Next, ParameterizedContext } from 'koa';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/** 從 OpenTelemetry active span 提取 traceId/spanId，未啟動 SDK 時回傳空物件（no-op）。 */
function traceContextMixin(): Record<string, string> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
}

export const logger: Logger = pino({
  level: LOG_LEVEL,
  base: { service: 'game-server' },
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
  mixin: traceContextMixin,
});

// Koa 的 ParameterizedContext 已涵蓋 method/path/status/get/set/body/ip 等委派屬性，
// 直接複用避免重複定義造成結構不相容。
export type ObsContext = ParameterizedContext;
export type ObsNext = Next;
export type ObsMiddleware = (ctx: ParameterizedContext, next: Next) => Promise<void>;

const requestContext = new AsyncLocalStorage<{ requestId: string; log: Logger }>();

/** Returns the request-scoped logger when inside request middleware, else the root logger. */
export function getRequestLogger(): Logger {
  return requestContext.getStore()?.log ?? logger;
}

export function requestLoggingMiddleware(): ObsMiddleware {
  return async (ctx, next) => {
    const start = Date.now();
    const id = ctx.get('x-request-id') || crypto.randomUUID();
    ctx.set('X-Request-Id', id);
    const log = logger.child({ requestId: id });
    await requestContext.run({ requestId: id, log }, async () => {
      try {
        await next();
      } finally {
        const duration = Date.now() - start;
        log.info(
          {
            method: ctx.method,
            path: ctx.path,
            status: ctx.status,
            durationMs: duration,
          },
          'request completed',
        );
      }
    });
  };
}
