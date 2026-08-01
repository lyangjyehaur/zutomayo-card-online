/* global module */

function resolveBackgroundWorkersEnabled(env, variableName) {
  const raw = env?.[variableName];
  if (raw === undefined || String(raw).trim() === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${variableName} must be either true or false`);
}

module.exports = { resolveBackgroundWorkersEnabled };
