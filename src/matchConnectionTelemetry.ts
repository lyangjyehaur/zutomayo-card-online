import type { FunnelEventData, FunnelEventName } from './funnelAnalytics';

export interface MatchConnectionTelemetryEvent {
  name: Extract<FunnelEventName, 'F_Match_Connection_Attempt' | 'F_Match_Connection_Success'>;
  data: Pick<FunnelEventData, 'connection_phase' | 'elapsed_s' | 'match_mode'>;
}

interface ConnectionAttempt {
  phase: 'initial' | 'reconnect';
  startedAt: number;
  emitted: boolean;
}

export interface MatchConnectionTelemetry {
  transition: (connected: boolean) => MatchConnectionTelemetryEvent[];
}

function elapsedSeconds(startedAt: number, finishedAt: number): number {
  return Number((Math.max(0, finishedAt - startedAt) / 1_000).toFixed(3));
}

export function createMatchConnectionTelemetry(now: () => number = Date.now): MatchConnectionTelemetry {
  let connectedOnce = false;
  let attempt: ConnectionAttempt | undefined = {
    phase: 'initial',
    startedAt: now(),
    emitted: false,
  };

  return {
    transition(connected) {
      const events: MatchConnectionTelemetryEvent[] = [];
      if (!attempt && !connected) {
        attempt = {
          phase: connectedOnce ? 'reconnect' : 'initial',
          startedAt: now(),
          emitted: false,
        };
      }
      if (!attempt) return events;

      const eventData = (elapsed_s: number): MatchConnectionTelemetryEvent['data'] => ({
        match_mode: 'online',
        connection_phase: attempt!.phase,
        elapsed_s,
      });
      if (!attempt.emitted) {
        attempt.emitted = true;
        events.push({ name: 'F_Match_Connection_Attempt', data: eventData(0) });
      }
      if (!connected) return events;

      events.push({
        name: 'F_Match_Connection_Success',
        data: eventData(elapsedSeconds(attempt.startedAt, now())),
      });
      connectedOnce = true;
      attempt = undefined;
      return events;
    },
  };
}
