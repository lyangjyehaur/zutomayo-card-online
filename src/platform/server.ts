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
