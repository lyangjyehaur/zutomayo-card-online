import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { RELATIONSHIP_CHANGE_CHANNEL, createRelationshipChange, parseRelationshipChange, publishRelationshipChange } =
  require('../relationshipEvents.cjs') as {
    RELATIONSHIP_CHANGE_CHANNEL: string;
    createRelationshipChange: (kind: string, userIds: string[]) => Record<string, unknown>;
    parseRelationshipChange: (value: unknown) => { kind: string; userIds: string[] } | null;
    publishRelationshipChange: (
      redis: { publish: (channel: string, payload: string) => Promise<number> },
      kind: string,
      userIds: string[],
    ) => Promise<Record<string, unknown>>;
  };

describe('relationship change events', () => {
  it('normalizes pair ordering and rejects malformed events', () => {
    const event = createRelationshipChange('block_created', ['u_zed', 'u_alice']);
    expect(event).toMatchObject({ version: 1, kind: 'block_created', userIds: ['u_alice', 'u_zed'] });
    expect(parseRelationshipChange(JSON.stringify(event))).toMatchObject({
      kind: 'block_created',
      userIds: ['u_alice', 'u_zed'],
    });
    expect(parseRelationshipChange('{broken')).toBeNull();
    expect(() => createRelationshipChange('block_created', ['u_alice'])).toThrow('Invalid relationship change users');
  });

  it('publishes the validated event to the versioned channel', async () => {
    const publish = vi.fn(async () => 1);
    const event = await publishRelationshipChange({ publish }, 'friendship_removed', ['u_2', 'u_1']);

    expect(publish).toHaveBeenCalledWith(RELATIONSHIP_CHANGE_CHANNEL, JSON.stringify(event));
  });
});
