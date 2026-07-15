export function onlineSocketOptions(): {
  transports: ['websocket'];
  upgrade: false;
} {
  // HTTP polling requires affinity between the handshake and every follow-up
  // request. WebSocket-only keeps one connection on one game process and also
  // matches the server transport contract used by server4.
  return { transports: ['websocket'], upgrade: false };
}
