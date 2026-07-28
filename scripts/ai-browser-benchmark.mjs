import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-ai-browser-benchmark.json';
const iterations = positiveInteger(process.env.AI_BROWSER_ITERATIONS, 3);
const longTaskLimitMs = positiveNumber(process.env.AI_BROWSER_LONG_TASK_LIMIT_MS, 100);
const cpuRate = positiveNumber(process.env.AI_BROWSER_CPU_RATE, 1);

const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, received: ${value}`);
  return parsed;
}

function benchmarkUrl() {
  const url = new URL(baseUrl);
  url.searchParams.set('ai-performance', '1');
  return url.toString();
}

function isIgnorableConsoleError(message) {
  return (
    message.includes('https://static.cloudflareinsights.com/beacon.min.js') &&
    message.includes('violates the following Content Security Policy directive')
  );
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const results = [];

try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: 1,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !isIgnorableConsoleError(message.text())) consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.addInitScript(() => {
      const store = {
        supported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
        entries: [],
      };
      Object.defineProperty(window, '__zutomayoAiLongTasks', {
        value: store,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      if (store.supported) {
        const observer = new PerformanceObserver((list) => {
          store.entries.push(
            ...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
          );
        });
        observer.observe({ type: 'longtask', buffered: true });
      }
    });

    if (cpuRate !== 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }

    await page.goto(benchmarkUrl(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__zutomayoAiBrowserBenchmark), undefined, { timeout: 20_000 });
    const release = await page.evaluate(async () => {
      const response = await fetch('/api/app-version', { cache: 'no-store' });
      return response.ok ? response.json() : null;
    });
    const benchmark = await page.evaluate(
      async (runIterations) => window.__zutomayoAiBrowserBenchmark.run({ iterations: runIterations }),
      iterations,
    );
    await page.waitForTimeout(100);
    const observed = await page.evaluate(({ startedAt, finishedAt }) => {
      const store = window.__zutomayoAiLongTasks;
      return {
        supported: store.supported,
        entries: store.entries.filter(
          (entry) => entry.startTime < finishedAt && entry.startTime + entry.duration > startedAt,
        ),
      };
    }, benchmark);
    const maxLongTaskMs = observed.entries.reduce((maximum, entry) => Math.max(maximum, entry.duration), 0);
    const failures = [];
    if (!observed.supported) failures.push('browser does not support PerformanceObserver longtask entries');
    if (
      !release ||
      typeof release.appVersion !== 'string' ||
      typeof release.buildId !== 'string' ||
      typeof release.rulesVersion !== 'string'
    ) {
      failures.push('release candidate identity is missing from /api/app-version');
    }
    if (benchmark.cardCount < 20) failures.push(`expected production cards, received ${benchmark.cardCount}`);
    if (!/^[a-f0-9]{64}$/.test(benchmark.cardFingerprint)) failures.push('card strategy fingerprint is missing');
    if (benchmark.decisions.length !== iterations) {
      failures.push(`expected ${iterations} decisions, received ${benchmark.decisions.length}`);
    }
    if (benchmark.decisions.some((decision) => decision.selections === 0)) {
      failures.push('hard benchmark returned an empty plan for a non-empty hand');
    }
    if (maxLongTaskMs > longTaskLimitMs) {
      failures.push(`AI long task ${maxLongTaskMs.toFixed(2)}ms exceeds ${longTaskLimitMs}ms`);
    }
    if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} browser console/page error(s)`);
    results.push({
      profile: profile.name,
      viewport: profile.viewport,
      release,
      benchmark,
      longTasks: { ...observed, maxDurationMs: maxLongTaskMs },
      consoleErrors,
      failures,
      passed: failures.length === 0,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  thresholds: { longTaskLimitMs, cpuRate, iterations },
  passed: results.every((result) => result.passed),
  results,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const result of results) {
  const maxDecisionMs = Math.max(...result.benchmark.decisions.map((decision) => decision.durationMs));
  console.log(
    `${result.profile}: cards=${result.benchmark.cardCount} fingerprint=${result.benchmark.cardFingerprint.slice(0, 12)} ` +
      `decisions=${result.benchmark.decisions.length} ` +
      `decision-max=${maxDecisionMs.toFixed(2)}ms long-task-max=${result.longTasks.maxDurationMs.toFixed(2)}ms ` +
      `${result.passed ? 'passed' : 'failed'}`,
  );
  for (const failure of result.failures) console.error(`  - ${failure}`);
}
console.log(`AI browser benchmark report: ${reportPath}`);
if (!report.passed) process.exitCode = 1;
