#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const projectDir = resolve(__dirname, '..');
const OFFICIAL_CARD_DATA_COMMANDS = Object.freeze([
  Object.freeze({
    label: 'official card-text audit',
    args: ['--import', 'tsx', 'scripts/audit-card-official-texts.ts'],
  }),
  Object.freeze({
    label: 'official card-text import',
    args: ['--import', 'tsx', 'scripts/import-card-official-texts-pg.ts'],
  }),
  Object.freeze({ label: 'official card data gate', args: ['scripts/card-data-gate.cjs'] }),
]);

function officialCardDataRequired(env = process.env) {
  const value = String(env.REQUIRE_OFFICIAL_CARD_DATA || '')
    .trim()
    .toLowerCase();
  if (value === 'true') {
    if (
      !/^[a-f0-9]{40}$/.test(
        String(env.RELEASE_SHA || '')
          .trim()
          .toLowerCase(),
      )
    ) {
      throw new Error('RELEASE_SHA must be the full 40-character commit for a signed card data release');
    }
    return true;
  }
  if (value === '' || value === 'false') {
    if (env.NODE_ENV === 'production') {
      throw new Error('REQUIRE_OFFICIAL_CARD_DATA=true is mandatory for production migration releases');
    }
    return false;
  }
  throw new Error('REQUIRE_OFFICIAL_CARD_DATA must be true or false');
}

function runOfficialCardDataRelease({ env = process.env, spawn = spawnSync } = {}) {
  if (!officialCardDataRequired(env)) {
    console.log('Skipping official card data import outside the production release path');
    return false;
  }

  for (const command of OFFICIAL_CARD_DATA_COMMANDS) {
    const result = spawn(process.execPath, command.args, {
      cwd: projectDir,
      env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command.label} failed with exit code ${result.status ?? 'unknown'}`);
    }
  }
  return true;
}

if (require.main === module) {
  try {
    runOfficialCardDataRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  OFFICIAL_CARD_DATA_COMMANDS,
  officialCardDataRequired,
  runOfficialCardDataRelease,
};
