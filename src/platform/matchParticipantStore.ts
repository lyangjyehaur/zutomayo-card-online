import { Pool, type QueryResultRow } from 'pg';
import { normalizePlatformUserId } from './friendStore';

export type PlatformMatchParticipantRole = 'player' | 'spectator';

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

export interface PlatformMatchParticipantStore {
  authorizeMatchParticipant?(input: PlatformMatchParticipantInput): Promise<boolean>;
  recordParticipant(input: PlatformMatchParticipantInput): Promise<void>;
  recordRoomParticipant(input: PlatformRoomParticipantInput): Promise<void>;
  close?(): Promise<void>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
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

export function createEmptyPlatformMatchParticipantStore(): PlatformMatchParticipantStore {
  return {
    async recordParticipant() {
      return undefined;
    },
    async recordRoomParticipant() {
      return undefined;
    },
  };
}

export function createPostgresPlatformMatchParticipantStore(
  pool: Queryable & { end?: () => Promise<void> },
): PlatformMatchParticipantStore {
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
      await pool.query(
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
      );
    },
    async recordRoomParticipant(input) {
      const roomCode = cleanRoomCode(input.roomCode);
      const userId = normalizePlatformUserId(input.userId);
      if (!roomCode || !userId || userId.startsWith('guest:') || userId.startsWith('anon:')) return;
      await pool.query(
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
    }),
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
    env.DATABASE_URL?.trim() ||
    `postgres://${env.PG_USER || 'postgres'}:${env.PG_PASSWORD || ''}@${env.PG_HOST || 'localhost'}:${env.PG_PORT || '5432'}/${env.PG_DATABASE || 'postgres'}`
  );
}
