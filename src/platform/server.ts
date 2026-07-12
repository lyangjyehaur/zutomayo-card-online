import * as Sentry from '@sentry/node';
import { platformLogger as logger } from './logger';
import { createPlatformRuntime } from './runtime';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: `${process.env.APP_VERSION || '0.0.0'}@${process.env.APP_BUILD_ID || 'local'}`,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
    initialScope: {
      tags: {
        service: 'platform',
        app: 'zutomayo-card',
      },
    },
  });
}

function validateSecurityConfig(): void {
  const hasSeatTokenSecret = Boolean(process.env.PLATFORM_SEAT_TOKEN_SECRET || process.env.JWT_SECRET);
  const isProduction = process.env.NODE_ENV === 'production';
  if (!hasSeatTokenSecret) {
    if (isProduction) {
      logger.fatal(
        'PLATFORM_SEAT_TOKEN_SECRET 與 JWT_SECRET 皆未設定，正式環境無法安全啟動 platform server',
      );
      process.exit(1);
    } else {
      logger.warn(
        'PLATFORM_SEAT_TOKEN_SECRET 與 JWT_SECRET 皆未設定，seatToken 將使用開發用 fallback 密鑰，請勿用於正式環境',
      );
    }
  }
}

validateSecurityConfig();

const platform = createPlatformRuntime();

process.on('uncaughtException', (err) => {
  Sentry.captureException(err, { tags: { layer: 'platform-process', type: 'uncaughtException' } });
  logger.fatal({ err }, 'uncaught platform exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason, { tags: { layer: 'platform-process', type: 'unhandledRejection' } });
  logger.error({ err: reason }, 'unhandled platform rejection');
});

await platform.gameServer.listen(platform.port);
logger.info(
  {
    port: platform.port,
    redisMode: platform.redisMode,
    friendStoreMode: platform.friendStoreMode,
    matchParticipantStoreMode: platform.matchParticipantStoreMode,
    chatPreviewStoreMode: platform.chatPreviewStoreMode,
  },
  'Zutomayo platform server running',
);
