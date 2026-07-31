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
    fixtures: {
      account: true,
      deck: true,
      matchHistory: true,
      leaderboard: true,
      chatMessage: true,
      feedbackPost: true,
      boardgameMatch: true,
    },
    checks: {
      schemaGatePassed: true,
      legalHoldInvariantPassed: true,
      boardgameStateInvariantPassed: true,
    },
  };
}

function deploymentReport() {
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    recoveryMode: 'exact-release-reconstruction',
    releaseSha,
    targetSha: releaseSha,
    datasetSha256: 'd'.repeat(64),
    startedAt: '2026-07-19T02:00:00.000Z',
    finishedAt: '2026-07-19T02:12:00.000Z',
    backup: { artifact: '/opt/staging/backups/zutomayo.dump', sha256: 'e'.repeat(64) },
    schema: { migration: '000047_knowledge_search_zero_results', sha256: 'f'.repeat(64) },
    impact: {
      activeMatchesAtStop: 2,
      completedMatches: 0,
      reconnectedMatches: 2,
      failedMatches: 0,
      manualInterventions: 0,
      receiptUrl: 'https://evidence.example.test/recovery/matches',
    },
    artifacts: [
      { path: '/evidence/recovery.log', sha256: '1'.repeat(64) },
      { path: '/evidence/smoke.json', sha256: '2'.repeat(64) },
      { path: '/evidence/match-impact.json', sha256: '3'.repeat(64) },
    ],
    checks: {
      servicesStopped: true,
      deployCommandPassed: true,
      preDeployBackupVerified: true,
      sourceCheckoutVerified: true,
      datasetIdentityVerified: true,
      schemaCompatible: true,
      healthReady: true,
      buildIdentityVerified: true,
      battleAssetsVerified: true,
      websocketOutcomeVerified: true,
      smokePassed: true,
    },
  };
}

function alertReceipt() {
  const scenarios = [
    ['api-failure', 'ServiceDown'],
    ['platform-failure', 'PlatformHealthProbeFailed'],
    ['reconnect-spike', 'PlatformReconnectSpike'],
    ['database-outage', 'PostgresExporterDown'],
    ['resource-pressure', 'HighEventLoopLag'],
    ['outbox-backlog', 'MatchResultOutboxOldestRow'],
  ];
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    releaseSha,
    alertmanagerUrl: 'https://alerts.example.test',
    scenarios: scenarios.map(([scenario, alertName], index) => ({
      scenario,
      alertName,
      injection: `controlled-${scenario}`,
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
      results: {
        schemaGatePassed: true,
        fixtureRoundTripPassed: true,
        legalHoldInvariantPassed: true,
        boardgameStateInvariantPassed: true,
      },
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
        boardgameStateInvariantPassed: true,
        deploymentRecoveryPassed: true,
      },
      passed: true,
    });
  });

  it('fails closed when a restored player-visible fixture or recovery check is absent', () => {
    const restore = restoreReport();
    restore.fixtures.leaderboard = false;
    expect(() => evaluateRestoreAndDeployment(restore, deploymentReport(), releaseSha, thresholds)).toThrow(
      'account, deck, matchHistory, leaderboard, chatMessage, feedbackPost, and boardgameMatch',
    );
    const missingChat = restoreReport();
    missingChat.fixtures.chatMessage = false;
    expect(() => evaluateRestore(missingChat, releaseSha, thresholds)).toThrow('chatMessage');
    const invalidBoardgameState = restoreReport();
    invalidBoardgameState.checks.boardgameStateInvariantPassed = false;
    expect(() => evaluateRestore(invalidBoardgameState, releaseSha, thresholds)).toThrow('boardgame-state invariant');
    const deployment = deploymentReport();
    deployment.checks.smokePassed = false;
    expect(() => evaluateRestoreAndDeployment(restoreReport(), deployment, releaseSha, thresholds)).toThrow(
      'did not all pass',
    );
    const missingDataset = deploymentReport();
    missingDataset.datasetSha256 = '';
    expect(() => evaluateRestoreAndDeployment(restoreReport(), missingDataset, releaseSha, thresholds)).toThrow(
      'datasetSha256',
    );
    const unaccountedMatch = deploymentReport();
    unaccountedMatch.impact.reconnectedMatches = 1;
    expect(() => evaluateRestoreAndDeployment(restoreReport(), unaccountedMatch, releaseSha, thresholds)).toThrow(
      'account for every active match',
    );
    const missingArtifact = deploymentReport();
    missingArtifact.artifacts.pop();
    expect(() => evaluateRestoreAndDeployment(restoreReport(), missingArtifact, releaseSha, thresholds)).toThrow(
      'log, smoke, and match-impact receipts',
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
    expect(() => evaluateAlertDelivery(incomplete, releaseSha, thresholds)).toThrow('must contain exactly 6 entries');
    const duplicate = alertReceipt();
    duplicate.scenarios[5].scenario = 'api-failure';
    expect(() => evaluateAlertDelivery(duplicate, releaseSha, thresholds)).toThrow(
      'duplicate alert delivery scenario: api-failure',
    );
    const wrongRule = alertReceipt();
    wrongRule.scenarios[2].alertName = 'ServiceDown';
    expect(() => evaluateAlertDelivery(wrongRule, releaseSha, thresholds)).toThrow(
      'reconnect-spike.alertName must identify an approved alert rule',
    );
  });
});
