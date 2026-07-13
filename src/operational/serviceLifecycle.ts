export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, string>;
}

export interface ServiceReadiness {
  ok: boolean;
  status: 'ready' | 'degraded' | 'draining';
  checks: Record<string, string>;
}

/**
 * Shared readiness state for services that need to leave traffic before their
 * databases, queues, or WebSocket transports are closed.
 */
export function createServiceReadiness(checkDependencies: () => Promise<ReadinessResult>): {
  readonly isDraining: () => boolean;
  readonly beginDrain: () => boolean;
  readonly check: () => Promise<ServiceReadiness>;
} {
  let draining = false;

  return {
    isDraining: () => draining,
    beginDrain: () => {
      if (draining) return false;
      draining = true;
      return true;
    },
    check: async () => {
      if (draining) return { ok: false, status: 'draining', checks: { service: 'draining' } };
      try {
        const result = await checkDependencies();
        if (draining) return { ok: false, status: 'draining', checks: { service: 'draining' } };
        return { ok: result.ok, status: result.ok ? 'ready' : 'degraded', checks: result.checks };
      } catch {
        return { ok: false, status: 'degraded', checks: { service: 'dependency_check_failed' } };
      }
    },
  };
}
