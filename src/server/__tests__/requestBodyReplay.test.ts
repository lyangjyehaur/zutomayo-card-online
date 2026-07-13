import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import Koa from 'koa';
import { describe, expect, it } from 'vitest';
import { replayJsonRequestBody } from '../requestBodyReplay';

const require = createRequire(import.meta.url);
const koaBody = require('koa-body') as typeof import('koa-body');

function createContext(payload: string) {
  const app = new Koa();
  const req = new PassThrough();
  Object.assign(req, {
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    },
    method: 'POST',
    url: '/games/zutomayo-card/create',
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    socket: {},
  });
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    statusCode: 200,
    writable: true,
    setHeader: () => undefined,
    getHeader: () => undefined,
    removeHeader: () => undefined,
    end: () => undefined,
  });
  const ctx = app.createContext(req as never, res as never);
  return { ctx, req };
}

describe('replayJsonRequestBody', () => {
  it('lets a downstream koa-body parser receive the rewritten canonical payload', async () => {
    const payload = JSON.stringify({
      setupData: { deck0ReservationId: 'dr_original', deck1Ids: ['untrusted'] },
      numPlayers: 2,
    });
    const { ctx, req } = createContext(payload);
    const parseBody = koaBody({ jsonLimit: '64kb' });
    const firstParse = parseBody(ctx, async () => undefined);
    req.end(payload);
    await firstParse;

    const canonical = {
      setupData: { deck0Ids: ['server-owned'], deck1Ids: undefined },
      numPlayers: 2,
    };
    replayJsonRequestBody(ctx, canonical);
    await koaBody()(ctx, async () => undefined);

    expect(ctx.request.body).toEqual(canonical);
  });
});
