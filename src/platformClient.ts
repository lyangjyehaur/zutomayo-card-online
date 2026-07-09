import type { Room, SeatReservation } from 'colyseus.js';

export type PlatformRole = 'player' | 'spectator' | 'moderator';

export interface PlatformLobbyJoinOptions {
  userId: string;
  displayName: string;
  role?: PlatformRole;
}

export interface PlatformLobbyHandlers {
  onOnlineCount: (onlineCount: number) => void;
  onDisconnect?: () => void;
}

interface LocationLike {
  protocol: string;
  hostname: string;
  port: string;
}

export type PlatformLobbyRoom = Room<unknown>;

interface FlatSeatReservation {
  name: string;
  roomId: string;
  sessionId: string;
  processId?: string;
  protocol?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

function readConfiguredPlatformUrl(): string | undefined {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return viteEnv?.VITE_PLATFORM_URL ?? (typeof process === 'undefined' ? undefined : process.env.VITE_PLATFORM_URL);
}

export function resolvePlatformEndpoint(
  configuredUrl = readConfiguredPlatformUrl(),
  location: LocationLike | undefined = typeof window === 'undefined' ? undefined : window.location,
): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed) return trimmed;

  if (!location) return 'ws://127.0.0.1:3002';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = location.port === '3000' || location.port === '5173' ? '3002' : location.port;
  return `${protocol}//${location.hostname}${port ? `:${port}` : ''}`;
}

export function platformOnlineCountFromMessage(message: unknown): number | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { onlineCount?: unknown; players?: unknown; spectators?: unknown };
  if (Number.isFinite(data.onlineCount)) return Math.max(0, Math.trunc(data.onlineCount as number));
  if (Number.isFinite(data.players) && Number.isFinite(data.spectators)) {
    return Math.max(0, Math.trunc((data.players as number) + (data.spectators as number)));
  }
  return null;
}

export function normalizeSeatReservation(response: FlatSeatReservation | SeatReservation): SeatReservation {
  if ('room' in response) return response;
  const room = {
    name: response.name,
    roomId: response.roomId,
    processId: response.processId,
    clients: 0,
    maxClients: 0,
  } as SeatReservation['room'] & { processId?: string };

  return {
    sessionId: response.sessionId,
    protocol: response.protocol,
    reconnectionToken: response.reconnectionToken,
    devMode: response.devMode,
    room,
  };
}

export async function connectPlatformLobby(
  options: PlatformLobbyJoinOptions,
  handlers: PlatformLobbyHandlers,
): Promise<PlatformLobbyRoom> {
  const { Client } = await import('colyseus.js');
  const client = new Client(resolvePlatformEndpoint());
  const response = await client.http.post('matchmake/joinOrCreate/lobby', {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: options.userId,
      displayName: options.displayName,
      role: options.role ?? 'spectator',
    }),
  });
  const room = await client.consumeSeatReservation(normalizeSeatReservation(response.data as FlatSeatReservation));

  const handleOnlineCount = (message: unknown) => {
    const onlineCount = platformOnlineCountFromMessage(message);
    if (onlineCount !== null) handlers.onOnlineCount(onlineCount);
  };

  room.onMessage('lobbySnapshot', handleOnlineCount);
  room.onMessage('presence', handleOnlineCount);
  room.onLeave(() => handlers.onDisconnect?.());

  return room;
}
