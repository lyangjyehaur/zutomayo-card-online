import { describe, expect, it } from 'vitest';
import { MANAGED_CACHE_RULE_PREFIX, desiredManagedCacheRules, mergeManagedCacheRules } from '../cloudflare-cache-rules';

describe('Cloudflare cache rules', () => {
  it('defaults to bypass and only opts explicit public resources into caching', () => {
    const rules = desiredManagedCacheRules();
    expect(rules[0]).toMatchObject({
      ref: `${MANAGED_CACHE_RULE_PREFIX}default-bypass`,
      expression: 'true',
      action_parameters: { cache: false },
    });
    expect(rules.at(-1)?.ref).toBe(`${MANAGED_CACHE_RULE_PREFIX}versioned-battle-assets`);
    expect(JSON.stringify(rules)).toContain('status_code_range');
    expect(JSON.stringify(rules)).toContain('"value":0');
  });

  it('preserves unmanaged rules and replaces only its own managed rules', () => {
    const existing = [
      {
        id: 'dashboard-rule-id',
        ref: 'user-dashboard-rule',
        description: 'kept',
        expression: 'http.request.uri.path eq "/example"',
        action: 'set_cache_settings',
        action_parameters: { cache: false },
        version: '4',
      },
      {
        ref: `${MANAGED_CACHE_RULE_PREFIX}old-rule`,
        expression: 'true',
        action: 'set_cache_settings',
        action_parameters: { cache: true },
      },
    ];
    const merged = mergeManagedCacheRules(existing);
    expect(merged[0]).toMatchObject({ ref: 'user-dashboard-rule', description: 'kept' });
    expect(merged[0]).not.toHaveProperty('id');
    expect(merged[0]).not.toHaveProperty('version');
    expect(merged.some((rule) => rule.ref === `${MANAGED_CACHE_RULE_PREFIX}old-rule`)).toBe(false);
    expect(merged.slice(1)).toEqual(desiredManagedCacheRules());
  });
});
