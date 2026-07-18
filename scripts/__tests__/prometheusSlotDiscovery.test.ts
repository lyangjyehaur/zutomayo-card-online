import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const prometheus = readFileSync(resolve('observability/prometheus/prometheus.yml'), 'utf8');
const alerts = readFileSync(resolve('observability/grafana/alerting/alerts.yml'), 'utf8');
const hasDockerCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

type RenderedCompose = {
  networks: Record<string, { external?: boolean; name?: string }>;
  services: Record<string, { networks?: Record<string, { aliases?: string[] } | null> }>;
};

function scrapeJob(jobName: string): string {
  const marker = `  - job_name: '${jobName}'`;
  const start = prometheus.indexOf(marker);
  if (start < 0) throw new Error(`missing Prometheus job ${jobName}`);
  const end = prometheus.indexOf('\n  - job_name:', start + marker.length);
  return prometheus.slice(start, end < 0 ? undefined : end);
}

function expectDnsDiscovery(block: string, names: string[], port: number): void {
  expect(block).toContain('dns_sd_configs:');
  expect(block).toContain(`names: [${names.map((name) => `'${name}'`).join(', ')}]`);
  expect(block).toContain('type: A');
  expect(block).toContain(`port: ${port}`);
  expect(block).toContain('refresh_interval: 15s');
}

function expectRelabel(
  block: string,
  regex: string,
  targetLabel: 'release_slot' | 'service' | 'process',
  replacement: string,
): void {
  expect(block).toContain(
    [
      '      - source_labels: [__meta_dns_name]',
      `        regex: '${regex}'`,
      `        target_label: ${targetLabel}`,
      `        replacement: ${replacement}`,
    ].join('\n'),
  );
}

function renderCompose(path: string): RenderedCompose {
  const result = spawnSync('docker', ['compose', '-f', path, 'config', '--no-interpolate', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as RenderedCompose;
}

describe('Prometheus blue/green slot discovery', () => {
  it.skipIf(!hasDockerCompose)('joins Prometheus and blackbox to the shared release edge network', () => {
    const config = renderCompose('docker-compose.monitoring.yml');
    expect(config.networks['release-edge']).toEqual({
      external: true,
      name: '${GATEWAY_EDGE_NETWORK:-zutomayo-release-edge}',
    });
    for (const service of ['prometheus', 'blackbox-exporter']) {
      expect(config.services[service]?.networks).toHaveProperty('default');
      expect(config.services[service]?.networks).toHaveProperty('release-edge');
    }
  });

  it.skipIf(!hasDockerCompose)('keeps legacy target aliases unique on every supported app network', () => {
    for (const composePath of ['docker-compose.yml', 'docker-compose.server4.yml']) {
      const config = renderCompose(composePath);
      for (const service of ['game', 'api', 'platform']) {
        const alias = `${service}-legacy`;
        const networks = config.services[service]?.networks;
        expect(networks?.default?.aliases).toContain(alias);
        if (composePath === 'docker-compose.server4.yml') {
          expect(networks?.['1panel-network']?.aliases).toContain(alias);
        }
      }
    }
  });

  it('discovers every release slot without changing the dashboard job labels or legacy targets', () => {
    const game = scrapeJob('zutomayo-game');
    const api = scrapeJob('zutomayo-api');
    const platform = scrapeJob('zutomayo-platform');

    expectDnsDiscovery(game, ['game-blue', 'game-green'], 3000);
    expectDnsDiscovery(api, ['api-blue', 'api-green'], 3001);
    expectDnsDiscovery(
      platform,
      ['platform-blue-p1', 'platform-blue-p2', 'platform-green-p1', 'platform-green-p2'],
      3002,
    );

    expect(game).toContain("targets: ['game-legacy:3000']");
    expect(api).toContain("targets: ['api-legacy:3001']");
    expect(platform).toContain("targets: ['platform-legacy:3002']");
    for (const block of [game, api, platform]) {
      expect(block).toContain('release_slot: legacy');
      expect(block).toContain('process: legacy');
    }

    for (const jobName of ['zutomayo-game', 'zutomayo-api', 'zutomayo-platform']) {
      expect(prometheus.match(new RegExp(`job_name: '${jobName}'`, 'g'))).toHaveLength(1);
    }

    expectRelabel(game, 'game-(blue|green)', 'release_slot', "'$1'");
    expectRelabel(game, 'game-(blue|green)', 'service', 'game');
    expectRelabel(game, 'game-(blue|green)', 'process', 'replica');
    expectRelabel(api, 'api-(blue|green)', 'release_slot', "'$1'");
    expectRelabel(api, 'api-(blue|green)', 'service', 'api');
    expectRelabel(api, 'api-(blue|green)', 'process', 'replica');
    expectRelabel(platform, 'platform-(blue|green)-(p[12])', 'release_slot', "'$1'");
    expectRelabel(platform, 'platform-(blue|green)-(p[12])', 'service', 'platform');
    expectRelabel(platform, 'platform-(blue|green)-(p[12])', 'process', "'$2'");
  });

  it('probes each discovered process directly while retaining the legacy blackbox targets', () => {
    const health = scrapeJob('zutomayo-platform-health');
    const readiness = scrapeJob('zutomayo-readiness');

    expectDnsDiscovery(
      health,
      ['platform-blue-p1', 'platform-blue-p2', 'platform-green-p1', 'platform-green-p2'],
      3002,
    );
    expectDnsDiscovery(readiness, ['game-blue', 'game-green'], 3000);
    expectDnsDiscovery(readiness, ['api-blue', 'api-green'], 3001);
    expectDnsDiscovery(
      readiness,
      ['platform-blue-p1', 'platform-blue-p2', 'platform-green-p1', 'platform-green-p2'],
      3002,
    );

    expect(health).toContain("targets: ['http://platform-legacy:3002/health']");
    expect(health).toContain("replacement: 'http://$1/health'");
    expect(readiness).toContain("targets: ['http://game-legacy:3000/ready']");
    expect(readiness).toContain("targets: ['http://api-legacy:3001/ready']");
    expect(readiness).toContain("targets: ['http://platform-legacy:3002/ready']");
    expect(readiness).toContain("replacement: 'http://$1/ready'");
    for (const block of [health, readiness]) {
      expect(block).toContain('release_slot: legacy');
      expect(block).toContain('process: legacy');
    }

    for (const block of [health, readiness]) {
      expect(block).toContain('source_labels: [__meta_dns_name, __address__]');
      expect(block).toContain('replacement: blackbox-exporter:9115');
    }
    expectRelabel(health, 'platform-(blue|green)-(p[12])', 'release_slot', "'$1'");
    expectRelabel(health, 'platform-(blue|green)-(p[12])', 'service', 'platform');
    expectRelabel(health, 'platform-(blue|green)-(p[12])', 'process', "'$2'");
    expectRelabel(readiness, 'game-(blue|green)', 'process', 'replica');
    expectRelabel(readiness, 'api-(blue|green)', 'process', 'replica');
    expectRelabel(readiness, 'platform-(blue|green)-(p[12])', 'process', "'$2'");
  });

  it('alerts only when every visible target for a logical service is unavailable', () => {
    expect(alerts).toContain('expr: max by (job, service) (up{job=~"zutomayo-(game|api|platform)"}) == 0');
    expect(alerts).toContain('expr: max by (job, service) (probe_success{job="zutomayo-platform-health"}) == 0');
    expect(alerts).toContain('expr: max by (job, service) (probe_success{job="zutomayo-readiness"}) == 0');
  });
});
