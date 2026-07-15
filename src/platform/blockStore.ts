import { Pool, type QueryResultRow } from 'pg';
import { normalizePlatformUserId } from './friendStore';
import { postgresConnectionString, postgresSslConfig } from '../runtimeSecurityConfig';

export interface PlatformBlockStore {
  areUsersBlocked(firstUserId: string, secondUserId: string): Promise<boolean>;
  close?(): Promise<void>;
}

interface BlockRow extends QueryResultRow {
  blocked: unknown;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: BlockRow[] }>;
}

export function createEmptyPlatformBlockStore(): PlatformBlockStore {
  return {
    async areUsersBlocked() {
      return false;
    },
  };
}

export function createPostgresPlatformBlockStore(pool: Queryable & { end?: () => Promise<void> }): PlatformBlockStore {
  return {
    async areUsersBlocked(firstUserId, secondUserId) {
      const first = normalizePlatformUserId(firstUserId);
      const second = normalizePlatformUserId(secondUserId);
      if (!first || !second || first === second) return false;
      const { rows } = await pool.query(
        `SELECT EXISTS (
           SELECT 1
           FROM user_blocks
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
         ) AS blocked`,
        [first, second],
      );
      return rows[0]?.blocked === true;
    },
    async close() {
      await pool.end?.();
    },
  };
}

export function resolvePlatformBlockStoreMode(env: NodeJS.ProcessEnv = process.env): 'none' | 'postgres' {
  const configured = env.PLATFORM_BLOCK_STORE?.trim().toLowerCase();
  if (configured === 'postgres') return 'postgres';
  if (env.NODE_ENV === 'production' || env.DATABASE_URL || env.PG_HOST || env.PG_PASSWORD) return 'postgres';
  return 'none';
}

export function createPlatformBlockStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PlatformBlockStore {
  if (resolvePlatformBlockStoreMode(env) === 'none') return createEmptyPlatformBlockStore();
  const databaseUrl =
    postgresConnectionString(env) ||
    `postgres://${env.PG_USER || 'postgres'}:${env.PG_PASSWORD || ''}@${env.PG_HOST || 'localhost'}:${env.PG_PORT || '5432'}/${env.PG_DATABASE || 'postgres'}`;
  return createPostgresPlatformBlockStore(
    new Pool({
      connectionString: databaseUrl,
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      ssl: postgresSslConfig(env),
    }),
  );
}
