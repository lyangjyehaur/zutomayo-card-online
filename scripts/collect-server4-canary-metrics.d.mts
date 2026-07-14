export interface Server4CanaryRawMetrics {
  schemaVersion: 1;
  artifactType: 'zutomayo-canary-raw-metrics';
  phase: 'rollout' | 'rollback';
  sequence: number;
  stableWeightPercent: number;
  candidateWeightPercent: number;
  httpSamples: number;
  websocketSamples: number;
  readyReplicaCount: number;
  gatewayConfigSha256: string;
  rollbackSeconds?: number;
}

export function parseHaProxyStatsCsv(contents: string): Array<Record<string, string>>;
export function collectServer4CanaryMetrics(input: {
  gatewayArtifact: unknown;
  activeConfigMarker: string;
  startStatsCsv: string;
  endStatsCsv: string;
  rollbackStartedAt?: string;
  rollbackFinishedAt?: string;
}): Server4CanaryRawMetrics;
