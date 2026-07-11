import type { PlatformCustomRoom, PlatformCustomRoomHandlers, PlatformCustomRoomOptions } from '../platformClient';

export type CustomRoomRelayFailureReason = 'timeout' | 'cancelled' | 'disconnected' | 'join_failed';

export class CustomRoomRelayError extends Error {
  reason: CustomRoomRelayFailureReason;

  constructor(reason: CustomRoomRelayFailureReason) {
    super(`Platform custom room relay failed: ${reason}`);
    this.name = 'CustomRoomRelayError';
    this.reason = reason;
  }
}

export function customRoomRelayErrorKey(error: unknown): 'lobby.matchmakingTimeout' | 'lobby.onlineError' | null {
  if (!(error instanceof CustomRoomRelayError)) return null;
  return error.reason === 'timeout' ? 'lobby.matchmakingTimeout' : 'lobby.onlineError';
}

export type JoinPlatformCustomRoom = (
  options: PlatformCustomRoomOptions,
  handlers: PlatformCustomRoomHandlers,
) => Promise<PlatformCustomRoom>;

export interface ResolvePlatformCustomRoomMatchIDInput {
  roomCode: string;
  userId: string;
  displayName: string;
  joinPlatformCustomRoom: JoinPlatformCustomRoom;
  timeoutMs?: number;
}

const DEFAULT_CUSTOM_ROOM_RELAY_TIMEOUT_MS = 10_000;

export function resolvePlatformCustomRoomMatchID({
  roomCode,
  userId,
  displayName,
  joinPlatformCustomRoom,
  timeoutMs = DEFAULT_CUSTOM_ROOM_RELAY_TIMEOUT_MS,
}: ResolvePlatformCustomRoomMatchIDInput): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let room: PlatformCustomRoom | null = null;
    const timer = globalThis.setTimeout(() => fail('timeout'), timeoutMs);

    const closeRoom = () => {
      void room?.leave(true).catch(() => undefined);
      room = null;
    };

    const finish = (boardgameMatchID: string) => {
      if (settled) return;
      const cleanMatchID = boardgameMatchID.trim();
      if (!cleanMatchID) return;
      settled = true;
      globalThis.clearTimeout(timer);
      closeRoom();
      resolve(cleanMatchID);
    };

    const fail = (reason: CustomRoomRelayFailureReason) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      closeRoom();
      reject(new CustomRoomRelayError(reason));
    };

    void joinPlatformCustomRoom(
      {
        roomCode,
        userId,
        displayName,
      },
      {
        onSnapshot: (snapshot) => {
          if (snapshot.roomCode !== roomCode || snapshot.status !== 'ready') return;
          if (snapshot.boardgameMatchID) finish(snapshot.boardgameMatchID);
        },
        onBoardgameMatchReady: (message) => finish(message.boardgameMatchID),
        onCancelled: () => fail('cancelled'),
        onDisconnect: () => fail('disconnected'),
      },
    ).then(
      (nextRoom) => {
        if (settled) {
          void nextRoom.leave(true).catch(() => undefined);
          return;
        }
        room = nextRoom;
      },
      () => fail('join_failed'),
    );
  });
}
