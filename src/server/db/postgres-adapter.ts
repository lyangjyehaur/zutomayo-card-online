import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Server, State, LogEntry } from 'boardgame.io';
import * as Sentry from '@sentry/node';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { rebuildOpeningStateFromManifest } from '../../game/replay';
import type { GameState, ReplayManifest } from '../../game/types';
import { postgresConnectionString, postgresSslConfig } from '../../runtimeSecurityConfig';
import { APP_VERSION_INFO } from '../../version';
import {
  projectAbandonedMatchAnalytics,
  projectMatchAnalytics,
  resolveMatchAnalyticsRuntimeMetadata,
  sourceMatchDigest,
  type MatchAnalyticsProjection,
  type TrustedMatchTelemetry,
} from '../matchAnalytics';
import {
  matchAnalyticsCaptureFailuresTotal,
  matchAnalyticsCaptureTotal,
  matchAnalyticsCleanupBlockedTotal,
} from '../observability/metrics';

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
  releaseHandle: ReturnType<typeof setImmediate>;
  writing: boolean;
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
  localDeckIds?: string[];
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
  resume_count?: number;
}

interface MatchTelemetryRow extends QueryResultRow {
  match_mode: 'quick_match' | 'custom_room' | 'invite' | 'direct' | 'unknown';
  traffic_class: 'production' | 'operator' | 'synthetic' | 'ai' | 'unknown';
  player0_disconnect_count: number;
  player1_disconnect_count: number;
  player0_reconnect_count: number;
  player1_reconnect_count: number;
}

function trustedMatchTelemetry(row: MatchTelemetryRow | undefined): TrustedMatchTelemetry | undefined {
  if (!row) return undefined;
  return {
    matchMode: row.match_mode,
    trafficClass: row.traffic_class,
    disconnectCounts: [row.player0_disconnect_count, row.player1_disconnect_count],
    reconnectCounts: [row.player0_reconnect_count, row.player1_reconnect_count],
  };
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
          resume_count     INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (match_id, player_id),
          UNIQUE (match_id, user_id)
        );
      `);
      await client.query(
        `ALTER TABLE bjg_match_seats
           ADD COLUMN IF NOT EXISTS resume_count INTEGER NOT NULL DEFAULT 0`,
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS bjg_match_telemetry (
          source_match_id           TEXT PRIMARY KEY REFERENCES bjg_matches(match_id) ON DELETE CASCADE,
          match_mode                TEXT NOT NULL DEFAULT 'direct',
          traffic_class             TEXT NOT NULL DEFAULT 'unknown',
          player0_disconnect_count  INTEGER NOT NULL DEFAULT 0,
          player1_disconnect_count  INTEGER NOT NULL DEFAULT 0,
          player0_reconnect_count   INTEGER NOT NULL DEFAULT 0,
          player1_reconnect_count   INTEGER NOT NULL DEFAULT 0,
          observed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      await client.query(`
        CREATE TABLE IF NOT EXISTS match_analytics (
          source_match_digest    TEXT PRIMARY KEY,
          environment            TEXT NOT NULL,
          traffic_class          TEXT NOT NULL,
          match_mode             TEXT NOT NULL DEFAULT 'direct',
          rating_mode            TEXT NOT NULL,
          unrated_reason          TEXT,
          app_version             TEXT NOT NULL,
          build_id                TEXT NOT NULL,
          rules_version           TEXT NOT NULL,
          dataset_sha256          TEXT NOT NULL DEFAULT 'unknown',
          started_at              TIMESTAMPTZ,
          completed_at            TIMESTAMPTZ NOT NULL,
          duration_seconds        INTEGER NOT NULL,
          turns                   INTEGER NOT NULL,
          outcome                 TEXT NOT NULL,
          winner_seat             SMALLINT,
          janken_winner_seat      SMALLINT,
          gameover_reason_code    TEXT NOT NULL,
          final_hp                INTEGER[] NOT NULL,
          seat_classes            TEXT[] NOT NULL,
          quality_flags           TEXT[] NOT NULL DEFAULT '{}',
          action_count            INTEGER NOT NULL,
          timeout_count           INTEGER NOT NULL,
          disconnect_counts       INTEGER[] NOT NULL DEFAULT '{0,0}',
          reconnect_counts        INTEGER[] NOT NULL DEFAULT '{0,0}',
          seat_resume_counts      INTEGER[] NOT NULL DEFAULT '{0,0}',
          deck_count              SMALLINT NOT NULL,
          event_count             INTEGER NOT NULL,
          capture_schema_version  SMALLINT NOT NULL DEFAULT 1,
          integrity_sha256        TEXT NOT NULL,
          captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(
        `ALTER TABLE match_analytics
           ADD COLUMN IF NOT EXISTS disconnect_counts INTEGER[] NOT NULL DEFAULT '{0,0}',
           ADD COLUMN IF NOT EXISTS reconnect_counts INTEGER[] NOT NULL DEFAULT '{0,0}',
           ADD COLUMN IF NOT EXISTS seat_resume_counts INTEGER[] NOT NULL DEFAULT '{0,0}'`,
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS match_analytics_decks (
          source_match_digest TEXT NOT NULL REFERENCES match_analytics(source_match_digest) ON DELETE RESTRICT,
          seat                SMALLINT NOT NULL,
          card_ids            TEXT[] NOT NULL,
          deck_hash           TEXT NOT NULL,
          deck_source         TEXT NOT NULL,
          deck_validation     TEXT NOT NULL,
          PRIMARY KEY (source_match_digest, seat)
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS match_analytics_events (
          source_match_digest TEXT NOT NULL REFERENCES match_analytics(source_match_digest) ON DELETE RESTRICT,
          sequence            INTEGER NOT NULL,
          turn                INTEGER NOT NULL,
          step                TEXT NOT NULL,
          actor_seat          SMALLINT,
          event_type          TEXT NOT NULL,
          card_def_id         TEXT,
          target_seat         SMALLINT,
          hp_before           INTEGER,
          hp_after            INTEGER,
          chronos_position    INTEGER,
          result_code         TEXT,
          timeout_phase       TEXT,
          payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY (source_match_digest, sequence)
        );
      `);
      await client.query(
        `ALTER TABLE bjg_match_result_outbox
           ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      );
      if (this.createIndexes) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bjg_matches_updated_at ON bjg_matches (updated_at);`);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_bjg_match_telemetry_classification
             ON bjg_match_telemetry (match_mode, traffic_class, updated_at);`,
        );
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
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_match_analytics_completed_at
             ON match_analytics (completed_at DESC);`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_match_analytics_version_analysis
             ON match_analytics (rules_version, dataset_sha256, completed_at);`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_match_analytics_events_type_step
             ON match_analytics_events (event_type, step);`,
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

  async withRematchLock<T>(matchID: string, operation: () => Promise<T>): Promise<T> {
    await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [matchID]);
      const result = await operation();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setState(matchID: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    if (this.closed) return;
    await this.connect();

    const lock = this.updateLocks.get(matchID);
    if (lock && !lock.released && !lock.writing) {
      lock.writing = true;
      clearImmediate(lock.releaseHandle);
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
      } else if (input.localDeckIds) {
        if (!input.deckRulesVersion) {
          throw new MatchSeatReservationError('seat_taken', 'Deck rules version is required');
        }
        await this.bindDeckCardsWithClient(client, match, {
          matchID: input.matchID,
          playerID,
          cardIds: input.localDeckIds,
          deckVersion: crypto.createHash('sha256').update(JSON.stringify(input.localDeckIds)).digest('hex'),
          rulesVersion: input.deckRulesVersion,
          verifyKnownCards: true,
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
            SET last_resumed_at = NOW(),
                resume_count = resume_count + 1
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

    await this.bindDeckCardsWithClient(client, row, {
      matchID: input.matchID,
      playerID: input.playerID,
      cardIds: reservation.card_ids,
      deckVersion: reservation.deck_version,
      rulesVersion: reservation.rules_version,
    });
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

  private async bindDeckCardsWithClient(
    client: PoolClient,
    row: MatchRow,
    input: {
      matchID: string;
      playerID: BoardgamePlayerID;
      cardIds: unknown;
      deckVersion: string;
      rulesVersion: string;
      verifyKnownCards?: boolean;
    },
  ): Promise<void> {
    if (!row.state || !row.initial_state || !row.metadata) {
      throw new MatchSeatReservationError('match_not_found', `Match ${input.matchID} not found`);
    }
    const cardIds = input.cardIds;
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
    if (input.verifyKnownCards) {
      const uniqueCardIds = [...new Set(cardIds)];
      const knownCards = await client.query<{ id: string }>('SELECT id FROM cards WHERE id = ANY($1::text[])', [
        uniqueCardIds,
      ]);
      if (knownCards.rowCount !== uniqueCardIds.length) {
        throw new MatchSeatReservationError('seat_taken', 'Deck contains unknown cards');
      }
    }
    const state = JSON.parse(JSON.stringify(row.state)) as Record<string, unknown>;
    const initialState = JSON.parse(JSON.stringify(row.initial_state)) as Record<string, unknown>;
    const stateG = state.G as Record<string, unknown> | undefined;
    const initialG = initialState.G as Record<string, unknown> | undefined;
    if (!stateG || !initialG || stateG.step !== 'janken' || stateG.turnNumber !== 1) {
      throw new MatchSeatReservationError('seat_taken', 'Deck can only be bound before the first move');
    }
    const apply = (targetG: Record<string, unknown>) => {
      const gameState = targetG as unknown as GameState;
      if (!gameState.players?.[Number(input.playerID)]) {
        throw new MatchSeatReservationError('seat_not_found', 'Player seat not found');
      }
      const manifest = gameState.replayManifest;
      if (!manifest || manifest.schemaVersion !== 1) {
        throw new MatchSeatReservationError('seat_taken', 'Match does not support deterministic deck binding');
      }
      const deckDefIds: ReplayManifest['deckDefIds'] = [[...manifest.deckDefIds[0]], [...manifest.deckDefIds[1]]];
      deckDefIds[Number(input.playerID) as 0 | 1] = [...(cardIds as string[])];
      gameState.replayManifest = {
        ...manifest,
        rulesVersion: input.rulesVersion,
        deckDefIds,
      };
      rebuildOpeningStateFromManifest(gameState);
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
      [`deck${slot}Version`]: input.deckVersion,
      rulesVersion: input.rulesVersion,
    };
    await client.query(
      `UPDATE bjg_matches
          SET state = $2::jsonb, initial_state = $3::jsonb, metadata = $4::jsonb, updated_at = NOW()
        WHERE match_id = $1`,
      [input.matchID, JSON.stringify(state), JSON.stringify(initialState), JSON.stringify(metadata)],
    );
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

  async wipe(matchID: string): Promise<boolean> {
    if (this.closed) return false;
    return this.withTransaction(async (client) => {
      // Runtime state is the recovery source until either terminal or
      // abandoned analytics children reconcile. Lock it before inspecting the
      // outbox so state writes and cleanup cannot classify the same row twice.
      const match = (
        await client.query<MatchRow>(
          `SELECT match_id, state, initial_state, metadata, updated_at
             FROM bjg_matches
            WHERE match_id = $1
            FOR UPDATE`,
          [matchID],
        )
      ).rows[0];
      if (!match) return false;

      const archive = await client.query<{
        status: 'pending' | 'processing' | 'delivered' | 'unrated';
        integrity_sha256: string | null;
        deck_count: number | null;
        event_count: number | null;
        archived_deck_count: string;
        archived_event_count: string;
      }>(
        `SELECT outbox.status,
                analytics.integrity_sha256,
                analytics.deck_count,
                analytics.event_count,
                (SELECT COUNT(*)::text
                   FROM match_analytics_decks decks
                  WHERE decks.source_match_digest = analytics.source_match_digest) AS archived_deck_count,
                (SELECT COUNT(*)::text
                   FROM match_analytics_events events
                  WHERE events.source_match_digest = analytics.source_match_digest) AS archived_event_count
           FROM bjg_match_result_outbox outbox
           LEFT JOIN match_analytics analytics ON analytics.source_match_digest = $2
          WHERE outbox.source_match_id = $1
          FOR UPDATE OF outbox`,
        [matchID, sourceMatchDigest(matchID)],
      );
      const terminal = archive.rows[0];
      if (terminal) {
        if (terminal.status === 'pending' || terminal.status === 'processing') {
          matchAnalyticsCleanupBlockedTotal.labels('pending-delivery').inc();
          return false;
        }
        const archivedDeckCount = Number(terminal.archived_deck_count);
        const archivedEventCount = Number(terminal.archived_event_count);
        const completeArchive =
          typeof terminal.integrity_sha256 === 'string' &&
          /^[0-9a-f]{64}$/.test(terminal.integrity_sha256) &&
          terminal.deck_count === 2 &&
          archivedDeckCount === terminal.deck_count &&
          Number.isInteger(terminal.event_count) &&
          archivedEventCount === terminal.event_count;
        if (!completeArchive) {
          matchAnalyticsCleanupBlockedTotal.labels('incomplete-archive').inc();
          return false;
        }
      } else if (match.state && canonicalTerminalResult(match.state)) {
        // A terminal state without its same-transaction outbox/archive is
        // evidence of a failed capture. Never relabel it as abandoned.
        matchAnalyticsCleanupBlockedTotal.labels('missing-terminal-archive').inc();
        return false;
      } else {
        if (!match.state || !match.initial_state || !match.metadata) {
          matchAnalyticsCleanupBlockedTotal.labels('incomplete-runtime-state').inc();
          return false;
        }
        const seats = await client.query<MatchSeatRow>(
          `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash, resume_count
             FROM bjg_match_seats
            WHERE match_id = $1
            ORDER BY player_id
            FOR SHARE`,
          [matchID],
        );
        const telemetry = await client.query<MatchTelemetryRow>(
          `SELECT match_mode, traffic_class,
                  player0_disconnect_count, player1_disconnect_count,
                  player0_reconnect_count, player1_reconnect_count
             FROM bjg_match_telemetry
            WHERE source_match_id = $1
            FOR SHARE`,
          [matchID],
        );
        let analytics: MatchAnalyticsProjection;
        try {
          analytics = projectAbandonedMatchAnalytics({
            sourceMatchId: matchID,
            state: match.state,
            initialState: match.initial_state,
            seats: seats.rows.map((seatRow) => ({
              playerID: seatRow.player_id,
              userId: seatRow.user_id,
              rankedEligible: seatRow.ranked_eligible,
              resumeCount: seatRow.resume_count,
            })),
            rulesVersion: metadataRulesVersion(match.metadata),
            version: APP_VERSION_INFO,
            abandonedAt: new Date(match.updated_at).toISOString(),
            ...resolveMatchAnalyticsRuntimeMetadata(),
            telemetry: trustedMatchTelemetry(telemetry.rows[0]),
          });
        } catch (error) {
          matchAnalyticsCaptureFailuresTotal.labels('abandoned-projection').inc();
          matchAnalyticsCleanupBlockedTotal.labels('abandoned-capture-failed').inc();
          Sentry.captureException(error);
          return false;
        }
        try {
          const inserted = await this.insertMatchAnalytics(client, analytics);
          if (inserted) {
            matchAnalyticsCaptureTotal.labels(analytics.fact.outcome, analytics.fact.trafficClass).inc();
          }
        } catch (error) {
          matchAnalyticsCaptureFailuresTotal.labels('abandoned-persistence').inc();
          throw error;
        }

        const reconciliation = await client.query<{
          integrity_sha256: string;
          deck_count: number;
          event_count: number;
          archived_deck_count: string;
          archived_event_count: string;
        }>(
          `SELECT analytics.integrity_sha256,
                  analytics.deck_count,
                  analytics.event_count,
                  (SELECT COUNT(*)::text
                     FROM match_analytics_decks decks
                    WHERE decks.source_match_digest = analytics.source_match_digest) AS archived_deck_count,
                  (SELECT COUNT(*)::text
                     FROM match_analytics_events events
                    WHERE events.source_match_digest = analytics.source_match_digest) AS archived_event_count
             FROM match_analytics analytics
            WHERE analytics.source_match_digest = $1`,
          [analytics.fact.sourceMatchDigest],
        );
        const abandoned = reconciliation.rows[0];
        const completeArchive =
          typeof abandoned?.integrity_sha256 === 'string' &&
          abandoned.integrity_sha256 === analytics.fact.integritySha256 &&
          abandoned.deck_count === analytics.fact.deckCount &&
          Number(abandoned.archived_deck_count) === analytics.fact.deckCount &&
          abandoned.event_count === analytics.fact.eventCount &&
          Number(abandoned.archived_event_count) === analytics.fact.eventCount;
        if (!completeArchive) {
          matchAnalyticsCleanupBlockedTotal.labels('abandoned-reconciliation').inc();
          return false;
        }
      }
      const deleted = await client.query(`DELETE FROM bjg_matches WHERE match_id = $1`, [matchID]);
      return deleted.rowCount === 1;
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
        writing: false,
        released: false,
        releaseHandle: setImmediate(() => {
          this.releaseUpdateLock(lock, 'rollback').catch((err) => {
            Sentry.captureException(err, {
              tags: { layer: 'postgres', op: 'unused-update-lock-release', match_id: matchID },
            });
            console.error(`[PostgresAdapter] unused update lock release failed for ${matchID}:`, err);
          });
        }),
      };
      lock.releaseHandle.unref?.();
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
    if (this.updateLocks.get(lock.matchID) === lock) this.updateLocks.delete(lock.matchID);
    clearImmediate(lock.releaseHandle);
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
      await this.enqueueTerminalResult(queryable, matchID, state, terminalResult);
    }
  }

  private async enqueueTerminalResult(
    queryable: Pick<Pool | PoolClient, 'query'>,
    matchID: string,
    state: State,
    result: CanonicalTerminalResult,
  ): Promise<void> {
    const match = await queryable.query<Pick<MatchRow, 'metadata' | 'initial_state'>>(
      'SELECT metadata, initial_state FROM bjg_matches WHERE match_id = $1',
      [matchID],
    );
    const matchRow = match.rows[0];
    if (!matchRow?.initial_state)
      throw new Error('Terminal analytics capture requires the authoritative initial state');
    const rulesVersion = metadataRulesVersion(matchRow.metadata);
    const seats = await queryable.query<MatchSeatRow>(
      `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash, resume_count
         FROM bjg_match_seats
        WHERE match_id = $1
        ORDER BY player_id`,
      [matchID],
    );
    const telemetry = await queryable.query<MatchTelemetryRow>(
      `SELECT match_mode, traffic_class,
              player0_disconnect_count, player1_disconnect_count,
              player0_reconnect_count, player1_reconnect_count
         FROM bjg_match_telemetry
        WHERE source_match_id = $1`,
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

    let analytics: MatchAnalyticsProjection;
    try {
      analytics = projectMatchAnalytics({
        sourceMatchId: matchID,
        state,
        initialState: matchRow.initial_state,
        seats: seats.rows.map((seatRow) => ({
          playerID: seatRow.player_id,
          userId: seatRow.user_id,
          rankedEligible: seatRow.ranked_eligible,
          resumeCount: seatRow.resume_count,
        })),
        rankedEligible: status === 'pending',
        unratedReason: status === 'pending' ? null : unratedReason,
        rulesVersion,
        version: APP_VERSION_INFO,
        ...resolveMatchAnalyticsRuntimeMetadata(),
        telemetry: trustedMatchTelemetry(telemetry.rows[0]),
      });
    } catch (error) {
      matchAnalyticsCaptureFailuresTotal.labels('projection').inc();
      throw error;
    }
    try {
      const inserted = await this.insertMatchAnalytics(queryable, analytics);
      if (inserted) {
        matchAnalyticsCaptureTotal.labels(analytics.fact.outcome, analytics.fact.trafficClass).inc();
      }
    } catch (error) {
      matchAnalyticsCaptureFailuresTotal.labels('persistence').inc();
      throw error;
    }
  }

  private async insertMatchAnalytics(
    queryable: Pick<Pool | PoolClient, 'query'>,
    analytics: MatchAnalyticsProjection,
  ): Promise<boolean> {
    const fact = analytics.fact;
    const inserted = await queryable.query<{ integrity_sha256: string }>(
      `INSERT INTO match_analytics (
         source_match_digest, environment, traffic_class, match_mode, rating_mode, unrated_reason,
         app_version, build_id, rules_version, dataset_sha256, started_at, completed_at,
         duration_seconds, turns, outcome, winner_seat, janken_winner_seat, gameover_reason_code,
         final_hp, seat_classes, quality_flags, action_count, timeout_count,
         disconnect_counts, reconnect_counts, seat_resume_counts, deck_count, event_count,
         capture_schema_version, integrity_sha256, captured_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz,
         $13, $14, $15, $16, $17, $18, $19::integer[], $20::text[], $21::text[], $22, $23,
         $24::integer[], $25::integer[], $26::integer[], $27, $28, $29, $30, NOW()
       )
       ON CONFLICT (source_match_digest) DO NOTHING
       RETURNING integrity_sha256`,
      [
        fact.sourceMatchDigest,
        fact.environment,
        fact.trafficClass,
        fact.matchMode,
        fact.ratingMode,
        fact.unratedReason,
        fact.appVersion,
        fact.buildId,
        fact.rulesVersion,
        fact.datasetSha256,
        fact.startedAt,
        fact.completedAt,
        fact.durationSeconds,
        fact.turns,
        fact.outcome,
        fact.winnerSeat,
        fact.jankenWinnerSeat,
        fact.gameoverReasonCode,
        fact.finalHp,
        fact.seatClasses,
        fact.qualityFlags,
        fact.actionCount,
        fact.timeoutCount,
        fact.disconnectCounts,
        fact.reconnectCounts,
        fact.seatResumeCounts,
        fact.deckCount,
        fact.eventCount,
        fact.captureSchemaVersion,
        fact.integritySha256,
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await queryable.query<{ integrity_sha256: string }>(
        'SELECT integrity_sha256 FROM match_analytics WHERE source_match_digest = $1',
        [fact.sourceMatchDigest],
      );
      if (existing.rows[0]?.integrity_sha256 !== fact.integritySha256) {
        throw new Error('Conflicting terminal analytics capture for an existing source digest');
      }
    }

    await queryable.query(
      `INSERT INTO match_analytics_decks (
         source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
       )
       SELECT source_match_digest, seat, card_ids, deck_hash, deck_source, deck_validation
         FROM jsonb_to_recordset($1::jsonb) AS deck(
           source_match_digest text,
           seat smallint,
           card_ids text[],
           deck_hash text,
           deck_source text,
           deck_validation text
         )
       ON CONFLICT (source_match_digest, seat) DO NOTHING`,
      [
        JSON.stringify(
          analytics.decks.map((deck) => ({
            source_match_digest: deck.sourceMatchDigest,
            seat: deck.seat,
            card_ids: deck.cardIds,
            deck_hash: deck.deckHash,
            deck_source: deck.deckSource,
            deck_validation: deck.deckValidation,
          })),
        ),
      ],
    );
    if (analytics.events.length > 0) {
      await queryable.query(
        `INSERT INTO match_analytics_events (
         source_match_digest, sequence, turn, step, actor_seat, event_type, card_def_id,
         target_seat, hp_before, hp_after, chronos_position, result_code, timeout_phase, payload
       )
       SELECT source_match_digest, sequence, turn, step, actor_seat, event_type, card_def_id,
              target_seat, hp_before, hp_after, chronos_position, result_code, timeout_phase, payload
         FROM jsonb_to_recordset($1::jsonb) AS event(
           source_match_digest text,
           sequence integer,
           turn integer,
           step text,
           actor_seat smallint,
           event_type text,
           card_def_id text,
           target_seat smallint,
           hp_before integer,
           hp_after integer,
           chronos_position integer,
           result_code text,
           timeout_phase text,
           payload jsonb
         )
       ON CONFLICT (source_match_digest, sequence) DO NOTHING`,
        [
          JSON.stringify(
            analytics.events.map((event) => ({
              source_match_digest: event.sourceMatchDigest,
              sequence: event.sequence,
              turn: event.turn,
              step: event.step,
              actor_seat: event.actorSeat,
              event_type: event.eventType,
              card_def_id: event.cardDefId,
              target_seat: event.targetSeat,
              hp_before: event.hpBefore,
              hp_after: event.hpAfter,
              chronos_position: event.chronosPosition,
              result_code: event.resultCode,
              timeout_phase: event.timeoutPhase,
              payload: event.payload,
            })),
          ),
        ],
      );
    }
    return inserted.rowCount === 1;
  }
}
