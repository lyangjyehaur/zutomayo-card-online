export function onlineSocketOptions(): {
  transports: ['websocket'];
  upgrade: false;
} {
  // Multiple game replicas share durable state and PubSub, but Socket.IO HTTP
  // polling still requires load-balancer affinity between the handshake and
  // every follow-up request. A WebSocket-only transport keeps each connection
  // on one replica while allowing reconnects to land on any healthy replica.
  return { transports: ['websocket'], upgrade: false };
}
