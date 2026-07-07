#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chmodSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { assertRootHtml, buildEndpointUrl, createCookieHeader } = require('./production-smoke.cjs');

const backendUnitName = 'ou-ui-next-backend-4174';
const staticUnitName = 'ou-ui-next-static-4174';
const backendUnit = `${backendUnitName}.service`;
const staticUnit = `${staticUnitName}.service`;
const examplePublicUrl = 'http://172.93.187.112:4174/';
const defaultTimeoutMs = 30_000;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function readOptionValue(argv, index, arg) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`参数 ${arg} 需要值。`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    command: undefined,
    positional: []
  };
  const commands = new Set(['start', 'restart', 'stop', 'status', 'smoke']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--public-url') {
      options.publicUrl = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--skip-public') {
      options.skipPublic = true;
      continue;
    }

    if (arg === '--smoke') {
      options.smoke = true;
      continue;
    }

    if (arg === '--timeout-ms') {
      options.timeoutMs = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--backend-port') {
      options.backendPort = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--static-port') {
      options.staticPort = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--sqlite-file') {
      options.sqliteFile = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--username') {
      options.username = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--') {
      options.positional.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }

    if (!options.command && commands.has(arg)) {
      options.command = arg;
      continue;
    }

    options.positional.push(arg);
  }

  if (options.positional.length > 0) {
    throw new Error(`未知位置参数：${options.positional.join(' ')}`);
  }

  return options;
}

function readPort(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${label} 必须是 1-65535 之间的整数。`);
  }

  return parsed;
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

function normalizeHttpUrl(value, label) {
  const url = new URL(value);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} 只支持 http 或 https。`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} 不能包含用户名或密码。`);
  }

  url.hash = '';
  url.search = '';
  return url;
}

function resolveLocalDeployConfig(env = process.env, cwd = process.cwd(), argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const appDir = resolve(cwd);
  const stateDir = resolve(appDir, env.OU_UI_LOCAL_4174_STATE_DIR ?? 'diagnostics/local-deploy');
  const staticPort = readPort(args.staticPort ?? env.OU_UI_LOCAL_4174_STATIC_PORT, 4174, 'OU_UI_LOCAL_4174_STATIC_PORT');
  const backendPort = readPort(args.backendPort ?? env.OU_UI_LOCAL_4174_BACKEND_PORT, 4010, 'OU_UI_LOCAL_4174_BACKEND_PORT');
  const publicUrlValue = args.skipPublic ? undefined : args.publicUrl ?? env.OU_UI_LOCAL_4174_PUBLIC_URL;

  return {
    appDir,
    backendEntry: resolve(appDir, 'dist-server/http-control-plane-main.js'),
    backendEnvFile: resolve(stateDir, 'local-4174-backend.env'),
    backendHost: env.OU_UI_LOCAL_4174_BACKEND_HOST ?? '127.0.0.1',
    backendPort,
    backendUrl: new URL(`http://127.0.0.1:${backendPort}`),
    command: args.command ?? 'restart',
    help: false,
    localUrl: new URL(`http://127.0.0.1:${staticPort}/`),
    nodePath: env.OU_UI_LOCAL_4174_NODE_PATH ?? process.execPath,
    operatorToken: env.OU_UI_LOCAL_4174_OPERATOR_TOKEN ?? 'local-4174-operator-token-keep-private',
    password:
      env.OU_UI_LOCAL_4174_PASSWORD ??
      env.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD ??
      env.OU_UI_SMOKE_PASSWORD ??
      'admin',
    publicUrl: publicUrlValue ? normalizeHttpUrl(publicUrlValue, 'OU_UI_LOCAL_4174_PUBLIC_URL') : undefined,
    sessionSecret: env.OU_UI_LOCAL_4174_SESSION_SECRET ?? 'local-4174-session-secret-keep-private',
    shouldRunSmoke: Boolean(args.smoke) || parseBoolean(env.OU_UI_LOCAL_4174_SMOKE),
    sqliteFile: resolve(appDir, args.sqliteFile ?? env.OU_UI_LOCAL_4174_SQLITE_FILE ?? join(stateDir, 'control-plane.sqlite')),
    stateDir,
    staticHost: env.OU_UI_LOCAL_4174_STATIC_HOST ?? '0.0.0.0',
    staticPort,
    staticProxyEntry: resolve(appDir, 'scripts/static-panel-proxy.cjs'),
    staticRoot: resolve(appDir, env.OU_UI_LOCAL_4174_STATIC_ROOT ?? 'dist'),
    timeoutMs: readPositiveInteger(args.timeoutMs ?? env.OU_UI_LOCAL_4174_TIMEOUT_MS, defaultTimeoutMs, 'OU_UI_LOCAL_4174_TIMEOUT_MS'),
    username: args.username ?? env.OU_UI_LOCAL_4174_USERNAME ?? env.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME ?? 'admin'
  };
}

function toSetenv(key, value) {
  return `--setenv=${key}=${value}`;
}

function getBackendEnvPairs(config) {
  return [
    ['OU_UI_CONTROL_PLANE_STORAGE', 'sqlite'],
    ['OU_UI_CONTROL_PLANE_SQLITE_FILE', config.sqliteFile],
    ['OU_UI_CONTROL_PLANE_HOST', config.backendHost],
    ['OU_UI_CONTROL_PLANE_PORT', String(config.backendPort)],
    ['OU_UI_CONTROL_PLANE_OPERATOR_USERNAME', config.username],
    ['OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD', config.password],
    ['OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET', config.sessionSecret],
    ['OU_UI_CONTROL_PLANE_OPERATOR_TOKEN', config.operatorToken],
    ['OU_UI_CONTROL_PLANE_OPERATOR_ACTOR', config.username],
    ['OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID', 'owner'],
    ['OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT', '100'],
    ['OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS', '60000'],
    ['OU_UI_CONTROL_PLANE_AGENT_ROUTINE_LOG_SAMPLE_EVERY', '60'],
    ['OU_UI_AGENT_LOG_CHUNK_PERSIST_EVERY', '10']
  ];
}

function createBackendSystemdRunArgs(config) {
  return [
    `--unit=${backendUnitName}`,
    '--collect',
    `--working-directory=${config.appDir}`,
    '--property=Nice=19',
    `--property=EnvironmentFile=${config.backendEnvFile}`,
    config.nodePath,
    config.backendEntry
  ];
}

function createStaticSystemdRunArgs(config) {
  const envPairs = [
    ['OU_UI_STATIC_ROOT', config.staticRoot],
    ['OU_UI_BACKEND_URL', config.backendUrl.toString()],
    ['OU_UI_STATIC_HOST', config.staticHost],
    ['OU_UI_STATIC_PORT', String(config.staticPort)]
  ];

  return [
    `--unit=${staticUnitName}`,
    '--collect',
    `--working-directory=${config.appDir}`,
    '--property=Nice=19',
    ...envPairs.map(([key, value]) => toSetenv(key, value)),
    config.nodePath,
    config.staticProxyEntry
  ];
}

function buildSmokeTargets(config) {
  const targets = [config.localUrl];

  if (config.publicUrl && config.publicUrl.toString() !== config.localUrl.toString()) {
    targets.push(config.publicUrl);
  }

  return targets;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

function ensureBuildArtifacts(config) {
  const indexHtml = join(config.staticRoot, 'index.html');

  if (!existsSync(indexHtml)) {
    throw new Error(`缺少 ${indexHtml}。请先运行 npm run build。`);
  }

  if (!existsSync(config.backendEntry)) {
    throw new Error(`缺少 ${config.backendEntry}。请先运行 npm run build。`);
  }

  if (!existsSync(config.staticProxyEntry)) {
    throw new Error(`缺少 ${config.staticProxyEntry}。`);
  }
}

function quoteEnvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function writeBackendEnvFile(config) {
  const content = `${getBackendEnvPairs(config)
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join('\n')}\n`;
  mkdirSync(dirname(config.backendEnvFile), { recursive: true });
  writeFileSync(config.backendEnvFile, content, { mode: 0o600 });
  chmodSync(config.backendEnvFile, 0o600);
}

function stopUnits() {
  runCommand('systemctl', ['stop', staticUnit, backendUnit], { allowFailure: true, capture: true });
  runCommand('systemctl', ['reset-failed', staticUnit, backendUnit], { allowFailure: true, capture: true });
}

function startUnits(config) {
  ensureBuildArtifacts(config);
  mkdirSync(dirname(config.sqliteFile), { recursive: true });
  writeBackendEnvFile(config);
  runCommand('systemd-run', createBackendSystemdRunArgs(config));
  runCommand('systemd-run', createStaticSystemdRunArgs(config));
}

function statusUnits() {
  runCommand('systemctl', ['--no-pager', '--full', 'status', backendUnit, staticUnit], { allowFailure: true });
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

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`响应不是 JSON：${text.slice(0, 120)}`);
  }
}

async function runSingleTargetSmoke(config, target) {
  const rootResponse = await fetchWithTimeout(target.toString(), { headers: { accept: 'text/html' } }, config.timeoutMs);
  const html = await rootResponse.text();
  assertRootHtml(`${target.toString()} root HTML shell`, rootResponse, html);

  const anonymousSnapshot = await fetchWithTimeout(
    buildEndpointUrl(target, '/api/v1/snapshot'),
    { headers: { accept: 'application/json' } },
    config.timeoutMs
  );

  if (anonymousSnapshot.status !== 401) {
    throw new Error(`${target.toString()} anonymous snapshot HTTP ${anonymousSnapshot.status}，期望 401。`);
  }

  const loginResponse = await fetchWithTimeout(
    buildEndpointUrl(target, '/api/v1/auth/session'),
    {
      body: JSON.stringify({ username: config.username, password: config.password }),
      headers: {
        'content-type': 'application/json',
        'X-Request-Id': `req-local-4174-login-${randomUUID()}`
      },
      method: 'POST'
    },
    config.timeoutMs
  );
  const login = await readJson(loginResponse);

  if (loginResponse.status !== 201) {
    throw new Error(`${target.toString()} login HTTP ${loginResponse.status}，期望 201。`);
  }

  const cookieHeader = createCookieHeader(getSetCookieValues(loginResponse.headers));

  if (!cookieHeader || !login?.data?.csrfToken) {
    throw new Error(`${target.toString()} login 未返回 session cookie 或 CSRF token。`);
  }

  const snapshotResponse = await fetchWithTimeout(
    buildEndpointUrl(target, '/api/v1/snapshot'),
    {
      headers: {
        accept: 'application/json',
        cookie: cookieHeader
      }
    },
    config.timeoutMs
  );
  const snapshot = await readJson(snapshotResponse);

  if (snapshotResponse.status !== 200) {
    throw new Error(`${target.toString()} snapshot HTTP ${snapshotResponse.status}，期望 200。`);
  }

  const data = snapshot?.data ?? {};

  return {
    agentCount: Array.isArray(data.agents) ? data.agents.length : undefined,
    byteLength: Buffer.byteLength(html),
    status: 'passed',
    target: target.toString()
  };
}

async function retryUntilReady(config, target) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      return await runSingleTargetSmoke(config, target);
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
    }
  }

  throw new Error(
    `${target.toString()} smoke 未在 ${config.timeoutMs}ms 内通过：${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function runLocalDeploySmoke(config) {
  const results = [];

  for (const target of buildSmokeTargets(config)) {
    const result = await retryUntilReady(config, target);
    process.stdout.write(`PASS local 4174 smoke ${result.target} htmlBytes=${result.byteLength} agents=${result.agentCount ?? 'unknown'}\n`);
    results.push(result);
  }

  return results;
}

async function runCommandMode(config) {
  if (config.help) {
    printHelp();
    return;
  }

  if (config.command === 'stop') {
    stopUnits();
    return;
  }

  if (config.command === 'status') {
    statusUnits();
    return;
  }

  if (config.command === 'restart') {
    stopUnits();
    startUnits(config);
  } else if (config.command === 'start') {
    startUnits(config);
  } else if (config.command !== 'smoke') {
    throw new Error(`未知命令：${config.command}`);
  }

  if (config.command === 'smoke' || config.shouldRunSmoke) {
    await runLocalDeploySmoke(config);
  }
}

function printHelp() {
  process.stdout.write(`OU-UI Next local 4174 deployment

Usage:
  node scripts/local-4174-deploy.cjs restart --smoke
  node scripts/local-4174-deploy.cjs smoke --public-url ${examplePublicUrl}

Commands:
  start     启动 backend/static systemd transient units
  restart   重启 backend/static systemd transient units，默认命令
  stop      停止 backend/static units
  status    查看 backend/static units
  smoke     验证 root HTML、匿名 401、登录、snapshot

Options:
  --public-url <url>      公网验收地址，默认不启用
  --skip-public           只验收 127.0.0.1:${4174}
  --smoke                 start/restart 后立即 smoke
  --timeout-ms <ms>       smoke 总等待时间，默认 ${defaultTimeoutMs}
  --backend-port <port>   后端端口，默认 4010
  --static-port <port>    静态代理端口，默认 4174
  --sqlite-file <path>    状态库，默认 diagnostics/local-deploy/control-plane.sqlite
  --username <name>       登录用户名，默认 admin

Password is read from OU_UI_LOCAL_4174_PASSWORD and defaults to admin. There is intentionally no --password flag.
`);
}

if (require.main === module) {
  (async () => {
    try {
      const config = resolveLocalDeployConfig();
      await runCommandMode(config);
    } catch (error) {
      process.stderr.write(`FAIL local 4174 deploy: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  backendUnit,
  buildSmokeTargets,
  createBackendSystemdRunArgs,
  createStaticSystemdRunArgs,
  examplePublicUrl,
  getBackendEnvPairs,
  parseArgs,
  resolveLocalDeployConfig,
  runLocalDeploySmoke,
  staticUnit
};
