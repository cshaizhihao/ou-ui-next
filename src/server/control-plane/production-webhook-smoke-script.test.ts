import { createRequire } from 'node:module';
import { afterEach, vi } from 'vitest';

const require = createRequire(import.meta.url);

type ProductionWebhookSmokeScript = {
  createWebhookSmokePayload(): Record<string, unknown>;
  createWebhookSmokeReport(config: {
    urls: URL[];
    timeoutMs: number;
    allowLocal: boolean;
    bearerToken?: string;
  }): {
    schemaVersion: string;
    status: string;
    bearerTokenConfigured: boolean;
    targets: Array<Record<string, unknown>>;
  };
  isPrivateAddress(address: string): boolean;
  parseArgs(argv: string[]): {
    allowLocal?: boolean;
    bearerToken?: string;
    envFile?: string;
    help?: boolean;
    positional: string[];
    reportPath?: string;
    timeoutMs?: string;
    urls: string[];
  };
  parseEnvFile(content: string): Record<string, string>;
  resolveWebhookSmokeConfig(
    env: Record<string, string | undefined>,
    argv: string[]
  ): {
    urls: URL[];
    bearerToken?: string;
    timeoutMs: number;
    reportPath?: string;
    allowLocal: boolean;
    envFile?: string;
  };
  runWebhookSmoke(config: {
    urls: URL[];
    bearerToken?: string;
    timeoutMs: number;
    reportPath?: string;
    allowLocal: boolean;
  }): Promise<{
    schemaVersion: string;
    status: string;
    startedAt: string;
    completedAt: string;
    bearerTokenConfigured: boolean;
    targets: Array<Record<string, unknown>>;
  }>;
  sanitizeWebhookUrl(value: URL | string): string;
  splitCsv(value: string): string[];
};

const webhookSmokeScript = require('../../../scripts/production-webhook-smoke.cjs') as ProductionWebhookSmokeScript;

describe('production webhook smoke script helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves webhook targets from args and environment without exposing secrets in reports', () => {
    const config = webhookSmokeScript.resolveWebhookSmokeConfig(
      {
        OU_UI_SYSTEM_ALERT_WEBHOOK_URLS:
          'https://hooks.example.test/ou-ui/secret-path?token=secret-token,https://alerts.example.test/notify',
        OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN: 'secret-bearer-token',
        OU_UI_WEBHOOK_SMOKE_TIMEOUT_MS: '5000',
        OU_UI_WEBHOOK_SMOKE_REPORT_PATH: '/tmp/webhook-smoke.json'
      },
      []
    );

    expect(config.urls.map((url) => url.toString())).toEqual([
      'https://hooks.example.test/ou-ui/secret-path?token=secret-token',
      'https://alerts.example.test/notify'
    ]);
    expect(config).toMatchObject({
      bearerToken: 'secret-bearer-token',
      timeoutMs: 5000,
      reportPath: '/tmp/webhook-smoke.json',
      allowLocal: false
    });

    const report = webhookSmokeScript.createWebhookSmokeReport(config);
    const saved = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: 'ou-ui-next.production-webhook-smoke.v1',
      status: 'running',
      bearerTokenConfigured: true
    });
    expect(saved).toContain('https://hooks.example.test/[redacted-path]?[redacted]');
    expect(saved).toContain('https://alerts.example.test/[redacted-path]');
    expect(saved).not.toContain('secret-bearer-token');
    expect(saved).not.toContain('secret-token');
    expect(saved).not.toContain('/ou-ui/secret-path');
  });

  it('parses CLI flags, env files, and local-target policy helpers', () => {
    expect(
      webhookSmokeScript.parseArgs([
        '--url',
        'https://hooks.example.test/a',
        '--urls',
        'https://alerts.example.test/b, https://audit.example.test/c',
        '--allow-local',
        '--report',
        '/tmp/report.json'
      ])
    ).toMatchObject({
      urls: ['https://hooks.example.test/a', 'https://alerts.example.test/b', 'https://audit.example.test/c'],
      allowLocal: true,
      reportPath: '/tmp/report.json'
    });
    expect(webhookSmokeScript.parseEnvFile('OU_UI_SYSTEM_ALERT_WEBHOOK_URL=https://hooks.example.test/a\n')).toEqual({
      OU_UI_SYSTEM_ALERT_WEBHOOK_URL: 'https://hooks.example.test/a'
    });
    expect(webhookSmokeScript.splitCsv('a, b,,c')).toEqual(['a', 'b', 'c']);
    expect(webhookSmokeScript.isPrivateAddress('127.0.0.1')).toBe(true);
    expect(webhookSmokeScript.isPrivateAddress('10.0.0.1')).toBe(true);
    expect(webhookSmokeScript.isPrivateAddress('172.20.0.1')).toBe(true);
    expect(webhookSmokeScript.isPrivateAddress('192.168.1.10')).toBe(true);
    expect(webhookSmokeScript.isPrivateAddress('8.8.8.8')).toBe(false);
    expect(() => webhookSmokeScript.resolveWebhookSmokeConfig({}, [])).toThrow('缺少 webhook smoke URL');
    expect(() =>
      webhookSmokeScript.resolveWebhookSmokeConfig({}, ['--url', 'https://user:pass@hooks.example.test/a'])
    ).toThrow('webhook smoke URL 不能包含用户名或密码');
  });

  it('creates a sanitized payload shape for external webhook smoke delivery', () => {
    const payload = webhookSmokeScript.createWebhookSmokePayload();

    expect(payload).toMatchObject({
      schemaVersion: 'ou-ui-next.webhook-smoke.payload.v1',
      event: 'ou-ui-next.webhook_smoke',
      severity: 'info',
      message: 'OU-UI Next webhook smoke test',
      source: {
        tool: 'production-webhook-smoke'
      }
    });
    expect(String(payload.requestId)).toMatch(/^req-webhook-smoke-/);
  });

  it('records a per-target checkedAt timestamp after webhook delivery', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 202,
        text: async () => 'accepted'
      }))
    );

    const report = await webhookSmokeScript.runWebhookSmoke({
      urls: [new URL('https://127.0.0.1/ou-ui/secret-path?token=secret-token')],
      bearerToken: 'secret-bearer-token',
      timeoutMs: 5000,
      allowLocal: true
    });
    const target = report.targets[0];
    const checkedAt = Date.parse(String(target.checkedAt));

    expect(report).toMatchObject({
      schemaVersion: 'ou-ui-next.production-webhook-smoke.v1',
      status: 'passed',
      bearerTokenConfigured: true,
      targets: [
        {
          url: 'https://127.0.0.1/[redacted-path]?[redacted]',
          status: 'passed',
          httpStatus: 202,
          responseBytes: 8
        }
      ]
    });
    expect(String(target.checkedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(checkedAt).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    expect(checkedAt).toBeLessThanOrEqual(Date.parse(report.completedAt));
    expect(JSON.stringify(report)).not.toContain('secret-bearer-token');
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(JSON.stringify(report)).not.toContain('/ou-ui/secret-path');
  });
});
