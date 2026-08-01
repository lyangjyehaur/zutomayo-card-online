export interface RenderedServer4Gateway {
  config: string;
  artifact: Record<string, unknown>;
  artifactJson: string;
}

export function validateGatewayInput(value: unknown): Record<string, unknown>;
export function parseGatewayReleaseManifest(
  contents: string,
  label?: string,
  options?: { allowLegacySix?: boolean },
): Record<string, string>;
export function gatewayInputFromReleaseManifests(value: {
  stableManifest: string;
  candidateManifest: string;
  stableSlot: string;
  candidateSlot: string;
  candidateWeightPercent: number;
}): Record<string, unknown>;
export function gatewayInputFromBootstrapManifest(value: {
  manifest: string;
  stableSlot: string;
}): Record<string, unknown>;
export function renderServer4Gateway(value: unknown, template: string): RenderedServer4Gateway;
