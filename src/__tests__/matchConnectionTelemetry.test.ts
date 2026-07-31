import { describe, expect, it } from 'vitest';
import { createMatchConnectionTelemetry } from '../matchConnectionTelemetry';

describe('match connection telemetry', () => {
  it('emits one initial attempt and its successful connection latency', () => {
    let now = 1_000;
    const telemetry = createMatchConnectionTelemetry(() => now);

    expect(telemetry.transition(false)).toEqual([
      {
        name: 'F_Match_Connection_Attempt',
        data: { match_mode: 'online', connection_phase: 'initial', elapsed_s: 0 },
      },
    ]);
    expect(telemetry.transition(false)).toEqual([]);

    now = 2_500;
    expect(telemetry.transition(true)).toEqual([
      {
        name: 'F_Match_Connection_Success',
        data: { match_mode: 'online', connection_phase: 'initial', elapsed_s: 1.5 },
      },
    ]);
    expect(telemetry.transition(true)).toEqual([]);
  });

  it('provides a reconnect attempt denominator without duplicate transitions', () => {
    let now = 1_000;
    const telemetry = createMatchConnectionTelemetry(() => now);
    telemetry.transition(true);

    now = 4_000;
    expect(telemetry.transition(false)).toEqual([
      {
        name: 'F_Match_Connection_Attempt',
        data: { match_mode: 'online', connection_phase: 'reconnect', elapsed_s: 0 },
      },
    ]);
    expect(telemetry.transition(false)).toEqual([]);

    now = 5_250;
    expect(telemetry.transition(true)).toEqual([
      {
        name: 'F_Match_Connection_Success',
        data: { match_mode: 'online', connection_phase: 'reconnect', elapsed_s: 1.25 },
      },
    ]);
  });

  it('records an immediate initial success as one attempt and one success', () => {
    let now = 10_000;
    const telemetry = createMatchConnectionTelemetry(() => now);
    now = 10_125;

    expect(telemetry.transition(true)).toEqual([
      {
        name: 'F_Match_Connection_Attempt',
        data: { match_mode: 'online', connection_phase: 'initial', elapsed_s: 0 },
      },
      {
        name: 'F_Match_Connection_Success',
        data: { match_mode: 'online', connection_phase: 'initial', elapsed_s: 0.125 },
      },
    ]);
  });
});
