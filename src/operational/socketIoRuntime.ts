import { resolveClientIp, type ForwardedForValue } from '../clientIp';

export interface SocketNamespaceRuntime {
  on: (event: string, callback: (socket: unknown) => void) => void;
  emit: (event: string, payload: unknown) => void;
  disconnectSockets: (close?: boolean) => void;
}

export interface SocketIoRuntime {
  of: (namespace: string) => SocketNamespaceRuntime;
  close: () => Promise<void> | void;
}

export interface SocketHandshakeRuntime {
  address: string;
  headers?: Record<string, ForwardedForValue>;
}

/** boardgame.io stores the raw Socket.IO server on the Koa app, not its context wrapper. */
export function resolveSocketIoRuntime(app: unknown): SocketIoRuntime | undefined {
  const candidate = (app as { _io?: Partial<SocketIoRuntime> } | null | undefined)?._io;
  if (!candidate || typeof candidate.of !== 'function' || typeof candidate.close !== 'function') return undefined;
  return candidate as SocketIoRuntime;
}

export function resolveSocketClientIp(
  handshake: SocketHandshakeRuntime,
  trustedProxyValue = process.env.TRUSTED_PROXY || '',
): string {
  const forwardedFor = handshake.headers?.['x-forwarded-for'] ?? handshake.headers?.['x-real-ip'];
  return resolveClientIp(handshake.address, forwardedFor, trustedProxyValue);
}
