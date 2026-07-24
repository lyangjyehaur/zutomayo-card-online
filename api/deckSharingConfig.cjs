/* global module */

function deckSharingEnabled(env = process.env) {
  const configured = String(env.DECK_SHARING_ENABLED || '')
    .trim()
    .toLowerCase();
  if (configured === 'true' || configured === '1' || configured === 'yes') return true;
  if (configured === 'false' || configured === '0' || configured === 'no') return false;
  return env.NODE_ENV !== 'production';
}

module.exports = { deckSharingEnabled };
