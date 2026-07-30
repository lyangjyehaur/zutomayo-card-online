import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const UNIT_TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const LOW_RISK_EXACT_PATHS = new Set([
  '.editorconfig',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
  '.github/CODEOWNERS',
  'src/i18n/en.ts',
  'src/i18n/ja.ts',
  'src/i18n/ko.ts',
  'src/i18n/zh-CN.ts',
  'src/i18n/zh-HK.ts',
  'src/i18n/zh-TW.ts',
]);

export function isDocumentationPath(path) {
  return path.endsWith('.md') || path.startsWith('docs/') || path === 'LICENSE' || path.startsWith('LICENSE.');
}

export function isLowRiskPath(path) {
  if (isDocumentationPath(path) || LOW_RISK_EXACT_PATHS.has(path)) return true;
  if (path === '.env.example' || path.endsWith('/.env.example')) return true;
  if (path.startsWith('.github/ISSUE_TEMPLATE/')) return true;
  if (path.startsWith('.github/PULL_REQUEST_TEMPLATE/')) return true;
  if (path.startsWith('e2e/')) return false;

  const segments = path.split('/');
  return segments.includes('__tests__') || segments.includes('__snapshots__') || UNIT_TEST_FILE.test(path);
}

export function classifyCiChanges(paths) {
  const changedPaths = paths.filter((path) => path.length > 0);
  if (changedPaths.length === 0) {
    return { tier: 'full', docsOnly: false, e2eRequired: true };
  }

  if (changedPaths.every(isDocumentationPath)) {
    return { tier: 'docs', docsOnly: true, e2eRequired: false };
  }

  if (changedPaths.every(isLowRiskPath)) {
    return { tier: 'standard', docsOnly: false, e2eRequired: false };
  }

  return { tier: 'full', docsOnly: false, e2eRequired: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = fs.readFileSync(process.argv[2] ?? 0, 'utf8');
  const result = classifyCiChanges(input.split(/\r?\n/));
  console.log(`tier=${result.tier}`);
  console.log(`docs_only=${result.docsOnly}`);
  console.log(`e2e_required=${result.e2eRequired}`);
}
