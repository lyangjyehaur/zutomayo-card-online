import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type OutboxConfig = {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
};

const {
  claimRelationshipChanges,
  deliverRelationshipOutboxBatch,
  enqueueRelationshipChange,
  redriveRelationshipChange,
  retryDelayMs,
} = require('../relationshipOutbox.cjs') as {
  claimRelationshipChanges: (pool: object, config: OutboxConfig) => Promise<Record<string, unknown>[]>;
  deliverRelationshipOutboxBatch: (options: Record<string, unknown>) => Promise<Record<string, number>>;
  enqueueRelationshipChange: (
    client: object,
    kind: string,
    userIds: string[],
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  redriveRelationshipChange: (pool: object, eventId: string) => Promise<boolean>;
  retryDelayMs: (attemptCount: number, config: OutboxConfig) => number;
};

const config = {
  batchSize: 10,
  leaseMs: 30_000,
  maxAttempts: 3,
  baseRetryMs: 100,
  maxRetryMs: 1_000,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1234567890',
    version: 1,
    kind: 'block_created',
    user_ids: ['u_actor', 'u_target'],
    actor_user_id: 'u_actor',
    occurred_at: '2026-07-13T00:00:00.000Z',
    attempt_count: 1,
    poison_count: 0,
    lock_token: 'lock-1',
    ...overrides,
  };
}

function deliveryPool(outboxRow = row()) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('WITH claimable')) return { rows: [outboxRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('relationship change outbox', () => {
  it('enqueues the canonical payload with an optional idempotency key and actor', async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ event_id: 'event-id' }], rowCount: 1 })) };

    const event = await enqueueRelationshipChange(client, 'block_created', ['u_target', 'u_actor'], {
      actorUserId: 'u_actor',
      idempotencyKey: 'block:test',
    });

    expect(event).toMatchObject({
      version: 1,
      kind: 'block_created',
      userIds: ['u_actor', 'u_target'],
      actorUserId: 'u_actor',
      enqueued: true,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO relationship_change_outbox'), [
      event.eventId,
      'block:test',
      1,
      'block_created',
      ['u_actor', 'u_target'],
      'u_actor',
      event.occurredAt,
    ]);
  });

  it('claims due and stale rows with SKIP LOCKED and a bounded lease', async () => {
    const pool = deliveryPool();

    await expect(claimRelationshipChanges(pool, config)).resolves.toEqual([row()]);
    const claim = pool.query.mock.calls.find(([sql]) => String(sql).includes('WITH claimable'));
    expect(claim?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim?.[0]).toContain("status = 'processing' AND lease_expires_at <= NOW()");
    expect(claim?.[1]?.slice(0, 2)).toEqual([10, 30_000]);
    expect(claim?.[1]?.[2]).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('projects, publishes the same event id, and marks delivery with the claim token', async () => {
    const pool = deliveryPool();
    const projectEvent = vi.fn(async () => undefined);
    const publish = vi.fn(async () => 2);

    await expect(deliverRelationshipOutboxBatch({ pool, redis: { publish }, config, projectEvent })).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
    });

    expect(projectEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1234567890' }));
    expect(publish).toHaveBeenCalledWith(
      'zutomayo:relationship-change:v1',
      expect.stringContaining('"eventId":"event-1234567890"'),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND lock_token = $2'), [
      'event-1234567890',
      'lock-1',
    ]);
    expect(projectEvent.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
  });

  it('retries transport outages without consuming poison budget and dead-letters malformed rows', async () => {
    const retryPool = deliveryPool(row({ attempt_count: 20, poison_count: 20 }));
    await expect(
      deliverRelationshipOutboxBatch({ redis: { publish: vi.fn(async () => 0) }, pool: retryPool, config }),
    ).resolves.toMatchObject({ retried: 1, deadLettered: 0 });
    expect(retryPool.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      'event-1234567890',
      'pending',
      1_000,
      'Relationship event has no active subscribers',
      'lock-1',
      0,
    ]);

    const deadPool = deliveryPool(row({ actor_user_id: null, poison_count: 2 }));
    await expect(
      deliverRelationshipOutboxBatch({ redis: { publish: vi.fn(async () => 1) }, pool: deadPool, config }),
    ).resolves.toMatchObject({ retried: 0, deadLettered: 1 });
    expect(deadPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $2'),
      expect.arrayContaining(['dead_letter']),
    );
  });

  it('redrives only a dead-letter event and caps exponential retry delay', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ event_id: 'event-1234567890' }], rowCount: 1 })) };
    await expect(redriveRelationshipChange(pool, 'event-1234567890')).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'dead_letter'"), ['event-1234567890']);
    expect(retryDelayMs(20, config)).toBe(1_000);
  });
});
