export interface AssembleServer4CanaryEvidenceOptions {
  evidenceDir: string;
  stableManifest: string;
  candidateManifest: string;
  stage10Prefix: string;
  stage50Prefix: string;
  stage100Prefix: string;
  rollbackPrefix: string;
  outputDir: string;
  runId: string;
  repository: string;
  runUrl: string;
  checkedAt?: string | Date;
}

export interface CanaryArtifactReference {
  path: string;
  sha256: string;
}

export interface AssembledServer4CanaryEvidence {
  schemaVersion: 1;
  status: 'passed';
  environment: 'staging';
  evidenceType: 'canary-rollback';
  releaseSha: string;
  imageDigests: Record<string, string>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checkedAt: string;
  metrics: { rollbackSeconds: number; stagesCompleted: number };
  thresholds: Record<string, number>;
  results: Record<string, true>;
  artifacts: CanaryArtifactReference[];
  provenance: { runId: string; repository: string; runUrl: string };
  source: string;
  rollout: Record<string, unknown>;
}

export function assembleServer4CanaryEvidence(options: AssembleServer4CanaryEvidenceOptions): {
  evidence: AssembledServer4CanaryEvidence;
  outputPath: string;
  sha256: string;
};
