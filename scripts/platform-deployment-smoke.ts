import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type SeatReservation } from 'colyseus.js';

interface SmokeConfig {
  httpUrl: string;
  wsUrl: string;
  timeoutMs: number;
  expectedPublicAddress?: string;
}

interface FlatSeatReservation {
  name: string;
  roomId: string;
  sessionId: string;
  processId?: string;
  publicAddress?: string;
  protocol?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

type SmokeSeatReservation = Omit<SeatReservation, 'room'> & {
  room: SeatReservation['room'] & { processId?: string; publicAddress?: string };
};

function parseArgs(argv: string[]): Partial<SmokeConfig> {
  const config: Partial<SmokeConfig> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--http-url') {
      config.httpUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--ws-url') {
      config.wsUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-ms') {
      config.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--expected-public-address') {
      config.expectedPublicAddress = argv[index + 1];
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return config;
}

function printHelp(): void {
  console.log(`Usage:
  npm run smoke:platform-deployment
  npm run smoke:platform-deployment -- --http-url http://127.0.0.1:3002
  npm run smoke:platform-deployment -- --ws-url ws://127.0.0.1:3002

Environment:
  PLATFORM_SMOKE_HTTP_URL   Default HTTP base URL for /health and /ready.
  PLATFORM_SMOKE_WS_URL     Default Colyseus websocket URL.
  PLATFORM_SMOKE_TIMEOUT_MS Request and websocket timeout in milliseconds.
  PLATFORM_SMOKE_EXPECTED_PUBLIC_ADDRESS Optional absolute ws/wss address expected in the reservation.`);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function deriveWsUrl(httpUrl: string): string {
  const parsed = new URL(httpUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return normalizeBaseUrl(parsed.toString());
}

function resolveConfig(): SmokeConfig {
  const args = parseArgs(process.argv.slice(2));
  const httpUrl = normalizeBaseUrl(args.httpUrl ?? process.env.PLATFORM_SMOKE_HTTP_URL ?? 'http://127.0.0.1:3002');
  const wsUrl = normalizeBaseUrl(args.wsUrl ?? process.env.PLATFORM_SMOKE_WS_URL ?? deriveWsUrl(httpUrl));
  const timeoutMs = args.timeoutMs ?? (Number(process.env.PLATFORM_SMOKE_TIMEOUT_MS) || 10_000);
  const expectedPublicAddress =
    args.expectedPublicAddress ?? process.env.PLATFORM_SMOKE_EXPECTED_PUBLIC_ADDRESS?.trim() ?? undefined;
  assert.ok(timeoutMs >= 1_000, 'PLATFORM_SMOKE_TIMEOUT_MS must be at least 1000');
  return { httpUrl, wsUrl, timeoutMs, expectedPublicAddress };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as T) : ({} as T);
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function normalizeSeatReservation(response: FlatSeatReservation | SeatReservation): SmokeSeatReservation {
  if ('room' in response) return response as SmokeSeatReservation;
  const room = {
    name: response.name,
    roomId: response.roomId,
    processId: response.processId,
    ...(response.publicAddress ? { publicAddress: response.publicAddress } : {}),
    clients: 0,
    maxClients: 0,
  } as SeatReservation['room'] & { processId?: string; publicAddress?: string };

  return {
    sessionId: response.sessionId,
    protocol: response.protocol,
    reconnectionToken: response.reconnectionToken,
    devMode: response.devMode,
    room,
  };
}

function colyseusAddressFromAbsoluteUrl(value: string): string {
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === 'ws:' || parsed.protocol === 'wss:',
    'expected public address must use ws:// or wss://',
  );
  return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function assertReservationPublicAddress(
  reservation: SmokeSeatReservation,
  expectedAbsoluteAddress?: string,
): string {
  const publicAddress = reservation.room.publicAddress?.trim();
  assert.ok(publicAddress, 'seat reservation must advertise a process-specific publicAddress');
  if (expectedAbsoluteAddress) {
    assert.equal(
      publicAddress,
      colyseusAddressFromAbsoluteUrl(expectedAbsoluteAddress),
      'seat reservation publicAddress should match the deployed process route',
    );
  }
  return publicAddress;
}

async function suppressExpectedColyseusClientWarnings<T>(operation: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('colyseus.js: onMessage() not registered for type ')) {
      return;
    }
    originalWarn(...args);
  };
  try {
    return await operation();
  } finally {
    console.warn = originalWarn;
  }
}

async function assertEndpoint(
  config: SmokeConfig,
  path: '/health' | '/ready',
): Promise<{ ok: true; service?: string }> {
  const result = await fetchJson<{ ok?: unknown; service?: unknown }>(`${config.httpUrl}${path}`, config.timeoutMs);
  assert.equal(result.status, 200, `${path} should return HTTP 200`);
  assert.equal(result.body.ok, true, `${path} should return { ok: true }`);
  if (path === '/health') assert.equal(result.body.service, 'platform', '/health should identify the platform service');
  return result.body as { ok: true; service?: string };
}

async function assertLobbyJoin(config: SmokeConfig): Promise<void> {
  const client = new Client(config.wsUrl);
  const response = await withTimeout(
    client.http.post('matchmake/joinOrCreate/lobby', {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: `guest:platform-smoke-${Date.now()}`,
        displayName: 'Platform Smoke',
        role: 'spectator',
      }),
    }),
    config.timeoutMs,
    'Colyseus lobby seat reservation',
  );
  const reservation = normalizeSeatReservation(response.data as FlatSeatReservation);
  const publicAddress = assertReservationPublicAddress(reservation, config.expectedPublicAddress);
  console.log(`platform-smoke: reservation advertised ${publicAddress}`);
  await suppressExpectedColyseusClientWarnings(async () => {
    const room = await withTimeout(
      client.consumeSeatReservation(reservation),
      config.timeoutMs,
      'Colyseus lobby websocket connection',
    );

    assert.ok(room.roomId, 'lobby join should return a room id');
    await withTimeout(room.leave(true), config.timeoutMs, 'Colyseus lobby leave');
  });
}

export async function runPlatformDeploymentSmoke(): Promise<void> {
  const config = resolveConfig();

  console.log(`platform-smoke: checking ${config.httpUrl}/health`);
  await assertEndpoint(config, '/health');

  console.log(`platform-smoke: checking ${config.httpUrl}/ready`);
  await assertEndpoint(config, '/ready');

  console.log(`platform-smoke: joining lobby through ${config.wsUrl}`);
  await assertLobbyJoin(config);

  console.log('platform-smoke: ok');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) await runPlatformDeploymentSmoke();
