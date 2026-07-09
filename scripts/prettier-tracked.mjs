import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const gitResult = spawnSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (gitResult.status !== 0) {
  process.stderr.write(gitResult.stderr);
  process.exit(gitResult.status ?? 1);
}

const files = gitResult.stdout
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(file) && statSync(file).isFile());

if (files.length === 0) {
  console.log('No tracked files to check.');
  process.exit(0);
}

const prettierBin = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
const prettierResult = spawnSync(prettierBin, ['--check', '--ignore-unknown', ...files], {
  stdio: 'inherit',
});

process.exit(prettierResult.status ?? 1);
