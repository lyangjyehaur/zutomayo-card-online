import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const prettierCli = fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url));
const batchSize = 40;
const mode = process.argv.includes('--write') ? '--write' : '--check';
let failed = false;
for (let index = 0; index < files.length; index += batchSize) {
  const batch = files.slice(index, index + batchSize);
  const prettierResult = spawnSync(process.execPath, [prettierCli, mode, '--ignore-unknown', ...batch], {
    stdio: 'inherit',
  });
  if (prettierResult.error) {
    process.stderr.write(`${prettierResult.error.message}\n`);
    process.exit(1);
  }
  if (prettierResult.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
