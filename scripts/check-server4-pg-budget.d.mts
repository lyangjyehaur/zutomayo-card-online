export interface Server4PgBudgetArtifact {
  schemaVersion: 1;
  artifactType: 'zutomayo-server4-pg-connection-budget';
  status: 'passed' | 'blocked';
  checkedAt: string;
  targetSlot: 'blue' | 'green';
  reservations: {
    projectedWorstCaseConnections: number;
    remainingAfterProjection: number;
  };
}

export function evaluateServer4PgBudget(
  value: unknown,
  policy: {
    plannedSlotConnections: number;
    transientConnections: number;
    minimumHeadroomConnections: number;
  },
): Server4PgBudgetArtifact;
