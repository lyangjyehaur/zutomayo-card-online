import { describe, expect, it, vi } from 'vitest';
import {
  createPostgresPlatformMatchParticipantStore,
  resolvePlatformMatchParticipantStoreMode,
} from '../platform/matchParticipantStore';

function mockParticipantPool() {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(
    async (sql, params) =>
      sql.includes('FROM users') ? { rows: [{ id: params?.[0], deleted_at: null }] } : { rows: [] },
  );
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
}

describe('platform match participant store', () => {
  it('resolves durable participant store mode from deployment environment', () => {
    expect(resolvePlatformMatchParticipantStoreMode({ NODE_ENV: 'development' })).toBe('none');
    expect(resolvePlatformMatchParticipantStoreMode({ NODE_ENV: 'production' })).toBe('postgres');
    expect(resolvePlatformMatchParticipantStoreMode({ DATABASE_URL: 'postgres://example/db' })).toBe('postgres');
    expect(
      resolvePlatformMatchParticipantStoreMode({ PLATFORM_MATCH_PARTICIPANT_STORE: 'none', NODE_ENV: 'production' }),
    ).toBe('postgres');
    expect(
      resolvePlatformMatchParticipantStoreMode({ PLATFORM_MATCH_PARTICIPANT_STORE: 'none', NODE_ENV: 'development' }),
    ).toBe('none');
    expect(resolvePlatformMatchParticipantStoreMode({ PLATFORM_MATCH_PARTICIPANT_STORE: 'postgres' })).toBe('postgres');
  });

  it('records account-backed match participants', async () => {
    const pool = mockParticipantPool();
    const store = createPostgresPlatformMatchParticipantStore(pool);

    await store.recordParticipant({
      boardgameMatchID: ' bgio-match-1 ',
      userId: 'u_spectator',
      role: 'spectator',
      displayName: ' Spectator ',
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_spectator',
      'spectator',
      null,
      'Spectator',
      false,
    ]);
    const insert = pool.query.mock.calls.find(([sql]) => String(sql).includes('platform_match_participants'));
    expect(insert?.[0]).toContain("WHEN platform_match_participants.role = 'player' THEN 'player'");
    expect(insert?.[0]).toContain(
      'boardgame_player_id = COALESCE(platform_match_participants.boardgame_player_id, EXCLUDED.boardgame_player_id)',
    );
  });

  it('does not persist anonymous match-shell presence as chat evidence', async () => {
    const pool = mockParticipantPool();
    const store = createPostgresPlatformMatchParticipantStore(pool);

    await store.recordParticipant({
      boardgameMatchID: 'bgio-match-1',
      userId: 'guest:session',
      role: 'spectator',
    });
    await store.recordParticipant({
      boardgameMatchID: 'bgio-match-1',
      userId: 'anon:session',
      role: 'spectator',
    });

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('does not recreate participant evidence for a deleted account', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      sql.includes('FROM users')
        ? { rows: [{ id: params?.[0], deleted_at: '2026-07-13T00:00:00.000Z' }] }
        : { rows: [] },
    );
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const store = createPostgresPlatformMatchParticipantStore(pool);

    await expect(
      store.recordParticipant({ boardgameMatchID: 'bgio-match-1', userId: 'u_deleted', role: 'spectator' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO platform_match_participants'))).toBe(
      false,
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('records account-backed custom-room participants', async () => {
    const pool = mockParticipantPool();
    const store = createPostgresPlatformMatchParticipantStore(pool);

    await store.recordRoomParticipant({
      roomCode: ' ROOM42 ',
      userId: 'u_player',
      role: 'player',
      displayName: ' Player ',
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_player',
      'player',
      'Player',
      false,
    ]);
    const insert = pool.query.mock.calls.find(([sql]) => String(sql).includes('platform_room_participants'));
    expect(insert?.[0]).toContain("WHEN platform_room_participants.role = 'player' THEN 'player'");
  });

  it('does not persist anonymous custom-room presence as chat evidence', async () => {
    const pool = mockParticipantPool();
    const store = createPostgresPlatformMatchParticipantStore(pool);

    await store.recordRoomParticipant({
      roomCode: 'ROOM42',
      userId: 'guest:session',
      role: 'spectator',
    });
    await store.recordRoomParticipant({
      roomCode: 'ROOM42',
      userId: 'anon:session',
      role: 'spectator',
    });

    expect(pool.query).not.toHaveBeenCalled();
  });
});
