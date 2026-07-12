import { Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { ParameterizedContext } from 'koa';

/**
 * koa-body consumes the request stream. Recreate the JSON stream after an
 * early trust-boundary middleware rewrites a payload so a downstream router
 * using its own body parser receives the canonical body.
 */
export function replayJsonRequestBody(ctx: ParameterizedContext, body: unknown): void {
  const source = ctx.req;
  const payload = Buffer.from(JSON.stringify(body));
  const headers: IncomingHttpHeaders = {
    ...source.headers,
    'content-type': 'application/json',
    'content-length': String(payload.byteLength),
  };
  delete headers['transfer-encoding'];

  const replay = Readable.from([payload]) as unknown as IncomingMessage;
  Object.assign(replay, {
    headers,
    method: source.method,
    url: source.url,
    httpVersion: source.httpVersion,
    httpVersionMajor: source.httpVersionMajor,
    httpVersionMinor: source.httpVersionMinor,
    rawHeaders: source.rawHeaders,
    rawTrailers: source.rawTrailers,
    trailers: source.trailers,
    socket: source.socket,
    connection: source.socket,
  });

  ctx.req = replay;
  ctx.request.req = replay;
  ctx.response.req = replay;
}
