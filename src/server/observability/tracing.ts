// OpenTelemetry 分散式追蹤配置（game server）。
// 必須在所有其他應用程式碼之前載入，讓 auto-instrumentation 能 patch http/koa/ioredis/pg/socket.io。
// 未設定 OTEL_EXPORTER_OTLP_ENDPOINT 時為 no-op，不啟動 SDK。
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { KoaInstrumentation } from '@opentelemetry/instrumentation-koa';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { SocketIoInstrumentation } from '@opentelemetry/instrumentation-socket.io';
import { APP_VERSION_INFO } from '../../version';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

/** 解析 OTEL_RESOURCE_ATTRIBUTES 環境變數（格式：key1=value1,key2=value2）。 */
function parseResourceAttributes(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const attrs: Record<string, string> = {};
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
  // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT（完整 traces URL）優先；
  // 否則從 OTEL_EXPORTER_OTLP_ENDPOINT 推導（補上 /v1/traces）。
  const traceUrl =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    (otlpEndpoint.endsWith('/v1/traces') ? otlpEndpoint : `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`);

  const serviceName = process.env.OTEL_SERVICE_NAME || 'zutomayo-game';
  const envAttrs = parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: `${APP_VERSION_INFO.appVersion}@${APP_VERSION_INFO.buildId}`,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      ...envAttrs,
    }),
    traceExporter: new OTLPTraceExporter({ url: traceUrl }),
    instrumentations: [
      new HttpInstrumentation(),
      new KoaInstrumentation(),
      new IORedisInstrumentation(),
      new PgInstrumentation(),
      new SocketIoInstrumentation(),
    ],
  });

  sdk.start();
  console.log(`[tracing] OpenTelemetry SDK started (service: ${serviceName}, endpoint: ${traceUrl})`);

  process.on('SIGTERM', () => void sdk.shutdown().catch(() => {}));
  process.on('SIGINT', () => void sdk.shutdown().catch(() => {}));
}
