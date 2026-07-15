import { setTimeout as delay } from 'node:timers/promises';

interface ProbeSample {
  at: string;
  elapsedMs: number;
  healthy: boolean;
  targets: Array<{ url: string; status: number | null; ok: boolean; error?: string }>;
}

const targets = (
  process.env.CHAOS_PROBE_URLS || 'http://localhost:3000/ready,http://localhost:3001/ready,http://localhost:3002/ready'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const intervalMs = Math.max(250, Number(process.env.CHAOS_PROBE_INTERVAL_MS) || 1_000);
const timeoutMs = Math.max(intervalMs, Number(process.env.CHAOS_PROBE_TIMEOUT_MS) || 120_000);
const requiredHealthySamples = Math.max(1, Number(process.env.CHAOS_PROBE_HEALTHY_SAMPLES) || 3);
const requireOutage = process.env.CHAOS_PROBE_REQUIRE_OUTAGE !== 'false';

if (targets.length === 0) throw new Error('CHAOS_PROBE_URLS must contain at least one URL');

async function probe(url: string): Promise<ProbeSample['targets'][number]> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(intervalMs, 5_000)) });
    return { url, status: response.status, ok: response.ok };
  } catch (error) {
    return { url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const startedAt = Date.now();
let outageObserved = false;
let consecutiveHealthy = 0;

while (Date.now() - startedAt <= timeoutMs) {
  const results = await Promise.all(targets.map(probe));
  const healthy = results.every((result) => result.ok);
  const sample: ProbeSample = {
    at: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    healthy,
    targets: results,
  };
  process.stdout.write(`${JSON.stringify(sample)}\n`);

  if (!healthy) {
    outageObserved = true;
    consecutiveHealthy = 0;
  } else if (outageObserved || !requireOutage) {
    consecutiveHealthy++;
    if (consecutiveHealthy >= requiredHealthySamples) {
      process.stdout.write(
        `${JSON.stringify({ outcome: 'recovered', outageObserved, elapsedMs: Date.now() - startedAt })}\n`,
      );
      process.exit(0);
    }
  }
  await delay(intervalMs);
}

process.stderr.write(
  `${JSON.stringify({ outcome: outageObserved ? 'recovery_timeout' : 'outage_not_observed', elapsedMs: Date.now() - startedAt })}\n`,
);
process.exit(1);
