import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function extractFunctionBefore(script: string, functionName: string, nextFunctionName: string) {
  const start = script.indexOf(`${functionName}() {`);
  const end = script.indexOf(`\n${nextFunctionName}()`, start);

  if (start < 0 || end < 0) {
    throw new Error(`Unable to extract ${functionName}`);
  }

  return script.slice(start, end);
}

function extractFunctionAfter(script: string, marker: string, functionName: string, nextFunctionName: string) {
  const markerIndex = script.indexOf(marker);
  const start = script.indexOf(`${functionName}() {`, markerIndex);
  const end = script.indexOf(`\n${nextFunctionName}()`, start);

  if (markerIndex < 0 || start < 0 || end < 0) {
    throw new Error(`Unable to extract ${functionName} after ${marker}`);
  }

  return script.slice(start, end);
}

function runEmptyInventoryResidueReader(functionBody: string, payload: unknown) {
  return execFileSync('bash', ['-c', `${functionBody}\nread_empty_inventory_snapshot_residue "$PAYLOAD"`], {
    env: {
      ...process.env,
      PAYLOAD: JSON.stringify(payload)
    },
    encoding: 'utf8'
  }).trim();
}

function runOperatorLoginPayloadWriter(functionBody: string, input: { username: string; password: string }) {
  const output = execFileSync('bash', ['-c', `${functionBody}\nwrite_operator_login_payload "$USERNAME" "$PASSWORD"`], {
    env: {
      ...process.env,
      USERNAME: input.username,
      PASSWORD: input.password
    },
    encoding: 'utf8'
  });

  return JSON.parse(output) as { username: string; password: string };
}

function extractGeneratedCliScript(script: string) {
  const start = script.indexOf('install_management_cli() {');
  const end = script.indexOf('\n  } >"/usr/local/bin/ou-ui-next"', start);

  if (start < 0 || end < 0) {
    throw new Error('Unable to extract generated CLI script');
  }

  return script.slice(start, end);
}

function extractGeneratedCliRuntimeBody(script: string) {
  const generatedCliScript = extractGeneratedCliScript(script);
  const marker = "cat <<'EOF'\n";
  const start = generatedCliScript.indexOf(marker);
  const end = generatedCliScript.lastIndexOf('\nEOF');

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to extract generated CLI runtime body');
  }

  return generatedCliScript.slice(start + marker.length, end);
}

function runGeneratedCliCommandResult(
  script: string,
  args: string[],
  options: { username?: string; password?: string; securePath?: string } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-generated-cli-'));
  const appDir = join(directory, 'app');
  const configDir = join(directory, 'config');
  const webRoot = join(directory, 'web');
  const stateDir = join(directory, 'state');
  const nginxConf = join(directory, 'nginx.conf');
  const backendEnvFile = join(configDir, 'master.env');
  const credentialsFile = join(configDir, 'credentials.env');
  const username = options.username ?? 'operator_test';
  const password = options.password ?? 'test-password';
  const securePath = options.securePath ?? 'secure-panel';

  mkdirSync(appDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(webRoot, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(appDir, '.env.production.local'),
    [`VITE_CONTROL_PLANE_BASE_URL=/${securePath}`, `VITE_ASSET_BASE=/${securePath}/`].join('\n')
  );
  writeFileSync(nginxConf, ['server {', '  listen 8778 ssl;', '  server_name panel.example.test;', '}'].join('\n'));
  writeFileSync(backendEnvFile, '');
  writeFileSync(
    credentialsFile,
    [`OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=${username}`, `OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=${password}`].join(
      '\n'
    )
  );

  const runtimeScript = [
    'set -Eeuo pipefail',
    'APP_NAME="OU-UI Next"',
    'SERVICE_NAME="ou-ui-next"',
    `INSTALL_ROOT=${JSON.stringify(directory)}`,
    `APP_DIR=${JSON.stringify(appDir)}`,
    `CONFIG_DIR=${JSON.stringify(configDir)}`,
    `WEB_ROOT=${JSON.stringify(webRoot)}`,
    `ACME_WEBROOT=${JSON.stringify(join(directory, 'acme'))}`,
    `STATE_DIR=${JSON.stringify(stateDir)}`,
    `NGINX_CONF=${JSON.stringify(nginxConf)}`,
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    `CREDENTIALS_FILE=${JSON.stringify(credentialsFile)}`,
    'BACKEND_HOST_DEFAULT="127.0.0.1"',
    'BACKEND_PORT_DEFAULT="31080"',
    'REPO_URL="https://github.com/cshaizhihao/ou-ui-next.git"',
    'REPO_REF="main"',
    'SCRIPT_VERSION="test"',
    'INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh"',
    extractGeneratedCliRuntimeBody(script)
  ].join('\n');

  try {
    const result = spawnSync('bash', ['-s', ...args], {
      input: runtimeScript,
      encoding: 'utf8'
    });

    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runGeneratedCliCommand(
  script: string,
  args: string[],
  options: { username?: string; password?: string; securePath?: string } = {}
) {
  const result = runGeneratedCliCommandResult(script, args, options);

  if (result.status !== 0) {
    throw new Error(result.stderr || `generated CLI exited with ${result.status}`);
  }

  return result.stdout;
}

function runGeneratedCliBuildInfoRepair(script: string, options: { matchingStatic: boolean }) {
  const generatedCliScript = extractGeneratedCliScript(script);
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-build-info-repair-'));
  const appDir = join(directory, 'app');
  const webRoot = join(directory, 'web');
  const distDir = join(appDir, 'dist');
  const targetDir = join(webRoot, 'secure-panel');

  mkdirSync(distDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<title>OU-UI Next 控制面板</title><div id="root"></div>');
  writeFileSync(join(distDir, 'asset.js'), 'console.log("current");');
  writeFileSync(
    join(targetDir, 'index.html'),
    options.matchingStatic ? '<title>OU-UI Next 控制面板</title><div id="root"></div>' : '<title>Old</title>'
  );
  writeFileSync(join(targetDir, 'asset.js'), options.matchingStatic ? 'console.log("current");' : 'console.log("old");');

  const repairScript = [
    'set -Eeuo pipefail',
    'log() { printf "%s\\n" "$1"; }',
    'read_panel_path() { printf "secure-panel\\n"; }',
    'current_app_commit() { printf "abc123"; }',
    extractFunctionBefore(generatedCliScript, 'write_frontend_build_info', 'read_deployed_build_commit'),
    extractFunctionBefore(generatedCliScript, 'frontend_static_matches_current_dist', 'repair_missing_frontend_build_info'),
    extractFunctionBefore(generatedCliScript, 'repair_missing_frontend_build_info', 'check_frontend_build_fingerprint'),
    'repair_missing_frontend_build_info'
  ].join('\n');

  try {
    execFileSync('bash', ['-c', repairScript], {
      env: {
        ...process.env,
        APP_DIR: appDir,
        WEB_ROOT: webRoot,
        SCRIPT_VERSION: 'test-version'
      },
      encoding: 'utf8'
    });

    const buildInfoPath = join(targetDir, 'build-info.json');
    return {
      buildInfo: existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runExternalArchiveHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-archive-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_external_archive_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runSystemAlertWebhookHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-alert-webhook-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_system_alert_webhook_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runAgentLogRetentionHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-agent-log-retention-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_agent_log_retention_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runTrafficRollupRetentionHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-traffic-rollup-retention-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_traffic_rollup_retention_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCommandTimeoutSweepHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-command-timeout-sweep-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_command_timeout_sweep_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runOperatorAuthThrottleHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-operator-auth-throttle-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_operator_auth_throttle_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runAgentTokenConfigHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-agent-token-config-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_agent_token_config_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runSubscriptionSourceHealth(script: string, backendEnvLines: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-subscription-source-health-'));
  const backendEnvFile = join(directory, 'master.env');

  writeFileSync(backendEnvFile, backendEnvLines.join('\n'));

  const healthScript = [
    'set -Eeuo pipefail',
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    extractFunctionBefore(script, 'read_backend_env_value', 'read_credentials_env_value'),
    extractFunctionBefore(script, 'count_csv_env_values', 'control_plane_backup_directory'),
    'show_subscription_source_health'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', healthScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runInstallIdentityPreserver(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-next-preserve-identity-'));
  const appDir = join(directory, 'app');
  const configDir = join(directory, 'config');
  const backendEnvFile = join(configDir, 'master.env');
  const credentialsFile = join(configDir, 'credentials.env');

  mkdirSync(appDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(appDir, '.env.production.local'),
    [
      'VITE_CONTROL_PLANE_MODE=http',
      'VITE_CONTROL_PLANE_BASE_URL=/stable-panel',
      'VITE_ASSET_BASE=/stable-panel/'
    ].join('\n')
  );
  writeFileSync(
    backendEnvFile,
    [
      'OU_UI_CONTROL_PLANE_OPERATOR_TOKEN=operator-token-old',
      'OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=operator_old',
      'OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET=session-secret-old',
      'OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"agent-bootstrap":"agent-bootstrap-old"}'
    ].join('\n')
  );
  writeFileSync(
    credentialsFile,
    ['OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=operator_old', 'OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=password-old'].join(
      '\n'
    )
  );

  const preserveScript = [
    'set -Eeuo pipefail',
    'log() { :; }',
    `APP_DIR=${JSON.stringify(appDir)}`,
    `BACKEND_ENV_FILE=${JSON.stringify(backendEnvFile)}`,
    `CREDENTIALS_FILE=${JSON.stringify(credentialsFile)}`,
    'AGENT_BOOTSTRAP_ID=agent-bootstrap',
    'SECURE_PATH=random-panel',
    'ADMIN_USER=operator_random',
    'ADMIN_PASSWORD=password-random',
    'OPERATOR_TOKEN=operator-token-random',
    'OPERATOR_SESSION_SECRET=session-secret-random',
    'AGENT_BOOTSTRAP_TOKEN=agent-bootstrap-random',
    extractFunctionBefore(script, 'read_install_env_value', 'read_existing_secure_path'),
    extractFunctionBefore(script, 'read_existing_secure_path', 'read_existing_agent_bootstrap_token'),
    extractFunctionBefore(script, 'read_existing_agent_bootstrap_token', 'preserve_existing_install_identity_if_needed'),
    extractFunctionBefore(script, 'preserve_existing_install_identity_if_needed', 'ensure_swap_for_build'),
    'OU_UI_PRESERVE_STATE=1 preserve_existing_install_identity_if_needed',
    'printf "SECURE_PATH=%s\\n" "${SECURE_PATH}"',
    'printf "ADMIN_USER=%s\\n" "${ADMIN_USER}"',
    'printf "ADMIN_PASSWORD=%s\\n" "${ADMIN_PASSWORD}"',
    'printf "OPERATOR_TOKEN=%s\\n" "${OPERATOR_TOKEN}"',
    'printf "OPERATOR_SESSION_SECRET=%s\\n" "${OPERATOR_SESSION_SECRET}"',
    'printf "AGENT_BOOTSTRAP_TOKEN=%s\\n" "${AGENT_BOOTSTRAP_TOKEN}"'
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', preserveScript], {
      encoding: 'utf8'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('install-master.sh contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts', 'install-master.sh'), 'utf8');

  it('deploys from GitHub and installs the management shortcut commands', () => {
    expect(script).toContain('https://github.com/cshaizhihao/ou-ui-next.git');
    expect(script).toContain('git clone --branch "${DEFAULT_REPO_REF}" --depth 1 "${DEFAULT_REPO_URL}" "${APP_DIR}"');
    expect(script).toContain('管理命令：%b ou');
    expect(script).toContain('reconfigure 修改端口/证书并重新运行安装向导');
    expect(script).toContain('update|upgrade|u)');
    expect(script).toContain('fix|repair|f)');
    expect(script).toContain('do_quick_fix()');
    expect(script).toContain('rs|restart-service');
    expect(script).toContain('repair-nginx|nginx-repair)');
    expect(script).toContain('if [[ ! -f "${APP_DIR}/scripts/install-master.sh" ]]; then');
    expect(script).toContain('ensure_runtime_env_defaults()');
    expect(script).toContain('set_env_line()');
    expect(script).toContain('remove_env_line()');
    expect(script).toContain('/etc/fstab（仅低内存构建需要临时 swap 时）');
    expect(script).toContain('remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('BACKEND_PORT_DEFAULT="${BACKEND_PORT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_HOST "${BACKEND_HOST_DEFAULT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_PORT "${BACKEND_PORT_DEFAULT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_RETENTION_DAYS 7');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT 5000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_EXTERNAL_ARCHIVE_DIRECTORY "${STATE_DIR}/external-archives"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED true');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS 30000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_ACK_TIMEOUT_MS 15000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_RESULT_TIMEOUT_MS 120000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS 500');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST ""');
    expect(script).toContain('OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium');
    expect(script).toContain('OU_UI_AGENT_LOG_RETENTION_DAYS=7');
    expect(script).toContain('OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT=5000');
    expect(script).toContain('OU_UI_EXTERNAL_ARCHIVE_DIRECTORY=${STATE_DIR}/external-archives');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED=true');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS=30000');
    expect(script).toContain('OU_UI_COMMAND_ACK_TIMEOUT_MS=15000');
    expect(script).toContain('OU_UI_COMMAND_RESULT_TIMEOUT_MS=120000');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS=500');
    expect(script).toContain('OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST=');
    expect(script).toContain('reconfigure|configure|config|port|cert|ssl|tls|m)');
    expect(script).toContain('force_reset_control_plane_state()');
    expect(script).toContain('check_empty_control_plane_inventory()');
    expect(script).toContain('check_fresh_install_empty_inventory()');
    expect(script).toContain('check_agent_install_command_surface()');
    expect(script).toContain('systemctl enable "${SERVICE_NAME}"');
    expect(script).toContain('systemctl restart "${SERVICE_NAME}"');
    expect(script).not.toContain('systemctl enable --now "${SERVICE_NAME}"');
    expect(script).toContain('ou fix --force');
    expect(script).toContain('doctor|diagnose|d)');
    expect(script).toContain('reset-state|reset|r)');
    expect(script).toContain('uninstall|remove|x)');
    expect(script).toContain('快捷入口：%b ou-ui / ou / ouui / ou-ui-next');
    expect(script).toContain('link_management_cli_alias "/usr/local/bin/ouui"');
    expect(script).toContain('link_management_cli_alias "/usr/local/bin/ou-ui"');
    expect(script).toContain('link_management_cli_alias "/usr/local/bin/ou"');
    expect(script).toContain('link_management_cli_alias "/usr/bin/ou"');
    expect(script).toContain('涉及更新、重配、重启、重置和卸载时请使用 root 执行');
    expect(script).toContain('write_backend_env\n  install_management_cli\n  install_dependencies_and_build');
    expect(script).toContain('warn() {\n  printf "[警告] %s\\n" "$1"\n}');
    expect(script).not.toContain('backend_port="31080"');
  });

  it('warns about port collisions without forcing 443 as the default', () => {
    expect(script).toContain('warn_panel_port_collision_risk()');
    expect(script).toContain('443 最容易和现有网站、反向代理或旧面板冲突');
    expect(script).toContain('请输入 Master 面板监听端口 [默认 8443]');
    expect(script).toContain('请重新输入 HTTPS 面板监听端口 [默认 8443]');
    expect(script).toContain('confirm_reserved_https_port()');
    expect(script).toContain('system_port_conflict_preflight()');
    expect(script).toContain('ss -H -ltnp');
    expect(script).toContain('端口已经被非 Nginx 进程监听');
    expect(script).toContain('域名 HTTPS 模式请使用可用的 HTTPS 端口，80 仅用于 ACME 校验和跳转。');
    expect(script.match(/confirm_reserved_https_port "\$\{input\}"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('serves the frontend login page instead of enabling browser Basic Auth', () => {
    expect(script).toContain('VITE_DISABLE_IN_APP_LOGIN=false');
    expect(script).not.toContain('VITE_CONTROL_PLANE_LOGIN_PASSWORD=${ADMIN_PASSWORD}');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_USERNAME=${ADMIN_USER}');
    expect(script).not.toContain('OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD=${ADMIN_PASSWORD}');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH=${operator_password_hash}');
    expect(script).toContain('write_operator_credentials "${ADMIN_USER}" "${ADMIN_PASSWORD}"');
    expect(script).toContain('CREDENTIALS_FILE="${CREDENTIALS_FILE}"');
    expect(script).toContain('rotate_operator_credentials()');
    expect(script).toContain('username="operator_$(generate_cli_secret 8)"');
    expect(script).toContain('password="$(generate_cli_secret 22)"');
    expect(script).toContain('set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH "${password_hash}"');
    expect(script).toContain('remove_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD');
    expect(script).toContain('set_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET "$(generate_cli_secret 64)"');
    expect(script).toContain('rotate-credentials|rotate-login|credential-rotate|password-reset|rc)');
    expect(script).toContain('should_preserve_backend_operator_password_for_legacy_update()');
    expect(script).toContain('! grep -q \'read_credentials_env_value\' "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH}"');
    expect(script).toContain('remove_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_SESSION_SECRET=${OPERATOR_SESSION_SECRET}');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_SESSION_TTL_MS=28800000');
    expect(script).not.toContain('VITE_CONTROL_PLANE_OPERATOR_TOKEN=${OPERATOR_TOKEN}');
    expect(script).not.toContain('set_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_LOGIN_PASSWORD');
    expect(script).toContain('proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}"');
    expect(script).toContain('proxy_set_header Authorization "Bearer ${operator_token}"');
    expect(script).toContain('location = /${SECURE_PATH}/api/v1/auth/session');
    expect(script).toContain('location = /${panel_path}/api/v1/auth/session');
    expect(script).toContain('location = /${SECURE_PATH}/api/v1/auth/session/check');
    expect(script).toContain('location = /${panel_path}/api/v1/auth/session/check');
    expect(script.match(/auth_request \/\$\{(?:SECURE_PATH|panel_path)\}\/api\/v1\/auth\/session\/check;/g)?.length).toBeGreaterThanOrEqual(12);
    expect(script.match(/internal;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/proxy_method GET;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/proxy_pass_request_body off;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/proxy_set_header Content-Length "";/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script).toContain('面板 Basic Auth: 已关闭，应该显示前端登录页');
    expect(script).toContain('OU-UI Next 安装诊断');
    expect(script).toContain('若浏览器弹系统账号密码框，通常是端口/域名命中了旧站点：');
    expect(script).toContain('WWW-Authenticate: ${panel_auth:-未返回}');
    expect(script).toContain('check_panel_http_surface()');
    expect(script).toContain('refresh_nginx_panel_config()');
    expect(script).toContain('check_panel_surface()');
    expect(script).toContain('current_app_commit()');
    expect(script).toContain('write_frontend_build_info()');
    expect(script).toContain('read_deployed_build_commit()');
    expect(script).toContain('frontend_static_matches_current_dist()');
    expect(script).toContain('repair_missing_frontend_build_info()');
    expect(script).toContain('check_frontend_build_fingerprint()');
    expect(script).toContain('"${target_dir}/build-info.json"');
    expect(script).toContain('"commit":"${commit}"');
    expect(script).toContain('write_frontend_build_info "${WEB_ROOT}/${SECURE_PATH}"');
    expect(script).toContain('write_frontend_build_info "${WEB_ROOT}/${panel_path}"');
    expect(script).toContain('rsync -rcni --delete --exclude build-info.json "${APP_DIR}/dist/" "${target_dir}/"');
    expect(script).toContain('check_frontend_build_fingerprint "${url}"');
    expect(script).toContain('前端构建指纹缺失，已为当前静态目录补写。');
    expect(script).toContain('deployed_commit="$(read_deployed_build_commit "${base_url}")"');
    expect(script).toContain('前端构建指纹自检通过');
    expect(script).toContain('前端构建提交: ${deployed_commit:-无法确认}');
    expect(script).toContain('for attempt in 1 2 3 4 5; do');
    expect(script).toContain('body="$(curl -k -sSL --max-time 10 "${url}" 2>/dev/null || true)"');
    expect(script).toContain('面板 URL 自检连续 5 次未取到响应');
    expect(script).toContain('Nginx 面板站点已刷新，并强制关闭 Basic Auth。');
    expect(script).toContain('已命中 OU-UI Next 前端登录页，未发现 WWW-Authenticate: Basic');
    expect(script).toContain('<title>OU-UI Next 控制面板</title>');
    expect(script).toContain('id="root"');
    expect(script).toContain('面板 URL 自检没有拿到 OU-UI Next 前端登录页');
    expect(script).toContain('面板 URL 没有返回 OU-UI Next 前端登录页');
    expect(script).toContain('检测到 Nginx 已有配置监听 ${PANEL_PORT} 端口并启用了 Basic Auth');
    expect(script).toContain('find -L /etc/nginx');
    expect(script).toContain('运行 ou d 查看冲突路径');
    expect(script).toContain('nginx_supports_standalone_http2()');
    expect(script).toContain('nginx_http2_listen_suffix()');
    expect(script).toContain('nginx_http2_directive_line()');
    expect(script).toContain('listen ${PANEL_PORT} ssl${http2_listen_suffix} default_server;');
    expect(script).toContain('listen ${listen} ssl${http2_listen_suffix} default_server;');
    expect(script).toContain('http2_directive="$(nginx_http2_directive_line)"');
    expect(script).toContain("printf '    http2 on;'");
    expect(script).not.toContain('ssl http2 default_server;');
    expect(script.match(/auth_basic off;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(script).not.toMatch(/auth_basic\s+(?!off\b)/);
    expect(script).not.toContain('auth_basic_user_file');
  });

  it('repairs missing deployed frontend build metadata only when static files match the current build', () => {
    expect(runGeneratedCliBuildInfoRepair(script, { matchingStatic: true }).buildInfo).toContain('"commit":"abc123"');
    expect(runGeneratedCliBuildInfoRepair(script, { matchingStatic: false }).buildInfo).toBe('');
  });

  it('keeps generated CLI credential help from printing stored secrets', () => {
    const password = 'secret-password-that-must-not-appear-in-help';

    expect(runGeneratedCliCommand(script, ['credentials'], { password })).toContain(password);

    const credentialsHelp = runGeneratedCliCommand(script, ['credentials', '--help'], { password });
    expect(credentialsHelp).toContain('用法: ou-ui-next credentials');
    expect(credentialsHelp).toContain('不会读取或输出任何登录凭据');
    expect(credentialsHelp).not.toContain(password);

    const aliasHelp = runGeneratedCliCommand(script, ['c', '-h'], { password });
    expect(aliasHelp).toContain('用法: ou-ui-next credentials');
    expect(aliasHelp).not.toContain(password);

    const extraArgumentResult = runGeneratedCliCommandResult(script, ['credentials', '--json'], { password });
    expect(extraArgumentResult.status).not.toBe(0);
    expect(extraArgumentResult.stderr).toContain('credentials 不接受额外参数');
    expect(extraArgumentResult.stderr).not.toContain(password);
    expect(extraArgumentResult.stdout).not.toContain(password);
  });

  it('JSON-encodes installer login self-check credentials without curl argument interpolation', () => {
    const credentials = {
      username: 'operator_"quoted"',
      password: 'p@ss"word\\with\\slashes$'
    };
    const generatedCliBody = extractGeneratedCliRuntimeBody(script);

    expect(
      runOperatorLoginPayloadWriter(
        extractFunctionBefore(generatedCliBody, 'write_operator_login_payload', 'create_panel_session_cookie_file'),
        credentials
      )
    ).toEqual(credentials);
    expect(
      runOperatorLoginPayloadWriter(
        extractFunctionAfter(
          script,
          'read_empty_inventory_snapshot_residue()',
          'write_operator_login_payload',
          'create_install_session_cookie_file'
        ),
        credentials
      )
    ).toEqual(credentials);
    expect(script).toContain('write_operator_login_payload "${username}" "${password}" | curl');
    expect(script).toContain('write_operator_login_payload "${ADMIN_USER}" "${ADMIN_PASSWORD}" | curl');
    expect(script.match(/--data-binary @-/g)).toHaveLength(2);
    expect(script).not.toContain('--data "{\\"username\\":');
  });

  it('checks Nginx default_server and Basic Auth conflicts at server-block scope', () => {
    expect(script).toContain('nginx_server_block_has_port_directive()');
    expect(script).toContain('nginx_server_block_has_port_basic_auth()');
    expect(script).toContain('if nginx_server_block_has_port_directive "${candidate_conf}" default_server; then');
    expect(script).toContain('if nginx_server_block_has_port_basic_auth "${candidate_conf}"; then');
    expect(script).toContain('lower_line ~ /auth_basic[[:space:]]+[^;]+;/');
    expect(script).not.toContain(
      'grep -Eq "listen[[:space:]]+([^;]*:)?${PANEL_PORT}([^0-9;]|;)" "${candidate_conf}" &&'
    );
  });

  it('proxies public subscription downloads without operator bearer injection', () => {
    const subBlocks = script
      .split('location ^~ /sub/ {')
      .slice(1)
      .map((block) => block.slice(0, block.indexOf('\n    }')));

    expect(subBlocks.length).toBeGreaterThanOrEqual(2);
    subBlocks.forEach((block) => {
      expect(block).toMatch(/proxy_pass http:\/\/\$\{(?:BACKEND_HOST|backend_host)\}:\$\{(?:BACKEND_PORT|backend_port)\};/);
      expect(block).not.toContain('Authorization');
    });
  });

  it('proxies protected task event streams with operator bearer injection and SSE buffering disabled', () => {
    const eventBlocks = [
      ...script.split('location ^~ /${SECURE_PATH}/events/ {').slice(1),
      ...script.split('location ^~ /${panel_path}/events/ {').slice(1)
    ].map((block) => block.slice(0, block.indexOf('\n    }')));

    expect(eventBlocks.length).toBeGreaterThanOrEqual(4);
    eventBlocks.forEach((block) => {
      expect(block).toContain('proxy_http_version 1.1;');
      expect(block).toMatch(/auth_request \/\$\{(?:SECURE_PATH|panel_path)\}\/api\/v1\/auth\/session\/check;/);
      expect(block).toMatch(/proxy_set_header Authorization "Bearer \$\{(?:OPERATOR_TOKEN|operator_token)\}";/);
      expect(block).toContain('proxy_buffering off;');
      expect(block).toContain('proxy_cache off;');
      expect(block).toContain('proxy_read_timeout 1h;');
      expect(block).not.toContain('$http_authorization');
    });
  });

  it('proxies protected Prometheus metrics through the panel security prefix', () => {
    const metricsBlocks = [
      ...script.split('location = /${SECURE_PATH}/metrics {').slice(1),
      ...script.split('location = /${panel_path}/metrics {').slice(1)
    ].map((block) => block.slice(0, block.indexOf('\n    }')));

    expect(metricsBlocks.length).toBeGreaterThanOrEqual(4);
    metricsBlocks.forEach((block) => {
      expect(block).toContain('/metrics$ /metrics break;');
      expect(block).toMatch(/auth_request \/\$\{(?:SECURE_PATH|panel_path)\}\/api\/v1\/auth\/session\/check;/);
      expect(block).toMatch(/proxy_pass http:\/\/\$\{(?:BACKEND_HOST|backend_host)\}:\$\{(?:BACKEND_PORT|backend_port)\};/);
      expect(block).toMatch(/proxy_set_header Authorization "Bearer \$\{(?:OPERATOR_TOKEN|operator_token)\}";/);
      expect(block).not.toContain('$http_authorization');
    });
  });

  it('refreshes management shortcuts during GitHub updates', () => {
    expect(script).toContain('OU_UI_NEXT_CLI_UPDATE_FROM_TEMP');
    expect(script).toContain('OU_UI_NEXT_CLI_UPDATE_TEMP_PATH="${temp_cli}" exec bash "${temp_cli}" update');
    expect(script).toContain('trap \'rm -f "${OU_UI_NEXT_CLI_UPDATE_TEMP_PATH}"\' EXIT');
    expect(script).toContain('if [[ -f "${APP_DIR}/scripts/install-master.sh" ]]; then');
    expect(script).toContain('bash "${APP_DIR}/scripts/install-master.sh" repair-cli');
    expect(script).toContain('if [[ -x "/usr/local/bin/ou-ui-next" ]]; then');
    expect(script).toContain('/usr/local/bin/ou-ui-next repair-nginx');
    expect(script).toContain('repair-nginx|nginx-repair)\n    ensure_runtime_env_defaults\n    systemctl restart "${SERVICE_NAME}"');
    expect(script).toContain('else\n    refresh_nginx_panel_config\n    check_panel_surface\n  fi');
    expect(script).toContain('if [[ "${1:-}" == "repair-cli" ]]; then');
    expect(script).toContain('/usr/local/bin/ou-ui-next repair-nginx');
    expect(script).toContain('repair-nginx 重新写入面板 Nginx 配置并检查 Basic Auth 残留');
    expect(script).toContain('管理命令已刷新：ou-ui / ou / ouui / ou-ui-next');
    expect(script.match(/proxy_hide_header Content-Type;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/add_header Content-Type "text\/event-stream; charset=utf-8" always;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/add_header Cache-Control "no-cache" always;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/gzip off;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('exposes control-plane backup and restore maintenance commands', () => {
    expect(script).toContain('control_plane_backup_directory()');
    expect(script).toContain('default_control_plane_backup_path()');
    expect(script).toContain('control_plane_backup_manifest_path()');
    expect(script).toContain('write_control_plane_backup_manifest()');
    expect(script).toContain('validate_control_plane_backup_manifest()');
    expect(script).toContain('sha256_file()');
    expect(script).toContain('backup_control_plane_state_to_path()');
    expect(script).toContain('backup_control_plane_state()');
    expect(script).toContain('restore_control_plane_state()');
    expect(script).toContain('"schemaVersion":"ou-ui-next.control-plane-backup.v1"');
    expect(script).toContain('"sqliteMigrations":${sqlite_migrations_json}');
    expect(script).toContain('Array.isArray(manifest.sqliteMigrations)');
    expect(script).toContain('Number.isSafeInteger(item.version)');
    expect(script).toContain('write_control_plane_backup_manifest "${backup_path}" "${storage_mode}" "${state_file}"');
    expect(script).toContain('validate_control_plane_backup_manifest "${backup_file}"');
    expect(script).toContain('/^[a-f0-9]{64}$/i.test(m.sha256)');
    expect(script).toContain('备份 SHA-256 校验失败');
    expect(script).toContain('控制面备份 manifest 已写入');
    expect(script).toContain('node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" backup');
    expect(script).toContain('node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" restore');
    expect(script).toContain('pre-restore-${storage_mode}-$(date -u +%Y%m%dT%H%M%SZ)');
    expect(script).toContain('restore_staging_path="${state_file}.restore-$(date -u +%Y%m%dT%H%M%SZ)-$$"');
    expect(script).toContain('mv "${restore_staging_path}" "${state_file}"');
    expect(script).toContain('9) 备份控制面状态');
    expect(script).toContain('10) 从备份恢复控制面状态');
    expect(script).toContain('12) 轮换登录凭据');
    expect(script).toContain('快捷键：p=面板信息 c=登录信息 rc=轮换登录凭据 s=服务状态 l=实时日志 rs=重启服务 u=更新 b=备份 rb=恢复');
    expect(script).toContain('10|rb|RB|restore|RESTORE)');
    expect(script).toContain('12|rc|RC|rotate|ROTATE)');
    expect(script).toContain('backup-state|backup|b)');
    expect(script).toContain('restore-state|restore)');
    expect(script).toContain('backup-state 创建当前控制面存储备份，可选自定义输出路径，并写入 .manifest.json');
    expect(script).toContain('restore-state 用备份文件覆盖当前控制面存储，调用时传入备份路径；有 manifest 时会先校验，追加 yes 可跳过交互确认');
  });

  it('validates sqlite storage during doctor diagnostics', () => {
    expect(script).toContain('sqlite_validate_output');
    expect(script).toContain('node "${APP_DIR}/scripts/control-plane-sqlite-tool.cjs" validate "${state_file}"');
    expect(script).toContain('SQLite 数据库: 已存在，schema 校验通过');
    expect(script).toContain('SQLite 数据库: 已存在，但 schema 校验失败');
    expect(script).toContain('缺少 sqlite 校验工具，无法执行 schema 校验');
  });

  it('reports external archive configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_external_archive_health()');
    expect(script).toContain(
      'show_external_archive_health\n  show_agent_log_retention_health\n  show_traffic_rollup_retention_health\n  show_command_timeout_sweep_health\n  show_operator_auth_throttle_health\n  show_agent_token_config_health\n  show_system_alert_webhook_health\n  show_subscription_source_health\n\n  if systemctl is-active'
    );
    expect(script).toContain('OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT');
    expect(script).toContain('外部归档对象存储: 配置不完整');
    expect(script).toContain('endpoint 含 credentials、query 或 fragment');
    expect(script).toContain('endpoint host 无法解析');
    expect(script).toContain('endpoint host=${object_host} 属于本机/私网/保留地址');

    const configured = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_DIRECTORY=/var/lib/ou-ui-next/external-archives',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL=https://archives.example.com/ou-ui',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS=https://siem.example.com/ou-ui, https://warehouse.example.com/ou-ui',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST=archives.example.com,*.trusted-archives.example.com',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN=archive-webhook-token',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS=2500',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT=https://objects.example.com',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET=ou-ui-archives',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION=auto',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID=archive-access-key',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY=archive-secret-key',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX=prod/hkg',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS=2500',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE=false',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST=objects.example.com'
    ]);
    expect(configured).toContain('外部归档目录: 已配置 (/var/lib/ou-ui-next/external-archives)');
    expect(configured).toContain('外部归档 webhook: 已配置 3 个目标');
    expect(configured).toContain('外部归档 webhook allowlist: archives.example.com,*.trusted-archives.example.com');
    expect(configured).toContain('外部归档 webhook bearer: 已配置');
    expect(configured).toContain('外部归档 webhook timeout: 2500ms');
    expect(configured).toContain('外部归档 webhook target-1: host=archives.example.com');
    expect(configured).toContain('外部归档 webhook target-2: host=siem.example.com');
    expect(configured).toContain('外部归档 webhook target-3: host=warehouse.example.com');
    expect(configured).toContain('外部归档对象存储 timeout: 2500ms');
    expect(configured).toContain('外部归档对象存储 forcePathStyle: false');
    expect(configured).toContain(
      '外部归档对象存储: 已配置 endpointHost=objects.example.com bucket=ou-ui-archives region=auto pathStyle=false'
    );
    expect(configured).toContain('外部归档对象存储 prefix: prod/hkg');
    expect(configured).toContain('外部归档对象存储 allowlist: objects.example.com');
    expect(configured).not.toContain('archive-webhook-token');
    expect(configured).not.toContain('archive-secret-key');

    const incomplete = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT=https://objects.example.com',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET=ou-ui-archives'
    ]);
    expect(incomplete).toContain(
      '外部归档对象存储: 配置不完整，缺少 OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION, OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID, OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY'
    );

    const blocked = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT=https://127.0.0.1',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET=ou-ui-archives',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION=auto',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID=archive-access-key',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY=archive-secret-key'
    ]);
    expect(blocked).toContain(
      '外部归档对象存储: endpoint host=127.0.0.1 属于本机/私网/保留地址，后端会拒绝远端投递'
    );

    const blockedWebhook = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL=https://127.0.0.1/ou-ui'
    ]);
    expect(blockedWebhook).toContain(
      '外部归档 webhook: target-1 host=127.0.0.1 属于本机/私网/保留地址，投递时会被拦截'
    );

    const invalidWebhook = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL=ftp://archives.example.com/ou-ui'
    ]);
    expect(invalidWebhook).toContain('外部归档 webhook: target-1 不是 http/https URL，后端会拒绝启动');

    const invalidWebhookTimeout = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL=https://archives.example.com/ou-ui',
      'OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS=0'
    ]);
    expect(invalidWebhookTimeout).toContain('外部归档 webhook timeout: 0（无效，必须是正整数；后端会拒绝启动）');

    const invalidObjectStorageOptions = runExternalArchiveHealth(script, [
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT=https://objects.example.com',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET=ou-ui-archives',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION=auto',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID=archive-access-key',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY=archive-secret-key',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS=0',
      'OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE=maybe'
    ]);
    expect(invalidObjectStorageOptions).toContain(
      '外部归档对象存储 timeout: 0（无效，必须是正整数；后端会拒绝启动）'
    );
    expect(invalidObjectStorageOptions).toContain(
      '外部归档对象存储 forcePathStyle: maybe（无效，必须是 true/false/1/0/yes/no/on/off；后端会拒绝启动）'
    );
  });

  it('reports Agent log retention configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_agent_log_retention_health()');
    expect(script).toContain('OU_UI_AGENT_LOG_RETENTION_DAYS');
    expect(script).toContain('OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT');
    expect(script).toContain('Agent 日志留存天数');
    expect(script).toContain('Agent 日志每台 Agent 最大事件数');

    const configured = runAgentLogRetentionHealth(script, [
      'OU_UI_AGENT_LOG_RETENTION_DAYS=0.5',
      'OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT=0'
    ]);
    expect(configured).toContain('Agent 日志留存天数: 0.5 天');
    expect(configured).toContain('Agent 日志每台 Agent 最大事件数: 0');

    const defaults = runAgentLogRetentionHealth(script, []);
    expect(defaults).toContain('Agent 日志留存天数: 默认 7 天');
    expect(defaults).toContain('Agent 日志每台 Agent 最大事件数: 默认 5000');

    const invalid = runAgentLogRetentionHealth(script, [
      'OU_UI_AGENT_LOG_RETENTION_DAYS=0',
      'OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT=-1'
    ]);
    expect(invalid).toContain('Agent 日志留存天数: 0（无效，必须是正数；后端会拒绝启动）');
    expect(invalid).toContain('Agent 日志每台 Agent 最大事件数: -1（无效，必须是非负整数；后端会拒绝启动）');
  });

  it('reports traffic rollup retention configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_traffic_rollup_retention_health()');
    expect(script).toContain('OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS');
    expect(script).toContain('OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE');
    expect(script).toContain('流量历史留存天数');
    expect(script).toContain('流量历史每个 scope 最大记录数');

    const configured = runTrafficRollupRetentionHealth(script, [
      'OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS=1.5',
      'OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE=0'
    ]);
    expect(configured).toContain('流量历史留存天数: 1.5 天');
    expect(configured).toContain('流量历史每个 scope 最大记录数: 0');

    const defaults = runTrafficRollupRetentionHealth(script, []);
    expect(defaults).toContain('流量历史留存天数: 默认 62 天');
    expect(defaults).toContain('流量历史每个 scope 最大记录数: 默认 200000');

    const invalid = runTrafficRollupRetentionHealth(script, [
      'OU_UI_TRAFFIC_ROLLUP_RETENTION_DAYS=0',
      'OU_UI_TRAFFIC_ROLLUP_MAX_RECORDS_PER_SCOPE=-1'
    ]);
    expect(invalid).toContain('流量历史留存天数: 0（无效，必须是正数；后端会拒绝启动）');
    expect(invalid).toContain('流量历史每个 scope 最大记录数: -1（无效，必须是非负整数；后端会拒绝启动）');
  });

  it('reports command timeout sweep configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_command_timeout_sweep_health()');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED');
    expect(script).toContain('OU_UI_COMMAND_ACK_TIMEOUT_MS');
    expect(script).toContain('OU_UI_COMMAND_RESULT_TIMEOUT_MS');
    expect(script).toContain('Agent 命令超时扫描');

    const configured = runCommandTimeoutSweepHealth(script, [
      'OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED=false',
      'OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS=60000',
      'OU_UI_COMMAND_ACK_TIMEOUT_MS=5000',
      'OU_UI_COMMAND_RESULT_TIMEOUT_MS=90000',
      'OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS=25'
    ]);
    expect(configured).toContain('Agent 命令超时扫描: false');
    expect(configured).toContain('Agent 命令超时扫描间隔: 60000ms');
    expect(configured).toContain('Agent 命令 ACK 超时: 5000ms');
    expect(configured).toContain('Agent 命令 result 超时: 90000ms');
    expect(configured).toContain('Agent 命令超时扫描每轮上限: 25');

    const defaults = runCommandTimeoutSweepHealth(script, []);
    expect(defaults).toContain('Agent 命令超时扫描: 默认启用');
    expect(defaults).toContain('Agent 命令超时扫描间隔: 默认 30000ms');
    expect(defaults).toContain('Agent 命令 ACK 超时: 默认 15000ms');
    expect(defaults).toContain('Agent 命令 result 超时: 默认 120000ms');
    expect(defaults).toContain('Agent 命令超时扫描每轮上限: 默认 500');

    const invalid = runCommandTimeoutSweepHealth(script, [
      'OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED=maybe',
      'OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS=0',
      'OU_UI_COMMAND_ACK_TIMEOUT_MS=abc',
      'OU_UI_COMMAND_RESULT_TIMEOUT_MS=-1',
      'OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS=0'
    ]);
    expect(invalid).toContain(
      'Agent 命令超时扫描: maybe（无效，必须是 true/false/1/0/yes/no/on/off；后端会拒绝启动）'
    );
    expect(invalid).toContain('Agent 命令超时扫描间隔: 0（无效，必须是正整数；后端会拒绝启动）');
    expect(invalid).toContain('Agent 命令 ACK 超时: abc（无效，必须是正整数；后端会拒绝启动）');
    expect(invalid).toContain('Agent 命令 result 超时: -1（无效，必须是正整数；后端会拒绝启动）');
    expect(invalid).toContain('Agent 命令超时扫描每轮上限: 0（无效，必须是正整数；后端会拒绝启动）');
  });

  it('reports operator auth throttle configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_operator_auth_throttle_health()');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS');
    expect(script).toContain('OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT');
    expect(script).toContain('Operator 登录失败限流窗口');
    expect(script).toContain('Operator 登录失败限流阈值');

    const configured = runOperatorAuthThrottleHealth(script, [
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS=120000',
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT=10'
    ]);
    expect(configured).toContain('Operator 登录失败限流窗口: 120000ms');
    expect(configured).toContain('Operator 登录失败限流阈值: 10');

    const defaults = runOperatorAuthThrottleHealth(script, []);
    expect(defaults).toContain('Operator 登录失败限流窗口: 默认 60000ms');
    expect(defaults).toContain('Operator 登录失败限流阈值: 默认 20');

    const invalid = runOperatorAuthThrottleHealth(script, [
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS=0',
      'OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT=abc'
    ]);
    expect(invalid).toContain('Operator 登录失败限流窗口: 0（无效，必须是正整数；后端会拒绝启动）');
    expect(invalid).toContain('Operator 登录失败限流阈值: abc（无效，必须是正整数；后端会拒绝启动）');
  });

  it('reports Agent token JSON configuration health during doctor diagnostics without leaking tokens', () => {
    expect(script).toContain('show_agent_token_config_health()');
    expect(script).toContain('OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON');
    expect(script).toContain('Agent 静态认证凭证');

    const configured = runAgentTokenConfigHealth(script, [
      'OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"agent-bootstrap":"bootstrap-token","agent-hkg":"runtime-token"}'
    ]);
    expect(configured).toContain('Agent 静态认证凭证: 有效 2 个');
    expect(configured).not.toContain('bootstrap-token');
    expect(configured).not.toContain('runtime-token');

    const ignored = runAgentTokenConfigHealth(script, [
      'OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON={"agent-bootstrap":"bootstrap-token","empty":"","number":42}'
    ]);
    expect(ignored).toContain('Agent 静态认证凭证: 有效 1 个，忽略 2 个空/非字符串条目');
    expect(ignored).not.toContain('bootstrap-token');

    const defaults = runAgentTokenConfigHealth(script, []);
    expect(defaults).toContain('Agent 静态认证凭证: 未配置');

    const invalidJson = runAgentTokenConfigHealth(script, ['OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON=not-json']);
    expect(invalidJson).toContain('Agent 静态认证凭证: JSON 无效或不是 object（后端会拒绝启动）');

    const invalidShape = runAgentTokenConfigHealth(script, ['OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON=[]']);
    expect(invalidShape).toContain('Agent 静态认证凭证: JSON 无效或不是 object（后端会拒绝启动）');
  });

  it('reports system alert webhook configuration health during doctor diagnostics', () => {
    expect(script).toContain('show_system_alert_webhook_health()');
    expect(script).toContain(
      'show_external_archive_health\n  show_agent_log_retention_health\n  show_traffic_rollup_retention_health\n  show_command_timeout_sweep_health\n  show_operator_auth_throttle_health\n  show_agent_token_config_health\n  show_system_alert_webhook_health\n  show_subscription_source_health\n\n  if systemctl is-active'
    );
    expect(script).toContain('OU_UI_SYSTEM_ALERT_WEBHOOK_URL');
    expect(script).toContain('系统告警 webhook: 已配置 ${webhook_count} 个目标');
    expect(script).toContain('系统告警 webhook bearer: 已配置');
    expect(script).toContain('show_positive_integer_config_health "系统告警 webhook timeout"');
    expect(script).toContain('系统告警 webhook: ${target_label} host=${host} 属于本机/私网/保留地址');

    const configured = runSystemAlertWebhookHealth(script, [
      'OU_UI_SYSTEM_ALERT_WEBHOOK_URL=https://alerts.example.com/ou-ui',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_URLS=https://pager.example.com/ou-ui, https://chatops.example.com/ou-ui',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_EGRESS_ALLOWLIST=alerts.example.com,*.trusted-alerts.example.com',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN=alert-webhook-token',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS=2500',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS=1500',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS=4',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS=500',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP=8'
    ]);
    expect(configured).toContain('系统告警 webhook: 已配置 3 个目标');
    expect(configured).toContain('系统告警 webhook allowlist: alerts.example.com,*.trusted-alerts.example.com');
    expect(configured).toContain('系统告警 webhook bearer: 已配置');
    expect(configured).toContain('系统告警 webhook timeout: 2500ms');
    expect(configured).toContain('系统告警 webhook retryDelay: 1500ms');
    expect(configured).toContain('系统告警 webhook maxAttempts: 4');
    expect(configured).toContain('系统告警 webhook retrySweepInterval: 500ms');
    expect(configured).toContain('系统告警 webhook maxDeliveriesPerSweep: 8');
    expect(configured).toContain('系统告警 webhook target-1: host=alerts.example.com');
    expect(configured).toContain('系统告警 webhook target-2: host=pager.example.com');
    expect(configured).toContain('系统告警 webhook target-3: host=chatops.example.com');
    expect(configured).not.toContain('alert-webhook-token');

    const blocked = runSystemAlertWebhookHealth(script, ['OU_UI_SYSTEM_ALERT_WEBHOOK_URL=https://127.0.0.1/alerts']);
    expect(blocked).toContain(
      '系统告警 webhook: target-1 host=127.0.0.1 属于本机/私网/保留地址，投递时会被拦截'
    );

    const invalid = runSystemAlertWebhookHealth(script, ['OU_UI_SYSTEM_ALERT_WEBHOOK_URL=ftp://alerts.example.com/ou-ui']);
    expect(invalid).toContain('系统告警 webhook: target-1 不是 http/https URL，后端会拒绝启动');

    const invalidNumbers = runSystemAlertWebhookHealth(script, [
      'OU_UI_SYSTEM_ALERT_WEBHOOK_URL=https://alerts.example.com/ou-ui',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS=0',
      'OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS=abc'
    ]);
    expect(invalidNumbers).toContain('系统告警 webhook timeout: 0（无效，必须是正整数；后端会拒绝启动）');
    expect(invalidNumbers).toContain('系统告警 webhook maxAttempts: abc（无效，必须是正整数；后端会拒绝启动）');
  });

  it('reports subscription source guardrail health during doctor diagnostics', () => {
    expect(script).toContain('show_subscription_source_health()');
    expect(script).toContain('OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST');
    expect(script).toContain('订阅源远程拉取 allowlist');
    expect(script).toContain('订阅源 provider host 并发上限');

    const configured = runSubscriptionSourceHealth(script, [
      'OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST=provider.example.com,*.trusted-provider.example.com',
      'OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST=3',
      'OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY=12',
      'OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY=1048576'
    ]);
    expect(configured).toContain(
      '订阅源远程拉取 allowlist: provider.example.com,*.trusted-provider.example.com'
    );
    expect(configured).toContain('订阅源 provider host 并发上限: 3');
    expect(configured).toContain('订阅源每日同步次数上限: 12');
    expect(configured).toContain('订阅源每日同步字节上限: 1048576 bytes');

    const defaults = runSubscriptionSourceHealth(script, []);
    expect(defaults).toContain('订阅源远程拉取 allowlist: 未配置（仍会拦截 localhost/私网/本机目标）');
    expect(defaults).toContain('订阅源 provider host 并发上限: 默认 2');
    expect(defaults).toContain('订阅源每日同步预算: 未配置全局上限');

    const invalid = runSubscriptionSourceHealth(script, [
      'OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST=0',
      'OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY=abc'
    ]);
    expect(invalid).toContain('订阅源 provider host 并发上限: 0（无效，必须是正整数；后端会拒绝启动）');
    expect(invalid).toContain('订阅源每日同步字节上限: abc（无效，必须是正整数；后端会拒绝启动）');
  });

  it('reports operator credential storage health during doctor diagnostics', () => {
    expect(script).toContain('operator_password_plain="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD)"');
    expect(script).toContain('operator_password_hash="$(read_backend_env_value OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH)"');
    expect(script).toContain('登录凭据存储: 后端 hash 已启用，后端环境未保存明文密码');
    expect(script).toContain('root-only 凭据文件: 已保存，权限 ${credentials_mode}');
    expect(script).toContain('ou c 可能无法显示登录密码');
    expect(script).toContain('登录凭据强度: 检测到默认/弱凭据，建议运行 ou-ui rotate-credentials 立即轮换');
    expect(script).toContain('登录凭据强度: 未发现默认凭据');
  });

  it('removes installer-created build swap during uninstall', () => {
    expect(script).toContain('remove_build_swap()');
    expect(script).toContain('local swap_file="${STATE_DIR}/ou-ui-next.swap"');
    expect(script).toContain('swapoff "${swap_file}" >/dev/null 2>&1 || true');
    expect(script).toContain('awk -v swap_line="${swap_file} none swap sw 0 0"');
    expect(script).toContain('rm -f "${swap_file}"');
    expect(script).toContain('systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true\n  remove_build_swap');
  });

  it('uses empty production inventory and preserves state during reconfigure flows', () => {
    expect(script).toContain('OU_UI_CONTROL_PLANE_INITIAL_STATE=empty');
    expect(script).toContain('reset_control_plane_state_if_needed');
    expect(script).toContain('reset_control_plane_state()');
    expect(script).toContain('按全新安装流程重置');
    expect(script).toContain('OU_UI_PRESERVE_STATE');
    expect(script).toContain('重新打开安装向导，以便修改端口、证书和 Nginx 相关配置。');
    expect(script).toContain('preserve_existing_install_identity_if_needed()');
    expect(script).toContain('read_existing_secure_path()');
    expect(script).toContain('read_existing_agent_bootstrap_token()');
    expect(script).toContain('generate_secrets\n  preserve_existing_install_identity_if_needed');
    expect(script).toContain('检测到重配模式：保留现有面板安全路径、登录凭据和后端认证令牌。');
    expect(script).toContain('read_empty_inventory_snapshot_residue()');
    expect(script).toContain('poll_empty_inventory_snapshot_residue()');
    expect(script).toContain('elif (.data | type) != "object" then empty');
    expect(script.match(/\. as \$snapshot/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/\$snapshot\.data\[\$key\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('read_demo_inventory_snapshot_residue()');
    expect(script).toContain('poll_demo_inventory_snapshot_residue()');
    expect(script).toContain('warn_demo_inventory_residue()');
    expect(script).toContain('create_panel_session_cookie_file()');
    expect(script).toContain('create_install_session_cookie_file()');
    expect(script).toContain('read_session_csrf_token()');
    expect(script).toContain('remove_session_cookie_file()');
    expect(script).toContain('jq -er \'.data.csrfToken // empty\'');
    expect(script).toContain('>"${cookie_file}.csrf"');
    expect(script).toContain('rm -f "${cookie_file}" "${cookie_file}.csrf"');
    expect(script.match(/trap 'remove_session_cookie_file "\$\{cookie_file\}"; trap - RETURN' RETURN/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script.match(/case "\$\{status:-000\}" in/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/000\|502\|503\|504\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('${base_url%/}/api/v1/snapshot');
    expect(script).toContain('"subscriptionInventoryNodes"');
    expect(script).toContain('"subscriptionClients"');
    expect(script).toContain('"proxyProviders"');
    expect(script).toContain('"subscriptionExportFiles"');
    expect(script).toContain('"forwardRules"');
    expect(script).toContain('"runtimeSnapshots"');
    expect(script).toContain('"tasks"');
    expect(script).toContain('"agent-hkg-01", "agent-sin-02", "agent-tyo-03"');
    expect(script).toContain('"forward-hkg-443"');
    expect(script).toContain('"sub-client-acme-hkg"');
    expect(script).toContain('检测到旧演示/种子数据残留');
    expect(script).toContain('sudo ou f --force 清理旧状态');
    expect(script).toContain('warn_demo_inventory_residue\n  log "更新完成。"');
  });

  it('preserves the installed panel path and operator identity during reconfigure', () => {
    expect(runInstallIdentityPreserver(script)).toContain(
      [
        'SECURE_PATH=stable-panel',
        'ADMIN_USER=operator_old',
        'ADMIN_PASSWORD=password-old',
        'OPERATOR_TOKEN=operator-token-old',
        'OPERATOR_SESSION_SECRET=session-secret-old',
        'AGENT_BOOTSTRAP_TOKEN=agent-bootstrap-old'
      ].join('\n')
    );
  });

  it('self-checks one-click Agent install command generation after install and force repair', () => {
    expect(script).toContain('${base_url%/}/api/v1/agents/install-command');
    expect(script).toContain('-b "${cookie_file}"');
    expect(script.match(/csrf_token="\$\(read_session_csrf_token "\$\{cookie_file\}"\)"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/-H "X-CSRF-Token: \$\{csrf_token\}" \\/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('Agent 安装命令 API 自检失败：面板会话缺少 CSRF token。');
    expect(script).toContain('install-selfcheck-agent-command-$(date +%s)-$$');
    expect(script).toContain('public/install/ou-agent.sh');
    expect(script).toContain('OU_MASTER=');
    expect(script).toContain('OU_AGENT_ID=');
    expect(script).toContain('OU_INSTALL_TOKEN=');
    expect(script).toContain('Nginx session gate、operator token 注入');
    expect(script).toContain('未把主机名/客户名写入安装命令');
    expect(script).toContain('check_fresh_install_empty_inventory\n  check_agent_install_command_surface');
    expect(script.match(/check_empty_control_plane_inventory\n\s+check_agent_install_command_surface/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('defines fresh-install empty inventory polling in installer scope before the self-check uses it', () => {
    const installerSelfCheckScope = script.slice(script.indexOf('check_panel_http_surface()'));

    expect(installerSelfCheckScope).toContain('read_empty_inventory_snapshot_residue()');
    expect(installerSelfCheckScope).toContain('poll_empty_inventory_snapshot_residue()');
    expect(installerSelfCheckScope.indexOf('read_empty_inventory_snapshot_residue()')).toBeLessThan(
      installerSelfCheckScope.indexOf('poll_empty_inventory_snapshot_residue()')
    );
    expect(installerSelfCheckScope.indexOf('poll_empty_inventory_snapshot_residue()')).toBeLessThan(
      installerSelfCheckScope.indexOf('check_fresh_install_empty_inventory()')
    );
  });

  it('parses empty inventory snapshots without treating bootstrap permissions as business residue', () => {
    const reader = extractFunctionBefore(script.slice(script.indexOf('check_panel_http_surface()')), 'read_empty_inventory_snapshot_residue', 'poll_empty_inventory_snapshot_residue');

    expect(
      runEmptyInventoryResidueReader(reader, {
        data: {
          agents: [],
          nodes: [],
          inbounds: [],
          forwardRules: [],
          tasks: [],
          permissionGrants: [{ id: 'grant-bootstrap-owner' }]
        }
      })
    ).toBe('OK');
    expect(
      runEmptyInventoryResidueReader(reader, {
        data: {
          agents: [{ id: 'agent-leftover' }],
          tasks: []
        }
      })
    ).toBe('agents=1');
    expect(runEmptyInventoryResidueReader(reader, { error: { code: 'unauthorized' } })).toBe('');
  });

  it('prints a readable Simplified Chinese install summary', () => {
    expect(script).toContain('OU-UI Next Master 安装完成');
    expect(script).toContain('访问链接：');
    expect(script).toContain('安全路径：');
    expect(script).toContain('Agent 引导令牌：');
    expect(script).toContain('管理命令：');
    expect(script).toContain('快捷入口：');
    expect(script).toContain('SSL 证书：');
    expect(script).toContain('后端服务：');
    expect(script).toContain('Nginx 配置：');
    expect(script).not.toMatch(/鐎瑰|鐠佸潡|闁剧偓|閿沑?b|瀵洖|缁旑垰|閸氬海|闁板秶/);
  });
});
