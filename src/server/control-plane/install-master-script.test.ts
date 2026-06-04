import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function extractFunctionBefore(script: string, functionName: string, nextFunctionName: string) {
  const start = script.indexOf(`${functionName}() {`);
  const end = script.indexOf(`\n${nextFunctionName}()`, start);

  if (start < 0 || end < 0) {
    throw new Error(`Unable to extract ${functionName}`);
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
    expect(script).toContain('remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('BACKEND_PORT_DEFAULT="${BACKEND_PORT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_HOST "${BACKEND_HOST_DEFAULT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_CONTROL_PLANE_PORT "${BACKEND_PORT_DEFAULT}"');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_RETENTION_DAYS 7');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT 5000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED true');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS 30000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_ACK_TIMEOUT_MS 15000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_RESULT_TIMEOUT_MS 120000');
    expect(script).toContain('ensure_env_line "${BACKEND_ENV_FILE}" OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS 500');
    expect(script).toContain('OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID group-premium');
    expect(script).toContain('OU_UI_AGENT_LOG_RETENTION_DAYS=7');
    expect(script).toContain('OU_UI_AGENT_LOG_MAX_EVENTS_PER_AGENT=5000');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_ENABLED=true');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_INTERVAL_MS=30000');
    expect(script).toContain('OU_UI_COMMAND_ACK_TIMEOUT_MS=15000');
    expect(script).toContain('OU_UI_COMMAND_RESULT_TIMEOUT_MS=120000');
    expect(script).toContain('OU_UI_COMMAND_TIMEOUT_SWEEP_MAX_COMMANDS=500');
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
    expect(script).toContain('VITE_CONTROL_PLANE_LOGIN_USERNAME=${ADMIN_USER}');
    expect(script).toContain('VITE_CONTROL_PLANE_LOGIN_PASSWORD=${ADMIN_PASSWORD}');
    expect(script).not.toContain('VITE_CONTROL_PLANE_OPERATOR_TOKEN=${OPERATOR_TOKEN}');
    expect(script).not.toContain('set_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('remove_env_line "${APP_DIR}/.env.production.local" VITE_CONTROL_PLANE_OPERATOR_TOKEN');
    expect(script).toContain('proxy_set_header Authorization "Bearer ${OPERATOR_TOKEN}"');
    expect(script).toContain('proxy_set_header Authorization "Bearer ${operator_token}"');
    expect(script).toContain('面板 Basic Auth: 已关闭，应该显示前端登录页');
    expect(script).toContain('OU-UI Next 安装诊断');
    expect(script).toContain('若浏览器弹系统账号密码框，通常是端口/域名命中了旧站点：');
    expect(script).toContain('WWW-Authenticate: ${panel_auth:-未返回}');
    expect(script).toContain('check_panel_http_surface()');
    expect(script).toContain('refresh_nginx_panel_config()');
    expect(script).toContain('check_panel_surface()');
    expect(script).toContain('for attempt in 1 2 3 4 5; do');
    expect(script).toContain('body="$(curl -k -sSL --max-time 10 "${url}" 2>/dev/null || true)"');
    expect(script).toContain('面板 URL 自检连续 5 次未取到响应');
    expect(script).toContain('Nginx 面板站点已刷新，并强制关闭 Basic Auth。');
    expect(script).toContain('已命中 OU-UI Next 前端登录页，未发现 WWW-Authenticate: Basic');
    expect(script).toContain('<title>OU-UI Next</title>');
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
      expect(block).toMatch(/proxy_set_header Authorization "Bearer \$\{(?:OPERATOR_TOKEN|operator_token)\}";/);
      expect(block).toContain('proxy_buffering off;');
      expect(block).toContain('proxy_cache off;');
      expect(block).toContain('proxy_read_timeout 1h;');
      expect(block).not.toContain('$http_authorization');
    });
  });

  it('refreshes management shortcuts during GitHub updates', () => {
    expect(script).toContain('if [[ -f "${APP_DIR}/scripts/install-master.sh" ]]; then');
    expect(script).toContain('bash "${APP_DIR}/scripts/install-master.sh" repair-cli');
    expect(script).toContain('if [[ -x "/usr/local/bin/ou-ui-next" ]]; then');
    expect(script).toContain('/usr/local/bin/ou-ui-next repair-nginx');
    expect(script).toContain('else\n    refresh_nginx_panel_config\n    check_panel_surface\n  fi');
    expect(script).toContain('if [[ "${1:-}" == "repair-cli" ]]; then');
    expect(script).toContain('/usr/local/bin/ou-ui-next repair-nginx');
    expect(script).toContain('repair-nginx 重新写入面板 Nginx 配置并检查 Basic Auth 残留');
    expect(script).toContain('管理命令已刷新：ou-ui / ou / ouui / ou-ui-next');
  });

  it('uses empty production inventory and preserves state during reconfigure flows', () => {
    expect(script).toContain('OU_UI_CONTROL_PLANE_INITIAL_STATE=empty');
    expect(script).toContain('reset_control_plane_state_if_needed');
    expect(script).toContain('reset_control_plane_state()');
    expect(script).toContain('按全新安装流程重置');
    expect(script).toContain('OU_UI_PRESERVE_STATE');
    expect(script).toContain('重新打开安装向导，以便修改端口、证书和 Nginx 相关配置。');
    expect(script).toContain('read_empty_inventory_snapshot_residue()');
    expect(script).toContain('poll_empty_inventory_snapshot_residue()');
    expect(script).toContain('elif (.data | type) != "object" then empty');
    expect(script.match(/\. as \$snapshot/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/\$snapshot\.data\[\$key\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('read_demo_inventory_snapshot_residue()');
    expect(script).toContain('poll_demo_inventory_snapshot_residue()');
    expect(script).toContain('warn_demo_inventory_residue()');
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

  it('self-checks one-click Agent install command generation after install and force repair', () => {
    expect(script).toContain('${base_url%/}/api/v1/agents/install-command');
    expect(script).toContain('install-selfcheck-agent-command-$(date +%s)-$$');
    expect(script).toContain('public/install/ou-agent.sh');
    expect(script).toContain('OU_MASTER=');
    expect(script).toContain('OU_AGENT_ID=');
    expect(script).toContain('OU_INSTALL_TOKEN=');
    expect(script).toContain('Nginx operator token 注入');
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
