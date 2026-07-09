import { Pool, type QueryResultRow } from 'pg';

export const MAX_PLATFORM_FRIEND_PRESENCE_IDS = 100;

const USER_ID_PATTERN = /^[a-zA-Z0-9:_-]{3,128}$/;

export interface PlatformFriendStore {
  listFriendUserIds(userId: string): Promise<string[]>;
  close?(): Promise<void>;
}

interface FriendRow extends QueryResultRow {
  friend_user_id: unknown;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: FriendRow[] }>;
}

export function normalizePlatformUserId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const userId = value.trim().slice(0, 128);
  return USER_ID_PATTERN.test(userId) ? userId : '';
}

export function mapFriendUserIdRows(rows: FriendRow[], selfUserId: string): string[] {
  const cleanSelfUserId = normalizePlatformUserId(selfUserId);
  const friendUserIds = new Set<string>();
  for (const row of rows) {
    const friendUserId = normalizePlatformUserId(row.friend_user_id);
    if (!friendUserId || friendUserId === cleanSelfUserId) continue;
    friendUserIds.add(friendUserId);
    if (friendUserIds.size >= MAX_PLATFORM_FRIEND_PRESENCE_IDS) break;
  }
  return Array.from(friendUserIds);
}

export function createEmptyPlatformFriendStore(): PlatformFriendStore {
  return {
    async listFriendUserIds() {
      return [];
    },
  };
}

export function createPostgresPlatformFriendStore(
  pool: Queryable & { end?: () => Promise<void> },
): PlatformFriendStore {
  return {
    async listFriendUserIds(userId) {
      const cleanUserId = normalizePlatformUserId(userId);
      if (!cleanUserId) return [];
      const { rows } = await pool.query(
        `SELECT friend_user_id
         FROM user_friends
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [cleanUserId, MAX_PLATFORM_FRIEND_PRESENCE_IDS],
      );
      return mapFriendUserIdRows(rows, cleanUserId);
    },
    async close() {
      await pool.end?.();
    },
  };
}

export function createPlatformFriendStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PlatformFriendStore {
  const mode = resolvePlatformFriendStoreMode(env);
  if (mode === 'none') return createEmptyPlatformFriendStore();
  return createPostgresPlatformFriendStore(
    new Pool({
      connectionString: databaseUrlFromEnv(env),
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
    }),
  );
}

export function resolvePlatformFriendStoreMode(env: NodeJS.ProcessEnv = process.env): 'none' | 'postgres' {
  const configured = env.PLATFORM_FRIEND_STORE?.trim().toLowerCase();
  if (configured === 'none' || configured === 'postgres') return configured;
  if (env.NODE_ENV === 'production' || env.DATABASE_URL || env.PG_HOST || env.PG_PASSWORD) return 'postgres';
  return 'none';
}

function databaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  return (
    env.DATABASE_URL ??
    `postgres://${env.PG_USER || 'postgres'}:${env.PG_PASSWORD || ''}@${env.PG_HOST || 'localhost'}:${env.PG_PORT || '5432'}/${env.PG_DATABASE || 'postgres'}`
  );
}
