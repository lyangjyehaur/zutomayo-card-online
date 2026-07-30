export type CiChangeTier = 'docs' | 'standard' | 'full';

export interface CiChangeClassification {
  tier: CiChangeTier;
  docsOnly: boolean;
  e2eRequired: boolean;
}

export function isDocumentationPath(path: string): boolean;
export function isLowRiskPath(path: string): boolean;
export function classifyCiChanges(paths: string[]): CiChangeClassification;
