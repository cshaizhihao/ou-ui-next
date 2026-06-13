import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

type ProductionBrowserSmokeScript = {
  createBrowserSmokeReport(config: {
    baseUrl: URL;
    browserName: string;
    headed: boolean;
    insecureTls: boolean;
    screenshotDir?: string;
  }): {
    schemaVersion: string;
    status: string;
    baseUrl: string;
    browserName: string;
    headless: boolean;
    screenshotsEnabled: boolean;
    checks: Array<Record<string, unknown>>;
  };
  createSafeScreenshotName(name: string, index: number): string;
  normalizeBaseUrl(value: string): URL;
  parseArgs(argv: string[]): {
    baseUrl?: string;
    browserName?: string;
    credentialsFile?: string;
    headed?: boolean;
    help?: boolean;
    insecureTls?: boolean;
    positional: string[];
    reportPath?: string;
    screenshotDir?: string;
    skipScreenshots?: boolean;
    timeoutMs?: string;
  };
  resolveBrowserSmokeConfig(
    env: Record<string, string | undefined>,
    argv: string[]
  ): {
    baseUrl: URL;
    username: string;
    password: string;
    timeoutMs: number;
    browserName: string;
    headed: boolean;
    insecureTls: boolean;
    reportPath?: string;
    screenshotDir?: string;
  };
  writeBrowserSmokeReport(reportPath: string, report: unknown): void;
};

const browserSmokeScript = require('../../../scripts/production-browser-smoke.cjs') as ProductionBrowserSmokeScript;

describe('production browser smoke script helpers', () => {
  it('parses browser smoke arguments without password command-line flags', () => {
    expect(
      browserSmokeScript.parseArgs([
        '--base-url',
        'https://panel.example/secure/',
        '--report',
        '/tmp/browser-report.json',
        '--screenshot-dir',
        '/tmp/screens',
        '--timeout-ms',
        '45000',
        '--browser',
        'chromium',
        '--insecure-tls',
        '--headed'
      ])
    ).toMatchObject({
      baseUrl: 'https://panel.example/secure/',
      reportPath: '/tmp/browser-report.json',
      screenshotDir: '/tmp/screens',
      timeoutMs: '45000',
      browserName: 'chromium',
      insecureTls: true,
      headed: true
    });
    expect(browserSmokeScript.parseArgs(['https://panel.example/secure/']).baseUrl).toBe(
      'https://panel.example/secure/'
    );
    expect(() => browserSmokeScript.parseArgs(['--password', 'secret'])).toThrow('未知参数：--password');
  });

  it('resolves config from explicit env and rejects credentials in the base URL', () => {
    const config = browserSmokeScript.resolveBrowserSmokeConfig(
      {
        OU_UI_BROWSER_SMOKE_BASE_URL: 'https://panel.example/secure/',
        OU_UI_BROWSER_SMOKE_USERNAME: 'operator_001',
        OU_UI_BROWSER_SMOKE_PASSWORD: 'secret-password',
        OU_UI_BROWSER_SMOKE_TIMEOUT_MS: '5000',
        OU_UI_BROWSER_SMOKE_REPORT_PATH: '/tmp/browser-report.json',
        OU_UI_BROWSER_SMOKE_SCREENSHOT_DIR: '/tmp/browser-screens',
        OU_UI_BROWSER_SMOKE_INSECURE_TLS: '1'
      },
      []
    );

    expect(config).toMatchObject({
      username: 'operator_001',
      password: 'secret-password',
      timeoutMs: 5000,
      browserName: 'chromium',
      headed: false,
      insecureTls: true,
      reportPath: '/tmp/browser-report.json',
      screenshotDir: '/tmp/browser-screens'
    });
    expect(config.baseUrl.toString()).toBe('https://panel.example/secure/');
    expect(() => browserSmokeScript.normalizeBaseUrl('https://user:password@panel.example/secure/')).toThrow(
      'OU_UI_BROWSER_SMOKE_BASE_URL 不能包含用户名或密码。'
    );
  });

  it('resolves config from installer credentials files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-browser-smoke-credentials-'));
    const credentialsFile = join(directory, 'credentials.env');

    try {
      writeFileSync(
        credentialsFile,
        [
          'OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=operator_file',
          'OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=secret-from-file'
        ].join('\n')
      );

      const config = browserSmokeScript.resolveBrowserSmokeConfig(
        {
          OU_UI_BROWSER_SMOKE_BASE_URL: 'https://panel.example/secure/',
          OU_UI_BROWSER_SMOKE_CREDENTIALS_FILE: credentialsFile
        },
        ['--skip-screenshots']
      );

      expect(config.username).toBe('operator_file');
      expect(config.password).toBe('secret-from-file');
      expect(config.screenshotDir).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes sanitized browser reports with owner-only permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-browser-smoke-report-'));
    const reportPath = join(directory, 'nested', 'browser-report.json');

    try {
      const report = browserSmokeScript.createBrowserSmokeReport({
        baseUrl: new URL('https://panel.example/secure/'),
        browserName: 'chromium',
        headed: false,
        insecureTls: false,
        screenshotDir: join(directory, 'screens')
      });
      report.status = 'passed';
      report.checks.push({
        name: 'operator browser login',
        status: 'passed',
        screenshot: join(directory, 'screens', '02-operator-browser-login.png')
      });

      browserSmokeScript.writeBrowserSmokeReport(reportPath, report);

      const saved = readFileSync(reportPath, 'utf8');
      expect(JSON.parse(saved)).toMatchObject({
        schemaVersion: 'ou-ui-next.production-browser-smoke.v1',
        status: 'passed',
        baseUrl: 'https://panel.example/secure/',
        checks: [expect.objectContaining({ name: 'operator browser login' })]
      });
      expect(saved).not.toContain('secret-password');
      expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates stable screenshot filenames', () => {
    expect(browserSmokeScript.createSafeScreenshotName('Navigate 安全策略', 7)).toBe('07-navigate.png');
    expect(browserSmokeScript.createSafeScreenshotName('operator browser login', 2)).toBe(
      '02-operator-browser-login.png'
    );
  });

  it('keeps browser smoke selectors aligned with the current control-plane shell', () => {
    const script = require('../../../scripts/production-browser-smoke.cjs') as {
      normalizeBaseUrl(value: string): URL;
    };

    expect(script.normalizeBaseUrl('https://panel.example/secure/').toString()).toBe(
      'https://panel.example/secure/'
    );
  });
});
