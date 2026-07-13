import { Pool, type QueryResultRow } from 'pg';
import { normalizePlatformUserId } from './friendStore';
import { postgresConnectionString, postgresSslConfig } from '../runtimeSecurityConfig';

export interface PlatformChatPreviewInput {
  conversationId: string | undefined;
  boardgameMatchID: string | undefined;
  messageId: string;
  authorUserId: string;
}

export interface PlatformChatPreviewStore {
  canBroadcastPreview(input: PlatformChatPreviewInput): Promise<boolean>;
  close?(): Promise<void>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
}

function cleanIdentifier(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export function createEmptyPlatformChatPreviewStore(): PlatformChatPreviewStore {
  return {
    async canBroadcastPreview() {
      return false;
    },
  };
}

export function createPostgresPlatformChatPreviewStore(
  pool: Queryable & { end?: () => Promise<void> },
): PlatformChatPreviewStore {
  return {
    async canBroadcastPreview(input) {
      const conversationId = cleanIdentifier(input.conversationId, 340);
      const boardgameMatchID = cleanIdentifier(input.boardgameMatchID, 128);
      const messageId = cleanIdentifier(input.messageId, 128);
      const authorUserId = normalizePlatformUserId(input.authorUserId);
      if (
        !conversationId ||
        !boardgameMatchID ||
        !messageId ||
        !authorUserId ||
        authorUserId.startsWith('guest:') ||
        authorUserId.startsWith('anon:')
      ) {
        return false;
      }

      const { rows } = await pool.query(
        `SELECT 1
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE m.id = $1
           AND m.conversation_id = $2
           AND m.author_user_id = $3
           AND c.type = 'match'
           AND c.subject_id = $4
           AND m.deleted_at IS NULL
           AND m.moderation_status IN ('visible', 'pending_review')
         LIMIT 1`,
        [messageId, conversationId, authorUserId, boardgameMatchID],
      );
      return rows.length > 0;
    },
    async close() {
      await pool.end?.();
    },
  };
}

export function createPlatformChatPreviewStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PlatformChatPreviewStore {
  const mode = resolvePlatformChatPreviewStoreMode(env);
  if (mode === 'none') return createEmptyPlatformChatPreviewStore();
  return createPostgresPlatformChatPreviewStore(
    new Pool({
      connectionString: databaseUrlFromEnv(env),
      max: Number(env.PLATFORM_PG_POOL_MAX || env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      ssl: postgresSslConfig(env),
    }),
  );
}

export function resolvePlatformChatPreviewStoreMode(env: NodeJS.ProcessEnv = process.env): 'none' | 'postgres' {
  const configured = env.PLATFORM_CHAT_PREVIEW_STORE?.trim().toLowerCase();
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
