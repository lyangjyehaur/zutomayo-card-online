import { Pool, type QueryResultRow } from 'pg';
import { postgresConnectionString, postgresSslConfig } from '../runtimeSecurityConfig';

export const MAX_PLATFORM_FRIEND_PRESENCE_IDS = 100;

const USER_ID_PATTERN = /^[a-zA-Z0-9:_-]{3,128}$/;

export function platformStoreQueryTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.min(5_000, Math.max(100, Number(env.PLATFORM_AUTH_DB_QUERY_TIMEOUT_MS) || 1_500));
}

export interface PlatformFriendStore {
  listFriendUserIds(userId: string): Promise<string[]>;
  areUsersFriends?(firstUserId: string, secondUserId: string): Promise<boolean>;
  close?(): Promise<void>;
}

interface FriendRow extends QueryResultRow {
  friend_user_id?: unknown;
  friends?: unknown;
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
    async areUsersFriends() {
      return false;
    },
  };
}

export function createPostgresPlatformFriendStore(
  pool: Queryable & { end?: () => Promise<void> },
): PlatformFriendStore {
  return {
    async areUsersFriends(firstUserId, secondUserId) {
      const first = normalizePlatformUserId(firstUserId);
      const second = normalizePlatformUserId(secondUserId);
      if (!first || !second || first === second) return false;
      const { rows } = await pool.query(
        `SELECT (
           EXISTS (
             SELECT 1 FROM user_friends
             WHERE user_id = $1 AND friend_user_id = $2
           )
           AND EXISTS (
             SELECT 1 FROM user_friends
             WHERE user_id = $2 AND friend_user_id = $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_blocks
             WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
                OR (blocker_user_id = $2 AND blocked_user_id = $1)
           )
         ) AS friends`,
        [first, second],
      );
      return rows[0]?.friends === true;
    },
    async listFriendUserIds(userId) {
      const cleanUserId = normalizePlatformUserId(userId);
      if (!cleanUserId) return [];
      const { rows } = await pool.query(
        `SELECT friend_user_id
         FROM user_friends
         WHERE user_id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM user_blocks b
             WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = user_friends.friend_user_id)
                OR (b.blocker_user_id = user_friends.friend_user_id AND b.blocked_user_id = $1)
           )
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
  const queryTimeoutMs = platformStoreQueryTimeoutMs(env);
  return createPostgresPlatformFriendStore(
    new Pool({
      connectionString: databaseUrlFromEnv(env),
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      query_timeout: queryTimeoutMs,
      statement_timeout: queryTimeoutMs,
      ssl: postgresSslConfig(env),
    }),
  );
}

export function resolvePlatformFriendStoreMode(env: NodeJS.ProcessEnv = process.env): 'none' | 'postgres' {
  const configured = env.PLATFORM_FRIEND_STORE?.trim().toLowerCase();
  if (configured === 'postgres') return 'postgres';
  if (env.NODE_ENV === 'production' || env.DATABASE_URL || env.PG_HOST || env.PG_PASSWORD) return 'postgres';
  if (configured === 'none') return 'none';
  return 'none';
}

function databaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  return (
    postgresConnectionString(env) ||
    `postgres://${env.PG_USER || 'postgres'}:${env.PG_PASSWORD || ''}@${env.PG_HOST || 'localhost'}:${env.PG_PORT || '5432'}/${env.PG_DATABASE || 'postgres'}`
  );
}
