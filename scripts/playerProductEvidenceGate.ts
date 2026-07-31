import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const DATASET_SHA_PATTERN = /^[a-f0-9]{64}$/i;
const OBSERVATION_ID_PATTERN = /^obs-[a-z0-9-]{3,40}$/;
const ISSUE_ID_PATTERN = /^PP-\d{3}$/;
const MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const REQUIRED_PLAYER_JOURNEYS = [
  'homeToFirstMatch',
  'queueToMatch',
  'matchCompletion',
  'reconnect',
  'tutorialCompletion',
  'returningPlayers',
] as const;

type PlayerJourney = (typeof REQUIRED_PLAYER_JOURNEYS)[number];

interface JourneyMeasurement {
  population?: unknown;
  outcomes?: unknown;
  medianSeconds?: unknown;
  p95Seconds?: unknown;
  receiptUrl?: unknown;
}

interface PlayerObservation {
  id?: unknown;
  observedAt?: unknown;
  participantType?: unknown;
  viewportClass?: unknown;
  taskResults?: unknown;
  problemIds?: unknown;
  receiptUrl?: unknown;
}

interface ProductIssue {
  id?: unknown;
  category?: unknown;
  summary?: unknown;
  impact?: unknown;
  frequency?: unknown;
}

interface PlayerProductEvidenceReport {
  schemaVersion?: unknown;
  status?: unknown;
  releaseSha?: unknown;
  buildId?: unknown;
  datasetSha256?: unknown;
  window?: { startedAt?: unknown; finishedAt?: unknown };
  journeys?: unknown;
  observationMethod?: unknown;
  observations?: unknown;
  issues?: unknown;
}

export interface PlayerProductEvidenceSummary {
  passed: true;
  releaseSha: string;
  datasetSha256: string;
  windowDays: number;
  journeyRates: Record<PlayerJourney, number | null>;
  observationCount: number;
  rankedIssues: Array<{ id: string; priority: number }>;
}

function exactIsoTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`${label} must be an exact ISO timestamp`);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO timestamp`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function nullableDuration(value: unknown, label: string, hasPopulation: boolean): number | null {
  if (!hasPopulation) {
    if (value !== null) throw new Error(`${label} must be null when population is zero`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number when population is non-zero`);
  }
  return value;
}

function httpsUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an HTTPS URL`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error(`${label} must be an HTTPS URL`);
  return value;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.join(', ')}`);
}

function safeIssueSummary(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || value.includes('\n')) {
    throw new Error(`${label} must be a single-line product problem of 160 characters or fewer`);
  }
  if (/@|https?:\/\/|\b(?:email|nickname|user_?id|match_?id|room_?id|invite_?id|deck_?id)\b/i.test(value)) {
    throw new Error(`${label} appears to contain raw identifiers, contact data, or content`);
  }
  return value.trim();
}

function evaluateJourneys(value: unknown): Record<PlayerJourney, number | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('journeys must be an object');
  const journeys = value as Record<string, JourneyMeasurement>;
  assertAllowedKeys(journeys as Record<string, unknown>, REQUIRED_PLAYER_JOURNEYS, 'journeys');
  const rates = {} as Record<PlayerJourney, number | null>;

  for (const name of REQUIRED_PLAYER_JOURNEYS) {
    const measurement = journeys[name];
    if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement)) {
      throw new Error(`journeys.${name} is required`);
    }
    assertAllowedKeys(
      measurement as Record<string, unknown>,
      ['population', 'outcomes', 'medianSeconds', 'p95Seconds', 'receiptUrl'],
      `journeys.${name}`,
    );
    const population = nonNegativeInteger(measurement.population, `journeys.${name}.population`);
    const outcomes = nonNegativeInteger(measurement.outcomes, `journeys.${name}.outcomes`);
    if (outcomes > population) throw new Error(`journeys.${name}.outcomes must not exceed population`);
    const median = nullableDuration(measurement.medianSeconds, `journeys.${name}.medianSeconds`, population > 0);
    const p95 = nullableDuration(measurement.p95Seconds, `journeys.${name}.p95Seconds`, population > 0);
    if (median !== null && p95 !== null && p95 < median) {
      throw new Error(`journeys.${name}.p95Seconds must be greater than or equal to medianSeconds`);
    }
    httpsUrl(measurement.receiptUrl, `journeys.${name}.receiptUrl`);
    rates[name] = population === 0 ? null : outcomes / population;
  }
  return rates;
}

function evaluateObservations(value: unknown, startedAt: number, finishedAt: number): Map<string, Set<string>> {
  if (!Array.isArray(value) || value.length < 5) throw new Error('at least five player observations are required');
  const issuesByObservation = new Map<string, Set<string>>();
  const observedTasks = new Set<string>();

  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error(`observations[${index}] must be an object`);
    const observation = raw as PlayerObservation & Record<string, unknown>;
    assertAllowedKeys(
      observation,
      ['id', 'observedAt', 'participantType', 'viewportClass', 'taskResults', 'problemIds', 'receiptUrl'],
      `observations[${index}]`,
    );
    if (typeof observation.id !== 'string' || !OBSERVATION_ID_PATTERN.test(observation.id)) {
      throw new Error(`observations[${index}].id must be a de-identified obs-* code`);
    }
    if (issuesByObservation.has(observation.id)) throw new Error(`duplicate observation id ${observation.id}`);
    const observedAt = exactIsoTimestamp(observation.observedAt, `observations[${index}].observedAt`);
    if (observedAt < startedAt || observedAt > finishedAt) {
      throw new Error(`observations[${index}].observedAt must fall within the evidence window`);
    }
    if (!['first-time', 'returning', 'representative'].includes(String(observation.participantType))) {
      throw new Error(`observations[${index}].participantType is invalid`);
    }
    if (!['mobile', 'tablet', 'desktop'].includes(String(observation.viewportClass))) {
      throw new Error(`observations[${index}].viewportClass is invalid`);
    }
    if (
      !observation.taskResults ||
      typeof observation.taskResults !== 'object' ||
      Array.isArray(observation.taskResults)
    ) {
      throw new Error(`observations[${index}].taskResults must be an object`);
    }
    const taskResults = observation.taskResults as Record<string, unknown>;
    assertAllowedKeys(taskResults, ['tutorial', 'queue', 'match', 'reconnect'], `observations[${index}].taskResults`);
    for (const [task, result] of Object.entries(taskResults)) {
      if (!['completed', 'blocked', 'not-observed'].includes(String(result))) {
        throw new Error(`observations[${index}].taskResults.${task} is invalid`);
      }
      if (result !== 'not-observed') observedTasks.add(task);
    }
    if (
      !Array.isArray(observation.problemIds) ||
      observation.problemIds.some((id) => !ISSUE_ID_PATTERN.test(String(id)))
    ) {
      throw new Error(`observations[${index}].problemIds must contain only PP-NNN issue IDs`);
    }
    httpsUrl(observation.receiptUrl, `observations[${index}].receiptUrl`);
    issuesByObservation.set(observation.id, new Set(observation.problemIds as string[]));
  }

  for (const task of ['tutorial', 'queue', 'match', 'reconnect']) {
    if (!observedTasks.has(task)) throw new Error(`at least one observation must exercise the ${task} task`);
  }
  return issuesByObservation;
}

function evaluateIssues(value: unknown, issuesByObservation: Map<string, Set<string>>) {
  if (!Array.isArray(value)) throw new Error('issues must be an array');
  const seenIds = new Set<string>();
  const ranked: Array<{ id: string; priority: number }> = [];

  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`issues[${index}] must be an object`);
    const issue = raw as ProductIssue & Record<string, unknown>;
    assertAllowedKeys(issue, ['id', 'category', 'summary', 'impact', 'frequency'], `issues[${index}]`);
    if (typeof issue.id !== 'string' || !ISSUE_ID_PATTERN.test(issue.id))
      throw new Error(`issues[${index}].id is invalid`);
    if (seenIds.has(issue.id)) throw new Error(`duplicate issue id ${issue.id}`);
    seenIds.add(issue.id);
    if (
      ![
        'onboarding',
        'matchmaking',
        'gameplay',
        'reconnect',
        'tutorial',
        'accessibility',
        'performance',
        'trust',
        'other',
      ].includes(String(issue.category))
    ) {
      throw new Error(`issues[${index}].category is invalid`);
    }
    safeIssueSummary(issue.summary, `issues[${index}].summary`);
    const impact = nonNegativeInteger(issue.impact, `issues[${index}].impact`);
    if (impact < 1 || impact > 5) throw new Error(`issues[${index}].impact must be between 1 and 5`);
    const frequency = nonNegativeInteger(issue.frequency, `issues[${index}].frequency`);
    const observedFrequency = [...issuesByObservation.values()].filter((ids) => ids.has(issue.id as string)).length;
    if (frequency !== observedFrequency || frequency === 0) {
      throw new Error(`issues[${index}].frequency must match the observations that reference ${issue.id}`);
    }
    ranked.push({ id: issue.id, priority: impact * frequency });
  }

  for (const problemIds of issuesByObservation.values()) {
    for (const issueId of problemIds) {
      if (!seenIds.has(issueId)) throw new Error(`observation references undefined issue ${issueId}`);
    }
  }
  for (let index = 1; index < ranked.length; index += 1) {
    if (ranked[index].priority > ranked[index - 1].priority) {
      throw new Error('issues must be ordered by descending impact multiplied by frequency');
    }
  }
  return ranked;
}

export function evaluatePlayerProductEvidence(
  report: PlayerProductEvidenceReport,
  expected: { releaseSha: string; datasetSha256: string },
): PlayerProductEvidenceSummary {
  assertAllowedKeys(
    report as unknown as Record<string, unknown>,
    [
      'schemaVersion',
      'status',
      'releaseSha',
      'buildId',
      'datasetSha256',
      'window',
      'journeys',
      'observationMethod',
      'observations',
      'issues',
    ],
    'report',
  );
  if (!RELEASE_SHA_PATTERN.test(expected.releaseSha)) throw new Error('expected release SHA is invalid');
  if (!DATASET_SHA_PATTERN.test(expected.datasetSha256)) throw new Error('expected dataset SHA-256 is invalid');
  if (report.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (report.status !== 'complete') throw new Error('status must be complete');
  if (report.releaseSha !== expected.releaseSha || report.buildId !== expected.releaseSha) {
    throw new Error('releaseSha and buildId must match the expected release SHA');
  }
  if (report.datasetSha256 !== expected.datasetSha256) throw new Error('datasetSha256 must match the expected dataset');
  if (!report.window || typeof report.window !== 'object' || Array.isArray(report.window)) {
    throw new Error('window must be an object');
  }
  assertAllowedKeys(report.window as Record<string, unknown>, ['startedAt', 'finishedAt'], 'window');
  const startedAt = exactIsoTimestamp(report.window?.startedAt, 'window.startedAt');
  const finishedAt = exactIsoTimestamp(report.window?.finishedAt, 'window.finishedAt');
  if (finishedAt - startedAt < MIN_WINDOW_MS) throw new Error('evidence window must cover at least seven days');
  if (!['moderated-sessions', 'structured-feedback'].includes(String(report.observationMethod))) {
    throw new Error('observationMethod must be moderated-sessions or structured-feedback');
  }
  const journeyRates = evaluateJourneys(report.journeys);
  const issuesByObservation = evaluateObservations(report.observations, startedAt, finishedAt);
  const rankedIssues = evaluateIssues(report.issues, issuesByObservation);
  return {
    passed: true,
    releaseSha: expected.releaseSha,
    datasetSha256: expected.datasetSha256,
    windowDays: (finishedAt - startedAt) / (24 * 60 * 60 * 1000),
    journeyRates,
    observationCount: issuesByObservation.size,
    rankedIssues,
  };
}

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('player-product evidence arguments must be key/value pairs');
    values.set(key, value);
  }
  const input = values.get('--input');
  const releaseSha = values.get('--release-sha');
  const datasetSha256 = values.get('--dataset-sha256');
  const output = values.get('--output');
  if (!input || !releaseSha || !datasetSha256) {
    throw new Error(
      'usage: npm run evidence:player-product -- --input <json> --release-sha <sha> --dataset-sha256 <sha256> [--output <json>]',
    );
  }
  return { input: path.resolve(input), releaseSha, datasetSha256, output: output ? path.resolve(output) : undefined };
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  const report = JSON.parse(readFileSync(args.input, 'utf8')) as PlayerProductEvidenceReport;
  const summary = evaluatePlayerProductEvidence(report, args);
  if (args.output) {
    mkdirSync(path.dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  console.log(`player/product evidence gate: PASSED (${summary.observationCount} observations)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
