import { Pool, type QueryResultRow } from 'pg';
import { createRequire } from 'node:module';
import { normalizePlatformUserId } from './friendStore';
import { postgresConnectionString, postgresSslConfig } from '../runtimeSecurityConfig';

const require = createRequire(import.meta.url);
const { acquireAccountMutationLocks } = require('../../api/accountMutationLock.cjs') as {
  acquireAccountMutationLocks: (client: Queryable, userIds: string[]) => Promise<QueryResultRow[]>;
};

export type PlatformMatchParticipantRole = 'player' | 'spectator';
export type MatchMode = 'quick_match' | 'custom_room' | 'invite' | 'direct' | 'unknown';
export type MatchTrafficClass = 'production' | 'operator' | 'synthetic' | 'ai' | 'unknown';

export interface PlatformMatchParticipantInput {
  boardgameMatchID: string | undefined;
  userId: string;
  role: PlatformMatchParticipantRole;
  boardgamePlayerID?: string;
  displayName?: string;
  accessVerified?: boolean;
}

export interface PlatformRoomParticipantInput {
  roomCode: string | undefined;
  userId: string;
  role: PlatformMatchParticipantRole;
  displayName?: string;
  accessVerified?: boolean;
}

export interface MatchProvenanceInput {
  boardgameMatchID?: string;
  matchMode: MatchMode;
}

export interface MatchConnectionInput {
  boardgameMatchID?: string;
  playerID?: string;
  event: 'join' | 'disconnect' | 'reconnect';
}

export interface PlatformMatchParticipantStore {
  authorizeMatchParticipant?(input: PlatformMatchParticipantInput): Promise<boolean>;
  recordParticipant(input: PlatformMatchParticipantInput): Promise<void>;
  recordRoomParticipant(input: PlatformRoomParticipantInput): Promise<void>;
  recordMatchProvenance(input: MatchProvenanceInput): Promise<void>;
  recordMatchConnection(input: MatchConnectionInput): Promise<void>;
  close?(): Promise<void>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>;
}

interface TransactionPool extends Queryable {
  connect: () => Promise<Queryable & { release?: () => void }>;
}

async function withAccountMutation<T>(
  pool: TransactionPool,
  userId: string,
  operation: (client: Queryable) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await acquireAccountMutationLocks(client, [userId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

function cleanBoardgameMatchID(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

function cleanRoomCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 128);
}

function cleanDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 60);
}

function cleanBoardgamePlayerID(value: unknown): string | null {
  return value === '0' || value === '1' ? value : null;
}

const MATCH_TRAFFIC_CLASSES = new Set<MatchTrafficClass>(['production', 'operator', 'synthetic', 'ai', 'unknown']);

export function resolveMatchTrafficClass(env: NodeJS.ProcessEnv = process.env): MatchTrafficClass {
  const configured = env.MATCH_ANALYTICS_TRAFFIC_CLASS?.trim().toLowerCase() as MatchTrafficClass | undefined;
  if (configured && MATCH_TRAFFIC_CLASSES.has(configured)) return configured;
  const deployment = (env.DEPLOYMENT_ENV || env.NODE_ENV)?.trim().toLowerCase();
  if (deployment === 'production') return 'production';
  if (deployment === 'development' || deployment === 'test' || deployment === 'staging') return 'synthetic';
  return 'unknown';
}

export function createEmptyPlatformMatchParticipantStore(): PlatformMatchParticipantStore {
  return {
    async recordParticipant() {
      return undefined;
    },
    async recordRoomParticipant() {
      return undefined;
    },
    async recordMatchProvenance() {
      return undefined;
    },
    async recordMatchConnection() {
      return undefined;
    },
  };
}

export function createPostgresPlatformMatchParticipantStore(
  pool: TransactionPool & { end?: () => Promise<void> },
  options: { trafficClass?: MatchTrafficClass } = {},
): PlatformMatchParticipantStore {
  const trafficClass = options.trafficClass ?? resolveMatchTrafficClass();
  return {
    async authorizeMatchParticipant(input) {
      const boardgameMatchID = cleanBoardgameMatchID(input.boardgameMatchID);
      const userId = normalizePlatformUserId(input.userId);
      if (!boardgameMatchID || !userId) return false;
      if (input.role !== 'player') {
        const { rows } = await pool.query('SELECT 1 FROM bjg_matches WHERE match_id = $1 LIMIT 1', [boardgameMatchID]);
        return rows.length > 0;
      }
      const boardgamePlayerID = cleanBoardgamePlayerID(input.boardgamePlayerID);
      if (!boardgamePlayerID) return false;
      const { rows } = await pool.query(
        `SELECT 1
         FROM bjg_matches
         WHERE match_id = $1
           AND metadata->'players'->$2->'data'->>'identitySource' = 'server'
           AND metadata->'players'->$2->'data'->>'userId' = $3
         LIMIT 1`,
        [boardgameMatchID, boardgamePlayerID, userId],
      );
      return rows.length > 0;
    },
    async recordParticipant(input) {
      const boardgameMatchID = cleanBoardgameMatchID(input.boardgameMatchID);
      const userId = normalizePlatformUserId(input.userId);
      if (!boardgameMatchID || !userId || userId.startsWith('guest:') || userId.startsWith('anon:')) return;
      await withAccountMutation(pool, userId, (client) =>
        client.query(
          `INSERT INTO platform_match_participants (
             boardgame_match_id, user_id, role, boardgame_player_id, display_name, access_verified
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (boardgame_match_id, user_id)
           DO UPDATE SET
             role = CASE
               WHEN platform_match_participants.role = 'player' THEN 'player'
               ELSE EXCLUDED.role
             END,
             boardgame_player_id = COALESCE(platform_match_participants.boardgame_player_id, EXCLUDED.boardgame_player_id),
             display_name = EXCLUDED.display_name,
             access_verified = platform_match_participants.access_verified OR EXCLUDED.access_verified,
             last_seen_at = NOW()`,
          [
            boardgameMatchID,
            userId,
            input.role === 'player' ? 'player' : 'spectator',
            cleanBoardgamePlayerID(input.boardgamePlayerID),
            cleanDisplayName(input.displayName),
            input.accessVerified === true,
          ],
        ),
      );
    },
    async recordRoomParticipant(input) {
      const roomCode = cleanRoomCode(input.roomCode);
      const userId = normalizePlatformUserId(input.userId);
      if (!roomCode || !userId || userId.startsWith('guest:') || userId.startsWith('anon:')) return;
      await withAccountMutation(pool, userId, (client) =>
        client.query(
          `INSERT INTO platform_room_participants (
             room_code, user_id, role, display_name, access_verified
           )
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (room_code, user_id)
           DO UPDATE SET
             role = CASE
               WHEN platform_room_participants.role = 'player' THEN 'player'
               ELSE EXCLUDED.role
             END,
             display_name = EXCLUDED.display_name,
             access_verified = platform_room_participants.access_verified OR EXCLUDED.access_verified,
             last_seen_at = NOW()`,
          [
            roomCode,
            userId,
            input.role === 'player' ? 'player' : 'spectator',
            cleanDisplayName(input.displayName),
            input.accessVerified === true,
          ],
        ),
      );
    },
    async recordMatchProvenance(input) {
      const boardgameMatchID = cleanBoardgameMatchID(input.boardgameMatchID);
      if (!boardgameMatchID) return;
      const result = await pool.query(
        `INSERT INTO bjg_match_telemetry (source_match_id, match_mode, traffic_class, observed_at, updated_at)
         SELECT match_id, $2, $3, NOW(), NOW()
           FROM bjg_matches
          WHERE match_id = $1
         ON CONFLICT (source_match_id)
         DO UPDATE SET
           match_mode = CASE
             WHEN bjg_match_telemetry.match_mode IN ('direct', 'unknown') THEN EXCLUDED.match_mode
             ELSE bjg_match_telemetry.match_mode
           END,
           traffic_class = CASE
             WHEN bjg_match_telemetry.traffic_class = 'unknown' THEN EXCLUDED.traffic_class
             ELSE bjg_match_telemetry.traffic_class
           END,
           updated_at = NOW()
         WHERE (
           bjg_match_telemetry.match_mode = EXCLUDED.match_mode
           OR bjg_match_telemetry.match_mode IN ('direct', 'unknown')
           OR EXCLUDED.match_mode IN ('direct', 'unknown')
         )
           AND (
             bjg_match_telemetry.traffic_class = EXCLUDED.traffic_class
             OR bjg_match_telemetry.traffic_class = 'unknown'
             OR EXCLUDED.traffic_class = 'unknown'
           )
         RETURNING source_match_id`,
        [boardgameMatchID, input.matchMode, trafficClass],
      );
      if (result.rows.length === 0) {
        throw new Error('Match telemetry provenance conflicts with an existing classification or missing match');
      }
    },
    async recordMatchConnection(input) {
      const boardgameMatchID = cleanBoardgameMatchID(input.boardgameMatchID);
      const playerID = cleanBoardgamePlayerID(input.playerID);
      if (!boardgameMatchID || !playerID) return;
      await pool.query(
        `INSERT INTO bjg_match_telemetry (source_match_id, match_mode, traffic_class, observed_at, updated_at)
         SELECT match_id, 'direct', $2, NOW(), NOW()
           FROM bjg_matches
          WHERE match_id = $1
         ON CONFLICT (source_match_id) DO NOTHING`,
        [boardgameMatchID, trafficClass],
      );
      const disconnectColumn = playerID === '0' ? 'player0_disconnect_count' : 'player1_disconnect_count';
      const reconnectColumn = playerID === '0' ? 'player0_reconnect_count' : 'player1_reconnect_count';
      const disconnectedAtColumn = playerID === '0' ? 'player0_disconnected_at' : 'player1_disconnected_at';
      const runtimeSnapshot = `
        SELECT match_id,
               CASE
                 WHEN state->'G'->>'step' IN ('janken', 'mulligan', 'initialSet', 'turnSet', 'effectOrder', 'gameOver')
                   THEN state->'G'->>'step'
                 ELSE 'unknown'
               END AS step,
               CASE
                 WHEN state->'G'->>'matchStartedAt' ~ '^[0-9]+(\\.[0-9]+)?$' THEN
                   LEAST(
                     86400::numeric,
                     GREATEST(
                       0::numeric,
                       FLOOR(
                         EXTRACT(EPOCH FROM NOW())
                         - LEAST(
                             EXTRACT(EPOCH FROM NOW()),
                             GREATEST(0::numeric, (state->'G'->>'matchStartedAt')::numeric / 1000)
                           )
                       )
                     )
                   )::integer
                 ELSE 0
               END AS offset_seconds
          FROM bjg_matches
         WHERE match_id = $1`;
      if (input.event === 'disconnect') {
        await pool.query(
          `WITH runtime AS (${runtimeSnapshot})
           UPDATE bjg_match_telemetry telemetry
              SET ${disconnectColumn} = ${disconnectColumn} + 1,
                  ${disconnectedAtColumn} = NOW(),
                  connection_events = (
                    CASE WHEN jsonb_array_length(connection_events) >= 100
                      THEN connection_events - 0
                      ELSE connection_events
                    END
                  ) || jsonb_build_array(jsonb_build_object(
                    'event', 'disconnect',
                    'seat', $2::integer,
                    'step', runtime.step,
                    'offsetSeconds', runtime.offset_seconds
                  )),
                  updated_at = NOW()
             FROM runtime
            WHERE telemetry.source_match_id = runtime.match_id`,
          [boardgameMatchID, Number(playerID)],
        );
        return;
      }
      await pool.query(
        `WITH runtime AS (${runtimeSnapshot})
         UPDATE bjg_match_telemetry telemetry
            SET ${reconnectColumn} = ${reconnectColumn} + CASE
                  WHEN $2 = 'reconnect' OR ${disconnectColumn} > ${reconnectColumn} THEN 1
                  ELSE 0
                END,
                connection_events = CASE
                  WHEN ${disconnectedAtColumn} IS NULL THEN connection_events
                  ELSE (
                    CASE WHEN jsonb_array_length(connection_events) >= 100
                      THEN connection_events - 0
                      ELSE connection_events
                    END
                  ) || jsonb_build_array(jsonb_build_object(
                    'event', 'reconnect',
                    'seat', $3::integer,
                    'step', runtime.step,
                    'offsetSeconds', runtime.offset_seconds,
                    'disconnectSeconds', LEAST(
                      86400::numeric,
                      GREATEST(0::numeric, FLOOR(EXTRACT(EPOCH FROM NOW() - ${disconnectedAtColumn})))
                    )::integer
                  ))
                END,
                ${disconnectedAtColumn} = NULL,
                updated_at = NOW()
           FROM runtime
          WHERE telemetry.source_match_id = runtime.match_id`,
        [boardgameMatchID, input.event, Number(playerID)],
      );
    },
    async close() {
      await pool.end?.();
    },
  };
}

export function createPlatformMatchParticipantStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PlatformMatchParticipantStore {
  const mode = resolvePlatformMatchParticipantStoreMode(env);
  if (mode === 'none') return createEmptyPlatformMatchParticipantStore();
  return createPostgresPlatformMatchParticipantStore(
    new Pool({
      connectionString: databaseUrlFromEnv(env),
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      ssl: postgresSslConfig(env),
    }),
    { trafficClass: resolveMatchTrafficClass(env) },
  );
}

export function resolvePlatformMatchParticipantStoreMode(env: NodeJS.ProcessEnv = process.env): 'none' | 'postgres' {
  const configured = env.PLATFORM_MATCH_PARTICIPANT_STORE?.trim().toLowerCase();
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
