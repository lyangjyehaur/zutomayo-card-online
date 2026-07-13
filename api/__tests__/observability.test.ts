import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { register, refreshMatchmakingQueueDepth } = require('../observability.cjs') as {
  register: { resetMetrics: () => void; metrics: () => Promise<string> };
  refreshMatchmakingQueueDepth: (redis: { zcard: (key: string) => Promise<number> }) => Promise<void>;
};

describe('API operational metrics', () => {
  it('exports the live Redis matchmaking queue depth', async () => {
    register.resetMetrics();
    const zcard = vi.fn(async (key: string) => {
      expect(key).toBe('mm:queue');
      return 7;
    });

    await refreshMatchmakingQueueDepth({ zcard });
    const metrics = await register.metrics();
    expect(metrics).toContain('matchmaking_queue_depth 7');
    expect(zcard).toHaveBeenCalledOnce();
  });
});
