import { describe, expect, it, vi } from 'vitest';
import { createPostgresPlatformMatchParticipantStore } from '../platform/matchParticipantStore';

describe('platform match participant store', () => {
  it('records account-backed match participants', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
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
    ]);
  });

  it('does not persist anonymous match-shell presence as chat evidence', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
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

  it('records account-backed custom-room participants', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
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
    ]);
  });

  it('does not persist anonymous custom-room presence as chat evidence', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
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
