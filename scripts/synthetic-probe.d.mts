export interface SyntheticProbeReport {
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: Array<{ name: string; ok: boolean; status: 'passed' | 'failed' | 'skipped' }>;
  error: string;
}

export interface SyntheticProbeOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  clock?: { now(): number };
}

export function validateSyntheticConfig(env?: NodeJS.ProcessEnv): Record<string, unknown>;
export function runSyntheticProbe(options?: SyntheticProbeOptions): Promise<SyntheticProbeReport>;
