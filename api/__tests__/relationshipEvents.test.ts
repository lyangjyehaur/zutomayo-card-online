import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { RELATIONSHIP_CHANGE_CHANNEL, createRelationshipChange, parseRelationshipChange, publishRelationshipChange } =
  require('../relationshipEvents.cjs') as {
    RELATIONSHIP_CHANGE_CHANNEL: string;
    createRelationshipChange: (
      kind: string,
      userIds: string[],
      options?: { actorUserId?: string },
    ) => Record<string, unknown>;
    parseRelationshipChange: (value: unknown) => { kind: string; userIds: string[] } | null;
    publishRelationshipChange: (
      redis: { publish: (channel: string, payload: string) => Promise<number> },
      kind: string,
      userIds: string[],
    ) => Promise<Record<string, unknown>>;
  };

describe('relationship change events', () => {
  it('normalizes pair ordering and rejects malformed events', () => {
    const event = createRelationshipChange('friendship_removed', ['u_zed', 'u_alice']);
    expect(event).toMatchObject({ version: 1, kind: 'friendship_removed', userIds: ['u_alice', 'u_zed'] });
    expect(parseRelationshipChange(JSON.stringify(event))).toMatchObject({
      kind: 'friendship_removed',
      userIds: ['u_alice', 'u_zed'],
    });
    expect(parseRelationshipChange('{broken')).toBeNull();
    expect(() => createRelationshipChange('friendship_removed', ['u_alice'])).toThrow(
      'Invalid relationship change users',
    );
    expect(() => createRelationshipChange('block_created', ['u_zed', 'u_alice'])).toThrow(
      'Block relationship change actor is required',
    );
    expect(
      parseRelationshipChange({
        version: 1,
        eventId: 'event-without-actor',
        kind: 'block_created',
        userIds: ['u_zed', 'u_alice'],
        occurredAt: new Date().toISOString(),
      }),
    ).toBeNull();
    expect(createRelationshipChange('block_created', ['u_zed', 'u_alice'], { actorUserId: 'u_zed' })).toMatchObject({
      actorUserId: 'u_zed',
    });
  });

  it('publishes the validated event to the versioned channel', async () => {
    const publish = vi.fn(async () => 1);
    const event = await publishRelationshipChange({ publish }, 'friendship_removed', ['u_2', 'u_1']);

    expect(publish).toHaveBeenCalledWith(RELATIONSHIP_CHANGE_CHANNEL, JSON.stringify(event));
  });
});
