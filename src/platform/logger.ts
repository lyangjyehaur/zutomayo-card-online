import pino, { type Logger } from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const platformLogger: Logger = pino({
  level: LOG_LEVEL,
  base: { service: 'platform-server' },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.password',
    '*.token',
    '*.credentials',
    '*.playerCredentials',
    '*.platformSeatToken',
  ],
});
