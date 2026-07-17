import { describe, expect, it, vi } from 'vitest';
import { createPostgresPlatformMatchParticipantStore } from '../matchParticipantStore';

describe('platform match participant store', () => {
  it('rechecks a live account under the shared advisory fence without requiring users UPDATE privilege', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SELECT id, deleted_at FROM users WHERE id = $1') {
        return { rows: [{ id: 'u_platform', deleted_at: null }] };
      }
      return { rows: [] };
    });
    const store = createPostgresPlatformMatchParticipantStore({
      query,
      connect: vi.fn(async () => ({ query, release })),
    });

    await store.recordParticipant({
      boardgameMatchID: 'match-1',
      userId: 'u_platform',
      role: 'player',
      boardgamePlayerID: '0',
      displayName: 'Player',
      accessVerified: true,
    });

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'SELECT id, deleted_at FROM users WHERE id = $1',
      expect.stringContaining('INSERT INTO platform_match_participants'),
      'COMMIT',
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
