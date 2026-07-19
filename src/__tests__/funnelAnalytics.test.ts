import { describe, expect, it } from 'vitest';
import { buildFunnelPayload, sanitizeFunnelEntryRoute, viewportClass, type FunnelContext } from '../funnelAnalytics';

const context: FunnelContext = {
  app_version: '0.2.1',
  build_id: 'build-1',
  rules_version: 'rules-1',
  dataset_sha256: 'a'.repeat(64),
  locale: 'zh-TW',
  viewport_class: 'mobile',
  entry_route: '/',
};

describe('funnel analytics contract', () => {
  it('uses stable viewport buckets', () => {
    expect(viewportClass(390)).toBe('mobile');
    expect(viewportClass(768)).toBe('tablet');
    expect(viewportClass(1440)).toBe('desktop');
  });

  it('removes query data and dynamic match IDs from funnel entry routes', () => {
    expect(sanitizeFunnelEntryRoute('/tutorial')).toBe('/tutorial');
    expect(sanitizeFunnelEntryRoute('/play/online/private-match-id')).toBe('/play/online/:matchID');
  });

  it('only accepts aggregate funnel fields and common release context', () => {
    expect(
      buildFunnelPayload(context, {
        step: 2,
        total_steps: 15,
        phase: 'janken',
        match_mode: 'quick_match',
        queue_duration_s: 45,
      }),
    ).toEqual({
      ...context,
      step: 2,
      total_steps: 15,
      phase: 'janken',
      match_mode: 'quick_match',
      queue_duration_s: 45,
    });
  });
});
