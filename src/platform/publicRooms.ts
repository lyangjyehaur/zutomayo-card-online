import type { IRoomCache } from '@colyseus/core';
import type { CustomRoomMetadata } from './rooms/types';

const MAX_PUBLIC_ROOMS = 50;

export interface PublicCustomRoomSummary {
  roomCode: string;
  hostDisplayName: string;
  playerCount: number;
  createdAt: number;
}

type CustomRoomCache = Pick<
  IRoomCache<CustomRoomMetadata>,
  'name' | 'roomId' | 'clients' | 'maxClients' | 'locked' | 'private' | 'unlisted' | 'metadata' | 'createdAt'
>;

function createdAtTimestamp(value: Date | string | number | undefined): number {
  if (value instanceof Date) return value.getTime();
  const timestamp = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function publicCustomRoomSummaries(rooms: CustomRoomCache[]): PublicCustomRoomSummary[] {
  return rooms
    .filter((room) => {
      const metadata = room.metadata;
      return (
        room.name === 'custom_room' &&
        !room.locked &&
        !room.private &&
        !room.unlisted &&
        room.clients < room.maxClients &&
        metadata?.kind === 'custom-room' &&
        metadata.status === 'waiting' &&
        metadata.playerCount === 1 &&
        Boolean(metadata.roomCode.trim()) &&
        Boolean(metadata.hostDisplayName?.trim())
      );
    })
    .sort((left, right) => createdAtTimestamp(left.createdAt) - createdAtTimestamp(right.createdAt))
    .slice(0, MAX_PUBLIC_ROOMS)
    .map((room) => ({
      roomCode: room.metadata!.roomCode.trim().slice(0, 128),
      hostDisplayName: room.metadata!.hostDisplayName!.trim().slice(0, 60),
      playerCount: room.metadata!.playerCount,
      createdAt: createdAtTimestamp(room.createdAt),
    }));
}
