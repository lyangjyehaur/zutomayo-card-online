#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_METRICS_FILE = '/var/lib/node_exporter/textfile_collector/zutomayo_synthetic.prom';
const LAST_SUCCESS_METRIC = 'zutomayo_synthetic_probe_last_success_unixtime_seconds';

function positiveNumber(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function trimUrl(value, fallback) {
  const url = String(value || fallback).trim();
  return url.replace(/\/$/, '');
}

export function validateSyntheticConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const required = production || env.SYNTHETIC_REQUIRED === 'true';
  const email = String(env.SYNTHETIC_EMAIL || '').trim();
  const password = String(env.SYNTHETIC_PASSWORD || '');
  const sessionCookie = String(env.SYNTHETIC_SESSION_COOKIE || '').trim();
  if (/[\r\n]/.test(sessionCookie)) throw new Error('SYNTHETIC_SESSION_COOKIE contains an invalid line break');
  if (sessionCookie && !/(?:^|;\s*)zutomayo_session=[^;]+/.test(sessionCookie)) {
    throw new Error('SYNTHETIC_SESSION_COOKIE must contain the zutomayo_session cookie');
  }
  if (Boolean(email) !== Boolean(password)) {
    throw new Error('SYNTHETIC_EMAIL and SYNTHETIC_PASSWORD must be configured together');
  }
  if (required && !sessionCookie && (!email || !password)) {
    throw new Error('synthetic production probe requires SYNTHETIC_SESSION_COOKIE or SYNTHETIC_EMAIL/PASSWORD');
  }
  const metricsFile = String(env.SYNTHETIC_METRICS_FILE || (required ? DEFAULT_METRICS_FILE : '')).trim();
  if (required && !metricsFile) throw new Error('synthetic production probe requires SYNTHETIC_METRICS_FILE');
  return {
    production,
    required,
    email,
    password,
    sessionCookie,
    metricsFile,
    timeoutMs: positiveNumber(env.SYNTHETIC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 100),
    gameUrl: trimUrl(env.SYNTHETIC_GAME_URL, 'http://127.0.0.1:3000'),
    apiUrl: trimUrl(env.SYNTHETIC_API_URL, 'http://127.0.0.1:3001'),
    platformUrl: trimUrl(env.SYNTHETIC_PLATFORM_URL, 'http://127.0.0.1:3002'),
  };
}

function failureMetricsFile(env) {
  const required = env.NODE_ENV === 'production' || env.SYNTHETIC_REQUIRED === 'true';
  const configured = String(env.SYNTHETIC_METRICS_FILE || '').trim();
  return configured || (required ? DEFAULT_METRICS_FILE : '');
}

function bodySnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function cookieParts(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=[^;,]+=)/g);
}

class CookieJar {
  #cookies = new Map();

  absorb(headers) {
    for (const value of cookieParts(headers)) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  toString() {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

function gameSessionCookie(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('zutomayo_session='));
}

async function request(url, options, fetchImpl, timeoutMs) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetchImpl(url, {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON responses as text for the homepage check.
  }
  return { response, text, body: parsed };
}

function assertOk(result, label) {
  if (!result.response.ok) {
    throw new Error(`${label} returned HTTP ${result.response.status}: ${bodySnippet(result.text)}`);
  }
  return result.body;
}

function isVersionInfo(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.appVersion === 'string' &&
    typeof value.buildId === 'string' &&
    typeof value.rulesVersion === 'string',
  );
}

function metricLabel(value) {
  return JSON.stringify(String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' '));
}

function renderMetrics(report, previousLastSuccessUnix = 0) {
  const runUnix = Math.floor(report.finishedAt / 1000);
  const lastSuccessUnix = report.ok ? runUnix : Math.max(0, Math.floor(Number(previousLastSuccessUnix) || 0));
  const lines = [
    '# HELP zutomayo_synthetic_probe_success Whether the latest synthetic probe completed successfully.',
    '# TYPE zutomayo_synthetic_probe_success gauge',
    `zutomayo_synthetic_probe_success ${report.ok ? 1 : 0}`,
    '# HELP zutomayo_synthetic_probe_duration_seconds Duration of the latest synthetic probe.',
    '# TYPE zutomayo_synthetic_probe_duration_seconds gauge',
    `zutomayo_synthetic_probe_duration_seconds ${(report.durationMs / 1000).toFixed(3)}`,
    '# HELP zutomayo_synthetic_probe_last_run_unixtime_seconds Unix timestamp of the latest synthetic probe.',
    '# TYPE zutomayo_synthetic_probe_last_run_unixtime_seconds gauge',
    `zutomayo_synthetic_probe_last_run_unixtime_seconds ${runUnix}`,
    '# HELP zutomayo_synthetic_probe_last_success_unixtime_seconds Unix timestamp of the latest successful synthetic probe.',
    '# TYPE zutomayo_synthetic_probe_last_success_unixtime_seconds gauge',
    `${LAST_SUCCESS_METRIC} ${lastSuccessUnix}`,
    '# HELP zutomayo_synthetic_probe_step_success Whether an individual synthetic step succeeded.',
    '# TYPE zutomayo_synthetic_probe_step_success gauge',
  ];
  for (const step of report.steps) {
    if (step.status === 'skipped') continue;
    lines.push(`zutomayo_synthetic_probe_step_success{step=${metricLabel(step.name)}} ${step.ok ? 1 : 0}`);
  }
  return `${lines.join('\n')}\n`;
}

async function readLastSuccessUnix(filePath) {
  try {
    const contents = await readFile(filePath, 'utf8');
    const match = contents.match(new RegExp(`^${LAST_SUCCESS_METRIC}\\s+([0-9]+(?:\\.[0-9]+)?)\\s*$`, 'm'));
    return match ? Math.max(0, Math.floor(Number(match[1]) || 0)) : 0;
  } catch {
    return 0;
  }
}

async function writeMetricsFile(filePath, report) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const previousLastSuccessUnix = await readLastSuccessUnix(absolutePath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, renderMetrics(report, previousLastSuccessUnix), { mode: 0o644 });
    await rename(temporaryPath, absolutePath);
    await chmod(absolutePath, 0o644);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function runSyntheticProbe({ env = process.env, fetchImpl = fetch, clock = Date } = {}) {
  const startedAt = clock.now();
  let config;
  try {
    config = validateSyntheticConfig(env);
  } catch (error) {
    const configError = error instanceof Error ? error : new Error(String(error));
    const finishedAt = clock.now();
    const report = {
      ok: false,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      steps: [{ name: 'config', ok: false, status: 'failed' }],
      error: configError.message,
    };
    await writeMetricsFile(failureMetricsFile(env), report).catch(() => undefined);
    throw configError;
  }
  const steps = [];
  let matchId = '';
  let hostSeat;
  let guestSeat;
  let primaryError;
  let cleanupError;
  let cookieHeader = config.sessionCookie;
  let gameCookieHeader = gameSessionCookie(cookieHeader) || '';
  const jar = new CookieJar();

  const step = async (name, operation) => {
    try {
      const result = await operation();
      steps.push({ name, ok: true, status: 'passed' });
      return result;
    } catch (error) {
      steps.push({ name, ok: false, status: 'failed' });
      throw error;
    }
  };

  try {
    await step('homepage', async () => {
      const result = await request(`${config.gameUrl}/`, {}, fetchImpl, config.timeoutMs);
      assertOk(result, 'homepage');
      if (!/<(?:!doctype\s+html|html\b)/i.test(result.text)) throw new Error('homepage did not return HTML');
    });

    const readinessTargets = [
      ['game', config.gameUrl],
      ['api', config.apiUrl],
      ['platform', config.platformUrl],
    ];
    for (const [service, baseUrl] of readinessTargets) {
      await step(`${service}-health`, async () => {
        const result = await request(`${baseUrl}/health`, {}, fetchImpl, config.timeoutMs);
        assertOk(result, `${service} health`);
      });
      await step(`${service}-readiness`, async () => {
        const result = await request(`${baseUrl}/ready`, {}, fetchImpl, config.timeoutMs);
        assertOk(result, `${service} readiness`);
      });
    }

    const version = await step('game-version', async () => {
      const result = await request(`${config.gameUrl}/api/app-version`, {}, fetchImpl, config.timeoutMs);
      const body = assertOk(result, 'game app-version');
      if (!isVersionInfo(body)) throw new Error('game app-version response is invalid');
      return body;
    });

    if (!cookieHeader && config.email && config.password) {
      await step('login', async () => {
        const result = await request(
          `${config.apiUrl}/api/login`,
          { method: 'POST', body: { email: config.email, password: config.password } },
          fetchImpl,
          config.timeoutMs,
        );
        assertOk(result, 'synthetic login');
        jar.absorb(result.response.headers);
        cookieHeader = jar.toString();
        if (!cookieHeader) throw new Error('synthetic login did not issue a session cookie');
        gameCookieHeader = gameSessionCookie(cookieHeader) || '';
        if (!gameCookieHeader) throw new Error('synthetic login did not issue zutomayo_session');
      });
    } else if (!cookieHeader) {
      steps.push({ name: 'login', ok: true, status: 'skipped' });
    } else {
      steps.push({ name: 'login', ok: true, status: 'passed' });
    }

    if (cookieHeader) {
      await step('authenticated-profile', async () => {
        const result = await request(
          `${config.apiUrl}/api/profile`,
          { headers: { Cookie: cookieHeader } },
          fetchImpl,
          config.timeoutMs,
        );
        assertOk(result, 'authenticated profile');
      });
    }

    const createResult = await step('create-room', async () => {
      const result = await request(
        `${config.gameUrl}/games/zutomayo-card/create`,
        {
          method: 'POST',
          headers: gameCookieHeader ? { Cookie: gameCookieHeader } : {},
          body: { numPlayers: 2, setupData: { clientVersion: version } },
        },
        fetchImpl,
        config.timeoutMs,
      );
      const body = assertOk(result, 'create room');
      if (!body || typeof body.matchID !== 'string' || !body.matchID)
        throw new Error('create room returned no matchID');
      matchId = body.matchID;
      return body;
    });
    void createResult;

    hostSeat = await step('join-room-host', async () => {
      const result = await request(
        `${config.gameUrl}/games/zutomayo-card/${encodeURIComponent(matchId)}/join`,
        {
          method: 'POST',
          headers: gameCookieHeader ? { Cookie: gameCookieHeader } : {},
          body: { playerID: '0', playerName: 'Synthetic Host', clientVersion: version },
        },
        fetchImpl,
        config.timeoutMs,
      );
      const body = assertOk(result, 'join room host');
      if (!body || typeof body.playerCredentials !== 'string') throw new Error('host join returned no credentials');
      return body;
    });

    guestSeat = await step('join-room-guest', async () => {
      const result = await request(
        `${config.gameUrl}/games/zutomayo-card/${encodeURIComponent(matchId)}/join`,
        {
          method: 'POST',
          body: { playerID: '1', playerName: 'Synthetic Guest', clientVersion: version },
        },
        fetchImpl,
        config.timeoutMs,
      );
      const body = assertOk(result, 'join room guest');
      if (!body || typeof body.playerCredentials !== 'string') throw new Error('guest join returned no credentials');
      return body;
    });

    await step('room-members', async () => {
      const result = await request(
        `${config.gameUrl}/games/zutomayo-card/${encodeURIComponent(matchId)}`,
        {},
        fetchImpl,
        config.timeoutMs,
      );
      const body = assertOk(result, 'room members');
      if (!Array.isArray(body?.players) || body.players.length < 2) throw new Error('room did not contain two players');
    });
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (matchId) {
      for (const [label, seat, seatCookie] of [
        ['host', hostSeat, gameCookieHeader],
        ['guest', guestSeat, ''],
      ]) {
        if (!seat?.playerCredentials) continue;
        try {
          const result = await request(
            `${config.gameUrl}/games/zutomayo-card/${encodeURIComponent(matchId)}/leave`,
            {
              method: 'POST',
              headers: seatCookie ? { Cookie: seatCookie } : {},
              body: { playerID: String(seat.playerID), credentials: seat.playerCredentials },
            },
            fetchImpl,
            config.timeoutMs,
          );
          assertOk(result, `cleanup ${label}`);
        } catch (error) {
          cleanupError ??= error instanceof Error ? error : new Error(String(error));
        }
      }
    }
  }

  const finishedAt = clock.now();
  const report = {
    ok: !primaryError && !cleanupError,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    steps,
    error: primaryError?.message || cleanupError?.message || '',
  };
  try {
    await writeMetricsFile(config.metricsFile, report);
  } catch (error) {
    primaryError ??= error instanceof Error ? error : new Error(String(error));
    report.ok = false;
    report.error = primaryError.message;
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const report = await runSyntheticProbe();
    console.log(JSON.stringify({ outcome: 'success', durationMs: report.durationMs, steps: report.steps }));
  } catch (error) {
    console.error(
      JSON.stringify({ outcome: 'failure', error: error instanceof Error ? error.message : String(error) }),
    );
    process.exitCode = 1;
  }
}
