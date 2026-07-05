import { describe, expect, it } from 'vitest';
import { createOnlineStateSnapshot, evaluateOnlineStateSnapshot } from '../onlineStateGuard';

describe('online state guard', () => {
  it('accepts monotonically increasing state IDs', () => {
    const first = createOnlineStateSnapshot({ stateID: 3, G: { step: 'turnSet' }, ctx: { currentPlayer: '0' } });
    const second = createOnlineStateSnapshot({ stateID: 4, G: { step: 'effectOrder' }, ctx: { currentPlayer: '0' } });

    expect(evaluateOnlineStateSnapshot(null, first)).toEqual({ ok: true, snapshot: first });
    expect(evaluateOnlineStateSnapshot(first, second)).toEqual({ ok: true, snapshot: second });
  });

  it('rejects state ID regressions', () => {
    const previous = createOnlineStateSnapshot({ stateID: 5, G: { step: 'turnSet' }, ctx: {} });
    const next = createOnlineStateSnapshot({ stateID: 4, G: { step: 'turnSet' }, ctx: {} });

    expect(evaluateOnlineStateSnapshot(previous, next)).toEqual({
      ok: false,
      reason: 'stateID-regressed',
      snapshot: next,
    });
  });

  it('rejects different fingerprints for the same state ID', () => {
    const previous = createOnlineStateSnapshot({ stateID: 6, G: { ready: [true, false] }, ctx: {} });
    const next = createOnlineStateSnapshot({ stateID: 6, G: { ready: [false, true] }, ctx: {} });

    expect(evaluateOnlineStateSnapshot(previous, next)).toEqual({
      ok: false,
      reason: 'stateID-collision',
      snapshot: next,
    });
  });

  it('uses stable object key ordering for fingerprints', () => {
    const first = createOnlineStateSnapshot({ stateID: 7, G: { a: 1, b: 2 }, ctx: {} });
    const second = createOnlineStateSnapshot({ stateID: 7, G: { b: 2, a: 1 }, ctx: {} });

    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
