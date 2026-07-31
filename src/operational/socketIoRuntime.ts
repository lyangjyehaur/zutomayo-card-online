export interface SocketNamespaceRuntime {
  on: (event: string, callback: (socket: unknown) => void) => void;
  emit: (event: string, payload: unknown) => void;
  disconnectSockets: (close?: boolean) => void;
}

export interface SocketIoRuntime {
  of: (namespace: string) => SocketNamespaceRuntime;
  close: () => Promise<void> | void;
}

/** boardgame.io stores the raw Socket.IO server on the Koa app, not its context wrapper. */
export function resolveSocketIoRuntime(app: unknown): SocketIoRuntime | undefined {
  const candidate = (app as { _io?: Partial<SocketIoRuntime> } | null | undefined)?._io;
  if (!candidate || typeof candidate.of !== 'function' || typeof candidate.close !== 'function') return undefined;
  return candidate as SocketIoRuntime;
}
