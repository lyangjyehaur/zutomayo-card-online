import { describe, expect, it } from 'vitest';
import { evaluateAlertDelivery, evaluateRestore, evaluateRestoreAndDeployment } from '../operationalRecoveryGate';

const releaseSha = 'a'.repeat(40);
const thresholds = {
  maxRpoMinutes: 15,
  maxRtoMinutes: 30,
  maxDeploymentRecoverySeconds: 1_800,
  maxAlertDeliverySeconds: 300,
};

function restoreReport() {
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    releaseSha,
    backup: {
      artifact: 's3://bucket/backup.dump.age',
      sha256: 'b'.repeat(64),
      completedAt: '2026-07-19T01:00:00.000Z',
    },
    incidentAt: '2026-07-19T01:10:00.000Z',
    restore: {
      startedAt: '2026-07-19T01:11:00.000Z',
      finishedAt: '2026-07-19T01:29:00.000Z',
      imageDigest: `postgres@sha256:${'c'.repeat(64)}`,
    },
    fixtures: { account: true, deck: true, matchHistory: true, leaderboard: true },
    checks: { schemaGatePassed: true, legalHoldInvariantPassed: true },
  };
}

function deploymentReport() {
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    releaseSha,
    targetSha: releaseSha,
    startedAt: '2026-07-19T02:00:00.000Z',
    finishedAt: '2026-07-19T02:12:00.000Z',
    checks: { sourceCheckoutVerified: true, schemaCompatible: true, healthReady: true, smokePassed: true },
  };
}

function alertReceipt() {
  const scenarios = [
    'api-failure',
    'platform-failure',
    'reconnect-spike',
    'database-outage',
    'resource-pressure',
    'outbox-backlog',
  ];
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    releaseSha,
    alertmanagerUrl: 'https://alerts.example.test',
    scenarios: scenarios.map((scenario, index) => ({
      scenario,
      firingInjectedAt: `2026-07-19T03:0${index}:00.000Z`,
      firingReceivedAt: `2026-07-19T03:0${index}:20.000Z`,
      resolvedInjectedAt: `2026-07-19T03:0${index}:30.000Z`,
      resolvedReceivedAt: `2026-07-19T03:0${index}:45.000Z`,
      recipient: 'beta-on-call',
      receiptUrl: `https://chat.example.test/receipts/${scenario}`,
    })),
  };
}

describe('operational recovery evidence gate', () => {
  it('accepts a restore-only Beta proof without deployment or alert inputs', () => {
    expect(evaluateRestore(restoreReport(), releaseSha, thresholds)).toEqual({
      metrics: { rpoMinutes: 10, rtoMinutes: 18 },
      results: { schemaGatePassed: true, fixtureRoundTripPassed: true, legalHoldInvariantPassed: true },
      passed: true,
    });
  });

  it('calculates RPO/RTO and deployment recovery from attributable reports', () => {
    expect(evaluateRestoreAndDeployment(restoreReport(), deploymentReport(), releaseSha, thresholds)).toEqual({
      metrics: { rpoMinutes: 10, rtoMinutes: 18, deploymentRecoverySeconds: 720 },
      results: {
        schemaGatePassed: true,
        fixtureRoundTripPassed: true,
        legalHoldInvariantPassed: true,
        deploymentRecoveryPassed: true,
      },
      passed: true,
    });
  });

  it('fails closed when a restored player-visible fixture or recovery check is absent', () => {
    const restore = restoreReport();
    restore.fixtures.leaderboard = false;
    expect(() => evaluateRestoreAndDeployment(restore, deploymentReport(), releaseSha, thresholds)).toThrow(
      'account, deck, matchHistory, and leaderboard',
    );
    const deployment = deploymentReport();
    deployment.checks.smokePassed = false;
    expect(() => evaluateRestoreAndDeployment(restoreReport(), deployment, releaseSha, thresholds)).toThrow(
      'did not all pass',
    );
  });

  it('requires all six alert scenarios with firing and resolved receipts', () => {
    const evaluated = evaluateAlertDelivery(alertReceipt(), releaseSha, thresholds);
    expect(evaluated.passed).toBe(true);
    expect(evaluated.metrics).toEqual({
      firingDeliverySeconds: 20,
      resolvedDeliverySeconds: 15,
      scenariosDelivered: 6,
      failedScenarios: 0,
    });
    const incomplete = alertReceipt();
    incomplete.scenarios.pop();
    expect(() => evaluateAlertDelivery(incomplete, releaseSha, thresholds)).toThrow(
      'missing alert delivery scenario: outbox-backlog',
    );
  });
});
