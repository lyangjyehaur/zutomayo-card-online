import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { Server, State } from 'boardgame.io';
import { Pool, type PoolClient } from 'pg';
import { MatchAccountDeletionLockedError, PostgresAdapter } from '../src/server/db/postgres-adapter';
import { postgresSslConfig } from '../src/runtimeSecurityConfig';

const require = createRequire(import.meta.url);
const { deleteAccount } = require('../api/accountLifecycleService.cjs') as {
  deleteAccount: (input: { pool: Pool; userId: string }) => Promise<{ ok: boolean; status?: number; error?: string }>;
};

const ACCOUNT_ROW_LOCK_SQL = 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE';
const API_APPLICATION_NAME = 'boardgame-metadata-pg-smoke-api';

type BeforeConnectHook = () => Promise<void>;
type AfterQueryHook = (sql: string, params?: unknown[]) => Promise<void>;

interface ControlledPool {
  pool: Pool;
  setBeforeConnect(hook?: BeforeConnectHook): void;
  setAfterQuery(hook?: AfterQueryHook): void;
}

interface Fixture {
  deleteFirstUserId: string;
  deleteFirstMatchId: string;
  writerFirstUserId: string;
  writerFirstMatchId: string;
}

interface StoredMatch {
  state: State | null;
  metadata: Record<string, unknown> | null;
  seat_exists: boolean;
}

function requiredEnvironment(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rolePool(role: 'api' | 'game'): Pool {
  const prefix = role === 'api' ? 'PG_API' : 'PG_GAME';
  return new Pool({
    host: requiredEnvironment('PG_HOST'),
    port: Number(process.env.PG_PORT) || 5432,
    user: requiredEnvironment(`${prefix}_USER`),
    password: requiredEnvironment(`${prefix}_PASSWORD`),
    database: requiredEnvironment('PG_DATABASE'),
    ssl: postgresSslConfig(process.env),
    max: 4,
    connectionTimeoutMillis: 5_000,
    application_name: role === 'api' ? API_APPLICATION_NAME : 'boardgame-metadata-pg-smoke-game',
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 10_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function controlledPool(underlying: Pool): ControlledPool {
  let beforeConnect: BeforeConnectHook | undefined;
  let afterQuery: AfterQueryHook | undefined;
  const proxy = {
    query(sql: string, params?: unknown[]) {
      return underlying.query(sql, params);
    },
    async connect() {
      if (beforeConnect) await beforeConnect();
      const client = await underlying.connect();
      return {
        async query(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params);
          if (afterQuery) await afterQuery(sql, params);
          return result;
        },
        release() {
          client.release();
        },
      } as unknown as PoolClient;
    },
    end() {
      return underlying.end();
    },
  } as unknown as Pool;

  return {
    pool: proxy,
    setBeforeConnect(hook) {
      beforeConnect = hook;
    },
    setAfterQuery(hook) {
      afterQuery = hook;
    },
  };
}

function initialState(userId: string): State {
  return {
    _stateID: 0,
    G: { step: 'janken', owner: userId },
    ctx: { turn: 0, currentPlayer: '0' },
    plugins: {},
  } as State;
}

function initialMetadata(userId: string): Server.MatchData {
  return {
    gameName: 'zutomayo-card',
    players: {
      0: {
        id: 0,
        name: `Initial ${userId}`,
        credentials: `initial-credential:${userId}`,
        data: { userId, identitySource: 'server' },
        isConnected: false,
      },
      1: { id: 1, isConnected: false },
    },
    setupData: { owner: userId, rulesVersion: 'smoke' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function staleMetadata(userId: string, identityMarker: string, writeProbe: string): Server.MatchData {
  return {
    ...initialMetadata(userId),
    players: {
      0: {
        id: 0,
        name: `Stale ${identityMarker}`,
        credentials: `stale-credential:${identityMarker}`,
        data: { userId, identityMarker },
        isConnected: true,
      },
      1: { id: 1, isConnected: true },
    },
    setupData: { owner: userId, rulesVersion: 'stale' },
    nextMatchID: writeProbe,
    updatedAt: 99,
  };
}

async function seedFixture(apiPool: Pool, adapter: PostgresAdapter, fixture: Fixture): Promise<void> {
  await apiPool.query(
    `INSERT INTO users (id, email, password_hash, salt, nickname)
     VALUES ($1, $2, 'hash', 'salt', 'Metadata Delete First'),
            ($3, $4, 'hash', 'salt', 'Metadata Writer First')`,
    [
      fixture.deleteFirstUserId,
      `${fixture.deleteFirstUserId}@example.invalid`,
      fixture.writerFirstUserId,
      `${fixture.writerFirstUserId}@example.invalid`,
    ],
  );
  await adapter.createMatch(fixture.deleteFirstMatchId, {
    initialState: initialState(fixture.deleteFirstUserId),
    metadata: initialMetadata(fixture.deleteFirstUserId),
  });
  await adapter.createMatch(fixture.writerFirstMatchId, {
    initialState: initialState(fixture.writerFirstUserId),
    metadata: initialMetadata(fixture.writerFirstUserId),
  });
  await apiPool.query(
    `INSERT INTO bjg_match_seats (match_id, player_id, user_id, credential_hash)
     VALUES ($1, '0', $2, 'metadata-delete-first'),
            ($3, '0', $4, 'metadata-writer-first')`,
    [fixture.deleteFirstMatchId, fixture.deleteFirstUserId, fixture.writerFirstMatchId, fixture.writerFirstUserId],
  );
}

async function cleanupFixture(apiPool: Pool, fixture: Fixture): Promise<void> {
  const userIds = [fixture.deleteFirstUserId, fixture.writerFirstUserId];
  const matchIds = [fixture.deleteFirstMatchId, fixture.writerFirstMatchId];
  await apiPool.query(
    `DELETE FROM relationship_change_outbox
      WHERE user_ids && $1::text[] OR actor_user_id = ANY($1::text[])`,
    [userIds],
  );
  await apiPool.query('DELETE FROM bjg_matches WHERE match_id = ANY($1::text[])', [matchIds]);
  await apiPool.query('DELETE FROM users WHERE id = ANY($1::text[])', [userIds]);
}

async function storedMatch(apiPool: Pool, matchId: string, userId: string): Promise<StoredMatch> {
  const row = (
    await apiPool.query<StoredMatch>(
      `SELECT state, metadata,
              EXISTS (
                SELECT 1 FROM bjg_match_seats
                 WHERE match_id = $1 AND user_id = $2
              ) AS seat_exists
         FROM bjg_matches
        WHERE match_id = $1`,
      [matchId, userId],
    )
  ).rows[0];
  if (!row) throw new Error(`boardgame metadata smoke match disappeared: ${matchId}`);
  return row;
}

function assertDeletedIdentity(
  row: StoredMatch,
  { userId, identityMarker }: { userId: string; identityMarker: string },
): void {
  if (!row.metadata || row.metadata.accountDeletionLocked !== true) {
    throw new Error('deleted boardgame match is missing the durable accountDeletionLocked marker');
  }
  if (row.seat_exists) throw new Error('deleted boardgame seat still exists');
  const serialized = JSON.stringify([row.state, row.metadata]);
  if (serialized.includes(userId) || serialized.includes(identityMarker)) {
    throw new Error('deleted boardgame match retained stale identity metadata');
  }
  const players = row.metadata.players as Record<string, Record<string, unknown>> | undefined;
  const deletedPlayer = players?.['0'];
  if (deletedPlayer && ['name', 'credentials', 'data'].some((key) => key in deletedPlayer)) {
    throw new Error('deleted boardgame player retained identity-bearing fields');
  }
}

async function waitForBlockedDeletion(apiPool: Pool, isSettled: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (isSettled()) throw new Error('account deletion settled before the metadata writer released its lock');
    const blocked = (
      await apiPool.query<{ blocked: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM pg_locks AS lock
             JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
            WHERE lock.locktype = 'advisory'
              AND lock.granted = FALSE
              AND activity.application_name = $1
         ) AS blocked`,
        [API_APPLICATION_NAME],
      )
    ).rows[0]?.blocked;
    if (blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('account deletion did not wait on the metadata writer account lock');
}

async function assertDeleteFirst(
  apiPool: Pool,
  adapter: PostgresAdapter,
  controller: ControlledPool,
  fixture: Fixture,
): Promise<void> {
  const identityMarker = `delete-first-identity:${fixture.deleteFirstUserId}`;
  const metadataWriteProbe = `delete-first-metadata-write:${fixture.deleteFirstMatchId}`;
  const stateWriteProbe = `delete-first-state-write:${fixture.deleteFirstMatchId}`;
  const connectReached = deferred();
  const allowConnect = deferred();
  let writing: Promise<void> | undefined;
  try {
    controller.setBeforeConnect(async () => {
      connectReached.resolve();
      await allowConnect.promise;
    });
    writing = adapter.setMetadata(
      fixture.deleteFirstMatchId,
      staleMetadata(fixture.deleteFirstUserId, identityMarker, metadataWriteProbe),
    );
    await withTimeout(connectReached.promise, 'delete-first setMetadata did not reach its transaction boundary');

    const deletion = await withTimeout(
      deleteAccount({ pool: apiPool, userId: fixture.deleteFirstUserId }),
      'delete-first metadata account deletion did not commit',
    );
    if (!deletion.ok) throw new Error(`delete-first metadata account deletion failed: ${JSON.stringify(deletion)}`);
    allowConnect.resolve();
    await withTimeout(writing, 'delete-first setMetadata did not settle after deletion');
    controller.setBeforeConnect();

    const staleState = {
      _stateID: 1,
      G: { step: 'turnSet', owner: fixture.deleteFirstUserId, writeProbe: stateWriteProbe },
      ctx: { turn: 1, currentPlayer: '0' },
      plugins: {},
    } as State;
    let stateError: unknown;
    try {
      await adapter.setState(fixture.deleteFirstMatchId, staleState);
    } catch (error) {
      stateError = error;
    }
    if (
      !(stateError instanceof MatchAccountDeletionLockedError) ||
      stateError.code !== 'MATCH_ACCOUNT_DELETION_LOCKED'
    ) {
      throw new Error(`delete-first stale setState was not rejected by the deletion marker: ${String(stateError)}`);
    }

    const row = await storedMatch(apiPool, fixture.deleteFirstMatchId, fixture.deleteFirstUserId);
    assertDeletedIdentity(row, { userId: fixture.deleteFirstUserId, identityMarker });
    if (row.state?._stateID !== 0 || JSON.stringify(row.state).includes(stateWriteProbe)) {
      throw new Error('delete-first stale setState changed the deleted match');
    }
    if (row.metadata?.nextMatchID === metadataWriteProbe) {
      throw new Error('delete-first stale setMetadata changed the deleted match');
    }
  } finally {
    allowConnect.resolve();
    controller.setBeforeConnect();
    if (writing) await Promise.allSettled([writing]);
  }
}

async function assertWriterFirst(
  apiPool: Pool,
  adapter: PostgresAdapter,
  controller: ControlledPool,
  fixture: Fixture,
): Promise<void> {
  const identityMarker = `writer-first-identity:${fixture.writerFirstUserId}`;
  const metadataWriteProbe = `writer-first-metadata-write:${fixture.writerFirstMatchId}`;
  const lockReached = deferred();
  const allowWrite = deferred();
  let writing: Promise<void> | undefined;
  let deleting: Promise<{ ok: boolean; status?: number; error?: string }> | undefined;
  try {
    controller.setAfterQuery(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL && params?.[0] === fixture.writerFirstUserId) {
        lockReached.resolve();
        await allowWrite.promise;
      }
    });
    writing = adapter.setMetadata(
      fixture.writerFirstMatchId,
      staleMetadata(fixture.writerFirstUserId, identityMarker, metadataWriteProbe),
    );
    await withTimeout(lockReached.promise, 'writer-first setMetadata did not acquire its account lock');

    let deletionSettled = false;
    deleting = deleteAccount({ pool: apiPool, userId: fixture.writerFirstUserId }).finally(() => {
      deletionSettled = true;
    });
    await waitForBlockedDeletion(apiPool, () => deletionSettled);
    allowWrite.resolve();
    await withTimeout(writing, 'writer-first setMetadata deadlocked before commit');
    const deletion = await withTimeout(deleting, 'account deletion deadlocked behind setMetadata');
    if (!deletion.ok) throw new Error(`writer-first metadata account deletion failed: ${JSON.stringify(deletion)}`);

    const row = await storedMatch(apiPool, fixture.writerFirstMatchId, fixture.writerFirstUserId);
    assertDeletedIdentity(row, { userId: fixture.writerFirstUserId, identityMarker });
    if (row.metadata?.nextMatchID !== metadataWriteProbe) {
      throw new Error('writer-first metadata commit was not retained through deletion redaction');
    }
  } finally {
    allowWrite.resolve();
    controller.setAfterQuery();
    const pending: Promise<unknown>[] = [];
    if (writing) pending.push(writing);
    if (deleting) pending.push(deleting);
    await Promise.allSettled(pending);
  }
}

async function main(): Promise<void> {
  const prefix = crypto.randomUUID();
  const fixture: Fixture = {
    deleteFirstUserId: `metadata-delete-first-user:${prefix}`,
    deleteFirstMatchId: `metadata-delete-first-match:${prefix}`,
    writerFirstUserId: `metadata-writer-first-user:${prefix}`,
    writerFirstMatchId: `metadata-writer-first-match:${prefix}`,
  };
  const apiPool = rolePool('api');
  const gamePool = controlledPool(rolePool('game'));
  const adapter = new PostgresAdapter({
    pool: gamePool.pool,
    createIndexes: false,
    runtimeSchemaDdl: false,
    expectedSchemaMigration: requiredEnvironment('EXPECTED_SCHEMA_MIGRATION'),
    expectedSchemaChecksum: requiredEnvironment('EXPECTED_SCHEMA_CHECKSUM'),
  });

  try {
    await adapter.connect();
    await seedFixture(apiPool, adapter, fixture);
    await assertDeleteFirst(apiPool, adapter, gamePool, fixture);
    await assertWriterFirst(apiPool, adapter, gamePool, fixture);
    process.stdout.write('Boardgame metadata account-deletion PostgreSQL smoke passed\n');
  } finally {
    await cleanupFixture(apiPool, fixture);
    await adapter.close();
    await apiPool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
