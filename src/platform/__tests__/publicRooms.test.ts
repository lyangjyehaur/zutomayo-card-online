import type { IRoomCache } from '@colyseus/core';
import { describe, expect, it } from 'vitest';
import { publicCustomRoomSummaries } from '../publicRooms';
import type { CustomRoomMetadata } from '../rooms/types';

function room(overrides: Partial<IRoomCache<CustomRoomMetadata>> = {}): IRoomCache<CustomRoomMetadata> {
  return {
    name: 'custom_room',
    roomId: 'platform-room-1',
    processId: 'process-1',
    clients: 1,
    maxClients: 16,
    createdAt: new Date('2026-07-27T10:00:00.000Z'),
    metadata: {
      kind: 'custom-room',
      roomCode: 'ROOM-1',
      status: 'waiting',
      playerCount: 1,
      spectatorCount: 0,
      hostDisplayName: 'Host',
    },
    ...overrides,
  };
}

describe('public custom room summaries', () => {
  it('returns waiting rooms in oldest-first order without internal room data', () => {
    expect(
      publicCustomRoomSummaries([
        room({
          roomId: 'newer-internal-id',
          createdAt: new Date('2026-07-27T10:05:00.000Z'),
          metadata: { ...room().metadata!, roomCode: ' ROOM-2 ', hostDisplayName: ' Newer Host ' },
        }),
        room(),
      ]),
    ).toEqual([
      {
        roomCode: 'ROOM-1',
        hostDisplayName: 'Host',
        playerCount: 1,
        createdAt: Date.parse('2026-07-27T10:00:00.000Z'),
      },
      {
        roomCode: 'ROOM-2',
        hostDisplayName: 'Newer Host',
        playerCount: 1,
        createdAt: Date.parse('2026-07-27T10:05:00.000Z'),
      },
    ]);
  });

  it('excludes private, unavailable, full, and already matched rooms', () => {
    const candidates = [
      room({ private: true }),
      room({ unlisted: true }),
      room({ locked: true }),
      room({ clients: 16 }),
      room({ metadata: { ...room().metadata!, status: 'ready' } }),
      room({ metadata: { ...room().metadata!, playerCount: 2 } }),
      room({ metadata: { ...room().metadata!, hostDisplayName: undefined } }),
      room({ name: 'invite' }),
    ];

    expect(publicCustomRoomSummaries(candidates)).toEqual([]);
  });

  it('caps the public response size', () => {
    const candidates = Array.from({ length: 60 }, (_, index) =>
      room({
        roomId: `room-${index}`,
        metadata: { ...room().metadata!, roomCode: `ROOM-${index}` },
      }),
    );

    expect(publicCustomRoomSummaries(candidates)).toHaveLength(50);
  });
});
