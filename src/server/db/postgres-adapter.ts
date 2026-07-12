import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Server, State, LogEntry } from 'boardgame.io';
import * as Sentry from '@sentry/node';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { shuffleDeck } from '../../game/cards/deckBuilder';
import { postgresConnectionString, postgresSslConfig } from '../../runtimeSecurityConfig';

const require = createRequire(import.meta.url);
const { assertRuntimeSchema } = require('../../../api/schemaGate.cjs') as {
  assertRuntimeSchema: (options: {
    pool: Pick<PoolClient, 'query'>;
    expectedMigration: string | undefined;
    expectedChecksum: string | undefined;
  }) => Promise<{ expectedMigration: string; expectedChecksum: string }>;
};
const { AccountMutationError, acquireAccountMutationLocks } = require('../../../api/accountMutationLock.cjs') as {
  AccountMutationError: new (userIds: string[]) => Error;
  acquireAccountMutationLocks: (
    client: PoolClient,
    userIds: string[],
    options?: { includeRetention?: boolean; requireLiveUsers?: boolean },
  ) => Promise<QueryResultRow[]>;
};

/**
 * boardgame.io StorageAPI.Async 的 Postgres 實作。
 *
 * 0.50.2 的 dist 只匯出 FlatFile/Server/SocketIO，不匯出 StorageAPI 抽象類別，
 * 因此這裡不繼承，改為 duck-typed 實作（type() 回傳 1 = ASYNC），
 * 在 server.ts 透過結構化斷言注入 Server({ db })。
 *
 * Schema（與 API server 共用同一個 PG instance，用 bjg_ 前綴隔離）：
 *   bjg_matches(match_id PK, state JSONB, initial_state JSONB,
 *               metadata JSONB, log JSONB, updated_at TIMESTAMPTZ)
 *
 * deltalog append 使用 PG 的 `||` JSONB concat operator，單一 UPDATE 即原子完成。
 *
 * boardgame.io 的 onUpdate 會先 fetch state、跑 reducer、廣播、最後 setState。
 * 多個 server instance 若同時從同一個 _stateID 開始處理 move，舊實作會讓較晚寫入者覆蓋較新狀態。
 * 這裡對 onUpdate 的 state fetch 取得 row lock，並在 setState 時檢查 _stateID 單調遞增。
 */

const TYPE_ASYNC = 1;

interface PostgresAdapterOptions {
  /** pg.Pool 完整設定（host/port/user/password/database/...）。 */
  pool?: Pool;
  /** 或只傳 connection string，由 adapter 自建 Pool。 */
  connectionString?: string;
  /** schema 初始化時是否建立索引（預設 true）。 */
  createIndexes?: boolean;
  /** Whether ranked result delivery is enabled for this process. */
  rankedMatchesEnabled?: boolean;
  /** Allow runtime CREATE TABLE/INDEX. Production must keep this disabled. */
  runtimeSchemaDdl?: boolean;
  /** Migration basename required when runtime DDL is disabled. */
  expectedSchemaMigration?: string;
  /** SHA-256 of the required migration file. */
  expectedSchemaChecksum?: string;
}

interface MatchRow extends QueryResultRow {
  match_id: string;
  state: State | null;
  initial_state: State | null;
  metadata: Server.MatchData | null;
  log: LogEntry[] | null;
  updated_at: Date;
}

interface FetchOpts {
  state?: boolean;
  log?: boolean;
  metadata?: boolean;
  initialState?: boolean;
}

interface ListMatchesOpts {
  gameName?: string;
  where?: {
    isGameover?: boolean;
    updatedBefore?: number;
    updatedAfter?: number;
  };
}

interface CreateMatchOpts {
  initialState: State;
  metadata: Server.MatchData;
}

interface UpdateLockContext {
  matchID: string;
  client: PoolClient;
  timeout: ReturnType<typeof setTimeout>;
  released: boolean;
}

export type BoardgamePlayerID = '0' | '1';

export type MatchSeatReservationErrorReason =
  | 'match_not_found'
  | 'seat_not_found'
  | 'seat_taken'
  | 'identity_taken'
  | 'invalid_credentials'
  | 'identity_mismatch';

export interface ReserveMatchSeatInput {
  matchID: string;
  playerID?: BoardgamePlayerID;
  playerName: string;
  playerData: Record<string, unknown>;
  userId: string;
  rankedEligible: boolean;
  credentials: string;
  deckReservationId?: string;
  deckRulesVersion?: string;
}

export interface ResumeMatchSeatInput {
  matchID: string;
  playerID: BoardgamePlayerID;
  credentials: string;
  authenticatedUserId?: string;
}

export interface ReservedMatchSeat {
  playerID: BoardgamePlayerID;
  userId: string;
  rankedEligible: boolean;
  metadata: Server.MatchData;
}

export interface BindDeckReservationInput {
  matchID: string;
  playerID: BoardgamePlayerID;
  userId: string;
  reservationId: string;
  rulesVersion: string;
}

interface DeckReservationRow extends QueryResultRow {
  id: string;
  user_id: string;
  deck_version: string;
  rules_version: string;
  card_ids: unknown;
  expires_at: Date | string;
  match_id: string | null;
  player_id: BoardgamePlayerID | null;
}

interface MatchSeatRow extends QueryResultRow {
  match_id: string;
  player_id: BoardgamePlayerID;
  user_id: string;
  ranked_eligible: boolean;
  credential_hash: string;
}

interface MutableMatchPlayer {
  name?: string;
  credentials?: string;
  data?: unknown;
}

export class MatchSeatReservationError extends Error {
  constructor(
    public readonly reason: MatchSeatReservationErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'MatchSeatReservationError';
  }
}

function credentialHash(credentials: string): string {
  return crypto.createHash('sha256').update(credentials).digest('hex');
}

function safeCredentialHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function firstAvailablePlayerID(metadata: Server.MatchData): BoardgamePlayerID | undefined {
  const players = metadata.players as Record<string, { name?: string } | undefined>;
  for (const playerID of ['0', '1'] as const) {
    if (players[playerID] && !players[playerID]?.name) return playerID;
  }
  return undefined;
}

function metadataRulesVersion(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'legacy';
  const setupData = (metadata as Record<string, unknown>).setupData;
  if (!setupData || typeof setupData !== 'object' || Array.isArray(setupData)) return 'legacy';
  const value = (setupData as Record<string, unknown>).rulesVersion;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'legacy';
}

interface CanonicalTerminalResult {
  winnerPlayer: 0 | 1 | null;
  turns: number;
  durationSeconds: number;
  actionLog: unknown[];
  stateID: number | null;
  completedAt: string | null;
}

function canonicalTerminalResult(state: State): CanonicalTerminalResult | null {
  const candidate = state as State & {
    G?: {
      step?: unknown;
      winner?: unknown;
      turnNumber?: unknown;
      matchStartedAt?: unknown;
      matchEndedAt?: unknown;
      actionLog?: unknown;
    };
    ctx?: { gameover?: unknown };
  };
  const G = candidate.G;
  const gameover = candidate.ctx?.gameover;
  if (!gameover && G?.step !== 'gameOver') return null;

  let winnerPlayer: 0 | 1 | null = null;
  if (gameover && typeof gameover === 'object' && !Array.isArray(gameover)) {
    const result = gameover as { draw?: unknown; winner?: unknown };
    if (result.draw !== true) {
      if (result.winner === 0 || result.winner === '0') winnerPlayer = 0;
      if (result.winner === 1 || result.winner === '1') winnerPlayer = 1;
    }
  } else if (G?.winner === 0 || G?.winner === '0') {
    winnerPlayer = 0;
  } else if (G?.winner === 1 || G?.winner === '1') {
    winnerPlayer = 1;
  }

  const turns = Number.isInteger(G?.turnNumber) ? Math.max(0, Math.min(Number(G?.turnNumber), 9999)) : 0;
  const startedAt = Number.isFinite(G?.matchStartedAt) ? Number(G?.matchStartedAt) : 0;
  const endedAt = Number.isFinite(G?.matchEndedAt) ? Number(G?.matchEndedAt) : 0;
  const durationSeconds =
    startedAt > 0 && endedAt >= startedAt ? Math.min(Math.floor((endedAt - startedAt) / 1000), 86400) : 0;
  const completedAtDate = new Date(endedAt);
  const completedAt = endedAt > 0 && Number.isFinite(completedAtDate.getTime()) ? completedAtDate.toISOString() : null;
  return {
    winnerPlayer,
    turns,
    durationSeconds,
    actionLog: Array.isArray(G?.actionLog) ? G.actionLog.slice(0, 2000) : [],
    stateID: typeof state._stateID === 'number' ? state._stateID : null,
    completedAt,
  };
}

export class StaleStateWriteError extends Error {
  constructor(matchID: string, expectedStateID: number, nextStateID: number) {
    super(
      `Stale state write rejected for match ${matchID}: expected current _stateID ${expectedStateID}, next _stateID ${nextStateID}`,
    );
    this.name = 'StaleStateWriteError';
  }
}

export class PostgresAdapter {
  private pool: Pool;
  private createIndexes: boolean;
  private rankedMatchesEnabled: boolean;
  private runtimeSchemaDdl: boolean;
  private expectedSchemaMigration: string;
  private expectedSchemaChecksum: string;
  private connected = false;
  private closed = false;
  private updateLocks = new Map<string, UpdateLockContext>();

  constructor(opts: PostgresAdapterOptions = {}) {
    this.pool =
      opts.pool ??
      new Pool({
        connectionString:
          (opts.connectionString
            ? postgresConnectionString({ ...process.env, DATABASE_URL: opts.connectionString })
            : postgresConnectionString(process.env)) ||
          `postgres://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || ''}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE || 'postgres'}`,
        max: Number(process.env.PG_POOL_MAX) || 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ssl: postgresSslConfig(process.env),
      });
    this.createIndexes = opts.createIndexes ?? true;
    // Keep unit-test/dev defaults backwards compatible, while production
    // Compose explicitly sets RANKED_MATCHES_ENABLED=false when the worker is
    // intentionally disabled. Such results must be terminally unrated rather
    // than accumulating forever as pending rows.
    this.rankedMatchesEnabled = opts.rankedMatchesEnabled ?? process.env.RANKED_MATCHES_ENABLED !== 'false';
    this.runtimeSchemaDdl = opts.runtimeSchemaDdl ?? process.env.RUNTIME_SCHEMA_DDL !== 'false';
    this.expectedSchemaMigration = opts.expectedSchemaMigration ?? process.env.EXPECTED_SCHEMA_MIGRATION ?? '';
    this.expectedSchemaChecksum = (
      opts.expectedSchemaChecksum ??
      process.env.EXPECTED_SCHEMA_CHECKSUM ??
      ''
    ).toLowerCase();
  }

  type() {
    return TYPE_ASYNC;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connected) return;
    const client = await this.pool.connect();
    try {
      if (!this.runtimeSchemaDdl) {
        await assertRuntimeSchema({
          pool: client,
          expectedMigration: this.expectedSchemaMigration,
          expectedChecksum: this.expectedSchemaChecksum,
        });
        this.connected = true;
        return;
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS bjg_matches (
          match_id       TEXT PRIMARY KEY,
          state          JSONB,
          initial_state  JSONB,
          metadata       JSONB NOT NULL,
          log            JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS bjg_match_seats (
          match_id         TEXT NOT NULL REFERENCES bjg_matches(match_id) ON DELETE CASCADE,
          player_id        TEXT NOT NULL CHECK (player_id IN ('0', '1')),
          user_id          TEXT NOT NULL,
          ranked_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
          credential_hash  TEXT NOT NULL,
          reserved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_resumed_at  TIMESTAMPTZ,
          PRIMARY KEY (match_id, player_id),
          UNIQUE (match_id, user_id)
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS bjg_match_result_outbox (
          source_match_id    TEXT PRIMARY KEY REFERENCES bjg_matches(match_id) ON DELETE CASCADE,
          player0_user_id    TEXT,
          player1_user_id    TEXT,
          winner_player      SMALLINT CHECK (winner_player IS NULL OR winner_player IN (0, 1)),
          winner_user_id     TEXT,
          loser_user_id      TEXT,
          ranked_eligible    BOOLEAN NOT NULL DEFAULT FALSE,
          turns              INTEGER NOT NULL DEFAULT 0,
          duration_seconds   INTEGER NOT NULL DEFAULT 0,
          completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          rules_version      TEXT NOT NULL DEFAULT 'legacy',
          action_log         JSONB NOT NULL DEFAULT '[]'::jsonb,
          state_id           INTEGER,
          status             TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'processing', 'delivered', 'unrated')),
          attempt_count      INTEGER NOT NULL DEFAULT 0,
          next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          locked_at          TIMESTAMPTZ,
          last_error         TEXT,
          delivered_match_id TEXT,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          delivered_at       TIMESTAMPTZ
        );
      `);
      await client.query(
        `ALTER TABLE bjg_match_result_outbox
           ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      );
      if (this.createIndexes) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bjg_matches_updated_at ON bjg_matches (updated_at);`);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_bjg_matches_game_name ON bjg_matches ((metadata->>'gameName'));`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_bjg_match_seats_user ON bjg_match_seats (user_id, reserved_at DESC);`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_bjg_match_result_outbox_delivery
             ON bjg_match_result_outbox (status, next_attempt_at);`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_match_result_outbox_season_settlement
             ON bjg_match_result_outbox (rules_version, completed_at, status)
          WHERE ranked_eligible = TRUE;`,
        );
      }
      this.connected = true;
    } finally {
      client.release();
    }
  }

  async createMatch(matchID: string, opts: CreateMatchOpts): Promise<void> {
    if (this.closed) return;
    await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO bjg_matches (match_id, state, initial_state, metadata, log, updated_at)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, NOW())
         ON CONFLICT (match_id) DO NOTHING`,
        [matchID, JSON.stringify(opts.initialState), JSON.stringify(opts.initialState), JSON.stringify(opts.metadata)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setState(matchID: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    if (this.closed) return;
    await this.connect();

    const lock = this.updateLocks.get(matchID);
    if (lock && !lock.released) {
      try {
        await this.writeState(lock.client, matchID, state, deltalog);
        await this.releaseUpdateLock(lock, 'commit');
      } catch (err) {
        await this.releaseUpdateLock(lock, 'rollback');
        throw err;
      }
      return;
    }

    if (canonicalTerminalResult(state)) {
      await this.withTransaction(async (client) => {
        await this.writeState(client, matchID, state, deltalog);
      });
      return;
    }
    await this.writeState(this.pool, matchID, state, deltalog);
  }

  async setMetadata(matchID: string, metadata: Server.MatchData): Promise<void> {
    if (this.closed) return;
    await this.connect();
    await this.withTransaction(async (client) => {
      const currentResult = await client.query<Pick<MatchRow, 'metadata'>>(
        `SELECT metadata
           FROM bjg_matches
          WHERE match_id = $1
          FOR UPDATE`,
        [matchID],
      );
      let nextMetadata = metadata;
      const currentMetadata = currentResult.rows[0]?.metadata;
      if (currentMetadata?.players && metadata.players) {
        const reservedSeats = await client.query<{ player_id: BoardgamePlayerID }>(
          `SELECT player_id
             FROM bjg_match_seats
            WHERE match_id = $1
            FOR SHARE`,
          [matchID],
        );
        if (reservedSeats.rows.length > 0) {
          const currentPlayers = currentMetadata.players as Record<string, MutableMatchPlayer | undefined>;
          const incomingPlayers = { ...(metadata.players as Record<string, MutableMatchPlayer | undefined>) };
          for (const { player_id: playerID } of reservedSeats.rows) {
            const currentSeat = currentPlayers[playerID];
            if (!currentSeat) continue;
            const incomingSeat = incomingPlayers[playerID] || {};
            incomingPlayers[playerID] = {
              ...incomingSeat,
              name: currentSeat.name,
              credentials: currentSeat.credentials,
              data: currentSeat.data,
            };
          }
          nextMetadata = { ...metadata, players: incomingPlayers } as Server.MatchData;
        }
      }
      await client.query(
        `INSERT INTO bjg_matches (match_id, metadata, log, updated_at)
         VALUES ($1, $2, '[]'::jsonb, NOW())
         ON CONFLICT (match_id)
         DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()`,
        [matchID, JSON.stringify(nextMetadata)],
      );
    });
  }

  /** Atomically reserves a boardgame seat across all game replicas. */
  async reserveMatchSeat(input: ReserveMatchSeatInput): Promise<ReservedMatchSeat> {
    return this.withTransaction(async (client) => {
      try {
        await acquireAccountMutationLocks(client, [input.userId]);
      } catch (error) {
        if (error instanceof AccountMutationError) {
          throw new MatchSeatReservationError('identity_mismatch', 'Account is deleted or unavailable');
        }
        throw error;
      }
      const result = await client.query<MatchRow>(
        `SELECT match_id, state, initial_state, metadata
           FROM bjg_matches
          WHERE match_id = $1
          FOR UPDATE`,
        [input.matchID],
      );
      const match = result.rows[0];
      const metadata = match?.metadata;
      if (!match || !metadata) {
        throw new MatchSeatReservationError('match_not_found', `Match ${input.matchID} not found`);
      }

      const playerID = input.playerID ?? firstAvailablePlayerID(metadata);
      if (!playerID) {
        throw new MatchSeatReservationError('seat_taken', `Match ${input.matchID} has no available seats`);
      }
      const players = metadata.players as Record<string, MutableMatchPlayer | undefined>;
      const player = players[playerID];
      if (!player) {
        throw new MatchSeatReservationError('seat_not_found', `Player ${playerID} not found`);
      }
      if (player.name || player.credentials) {
        throw new MatchSeatReservationError('seat_taken', `Player ${playerID} is not available`);
      }

      const metadataIdentityTaken = Object.entries(players).some(([seatID, seat]) => {
        if (seatID === playerID || !seat?.data || typeof seat.data !== 'object' || Array.isArray(seat.data))
          return false;
        const data = seat.data as Record<string, unknown>;
        return data.identitySource === 'server' && data.userId === input.userId;
      });
      if (metadataIdentityTaken) {
        throw new MatchSeatReservationError(
          'identity_taken',
          `Identity ${input.userId} already owns a seat in match ${input.matchID}`,
        );
      }

      const existingReservation = await client.query<MatchSeatRow>(
        `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash
           FROM bjg_match_seats
          WHERE match_id = $1 AND (player_id = $2 OR user_id = $3)
          FOR UPDATE`,
        [input.matchID, playerID, input.userId],
      );
      const occupiedSeat = existingReservation.rows.find((seat) => seat.player_id === playerID);
      if (occupiedSeat) {
        throw new MatchSeatReservationError('seat_taken', `Player ${playerID} is not available`);
      }
      if (existingReservation.rows.length > 0) {
        throw new MatchSeatReservationError(
          'identity_taken',
          `Identity ${input.userId} already owns a seat in match ${input.matchID}`,
        );
      }

      await client.query(
        `INSERT INTO bjg_match_seats (
           match_id, player_id, user_id, ranked_eligible, credential_hash, reserved_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [input.matchID, playerID, input.userId, input.rankedEligible, credentialHash(input.credentials)],
      );

      player.name = input.playerName;
      player.credentials = input.credentials;
      player.data = input.playerData;
      if (input.deckReservationId) {
        if (!input.deckRulesVersion) {
          throw new MatchSeatReservationError('seat_taken', 'Deck rules version is required');
        }
        await this.bindDeckReservationWithClient(client, match, {
          matchID: input.matchID,
          playerID,
          userId: input.userId,
          reservationId: input.deckReservationId,
          rulesVersion: input.deckRulesVersion,
        });
      } else {
        await client.query(
          `UPDATE bjg_matches
              SET metadata = $2::jsonb, updated_at = NOW()
            WHERE match_id = $1`,
          [input.matchID, JSON.stringify(metadata)],
        );
      }

      return {
        playerID,
        userId: input.userId,
        rankedEligible: input.rankedEligible,
        metadata,
      };
    });
  }

  /**
   * Locks and verifies a reservation before issuing a fresh platform seat
   * proof. A trusted metadata-only seat from the previous release is
   * backfilled once so active sessions survive the migration.
   */
  async resumeMatchSeat(input: ResumeMatchSeatInput): Promise<ReservedMatchSeat> {
    return this.withTransaction(async (client) => {
      if (input.authenticatedUserId) {
        try {
          await acquireAccountMutationLocks(client, [input.authenticatedUserId]);
        } catch (error) {
          if (error instanceof AccountMutationError) {
            throw new MatchSeatReservationError('identity_mismatch', 'Account is deleted or unavailable');
          }
          throw error;
        }
      }
      const result = await client.query<MatchRow>(
        `SELECT match_id, metadata
           FROM bjg_matches
          WHERE match_id = $1
          FOR UPDATE`,
        [input.matchID],
      );
      const metadata = result.rows[0]?.metadata;
      if (!metadata) {
        throw new MatchSeatReservationError('match_not_found', `Match ${input.matchID} not found`);
      }
      const players = metadata.players as Record<string, MutableMatchPlayer | undefined>;
      const player = players[input.playerID];
      if (!player?.name || !player.credentials) {
        throw new MatchSeatReservationError('seat_not_found', `Player ${input.playerID} is not reserved`);
      }

      const expectedHash = credentialHash(input.credentials);
      let seat = (
        await client.query<MatchSeatRow>(
          `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash
             FROM bjg_match_seats
            WHERE match_id = $1 AND player_id = $2
            FOR UPDATE`,
          [input.matchID, input.playerID],
        )
      ).rows[0];

      if (!seat) {
        const playerData =
          player.data && typeof player.data === 'object' && !Array.isArray(player.data)
            ? (player.data as Record<string, unknown>)
            : {};
        const userId = typeof playerData.userId === 'string' ? playerData.userId : '';
        if (
          playerData.identitySource !== 'server' ||
          !userId ||
          !safeCredentialHashEqual(credentialHash(player.credentials), expectedHash)
        ) {
          throw new MatchSeatReservationError('invalid_credentials', 'Seat reservation proof is invalid');
        }
        const rankedEligible = playerData.rankedEligible === true;
        await client.query(
          `INSERT INTO bjg_match_seats (
             match_id, player_id, user_id, ranked_eligible, credential_hash, reserved_at, last_resumed_at
           )
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [input.matchID, input.playerID, userId, rankedEligible, expectedHash],
        );
        seat = {
          match_id: input.matchID,
          player_id: input.playerID,
          user_id: userId,
          ranked_eligible: rankedEligible,
          credential_hash: expectedHash,
        };
      }

      if (!safeCredentialHashEqual(seat.credential_hash, expectedHash)) {
        throw new MatchSeatReservationError('invalid_credentials', 'Seat reservation proof is invalid');
      }
      if (seat.ranked_eligible && input.authenticatedUserId !== seat.user_id) {
        throw new MatchSeatReservationError('identity_mismatch', 'Authenticated identity does not own this seat');
      }
      await client.query(
        `UPDATE bjg_match_seats
            SET last_resumed_at = NOW()
          WHERE match_id = $1 AND player_id = $2`,
        [input.matchID, input.playerID],
      );
      return {
        playerID: input.playerID,
        userId: seat.user_id,
        rankedEligible: seat.ranked_eligible,
        metadata,
      };
    });
  }

  /** Bind a server-owned deck to a seat before the first move is accepted. */
  async bindDeckReservation(input: BindDeckReservationInput): Promise<void> {
    await this.withTransaction(async (client) => {
      try {
        await acquireAccountMutationLocks(client, [input.userId]);
      } catch (error) {
        if (error instanceof AccountMutationError) {
          throw new MatchSeatReservationError('identity_mismatch', 'Account is deleted or unavailable');
        }
        throw error;
      }
      const row = (
        await client.query<MatchRow>(
          `SELECT match_id, state, initial_state, metadata
             FROM bjg_matches
            WHERE match_id = $1
            FOR UPDATE`,
          [input.matchID],
        )
      ).rows[0];
      if (!row?.state || !row.initial_state || !row.metadata) {
        throw new MatchSeatReservationError('match_not_found', `Match ${input.matchID} not found`);
      }
      await this.bindDeckReservationWithClient(client, row, input);
    });
  }

  private async bindDeckReservationWithClient(
    client: PoolClient,
    row: MatchRow,
    input: BindDeckReservationInput,
  ): Promise<void> {
    if (!row.state || !row.initial_state || !row.metadata) {
      throw new MatchSeatReservationError('match_not_found', `Match ${input.matchID} not found`);
    }
    const seat = (
      await client.query<MatchSeatRow>(
        `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash
             FROM bjg_match_seats
            WHERE match_id = $1 AND player_id = $2
            FOR UPDATE`,
        [input.matchID, input.playerID],
      )
    ).rows[0];
    if (!seat || seat.user_id !== input.userId) {
      throw new MatchSeatReservationError('identity_mismatch', 'Deck reservation does not own this seat');
    }

    const reservation = (
      await client.query<DeckReservationRow>(
        `SELECT id, user_id, deck_version, rules_version, card_ids, expires_at, match_id, player_id
             FROM deck_reservations
            WHERE id = $1
            FOR UPDATE`,
        [input.reservationId],
      )
    ).rows[0];
    if (!reservation || new Date(reservation.expires_at).getTime() <= Date.now()) {
      throw new MatchSeatReservationError('seat_taken', 'Deck reservation expired or does not exist');
    }
    if (reservation.user_id !== input.userId) {
      throw new MatchSeatReservationError(
        'identity_mismatch',
        'Deck reservation does not belong to authenticated user',
      );
    }
    if (reservation.rules_version !== input.rulesVersion) {
      throw new MatchSeatReservationError('seat_taken', 'Deck rules version does not match server');
    }
    if (reservation.match_id) {
      if (reservation.match_id === input.matchID && reservation.player_id === input.playerID) return;
      throw new MatchSeatReservationError('seat_taken', 'Deck reservation already bound');
    }

    const cardIds = reservation.card_ids;
    const cardCounts = new Map<string, number>();
    if (Array.isArray(cardIds)) {
      for (const id of cardIds) {
        if (typeof id === 'string') cardCounts.set(id, (cardCounts.get(id) ?? 0) + 1);
      }
    }
    if (
      !Array.isArray(cardIds) ||
      cardIds.length !== 20 ||
      cardIds.some((id) => typeof id !== 'string') ||
      [...cardCounts.values()].some((count) => count > 2)
    ) {
      throw new MatchSeatReservationError('seat_taken', 'Deck reservation contains invalid cards');
    }
    const state = JSON.parse(JSON.stringify(row.state)) as Record<string, unknown>;
    const initialState = JSON.parse(JSON.stringify(row.initial_state)) as Record<string, unknown>;
    const stateG = state.G as Record<string, unknown> | undefined;
    const initialG = initialState.G as Record<string, unknown> | undefined;
    if (!stateG || !initialG || stateG.step !== 'janken' || stateG.turnNumber !== 1) {
      throw new MatchSeatReservationError('seat_taken', 'Deck can only be bound before the first move');
    }
    // Reservations contain validated card definition IDs, but the game
    // server still owns instance creation and shuffle. Keep this path in
    // lockstep with setupGame: shuffle before drawing the opening hand.
    const deck = shuffleDeck(
      cardIds.map((defId, index) => ({
        instanceId: `server:${input.matchID}:${input.playerID}:${index}`,
        defId: defId as string,
        faceUp: false,
      })),
    );
    const openingHand = deck.slice(0, 5).map((card) => ({ ...card, faceUp: true }));
    const remainingDeck = deck.slice(5);
    const apply = (targetG: Record<string, unknown>) => {
      const players = targetG.players as Array<Record<string, unknown>> | undefined;
      const player = players?.[Number(input.playerID)];
      if (!player) throw new MatchSeatReservationError('seat_not_found', 'Player seat not found');
      player.deck = remainingDeck.map((card) => ({ ...card }));
      player.hand = openingHand.map((card) => ({ ...card }));
    };
    apply(stateG);
    apply(initialG);
    const metadata = JSON.parse(JSON.stringify(row.metadata)) as Record<string, unknown>;
    const setupData = (
      metadata.setupData && typeof metadata.setupData === 'object' ? metadata.setupData : {}
    ) as Record<string, unknown>;
    const slot = Number(input.playerID) === 0 ? '0' : '1';
    metadata.setupData = {
      ...setupData,
      [`deck${slot}Version`]: reservation.deck_version,
      rulesVersion: reservation.rules_version,
    };
    await client.query(
      `UPDATE bjg_matches
          SET state = $2::jsonb, initial_state = $3::jsonb, metadata = $4::jsonb, updated_at = NOW()
        WHERE match_id = $1`,
      [input.matchID, JSON.stringify(state), JSON.stringify(initialState), JSON.stringify(metadata)],
    );
    const consumed = await client.query(
      `UPDATE deck_reservations
          SET match_id = $2, player_id = $3, consumed_at = NOW()
        WHERE id = $1 AND user_id = $4 AND match_id IS NULL`,
      [input.reservationId, input.matchID, input.playerID, input.userId],
    );
    if (consumed.rowCount !== 1) {
      throw new MatchSeatReservationError('seat_taken', 'Deck reservation was bound concurrently');
    }
  }

  async fetch<O extends FetchOpts>(
    matchID: string,
    opts: O,
  ): Promise<{
    state?: State;
    log?: LogEntry[];
    metadata?: Server.MatchData;
    initialState?: State;
  }> {
    if (this.closed) return {};
    await this.connect();
    if (this.isUpdateStateFetch(opts)) {
      return this.fetchStateForUpdate(matchID) as Promise<{
        state?: State;
        log?: LogEntry[];
        metadata?: Server.MatchData;
        initialState?: State;
      }>;
    }

    const cols: string[] = ['match_id'];
    if (opts.state) cols.push('state');
    if (opts.log) cols.push('log');
    if (opts.metadata) cols.push('metadata');
    if (opts.initialState) cols.push('initial_state');

    const result = await this.pool.query<MatchRow>(`SELECT ${cols.join(', ')} FROM bjg_matches WHERE match_id = $1`, [
      matchID,
    ]);
    if (result.rows.length === 0) {
      return {} as { state?: State; log?: LogEntry[]; metadata?: Server.MatchData; initialState?: State };
    }
    const row = result.rows[0];
    const out: {
      state?: State;
      log?: LogEntry[];
      metadata?: Server.MatchData;
      initialState?: State;
    } = {};
    if (opts.state && row.state) out.state = row.state as State;
    if (opts.log && row.log) out.log = row.log as LogEntry[];
    if (opts.metadata && row.metadata) out.metadata = row.metadata as Server.MatchData;
    if (opts.initialState && row.initial_state) out.initialState = row.initial_state as State;
    return out;
  }

  async wipe(matchID: string): Promise<void> {
    if (this.closed) return;
    await this.withTransaction(async (client) => {
      // A stale-room sweep must never cascade-delete a result that has not
      // reached the durable API result tables yet. Lock the outbox row while
      // checking so a concurrent worker claim cannot race the delete.
      const pendingResult = await client.query<{ status: 'pending' | 'processing' | 'delivered' | 'unrated' }>(
        `SELECT status
           FROM bjg_match_result_outbox
          WHERE source_match_id = $1
            AND status IN ('pending', 'processing')
          FOR UPDATE`,
        [matchID],
      );
      if (pendingResult.rows.length > 0) return;
      await client.query(`DELETE FROM bjg_matches WHERE match_id = $1`, [matchID]);
    });
  }

  async listMatches(opts?: ListMatchesOpts): Promise<string[]> {
    if (this.closed) return [];
    await this.connect();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (opts?.gameName) {
      conditions.push(`metadata->>'gameName' = $${paramIdx++}`);
      params.push(opts.gameName);
    }
    if (opts?.where?.isGameover !== undefined) {
      // gameover 欄位存在於 metadata 代表對局已結束。
      conditions.push(opts.where.isGameover ? `metadata ? 'gameover'` : `NOT (metadata ? 'gameover')`);
    }
    if (opts?.where?.updatedBefore !== undefined) {
      conditions.push(`EXTRACT(EPOCH FROM updated_at) * 1000 < $${paramIdx++}`);
      params.push(opts.where.updatedBefore);
    }
    if (opts?.where?.updatedAfter !== undefined) {
      conditions.push(`EXTRACT(EPOCH FROM updated_at) * 1000 > $${paramIdx++}`);
      params.push(opts.where.updatedAfter);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<{ match_id: string }>(
      `SELECT match_id FROM bjg_matches ${where} ORDER BY updated_at DESC`,
      params,
    );
    return result.rows.map((r) => r.match_id);
  }

  /**
   * 在 server 關閉時呼叫，釋放連線池。
   * 設置 closed flag：之後任何 db 方法呼叫皆 no-op，避免 shutdown 期間
   * boardgame.io Master 的 async disconnect handler（onConnectionChange → fetch）
   * 撞到已 end 的 pool 拋「Cannot use a pool after end」unhandled rejection。
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    await this.pool.end();
  }

  /**
   * 提供原始 Pool 給測試或外部使用（如 cleanup job 用 client 做批次操作）。
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * 取得單一 client 並包在 transaction 中執行 callback。
   * 供需要多步驟原子操作的外部邏輯使用（如 cleanupStaleMatches 批次刪除）。
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('PostgresAdapter is closed');
    await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private isUpdateStateFetch(opts: FetchOpts): boolean {
    return opts.state === true && !opts.log && !opts.metadata && !opts.initialState;
  }

  private async fetchStateForUpdate(matchID: string): Promise<{ state?: State }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<MatchRow>(
        `SELECT match_id, state FROM bjg_matches WHERE match_id = $1 FOR UPDATE`,
        [matchID],
      );
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        client.release();
        return {};
      }

      const lock: UpdateLockContext = {
        matchID,
        client,
        released: false,
        timeout: setTimeout(() => {
          this.releaseUpdateLock(lock, 'rollback').catch((err) => {
            Sentry.captureException(err, {
              tags: { layer: 'postgres', op: 'lock-release-timeout', match_id: matchID },
            });
            console.error(`[PostgresAdapter] timed-out update lock release failed for ${matchID}:`, err);
          });
        }, 5000),
      };
      lock.timeout.unref?.();
      this.updateLocks.set(matchID, lock);
      return { state: result.rows[0].state as State };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* ignore rollback failure from the original error path */
      });
      client.release();
      throw err;
    }
  }

  private async releaseUpdateLock(lock: UpdateLockContext, mode: 'commit' | 'rollback'): Promise<void> {
    if (lock.released) return;
    lock.released = true;
    this.updateLocks.delete(lock.matchID);
    clearTimeout(lock.timeout);
    try {
      await lock.client.query(mode === 'commit' ? 'COMMIT' : 'ROLLBACK');
    } finally {
      lock.client.release();
    }
  }

  private expectedPreviousStateID(state: State): number | null {
    return typeof state._stateID === 'number' ? state._stateID - 1 : null;
  }

  private async writeState(
    queryable: Pick<Pool | PoolClient, 'query'>,
    matchID: string,
    state: State,
    deltalog?: LogEntry[],
  ): Promise<void> {
    const nextStateID = typeof state._stateID === 'number' ? state._stateID : null;
    const expectedStateID = this.expectedPreviousStateID(state);
    const hasDeltalog = Boolean(deltalog && deltalog.length > 0);
    const guardParamIndex = hasDeltalog ? 4 : 3;
    const stateIDGuard =
      expectedStateID === null ? '' : ` AND COALESCE((state->>'_stateID')::integer, -1) = $${guardParamIndex}`;

    const paramsWithLog: unknown[] = [matchID, JSON.stringify(state), JSON.stringify(deltalog)];
    const paramsWithoutLog: unknown[] = [matchID, JSON.stringify(state)];
    if (expectedStateID !== null) {
      paramsWithLog.push(expectedStateID);
      paramsWithoutLog.push(expectedStateID);
    }

    const result = hasDeltalog
      ? await queryable.query(
          `UPDATE bjg_matches
             SET state = $2,
                 log = COALESCE(log, '[]'::jsonb) || $3::jsonb,
                 updated_at = NOW()
           WHERE match_id = $1${stateIDGuard}`,
          paramsWithLog,
        )
      : await queryable.query(
          `UPDATE bjg_matches
              SET state = $2, updated_at = NOW()
            WHERE match_id = $1${stateIDGuard}`,
          paramsWithoutLog,
        );

    if (expectedStateID !== null && result.rowCount === 0) {
      throw new StaleStateWriteError(matchID, expectedStateID, nextStateID ?? expectedStateID + 1);
    }

    const terminalResult = canonicalTerminalResult(state);
    if (terminalResult) {
      await this.enqueueTerminalResult(queryable, matchID, terminalResult);
    }
  }

  private async enqueueTerminalResult(
    queryable: Pick<Pool | PoolClient, 'query'>,
    matchID: string,
    result: CanonicalTerminalResult,
  ): Promise<void> {
    const match = await queryable.query<Pick<MatchRow, 'metadata'>>(
      'SELECT metadata FROM bjg_matches WHERE match_id = $1',
      [matchID],
    );
    const rulesVersion = metadataRulesVersion(match.rows[0]?.metadata);
    const seats = await queryable.query<MatchSeatRow>(
      `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash
         FROM bjg_match_seats
        WHERE match_id = $1
        ORDER BY player_id`,
      [matchID],
    );
    let player0 = seats.rows.find((seat) => seat.player_id === '0');
    let player1 = seats.rows.find((seat) => seat.player_id === '1');
    let winner = result.winnerPlayer === 0 ? player0 : result.winnerPlayer === 1 ? player1 : undefined;
    let loser = result.winnerPlayer === 0 ? player1 : result.winnerPlayer === 1 ? player0 : undefined;
    let accountDeleted = false;
    const accountIds = [player0?.user_id, player1?.user_id].filter((userId): userId is string => Boolean(userId));
    try {
      await acquireAccountMutationLocks(queryable as PoolClient, accountIds);
    } catch (error) {
      if (!(error instanceof AccountMutationError)) throw error;
      accountDeleted = true;
      player0 = undefined;
      player1 = undefined;
      winner = undefined;
      loser = undefined;
    }
    const rankedEligible = Boolean(
      winner && loser && winner.ranked_eligible && loser.ranked_eligible && winner.user_id !== loser.user_id,
    );
    const status = rankedEligible && this.rankedMatchesEnabled ? 'pending' : 'unrated';
    const unratedReason = accountDeleted
      ? 'account_deleted'
      : rankedEligible && !this.rankedMatchesEnabled
        ? 'ranked_disabled'
        : result.winnerPlayer === null
          ? 'draw_or_missing_winner'
          : !player0 || !player1
            ? 'missing_atomic_seat_reservation'
            : !player0.ranked_eligible || !player1.ranked_eligible
              ? 'guest_or_unranked_seat'
              : player0.user_id === player1.user_id
                ? 'duplicate_account_seats'
                : 'unrated';

    await queryable.query(
      `INSERT INTO bjg_match_result_outbox (
         source_match_id,
         player0_user_id,
         player1_user_id,
         winner_player,
         winner_user_id,
         loser_user_id,
         ranked_eligible,
         turns,
         duration_seconds,
         completed_at,
         rules_version,
         action_log,
         state_id,
         status,
         next_attempt_at,
         last_error,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $12::jsonb, $13, $14, NOW(), $15, NOW(), NOW())
       ON CONFLICT (source_match_id) DO NOTHING`,
      [
        matchID,
        player0?.user_id ?? null,
        player1?.user_id ?? null,
        result.winnerPlayer,
        winner?.user_id ?? null,
        loser?.user_id ?? null,
        rankedEligible,
        result.turns,
        result.durationSeconds,
        result.completedAt,
        rulesVersion,
        JSON.stringify(result.actionLog),
        result.stateID,
        status,
        status === 'pending' ? null : unratedReason,
      ],
    );
  }
}
