#!/usr/bin/env node

const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { parseEnvFile } = require('./production-smoke.cjs');

const defaultCredentialsFile = '/etc/ou-ui-next/credentials.env';
const defaultTimeoutMs = 30_000;
const viewportPresets = {
  desktop: {
    width: 1440,
    height: 1000,
    isMobile: false,
    hasTouch: false
  },
  mobile: {
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true
  }
};
const browserNames = new Set(['chromium', 'firefox', 'webkit']);
const viewportNames = new Set(Object.keys(viewportPresets));

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
    positional: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--credentials-file') {
      options.credentialsFile = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      options.timeoutMs = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report') {
      options.reportPath = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--screenshot-dir') {
      options.screenshotDir = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--browser') {
      options.browserName = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--executable-path') {
      options.executablePath = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--viewport') {
      options.viewportPreset = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--insecure-tls') {
      options.insecureTls = true;
      continue;
    }

    if (arg === '--headed') {
      options.headed = true;
      continue;
    }

    if (arg === '--skip-screenshots') {
      options.skipScreenshots = true;
      continue;
    }

    if (arg === '--') {
      options.positional.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }

    options.positional.push(arg);
  }

  if (!options.baseUrl && options.positional.length > 0) {
    options.baseUrl = options.positional[0];
  }

  if (options.positional.length > 1) {
    throw new Error('浏览器烟测只接受一个位置参数作为面板地址。');
  }

  return options;
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

  if (!existsSync(path)) {
    throw new Error(`密码文件不存在：${path}`);
  }

  return unquoteEnvValue(readFileSync(path, 'utf8').trim());
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
    throw new Error('OU_UI_BROWSER_SMOKE_BASE_URL 只支持 http 或 https。');
  }

  if (url.username || url.password) {
    throw new Error('OU_UI_BROWSER_SMOKE_BASE_URL 不能包含用户名或密码。');
  }

  url.hash = '';
  url.search = '';

  return url;
}

function resolveExplicitPassword(env) {
  return (
    env.OU_UI_BROWSER_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_BROWSER_SMOKE_PASSWORD_FILE) ??
    env.OU_UI_SMOKE_PASSWORD ??
    readOptionalSecretFile(env.OU_UI_SMOKE_PASSWORD_FILE)
  );
}

function resolveBrowserSmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const credentialsFile =
    args.credentialsFile ??
    env.OU_UI_BROWSER_SMOKE_CREDENTIALS_FILE ??
    env.OU_UI_SMOKE_CREDENTIALS_FILE ??
    defaultCredentialsFile;
  const baseUrl = args.baseUrl ?? env.OU_UI_BROWSER_SMOKE_BASE_URL ?? env.OU_UI_SMOKE_BASE_URL ?? env.OU_UI_PANEL_URL;
  const explicitUsername = env.OU_UI_BROWSER_SMOKE_USERNAME ?? env.OU_UI_SMOKE_USERNAME;
  const explicitPassword = resolveExplicitPassword(env);
  const credentials = explicitUsername && explicitPassword ? {} : readOptionalEnvFile(credentialsFile);
  const username =
    explicitUsername ??
    credentials.OU_UI_CONTROL_PLANE_OPERATOR_USERNAME ??
    credentials.OU_UI_BROWSER_SMOKE_USERNAME ??
    credentials.OU_UI_SMOKE_USERNAME;
  const password =
    explicitPassword ??
    credentials.OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD ??
    credentials.OU_UI_BROWSER_SMOKE_PASSWORD ??
    credentials.OU_UI_SMOKE_PASSWORD;
  const browserName = args.browserName ?? env.OU_UI_BROWSER_SMOKE_BROWSER ?? 'chromium';
  const executablePath = args.executablePath ?? env.OU_UI_BROWSER_SMOKE_EXECUTABLE_PATH;
  const viewportPreset = args.viewportPreset ?? env.OU_UI_BROWSER_SMOKE_VIEWPORT ?? 'desktop';
  const screenshotsEnabled =
    !args.skipScreenshots && env.OU_UI_BROWSER_SMOKE_SCREENSHOTS !== '0' && env.OU_UI_BROWSER_SMOKE_SCREENSHOTS !== 'false';

  if (!baseUrl) {
    throw new Error('缺少 OU_UI_BROWSER_SMOKE_BASE_URL，或使用 --base-url 指定面板地址。');
  }

  if (!username || !password) {
    throw new Error('缺少浏览器烟测登录凭据。请设置 OU_UI_BROWSER_SMOKE_USERNAME / OU_UI_BROWSER_SMOKE_PASSWORD，或指定安装器生成的 credentials 文件。');
  }

  if (!browserNames.has(browserName)) {
    throw new Error(`浏览器类型不支持：${browserName}。可用值：chromium, firefox, webkit。`);
  }

  if (!viewportNames.has(viewportPreset)) {
    throw new Error(`视口类型不支持：${viewportPreset}。可用值：desktop, mobile。`);
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    username,
    password,
    credentialsFile,
    timeoutMs: readPositiveInteger(
      args.timeoutMs ?? env.OU_UI_BROWSER_SMOKE_TIMEOUT_MS ?? env.OU_UI_SMOKE_TIMEOUT_MS,
      defaultTimeoutMs,
      'OU_UI_BROWSER_SMOKE_TIMEOUT_MS'
    ),
    insecureTls: Boolean(args.insecureTls) || parseBoolean(env.OU_UI_BROWSER_SMOKE_INSECURE_TLS) || parseBoolean(env.OU_UI_SMOKE_INSECURE_TLS),
    reportPath: args.reportPath ?? env.OU_UI_BROWSER_SMOKE_REPORT_PATH,
    screenshotDir: screenshotsEnabled
      ? args.screenshotDir ?? env.OU_UI_BROWSER_SMOKE_SCREENSHOT_DIR
      : undefined,
    browserName,
    executablePath,
    viewportPreset,
    viewport: viewportPresets[viewportPreset],
    headed: Boolean(args.headed) || parseBoolean(env.OU_UI_BROWSER_SMOKE_HEADED),
    screenshotsEnabled
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function createBrowserSmokeReport(config) {
  return {
    schemaVersion: 'ou-ui-next.production-browser-smoke.v1',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseUrl: config.baseUrl.toString(),
    browserName: config.browserName,
    headless: !config.headed,
    insecureTls: config.insecureTls,
    executablePathConfigured: Boolean(config.executablePath),
    viewport: config.viewport,
    screenshotsEnabled: Boolean(config.screenshotDir),
    checks: []
  };
}

function recordBrowserCheck(report, name, details = {}) {
  report.checks.push({
    name,
    status: 'passed',
    checkedAt: new Date().toISOString(),
    ...compactObject(details)
  });
}

function writeBrowserSmokeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(reportPath, 0o600);
}

function markBrowserSmokeReportComplete(report, status, details = {}) {
  report.status = status;
  report.completedAt = new Date().toISOString();
  Object.assign(report, compactObject(details));
}

function createSafeScreenshotName(name, index) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'check';
  return `${String(index).padStart(2, '0')}-${slug}.png`;
}

async function captureScreenshot(config, page, report, name) {
  if (!config.screenshotDir) {
    return undefined;
  }

  mkdirSync(config.screenshotDir, { recursive: true });
  const screenshotPath = join(config.screenshotDir, createSafeScreenshotName(name, report.checks.length + 1));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  chmodSync(screenshotPath, 0o600);
  return screenshotPath;
}

function logPass(label, detail) {
  process.stdout.write(`PASS ${label}${detail ? ` - ${detail}` : ''}\n`);
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error(
      '缺少 Playwright 运行依赖。请先更新安装目录依赖，或在安装目录运行 npm install 后重试浏览器烟测。'
    );
  }
}

async function waitForVisible(locator, timeoutMs, label) {
  await locator.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {
    throw new Error(`${label} 未在 ${timeoutMs}ms 内显示。`);
  });
}

async function readRenderState(page) {
  return page.evaluate(() => {
    const pageDocument = globalThis.document;
    const root = pageDocument.getElementById('root');
    const bodyText = pageDocument.body?.innerText?.trim() ?? '';
    const rootText = root?.innerText?.trim() ?? '';

    return {
      bodyTextLength: bodyText.length,
      rootChildCount: root?.childElementCount ?? 0,
      rootExists: Boolean(root),
      rootTextLength: rootText.length,
      title: pageDocument.title
    };
  });
}

async function assertPageNotBlank(page, label) {
  const state = await readRenderState(page);

  if (!state.rootExists) {
    throw new Error(`${label} 缺少 React root 容器。`);
  }

  if (state.bodyTextLength === 0 && state.rootChildCount === 0) {
    throw new Error(`${label} 为空白页面：React root 没有渲染内容。`);
  }

  return state;
}

async function runBrowserCheck(config, page, report, name, action) {
  await action();
  const renderState = await assertPageNotBlank(page, name);
  const screenshotPath = await captureScreenshot(config, page, report, name);
  recordBrowserCheck(report, name, {
    renderState,
    screenshot: screenshotPath
  });
  logPass(name, screenshotPath ? `screenshot=${screenshotPath}` : undefined);
}

async function clickNavigation(page, label, timeoutMs, headingMatcher = label) {
  await page.getByRole('button', { name: label, exact: true }).click({ timeout: timeoutMs });
  await waitForVisible(page.getByRole('heading', { name: headingMatcher }).first(), timeoutMs, `页面 ${label}`);
}

async function openMobileGovernancePage(page, label, timeoutMs, headingMatcher = label) {
  const mobileNavigation = page.getByRole('navigation', { name: /手机快捷导航|Mobile quick navigation/i });
  await mobileNavigation.getByRole('button', { name: /治理|Govern/i }).click({ timeout: timeoutMs });
  await waitForVisible(page.getByRole('region', { name: /手机治理入口|Mobile governance entry/i }), timeoutMs, '手机治理入口');
  await page.getByRole('region', { name: /手机治理入口|Mobile governance entry/i }).getByRole('button', { name: label, exact: true }).click({ timeout: timeoutMs });
  await waitForVisible(page.getByRole('heading', { name: headingMatcher }).first(), timeoutMs, `页面 ${label}`);
}

async function openAdvancedNavigation(page, timeoutMs) {
  const expandButton = page
    .getByRole('button', {
      name: /展开 (高级功能|客户与策略|证据与设置|治理与证据)|Expand (Advanced Features|Customers & Policy|Evidence & Settings|Governance & Evidence)/i
    })
    .first();
  if (await expandButton.count()) {
    await expandButton.click({ timeout: timeoutMs });
  }
}

async function runProductionBrowserSmoke(config) {
  const report = createBrowserSmokeReport(config);
  const pageErrors = [];

  try {
    await runProductionBrowserSmokeChecks(config, report, pageErrors);
    markBrowserSmokeReportComplete(report, 'passed', {
      pageErrors
    });

    if (config.reportPath) {
      writeBrowserSmokeReport(config.reportPath, report);
      logPass('browser smoke report', config.reportPath);
    }

    return report;
  } catch (error) {
    markBrowserSmokeReportComplete(report, 'failed', {
      error: error instanceof Error ? error.message : String(error),
      pageErrors
    });

    if (config.reportPath) {
      writeBrowserSmokeReport(config.reportPath, report);
    }

    throw error;
  }
}

async function runProductionBrowserSmokeChecks(config, report, pageErrors) {
  const playwright = loadPlaywright();
  const browserType = playwright[config.browserName];

  process.stdout.write(`OU-UI Next production browser smoke: ${config.baseUrl.toString()}\n`);

  let browser;
  try {
    browser = await browserType.launch({
      headless: !config.headed,
      ...(config.executablePath ? { executablePath: config.executablePath } : {})
    });
  } catch (error) {
    throw new Error(
      `无法启动 ${config.browserName} 浏览器。请确认 Playwright 浏览器二进制和系统依赖已安装；可在安装目录运行 npx playwright install ${config.browserName} 后重试。原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: config.insecureTls,
      locale: 'zh-CN',
      viewport: config.viewport,
      isMobile: config.viewport.isMobile,
      hasTouch: config.viewport.hasTouch
    });
    const page = await context.newPage();

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await runBrowserCheck(config, page, report, 'login page loaded', async () => {
      await page.goto(config.baseUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: config.timeoutMs
      });
      await waitForVisible(page.getByRole('heading', { name: /OU-UI Next (控制面板|Control Panel)/i }), config.timeoutMs, '登录页');
    });

    await runBrowserCheck(config, page, report, 'operator browser login', async () => {
      await page.getByLabel(/用户名|Username/i).fill(config.username, { timeout: config.timeoutMs });
      await page.getByLabel(/密码|Password/i).fill(config.password, { timeout: config.timeoutMs });
      await page.getByRole('button', { name: /安全登录|Secure Login/i }).click({ timeout: config.timeoutMs });
      await waitForVisible(page.getByText(/Master Control Plane/i).first(), config.timeoutMs, 'Master Control Plane');
      await waitForVisible(
        page.getByRole('heading', { name: /概览|Overview/i }).first(),
        config.timeoutMs,
        '控制面概览'
      );
    });

    await runBrowserCheck(config, page, report, 'navigate 服务器', async () => {
      await clickNavigation(page, '服务器', config.timeoutMs, /受控主机|Managed Hosts/i);
    });

    await runBrowserCheck(config, page, report, 'navigate 节点', async () => {
      await clickNavigation(page, '节点', config.timeoutMs, /客户节点|Customer Nodes/i);
    });

    await runBrowserCheck(config, page, report, 'expand 高级功能', async () => {
      await openAdvancedNavigation(page, config.timeoutMs);
    });

    const advancedPages = config.viewportPreset === 'mobile'
      ? [
          { label: '恢复中心', heading: /恢复中心|Recovery Center/i, mobile: true },
          { label: '客户', heading: /客户管理|Customer Management/i, mobile: true },
          { label: '分流策略', heading: /分流策略|Routing Policy/i, mobile: true },
          { label: '调优', heading: /系统调优|System Tuning/i, mobile: true },
          { label: '通知', heading: /Telegram 通知|Telegram Notifications/i, mobile: true },
          { label: '账户', heading: /管理员账户设置|Admin Accounts/i, mobile: true },
          { label: '执行记录', heading: /执行记录|Execution Log/i, mobile: true },
          { label: '审计', heading: /审计日志|Audit Log/i, mobile: true }
        ]
      : [
          { label: '恢复中心', heading: /恢复中心|Recovery Center/i },
          { label: '客户', heading: /客户管理|Customer Management/i },
          { label: '端口转发', heading: /端口转发|Port Forwarding/i },
          { label: '订阅', heading: /订阅管理|Subscription Management/i },
          { label: '分流策略', heading: /分流策略|Routing Policy/i },
          { label: '调优', heading: /系统调优|System Tuning/i },
          { label: '通知', heading: /Telegram 通知|Telegram Notifications/i },
          { label: '账户', heading: /管理员账户设置|Admin Accounts/i },
          { label: '执行记录', heading: /执行记录|Execution Log/i },
          { label: '审计', heading: /审计日志|Audit Log/i }
        ];

    for (const pageEntry of advancedPages) {
      await runBrowserCheck(config, page, report, `navigate ${pageEntry.label}`, async () => {
        if (pageEntry.mobile) {
          await openMobileGovernancePage(page, pageEntry.label, config.timeoutMs, pageEntry.heading);
        } else {
          await clickNavigation(page, pageEntry.label, config.timeoutMs, pageEntry.heading);
        }

        if (pageEntry.label === '恢复中心') {
          await waitForVisible(page.locator('[data-recovery-center-page="ready"]'), config.timeoutMs, '恢复中心队列');
        }
      });
    }

    await runBrowserCheck(config, page, report, 'browser logout', async () => {
      await clickNavigation(page, '概览', config.timeoutMs, /概览|Overview/i);
      await page.getByRole('button', { name: /退出登录|Sign out/i }).click({ timeout: config.timeoutMs });
      await waitForVisible(page.getByRole('heading', { name: /OU-UI Next (控制面板|Control Panel)/i }), config.timeoutMs, '退出后的登录页');
    });

    if (pageErrors.length > 0) {
      throw new Error(`浏览器页面出现未处理异常：${pageErrors.join(' | ')}`);
    }

    await context.close();
    process.stdout.write('OU-UI Next production browser smoke completed.\n');
  } finally {
    await browser.close();
  }
}

function printHelp() {
  process.stdout.write(`OU-UI Next production browser smoke

Usage:
  OU_UI_BROWSER_SMOKE_BASE_URL=https://example.com/panel \\
  OU_UI_BROWSER_SMOKE_USERNAME=operator \\
  OU_UI_BROWSER_SMOKE_PASSWORD=... \\
  node scripts/production-browser-smoke.cjs

Options:
  --base-url <url>           面板 base URL，可包含安装器生成的安全路径
  --credentials-file <path>  读取 OU_UI_CONTROL_PLANE_OPERATOR_USERNAME/PASSWORD
  --timeout-ms <ms>          页面操作超时，默认 ${defaultTimeoutMs}
  --report <path>            写入脱敏 JSON 浏览器烟测报告
  --screenshot-dir <path>    保存每一步通过后的浏览器截图
  --browser <name>           chromium/firefox/webkit，默认 chromium
  --executable-path <path>   使用系统浏览器二进制，适合服务器缺少 Playwright bundled browser 的场景
  --viewport <name>          desktop/mobile，默认 desktop
  --insecure-tls             允许自签名 TLS 证书
  --headed                   使用有界面浏览器，默认 headless
  --skip-screenshots         不保存截图
`);
}

if (require.main === module) {
  (async () => {
    try {
      const config = resolveBrowserSmokeConfig();

      if (config.help) {
        printHelp();
        return;
      }

      await runProductionBrowserSmoke(config);
    } catch (error) {
      process.stderr.write(`FAIL production browser smoke: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  assertPageNotBlank,
  createBrowserSmokeReport,
  createSafeScreenshotName,
  normalizeBaseUrl,
  parseArgs,
  resolveBrowserSmokeConfig,
  writeBrowserSmokeReport
};
