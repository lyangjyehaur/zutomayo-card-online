import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const reportPath = process.env.REPORT_PATH ?? '/private/tmp/zutomayo-performance-report.json';

const profiles = [
  {
    name: 'initial-load',
    path: '/',
    waitFor: 'nav[aria-label] button',
  },
  {
    name: 'battle-entry',
    path: '/qa/battle?state=turn-set&controls=0',
    waitFor: '.bf-root',
    interactWith: '.battle-side-panel-actions button[data-panel-id="status"]',
    warmupPath: '/',
    warmupWaitFor: 'nav[aria-label] button',
  },
];

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const results = [];

try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const store = {
        largestContentfulPaint: [],
        longTasks: [],
        interactions: [],
      };
      Object.defineProperty(window, '__releaseReadinessPerformance', {
        value: store,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      const observe = (type, callback, options = {}) => {
        try {
          const observer = new PerformanceObserver((list) => callback(list.getEntries()));
          observer.observe({ type, buffered: true, ...options });
        } catch {
          // Older browsers may omit individual entry types; the report records an empty series.
        }
      };
      observe('largest-contentful-paint', (entries) => {
        store.largestContentfulPaint.push(
          ...entries.map((entry) => ({ startTime: entry.startTime, size: entry.size })),
        );
      });
      observe('longtask', (entries) => {
        store.longTasks.push(...entries.map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
      });
      observe(
        'event',
        (entries) => {
          store.interactions.push(
            ...entries
              .filter((entry) => entry.interactionId > 0)
              .map((entry) => ({
                name: entry.name,
                startTime: entry.startTime,
                duration: entry.duration,
                interactionId: entry.interactionId,
              })),
          );
        },
        { durationThreshold: 16 },
      );
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      connectionType: 'cellular4g',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    if (profile.warmupPath) {
      await page.goto(`${baseUrl}${profile.warmupPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator(profile.warmupWaitFor).first().waitFor({ state: 'visible', timeout: 20_000 });
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const store = window.__releaseReadinessPerformance;
        store.largestContentfulPaint.length = 0;
        store.longTasks.length = 0;
        store.interactions.length = 0;
        performance.clearResourceTimings();
      });
    }

    const startedAt = Date.now();
    await page.goto(`${baseUrl}${profile.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator(profile.waitFor).first().waitFor({ state: 'visible', timeout: 20_000 });
    const readyMs = Date.now() - startedAt;
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);

    if (profile.interactWith) {
      await page.locator(profile.interactWith).click({ timeout: 10_000 });
      await page.waitForTimeout(500);
    }

    await page
      .waitForFunction(
        () => {
          const visibleCardImages = [...document.images].filter((image) => {
            const rect = image.getBoundingClientRect();
            const source = image.currentSrc || image.src;
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              (source.includes('/api/imgproxy/') || source.includes('/card-back.jpg'))
            );
          });
          return visibleCardImages.every((image) => image.complete);
        },
        undefined,
        { timeout: 8_000 },
      )
      .catch(() => undefined);

    const metrics = await page.evaluate(() => {
      const store = window.__releaseReadinessPerformance;
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const cardImages = [...document.images]
        .map((image) => {
          const rect = image.getBoundingClientRect();
          const source = image.currentSrc || image.src;
          const requestedWidthMatch = source.match(/\/rs:fit:(\d+):0\//);
          const requestedWidth = requestedWidthMatch ? Number(requestedWidthMatch[1]) : null;
          return {
            source,
            loading: image.loading,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            renderedWidth: Math.round(rect.width),
            visible: rect.width > 0 && rect.height > 0,
            requestedWidth,
            requestedToRenderedRatio:
              requestedWidth && rect.width > 0 ? Number((requestedWidth / rect.width).toFixed(2)) : null,
          };
        })
        .filter((image) => image.source.includes('/api/imgproxy/') || image.source.includes('/card-back.jpg'));
      const visibleCardImages = cardImages.filter((image) => image.visible);
      const imageResources = resources
        .filter((resource) => resource.initiatorType === 'img')
        .map((resource) => ({
          name: resource.name,
          duration: Number(resource.duration.toFixed(1)),
          transferSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize,
        }));
      const resourceSummary = resources
        .map((resource) => ({
          name: resource.name,
          initiatorType: resource.initiatorType,
          duration: Number(resource.duration.toFixed(1)),
          transferSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize,
        }))
        .sort((left, right) => right.duration - left.duration);
      const interactionDurations = store.interactions.map((entry) => entry.duration);
      const longTaskDurations = store.longTasks.map((entry) => entry.duration);
      const lcp = store.largestContentfulPaint.at(-1);

      return {
        navigation: navigation
          ? {
              responseEnd: Number(navigation.responseEnd.toFixed(1)),
              domContentLoaded: Number(navigation.domContentLoadedEventEnd.toFixed(1)),
              loadEventEnd: Number(navigation.loadEventEnd.toFixed(1)),
              transferSize: navigation.transferSize,
            }
          : null,
        lcpMs: lcp ? Number(lcp.startTime.toFixed(1)) : null,
        interaction: {
          count: store.interactions.length,
          maxDurationMs: interactionDurations.length ? Math.max(...interactionDurations) : null,
          entries: store.interactions,
        },
        longTasks: {
          count: store.longTasks.length,
          totalDurationMs: Number(longTaskDurations.reduce((total, duration) => total + duration, 0).toFixed(1)),
          maxDurationMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
          entries: store.longTasks,
        },
        resources: {
          count: resourceSummary.length,
          transferSize: resourceSummary.reduce((total, resource) => total + resource.transferSize, 0),
          decodedBodySize: resourceSummary.reduce((total, resource) => total + resource.decodedBodySize, 0),
          slowest: resourceSummary.slice(0, 20),
        },
        cardImages: {
          total: cardImages.length,
          visible: visibleCardImages.length,
          visibleBroken: visibleCardImages.filter((image) => image.complete && image.naturalWidth === 0).length,
          lazy: cardImages.filter((image) => image.loading === 'lazy').length,
          imgproxy: cardImages.filter((image) => image.source.includes('/api/imgproxy/')).length,
          maxRequestedToRenderedRatio: Math.max(
            0,
            ...visibleCardImages.map((image) => image.requestedToRenderedRatio ?? 0),
          ),
          entries: cardImages,
          resources: imageResources,
        },
      };
    });

    const failures = [];
    if (readyMs > 8_000) failures.push(`ready time ${readyMs}ms exceeds 8000ms`);
    if (metrics.lcpMs !== null && metrics.lcpMs > 4_500) {
      failures.push(`LCP ${metrics.lcpMs}ms exceeds synthetic 4500ms budget`);
    }
    if (metrics.longTasks.maxDurationMs > 500) {
      failures.push(`long task ${metrics.longTasks.maxDurationMs}ms exceeds 500ms`);
    }
    if (metrics.interaction.maxDurationMs !== null && metrics.interaction.maxDurationMs > 500) {
      failures.push(`interaction ${metrics.interaction.maxDurationMs}ms exceeds 500ms`);
    }
    if (metrics.cardImages.visibleBroken > 0) {
      failures.push(`${metrics.cardImages.visibleBroken} visible card images failed`);
    }
    if (metrics.cardImages.maxRequestedToRenderedRatio > 4) {
      failures.push(`card image overfetch ratio ${metrics.cardImages.maxRequestedToRenderedRatio} exceeds 4x`);
    }

    results.push({
      name: profile.name,
      path: profile.path,
      profile: {
        viewport: '390x844',
        cache: profile.warmupPath ? 'warm app shell' : 'cold',
        cpuSlowdown: 4,
        latencyMs: 150,
        downloadMbps: 1.6,
        uploadKbps: 750,
      },
      readyMs,
      metrics,
      failures,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(reportPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(reportPath);
for (const result of results) {
  const lcpLabel = result.metrics.lcpMs === null ? 'n/a' : `${result.metrics.lcpMs}ms`;
  const interactionLabel =
    result.metrics.interaction.maxDurationMs === null ? 'n/a' : `${result.metrics.interaction.maxDurationMs}ms`;
  console.log(`${result.failures.length ? 'FAIL' : 'PASS'} ${result.name} ready=${result.readyMs}ms`);
  console.log(
    `  LCP=${lcpLabel} INP-proxy=${interactionLabel} long-task-max=${result.metrics.longTasks.maxDurationMs}ms visible-card-images=${result.metrics.cardImages.visible}`,
  );
  if (result.failures.length) console.error(`  ${result.failures.join('; ')}`);
}

if (results.some((result) => result.failures.length)) process.exit(1);
