import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

type RuntimeAcceptanceSummary = {
  agents: {
    total: number;
    byStatus: Record<string, number>;
    sessionCount: number;
    sessionsByStatus: Record<string, number>;
    runtimeCapabilitySessions: number;
  };
  runtime: {
    managedNodes: number;
    managedNodesByStatus: Record<string, number>;
    xrayInbounds: number;
    forwardingRules: number;
    forwardingRulesByPortStatus: Record<string, number>;
    forwardingPorts: number;
    allocatedForwardingPorts: number;
  };
  quotas: {
    policies: number;
    byScope: Record<string, number>;
    byEnforcementState: Record<string, number>;
    exceededOrDisabled: number;
  };
  traffic: {
    rollups: number;
    compactionBuckets: number;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    agentResultProofs: number;
  };
  alerts: {
    total: number;
    bySeverity: Record<string, number>;
    byKind: Record<string, number>;
  };
  commandOutbox: {
    backlog?: number;
    overdue?: number;
    deadLetters?: number;
  };
  audit: {
    valid?: boolean;
  };
};

type ProductionSmokeScript = {
  buildEndpointUrl(baseUrl: URL, endpointPath: string): string;
  createCookieHeader(setCookieValues: string[]): string;
  joinUrlPath(prefixPath: string, endpointPath: string): string;
  normalizeBaseUrl(value: string): URL;
  parseArgs(argv: string[]): {
    baseUrl?: string;
    credentialsFile?: string;
    help?: boolean;
    insecureTls?: boolean;
    positional: string[];
    requireRuntimeEvidence?: boolean;
    reportPath?: string;
    skipCsrfProbe?: boolean;
    timeoutMs?: string;
  };
  parseEnvFile(content: string): Record<string, string>;
  createRuntimeAcceptanceSummary(snapshot?: Record<string, unknown>, metrics?: Record<string, unknown>): RuntimeAcceptanceSummary;
  createSmokeReport(config: {
    baseUrl: URL;
    csrfProbe: boolean;
    insecureTls: boolean;
    requireRuntimeEvidence?: boolean;
  }): {
    schemaVersion: string;
    status: string;
    baseUrl: string;
    csrfProbeEnabled: boolean;
    insecureTls: boolean;
    runtimeEvidenceRequired: boolean;
    checks: Array<Record<string, unknown>>;
  };
  resolveSmokeConfig(
    env: Record<string, string | undefined>,
    argv: string[]
  ): {
    baseUrl: URL;
    username: string;
    password: string;
    timeoutMs: number;
    insecureTls: boolean;
    csrfProbe: boolean;
    requireRuntimeEvidence: boolean;
    reportPath?: string;
  };
  validateRuntimeAcceptanceSummary(summary: RuntimeAcceptanceSummary): string[];
  writeSmokeReport(reportPath: string, report: unknown): void;
};

const smokeScript = require('../../../scripts/production-smoke.cjs') as ProductionSmokeScript;

describe('production smoke script helpers', () => {
  it('builds endpoint URLs under installer secure paths', () => {
    const baseUrl = new URL('https://panel.example:8443/ou-secure/');

    expect(smokeScript.joinUrlPath('/ou-secure/', '/api/v1/snapshot')).toBe('/ou-secure/api/v1/snapshot');
    expect(smokeScript.buildEndpointUrl(baseUrl, '/events/v1/tasks?once=1')).toBe(
      'https://panel.example:8443/ou-secure/events/v1/tasks?once=1'
    );
    expect(smokeScript.buildEndpointUrl(new URL('http://127.0.0.1:4010'), '/metrics')).toBe(
      'http://127.0.0.1:4010/metrics'
    );
  });

  it('parses credential env files without leaking shell syntax into values', () => {
    expect(
      smokeScript.parseEnvFile(`
# generated credentials
export OU_UI_CONTROL_PLANE_OPERATOR_USERNAME="operator_001"
OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD='secret=value'
IGNORED_LINE
`)
    ).toEqual({
      OU_UI_CONTROL_PLANE_OPERATOR_USERNAME: 'operator_001',
      OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD: 'secret=value'
    });
  });

  it('creates a request Cookie header from Set-Cookie values only', () => {
    expect(
      smokeScript.createCookieHeader([
        'ou_ui_operator_session=opaque-session-token; Path=/panel; HttpOnly; SameSite=Lax',
        'other=value; Path=/'
      ])
    ).toBe('ou_ui_operator_session=opaque-session-token; other=value');
  });

  it('resolves config from environment and avoids password command-line flags', () => {
    const config = smokeScript.resolveSmokeConfig(
      {
        OU_UI_SMOKE_BASE_URL: 'https://panel.example/secure/',
        OU_UI_SMOKE_USERNAME: 'operator_001',
        OU_UI_SMOKE_PASSWORD: 'secret-password',
        OU_UI_SMOKE_CREDENTIALS_FILE: process.cwd(),
        OU_UI_SMOKE_TIMEOUT_MS: '5000',
        OU_UI_SMOKE_REPORT_PATH: '/tmp/ou-ui-smoke-report.json',
        OU_UI_SMOKE_CSRF_PROBE: '0',
        OU_UI_SMOKE_REQUIRE_RUNTIME_EVIDENCE: '1'
      },
      ['--insecure-tls']
    );

    expect(config).toMatchObject({
      username: 'operator_001',
      password: 'secret-password',
      timeoutMs: 5000,
      insecureTls: true,
      csrfProbe: false,
      requireRuntimeEvidence: true,
      reportPath: '/tmp/ou-ui-smoke-report.json'
    });
    expect(config.baseUrl.toString()).toBe('https://panel.example/secure/');
    expect(
      smokeScript.parseArgs([
        '--base-url',
        'https://panel.example/p',
        '--report',
        '/tmp/report.json',
        '--skip-csrf-probe',
        '--require-runtime-evidence'
      ])
    ).toMatchObject({
      baseUrl: 'https://panel.example/p',
      reportPath: '/tmp/report.json',
      skipCsrfProbe: true,
      requireRuntimeEvidence: true
    });
    expect(() => smokeScript.normalizeBaseUrl('https://user:password@panel.example/secure/')).toThrow(
      'OU_UI_SMOKE_BASE_URL 不能包含用户名或密码。'
    );
  });

  it('summarizes runtime acceptance evidence without leaking resource identifiers', () => {
    const summary = smokeScript.createRuntimeAcceptanceSummary(
      {
        agents: [{ id: 'agent-hkg-01', status: 'online' }],
        agentSessions: [
          {
            agentId: 'agent-hkg-01',
            sessionId: 'sess-secret-runtime-id',
            status: 'online',
            capabilities: ['host-agent', 'xray', 'port-forwarding']
          }
        ],
        nodes: [{ id: 'node-hkg-01', status: 'healthy' }],
        inbounds: [{ id: 'inbound-secret', protocol: 'vless' }],
        forwardRules: [
          {
            id: 'forward-secret',
            portStatus: 'allocated',
            ports: [
              {
                agentId: 'agent-hkg-01',
                listenPort: 2443,
                status: 'allocated'
              }
            ]
          }
        ],
        quotaPolicies: [{ id: 'quota-secret', scope: 'forward-rule', enforcementState: 'active' }],
        tasks: [{ id: 'task-secret', status: 'succeeded', proof: { source: 'agent-result' } }],
        systemAlerts: [{ id: 'alert-warning', severity: 'warning', kind: 'agent.high_latency' }],
        trafficRollups: [{ id: 'traffic-secret' }]
      },
      {
        commandOutbox: {
          backlog: 0,
          overdue: 0,
          deadLetters: 0
        },
        audit: {
          valid: true
        }
      }
    );

    expect(summary).toMatchObject({
      agents: {
        total: 1,
        sessionCount: 1,
        sessionsByStatus: { online: 1 },
        runtimeCapabilitySessions: 1
      },
      runtime: {
        xrayInbounds: 1,
        forwardingRules: 1,
        forwardingPorts: 1,
        allocatedForwardingPorts: 1
      },
      commandOutbox: {
        deadLetters: 0
      },
      quotas: {
        policies: 1,
        exceededOrDisabled: 0
      },
      audit: {
        valid: true
      }
    });
    expect(smokeScript.validateRuntimeAcceptanceSummary(summary)).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain('agent-hkg-01');
    expect(JSON.stringify(summary)).not.toContain('sess-secret-runtime-id');
    expect(JSON.stringify(summary)).not.toContain('forward-secret');
  });

  it('reports runtime acceptance gate failures for incomplete live deployments', () => {
    const summary = smokeScript.createRuntimeAcceptanceSummary(
      {
        agents: [{ id: 'agent-offline', status: 'offline' }],
        agentSessions: [{ agentId: 'agent-offline', status: 'offline' }],
        inbounds: [],
        forwardRules: [],
        quotaPolicies: [{ id: 'quota-exceeded', scope: 'forward-rule', enforcementState: 'exceeded' }],
        systemAlerts: [{ id: 'alert-critical', severity: 'critical', kind: 'agent.offline' }]
      },
      {
        commandOutbox: {
          backlog: 0,
          overdue: 0,
          deadLetters: 1
        },
        audit: {
          valid: false
        }
      }
    );

    expect(smokeScript.validateRuntimeAcceptanceSummary(summary)).toEqual([
      'runtime acceptance summary.audit.valid 未记录为 true',
      '缺少在线或降级可见的 Agent session',
      '缺少 Xray inbound 现场读模型',
      '缺少端口转发规则或监听端口现场读模型',
      '存在 critical 系统告警',
      '存在命令死信',
      '存在超限或因配额禁用的配额策略'
    ]);
  });

  it('writes sanitized smoke reports with owner-only permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-smoke-report-'));
    const reportPath = join(directory, 'nested', 'report.json');

    try {
      const report = smokeScript.createSmokeReport({
        baseUrl: new URL('https://panel.example/secure/'),
        csrfProbe: true,
        insecureTls: false,
        requireRuntimeEvidence: true
      });
      report.status = 'passed';
      report.checks.push({
        name: 'operator session login',
        status: 'passed',
        actor: 'operator:alice',
        checkedAt: '2026-06-06T00:00:00.000Z'
      });

      smokeScript.writeSmokeReport(reportPath, report);

      const saved = readFileSync(reportPath, 'utf8');
      expect(JSON.parse(saved)).toMatchObject({
        schemaVersion: 'ou-ui-next.production-smoke.v1',
        status: 'passed',
        baseUrl: 'https://panel.example/secure/',
        runtimeEvidenceRequired: true,
        checks: [expect.objectContaining({ name: 'operator session login' })]
      });
      expect(saved).not.toContain('secret-password');
      expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
