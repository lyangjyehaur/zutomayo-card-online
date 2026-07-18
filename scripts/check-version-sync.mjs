import { readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  errors.push(message);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) fail(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const errors = [];
const rootPackage = readJson('package.json');
const apiPackage = readJson('api/package.json');
const apiPackageLock = readJson('api/package-lock.json');

if (typeof rootPackage.version !== 'string' || !rootPackage.version.trim()) {
  fail('package.json version is required');
}

const releaseVersion = rootPackage.version;

assertEqual('api/package.json version', apiPackage.version, releaseVersion);
assertEqual('api/package-lock.json version', apiPackageLock.version, releaseVersion);
assertEqual('api/package-lock.json packages[""].version', apiPackageLock.packages?.['']?.version, releaseVersion);

const managedFallbackFiles = [
  '.env.example',
  'Dockerfile',
  'Dockerfile.gateway',
  'api/Dockerfile',
  'docker-compose.yml',
  'docker-compose.server4.yml',
  'docker-compose.server4-slot.yml',
  'docker-compose.server4-gateway.yml',
  'src/version.ts',
  'vite.config.ts',
  'api/server.cjs',
  'scripts/deploy-server4.sh',
  'scripts/deploy-server4-canary.sh',
];
const hardcodedVersionFallback =
  /\b(?:APP_VERSION|APP_BUILD_ID|GAME_RULES_VERSION|PACKAGE_VERSION|packageVersion|fallbackVersion)\b[^\n]*\b\d+\.\d+\.\d+\b/;

for (const file of managedFallbackFiles) {
  const content = readFileSync(file, 'utf8');
  const match = content.match(hardcodedVersionFallback);
  if (match) fail(`${file} contains a hardcoded managed version fallback: ${match[0].trim()}`);
}

if (errors.length) {
  console.error('Version sync check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Version sync check passed (${releaseVersion}).`);
