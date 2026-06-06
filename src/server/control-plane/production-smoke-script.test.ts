import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
    skipCsrfProbe?: boolean;
    timeoutMs?: string;
  };
  parseEnvFile(content: string): Record<string, string>;
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
  };
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
        OU_UI_SMOKE_CSRF_PROBE: '0'
      },
      ['--insecure-tls']
    );

    expect(config).toMatchObject({
      username: 'operator_001',
      password: 'secret-password',
      timeoutMs: 5000,
      insecureTls: true,
      csrfProbe: false
    });
    expect(config.baseUrl.toString()).toBe('https://panel.example/secure/');
    expect(smokeScript.parseArgs(['--base-url', 'https://panel.example/p', '--skip-csrf-probe'])).toMatchObject({
      baseUrl: 'https://panel.example/p',
      skipCsrfProbe: true
    });
    expect(() => smokeScript.normalizeBaseUrl('https://user:password@panel.example/secure/')).toThrow(
      'OU_UI_SMOKE_BASE_URL 不能包含用户名或密码。'
    );
  });
});
