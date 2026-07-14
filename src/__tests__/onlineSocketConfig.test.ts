import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { onlineSocketOptions } from '../onlineSocketConfig';

describe('online Socket.IO transport contract', () => {
  it('uses WebSocket only so replicated game servers do not require polling affinity', () => {
    expect(onlineSocketOptions()).toEqual({ transports: ['websocket'], upgrade: false });
  });

  it('disables polling on the game server transport too', () => {
    const server = readFileSync(resolve('src/server.ts'), 'utf8');
    expect(server).toContain("transports: ['websocket']");
    expect(server).toContain('allowUpgrades: false');
  });
});
