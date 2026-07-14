import { describe, expect, it } from 'vitest';
import { collectServer4CanaryMetrics } from '../collect-server4-canary-metrics.mjs';

const header = '# pxname,svname,stot,status,hrsp_1xx,';

function stats(total: number, websocket: number, slot = 'green', frontendTotal = total, frontendWebsocket = websocket) {
  const rows = [`zutomayo_gateway,FRONTEND,${frontendTotal},OPEN,${frontendWebsocket},`];
  for (const backend of ['game', 'api', 'platform']) {
    rows.push(`be_${backend}_${slot},${backend}_1,10,UP,0,`, `be_${backend}_${slot},${backend}_2,10,UP,0,`);
  }
  rows.push(
    `be_game_${slot},BACKEND,${total},UP,${websocket},`,
    `be_api_${slot},BACKEND,0,UP,0,`,
    `be_platform_${slot},BACKEND,0,UP,0,`,
    `be_platform_${slot}_p1,BACKEND,0,UP,0,`,
    `be_platform_${slot}_p2,BACKEND,0,UP,0,`,
  );
  return `${header}\n${rows.join('\n')}\n`;
}

function gatewayArtifact(phase: 'rollout' | 'rollback' = 'rollout') {
  return {
    schemaVersion: 1,
    artifactType: 'zutomayo-canary-gateway-config',
    phase,
    sequence: phase === 'rollback' ? 4 : 1,
    traffic:
      phase === 'rollback'
        ? { stableWeightPercent: 100, candidateWeightPercent: 0 }
        : { stableWeightPercent: 90, candidateWeightPercent: 10 },
    gateway: {
      activeConfigId: `canary-aaaaaaaaaaaa-${phase === 'rollback' ? 0 : 10}-blue-green`,
      stableSlot: 'blue',
      candidateSlot: 'green',
    },
  };
}

describe('server4 raw canary metrics collector', () => {
  it('uses only candidate backend deltas rather than stable/frontend traffic', () => {
    expect(
      collectServer4CanaryMetrics({
        gatewayArtifact: gatewayArtifact(),
        activeConfigMarker: 'canary-aaaaaaaaaaaa-10-blue-green\n',
        startStatsCsv: stats(100, 10, 'green', 10_000, 1_000),
        endStatsCsv: stats(1_150, 125, 'green', 50_000, 5_000),
      }),
    ).toMatchObject({
      artifactType: 'zutomayo-canary-raw-metrics',
      phase: 'rollout',
      sequence: 1,
      stableWeightPercent: 90,
      candidateWeightPercent: 10,
      httpSamples: 1_050,
      websocketSamples: 115,
      readyReplicaCount: 2,
    });
  });

  it('uses stable backend deltas and computes the measured rollback duration', () => {
    expect(
      collectServer4CanaryMetrics({
        gatewayArtifact: gatewayArtifact('rollback'),
        activeConfigMarker: 'canary-aaaaaaaaaaaa-0-blue-green',
        startStatsCsv: stats(200, 20, 'blue', 20_000, 2_000),
        endStatsCsv: stats(1_250, 135, 'blue', 60_000, 6_000),
        rollbackStartedAt: '2026-07-14T01:00:00.000Z',
        rollbackFinishedAt: '2026-07-14T01:04:00.000Z',
      }),
    ).toMatchObject({
      phase: 'rollback',
      sequence: 4,
      stableWeightPercent: 100,
      candidateWeightPercent: 0,
      httpSamples: 1_050,
      websocketSamples: 115,
      readyReplicaCount: 2,
      rollbackSeconds: 240,
      source: { observedSlot: 'blue' },
    });
  });

  it('requires a complete, increasing rollback interval only for rollback artifacts', () => {
    const input = {
      gatewayArtifact: gatewayArtifact('rollback'),
      activeConfigMarker: 'canary-aaaaaaaaaaaa-0-blue-green',
      startStatsCsv: stats(100, 10, 'blue'),
      endStatsCsv: stats(200, 20, 'blue'),
    };
    expect(() => collectServer4CanaryMetrics(input)).toThrow('rollbackStartedAt and rollbackFinishedAt');
    expect(() =>
      collectServer4CanaryMetrics({
        ...input,
        rollbackStartedAt: '2026-07-14T01:05:00.000Z',
        rollbackFinishedAt: '2026-07-14T01:04:00.000Z',
      }),
    ).toThrow('after rollbackStartedAt');
  });

  it('fails if a reload resets counters or the active marker does not match', () => {
    expect(() =>
      collectServer4CanaryMetrics({
        gatewayArtifact: gatewayArtifact(),
        activeConfigMarker: 'wrong-config',
        startStatsCsv: stats(100, 10),
        endStatsCsv: stats(200, 20),
      }),
    ).toThrow('active config marker');
    expect(() =>
      collectServer4CanaryMetrics({
        gatewayArtifact: gatewayArtifact(),
        activeConfigMarker: 'canary-aaaaaaaaaaaa-10-blue-green',
        startStatsCsv: stats(200, 20),
        endStatsCsv: stats(100, 10),
      }),
    ).toThrow('counters moved backwards');
  });
});
