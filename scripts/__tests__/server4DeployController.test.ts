import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const controller = readFileSync(resolve(root, 'scripts/deploy-server4-canary.sh'), 'utf8');

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
});
