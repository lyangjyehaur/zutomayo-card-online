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
  observation?: {
    startedAt: string;
    finishedAt: string;
    dwellSeconds: number;
  };
  policy?: Server4CanaryPolicy;
  policyPassed?: true;
}

export interface Server4CanaryPolicy {
  requiredStages: number;
  stageWeights: readonly number[];
  maxRollbackSeconds: number;
  maxRollbackObservationDelaySeconds: number;
  maxRollbackObservationSeconds: number;
  minStageDwellSeconds: number;
  minHttpSamplesPerStage: number;
  minWebsocketSamplesPerStage: number;
  minReadyReplicaCount: number;
}

export const SERVER4_CANARY_POLICY: Readonly<Server4CanaryPolicy>;

export function parseHaProxyStatsCsv(contents: string): Array<Record<string, string>>;
export function collectServer4CanaryMetrics(input: {
  gatewayArtifact: unknown;
  activeConfigMarker: string;
  startStatsCsv: string;
  endStatsCsv: string;
  rollbackStartedAt?: string;
  rollbackFinishedAt?: string;
  observationStartedAt?: string;
  observationFinishedAt?: string;
}): Server4CanaryRawMetrics;

export function verifyServer4CanaryStage(input: {
  gatewayArtifact: unknown;
  activeConfigMarker: string;
  startStatsCsv: string;
  endStatsCsv: string;
  observationStartedAt: string;
  observationFinishedAt: string;
}): Server4CanaryRawMetrics & {
  observation: NonNullable<Server4CanaryRawMetrics['observation']>;
  policy: Server4CanaryPolicy;
  policyPassed: true;
};
