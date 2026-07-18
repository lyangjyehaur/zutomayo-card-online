import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleServer4CanaryEvidence } from '../assemble-server4-canary-evidence.mjs';
import { collectServer4CanaryMetrics, verifyServer4CanaryStage } from '../collect-server4-canary-metrics.mjs';
import { gatewayInputFromReleaseManifests, renderServer4Gateway } from '../render-server4-gateway.mjs';

type GateCheck = { id: string; status: string; reason: string };
type GateModule = {
  inspectStagingGates(
    stagingEvidenceDir: string,
    options: {
      releaseSha: string;
      imageDigests: Record<string, string>;
      evidenceRunId: string;
      nowMs: number;
    },
  ): GateCheck[];
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const { inspectStagingGates } = (await import('../release-gate.mjs')) as GateModule;

const CANDIDATE_SHA = 'a'.repeat(40);
const STABLE_SHA = 'b'.repeat(40);
const CHECKED_AT = '2026-07-13T00:00:00.000Z';
const SERVICES = ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'] as const;

function releaseImages(digests: string[]) {
  return Object.fromEntries(
    SERVICES.map((service, index) => [
      service,
      `ghcr.io/example/zutomayo-${service}@sha256:${digests[index].repeat(64)}`,
    ]),
  ) as Record<(typeof SERVICES)[number], string>;
}

function releaseManifest(releaseSha: string, images: ReturnType<typeof releaseImages>, includeOps = true) {
  const lines = [
    `RELEASE_SHA=${releaseSha}`,
    'APP_VERSION=1.2.3',
    'GAME_RULES_VERSION=1.2.3',
    'EXPECTED_SCHEMA_MIGRATION=202607120001_release_gate',
    `EXPECTED_SCHEMA_CHECKSUM=${'9'.repeat(64)}`,
    `GAME_IMAGE=${images.game}`,
    `API_IMAGE=${images.api}`,
    `PLATFORM_IMAGE=${images.platform}`,
    `MIGRATE_IMAGE=${images.migrate}`,
    `RETENTION_IMAGE=${images.retention}`,
    `GATEWAY_IMAGE=${images.gateway}`,
  ];
  if (includeOps) lines.push(`OPS_IMAGE=${images.ops}`);
  return [...lines, ''].join('\n');
}

function haproxyStats(slot: 'blue' | 'green', final: boolean) {
  const backendNames = [
    `be_game_${slot}`,
    `be_api_${slot}`,
    `be_platform_${slot}`,
    `be_platform_${slot}_p1`,
    `be_platform_${slot}_p2`,
  ];
  const totalSessions = final ? 200 : 0;
  const websocketUpgrades = final ? 20 : 0;
  return [
    '# pxname,svname,stot,hrsp_1xx,status',
    `zutomayo_gateway,FRONTEND,${final ? 1_000 : 0},${final ? 100 : 0},OPEN`,
    ...backendNames.map((backend) => `${backend},BACKEND,${totalSessions},${websocketUpgrades},UP`),
    ...['game', 'api', 'platform'].flatMap((service) => [
      `be_${service}_${slot},${service}-1,0,0,UP`,
      `be_${service}_${slot},${service}-2,0,0,UP`,
    ]),
    '',
  ].join('\n');
}

function fixture({ legacyStable = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'server4-canary-assembler-'));
  const evidenceDir = join(directory, 'server4-evidence');
  const outputDir = join(directory, 'release-artifacts');
  mkdirSync(evidenceDir);
  const stableImages = releaseImages(['1', '2', '3', '4', '5', '6', '7']);
  const candidateImages = releaseImages(['a', 'b', 'c', 'd', 'e', 'f', '0']);
  const stableManifest = join(directory, 'stable.env');
  const candidateManifest = join(directory, 'candidate.env');
  const stableManifestContents = releaseManifest(STABLE_SHA, stableImages, !legacyStable);
  const candidateManifestContents = releaseManifest(CANDIDATE_SHA, candidateImages);
  writeFileSync(stableManifest, stableManifestContents);
  writeFileSync(candidateManifest, candidateManifestContents);
  const stages = [
    {
      name: 'stage10Prefix',
      prefix: 'gateway-aaaaaaaaaaaa-10-20260712T233000Z-123-10',
      weight: 10,
      sequence: 1,
      phase: 'rollout',
      activeReleaseSet: 'mixed',
      startedAt: '2026-07-12T23:30:00.000Z',
      finishedAt: '2026-07-12T23:35:00.000Z',
    },
    {
      name: 'stage50Prefix',
      prefix: 'gateway-aaaaaaaaaaaa-50-20260712T233500Z-123-50',
      weight: 50,
      sequence: 2,
      phase: 'rollout',
      activeReleaseSet: 'mixed',
      startedAt: '2026-07-12T23:35:00.000Z',
      finishedAt: '2026-07-12T23:40:00.000Z',
    },
    {
      name: 'stage100Prefix',
      prefix: 'gateway-aaaaaaaaaaaa-100-20260712T234000Z-123-100',
      weight: 100,
      sequence: 3,
      phase: 'rollout',
      activeReleaseSet: 'candidate',
      startedAt: '2026-07-12T23:40:00.000Z',
      finishedAt: '2026-07-12T23:45:00.000Z',
    },
    {
      name: 'rollbackPrefix',
      prefix: 'gateway-aaaaaaaaaaaa-0-20260712T234500Z-123-0',
      weight: 0,
      sequence: 4,
      phase: 'rollback',
      activeReleaseSet: 'stable',
      switchStartedAt: '2026-07-12T23:45:00.000Z',
      switchFinishedAt: '2026-07-12T23:45:05.000Z',
      startedAt: '2026-07-12T23:45:10.000Z',
      finishedAt: '2026-07-12T23:50:10.000Z',
    },
  ] as const;
  const gatewayTemplate = readFileSync(join(process.cwd(), 'ops', 'haproxy', 'server4.cfg.tmpl'), 'utf8');
  for (const stage of stages) {
    const rendered = renderServer4Gateway(
      gatewayInputFromReleaseManifests({
        stableManifest: stableManifestContents,
        candidateManifest: candidateManifestContents,
        stableSlot: 'blue',
        candidateSlot: 'green',
        candidateWeightPercent: stage.weight,
      }),
      gatewayTemplate,
    );
    const gateway = rendered.artifact as { gateway: { activeConfigId: string } };
    const gatewayContents = rendered.artifactJson;
    writeFileSync(join(evidenceDir, `${stage.prefix}.json`), gatewayContents);
    const observedSlot = stage.phase === 'rollback' ? 'blue' : 'green';
    const collectorInput = {
      gatewayArtifact: gateway,
      activeConfigMarker: gateway.gateway.activeConfigId,
      startStatsCsv: haproxyStats(observedSlot, false),
      endStatsCsv: haproxyStats(observedSlot, true),
    };
    const metrics =
      stage.phase === 'rollout'
        ? verifyServer4CanaryStage({
            ...collectorInput,
            observationStartedAt: stage.startedAt,
            observationFinishedAt: stage.finishedAt,
          })
        : collectServer4CanaryMetrics({
            ...collectorInput,
            rollbackStartedAt: stage.switchStartedAt,
            rollbackFinishedAt: stage.switchFinishedAt,
            observationStartedAt: stage.startedAt,
            observationFinishedAt: stage.finishedAt,
          });
    writeFileSync(join(evidenceDir, `${stage.prefix}.raw-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
    writeFileSync(join(evidenceDir, stage.prefix + '.applied-at'), stage.startedAt + '\n');
    writeFileSync(join(evidenceDir, stage.prefix + '.finished-at'), stage.finishedAt + '\n');
    if (stage.phase === 'rollback') {
      writeFileSync(join(evidenceDir, stage.prefix + '.rollback-started-at'), stage.switchStartedAt + '\n');
      writeFileSync(join(evidenceDir, stage.prefix + '.rollback-finished-at'), stage.switchFinishedAt + '\n');
    }
  }
  const prefixes = Object.fromEntries(stages.map((stage) => [stage.name, stage.prefix])) as {
    stage10Prefix: string;
    stage50Prefix: string;
    stage100Prefix: string;
    rollbackPrefix: string;
  };
  return {
    evidenceDir,
    outputDir,
    stableManifest,
    candidateManifest,
    candidateImages,
    prefixes,
  };
}

function assemble(
  input: ReturnType<typeof fixture>,
  outputDir = input.outputDir,
  prefixOverrides: Partial<typeof input.prefixes> = {},
) {
  return assembleServer4CanaryEvidence({
    evidenceDir: input.evidenceDir,
    stableManifest: input.stableManifest,
    candidateManifest: input.candidateManifest,
    ...input.prefixes,
    ...prefixOverrides,
    outputDir,
    runId: '123',
    repository: 'example/repository',
    runUrl: 'https://github.com/example/repository/actions/runs/123',
    checkedAt: CHECKED_AT,
  });
}

function canaryGate(outputDir: string, imageDigests: Record<string, string>) {
  const check = inspectStagingGates(outputDir, {
    releaseSha: CANDIDATE_SHA,
    imageDigests,
    evidenceRunId: '123',
    nowMs: Date.parse(CHECKED_AT),
  }).find((candidate) => candidate.id === 'staging-canary');
  if (!check) throw new Error('staging canary gate was not returned');
  return check;
}

describe('server4 canary evidence assembler', () => {
  it('assembles controller artifacts into evidence accepted by the repository gate', () => {
    const input = fixture();
    const result = assemble(input);

    expect(result.outputPath).toBe(join(realpathSync(input.outputDir), 'staging', 'canary-rollback.json'));
    expect(canaryGate(input.outputDir, result.evidence.imageDigests).status).toBe('passed');
    expect(result.evidence.imageDigests).toEqual(input.candidateImages);
    expect(result.evidence.rollout).toMatchObject({ stableReleaseSha: STABLE_SHA });
    expect(result.evidence.artifacts).toHaveLength(20);

    const copiedGateway = join(input.outputDir, 'staging', 'canary', 'stage-50', 'gateway-config.json');
    writeFileSync(copiedGateway, `${readFileSync(copiedGateway, 'utf8')} `);
    const tampered = canaryGate(input.outputDir, result.evidence.imageDigests);
    expect(tampered.status).toBe('blocked');
    expect(tampered.reason).toContain('sha256 matching file contents');
  });

  it('assembles the legacy-six stable transition while keeping the candidate seven-image set', () => {
    const input = fixture({ legacyStable: true });
    const result = assemble(input);

    expect(canaryGate(input.outputDir, result.evidence.imageDigests).status).toBe('passed');
    expect(readFileSync(join(input.outputDir, 'staging', 'canary', 'stable-release.env'), 'utf8')).not.toContain(
      'OPS_IMAGE=',
    );
    expect(readFileSync(join(input.outputDir, 'staging', 'canary', 'candidate-release.env'), 'utf8')).toContain(
      'OPS_IMAGE=',
    );
  });

  it('fails closed when a selected controller artifact is missing', () => {
    const input = fixture();
    const outputDir = join(input.outputDir, 'missing');
    unlinkSync(join(input.evidenceDir, `${input.prefixes.stage100Prefix}.raw-metrics.json`));

    expect(() => assemble(input, outputDir)).toThrow(/100% rollout raw metrics is missing/);
    expect(existsSync(join(outputDir, 'staging', 'canary'))).toBe(false);
    expect(existsSync(join(outputDir, 'staging', 'canary-rollback.json'))).toBe(false);
  });

  it('rejects path traversal and symlinked controller artifacts', () => {
    const traversal = fixture();
    expect(() =>
      assemble(traversal, join(traversal.outputDir, 'traversal'), {
        stage10Prefix: `../${traversal.prefixes.stage10Prefix}`,
      }),
    ).toThrow(/prefix must be a basename/);

    const linked = fixture();
    const gatewayPath = join(linked.evidenceDir, `${linked.prefixes.stage10Prefix}.json`);
    const realGatewayPath = join(linked.evidenceDir, 'stage-10-real.json');
    writeFileSync(realGatewayPath, readFileSync(gatewayPath));
    unlinkSync(gatewayPath);
    symlinkSync(realGatewayPath, gatewayPath);
    expect(() => assemble(linked, join(linked.outputDir, 'symlink'))).toThrow(/regular non-symlink file/);
  });

  it('rejects rollback observations that start late or run beyond the repository policy window', () => {
    const updateRollbackObservation = (input: ReturnType<typeof fixture>, startedAt: string, finishedAt: string) => {
      const prefix = input.prefixes.rollbackPrefix;
      const metricsPath = join(input.evidenceDir, `${prefix}.raw-metrics.json`);
      const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as {
        observation: { startedAt: string; finishedAt: string; dwellSeconds: number };
      };
      metrics.observation = {
        startedAt,
        finishedAt,
        dwellSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000,
      };
      writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
      writeFileSync(join(input.evidenceDir, `${prefix}.applied-at`), `${startedAt}\n`);
      writeFileSync(join(input.evidenceDir, `${prefix}.finished-at`), `${finishedAt}\n`);
    };

    const delayed = fixture();
    updateRollbackObservation(delayed, '2026-07-12T23:46:06.000Z', '2026-07-12T23:51:06.000Z');
    expect(() => assemble(delayed)).toThrow(/observation must start within 60 seconds/);

    const tooLong = fixture();
    updateRollbackObservation(tooLong, '2026-07-12T23:45:10.000Z', '2026-07-12T23:55:11.000Z');
    expect(() => assemble(tooLong)).toThrow(/observation duration must be <= 600 seconds/);
  });

  it('rejects a concurrent process holding the output lock and succeeds after release', async () => {
    const input = fixture();
    mkdirSync(input.outputDir, { recursive: true });
    const lockPath = join(realpathSync(input.outputDir), '.canary-evidence.lock');
    const readyPath = join(input.outputDir, 'lock-ready');
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs');const lock=process.argv[1],ready=process.argv[2];fs.mkdirSync(lock,{mode:0o700});fs.writeFileSync(ready,'ready');const done=()=>{fs.rmSync(lock,{recursive:true,force:true});process.exit(0)};process.on('SIGTERM',done);setInterval(()=>{},1000);`,
        lockPath,
        readyPath,
      ],
      { stdio: 'ignore' },
    );
    const deadline = Date.now() + 5_000;
    while (!existsSync(readyPath) && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    expect(existsSync(readyPath)).toBe(true);
    expect(() => assemble(input)).toThrow(/another canary evidence assembler owns/);
    child.kill('SIGTERM');
    await new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
    expect(() => assemble(input)).not.toThrow();
  });
});
