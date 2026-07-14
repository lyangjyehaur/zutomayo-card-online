import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type GatewayArtifact = {
  schemaVersion: number;
  artifactType: string;
  phase: string;
  sequence: number;
  activeReleaseSet: string;
  traffic: { stableWeightPercent: number; candidateWeightPercent: number };
  releaseSets: Record<'stable' | 'candidate', Record<'game' | 'api' | 'platform', string>>;
  candidateReleaseSha: string;
  gateway: {
    implementation: string;
    renderedConfigSha256: string;
    stableSlot: string;
    candidateSlot: string;
    listenerPort: number;
    activeConfigId: string;
    cohort: {
      cookieName: string;
      bucketCount: number;
      candidateBucketUpperExclusive: number;
      scope: string;
      slotPinCookieName: string;
      slotPinMaxAgeSeconds: number;
    };
  };
};

type RendererModule = {
  validateGatewayInput(value: unknown): Record<string, unknown>;
  parseGatewayReleaseManifest(contents: string, label?: string): Record<string, string>;
  gatewayInputFromReleaseManifests(value: Record<string, unknown>): Record<string, unknown>;
  gatewayInputFromBootstrapManifest(value: Record<string, unknown>): Record<string, unknown>;
  renderServer4Gateway(
    value: unknown,
    template: string,
  ): { config: string; artifact: GatewayArtifact; artifactJson: string };
};

const {
  gatewayInputFromReleaseManifests,
  gatewayInputFromBootstrapManifest,
  parseGatewayReleaseManifest,
  renderServer4Gateway,
  validateGatewayInput,
} = (await import('../render-server4-gateway.mjs')) as RendererModule;

const root = join(import.meta.dirname, '../..');
const template = readFileSync(join(root, 'ops/haproxy/server4.cfg.tmpl'), 'utf8');
const digest = (value: string) => value.repeat(64);

function validInput(weight = 10) {
  return {
    schemaVersion: 1,
    deploymentMode: 'canary',
    stableSlot: 'blue',
    candidateSlot: 'green',
    candidateWeightPercent: weight,
    candidateReleaseSha: 'a'.repeat(40),
    releaseSets: {
      stable: {
        game: `ghcr.io/example/game@sha256:${digest('1')}`,
        api: `ghcr.io/example/api@sha256:${digest('2')}`,
        platform: `ghcr.io/example/platform@sha256:${digest('3')}`,
      },
      candidate: {
        game: `ghcr.io/example/game@sha256:${digest('4')}`,
        api: `ghcr.io/example/api@sha256:${digest('5')}`,
        platform: `ghcr.io/example/platform@sha256:${digest('6')}`,
      },
    },
  };
}

function manifest(sha: string, imageDigit: string) {
  return [
    `RELEASE_SHA=${sha}`,
    'APP_VERSION=0.2.0',
    'GAME_RULES_VERSION=0.2.0',
    'EXPECTED_SCHEMA_MIGRATION=000023_account_deletion_saga',
    `EXPECTED_SCHEMA_CHECKSUM=${digest('f')}`,
    `GAME_IMAGE=ghcr.io/example/game@sha256:${digest(imageDigit)}`,
    `API_IMAGE=ghcr.io/example/api@sha256:${digest(imageDigit)}`,
    `PLATFORM_IMAGE=ghcr.io/example/platform@sha256:${digest(imageDigit)}`,
    `MIGRATE_IMAGE=ghcr.io/example/migrate@sha256:${digest(imageDigit)}`,
    `RETENTION_IMAGE=ghcr.io/example/retention@sha256:${digest(imageDigit)}`,
    `GATEWAY_IMAGE=ghcr.io/example/gateway@sha256:${digest(imageDigit)}`,
    `OPS_IMAGE=ghcr.io/example/ops@sha256:${digest(imageDigit)}`,
    '',
  ].join('\n');
}

function backendBlocks(config: string) {
  return config
    .split(/\n(?=backend )/)
    .filter((block) => block.startsWith('backend '))
    .map((block) => block.trim());
}

describe('server4 HAProxy gateway renderer', () => {
  it('derives canonical gateway input directly from two strict release manifests', () => {
    const stableManifest = manifest('b'.repeat(40), '1');
    const candidateManifest = manifest('a'.repeat(40), '2');
    expect(
      validateGatewayInput(
        gatewayInputFromReleaseManifests({
          stableManifest,
          candidateManifest,
          stableSlot: 'blue',
          candidateSlot: 'green',
          candidateWeightPercent: 10,
        }),
      ),
    ).toMatchObject({
      stableSlot: 'blue',
      candidateSlot: 'green',
      candidateReleaseSha: 'a'.repeat(40),
      cohortCookieName: 'zmc_aaaaaaaaaaaa',
      slotPinCookieName: 'zms_aaaaaaaaaaaa',
      slots: {
        blue: { gameAlias: 'game-blue', apiAlias: 'api-blue' },
        green: { gameAlias: 'game-green', apiAlias: 'api-green' },
      },
    });
    expect(() => parseGatewayReleaseManifest(`${stableManifest}RELEASE_SHA=${'c'.repeat(40)}\n`)).toThrow(
      'duplicate key RELEASE_SHA',
    );
    expect(() =>
      gatewayInputFromReleaseManifests({
        stableManifest,
        candidateManifest: stableManifest,
        stableSlot: 'blue',
        candidateSlot: 'green',
        candidateWeightPercent: 10,
      }),
    ).toThrow('different RELEASE_SHA');
  });

  it('accepts a verified legacy-six stable manifest but never a legacy candidate', () => {
    const stableManifest = manifest('b'.repeat(40), '1').replace(/^OPS_IMAGE=.*\n/m, '');
    const candidateManifest = manifest('a'.repeat(40), '2');

    expect(
      gatewayInputFromReleaseManifests({
        stableManifest,
        candidateManifest,
        stableSlot: 'blue',
        candidateSlot: 'green',
        candidateWeightPercent: 10,
      }),
    ).toMatchObject({ candidateReleaseSha: 'a'.repeat(40) });
    expect(() =>
      gatewayInputFromReleaseManifests({
        stableManifest: candidateManifest,
        candidateManifest: stableManifest,
        stableSlot: 'blue',
        candidateSlot: 'green',
        candidateWeightPercent: 10,
      }),
    ).toThrow(/OPS_IMAGE/);
    expect(() => gatewayInputFromBootstrapManifest({ manifest: stableManifest, stableSlot: 'blue' })).toThrow(
      /OPS_IMAGE/,
    );
  });

  it('renders a one-slot bootstrap gateway without pretending it is canary evidence', () => {
    const input = gatewayInputFromBootstrapManifest({
      manifest: manifest('a'.repeat(40), '1'),
      stableSlot: 'blue',
    });
    const rendered = renderServer4Gateway(input, template);
    expect(rendered.artifact).toMatchObject({
      artifactType: 'zutomayo-bootstrap-gateway-config',
      phase: 'bootstrap',
      sequence: 0,
      activeReleaseSet: 'stable',
      deploymentMode: 'bootstrap',
      traffic: { stableWeightPercent: 100, candidateWeightPercent: 0 },
    });
    expect(rendered.config).toContain('nbsrv(be_game_blue) ge 2');
    expect(rendered.config).not.toContain('nbsrv(be_game_green) ge 2');
    expect(rendered.config).toContain('string "bootstrap-aaaaaaaaaaaa-0-blue-green"');
  });
  it('renders direct process routes before same-slot cohort routing', () => {
    const { config } = renderServer4Gateway(validInput(), template);
    const directRoute = 'use_backend be_platform_blue_p1 if { var(txn.direct_platform) -m str blue_p1 }';
    const matchmakeRoute = 'use_backend be_platform_green if is_matchmake release_slot_candidate';

    expect(config.indexOf(directRoute)).toBeGreaterThan(-1);
    expect(config.indexOf(directRoute)).toBeLessThan(config.indexOf(matchmakeRoute));
    expect(config).toContain('http-request replace-path ^/_platform/blue/p1$ /');
    expect(config).toContain('http-request replace-path ^/_platform/blue/p1/(.*)$ /\\1');
    expect(config).toContain(matchmakeRoute);
    expect(config).toContain('use_backend be_platform_blue if is_matchmake');
    expect(config).toContain('use_backend be_game_green if release_slot_candidate');
    expect(config).toContain('default_backend be_game_blue');
  });

  it('uses a fixed 100-bucket cookie so rollout cohorts are nested', () => {
    for (const weight of [10, 50, 100]) {
      const { config } = renderServer4Gateway(validInput(weight), template);
      expect(config).toContain('http-request set-var(txn.cohort_bucket) rand(100) unless cohort_cookie_valid');
      expect(config).toContain(`acl candidate_cohort var(txn.cohort_bucket) -m int lt ${weight}`);
      expect(config).toContain('zmc_aaaaaaaaaaaa=%[var(txn.cohort_bucket)]');
      expect(config).toContain('zms_aaaaaaaaaaaa=%[var(txn.release_slot)]');
    }
  });

  it('pins existing sessions while weights expand and overrides candidate pins on rollback', () => {
    const rollout = renderServer4Gateway(validInput(50), template).config;
    expect(rollout).toContain(
      'http-request set-var(txn.release_slot) str(blue) if slot_pin_blue !release_slot_selected',
    );
    expect(rollout).toContain(
      'http-request set-var(txn.release_slot) str(green) if slot_pin_green !release_slot_selected',
    );
    expect(rollout).toContain(
      'http-request set-var(txn.release_slot) str(green) if candidate_cohort !release_slot_selected',
    );

    const rollback = renderServer4Gateway(validInput(0), template).config;
    expect(rollback).not.toContain('str(green) if slot_pin_green');
    expect(rollback).toContain('http-request set-var(txn.set_slot_pin) str(yes) unless slot_pin_blue');
    expect(rollback).toContain('nbsrv(be_game_blue) ge 2');
    expect(rollback).toContain('nbsrv(be_api_blue) ge 2');
    expect(rollback).toContain('nbsrv(be_platform_blue) ge 2');
    expect(rollback).not.toContain('nbsrv(be_game_green) ge 2');
    expect(rollback).not.toContain('nbsrv(be_api_green) ge 2');
    expect(rollback).not.toContain('nbsrv(be_platform_green) ge 2');
  });

  it('health-checks every backend through /ready without cross-slot backup servers', () => {
    const { config } = renderServer4Gateway(validInput(), template);
    const backends = backendBlocks(config);

    expect(backends).toHaveLength(10);
    for (const backend of backends) {
      expect(backend).toContain('option httpchk');
      expect(backend).toContain('uri /ready');
      expect(backend).toContain('http-check expect status 200');
      expect(backend).toContain('resolvers docker');
      expect(backend).not.toMatch(/\bbackup\b/);
    }
    expect(config).not.toMatch(/use_backend be_api_/);
    expect(config).toContain('backend be_api_blue');
    expect(config).toContain('backend be_api_green');
    expect(config).toContain('server-template game_blue 1-2 game-blue:3000');
    expect(config).toContain('server-template game_green 1-2 game-green:3000');
    expect(config).toContain('server-template api_blue 1-2 api-blue:3001');
    expect(config).toContain('server-template api_green 1-2 api-green:3001');
    expect(config).toContain('nbsrv(be_game_blue) ge 2');
    expect(config).toContain('nbsrv(be_api_green) ge 2');
    expect(config).toContain('nbsrv(be_platform_green) ge 2');
    expect(config).toContain('http-request return status 503 content-type text/plain string unavailable');
    expect(config).toContain('nameserver docker 127.0.0.11:53');
    expect(config).toContain('timeout tunnel 65m');
  });

  it('emits release-gate-compatible rollout and rollback artifacts bound to the rendered config', () => {
    const rollout = renderServer4Gateway(validInput(50), template);
    expect(rollout.artifact).toMatchObject({
      schemaVersion: 1,
      artifactType: 'zutomayo-canary-gateway-config',
      phase: 'rollout',
      sequence: 2,
      activeReleaseSet: 'mixed',
      traffic: { stableWeightPercent: 50, candidateWeightPercent: 50 },
      candidateReleaseSha: 'a'.repeat(40),
      gateway: {
        implementation: 'haproxy',
        stableSlot: 'blue',
        candidateSlot: 'green',
        listenerPort: 8080,
        activeConfigId: 'canary-aaaaaaaaaaaa-50-blue-green',
        cohort: {
          cookieName: 'zmc_aaaaaaaaaaaa',
          bucketCount: 100,
          candidateBucketUpperExclusive: 50,
          scope: 'unpinned-new-sessions',
          slotPinCookieName: 'zms_aaaaaaaaaaaa',
          slotPinMaxAgeSeconds: 7200,
        },
      },
    });
    expect(rollout.artifact.gateway.renderedConfigSha256).toBe(
      createHash('sha256').update(rollout.config).digest('hex'),
    );
    expect(JSON.parse(rollout.artifactJson)).toEqual(rollout.artifact);

    const rollback = renderServer4Gateway(validInput(0), template).artifact;
    expect(rollback).toMatchObject({
      phase: 'rollback',
      sequence: 4,
      activeReleaseSet: 'stable',
      traffic: { stableWeightPercent: 100, candidateWeightPercent: 0 },
    });
  });

  it('fails closed on invalid slots, weights, SHA, digests, or extra fields', () => {
    const mutations: Array<[string, (input: ReturnType<typeof validInput>) => void]> = [
      ['different', (input) => (input.candidateSlot = 'blue')],
      ['0, 10, 50, or 100', (input) => (input.candidateWeightPercent = 25)],
      ['40-character', (input) => (input.candidateReleaseSha = 'abc')],
      ['immutable image', (input) => (input.releaseSets.candidate.game = 'ghcr.io/example/game:latest')],
      ['same repository', (input) => (input.releaseSets.candidate.api = `ghcr.io/other/api@sha256:${digest('5')}`)],
      ['must be different', (input) => (input.releaseSets.candidate.platform = input.releaseSets.stable.platform)],
      ['must contain exactly', (input) => Object.assign(input, { unexpectedControl: true })],
    ];

    for (const [message, mutate] of mutations) {
      const input = validInput();
      mutate(input);
      expect(() => validateGatewayInput(input), message).toThrow(message);
    }
  });

  it('fails closed when the repository-owned template contract is incomplete or extended', () => {
    expect(() => renderServer4Gateway(validInput(), template.replace('{{BACKENDS}}', ''))).toThrow(
      'missing required placeholder {{BACKENDS}}',
    );
    expect(() => renderServer4Gateway(validInput(), `${template}\n{{UNTRUSTED}}\n`)).toThrow(
      'unknown placeholder {{UNTRUSTED}}',
    );
  });
});
