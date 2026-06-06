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

    if (arg === '--telegram-admin-chat-id') {
      options.telegramAdminChatId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--telegram-binding-id') {
      options.telegramBindingId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--language') {
      options.language = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--insecure-tls') {
      options.insecureTls = true;
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

function normalizeBaseUrl(value) {
  const url = new URL(value);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OU_UI_NOTIFICATION_SMOKE_BASE_URL 只支持 http 或 https。');
  }

  if (url.username || url.password) {
    throw new Error('OU_UI_NOTIFICATION_SMOKE_BASE_URL 不能包含用户名或密码。');
  }

  url.hash = '';
  url.search = '';

  return url;
}

function resolveTelegramTarget(args, env) {
  const adminChatId = args.telegramAdminChatId ?? env.OU_UI_NOTIFICATION_SMOKE_TELEGRAM_ADMIN_CHAT_ID;
  const bindingId = args.telegramBindingId ?? env.OU_UI_NOTIFICATION_SMOKE_TELEGRAM_BINDING_ID;

  if (adminChatId && bindingId) {
    throw new Error('通知烟测只能指定一个 Telegram 目标：--telegram-admin-chat-id 或 --telegram-binding-id。');
  }

  if (adminChatId) {
    return {
      kind: 'admin-chat',
      chatId: adminChatId
    };
  }

  if (bindingId) {
    return {
      kind: 'binding',
      bindingId
    };
  }

  throw new Error('缺少 Telegram 测试目标。请使用 --telegram-admin-chat-id 或 --telegram-binding-id。');
}

function resolveNotificationSmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const credentialsFile =
    args.credentialsFile ?? env.OU_UI_NOTIFICATION_SMOKE_CREDENTIALS_FILE ?? env.OU_UI_SMOKE_CREDENTIALS_FILE ?? defaultCredentialsFile;
  const baseUrl = args.baseUrl ?? env.OU_UI_NOTIFICATION_SMOKE_BASE_URL ?? env.OU_UI_SMOKE_BASE_URL ?? env.OU_UI_PANEL_URL;
  const explicitUsername = env.OU_UI_NOTIFICATION_SMOKE_USERNAME ?? env.OU_UI_SMOKE_USERNAME;
  const explicitPassword =
    env.OU_UI_NOTIFICATION_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_NOTIFICATION_SMOKE_PASSWORD_FILE) ??
    env.OU_UI_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_SMOKE_PASSWORD_FILE);
  const credentials = explicitUsername && explicitPassword ? {} : readOptionalEnvFile(credentialsFile);
  const username =
    explicitUsername ?? credentials.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME ?? credentials.OU_UI_NOTIFICATION_SMOKE_USERNAME;
  const password =
    explicitPassword ?? credentials.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD ?? credentials.OU_UI_NOTIFICATION_SMOKE_PASSWORD;

  if (!baseUrl) {
    throw new Error('缺少 OU_UI_NOTIFICATION_SMOKE_BASE_URL，或使用 --base-url 指定面板地址。');
  }

  if (!username || !password) {
    throw new Error('缺少通知烟测登录凭据。请设置用户名/密码环境变量，或指定安装器生成的 credentials 文件。');
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    username,
    password,
    credentialsFile,
    timeoutMs: readPositiveInteger(
      args.timeoutMs ?? env.OU_UI_NOTIFICATION_SMOKE_TIMEOUT_MS ?? env.OU_UI_SMOKE_TIMEOUT_MS,
      defaultTimeoutMs,
      'OU_UI_NOTIFICATION_SMOKE_TIMEOUT_MS'
    ),
    insecureTls: Boolean(args.insecureTls) || parseBoolean(env.OU_UI_NOTIFICATION_SMOKE_INSECURE_TLS ?? env.OU_UI_SMOKE_INSECURE_TLS),
    reportPath: args.reportPath ?? env.OU_UI_NOTIFICATION_SMOKE_REPORT_PATH,
    telegramTarget: resolveTelegramTarget(args, env),
    language: args.language ?? env.OU_UI_NOTIFICATION_SMOKE_LANGUAGE
  };
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
  const endpoint = new URL(endpointPath, 'http://ou-ui-notification-smoke.invalid');
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

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function redactSensitiveFragments(value, sensitiveValues = []) {
  let redacted = String(value ?? '');

  for (const sensitiveValue of sensitiveValues) {
    const normalized = String(sensitiveValue ?? '');

    if (!normalized) {
      continue;
    }

    redacted = redacted.split(normalized).join('[redacted]');
  }

  return redacted;
}

function readConfigSensitiveValues(config) {
  return [
    config.username,
    config.password,
    config.telegramTarget.kind === 'admin-chat' ? config.telegramTarget.chatId : undefined,
    config.telegramTarget.kind === 'binding' ? config.telegramTarget.bindingId : undefined
  ].filter(Boolean);
}

function sanitizeErrorMessage(error, sensitiveValues = []) {
  return redactSensitiveFragments(error instanceof Error ? error.message : String(error), sensitiveValues);
}

function createNotificationSmokeReport(config) {
  return {
    schemaVersion: 'ou-ui-next.production-notification-smoke.v1',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseUrl: config.baseUrl.toString(),
    insecureTls: config.insecureTls,
    telegramTarget: {
      kind: config.telegramTarget.kind
    },
    checks: []
  };
}

function recordNotificationSmokeCheck(report, name, details = {}) {
  report.checks.push({
    name,
    status: 'passed',
    checkedAt: new Date().toISOString(),
    ...compactObject(details)
  });
}

function sanitizeTelegramDelivery(delivery, sensitiveValues = []) {
  return {
    id: delivery?.id,
    notificationType: delivery?.notificationType,
    recipientKind: delivery?.recipientKind,
    templateId: delivery?.templateId,
    language: delivery?.language,
    status: delivery?.status,
    attemptCount: delivery?.attemptCount,
    maxAttempts: delivery?.maxAttempts,
    createdAt: delivery?.createdAt,
    updatedAt: delivery?.updatedAt,
    lastAttemptAt: delivery?.lastAttemptAt,
    deliveredAt: delivery?.deliveredAt,
    deadLetteredAt: delivery?.deadLetteredAt,
    lastErrorMessage:
      delivery?.lastErrorMessage === undefined ? undefined : redactSensitiveFragments(delivery.lastErrorMessage, sensitiveValues),
    renderedPreviewRedacted: delivery?.renderedPreviewRedacted,
    hasCustomerBinding: Boolean(delivery?.customerBindingId),
    hasChatBinding: Boolean(delivery?.chatBindingId),
    hasAdminChat: Boolean(delivery?.adminChatId)
  };
}

function writeNotificationSmokeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(reportPath, 0o600);
}

function markNotificationSmokeReportComplete(report, status, details = {}) {
  report.status = status;
  report.completedAt = new Date().toISOString();
  Object.assign(report, compactObject(details));
}

async function runNotificationSmoke(config) {
  const context = {};
  const report = createNotificationSmokeReport(config);
  const sensitiveValues = readConfigSensitiveValues(config);

  try {
    await runNotificationSmokeChecks(config, context, report);
    markNotificationSmokeReportComplete(report, 'passed');

    if (config.reportPath) {
      writeNotificationSmokeReport(config.reportPath, report);
      logPass('notification smoke report', config.reportPath);
    }

    return report;
  } catch (error) {
    markNotificationSmokeReportComplete(report, 'failed', {
      error: sanitizeErrorMessage(error, sensitiveValues)
    });

    if (config.reportPath) {
      writeNotificationSmokeReport(config.reportPath, report);
    }

    throw error;
  }
}

function logPass(label, detail) {
  process.stdout.write(`PASS ${label}${detail ? ` - ${detail}` : ''}\n`);
}

async function runNotificationSmokeChecks(config, context, report) {
  if (config.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  process.stdout.write(`OU-UI Next notification smoke: ${config.baseUrl.toString()}\n`);

  const loginResult = await requestJson(config, context, 'POST', '/api/v1/auth/session', {
    headers: {
      'X-Request-Id': `req-notification-smoke-login-${randomUUID()}`
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
  recordNotificationSmokeCheck(report, 'operator session login', {
    httpStatus: loginResult.response.status,
    actor: login.actor,
    sessionCookieReceived: true,
    csrfTokenReceived: true
  });

  const settingsResult = await requestJson(config, context, 'GET', '/api/v1/integrations/telegram-bot/settings');
  assertStatus('telegram settings', settingsResult.response, settingsResult.payload, [200]);
  const settings = assertJsonData('telegram settings', settingsResult.payload);
  logPass('telegram settings', `enabled=${Boolean(settings.enabled)} tokenSet=${Boolean(settings.botTokenSet)}`);
  recordNotificationSmokeCheck(report, 'telegram settings', {
    httpStatus: settingsResult.response.status,
    enabled: Boolean(settings.enabled),
    botTokenSet: Boolean(settings.botTokenSet),
    mode: settings.mode
  });

  const body = {
    target: config.telegramTarget,
    ...(config.language ? { language: config.language } : {})
  };
  const testResult = await requestJson(config, context, 'POST', '/api/v1/integrations/telegram-bot/test', {
    headers: {
      'X-Request-Id': `req-notification-smoke-telegram-test-${randomUUID()}`,
      'Idempotency-Key': `idem-notification-smoke-telegram-test-${randomUUID()}`,
      'X-CSRF-Token': context.csrfToken
    },
    body
  });
  assertStatus('telegram test notification', testResult.response, testResult.payload, [202]);
  const delivery = assertJsonData('telegram test notification', testResult.payload);
  const sanitizedDelivery = sanitizeTelegramDelivery(delivery, readConfigSensitiveValues(config));

  recordNotificationSmokeCheck(report, 'telegram test notification', {
    httpStatus: testResult.response.status,
    delivery: sanitizedDelivery
  });

  if (delivery.status !== 'delivered') {
    throw new Error(`telegram test notification was not delivered: ${delivery.status || 'unknown'}`);
  }

  logPass('telegram test notification', `status=${delivery.status}`);

  const logoutResult = await requestJson(config, context, 'DELETE', '/api/v1/auth/session', {
    headers: {
      'X-Request-Id': `req-notification-smoke-logout-${randomUUID()}`,
      'X-CSRF-Token': context.csrfToken
    }
  });
  assertStatus('operator logout', logoutResult.response, logoutResult.payload, [200]);
  logPass('operator logout');
  recordNotificationSmokeCheck(report, 'operator logout', {
    httpStatus: logoutResult.response.status
  });

  process.stdout.write('OU-UI Next notification smoke completed.\n');
}

function printHelp() {
  process.stdout.write(`OU-UI Next notification smoke

Usage:
  OU_UI_NOTIFICATION_SMOKE_BASE_URL=https://example.com/panel \\
  OU_UI_NOTIFICATION_SMOKE_USERNAME=operator \\
  OU_UI_NOTIFICATION_SMOKE_PASSWORD=... \\
  node scripts/production-notification-smoke.cjs --telegram-admin-chat-id 123456

Options:
  --base-url <url>                  面板 base URL，可包含安装器生成的安全路径
  --credentials-file <path>         读取 OU_UI_CONTROL_PLANE_OPERATOR_USERNAME/PASSWORD
  --timeout-ms <ms>                 单请求超时，默认 ${defaultTimeoutMs}
  --report <path>                   写入脱敏 JSON 通知烟测报告
  --insecure-tls                    允许自签名 TLS 证书
  --telegram-admin-chat-id <id>     向管理员 chat 发送 Telegram 测试通知
  --telegram-binding-id <id>        向已绑定客户发送 Telegram 测试通知
  --language <zh|en>                覆盖测试通知语言
`);
}

if (require.main === module) {
  (async () => {
    let config;

    try {
      config = resolveNotificationSmokeConfig();

      if (config.help) {
        printHelp();
        return;
      }

      await runNotificationSmoke(config);
    } catch (error) {
      const sensitiveValues = config && !config.help ? readConfigSensitiveValues(config) : [];
      process.stderr.write(`FAIL notification smoke: ${sanitizeErrorMessage(error, sensitiveValues)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  buildEndpointUrl,
  createCookieHeader,
  createNotificationSmokeReport,
  joinUrlPath,
  normalizeBaseUrl,
  parseArgs,
  parseEnvFile,
  redactSensitiveFragments,
  resolveNotificationSmokeConfig,
  sanitizeTelegramDelivery,
  sanitizeErrorMessage,
  writeNotificationSmokeReport
};
