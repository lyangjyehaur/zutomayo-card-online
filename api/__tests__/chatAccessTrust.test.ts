import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { hasMatchChatAccess, hasRoomChatAccess } = require('../chatService.cjs') as {
  hasMatchChatAccess: (input: {
    pool: { query: ReturnType<typeof vi.fn> };
    userId: string;
    subjectId: string;
  }) => Promise<boolean>;
  hasRoomChatAccess: (input: {
    pool: { query: ReturnType<typeof vi.fn> };
    userId: string;
    subjectId: string;
  }) => Promise<boolean>;
};

describe('durable chat ACL trust boundary', () => {
  it('requires verified match membership evidence', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query };

    await expect(hasMatchChatAccess({ pool, userId: 'u_intruder', subjectId: 'match-1' })).resolves.toBe(false);
    expect(query.mock.calls[0][0]).toContain('access_verified = TRUE');
  });

  it('requires verified custom-room membership evidence', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query };

    await expect(hasRoomChatAccess({ pool, userId: 'u_intruder', subjectId: 'ROOM42' })).resolves.toBe(false);
    expect(query.mock.calls[0][0]).toContain('access_verified = TRUE');
  });
});
