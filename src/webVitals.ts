import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { Sentry } from './sentry';

function report(metric: Metric): void {
  const { name, value, rating } = metric;
  // Breadcrumb lets Sentry correlate web vitals with errors that happen in the same session.
  Sentry.addBreadcrumb({
    category: 'web-vital',
    level: 'info',
    data: { name, value: Number(value.toFixed(3)), rating },
  });
  // Only surface poor-rated vitals as standalone events to avoid noise.
  if (rating === 'poor') {
    Sentry.captureMessage(`Web Vital ${name} poor: ${Number(value.toFixed(3))}`, 'warning');
  }
}

/** Initialize Core Web Vitals reporting (CLS / INP / LCP / FCP / TTFB). */
export function initWebVitals(): void {
  onCLS(report);
  onINP(report);
  onLCP(report);
  onFCP(report);
  onTTFB(report);
}
