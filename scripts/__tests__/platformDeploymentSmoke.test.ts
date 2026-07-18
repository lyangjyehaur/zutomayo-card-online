import { describe, expect, it } from 'vitest';
import { assertReservationPublicAddress, normalizeSeatReservation } from '../platform-deployment-smoke';

describe('platform deployment smoke reservation contract', () => {
  it('preserves the process-specific public address from a flat Colyseus reservation', () => {
    const reservation = normalizeSeatReservation({
      name: 'lobby',
      roomId: 'room_1',
      sessionId: 'session_1',
      processId: 'process_1',
      publicAddress: 'platform.example.test/platform/blue/1',
    });

    expect(reservation.room.publicAddress).toBe('platform.example.test/platform/blue/1');
    expect(assertReservationPublicAddress(reservation, 'wss://platform.example.test/platform/blue/1')).toBe(
      'platform.example.test/platform/blue/1',
    );
  });

  it('fails when a deployment reservation cannot route back to its owning process', () => {
    const reservation = normalizeSeatReservation({
      name: 'lobby',
      roomId: 'room_1',
      sessionId: 'session_1',
      processId: 'process_1',
    });

    expect(() => assertReservationPublicAddress(reservation)).toThrow('process-specific publicAddress');
    reservation.room.publicAddress = 'platform.example.test/platform/green/1';
    expect(() => assertReservationPublicAddress(reservation, 'wss://platform.example.test/platform/blue/1')).toThrow(
      'should match the deployed process route',
    );
  });
});
