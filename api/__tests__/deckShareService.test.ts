import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  copyDeckShare,
  decodeCursor,
  encodeCursor,
  getDeckShare,
  getOwnedDeckShare,
  likeDeckShare,
  listAdminDeckShareReports,
  listDeckShares,
  moderateDeckShare,
  publishDeckShare,
  reportDeckShare,
  unpublishDeckShare,
  updateDeckShare,
  unlikeDeckShare,
} = require('../deckShareService.cjs') as {
  copyDeckShare: (
    pool: Queryable,
    userId: string,
    shareId: string,
    input: { name?: string; idempotencyKey?: string },
    generateDeckId?: () => string,
  ) => Promise<ServiceResult>;
  decodeCursor: (value: string, sort: string) => Record<string, unknown> | null;
  encodeCursor: (sort: string, row: Record<string, unknown>) => string;
  getDeckShare: (pool: Queryable, viewerUserId: string | null, shareId: string) => Promise<ServiceResult>;
  getOwnedDeckShare: (pool: Queryable, userId: string, deckId: string) => Promise<ServiceResult>;
  likeDeckShare: (pool: Queryable, userId: string, shareId: string) => Promise<ServiceResult>;
  listAdminDeckShareReports: (pool: Queryable, input: { status?: string; limit?: number }) => Promise<ServiceResult>;
  listDeckShares: (
    pool: Queryable,
    viewerUserId: string | null,
    query?: Record<string, unknown>,
  ) => Promise<ServiceResult>;
  moderateDeckShare: (
    pool: Queryable,
    adminUserId: string,
    shareId: string,
    input: { moderationStatus: string; reason?: string; reportStatus: string; resolutionNote?: string },
  ) => Promise<ServiceResult>;
  publishDeckShare: (
    pool: Queryable,
    userId: string,
    deckId: string,
    visibility: string,
    rulesVersion: string,
    generateShareId?: () => string,
  ) => Promise<ServiceResult>;
  reportDeckShare: (
    pool: Queryable,
    userId: string,
    shareId: string,
    input: { reason: string; note?: string },
    generateReportId?: () => string,
  ) => Promise<ServiceResult>;
  unpublishDeckShare: (pool: Queryable, userId: string, shareId: string) => Promise<ServiceResult>;
  updateDeckShare: (
    pool: Queryable,
    userId: string,
    shareId: string,
    input: { visibility?: string; published?: boolean; publishLatest?: boolean },
    rulesVersion: string,
  ) => Promise<ServiceResult>;
  unlikeDeckShare: (pool: Queryable, userId: string, shareId: string) => Promise<ServiceResult>;
};

interface Queryable {
  query: ReturnType<typeof vi.fn>;
}

type ServiceResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

function cardIds(): string[] {
  return Array.from({ length: 20 }, (_, index) => `card-${Math.floor(index / 2)}`);
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds_fixed_share',
    owner_user_id: 'u_owner',
    source_deck_id: 'd_owned',
    name: 'Shared Deck',
    card_ids: cardIds(),
    visibility: 'public',
    publication_status: 'published',
    moderation_status: 'visible',
    moderation_reason: '',
    published_rules_version: 'rules-v1',
    published_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T01:00:00.000Z',
    unpublished_at: null,
    owner_nickname: 'Owner',
    source_deck_exists: true,
    source_changed: false,
    elements: ['炎'],
    character_count: 12,
    representative_card_ids: ['card-0', 'card-1', 'card-2'],
    like_count: 5,
    copy_count: 3,
    viewer_has_liked: true,
    ...overrides,
  };
}

describe('deck share service', () => {
  it('publishes an owned legal deck as an idempotent snapshot', async () => {
    const ids = cardIds();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM decks')) {
        return { rows: [{ id: 'd_owned', user_id: 'u_owner', name: 'Deck', card_ids: ids }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(ids)].map((id) => ({ id })), rowCount: 10 };
      }
      if (sql.includes('INSERT INTO deck_shares')) {
        return { rows: [shareRow({ id: 'ds_generated', name: 'Deck', card_ids: ids })], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      publishDeckShare({ query }, 'u_owner', 'd_owned', 'public', 'rules-v1', () => 'ds_generated'),
    ).resolves.toMatchObject({
      ok: true,
      body: {
        id: 'ds_generated',
        name: 'Deck',
        cardIds: ids,
        publicationStatus: 'published',
        sourceDeckId: 'd_owned',
      },
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ON CONFLICT (source_deck_id)'), [
      'ds_generated',
      'u_owner',
      'd_owned',
      'Deck',
      JSON.stringify(ids),
      'public',
      'rules-v1',
    ]);
  });

  it('rejects invalid visibility and decks not owned by the caller', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await expect(publishDeckShare({ query }, 'u_owner', 'd_owned', 'private', 'rules-v1')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid deck share visibility',
    });
    expect(query).not.toHaveBeenCalled();

    await expect(publishDeckShare({ query }, 'u_owner', 'd_other', 'public', 'rules-v1')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Deck not found',
    });
  });

  it('returns owner state including source drift without exposing it in public mappings', async () => {
    const query = vi.fn(async () => ({ rows: [shareRow({ source_changed: true })], rowCount: 1 }));
    await expect(getOwnedDeckShare({ query }, 'u_owner', 'd_owned')).resolves.toMatchObject({
      ok: true,
      body: {
        id: 'ds_fixed_share',
        sourceChanged: true,
        sourceDeckExists: true,
        moderationReason: '',
      },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('d.card_ids IS DISTINCT FROM ds.card_ids'), [
      'd_owned',
      'u_owner',
    ]);
  });

  it('updates the published snapshot from the server-owned source deck', async () => {
    const ids = cardIds();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('source_name')) {
        return {
          rows: [
            shareRow({
              source_name: 'Latest Deck',
              source_card_ids: ids,
              current_source_deck_id: 'd_owned',
            }),
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(ids)].map((id) => ({ id })), rowCount: 10 };
      }
      if (sql.includes('UPDATE deck_shares')) {
        return {
          rows: [
            shareRow({
              name: 'Latest Deck',
              card_ids: ids,
              visibility: 'unlisted',
              published_rules_version: 'rules-v2',
            }),
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      updateDeckShare(
        { query },
        'u_owner',
        'ds_fixed_share',
        { publishLatest: true, visibility: 'unlisted', published: true },
        'rules-v2',
      ),
    ).resolves.toMatchObject({
      ok: true,
      body: { name: 'Latest Deck', visibility: 'unlisted', publishedRulesVersion: 'rules-v2' },
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('published_rules_version = $7'), [
      'ds_fixed_share',
      'u_owner',
      'Latest Deck',
      JSON.stringify(ids),
      'unlisted',
      'published',
      'rules-v2',
    ]);
  });

  it('cannot publish latest after the source deck has been deleted', async () => {
    const query = vi.fn(async () => ({
      rows: [shareRow({ current_source_deck_id: null, source_name: null, source_card_ids: null })],
      rowCount: 1,
    }));
    await expect(
      updateDeckShare({ query }, 'u_owner', 'ds_fixed_share', { publishLatest: true }, 'rules-v2'),
    ).resolves.toEqual({ ok: false, status: 409, error: 'The source deck no longer exists' });
  });

  it('unpublishes only shares owned by the caller', async () => {
    const successQuery = vi.fn(async () => ({ rows: [{ id: 'ds_fixed_share' }], rowCount: 1 }));
    await expect(unpublishDeckShare({ query: successQuery }, 'u_owner', 'ds_fixed_share')).resolves.toEqual({
      ok: true,
      body: { unpublished: true, shareId: 'ds_fixed_share' },
    });

    const missingQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await expect(unpublishDeckShare({ query: missingQuery }, 'u_other', 'ds_fixed_share')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Deck share not found',
    });
  });

  it('maps public detail and applies bidirectional block filtering', async () => {
    const query = vi.fn(async () => ({ rows: [shareRow()], rowCount: 1 }));
    await expect(getDeckShare({ query }, 'u_viewer', 'ds_fixed_share')).resolves.toMatchObject({
      ok: true,
      body: {
        id: 'ds_fixed_share',
        cardIds: cardIds(),
        owner: { userId: 'u_owner', nickname: 'Owner' },
        likeCount: 5,
        viewerHasLiked: true,
      },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('block.blocker_user_id = $2'), [
      'ds_fixed_share',
      'u_viewer',
    ]);
  });

  it('lists public shares with filters and stable cursors', async () => {
    const rows = [shareRow(), shareRow({ id: 'ds_second_share', like_count: 4 })];
    const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
    const result = await listDeckShares({ query }, 'u_viewer', {
      sort: 'popular',
      q: 'deck',
      element: '炎',
      limit: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      body: { shares: [{ id: 'ds_fixed_share' }, { id: 'ds_second_share' }], nextCursor: expect.any(String) },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY like_count DESC, updated_at DESC, id DESC'), [
      'u_viewer',
      '%deck%',
      '炎',
      2,
    ]);

    if (!result.ok) throw new Error('Expected successful list');
    const cursor = result.body.nextCursor as string;
    expect(decodeCursor(cursor, 'popular')).toMatchObject({ sort: 'popular', id: 'ds_second_share', count: 4 });
    expect(decodeCursor(cursor, 'newest')).toBeNull();
  });

  it('rejects malformed cursors before querying PostgreSQL', async () => {
    const query = vi.fn();
    await expect(listDeckShares({ query }, null, { cursor: 'not-a-cursor' })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid deck share cursor',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('round-trips newest cursors without engagement counts', () => {
    const cursor = encodeCursor('newest', shareRow());
    expect(decodeCursor(cursor, 'newest')).toMatchObject({
      v: 1,
      sort: 'newest',
      id: 'ds_fixed_share',
      updatedAt: '2026-07-20T01:00:00.000Z',
    });
  });

  it('copies a visible share transactionally and records a trusted copy event', async () => {
    const ids = cardIds();
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 1 };
      if (sql.includes('FROM deck_shares ds')) {
        return { rows: [{ id: 'ds_fixed_share', owner_user_id: 'u_owner', name: 'Shared', card_ids: ids }] };
      }
      if (sql.includes('FROM deck_share_copy_events event')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(ids)].map((id) => ({ id })), rowCount: 10 };
      }
      if (sql.startsWith('INSERT INTO decks')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO deck_share_copy_events')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT COUNT(*) AS count FROM deck_share_copy_events')) {
        return { rows: [{ count: '7' }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      copyDeckShare(
        { query },
        'u_viewer',
        'ds_fixed_share',
        { name: 'Shared Copy', idempotencyKey: 'copy_key_123' },
        () => 'd_copied',
      ),
    ).resolves.toEqual({
      ok: true,
      body: { deck: { id: 'd_copied', name: 'Shared Copy', cardIds: ids }, copyCount: 7 },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO deck_share_copy_events'), [
      'ds_fixed_share',
      'u_viewer',
      'd_copied',
      'copy_key_123',
    ]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('makes likes idempotent and rejects liking your own share', async () => {
    const ownQuery = vi.fn(async () => ({
      rows: [{ id: 'ds_fixed_share', owner_user_id: 'u_owner', name: 'Shared', card_ids: cardIds() }],
      rowCount: 1,
    }));
    await expect(likeDeckShare({ query: ownQuery }, 'u_owner', 'ds_fixed_share')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'You cannot like your own deck share',
    });

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM deck_shares ds')) {
        return { rows: [{ id: 'ds_fixed_share', owner_user_id: 'u_owner' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO deck_share_likes')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT COUNT(*) AS count FROM deck_share_likes')) {
        return { rows: [{ count: '6' }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(likeDeckShare({ query }, 'u_viewer', 'ds_fixed_share')).resolves.toEqual({
      ok: true,
      body: { liked: true, likeCount: 6 },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (share_id, user_id) DO NOTHING'), [
      'ds_fixed_share',
      'u_viewer',
    ]);
  });

  it('unlikes a visible share and returns the authoritative count', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM deck_shares ds')) {
        return { rows: [{ id: 'ds_fixed_share', owner_user_id: 'u_owner' }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM deck_share_likes')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT COUNT(*) AS count FROM deck_share_likes')) {
        return { rows: [{ count: '4' }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(unlikeDeckShare({ query }, 'u_viewer', 'ds_fixed_share')).resolves.toEqual({
      ok: true,
      body: { liked: false, likeCount: 4 },
    });
  });

  it('creates or updates one active report per reporter and share', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM deck_shares ds')) {
        return { rows: [{ id: 'ds_fixed_share', owner_user_id: 'u_owner' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO deck_share_reports')) {
        return {
          rows: [
            {
              id: 'dsr_fixed',
              share_id: 'ds_fixed_share',
              reason: 'spam',
              note: 'Repeated post',
              status: 'pending',
              created_at: '2026-07-20T00:00:00.000Z',
              updated_at: '2026-07-20T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(
      reportDeckShare(
        { query },
        'u_viewer',
        'ds_fixed_share',
        { reason: 'spam', note: 'Repeated post' },
        () => 'dsr_fixed',
      ),
    ).resolves.toMatchObject({
      ok: true,
      body: { report: { id: 'dsr_fixed', status: 'pending', reason: 'spam' } },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (share_id, reporter_user_id)'), [
      'dsr_fixed',
      'ds_fixed_share',
      'u_viewer',
      'spam',
      'Repeated post',
    ]);
  });

  it('lists reports with share evidence and applies admin moderation transactionally', async () => {
    const listQuery = vi.fn(async () => ({
      rows: [
        {
          id: 'dsr_fixed',
          share_id: 'ds_fixed_share',
          reporter_user_id: 'u_viewer',
          reporter_nickname: 'Viewer',
          reason: 'spam',
          note: '',
          status: 'pending',
          created_at: '2026-07-20T00:00:00.000Z',
          updated_at: '2026-07-20T00:00:00.000Z',
          share_name: 'Shared',
          owner_user_id: 'u_owner',
          owner_nickname: 'Owner',
          publication_status: 'published',
          moderation_status: 'visible',
          moderation_reason: '',
          card_ids: cardIds(),
        },
      ],
      rowCount: 1,
    }));
    await expect(listAdminDeckShareReports({ query: listQuery }, { status: 'pending' })).resolves.toMatchObject({
      ok: true,
      body: { reports: [{ id: 'dsr_fixed', share: { name: 'Shared', cardIds: cardIds() } }] },
    });

    const moderateQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE deck_shares')) {
        return {
          rows: [{ id: 'ds_fixed_share', moderation_status: 'hidden', moderation_reason: 'spam' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    await expect(
      moderateDeckShare({ query: moderateQuery }, 'admin_1', 'ds_fixed_share', {
        moderationStatus: 'hidden',
        reason: 'spam',
        reportStatus: 'resolved',
      }),
    ).resolves.toEqual({
      ok: true,
      body: { shareId: 'ds_fixed_share', moderationStatus: 'hidden', moderationReason: 'spam' },
    });
    expect(moderateQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_1',
      'ds_fixed_share',
      JSON.stringify({ moderationStatus: 'hidden', reason: 'spam', reportStatus: 'resolved' }),
    ]);
    expect(moderateQuery).toHaveBeenLastCalledWith('COMMIT');
  });
});
