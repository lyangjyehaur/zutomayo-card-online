/* global require, process, console */
// OpenTelemetry 分散式追蹤配置（API server, CommonJS）。
// 必須在所有其他應用程式碼之前 require，讓 auto-instrumentation 能 patch http/ioredis/pg。
// 未設定 OTEL_EXPORTER_OTLP_ENDPOINT 時為 no-op，不啟動 SDK。
'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
let sdk;
let shutdownPromise;

/** 解析 OTEL_RESOURCE_ATTRIBUTES 環境變數（格式：key1=value1,key2=value2）。 */
function parseResourceAttributes(raw) {
  if (!raw) return {};
  const attrs = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) attrs[key] = value;
  }
  return attrs;
}

if (otlpEndpoint) {
  const traceUrl =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    (otlpEndpoint.endsWith('/v1/traces') ? otlpEndpoint : otlpEndpoint.replace(/\/$/, '') + '/v1/traces');

  const serviceName = process.env.OTEL_SERVICE_NAME || 'zutomayo-api';
  const envAttrs = parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES);
  const appVersion = process.env.APP_VERSION || '0.0.0';
  const buildId = process.env.APP_BUILD_ID || 'local';

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: appVersion + '@' + buildId,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      ...envAttrs,
    }),
    traceExporter: new OTLPTraceExporter({ url: traceUrl }),
    instrumentations: [new HttpInstrumentation(), new IORedisInstrumentation(), new PgInstrumentation()],
  });

  sdk.start();
  console.log('[tracing] OpenTelemetry SDK started (service: ' + serviceName + ', endpoint: ' + traceUrl + ')');
}

function shutdownTracing() {
  if (!sdk) return Promise.resolve();
  if (!shutdownPromise) shutdownPromise = sdk.shutdown();
  return shutdownPromise;
}

module.exports = { shutdownTracing };
