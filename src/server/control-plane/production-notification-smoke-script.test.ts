import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

type ProductionNotificationSmokeScript = {
  buildEndpointUrl(baseUrl: URL, endpointPath: string): string;
  createCookieHeader(setCookieValues: string[]): string;
  joinUrlPath(prefixPath: string, endpointPath: string): string;
  normalizeBaseUrl(value: string): URL;
  parseArgs(argv: string[]): {
    baseUrl?: string;
    credentialsFile?: string;
    help?: boolean;
    insecureTls?: boolean;
    language?: string;
    positional: string[];
    reportPath?: string;
    telegramAdminChatId?: string;
    telegramBindingId?: string;
    timeoutMs?: string;
  };
  parseEnvFile(content: string): Record<string, string>;
  redactSensitiveFragments(value: unknown, sensitiveValues?: string[]): string;
  createNotificationSmokeReport(config: {
    baseUrl: URL;
    insecureTls: boolean;
    telegramTarget: { kind: 'admin-chat'; chatId: string } | { kind: 'binding'; bindingId: string };
  }): {
    schemaVersion: string;
    status: string;
    baseUrl: string;
    telegramTarget: { kind: string };
    checks: Array<Record<string, unknown>>;
  };
  resolveNotificationSmokeConfig(
    env: Record<string, string | undefined>,
    argv: string[]
  ): {
    baseUrl: URL;
    username: string;
    password: string;
    timeoutMs: number;
    insecureTls: boolean;
    reportPath?: string;
    telegramTarget: { kind: 'admin-chat'; chatId: string } | { kind: 'binding'; bindingId: string };
    language?: string;
  };
  sanitizeErrorMessage(error: unknown, sensitiveValues?: string[]): string;
  sanitizeTelegramDelivery(delivery: Record<string, unknown>, sensitiveValues?: string[]): Record<string, unknown>;
  writeNotificationSmokeReport(reportPath: string, report: unknown): void;
};

const notificationSmokeScript = require('../../../scripts/production-notification-smoke.cjs') as ProductionNotificationSmokeScript;

describe('production notification smoke script helpers', () => {
  it('builds endpoint URLs under installer secure paths', () => {
    const baseUrl = new URL('https://panel.example:8443/ou-secure/');

    expect(notificationSmokeScript.joinUrlPath('/ou-secure/', '/api/v1/integrations/telegram-bot/test')).toBe(
      '/ou-secure/api/v1/integrations/telegram-bot/test'
    );
    expect(notificationSmokeScript.buildEndpointUrl(baseUrl, '/api/v1/integrations/telegram-bot/settings')).toBe(
      'https://panel.example:8443/ou-secure/api/v1/integrations/telegram-bot/settings'
    );
  });

  it('resolves config from environment and requires exactly one Telegram target', () => {
    const config = notificationSmokeScript.resolveNotificationSmokeConfig(
      {
        OU_UI_NOTIFICATION_SMOKE_BASE_URL: 'https://panel.example/secure/',
        OU_UI_NOTIFICATION_SMOKE_USERNAME: 'operator_001',
        OU_UI_NOTIFICATION_SMOKE_PASSWORD: 'secret-password',
        OU_UI_NOTIFICATION_SMOKE_CREDENTIALS_FILE: process.cwd(),
        OU_UI_NOTIFICATION_SMOKE_TIMEOUT_MS: '5000',
        OU_UI_NOTIFICATION_SMOKE_REPORT_PATH: '/tmp/ou-ui-notification-smoke-report.json',
        OU_UI_NOTIFICATION_SMOKE_TELEGRAM_ADMIN_CHAT_ID: '999000111',
        OU_UI_NOTIFICATION_SMOKE_LANGUAGE: 'en'
      },
      ['--insecure-tls']
    );

    expect(config).toMatchObject({
      username: 'operator_001',
      password: 'secret-password',
      timeoutMs: 5000,
      insecureTls: true,
      reportPath: '/tmp/ou-ui-notification-smoke-report.json',
      telegramTarget: {
        kind: 'admin-chat',
        chatId: '999000111'
      },
      language: 'en'
    });
    expect(config.baseUrl.toString()).toBe('https://panel.example/secure/');
    expect(
      notificationSmokeScript.parseArgs([
        '--base-url',
        'https://panel.example/p',
        '--report',
        '/tmp/report.json',
        '--telegram-binding-id',
        'binding-001',
        '--language',
        'zh'
      ])
    ).toMatchObject({
      baseUrl: 'https://panel.example/p',
      reportPath: '/tmp/report.json',
      telegramBindingId: 'binding-001',
      language: 'zh'
    });
    expect(() =>
      notificationSmokeScript.resolveNotificationSmokeConfig(
        {
          OU_UI_NOTIFICATION_SMOKE_BASE_URL: 'https://panel.example/secure/',
          OU_UI_NOTIFICATION_SMOKE_USERNAME: 'operator_001',
          OU_UI_NOTIFICATION_SMOKE_PASSWORD: 'secret-password',
          OU_UI_NOTIFICATION_SMOKE_CREDENTIALS_FILE: process.cwd()
        },
        []
      )
    ).toThrow('缺少 Telegram 测试目标');
    expect(() => notificationSmokeScript.normalizeBaseUrl('https://user:password@panel.example/secure/')).toThrow(
      'OU_UI_NOTIFICATION_SMOKE_BASE_URL 不能包含用户名或密码。'
    );
  });

  it('sanitizes Telegram delivery reports without chat ids or binding ids', () => {
    const sanitized = notificationSmokeScript.sanitizeTelegramDelivery({
      id: 'telegram-delivery-001',
      notificationType: 'test.notification',
      recipientKind: 'admin-chat',
      adminChatId: '999000111',
      chatBindingId: 'telegram-binding-secret',
      customerBindingId: 'customer-binding-secret',
      status: 'delivered',
      attemptCount: 1,
      maxAttempts: 3,
      renderedPreviewRedacted: 'Test notification: Telegram Bot is connected to OU-UI Next.',
      lastErrorMessage: 'Telegram API rejected chat 999000111 for binding telegram-binding-secret',
      payloadHash: 'payload-secret-hash'
    }, ['999000111', 'telegram-binding-secret', 'customer-binding-secret']);

    expect(sanitized).toMatchObject({
      id: 'telegram-delivery-001',
      notificationType: 'test.notification',
      recipientKind: 'admin-chat',
      status: 'delivered',
      attemptCount: 1,
      maxAttempts: 3,
      hasAdminChat: true,
      hasChatBinding: true,
      hasCustomerBinding: true,
      lastErrorMessage: 'Telegram API rejected chat [redacted] for binding [redacted]'
    });
    expect(JSON.stringify(sanitized)).not.toContain('999000111');
    expect(JSON.stringify(sanitized)).not.toContain('telegram-binding-secret');
    expect(JSON.stringify(sanitized)).not.toContain('customer-binding-secret');
    expect(JSON.stringify(sanitized)).not.toContain('payload-secret-hash');
    expect(notificationSmokeScript.sanitizeErrorMessage(new Error('delivery failed for 999000111'), ['999000111'])).toBe(
      'delivery failed for [redacted]'
    );
  });

  it('writes notification smoke reports with owner-only permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-notification-smoke-report-'));
    const reportPath = join(directory, 'nested', 'report.json');

    try {
      const report = notificationSmokeScript.createNotificationSmokeReport({
        baseUrl: new URL('https://panel.example/secure/'),
        insecureTls: false,
        telegramTarget: {
          kind: 'admin-chat',
          chatId: '999000111'
        }
      });
      report.status = 'passed';
      report.checks.push({
        name: 'telegram test notification',
        status: 'passed',
        checkedAt: '2026-06-06T00:00:00.000Z',
        delivery: notificationSmokeScript.sanitizeTelegramDelivery({
          adminChatId: '999000111',
          status: 'delivered'
        })
      });

      notificationSmokeScript.writeNotificationSmokeReport(reportPath, report);

      const saved = readFileSync(reportPath, 'utf8');
      expect(JSON.parse(saved)).toMatchObject({
        schemaVersion: 'ou-ui-next.production-notification-smoke.v1',
        status: 'passed',
        telegramTarget: {
          kind: 'admin-chat'
        },
        checks: [expect.objectContaining({ name: 'telegram test notification' })]
      });
      expect(saved).not.toContain('secret-password');
      expect(saved).not.toContain('999000111');
      expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
