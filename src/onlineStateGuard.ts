export type OnlineStateSnapshot = {
  stateID: number;
  fingerprint: string;
};

export type OnlineStateMismatchReason = 'stateID-regressed' | 'stateID-collision';

export type OnlineStateGuardResult =
  | { ok: true; snapshot: OnlineStateSnapshot }
  | { ok: false; reason: OnlineStateMismatchReason; snapshot: OnlineStateSnapshot };

type OnlineStateFingerprintInput = {
  stateID: number;
  G: unknown;
  ctx: unknown;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createOnlineStateSnapshot(input: OnlineStateFingerprintInput): OnlineStateSnapshot {
  return {
    stateID: input.stateID,
    fingerprint: fnv1a(stableStringify({ G: input.G, ctx: input.ctx, stateID: input.stateID })),
  };
}

export function evaluateOnlineStateSnapshot(
  previous: OnlineStateSnapshot | null,
  next: OnlineStateSnapshot,
): OnlineStateGuardResult {
  if (!previous) return { ok: true, snapshot: next };
  if (next.stateID < previous.stateID) {
    return { ok: false, reason: 'stateID-regressed', snapshot: next };
  }
  if (next.stateID === previous.stateID && next.fingerprint !== previous.fingerprint) {
    return { ok: false, reason: 'stateID-collision', snapshot: next };
  }
  return { ok: true, snapshot: next };
}
