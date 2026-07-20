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
const rootPackageLock = readJson('package-lock.json');
const apiPackage = readJson('api/package.json');
const apiPackageLock = readJson('api/package-lock.json');

if (typeof rootPackage.version !== 'string' || !rootPackage.version.trim()) {
  fail('package.json version is required');
}

const releaseVersion = rootPackage.version;

assertEqual('package-lock.json version', rootPackageLock.version, releaseVersion);
assertEqual('package-lock.json packages[""].version', rootPackageLock.packages?.['']?.version, releaseVersion);
assertEqual('api/package.json version', apiPackage.version, releaseVersion);
assertEqual('api/package-lock.json version', apiPackageLock.version, releaseVersion);
assertEqual('api/package-lock.json packages[""].version', apiPackageLock.packages?.['']?.version, releaseVersion);

const currentVersionDocuments = [
  { path: 'README.md', pattern: /目前版本：\*\*([^*]+)\*\*/ },
  { path: 'README.en.md', pattern: /Current version: \*\*([^*]+)\*\*/ },
  { path: 'README.ja.md', pattern: /現在のバージョン：\*\*([^*]+)\*\*/ },
  { path: 'docs/PLAN.md', pattern: /Current release: ([^\s]+)/ },
];

for (const document of currentVersionDocuments) {
  const content = readFileSync(document.path, 'utf8');
  const match = content.match(document.pattern);
  if (!match) {
    fail(`${document.path} is missing its current-version marker`);
    continue;
  }
  assertEqual(`${document.path} current version`, match[1].trim(), releaseVersion);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const firstRelease = changelog.match(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m);
if (!firstRelease) {
  fail('CHANGELOG.md is missing a dated release heading');
} else {
  assertEqual('CHANGELOG.md latest release', firstRelease[1], releaseVersion);
}

const escapedReleaseVersion = releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const releaseLinkPattern = new RegExp(
  `^\\[${escapedReleaseVersion}\\]: https://github\\.com/.+/releases/tag/v${escapedReleaseVersion}$`,
  'm',
);
if (!releaseLinkPattern.test(changelog)) fail(`CHANGELOG.md is missing the v${releaseVersion} release link`);

const managedFallbackFiles = [
  '.env.example',
  'Dockerfile',
  'api/Dockerfile',
  'docker-compose.yml',
  'docker-compose.server4.yml',
  'src/version.ts',
  'vite.config.ts',
  'api/server.cjs',
  'scripts/deploy-server4.sh',
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
