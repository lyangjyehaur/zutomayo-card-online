import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RedisPubSub } from '../redis-pubsub';

class FakeRedis extends EventEmitter {
  status = 'ready';
  published: Array<{ channel: string; message: string }> = [];
  publish = vi.fn(async (channel: string, message: string) => {
    this.published.push({ channel, message });
    return 1;
  });
  subscribe = vi.fn(async () => 1);
  unsubscribe = vi.fn(async () => 1);
  connect = vi.fn(async () => undefined);
  quit = vi.fn(async () => 'OK');
  duplicate = vi.fn(() => this);
}

describe('RedisPubSub', () => {
  it('delivers locally before Redis and ignores the publisher echo', async () => {
    const pubClient = new FakeRedis();
    const subClient = new FakeRedis();
    const pubSub = new RedisPubSub<{ stateID: number }>({
      pubClient: pubClient as never,
      subClient: subClient as never,
    });
    const callback = vi.fn();
    pubSub.subscribe('MATCH-1', callback);

    pubSub.publish('MATCH-1', { stateID: 4 });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith({ stateID: 4 });

    const published = pubClient.published[0];
    subClient.emit('message', published.channel, published.message);
    expect(callback).toHaveBeenCalledTimes(1);

    const envelope = JSON.parse(published.message) as Record<string, unknown>;
    subClient.emit('message', 'MATCH-1', JSON.stringify({ ...envelope, sourceId: 'another-game-node' }));
    expect(callback).toHaveBeenCalledTimes(2);

    await pubSub.close();
  });
});
