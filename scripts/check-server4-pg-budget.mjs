import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SLOT_NAMES = new Set(['blue', 'green']);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

export function evaluateServer4PgBudget(value, policy) {
  const snapshot = assertPlainObject(value, 'snapshot');
  const capacity = assertPlainObject(snapshot.postgres, 'snapshot.postgres');
  const reservations = assertPlainObject(snapshot.reservations, 'snapshot.reservations');
  const requestedPolicy = assertPlainObject(policy, 'policy');
  if (snapshot.schemaVersion !== 1) throw new Error('snapshot.schemaVersion must be exactly 1');
  if (!SLOT_NAMES.has(snapshot.targetSlot)) throw new Error('snapshot.targetSlot must be blue or green');

  const maxConnections = positiveInteger(capacity.maxConnections, 'snapshot.postgres.maxConnections');
  const superuserReservedConnections = nonNegativeInteger(
    capacity.superuserReservedConnections,
    'snapshot.postgres.superuserReservedConnections',
  );
  const reservedConnections = nonNegativeInteger(capacity.reservedConnections, 'snapshot.postgres.reservedConnections');
  const currentClientConnections = nonNegativeInteger(
    capacity.currentClientConnections,
    'snapshot.postgres.currentClientConnections',
  );
  const existingManagedConnections = nonNegativeInteger(
    reservations.existingManagedConnections,
    'snapshot.reservations.existingManagedConnections',
  );
  const legacyConnections = nonNegativeInteger(
    reservations.legacyConnections,
    'snapshot.reservations.legacyConnections',
  );
  const plannedSlotConnections = nonNegativeInteger(
    requestedPolicy.plannedSlotConnections,
    'policy.plannedSlotConnections',
  );
  const transientConnections = nonNegativeInteger(requestedPolicy.transientConnections, 'policy.transientConnections');
  const minimumHeadroomConnections = nonNegativeInteger(
    requestedPolicy.minimumHeadroomConnections,
    'policy.minimumHeadroomConnections',
  );

  const usableConnections = maxConnections - superuserReservedConnections - reservedConnections;
  if (usableConnections <= 0) throw new Error('PostgreSQL has no usable non-reserved connections');

  // This intentionally double-counts currently open managed/legacy sessions:
  // currentClientConnections protects unknown workloads while declared pool
  // maxima protect against the known services growing after the gate passes.
  const projectedWorstCaseConnections =
    currentClientConnections +
    existingManagedConnections +
    legacyConnections +
    plannedSlotConnections +
    transientConnections +
    minimumHeadroomConnections;
  const remainingAfterProjection = usableConnections - projectedWorstCaseConnections;
  const status = remainingAfterProjection >= 0 ? 'passed' : 'blocked';

  return {
    schemaVersion: 1,
    artifactType: 'zutomayo-server4-pg-connection-budget',
    status,
    checkedAt: isoTimestamp(snapshot.checkedAt, 'snapshot.checkedAt'),
    sourceHost: typeof snapshot.sourceHost === 'string' && snapshot.sourceHost ? snapshot.sourceHost : 'unknown',
    targetSlot: snapshot.targetSlot,
    postgres: {
      maxConnections,
      superuserReservedConnections,
      reservedConnections,
      usableConnections,
      currentClientConnections,
    },
    reservations: {
      existingManagedConnections,
      legacyConnections,
      plannedSlotConnections,
      transientConnections,
      minimumHeadroomConnections,
      projectedWorstCaseConnections,
      remainingAfterProjection,
    },
    policy: {
      conservativeCurrentConnectionDoubleCount: true,
      targetSlotReservationReplacesExistingTargetSlotLabels: true,
    },
    details: {
      managedContainers: Array.isArray(snapshot.managedContainers) ? snapshot.managedContainers : [],
      legacyServices: Array.isArray(snapshot.legacyServices) ? snapshot.legacyServices : [],
    },
  };
}

function parseIntegerArgument(value, name) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`${name} requires a non-negative integer`);
  return Number(value);
}

function parseArguments(argv) {
  const options = { input: '-' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--input') options.input = value;
    else if (argument === '--output') options.output = path.resolve(process.cwd(), value);
    else if (argument === '--planned-slot-connections') {
      options.plannedSlotConnections = parseIntegerArgument(value, argument);
    } else if (argument === '--transient-connections') {
      options.transientConnections = parseIntegerArgument(value, argument);
    } else if (argument === '--minimum-headroom-connections') {
      options.minimumHeadroomConnections = parseIntegerArgument(value, argument);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  for (const name of ['plannedSlotConnections', 'transientConnections', 'minimumHeadroomConnections']) {
    if (options[name] === undefined) {
      throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/check-server4-pg-budget.mjs [options]',
    '',
    'Options:',
    '  --input FILE                         Snapshot JSON, or - for stdin (default: -)',
    '  --output FILE                        Write the evaluated evidence artifact',
    '  --planned-slot-connections N         Target slot declared pool reservation',
    '  --transient-connections N            Migration/schema-gate reservation',
    '  --minimum-headroom-connections N      Operator/emergency safety reserve',
    '  --help                               Show this help',
  ].join('\n');
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const contents = options.input === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(options.input), 'utf8');
  const artifact = evaluateServer4PgBudget(JSON.parse(contents), options);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (options.output) {
    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, serialized, { encoding: 'utf8', mode: 0o644 });
  }
  process.stdout.write(serialized);
  if (artifact.status !== 'passed') process.exitCode = 2;
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `server4 PostgreSQL budget check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
