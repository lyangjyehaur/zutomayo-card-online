/* global __ENV, __ITER */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const observedPeakRps = Number(__ENV.OBSERVED_PEAK_RPS || 0);
if (!Number.isFinite(observedPeakRps) || observedPeakRps <= 0) {
  throw new Error('OBSERVED_PEAK_RPS must be the measured production/staging peak, not a guessed VU count');
}

const multiplier = Number(__ENV.PEAK_MULTIPLIER || 2);
const targetRps = Math.max(1, Math.ceil(observedPeakRps * multiplier));
const duration = __ENV.SOAK_DURATION || '2h';
const preAllocatedVUs = Number(__ENV.PREALLOCATED_VUS || Math.max(20, targetRps * 2));
const maxVUs = Number(__ENV.MAX_VUS || Math.max(preAllocatedVUs, targetRps * 5));
const allowReadinessOnly = ['1', 'true'].includes((__ENV.ALLOW_READINESS_ONLY || '').toLowerCase());
const targetUrlsInput = __ENV.TARGET_URLS || '';
if (!targetUrlsInput && !allowReadinessOnly) {
  throw new Error(
    'TARGET_URLS must be explicit representative workload URLs; set ALLOW_READINESS_ONLY=true only for a readiness smoke',
  );
}
const targetUrls = (
  targetUrlsInput || 'http://localhost:3000/ready,http://localhost:3001/ready,http://localhost:3002/ready'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (targetUrls.length === 0)
  throw new Error('TARGET_URLS must contain at least one readiness or representative API URL');
if (!allowReadinessOnly && targetUrls.some((url) => /\/ready(?:\?|$)/i.test(url))) {
  throw new Error(
    'TARGET_URLS must include representative API/game operations; readiness-only URLs require ALLOW_READINESS_ONLY=true',
  );
}

const operationFailed = new Rate('operation_failed');
const operationDuration = new Trend('operation_duration', true);

function targetPath(url) {
  return url.replace(/^https?:\/\/[^/]+/i, '').split('?', 1)[0] || '/';
}

export const options = {
  scenarios: {
    operational_soak: {
      executor: 'constant-arrival-rate',
      rate: targetRps,
      timeUnit: '1s',
      duration,
      preAllocatedVUs,
      maxVUs,
      gracefulStop: '30s',
    },
  },
  thresholds: {
    operation_failed: ['rate<0.01'],
    operation_duration: ['p(95)<500', 'p(99)<1000'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const url = targetUrls[__ITER % targetUrls.length];
  const response = http.get(url, {
    headers: { Accept: 'application/json' },
    timeout: __ENV.REQUEST_TIMEOUT || '5s',
    tags: { target: targetPath(url) },
  });
  const ok = check(response, {
    'target returned 2xx': (result) => result.status >= 200 && result.status < 300,
  });
  operationFailed.add(!ok);
  operationDuration.add(response.timings.duration);
  sleep(Number(__ENV.ITERATION_SLEEP_SECONDS || 0));
}

export function handleSummary(data) {
  const output = __ENV.K6_SUMMARY_EXPORT || 'k6-operational-soak-summary.json';
  return {
    [output]: JSON.stringify(data, null, 2),
    stdout: `operational soak complete: ${targetRps} ops/s for ${duration}\n`,
  };
}
