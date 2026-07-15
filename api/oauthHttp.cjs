/* global module */

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;
const circuits = new Map();

function clamp(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}

function circuitKeyFor(url) {
  try {
    return new URL(url).origin;
  } catch {
    return String(url).split('?')[0];
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCircuit(key) {
  const current = circuits.get(key);
  if (current) return current;
  const created = { failures: 0, openedUntil: 0, halfOpen: false };
  circuits.set(key, created);
  return created;
}

function resetCircuit(circuit) {
  circuit.failures = 0;
  circuit.openedUntil = 0;
  circuit.halfOpen = false;
}

function recordFailure(circuit, config) {
  circuit.failures += 1;
  if (circuit.failures >= config.failureThreshold) circuit.openedUntil = Date.now() + config.cooldownMs;
  circuit.halfOpen = false;
}

/**
 * Fetch an OAuth/provider endpoint with bounded timeout, retry budget and a
 * per-origin circuit breaker. Callers should disable retries for non-idempotent
 * authorization-code/token POSTs; GET/DELETE callers can use the default.
 */
async function fetchWithResilience(fetchImpl, url, options = {}, overrides = {}) {
  const timeoutMs = clamp(overrides.timeoutMs, 250, 60_000, 8_000);
  const retry = overrides.retry !== false;
  const maxAttempts = retry ? clamp(overrides.maxAttempts, 1, 3, DEFAULT_MAX_ATTEMPTS) : 1;
  const config = {
    failureThreshold: clamp(overrides.failureThreshold, 1, 10, DEFAULT_FAILURE_THRESHOLD),
    cooldownMs: clamp(overrides.cooldownMs, 1_000, 300_000, DEFAULT_COOLDOWN_MS),
  };
  const key = overrides.circuitKey || circuitKeyFor(url);
  const circuit = getCircuit(key);
  if (circuit.openedUntil > Date.now() || circuit.halfOpen) {
    const error = new Error('OAuth provider circuit is open');
    error.code = 'OAUTH_CIRCUIT_OPEN';
    throw error;
  }
  if (circuit.openedUntil) circuit.halfOpen = true;
  if (circuit.openedUntil) circuit.openedUntil = 0;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!isRetryableStatus(response.status) || attempt >= maxAttempts) {
        if (isRetryableStatus(response.status)) recordFailure(circuit, config);
        else resetCircuit(circuit);
        return response;
      }
      try {
        await response.body?.cancel?.();
      } catch {
        // A response body that cannot be cancelled must not prevent the retry.
      }
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        recordFailure(circuit, config);
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
    const baseDelayMs = Math.min(800, 100 * 2 ** (attempt - 1));
    const jitterMs = Math.floor(Math.random() * Math.max(1, baseDelayMs / 2));
    await sleep(baseDelayMs + jitterMs);
  }

  recordFailure(circuit, config);
  throw lastError || new Error('OAuth provider request failed');
}

function resetOAuthHttpCircuits() {
  circuits.clear();
}

module.exports = { fetchWithResilience, resetOAuthHttpCircuits };
