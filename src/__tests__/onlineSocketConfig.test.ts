import { describe, expect, it } from 'vitest';
import { onlineSocketOptions } from '../onlineSocketConfig';

describe('online Socket.IO transport contract', () => {
  it('uses WebSocket only so replicated game servers do not require polling affinity', () => {
    expect(onlineSocketOptions()).toEqual({ transports: ['websocket'], upgrade: false });
  });
});
