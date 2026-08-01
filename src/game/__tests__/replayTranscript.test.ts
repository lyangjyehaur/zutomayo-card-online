import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalReplayState, createReplayStateFingerprint } from '../decisionTrace';
import { replayMatch } from '../replayEngine';
import { createReplayTranscript, parseReplayTranscript } from '../replayTranscript';
import { buildReplayGoldenScenarios, type ReplayGoldenScenario } from './replayGoldenScenarios';

const scenarios = buildReplayGoldenScenarios();

function createScenarioTranscript(scenario: ReplayGoldenScenario): string {
  const result = createReplayTranscript(scenario.manifest, scenario.decisions);
  expect(result.ok, `${scenario.name} should replay before transcript generation`).toBe(true);
  if (!result.ok) throw new Error(`${scenario.name} diverged at decision ${result.divergence.sequence}`);
  return result.jsonl;
}

describe('canonical replay transcript', () => {
  it('covers both engine and full-flow golden categories', () => {
    expect(new Set(scenarios.map((scenario) => scenario.category))).toEqual(new Set(['engine', 'full-flow']));
  });

  it.each(scenarios)('$name is byte-identical across independent reconstructions', (scenario) => {
    expect(createScenarioTranscript(scenario)).toBe(createScenarioTranscript(scenario));
  });

  it.each(scenarios)('$name matches its committed golden JSONL baseline', (scenario) => {
    const expected = readFileSync(new URL(`./goldens/replay/${scenario.name}.jsonl`, import.meta.url), 'utf8');
    expect(createScenarioTranscript(scenario)).toBe(expected);
  });

  it.each(scenarios)('$name parses and reconstructs its certified final state', (scenario) => {
    const jsonl = createScenarioTranscript(scenario);
    const parsed = parseReplayTranscript(jsonl);
    const replay = replayMatch(parsed.manifest, parsed.decisions);

    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(createReplayStateFingerprint(replay.G)).toBe(parsed.finalStateFingerprint);
    expect(canonicalReplayState(replay.G)).toEqual(parsed.finalState);
  });

  it('rejects non-canonical and unterminated transcript input', () => {
    const canonical = createScenarioTranscript(scenarios[0]);
    expect(() => parseReplayTranscript(canonical.trimEnd())).toThrow('end with a newline');
    expect(() => parseReplayTranscript(canonical.replace('{"manifest":', '{ "manifest":'))).toThrow(
      'not canonical JSON',
    );
  });
});
