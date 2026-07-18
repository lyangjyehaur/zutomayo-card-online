import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { markConversationRead, sendChatMessage } = require('../chatService.cjs') as {
  markConversationRead: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sendChatMessage: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

describe('guest match chat', () => {
  it('allows a verified guest seat while persisting no fake account foreign key', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM platform_match_participants') && sql.includes('bjg_match_seats'))
        return { rows: [{ ok: 1 }] };
      if (sql.includes('SELECT role') && sql.includes('bjg_match_seats')) return { rows: [{ role: 'player' }] };
      if (sql.includes('INSERT INTO chat_conversations')) {
        return {
          rows: [
            {
              id: 'match:bgio-match-1',
              type: 'match',
              subject_id: 'bgio-match-1',
              title: '',
              status: 'active',
              created_at: '2026-07-18T00:00:00.000Z',
              updated_at: '2026-07-18T00:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO chat_messages')) {
        expect(params?.[2]).toBeNull();
        expect(params?.[9]).toMatchObject({ guestSeatUserId: 'guest:match:bgio-match-1:reservation:abc' });
        return {
          rows: [
            {
              id: 'chat_msg_guest',
              conversation_id: 'match:bgio-match-1',
              author_user_id: null,
              author_display_name: 'Guest 1234',
              author_role: 'player',
              content: 'hello',
              source_language: '',
              moderation_status: 'visible',
              moderation_reason: '',
              metadata: params?.[9],
              created_at: '2026-07-18T00:00:01.000Z',
              edited_at: null,
              deleted_at: null,
            },
          ],
        };
      }
      if (sql.startsWith('UPDATE chat_conversations')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      sendChatMessage({
        pool: { query },
        authorUserId: 'guest:match:bgio-match-1:reservation:abc',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'hello',
          authorDisplayName: 'Guest 1234',
          authorRole: 'player',
        },
        sanitizeText: (value: string, length: number) => String(value).slice(0, length),
        generateMessageId: () => 'chat_msg_guest',
        enforceMatchParticipation: true,
        allowPresenceOnlyUserId: true,
      }),
    ).resolves.toMatchObject({ ok: true, body: { message: { authorUserId: null, content: 'hello' } } });
  });

  it('acknowledges guest reads without inserting a foreign-key-backed read cursor', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM platform_match_participants') && sql.includes('bjg_match_seats')) {
        return { rows: [{ ok: 1 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      markConversationRead({
        pool: { query },
        userId: 'guest:match:bgio-match-1:reservation:abc',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          lastReadMessageId: 'chat_msg_guest',
        },
        enforceMatchParticipation: true,
        allowPresenceOnlyUserId: true,
      }),
    ).resolves.toEqual({ ok: true, body: { ok: true } });

    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO chat_read_states'))).toBe(false);
  });
});
