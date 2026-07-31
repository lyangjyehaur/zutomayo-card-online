import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANAGED_CACHE_RULE_PREFIX = 'zutomayo-cache-';
const CACHE_RULES_PHASE = 'http_request_cache_settings';
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

interface CloudflareRule {
  action: string;
  action_parameters?: Record<string, unknown>;
  description?: string;
  enabled?: boolean;
  expression: string;
  ref?: string;
  [key: string]: unknown;
}

interface CloudflareRuleset {
  description?: string;
  rules?: CloudflareRule[];
}

interface CloudflareEnvelope<T> {
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
  success?: boolean;
}

const methods = '(http.request.method in {"GET" "HEAD"})';
const cacheErrors = [
  { status_code_range: { from: 400, to: 499 }, value: 0 },
  { status_code_range: { from: 500, to: 599 }, value: 0 },
];

function respectOrigin(): Record<string, unknown> {
  return {
    cache: true,
    edge_ttl: { mode: 'respect_origin', status_code_ttl: cacheErrors },
    browser_ttl: { mode: 'respect_origin' },
  };
}

function immutable(): Record<string, unknown> {
  return {
    cache: true,
    edge_ttl: { mode: 'override_origin', default: 31_536_000, status_code_ttl: cacheErrors },
    browser_ttl: { mode: 'override_origin', default: 31_536_000 },
  };
}

export function desiredManagedCacheRules(): CloudflareRule[] {
  return [
    {
      ref: `${MANAGED_CACHE_RULE_PREFIX}default-bypass`,
      description: 'Application HTML, private APIs, games, sockets and errors bypass edge cache by default',
      expression: 'true',
      action: 'set_cache_settings',
      action_parameters: { cache: false },
      enabled: true,
    },
    {
      ref: `${MANAGED_CACHE_RULE_PREFIX}public-content`,
      description: 'Public announcements, official rulings and image proxy responses respect origin freshness',
      expression: `${methods} and (starts_with(http.request.uri.path, "/api/official/") or starts_with(http.request.uri.path, "/api/imgproxy/") or http.request.uri.path eq "/api/announcements")`,
      action: 'set_cache_settings',
      action_parameters: respectOrigin(),
      enabled: true,
    },
    {
      ref: `${MANAGED_CACHE_RULE_PREFIX}hashed-assets`,
      description: 'Vite hashed assets and versioned font files are immutable',
      expression: `${methods} and (starts_with(http.request.uri.path, "/assets/") or starts_with(http.request.uri.path, "/fonts/") or starts_with(http.request.uri.path, "/workbox-"))`,
      action: 'set_cache_settings',
      action_parameters: immutable(),
      enabled: true,
    },
    {
      ref: `${MANAGED_CACHE_RULE_PREFIX}versioned-battle-assets`,
      description: 'Battle assets are eligible only when the origin accepts their build version',
      expression: `${methods} and starts_with(http.request.uri.path, "/battle/") and (http.request.uri.query contains "v=")`,
      action: 'set_cache_settings',
      // The origin grants immutable only when v equals its active build ID.
      action_parameters: respectOrigin(),
      enabled: true,
    },
  ];
}

function writableRule(rule: CloudflareRule): CloudflareRule {
  return {
    ...(rule.ref ? { ref: rule.ref } : {}),
    ...(rule.description ? { description: rule.description } : {}),
    expression: rule.expression,
    action: rule.action,
    ...(rule.action_parameters ? { action_parameters: rule.action_parameters } : {}),
    enabled: rule.enabled !== false,
  };
}

export function mergeManagedCacheRules(existingRules: CloudflareRule[]): CloudflareRule[] {
  const unmanaged = existingRules.filter((rule) => !rule.ref?.startsWith(MANAGED_CACHE_RULE_PREFIX)).map(writableRule);
  // Managed rules are last so their mutually exclusive cache settings win over
  // legacy dashboard rules without deleting unrelated user-owned rules.
  return [...unmanaged, ...desiredManagedCacheRules()];
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function requireEnvironment(name: 'CLOUDFLARE_API_TOKEN' | 'CLOUDFLARE_ZONE_ID'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function apiRequest<T>(url: string, token: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as CloudflareEnvelope<T>;
  if (response.status === 404 && !init?.method) return null;
  if (!response.ok || body.success === false || body.result === undefined) {
    const errors = body.errors?.map((error) => `${error.code ?? 'unknown'}: ${error.message ?? 'unknown error'}`);
    throw new Error(`Cloudflare API ${response.status}: ${errors?.join('; ') || 'request failed'}`);
  }
  return body.result;
}

export async function syncCloudflareCacheRules(
  mode: 'plan' | 'apply',
): Promise<{ changed: boolean; ruleCount: number }> {
  const token = requireEnvironment('CLOUDFLARE_API_TOKEN');
  const zoneId = requireEnvironment('CLOUDFLARE_ZONE_ID');
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) throw new Error('CLOUDFLARE_ZONE_ID must be a 32-character hexadecimal ID');

  const endpoint = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/rulesets/phases/${CACHE_RULES_PHASE}/entrypoint`;
  const current = await apiRequest<CloudflareRuleset>(endpoint, token);
  const nextRules = mergeManagedCacheRules(current?.rules ?? []);
  const currentWritable = (current?.rules ?? []).map(writableRule);
  const changed = stableJson(currentWritable) !== stableJson(nextRules);

  console.log(
    `${mode}: Cloudflare cache rules ${changed ? 'require changes' : 'are current'} (${nextRules.length} total, ${desiredManagedCacheRules().length} managed)`,
  );
  for (const rule of desiredManagedCacheRules()) console.log(`  ${rule.ref}`);

  if (mode === 'apply' && changed) {
    await apiRequest<CloudflareRuleset>(endpoint, token, {
      method: 'PUT',
      body: JSON.stringify({
        description: current?.description || 'ZUTOMAYO CARD Online cache policy',
        rules: nextRules,
      }),
    });
    console.log('apply: Cloudflare cache rules updated');
  }
  return { changed, ruleCount: nextRules.length };
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'plan';
  if (mode !== 'plan' && mode !== 'apply') throw new Error('usage: cloudflare-cache-rules.ts <plan|apply>');
  await syncCloudflareCacheRules(mode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
