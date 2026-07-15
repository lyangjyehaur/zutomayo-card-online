import { Pool, type QueryResultRow } from 'pg';
import { createRequire } from 'node:module';
import { normalizePlatformUserId, platformStoreQueryTimeoutMs } from './friendStore';
import { postgresConnectionString, postgresSslConfig } from '../runtimeSecurityConfig';

const require = createRequire(import.meta.url);
const { acquireAccountMutationLocks } = require('../../api/accountMutationLock.cjs') as {
  acquireAccountMutationLocks: (
    client: Queryable,
    userIds: string[],
    options: { requireLiveUsers: false },
  ) => Promise<QueryResultRow[]>;
};

export type PlatformPairTransition = () => Promise<boolean>;

export interface PlatformBlockStore {
  areUsersBlocked(firstUserId: string, secondUserId: string): Promise<boolean>;
  /**
   * Runs the final in-memory room transition while holding the same pair of
   * PostgreSQL transaction advisory locks used by relationship writers.
   */
  withPairTransitionFence(
    firstUserId: string,
    secondUserId: string,
    transition: PlatformPairTransition,
  ): Promise<boolean>;
  close?(): Promise<void>;
}

interface PlatformStoreRow extends QueryResultRow {
  blocked?: unknown;
  live_count?: unknown;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: PlatformStoreRow[] }>;
}

interface TransactionClient extends Queryable {
  release?: () => void;
}

interface TransactionPool extends Queryable {
  connect?: () => Promise<TransactionClient>;
  end?: () => Promise<void>;
  release?: () => void;
}

async function queryPairBlocked(queryable: Queryable, firstUserId: string, secondUserId: string): Promise<boolean> {
  const { rows } = await queryable.query(
    `SELECT EXISTS (
       SELECT 1
       FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
     ) AS blocked`,
    [firstUserId, secondUserId],
  );
  return rows[0]?.blocked === true;
}

async function queryPairLive(queryable: Queryable, firstUserId: string, secondUserId: string): Promise<boolean> {
  const { rows } = await queryable.query(
    `SELECT COUNT(id)::integer AS live_count
       FROM users
      WHERE id IN ($1, $2)
        AND deleted_at IS NULL`,
    [firstUserId, secondUserId],
  );
  return Number(rows[0]?.live_count) === 2;
}

export function createEmptyPlatformBlockStore(): PlatformBlockStore {
  return {
    async areUsersBlocked() {
      return false;
    },
    async withPairTransitionFence(_firstUserId, _secondUserId, transition) {
      return transition();
    },
  };
}

export function createPostgresPlatformBlockStore(pool: TransactionPool): PlatformBlockStore {
  return {
    async areUsersBlocked(firstUserId, secondUserId) {
      const first = normalizePlatformUserId(firstUserId);
      const second = normalizePlatformUserId(secondUserId);
      if (!first || !second || first === second) return false;
      return queryPairBlocked(pool, first, second);
    },
    async withPairTransitionFence(firstUserId, secondUserId, transition) {
      const first = normalizePlatformUserId(firstUserId);
      const second = normalizePlatformUserId(secondUserId);
      if (!first || !second || first === second) return false;

      const client = pool.connect ? await pool.connect() : pool;
      try {
        // READ COMMITTED is part of the fence contract: after an advisory-lock
        // wait, the block query must receive a fresh snapshot that includes the
        // relationship writer's commit.
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
        // Relationship writers acquire these locks before changing
        // user_blocks/user_friends and before committing their outbox row.
        // Holding them through transition() makes the DB check and the room's
        // one-way state change a single linearized operation.
        await acquireAccountMutationLocks(client, [first, second], { requireLiveUsers: false });
        if (!(await queryPairLive(client, first, second))) {
          await client.query('COMMIT');
          return false;
        }
        if (await queryPairBlocked(client, first, second)) {
          await client.query('COMMIT');
          return false;
        }
        const transitioned = await transition();
        await client.query('COMMIT');
        return transitioned;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release?.();
      }
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
  const queryTimeoutMs = platformStoreQueryTimeoutMs(env);
  const databaseUrl =
    postgresConnectionString(env) ||
    `postgres://${env.PG_USER || 'postgres'}:${env.PG_PASSWORD || ''}@${env.PG_HOST || 'localhost'}:${env.PG_PORT || '5432'}/${env.PG_DATABASE || 'postgres'}`;
  return createPostgresPlatformBlockStore(
    new Pool({
      connectionString: databaseUrl,
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      query_timeout: queryTimeoutMs,
      statement_timeout: queryTimeoutMs,
      ssl: postgresSslConfig(env),
    }),
  );
}
