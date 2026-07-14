import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const controller = readFileSync(resolve(root, 'scripts/deploy-server4-canary.sh'), 'utf8');
const canaryVerifierPath = resolve(root, 'scripts/verify-server4-active-canary.sh');
const canaryVerifier = readFileSync(canaryVerifierPath, 'utf8');

describe('server4 parallel deployment controller contract', () => {
  it('serializes every canonical remote mutation and uses invocation-unique incoming files', () => {
    expect(controller.match(/flock -n 9/g)?.length).toBeGreaterThanOrEqual(6);
    expect(controller).toContain('REMOTE_LOCK_FILE="${REMOTE_DIR}.deploy.lock"');
    expect(controller).toContain('.release.$SLOT.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM.incoming.env');
    expect(controller).toContain('.haproxy.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM.incoming.cfg');
    expect(controller).not.toContain('$REMOTE_DIR/.haproxy.cfg.incoming');
    expect(controller).toContain(
      "install -m 0644 '$incoming/$RETENTION_COMPOSE_FILE' '$REMOTE_DIR/$RETENTION_COMPOSE_FILE'",
    );
  });

  it('binds staged and routed slots to the verified manifest, images, build ID, and health', () => {
    expect(controller).toContain('remote manifest does not match the supplied verified manifest');
    expect(controller).toContain("--format '{{.Config.Image}}'");
    expect(controller).toContain("sed -n 's/^APP_BUILD_ID=//p'");
    expect(controller).toContain('.slot.$SLOT.state.json');
    expect(controller).toContain('refusing to stage the bootstrap gateway active slot');
    expect(controller).toContain('refusing to overwrite a slot referenced by the active canary');
    expect(controller).toContain('gateway runtime marker does not match the canonical active-state artifact');
  });

  it('fails closed around worker ownership and cleans a newly started owner on failure', () => {
    const ownershipCheck = controller.indexOf('assert_no_other_worker_owner game-worker');
    const workerStart = controller.indexOf('worker_compose up -d --no-deps --wait');
    expect(ownershipCheck).toBeGreaterThan(-1);
    expect(workerStart).toBeGreaterThan(ownershipCheck);
    expect(controller).toContain('legacy game/API must be stopped before parallel workers start');
    expect(controller).toContain('cleanup_failed_start');
    expect(controller).toContain('worker_compose stop -t 45 game-worker api-worker');
    expect(controller).toContain('target worker start failed; restoring the previous owner');
  });

  it('never silently reloads a different gateway image and restores failed replacements', () => {
    expect(controller).toContain('gateway runtime image mismatch');
    expect(controller).toContain('rotate it in stable-only bootstrap mode');
    expect(controller).toContain('up -d --force-recreate --wait');
    expect(controller).toContain('gateway image replacement failed; restoring previous image and config');
    expect(controller).toContain('gateway runtime image mismatch after apply');
  });

  it('pins edge-network and retention ownership to repository-managed stable state', () => {
    expect(controller).toContain("append_env GATEWAY_EDGE_NETWORK '$EDGE_NETWORK'");
    expect(controller).toContain('GATEWAY_EDGE_NETWORK must remain $EDGE_NETWORK');
    expect(controller).toContain('docker pull \\"\\$expected_retention_image\\"');
    expect(controller).toContain('ownerMode:\\"stable-bootstrap\\"');
    expect(controller).toContain('.release.retention.env');
    expect(controller).toContain('activate-retention)');
    expect(controller).toContain('parallel-runtime.conf');
  });

  it('limits the six-image transition to stable and records seven-image candidate state', () => {
    expect(controller).toContain('validate_manifest "$STABLE_MANIFEST_FILE" true');
    expect(controller).toContain('validate_manifest "$CANDIDATE_MANIFEST_FILE" false');
    expect(controller).toContain('candidate manifest must use the current seven-image format');
    expect(controller).toContain('manifestFormat:"current-seven"');
    expect(controller).toContain('test \\"\\$manifest_format\\" = legacy-six');
    expect(controller).toContain('legacy slot \\$slot must not contain OPS_IMAGE');
    expect(controller).toContain('(.images | has(\\"ops\\") | not)');
  });

  it('gates every forward transition before reload and the 100% stage before worker transfer', () => {
    const transitionStart = controller.indexOf('10:50|50:100)');
    const forwardGate = controller.indexOf('scripts/verify-server4-active-canary.sh', transitionStart);
    const gatewayReload = controller.indexOf('docker kill --signal USR2', forwardGate);
    expect(transitionStart).toBeGreaterThan(-1);
    expect(forwardGate).toBeGreaterThan(transitionStart);
    expect(gatewayReload).toBeGreaterThan(forwardGate);

    const transferStart = controller.indexOf('transfer_workers()');
    const transferEnd = controller.indexOf('activate_retention()', transferStart);
    const transferBlock = controller.slice(transferStart, transferEnd);
    const transferGate = transferBlock.indexOf('scripts/verify-server4-active-canary.sh');
    const workerStop = transferBlock.indexOf('from_compose stop -t 45');
    expect(transferGate).toBeGreaterThan(-1);
    expect(transferBlock).toContain('--expected-weight 100');
    expect(transferBlock).toContain("--expected-stable-slot '$FROM_SLOT'");
    expect(transferBlock).toContain("--expected-candidate-slot '$TO_SLOT'");
    expect(transferBlock).toContain('--expected-weight 0');
    expect(transferBlock).toContain("--expected-stable-slot '$TO_SLOT'");
    expect(transferBlock).toContain("--expected-candidate-slot '$FROM_SLOT'");
    expect(transferBlock).toContain('worker transfer requires an active 100% rollout or 0% rollback');
    expect(workerStop).toBeGreaterThan(transferGate);
  });

  it('captures rollback evidence without blocking weight zero and binds observations to the active artifact', () => {
    const rollbackBranch = controller.indexOf('10:0|50:0|100:0)');
    const reload = controller.indexOf('docker kill --signal USR2', rollbackBranch);
    expect(rollbackBranch).toBeGreaterThan(-1);
    expect(controller.indexOf('--best-effort', rollbackBranch)).toBeLessThan(reload);
    expect(controller).toContain('rollback is proceeding without a complete pre-rollback observation');
    expect(controller).toContain('rollback_started_at=\\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)');
    expect(controller).toContain('$remote_prefix.rollback-started-at');
    expect(controller).toContain('$remote_prefix.rollback-finished-at');
    expect(controller).toContain('GATEWAY_OBSERVATION_STATE="gateway-observation.json"');
    expect(controller).toContain('gatewayConfigSha256:\\$gatewayConfigSha256');

    expect(canaryVerifier).toContain('.traffic.candidateWeightPercent == $expectedWeight');
    expect(canaryVerifier).toContain("expected_phase='rollback'");
    expect(canaryVerifier).toContain('if [[ "$EXPECTED_WEIGHT" == 0 ]]');
    expect(canaryVerifier).toContain('observation gateway artifact does not match active state');
    expect(canaryVerifier).toContain('--enforce-rollout-policy');
    expect(controller).toContain('date -u +%Y-%m-%dT%H:%M:%S.000Z');
    expect(canaryVerifier).toContain('date -u +%Y-%m-%dT%H:%M:%S.000Z');
    expect(canaryVerifier).toContain('if [[ "$BEST_EFFORT" == true ]]');
    expect(canaryVerifier).toContain('$evidence_prefix.pre-rollback.raw-metrics.json');
    expect(canaryVerifier).toContain('$evidence_prefix.pre-rollback.stats-end.csv');
  });

  it('runs the collector in a credential-free immutable migration image instead of requiring host Node', () => {
    expect(controller).not.toContain('command -v node >/dev/null');
    expect(canaryVerifier).toContain('MIGRATE_IMAGE must be an immutable @sha256 reference');
    expect(canaryVerifier).toContain('candidate release manifest is not bound to its verified slot state');
    expect(canaryVerifier).toContain('docker image inspect "$migrate_image"');
    expect(canaryVerifier).toContain('[[ "$image_user" == node ]]');
    expect(canaryVerifier).toContain('install -d -m 0700 -o 1000 -g 1000 "$runner_dir"');
    for (const hardening of [
      '--read-only',
      '--network none',
      '--cap-drop ALL',
      '--security-opt no-new-privileges:true',
      '--pids-limit 64',
      '--entrypoint node',
    ]) {
      expect(canaryVerifier).toContain(hardening);
    }
    expect(canaryVerifier).not.toContain('--env-file');
    expect(canaryVerifier).not.toContain('--user "$(id -u):$(id -g)"');
    expect(canaryVerifier).not.toMatch(/PG_(?:PASSWORD|USER|HOST|DATABASE)/);
  });

  it('accepts only the canonical weight-zero slot direction without requiring rollout observation state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'server4-active-rollback-'));
    const binDirectory = join(directory, 'bin');
    mkdirSync(binDirectory);
    writeFileSync(
      join(directory, 'gateway-active.json'),
      JSON.stringify({
        schemaVersion: 1,
        artifactType: 'zutomayo-canary-gateway-config',
        deploymentMode: 'canary',
        phase: 'rollback',
        sequence: 4,
        candidateReleaseSha: 'a'.repeat(40),
        traffic: { stableWeightPercent: 100, candidateWeightPercent: 0 },
        gateway: {
          activeConfigId: 'canary-aaaaaaaaaaaa-0-blue-green',
          stableSlot: 'blue',
          candidateSlot: 'green',
        },
      }),
    );
    const dockerPath = join(binDirectory, 'docker');
    writeFileSync(
      dockerPath,
      [
        '#!/bin/sh',
        'set -eu',
        'if [ "$1" = ps ]; then printf "%s\\n" gateway-id; exit 0; fi',
        'if [ "$1" = exec ]; then printf "%s\\n" canary-aaaaaaaaaaaa-0-blue-green; exit 0; fi',
        'exit 1',
        '',
      ].join('\n'),
    );
    chmodSync(dockerPath, 0o755);
    const run = (stableSlot: string, candidateSlot: string) =>
      spawnSync(
        'bash',
        [
          canaryVerifierPath,
          '--expected-weight',
          '0',
          '--expected-stable-slot',
          stableSlot,
          '--expected-candidate-slot',
          candidateSlot,
        ],
        {
          cwd: directory,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` },
        },
      );

    const valid = run('blue', 'green');
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain('active rollback state verified');
    expect(run('green', 'blue').status).toBe(1);
  });

  it('rejects a tag-only collector image before Docker can inspect or run it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'server4-collector-image-'));
    const binDirectory = join(directory, 'bin');
    const dockerCalls = join(directory, 'docker-calls.log');
    mkdirSync(binDirectory);
    writeFileSync(join(directory, 'gateway-observation.json'), '{}');
    writeFileSync(
      join(directory, 'gateway-active.json'),
      JSON.stringify({
        schemaVersion: 1,
        artifactType: 'zutomayo-canary-gateway-config',
        deploymentMode: 'canary',
        phase: 'rollout',
        sequence: 1,
        candidateReleaseSha: 'a'.repeat(40),
        traffic: { stableWeightPercent: 90, candidateWeightPercent: 10 },
        gateway: {
          activeConfigId: 'canary-aaaaaaaaaaaa-10-blue-green',
          stableSlot: 'blue',
          candidateSlot: 'green',
        },
      }),
    );
    const manifest = `RELEASE_SHA=${'a'.repeat(40)}\nMIGRATE_IMAGE=node:22-alpine\n`;
    writeFileSync(join(directory, '.release.green.env'), manifest);
    writeFileSync(
      join(directory, '.slot.green.state.json'),
      JSON.stringify({
        schemaVersion: 1,
        slot: 'green',
        releaseSha: 'a'.repeat(40),
        manifestSha256: createHash('sha256').update(manifest).digest('hex'),
      }),
    );
    const dockerPath = join(binDirectory, 'docker');
    writeFileSync(
      dockerPath,
      [
        '#!/bin/sh',
        'set -eu',
        'printf "%s\\n" "$*" >>"$DOCKER_CALLS"',
        'if [ "$1" = ps ]; then printf "%s\\n" gateway-id; exit 0; fi',
        'if [ "$1" = exec ]; then printf "%s\\n" canary-aaaaaaaaaaaa-10-blue-green; exit 0; fi',
        'exit 1',
        '',
      ].join('\n'),
    );
    chmodSync(dockerPath, 0o755);

    const result = spawnSync(
      'bash',
      [
        canaryVerifierPath,
        '--expected-weight',
        '10',
        '--expected-stable-slot',
        'blue',
        '--expected-candidate-slot',
        'green',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_CALLS: dockerCalls,
          PATH: `${binDirectory}:${process.env.PATH}`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATE_IMAGE must be an immutable @sha256 reference');
    expect(readFileSync(dockerCalls, 'utf8')).not.toContain('image inspect');
  });
});
