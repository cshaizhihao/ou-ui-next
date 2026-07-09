import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

type Local4174DeployScript = {
  buildSmokeTargets(config: { localUrl: URL; publicUrl?: URL }): URL[];
  compactTrafficRollupsForLocalReview<T extends { id: string; observedAt: string }>(
    trafficRollups: T[],
    maxRecordsPerScope: number
  ): T[];
  createBackendSystemdRunArgs(config: Record<string, boolean | string | number | URL>): string[];
  createStaticSystemdRunArgs(config: Record<string, boolean | string | number | URL>): string[];
  getBackendEnvPairs(config: Record<string, boolean | string | number | URL>): Array<[string, string]>;
  parseArgs(argv: string[]): {
    backendPort?: string;
    command?: string;
    publicUrl?: string;
    skipPublic?: boolean;
    smoke?: boolean;
    staticPort?: string;
    timeoutMs?: string;
    username?: string;
  };
  resolveLocalDeployConfig(
    env: Record<string, string | undefined>,
    cwd: string,
    argv: string[]
  ): {
    appDir: string;
    backendCpuQuota: string;
    backendEnvFile: string;
    command: string;
    compactRollupsOnStart: boolean;
    localUrl: URL;
    password: string;
    publicUrl?: URL;
    shouldRunSmoke: boolean;
    sqliteFile: string;
    staticCpuQuota: string;
    staticProxyEntry: string;
    trafficRollupMaxRecordsPerScope: number;
    username: string;
  };
};

const local4174DeployScript = require('../../../scripts/local-4174-deploy.cjs') as Local4174DeployScript;

function createConfig() {
  const appDir = process.cwd();

  return {
    appDir,
    backendEntry: join(appDir, 'dist-server/http-control-plane-main.js'),
    backendEnvFile: join(appDir, 'diagnostics/local-deploy/local-4174-backend.env'),
    backendHost: '127.0.0.1',
    backendPort: 4010,
    backendCpuQuota: '30%',
    backendUrl: new URL('http://127.0.0.1:4010'),
    compactRollupsOnStart: true,
    nodePath: '/usr/bin/node',
    operatorToken: 'operator-token-secret',
    password: 'admin-password',
    sessionSecret: 'session-secret',
    sqliteFile: join(appDir, 'diagnostics/local-deploy/control-plane.sqlite'),
    staticHost: '0.0.0.0',
    staticCpuQuota: '15%',
    staticPort: 4174,
    staticProxyEntry: join(appDir, 'scripts/static-panel-proxy.cjs'),
    staticRoot: join(appDir, 'dist'),
    trafficRollupMaxRecordsPerScope: 200,
    username: 'admin'
  };
}

describe('local 4174 deploy script helpers', () => {
  it('parses commands without accepting password command-line flags', () => {
    expect(
      local4174DeployScript.parseArgs([
        'restart',
        '--smoke',
        '--public-url',
        'http://172.93.187.112:4174/',
        '--timeout-ms',
        '45000',
        '--username',
        'admin'
      ])
    ).toMatchObject({
      command: 'restart',
      publicUrl: 'http://172.93.187.112:4174/',
      smoke: true,
      timeoutMs: '45000',
      username: 'admin'
    });
    expect(local4174DeployScript.parseArgs(['smoke', '--skip-public'])).toMatchObject({
      command: 'smoke',
      skipPublic: true
    });
    expect(() => local4174DeployScript.parseArgs(['--password', 'secret'])).toThrow('未知参数：--password');
  });

  it('defaults to the persistent local review sqlite file instead of an empty in-memory state', () => {
    const config = local4174DeployScript.resolveLocalDeployConfig(
      {
        OU_UI_LOCAL_4174_PUBLIC_URL: 'http://panel.example:4174/',
        OU_UI_LOCAL_4174_PASSWORD: 'admin-password'
      },
      process.cwd(),
      ['restart', '--smoke']
    );

    expect(config.command).toBe('restart');
    expect(config.shouldRunSmoke).toBe(true);
    expect(config.username).toBe('admin');
    expect(config.password).toBe('admin-password');
    expect(config.sqliteFile).toBe(join(process.cwd(), 'diagnostics/local-deploy/control-plane.sqlite'));
    expect(config.staticProxyEntry).toBe(join(process.cwd(), 'scripts/static-panel-proxy.cjs'));
    expect(config.publicUrl?.toString()).toBe('http://panel.example:4174/');
    expect(config.backendCpuQuota).toBe('30%');
    expect(config.staticCpuQuota).toBe('15%');
    expect(config.compactRollupsOnStart).toBe(true);
    expect(config.trafficRollupMaxRecordsPerScope).toBe(200);
  });

  it('allows local review resource knobs to be overridden explicitly', () => {
    const config = local4174DeployScript.resolveLocalDeployConfig(
      {
        OU_UI_LOCAL_4174_BACKEND_CPU_QUOTA: '45%',
        OU_UI_LOCAL_4174_COMPACT_ROLLUPS_ON_START: 'false',
        OU_UI_LOCAL_4174_STATIC_CPU_QUOTA: '20%',
        OU_UI_LOCAL_4174_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE: '75'
      },
      process.cwd(),
      ['restart']
    );

    expect(config.backendCpuQuota).toBe('45%');
    expect(config.staticCpuQuota).toBe('20%');
    expect(config.compactRollupsOnStart).toBe(false);
    expect(config.trafficRollupMaxRecordsPerScope).toBe(75);
  });

  it('keeps backend secrets out of systemd-run arguments and writes them through an env file contract', () => {
    const config = createConfig();
    const args = local4174DeployScript.createBackendSystemdRunArgs(config);
    const backendEnvPairs = local4174DeployScript.getBackendEnvPairs(config);

    expect(args).toContain('--property=EnvironmentFile=' + config.backendEnvFile);
    expect(args.join(' ')).not.toContain('admin-password');
    expect(args.join(' ')).not.toContain('session-secret');
    expect(args.join(' ')).not.toContain('operator-token-secret');
    expect(args).toContain('--property=CPUQuota=30%');
    expect(backendEnvPairs).toContainEqual(['OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD', 'admin-password']);
    expect(backendEnvPairs).toContainEqual(['OU_UI_CONTROL_PLANE_STORAGE', 'sqlite']);
    expect(backendEnvPairs).toContainEqual(['OU_UI_CONTROL_PLANE_SQLITE_FILE', config.sqliteFile]);
    expect(backendEnvPairs).toContainEqual(['OU_UI_AGENT_EVENT_HIGH_FREQUENCY_PERSIST_EVERY', '30']);
    expect(backendEnvPairs).toContainEqual(['OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE', '200']);
    expect(backendEnvPairs).toContainEqual(['OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS', '90000']);
  });

  it('starts the tracked static proxy script and builds local plus public smoke targets', () => {
    const config = createConfig();
    const args = local4174DeployScript.createStaticSystemdRunArgs(config);

    expect(args).toContain(join(process.cwd(), 'scripts/static-panel-proxy.cjs'));
    expect(args).toContain('--setenv=OU_UI_STATIC_HOST=0.0.0.0');
    expect(args).toContain('--setenv=OU_UI_STATIC_PORT=4174');
    expect(args).toContain('--property=CPUQuota=15%');
    expect(
      local4174DeployScript
        .buildSmokeTargets({
          localUrl: new URL('http://127.0.0.1:4174/'),
          publicUrl: new URL('http://172.93.187.112:4174/')
        })
        .map((target) => target.toString())
    ).toEqual(['http://127.0.0.1:4174/', 'http://172.93.187.112:4174/']);
  });

  it('compacts local review traffic rollups by keeping the newest samples per scope', () => {
    const rollups = [
      {
        id: 'scope-a-old',
        agentId: 'agent-a',
        dimension: 'agent',
        observedAt: '2026-01-01T00:00:00.000Z',
        subjectId: 'agent-a'
      },
      {
        id: 'scope-a-new',
        agentId: 'agent-a',
        dimension: 'agent',
        observedAt: '2026-01-02T00:00:00.000Z',
        subjectId: 'agent-a'
      },
      {
        id: 'scope-b-old',
        agentId: 'agent-a',
        dimension: 'xray-client',
        observedAt: '2026-01-01T00:00:00.000Z',
        subjectId: 'client-b'
      },
      {
        id: 'scope-b-new',
        agentId: 'agent-a',
        dimension: 'xray-client',
        observedAt: '2026-01-03T00:00:00.000Z',
        subjectId: 'client-b'
      }
    ];

    expect(local4174DeployScript.compactTrafficRollupsForLocalReview(rollups, 1).map((rollup) => rollup.id)).toEqual([
      'scope-a-new',
      'scope-b-new'
    ]);
  });
});
