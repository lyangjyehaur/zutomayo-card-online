import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { onlineSocketOptions } from '../onlineSocketConfig';

describe('online Socket.IO transport contract', () => {
  it('uses WebSocket only so the game server does not require polling affinity', () => {
    expect(onlineSocketOptions()).toEqual({ transports: ['websocket'], upgrade: false });
  });

  it('disables polling on the game server transport too', () => {
    const server = readFileSync(resolve('src/server.ts'), 'utf8');
    expect(server).toContain("transports: ['websocket']");
    expect(server).toContain('allowUpgrades: false');
  });

  it('keeps the boardgame server runtime compatible with the Redis adapter', () => {
    const require = createRequire(import.meta.url);
    const rootSocketIo = require('socket.io/package.json') as { version: string };
    const koaSocketPath = require.resolve('koa-socket-2');
    const koaSocketIo = require(require.resolve('socket.io/package.json', { paths: [koaSocketPath] })) as {
      version: string;
    };
    const redisAdapter = require('@socket.io/redis-adapter/package.json') as {
      peerDependencies?: { 'socket.io-adapter'?: string };
    };

    expect(koaSocketIo.version).toBe(rootSocketIo.version);
    expect(rootSocketIo.version).toBe('4.8.3');
    expect(redisAdapter.peerDependencies?.['socket.io-adapter']).toBe('^2.5.4');
  });
});
