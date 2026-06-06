#!/usr/bin/env node

const { randomUUID } = require('node:crypto');
const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');

const defaultCredentialsFile = '/etc/ou-ui-next/credentials.env';
const defaultTimeoutMs = 15_000;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function parseArgs(argv) {
  const options = {
    positional: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--credentials-file') {
      options.credentialsFile = argv[index + 1];
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

    if (arg === '--insecure-tls') {
      options.insecureTls = true;
      continue;
    }

    if (arg === '--skip-csrf-probe') {
      options.skipCsrfProbe = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }

    options.positional.push(arg);
  }

  if (!options.baseUrl && options.positional.length > 0) {
    options.baseUrl = options.positional[0];
  }

  return options;
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

function resolveSmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const credentialsFile = args.credentialsFile ?? env.OU_UI_SMOKE_CREDENTIALS_FILE ?? defaultCredentialsFile;
  const baseUrl = args.baseUrl ?? env.OU_UI_SMOKE_BASE_URL ?? env.OU_UI_PANEL_URL;
  const explicitUsername = env.OU_UI_SMOKE_USERNAME;
  const explicitPassword = env.OU_UI_SMOKE_PASSWORD ?? readOptionalSecretFile(env.OU_UI_SMOKE_PASSWORD_FILE);
  const credentials = explicitUsername && explicitPassword ? {} : readOptionalEnvFile(credentialsFile);
  const username = explicitUsername ?? credentials.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME ?? credentials.OU_UI_SMOKE_USERNAME;
  const password = explicitPassword ?? credentials.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD ?? credentials.OU_UI_SMOKE_PASSWORD;

  if (!baseUrl) {
    throw new Error('缺少 OU_UI_SMOKE_BASE_URL，或使用 --base-url 指定面板地址。');
  }

  if (!username || !password) {
    throw new Error('缺少烟测登录凭据。请设置 OU_UI_SMOKE_USERNAME / OU_UI_SMOKE_PASSWORD，或指定安装器生成的 credentials 文件。');
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    username,
    password,
    credentialsFile,
    timeoutMs: readPositiveInteger(args.timeoutMs ?? env.OU_UI_SMOKE_TIMEOUT_MS, defaultTimeoutMs, 'OU_UI_SMOKE_TIMEOUT_MS'),
    insecureTls: Boolean(args.insecureTls) || parseBoolean(env.OU_UI_SMOKE_INSECURE_TLS),
    csrfProbe: !args.skipCsrfProbe && env.OU_UI_SMOKE_CSRF_PROBE !== '0',
    reportPath: args.reportPath ?? env.OU_UI_SMOKE_REPORT_PATH
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OU_UI_SMOKE_BASE_URL 只支持 http 或 https。');
  }

  if (url.username || url.password) {
    throw new Error('OU_UI_SMOKE_BASE_URL 不能包含用户名或密码。');
  }

  url.hash = '';
  url.search = '';

  return url;
}

function joinUrlPath(prefixPath, endpointPath) {
  const prefix = prefixPath.replace(/\/+$/, '');
  const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;

  if (!prefix || prefix === '/') {
    return endpoint;
  }

  return `${prefix}${endpoint}`;
}

function buildEndpointUrl(baseUrl, endpointPath) {
  const endpoint = new URL(endpointPath, 'http://ou-ui-smoke.invalid');
  const url = new URL(baseUrl.toString());
  url.pathname = joinUrlPath(url.pathname, endpoint.pathname);
  url.search = endpoint.search;
  url.hash = '';

  return url.toString();
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function createCookieHeader(setCookieValues) {
  return setCookieValues
    .map((value) => value.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      redirect: 'manual',
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

async function readResponsePayload(response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') && text) {
    return {
      text,
      json: JSON.parse(text)
    };
  }

  return { text };
}

function responseErrorSummary(payload) {
  const error = payload.json?.error;

  if (error && typeof error === 'object') {
    return [error.code, error.message].filter(Boolean).join(': ');
  }

  if (payload.text) {
    return payload.text.replace(/\s+/g, ' ').slice(0, 180);
  }

  return 'empty response';
}

function assertStatus(label, response, payload, expectedStatuses) {
  if (expectedStatuses.includes(response.status)) {
    return;
  }

  throw new Error(`${label} HTTP ${response.status}，期望 ${expectedStatuses.join('/')}：${responseErrorSummary(payload)}`);
}

function assertJsonData(label, payload) {
  if (!payload.json || !Object.prototype.hasOwnProperty.call(payload.json, 'data')) {
    throw new Error(`${label} 响应不是标准 API envelope。`);
  }

  return payload.json.data;
}

async function requestJson(config, context, method, endpointPath, options = {}) {
  const response = await fetchWithTimeout(
    buildEndpointUrl(config.baseUrl, endpointPath),
    {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(context.cookieHeader ? { Cookie: context.cookieHeader } : {}),
        ...(options.headers ?? {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    },
    config.timeoutMs
  );
  const payload = await readResponsePayload(response);

  return { response, payload };
}

async function requestText(config, context, method, endpointPath, options = {}) {
  const response = await fetchWithTimeout(
    buildEndpointUrl(config.baseUrl, endpointPath),
    {
      method,
      headers: {
        Accept: options.accept ?? 'text/plain',
        ...(context.cookieHeader ? { Cookie: context.cookieHeader } : {}),
        ...(options.headers ?? {})
      }
    },
    config.timeoutMs
  );
  const text = await response.text();

  return { response, text };
}

function logPass(label, detail) {
  process.stdout.write(`PASS ${label}${detail ? ` - ${detail}` : ''}\n`);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function createSmokeReport(config) {
  return {
    schemaVersion: 'ou-ui-next.production-smoke.v1',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseUrl: config.baseUrl.toString(),
    csrfProbeEnabled: config.csrfProbe,
    insecureTls: config.insecureTls,
    checks: []
  };
}

function recordSmokeCheck(report, name, details = {}) {
  report.checks.push({
    name,
    status: 'passed',
    checkedAt: new Date().toISOString(),
    ...compactObject(details)
  });
}

function writeSmokeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(reportPath, 0o600);
}

function markSmokeReportComplete(report, status, details = {}) {
  report.status = status;
  report.completedAt = new Date().toISOString();
  Object.assign(report, compactObject(details));
}

async function runProductionSmoke(config) {
  const context = {};
  const report = createSmokeReport(config);

  try {
    await runProductionSmokeChecks(config, context, report);
    markSmokeReportComplete(report, 'passed');

    if (config.reportPath) {
      writeSmokeReport(config.reportPath, report);
      logPass('smoke report', config.reportPath);
    }

    return report;
  } catch (error) {
    markSmokeReportComplete(report, 'failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    if (config.reportPath) {
      writeSmokeReport(config.reportPath, report);
    }

    throw error;
  }
}

async function runProductionSmokeChecks(config, context, report) {
  if (config.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  process.stdout.write(`OU-UI Next production smoke: ${config.baseUrl.toString()}\n`);

  const boundaryResult = await requestJson(config, context, 'GET', '/api/v1/boundary');
  assertStatus('boundary', boundaryResult.response, boundaryResult.payload, [200]);
  const boundary = assertJsonData('boundary', boundaryResult.payload);
  logPass('boundary', `version=${boundary.version ?? 'unknown'}`);
  recordSmokeCheck(report, 'boundary', {
    httpStatus: boundaryResult.response.status,
    version: boundary.version
  });

  const anonymousSnapshot = await requestJson(config, context, 'GET', '/api/v1/snapshot');
  assertStatus('anonymous protected API', anonymousSnapshot.response, anonymousSnapshot.payload, [401]);
  logPass('protected API rejects anonymous access');
  recordSmokeCheck(report, 'anonymous protected API', {
    httpStatus: anonymousSnapshot.response.status
  });

  const loginResult = await requestJson(config, context, 'POST', '/api/v1/auth/session', {
    headers: {
      'X-Request-Id': `req-production-smoke-login-${randomUUID()}`
    },
    body: {
      username: config.username,
      password: config.password
    }
  });
  assertStatus('operator login', loginResult.response, loginResult.payload, [201]);
  const login = assertJsonData('operator login', loginResult.payload);
  const cookieHeader = createCookieHeader(getSetCookieValues(loginResult.response.headers));

  if (!cookieHeader) {
    throw new Error('operator login 未返回 session cookie。');
  }

  if (!login.csrfToken || typeof login.csrfToken !== 'string') {
    throw new Error('operator login 未返回 CSRF token。');
  }

  context.cookieHeader = cookieHeader;
  context.csrfToken = login.csrfToken;
  logPass('operator session login', `actor=${login.actor ?? 'unknown'}`);
  recordSmokeCheck(report, 'operator session login', {
    httpStatus: loginResult.response.status,
    actor: login.actor,
    sessionCookieReceived: true,
    csrfTokenReceived: true
  });

  const sessionResult = await requestJson(config, context, 'GET', '/api/v1/auth/session');
  assertStatus('operator session check', sessionResult.response, sessionResult.payload, [200]);
  const session = assertJsonData('operator session check', sessionResult.payload);

  if (!session.authenticated || !session.csrfToken) {
    throw new Error('operator session check 未确认有效会话或 CSRF token。');
  }

  logPass('operator session check');
  recordSmokeCheck(report, 'operator session check', {
    httpStatus: sessionResult.response.status,
    authenticated: Boolean(session.authenticated)
  });

  const snapshotResult = await requestJson(config, context, 'GET', '/api/v1/snapshot');
  assertStatus('protected snapshot', snapshotResult.response, snapshotResult.payload, [200]);
  const snapshot = assertJsonData('protected snapshot', snapshotResult.payload);
  logPass('protected snapshot', `agents=${Array.isArray(snapshot.agents) ? snapshot.agents.length : 'unknown'}`);
  recordSmokeCheck(report, 'protected snapshot', {
    httpStatus: snapshotResult.response.status,
    agentCount: Array.isArray(snapshot.agents) ? snapshot.agents.length : undefined
  });

  if (config.csrfProbe) {
    const csrfProbeResult = await requestJson(config, context, 'POST', '/api/v1/audit-logs:verify', {
      headers: {
        'X-Request-Id': `req-production-smoke-csrf-${randomUUID()}`,
        'Idempotency-Key': `idem-production-smoke-csrf-${randomUUID()}`
      },
      body: {
        auditLogs: []
      }
    });
    assertStatus('CSRF rejection probe', csrfProbeResult.response, csrfProbeResult.payload, [403]);

    if (csrfProbeResult.payload.json?.error?.code !== 'csrf.required') {
      throw new Error(`CSRF rejection probe 返回了非预期错误：${responseErrorSummary(csrfProbeResult.payload)}`);
    }

    logPass('CSRF rejection probe', '403 csrf.required');
    recordSmokeCheck(report, 'CSRF rejection probe', {
      httpStatus: csrfProbeResult.response.status,
      errorCode: csrfProbeResult.payload.json?.error?.code
    });
  } else {
    logPass('CSRF rejection probe skipped');
    recordSmokeCheck(report, 'CSRF rejection probe skipped');
  }

  const metricsResult = await requestJson(config, context, 'GET', '/api/v1/observability-metrics');
  assertStatus('observability metrics API', metricsResult.response, metricsResult.payload, [200]);
  const metrics = assertJsonData('observability metrics API', metricsResult.payload);

  if (!metrics.tasks || !metrics.commandOutbox || !metrics.audit) {
    throw new Error('observability metrics API 缺少 tasks / commandOutbox / audit 字段。');
  }

  logPass('observability metrics API', `tasks=${metrics.tasks.total ?? 'unknown'}`);
  recordSmokeCheck(report, 'observability metrics API', {
    httpStatus: metricsResult.response.status,
    taskTotal: metrics.tasks.total,
    auditValid: metrics.audit.valid
  });

  const prometheusResult = await requestText(config, context, 'GET', '/metrics');
  if (prometheusResult.response.status !== 200) {
    throw new Error(`/metrics HTTP ${prometheusResult.response.status}`);
  }

  const prometheusContentType = prometheusResult.response.headers.get('content-type') ?? '';

  if (!prometheusContentType.includes('text/plain') || !prometheusResult.text.includes('ou_ui_metrics_generated_timestamp_seconds')) {
    throw new Error('/metrics 响应不是预期 Prometheus 文本指标。');
  }

  logPass('prometheus metrics');
  recordSmokeCheck(report, 'prometheus metrics', {
    httpStatus: prometheusResult.response.status,
    contentType: prometheusContentType
  });

  const taskEventsResult = await requestText(config, context, 'GET', '/events/v1/tasks?once=1', {
    accept: 'text/event-stream'
  });
  if (taskEventsResult.response.status !== 200) {
    throw new Error(`/events/v1/tasks HTTP ${taskEventsResult.response.status}`);
  }

  if (
    !(taskEventsResult.response.headers.get('content-type') ?? '').includes('text/event-stream') ||
    !taskEventsResult.text.includes('event: stream.ready')
  ) {
    throw new Error('/events/v1/tasks 未返回可用 SSE stream.ready。');
  }

  logPass('task SSE snapshot');
  recordSmokeCheck(report, 'task SSE snapshot', {
    httpStatus: taskEventsResult.response.status,
    byteLength: Buffer.byteLength(taskEventsResult.text)
  });

  const alertEventsResult = await requestText(config, context, 'GET', '/events/v1/system-alerts?once=1', {
    accept: 'text/event-stream'
  });
  if (alertEventsResult.response.status !== 200) {
    throw new Error(`/events/v1/system-alerts HTTP ${alertEventsResult.response.status}`);
  }

  if (
    !(alertEventsResult.response.headers.get('content-type') ?? '').includes('text/event-stream') ||
    !alertEventsResult.text.includes('event: system_alert.snapshot') ||
    !alertEventsResult.text.includes('event: stream.ready')
  ) {
    throw new Error('/events/v1/system-alerts 未返回可用系统告警 SSE 快照。');
  }

  logPass('system alert SSE snapshot');
  recordSmokeCheck(report, 'system alert SSE snapshot', {
    httpStatus: alertEventsResult.response.status,
    byteLength: Buffer.byteLength(alertEventsResult.text)
  });

  const logoutResult = await requestJson(config, context, 'DELETE', '/api/v1/auth/session', {
    headers: {
      'X-Request-Id': `req-production-smoke-logout-${randomUUID()}`,
      'X-CSRF-Token': context.csrfToken
    }
  });
  assertStatus('operator logout', logoutResult.response, logoutResult.payload, [200]);
  logPass('operator logout');
  recordSmokeCheck(report, 'operator logout', {
    httpStatus: logoutResult.response.status
  });

  process.stdout.write('OU-UI Next production smoke completed.\n');
}

function printHelp() {
  process.stdout.write(`OU-UI Next production smoke

Usage:
  OU_UI_SMOKE_BASE_URL=https://example.com/panel \\
  OU_UI_SMOKE_USERNAME=operator \\
  OU_UI_SMOKE_PASSWORD=... \\
  node scripts/production-smoke.cjs

Options:
  --base-url <url>           面板 base URL，可包含安装器生成的安全路径
  --credentials-file <path>  读取 OU_UI_CONTROL_PLANE_OPERATOR_USERNAME/PASSWORD
  --timeout-ms <ms>          单请求超时，默认 ${defaultTimeoutMs}
  --report <path>            写入脱敏 JSON 烟测报告
  --insecure-tls             允许自签名 TLS 证书
  --skip-csrf-probe          跳过缺 CSRF 的拒绝探针
`);
}

if (require.main === module) {
  (async () => {
    try {
      const config = resolveSmokeConfig();

      if (config.help) {
        printHelp();
        return;
      }

      await runProductionSmoke(config);
    } catch (error) {
      process.stderr.write(`FAIL production smoke: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  buildEndpointUrl,
  createCookieHeader,
  createSmokeReport,
  joinUrlPath,
  normalizeBaseUrl,
  parseArgs,
  parseEnvFile,
  resolveSmokeConfig,
  writeSmokeReport
};
