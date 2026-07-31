import { mkdir, writeFile } from 'node:fs/promises';
import { createReplayTranscript } from '../src/game/replayTranscript';
import { buildReplayGoldenScenarios } from '../src/game/__tests__/replayGoldenScenarios';

const outputDirectory = new URL('../src/game/__tests__/goldens/replay/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const scenario of buildReplayGoldenScenarios()) {
  const result = createReplayTranscript(scenario.manifest, scenario.decisions);
  if (!result.ok) {
    throw new Error(`${scenario.name} diverged at decision ${result.divergence.sequence}: ${result.divergence.reason}`);
  }
  await writeFile(new URL(`${scenario.name}.jsonl`, outputDirectory), result.jsonl, 'utf8');
  console.log(`updated ${scenario.category} replay golden: ${scenario.name}`);
}
