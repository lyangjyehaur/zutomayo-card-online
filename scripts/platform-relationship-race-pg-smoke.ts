import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { createPostgresPlatformBlockStore } from '../src/platform/blockStore';
import { createPostgresPlatformFriendStore } from '../src/platform/friendStore';
import { InviteRoom } from '../src/platform/rooms/InviteRoom';
import { QuickMatchRoom } from '../src/platform/rooms/QuickMatchRoom';
import type { PlatformClient, PlatformClientProfile } from '../src/platform/rooms/types';

const require = createRequire(import.meta.url);
const { blockUser } = require('../api/socialSafetyService.cjs') as {
  blockUser: (input: { pool: PausablePool; userId: string; targetUserId: string }) => Promise<{
    ok: boolean;
    status?: number;
  }>;
};
const { removeFriend } = require('../api/friendService.cjs') as {
  removeFriend: (input: { pool: PausablePool; userId: string; friendUserId: string }) => Promise<{
    ok: boolean;
    status?: number;
  }>;
};
const { postgresSslConfig } = require('../api/runtimeSecurityConfig.cjs') as {
  postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
};

type QueryableClient = Pick<PoolClient, 'query' | 'release'>;
type PausablePool = Pick<Pool, 'query'> & { connect: () => Promise<QueryableClient> };
type RelayEvent = { type: string; payload: unknown };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rolePool(userKey: string, passwordKey: string): Pool {
  const user = process.env[userKey];
  const password = process.env[passwordKey];
  if (!user || !password) throw new Error(`${userKey} and ${passwordKey} are required`);
  return new Pool({
    host: process.env.PG_HOST || 'postgres',
    port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE,
    user,
    password,
    ssl: postgresSslConfig(process.env),
    max: 4,
  });
}

async function assertRole(pool: Pool, expected: string | undefined): Promise<void> {
  const current = await pool.query<{ current_user: string }>('SELECT current_user');
  assert.equal(current.rows[0]?.current_user, expected);
}

function pauseBefore(
  pool: Pool,
  sqlFragment: string,
): {
  pool: PausablePool;
  entered: Promise<void>;
  resume: () => void;
} {
  const entered = deferred();
  const resume = deferred();
  return {
    entered: entered.promise,
    resume: resume.resolve,
    pool: {
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect();
        let paused = false;
        return {
          async query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
            if (!paused && sql.includes(sqlFragment)) {
              paused = true;
              entered.resolve();
              await resume.promise;
            }
            return client.query<R>(sql, params) as Promise<QueryResult<R>>;
          },
          release: () => client.release(),
        } as QueryableClient;
      },
    },
  };
}

function relayClient(sessionId: string, userId: string): PlatformClient {
  const profile: PlatformClientProfile = {
    sessionId,
    userId,
    displayName: userId,
    role: 'player',
    joinedAt: Date.now(),
  };
  return {
    sessionId,
    auth: { userId, displayName: userId, role: 'player', authenticated: true },
    userData: profile,
    send() {},
    leave() {},
  } as unknown as PlatformClient;
}

function captureRoom(room: QuickMatchRoom | InviteRoom): RelayEvent[] {
  const events: RelayEvent[] = [];
  Object.assign(room, {
    setMatchmaking: async () => undefined,
    broadcast: (type: string, payload: unknown) => {
      events.push({ type, payload });
    },
  });
  return events;
}

async function waitForRelay(room: QuickMatchRoom | InviteRoom, inFlight: boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Boolean((room as unknown as { finalRelayInFlight: boolean }).finalRelayInFlight) === inFlight) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for relay in-flight=${inFlight}`);
}

async function verifyQuickMatchBlockRace(apiPool: Pool, platformPool: Pool, first: string, second: string) {
  const blockStore = createPostgresPlatformBlockStore(platformPool);
  QuickMatchRoom.configureBlockStore(blockStore);
  const room = new QuickMatchRoom();
  const events = captureRoom(room);
  const host = relayClient('quick-host', first);
  Object.assign(room, {
    status: 'matched',
    hostSessionId: host.sessionId,
    matchedUserIds: [first, second],
  });

  const writer = pauseBefore(apiPool, 'INSERT INTO user_blocks');
  const block = blockUser({ pool: writer.pool, userId: first, targetUserId: second });
  await writer.entered;

  const relay = (
    room as unknown as {
      finishBoardgameMatch: (client: PlatformClient, message: { boardgameMatchID: string }) => Promise<void>;
    }
  ).finishBoardgameMatch(host, { boardgameMatchID: 'race-quick-match' });
  await waitForRelay(room, true);
  assert.equal(
    events.some((event) => event.type === 'boardgameMatchReady'),
    false,
  );
  assert.equal((room as unknown as { status: string }).status, 'matched');

  writer.resume();
  assert.equal((await block).ok, true);
  await relay;
  assert.equal((room as unknown as { status: string }).status, 'cancelled');
  assert.equal((room as unknown as { boardgameMatchID?: string }).boardgameMatchID, undefined);
  assert.equal(
    events.some((event) => event.type === 'boardgameMatchReady'),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === 'quickMatchCancelled' &&
        (event.payload as { reason?: string }).reason === 'relationship_changed',
    ),
    true,
  );
}

async function verifyInviteFriendshipRace(apiPool: Pool, platformPool: Pool, first: string, second: string) {
  const blockStore = createPostgresPlatformBlockStore(platformPool);
  const friendStore = createPostgresPlatformFriendStore(platformPool);
  InviteRoom.configureBlockStore(blockStore);
  InviteRoom.configureFriendStore(friendStore, { enforceFriendship: true });
  const room = new InviteRoom();
  const events = captureRoom(room);
  const inviter = relayClient('invite-host', first);
  const inviteId = `friend:v1:${encodeURIComponent(first)}:${encodeURIComponent(second)}`;
  Object.assign(room, {
    inviteId,
    inviterUserId: first,
    targetUserId: second,
    inviter: inviter.userData,
    status: 'accepted',
  });

  const writer = pauseBefore(apiPool, 'DELETE FROM user_friends');
  const removal = removeFriend({ pool: writer.pool, userId: first, friendUserId: second });
  await writer.entered;

  const relay = (
    room as unknown as {
      finishBoardgameMatch: (client: PlatformClient, message: { boardgameMatchID: string }) => Promise<void>;
    }
  ).finishBoardgameMatch(inviter, { boardgameMatchID: 'race-invite-match' });
  await waitForRelay(room, true);
  assert.equal(
    events.some((event) => event.type === 'boardgameMatchReady'),
    false,
  );
  assert.equal((room as unknown as { status: string }).status, 'accepted');

  writer.resume();
  assert.equal((await removal).ok, true);
  await relay;
  assert.equal((room as unknown as { status: string }).status, 'cancelled');
  assert.equal((room as unknown as { boardgameMatchID?: string }).boardgameMatchID, undefined);
  assert.equal(
    events.some((event) => event.type === 'boardgameMatchReady'),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === 'inviteCancelled' &&
        (event.payload as { inviteId?: string; reason?: string }).inviteId === inviteId &&
        (event.payload as { reason?: string }).reason === 'relationship_changed',
    ),
    true,
  );
}

async function main(): Promise<void> {
  const migrationPool = rolePool('PG_MIGRATION_USER', 'PG_MIGRATION_PASSWORD');
  const apiPool = rolePool('PG_API_USER', 'PG_API_PASSWORD');
  const platformPool = rolePool('PG_PLATFORM_USER', 'PG_PLATFORM_PASSWORD');
  const suffix = randomUUID();
  const quickUsers = [`relay-quick-a:${suffix}`, `relay-quick-b:${suffix}`] as const;
  const inviteUsers = [`relay-invite-a:${suffix}`, `relay-invite-b:${suffix}`] as const;
  const users = [...quickUsers, ...inviteUsers];

  try {
    await Promise.all([
      assertRole(migrationPool, process.env.PG_MIGRATION_USER),
      assertRole(apiPool, process.env.PG_API_USER),
      assertRole(platformPool, process.env.PG_PLATFORM_USER),
    ]);
    await migrationPool.query(
      `INSERT INTO users (id, email, password_hash, salt, nickname)
       SELECT id, id || '@relay-smoke.invalid', 'hash', 'salt', id
       FROM unnest($1::text[]) AS id`,
      [users],
    );
    await migrationPool.query(
      `INSERT INTO user_friends (user_id, friend_user_id)
       VALUES ($1, $2), ($2, $1)`,
      [...inviteUsers],
    );

    await verifyQuickMatchBlockRace(apiPool, platformPool, quickUsers[0], quickUsers[1]);
    await verifyInviteFriendshipRace(apiPool, platformPool, inviteUsers[0], inviteUsers[1]);
    process.stdout.write('Platform relay/relationship writer PostgreSQL concurrency smoke passed\n');
  } finally {
    QuickMatchRoom.configureBlockStore(null);
    InviteRoom.configureBlockStore(null);
    InviteRoom.configureFriendStore(
      {
        async listFriendUserIds() {
          return [];
        },
      },
      { enforceFriendship: false },
    );
    await migrationPool
      .query('DELETE FROM relationship_change_outbox WHERE user_ids && $1::text[]', [users])
      .catch(() => undefined);
    await migrationPool.query('DELETE FROM users WHERE id = ANY($1::text[])', [users]).catch(() => undefined);
    await Promise.all([migrationPool.end(), apiPool.end(), platformPool.end()]);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
