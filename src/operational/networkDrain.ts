export interface DrainHttpServer {
  listening?: boolean;
  close: (callback: (error?: Error) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface DrainSocketNamespace {
  emit: (event: string, payload: unknown) => void;
  disconnectSockets: (close?: boolean) => void;
}

export interface DrainSocketServer {
  close: () => Promise<void> | void;
}

export async function drainNetwork({
  httpServer,
  socketNamespace,
  socketServer,
  graceMs,
  sleep = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
  onSocketCloseError,
}: {
  httpServer?: DrainHttpServer;
  socketNamespace?: DrainSocketNamespace;
  socketServer?: DrainSocketServer;
  graceMs: number;
  sleep?: (durationMs: number) => Promise<void>;
  onSocketCloseError?: (error: unknown) => void;
}): Promise<void> {
  socketNamespace?.emit('serverDraining', { retryAfterMs: graceMs });
  const listenerClosed = !httpServer?.listening
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections?.();
      });

  if (graceMs > 0) await sleep(graceMs);
  socketNamespace?.disconnectSockets(true);
  try {
    await socketServer?.close();
  } catch (error) {
    onSocketCloseError?.(error);
  }
  httpServer?.closeAllConnections?.();
  await listenerClosed;
}
