#!/usr/bin/env node

const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } = require('node:fs');
const { dirname } = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const defaultTimeoutMs = 15_000;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function parseArgs(argv) {
  const options = {
    urls: [],
    positional: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--url') {
      options.urls.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--urls') {
      options.urls.push(...splitCsv(argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg === '--env-file') {
      options.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--bearer-token') {
      options.bearerToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--bearer-token-file') {
      options.bearerTokenFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--report') {
      options.reportPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--allow-local') {
      options.allowLocal = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }

    options.positional.push(arg);
  }

  if (options.urls.length < 1 && options.positional.length > 0) {
    options.urls.push(...options.positional);
  }

  return options;
}

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1).trim();
    values[key] = unquoteEnvValue(rawValue);
  }

  return values;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readOptionalEnvFile(path) {
  if (!path || !existsSync(path)) {
    return {};
  }

  return parseEnvFile(readFileSync(path, 'utf8'));
}

function readOptionalSecretFile(path) {
  if (!path) {
    return undefined;
  }

  return readFileSync(path, 'utf8').trim();
}

function readPositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数。`);
  }

  return parsed;
}

function normalizeWebhookUrl(value) {
  const url = new URL(value);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('webhook smoke URL 只支持 http 或 https。');
  }
  if (url.username || url.password) {
    throw new Error('webhook smoke URL 不能包含用户名或密码。');
  }

  return url;
}

function sanitizeWebhookUrl(value) {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = url.search ? '?[redacted]' : '';
  url.pathname = url.pathname && url.pathname !== '/' ? '/[redacted-path]' : '/';
  return url.toString();
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map((item) => Number(item));
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return false;
}

function isLocalHostname(hostname) {
  const normalized = String(hostname ?? '').toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

async function assertWebhookTargetAllowed(url, allowLocal) {
  if (allowLocal) {
    return;
  }

  if (isLocalHostname(url.hostname) || isPrivateAddress(url.hostname)) {
    throw new Error('webhook smoke target is localhost/private/link-local and requires --allow-local');
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }).catch((error) => {
    throw new Error(`webhook smoke target DNS lookup failed: ${error.message}`);
  });
  const blocked = addresses.find((entry) => isPrivateAddress(entry.address));

  if (blocked) {
    throw new Error('webhook smoke target resolves to localhost/private/link-local and requires --allow-local');
  }
}

function resolveWebhookSmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const envFile = args.envFile ?? env.OU_UI_WEBHOOK_SMOKE_ENV_FILE;
  const envFileValues = readOptionalEnvFile(envFile);
  const mergedEnv = {
    ...envFileValues,
    ...env
  };
  const rawUrls = [
    ...args.urls,
    ...splitCsv(mergedEnv.OU_UI_WEBHOOK_SMOKE_URLS),
    ...splitCsv(mergedEnv.OU_UI_WEBHOOK_SMOKE_URL),
    ...splitCsv(mergedEnv.OU_UI_SYSTEM_ALERT_WEBHOOK_URLS),
    ...splitCsv(mergedEnv.OU_UI_SYSTEM_ALERT_WEBHOOK_URL)
  ].filter(Boolean);
  const urls = [...new Set(rawUrls)].map(normalizeWebhookUrl);
  const bearerToken =
    args.bearerToken ??
    readOptionalSecretFile(args.bearerTokenFile) ??
    mergedEnv.OU_UI_WEBHOOK_SMOKE_BEARER_TOKEN ??
    readOptionalSecretFile(mergedEnv.OU_UI_WEBHOOK_SMOKE_BEARER_TOKEN_FILE) ??
    mergedEnv.OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN;

  if (urls.length < 1) {
    throw new Error('缺少 webhook smoke URL。请使用 --url/--urls，或配置 OU_UI_SYSTEM_ALERT_WEBHOOK_URL(S)。');
  }

  return {
    urls,
    bearerToken,
    timeoutMs: readPositiveInteger(
      args.timeoutMs ?? mergedEnv.OU_UI_WEBHOOK_SMOKE_TIMEOUT_MS ?? mergedEnv.OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS,
      defaultTimeoutMs,
      'OU_UI_WEBHOOK_SMOKE_TIMEOUT_MS'
    ),
    reportPath: args.reportPath ?? mergedEnv.OU_UI_WEBHOOK_SMOKE_REPORT_PATH,
    allowLocal: Boolean(args.allowLocal) || parseBoolean(mergedEnv.OU_UI_WEBHOOK_SMOKE_ALLOW_LOCAL),
    envFile
  };
}

function createWebhookSmokePayload() {
  return {
    schemaVersion: 'ou-ui-next.webhook-smoke.payload.v1',
    event: 'ou-ui-next.webhook_smoke',
    createdAt: new Date().toISOString(),
    requestId: `req-webhook-smoke-${randomUUID()}`,
    severity: 'info',
    message: 'OU-UI Next webhook smoke test',
    source: {
      tool: 'production-webhook-smoke'
    }
  };
}

function createWebhookSmokeReport(config) {
  return {
    schemaVersion: 'ou-ui-next.production-webhook-smoke.v1',
    status: 'running',
    startedAt: new Date().toISOString(),
    timeoutMs: config.timeoutMs,
    allowLocal: config.allowLocal,
    bearerTokenConfigured: Boolean(config.bearerToken),
    targets: config.urls.map((url, index) => ({
      index: index + 1,
      url: sanitizeWebhookUrl(url),
      status: 'pending'
    }))
  };
}

function markWebhookSmokeReportComplete(report, status, details = {}) {
  report.status = status;
  report.completedAt = new Date().toISOString();
  Object.assign(report, compactObject(details));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function writeWebhookSmokeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(reportPath, 0o600);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'POST',
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`请求超时：${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWebhookSmoke(config) {
  const report = createWebhookSmokeReport(config);

  try {
    const payload = createWebhookSmokePayload();

    for (let index = 0; index < config.urls.length; index += 1) {
      const url = config.urls[index];
      const target = report.targets[index];

      await assertWebhookTargetAllowed(url, config.allowLocal);
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OU-UI-Next-Webhook-Smoke/1',
            'X-Request-Id': payload.requestId,
            ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {})
          },
          body: JSON.stringify({
            ...payload,
            targetIndex: index + 1
          })
        },
        config.timeoutMs
      );
      const responseText = await response.text();

      target.checkedAt = new Date().toISOString();
      target.httpStatus = response.status;
      target.status = response.ok ? 'passed' : 'failed';
      target.responseBytes = Buffer.byteLength(responseText);

      if (!response.ok) {
        target.error = `HTTP ${response.status}`;
        throw new Error(`webhook smoke target ${index + 1} failed with HTTP ${response.status}`);
      }

      process.stdout.write(`PASS webhook target ${index + 1} - HTTP ${response.status}\n`);
    }

    markWebhookSmokeReportComplete(report, 'passed');

    if (config.reportPath) {
      writeWebhookSmokeReport(config.reportPath, report);
      process.stdout.write(`PASS webhook smoke report - ${config.reportPath}\n`);
    }

    return report;
  } catch (error) {
    markWebhookSmokeReportComplete(report, 'failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    if (config.reportPath) {
      writeWebhookSmokeReport(config.reportPath, report);
    }

    throw error;
  }
}

function printHelp() {
  process.stdout.write(`OU-UI Next webhook smoke

Usage:
  node scripts/production-webhook-smoke.cjs --url https://hooks.example.test/ou-ui-alerts
  OU_UI_WEBHOOK_SMOKE_ENV_FILE=/etc/ou-ui-next/master.env node scripts/production-webhook-smoke.cjs

Options:
  --url <url>                    Webhook endpoint to POST a test payload to; can be repeated
  --urls <csv>                   Comma-separated webhook endpoints
  --env-file <path>              Read OU_UI_SYSTEM_ALERT_WEBHOOK_URL(S) and bearer token from env file
  --bearer-token <token>         Bearer token for test delivery; never written to reports
  --bearer-token-file <path>     Read bearer token from a root-only file
  --timeout-ms <ms>              Single target timeout, default ${defaultTimeoutMs}
  --report <path>                Write sanitized JSON webhook smoke report
  --allow-local                  Allow localhost/private/link-local targets for lab-only tests
`);
}

if (require.main === module) {
  (async () => {
    try {
      const config = resolveWebhookSmokeConfig();

      if (config.help) {
        printHelp();
        return;
      }

      await runWebhookSmoke(config);
    } catch (error) {
      process.stderr.write(`FAIL webhook smoke: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  createWebhookSmokePayload,
  createWebhookSmokeReport,
  isPrivateAddress,
  parseArgs,
  parseEnvFile,
  resolveWebhookSmokeConfig,
  runWebhookSmoke,
  sanitizeWebhookUrl,
  splitCsv
};
