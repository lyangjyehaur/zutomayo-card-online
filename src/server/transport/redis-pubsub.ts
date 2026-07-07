import Redis from 'ioredis';
import * as Sentry from '@sentry/node';

/**
 * boardgame.io GenericPubSub 的 Redis 實作。
 *
 * boardgame.io 0.50.2 的 SocketIO transport 內建 InMemoryPubSub，
 * 多實例下 sendAll 廣播只送到本節點。這個 RedisPubSub 讓 Master 產生的
 * update/patch/sync/matchData/chat payload 透過 Redis Pub/Sub 跨節點傳遞。
 *
 * 與 @socket.io/redis-adapter 是兩個獨立層：
 *   - Socket.IO adapter：處理 socket 連線層的 rooms/sockets 跨節點同步
 *   - PubSub（本類別）：處理 boardgame.io 應用層的 sendAll payload 跨節點廣播
 * 兩者皆需注入 SocketIO({ socketAdapter, pubSub })，缺一不可。
 *
 * ioredis 限制：進入 subscribe 模式的連線只能做 subscribe/unsubscribe/quit，
 * 因此 publish 必須用另一條連線。subClient 用 duplicate() 共用連線池設定。
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export class RedisPubSub<T = unknown> {
  private pubClient: Redis;
  private subClient: Redis;
  /** channel → callbacks。同一 channel 可能被多個本節點 client 訂閱。 */
  private callbacks = new Map<string, Set<(payload: T) => void>>();
  private connected = false;

  constructor(opts: { pubClient?: Redis; subClient?: Redis } = {}) {
    this.pubClient = opts.pubClient ?? new Redis(REDIS_URL);
    this.subClient = opts.subClient ?? this.pubClient.duplicate();
    this.subClient.on('message', this.handleMessage);
  }

  private handleMessage = (channel: string, message: string): void => {
    const cbs = this.callbacks.get(channel);
    if (!cbs || cbs.size === 0) return;
    let payload: T;
    try {
      payload = JSON.parse(message) as T;
    } catch {
      // 不合法的 payload 直接丟棄，避免單一壞訊息拖垮整個節點。
      return;
    }
    for (const cb of cbs) {
      try {
        cb(payload);
      } catch (err) {
        // 單一 callback 出錯不影響其他 callback。
        Sentry.captureException(err, { tags: { layer: 'redis-pubsub', channel } });
        console.error(`[RedisPubSub] callback error on channel ${channel}:`, err);
      }
    }
  };

  async connect(): Promise<void> {
    if (this.connected) return;
    // 確保兩條連線都 ready。pubClient 若尚未連線，publish 會自動觸發連線，
    // 但 subClient 必須先連線才能 subscribe。
    if (this.subClient.status !== 'ready' && this.subClient.status !== 'connect') {
      await this.subClient.connect().catch(() => {
        /* ioredis 在 lazyConnect=false 時會自動連線，connect() 可能拋 'Redis is already connecting/connected' */
      });
    }
    if (this.pubClient.status !== 'ready' && this.pubClient.status !== 'connect') {
      await this.pubClient.connect().catch(() => {
        /* 同上 */
      });
    }
    this.connected = true;
  }

  publish(channelId: string, payload: T): void {
    // publish 不 await：boardgame.io 的 GenericPubSub.publish 是同步簽名。
    // ioredis publish 回 Promise，這裡 fire-and-forget，錯誤由 reject handler 記錄。
    this.pubClient.publish(channelId, JSON.stringify(payload)).catch((err) => {
      Sentry.captureException(err, { tags: { layer: 'redis-pubsub', op: 'publish', channel: channelId } });
      console.error(`[RedisPubSub] publish error on ${channelId}:`, err);
    });
  }

  subscribe(channelId: string, callback: (payload: T) => void): void {
    let cbs = this.callbacks.get(channelId);
    if (!cbs) {
      cbs = new Set();
      this.callbacks.set(channelId, cbs);
      // 第一次訂閱該 channel 才呼叫 Redis subscribe（避免重複 subscribe）。
      this.subClient.subscribe(channelId).catch((err) => {
        Sentry.captureException(err, { tags: { layer: 'redis-pubsub', op: 'subscribe', channel: channelId } });
        console.error(`[RedisPubSub] subscribe error on ${channelId}:`, err);
      });
    }
    cbs.add(callback);
  }

  unsubscribeAll(channelId: string): void {
    const existed = this.callbacks.delete(channelId);
    if (existed) {
      this.subClient.unsubscribe(channelId).catch((err) => {
        Sentry.captureException(err, { tags: { layer: 'redis-pubsub', op: 'unsubscribe', channel: channelId } });
        console.error(`[RedisPubSub] unsubscribe error on ${channelId}:`, err);
      });
    }
  }

  /**
   * 關閉連線。server shutdown 時呼叫。
   */
  async close(): Promise<void> {
    this.subClient.off('message', this.handleMessage);
    this.callbacks.clear();
    await Promise.all([this.pubClient.quit(), this.subClient.quit()]).catch(() => {
      /* shutdown 時忽略錯誤 */
    });
    this.connected = false;
  }
}
