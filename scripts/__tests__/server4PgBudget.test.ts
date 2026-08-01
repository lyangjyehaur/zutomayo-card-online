import { describe, expect, it } from 'vitest';
import { evaluateServer4PgBudget } from '../check-server4-pg-budget.mjs';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    checkedAt: '2026-07-14T00:00:00.000Z',
    sourceHost: 'server4',
    targetSlot: 'blue',
    postgres: {
      maxConnections: 100,
      superuserReservedConnections: 3,
      reservedConnections: 0,
      currentClientConnections: 7,
    },
    reservations: { existingManagedConnections: 0, legacyConnections: 45 },
    managedContainers: [],
    legacyServices: ['game', 'api'],
    ...overrides,
  };
}

const policy = {
  plannedSlotConnections: 20,
  transientConnections: 2,
  minimumHeadroomConnections: 20,
};

describe('server4 PostgreSQL connection budget', () => {
  it('accepts the current bootstrap envelope without moving the existing database', () => {
    expect(evaluateServer4PgBudget(snapshot(), policy)).toMatchObject({
      status: 'passed',
      postgres: { usableConnections: 97, currentClientConnections: 7 },
      reservations: {
        existingManagedConnections: 0,
        legacyConnections: 45,
        plannedSlotConnections: 20,
        projectedWorstCaseConnections: 94,
        remainingAfterProjection: 3,
      },
    });
  });

  it('blocks a second warm slot while the full legacy reservation is still present', () => {
    const result = evaluateServer4PgBudget(
      snapshot({
        targetSlot: 'green',
        reservations: { existingManagedConnections: 20, legacyConnections: 45 },
      }),
      policy,
    );
    expect(result).toMatchObject({
      status: 'blocked',
      reservations: { projectedWorstCaseConnections: 114, remainingAfterProjection: -17 },
    });
  });

  it('accepts blue/green after the legacy app reservation is removed', () => {
    expect(
      evaluateServer4PgBudget(
        snapshot({
          targetSlot: 'green',
          reservations: { existingManagedConnections: 25, legacyConnections: 0 },
        }),
        policy,
      ),
    ).toMatchObject({ status: 'passed', reservations: { projectedWorstCaseConnections: 74 } });
  });

  it('rejects malformed or negative capacity snapshots', () => {
    expect(() =>
      evaluateServer4PgBudget(
        snapshot({
          postgres: {
            maxConnections: 100,
            superuserReservedConnections: 3,
            reservedConnections: 0,
            currentClientConnections: -1,
          },
        }),
        policy,
      ),
    ).toThrow('currentClientConnections must be a non-negative integer');
  });
});
