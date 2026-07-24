import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadCardsFromDatabase } from './cardSource';
import {
  evaluateCardDataset,
  type CardDatasetSnapshot,
  type CardTranslationSnapshot,
  type PresetDeckSnapshot,
} from './cardDatasetGate';
import { postgresConnectionString, postgresSslConfig } from '../src/runtimeSecurityConfig';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const IMAGE_NAMES = ['game', 'api', 'platform', 'migrate', 'retention'] as const;

function git(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function parseOutputPath(argv: string[]): string | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: npm run release:card-dataset -- [--output path/to/evidence.json]');
  }
  return path.resolve(process.cwd(), argv[1]);
}

function poolFromEnv(): Pool {
  const databaseUrl = postgresConnectionString(process.env);
  return new Pool({
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || process.env.PG_GAME_USER || process.env.PG_APP_USER || 'postgres',
          password: process.env.PG_PASSWORD || process.env.PG_GAME_PASSWORD || process.env.PG_APP_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
}

async function loadSnapshot(): Promise<CardDatasetSnapshot> {
  const [cards, databaseSnapshot] = await Promise.all([
    loadCardsFromDatabase(),
    (async () => {
      const pool = poolFromEnv();
      try {
        const [translationResult, presetResult, configResult] = await Promise.all([
          pool.query(
            `SELECT card_id AS "cardId", lang, name_text AS "nameText",
                    effect_text AS "effectText", review_status AS "reviewStatus"
             FROM card_texts_i18n ORDER BY card_id, lang`,
          ),
          pool.query('SELECT id, name, card_ids AS "cardIds" FROM preset_decks ORDER BY id'),
          pool.query('SELECT key, value FROM game_config ORDER BY key'),
        ]);
        return {
          translations: translationResult.rows as CardTranslationSnapshot[],
          presetDecks: presetResult.rows as PresetDeckSnapshot[],
          gameConfig: Object.fromEntries(configResult.rows.map((row) => [String(row.key), row.value])) as Record<
            string,
            unknown
          >,
        };
      } finally {
        await pool.end();
      }
    })(),
  ]);
  return { cards, ...databaseSnapshot };
}

function runGameSmoke(): { passed: boolean; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/game-smoke.ts'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { passed: result.status === 0, output: output.slice(-8_000) };
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const outputPath = parseOutputPath(process.argv.slice(2));
  const headSha = git(['rev-parse', 'HEAD']).toLowerCase();
  const releaseSha = (process.env.RELEASE_SHA || headSha).trim().toLowerCase();
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) throw new Error('RELEASE_SHA must be a full 40-character commit SHA');
  if (releaseSha !== headSha) throw new Error(`RELEASE_SHA ${releaseSha} does not match current HEAD ${headSha}`);
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('release card dataset gate requires a clean tracked working tree');
  }

  const expectedMigration = String(process.env.EXPECTED_SCHEMA_MIGRATION || '').trim();
  const expectedMigrationChecksum = String(process.env.EXPECTED_SCHEMA_CHECKSUM || '')
    .trim()
    .toLowerCase();
  if (!/^\d{6,}_[a-z0-9_]+$/.test(expectedMigration)) {
    throw new Error('EXPECTED_SCHEMA_MIGRATION is required');
  }
  if (!SHA256_PATTERN.test(expectedMigrationChecksum)) {
    throw new Error('EXPECTED_SCHEMA_CHECKSUM is required');
  }

  const pool = poolFromEnv();
  try {
    const migration = await pool.query(
      `SELECT migrations.name, checksums.sha256
       FROM schema_migrations AS migrations
       JOIN schema_migration_checksums AS checksums ON checksums.name = migrations.name
       WHERE migrations.name = $1 AND checksums.sha256 = $2`,
      [expectedMigration, expectedMigrationChecksum],
    );
    if (migration.rowCount !== 1) {
      throw new Error(`release database is not at ${expectedMigration} (${expectedMigrationChecksum})`);
    }
  } finally {
    await pool.end();
  }

  const snapshot = await loadSnapshot();
  const smoke = runGameSmoke();
  const expectedCardCount = Number(process.env.EXPECTED_CARD_COUNT || 422);
  if (!Number.isInteger(expectedCardCount) || expectedCardCount <= 0) {
    throw new Error('EXPECTED_CARD_COUNT must be a positive integer');
  }
  const expectedDatasetSha256 = process.env.EXPECTED_CARD_DATASET_SHA256?.trim().toLowerCase();
  if (expectedDatasetSha256 && !SHA256_PATTERN.test(expectedDatasetSha256)) {
    throw new Error('EXPECTED_CARD_DATASET_SHA256 must be a SHA-256 digest');
  }
  const gate = evaluateCardDataset(snapshot, {
    expectedCardCount,
    expectedDatasetSha256,
    gameSmokePassed: smoke.passed,
  });
  const finishedAt = new Date();
  let artifacts: Array<{ path: string; sha256: string }> = [];
  if (outputPath) {
    const evidenceDirectory = path.dirname(outputPath);
    const evidenceRoot =
      path.basename(evidenceDirectory) === 'staging' ? path.dirname(evidenceDirectory) : evidenceDirectory;
    const smokePath = path.join(evidenceDirectory, 'card-dataset-smoke.log');
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(smokePath, `${smoke.output}\n`, 'utf8');
    artifacts = [
      {
        path: path.relative(evidenceRoot, smokePath),
        sha256: createHash('sha256').update(`${smoke.output}\n`).digest('hex'),
      },
    ];
  }
  const imageDigests = Object.fromEntries(
    IMAGE_NAMES.map((name) => [name, process.env[`${name.toUpperCase()}_IMAGE`] || '']),
  );
  const runId = process.env.GITHUB_RUN_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const runUrl = runId && repository && serverUrl ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined;
  const checkedAt = finishedAt.toISOString();
  const evidence = {
    schemaVersion: 1,
    status: gate.failures.length === 0 ? 'passed' : 'failed',
    environment: process.env.RELEASE_ENVIRONMENT || 'local',
    evidenceType: 'card-dataset',
    releaseSha,
    imageDigests,
    migration: { name: expectedMigration, sha256: expectedMigrationChecksum },
    startedAt: startedAt.toISOString(),
    finishedAt: checkedAt,
    checkedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    datasetSha256: gate.datasetSha256,
    metrics: {
      cardCount: gate.metrics.cards,
      effectCardCount: gate.metrics.effectCards,
      effectLineCount: gate.metrics.effectLines,
      parsedEffectLineCount: gate.metrics.parsedEffectLines,
      ruleAuditFailures: gate.ruleAudit.unparsedLines + gate.ruleAudit.parsedButPartial + gate.ruleAudit.falseDraw,
      verifiedTranslationRows: gate.metrics.verifiedTranslationRows,
      presetDeckCount: gate.metrics.presetDecks,
    },
    thresholds: {
      minCardCount: expectedCardCount,
      maxCardCount: expectedCardCount,
      maxRuleAuditFailures: 0,
      minVerifiedTranslationRows: expectedCardCount * 4,
      minPresetDeckCount: 4,
    },
    results: {
      schemaMatched: true,
      datasetHashRecorded: SHA256_PATTERN.test(gate.datasetSha256),
      uniqueCardIds: gate.checks.uniqueCardIds,
      officialEnglishComplete: gate.checks.officialEnglishComplete,
      derivedTranslationsComplete: gate.checks.derivedTranslationsComplete,
      textIntegrity: gate.checks.textIntegrity,
      presetDecksValid: gate.checks.presetDecksValid,
      gameConfigValid: gate.checks.gameConfigValid,
      serializationRoundTrip: gate.checks.serializationRoundTrip,
      ruleAuditPassed: gate.checks.ruleAuditPassed,
      gameSmokePassed: gate.checks.gameSmokePassed,
    },
    artifacts,
    ...(runId && repository && runUrl ? { provenance: { runId, repository, runUrl }, source: runUrl } : {}),
    ruleAudit: gate.ruleAudit,
    failures: gate.failures,
    gameSmokeOutput: smoke.output,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (outputPath) {
    writeFileSync(outputPath, serialized, 'utf8');
    console.log(`release card dataset evidence: ${outputPath}`);
  } else {
    console.log(serialized.trimEnd());
  }
  if (gate.failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
