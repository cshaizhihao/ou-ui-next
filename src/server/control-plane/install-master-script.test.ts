import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('install-master.sh contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts', 'install-master.sh'), 'utf8');

  it('deploys from GitHub and installs the management shortcut commands', () => {
    expect(script).toContain('https://github.com/cshaizhihao/ou-ui-next.git');
    expect(script).toContain('git clone --branch "${DEFAULT_REPO_REF}" --depth 1 "${DEFAULT_REPO_URL}" "${APP_DIR}"');
    expect(script).toContain('ou-ui-next menu');
    expect(script).toContain('doctor|diagnose)');
    expect(script).toContain('reset-state|reset)');
    expect(script).toContain('ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ouui"');
    expect(script).toContain('ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ou-ui"');
    expect(script).toContain('ln -sf "/usr/local/bin/ou-ui-next" "/usr/local/bin/ou"');
  });

  it('serves the frontend login page instead of enabling browser Basic Auth', () => {
    expect(script).toContain('VITE_DISABLE_IN_APP_LOGIN=false');
    expect(script).toContain('VITE_CONTROL_PLANE_LOGIN_USERNAME=${ADMIN_USER}');
    expect(script).toContain('VITE_CONTROL_PLANE_LOGIN_PASSWORD=${ADMIN_PASSWORD}');
    expect(script).toContain('前端登录页：%b 已启用（不会再弹系统认证框）');
    expect(script).toContain('OU-UI Next 安装诊断');
    expect(script).toContain('若浏览器弹系统账号密码框，通常是端口/域名命中了旧站点');
    expect(script.match(/auth_basic off;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(script).not.toMatch(/auth_basic\s+(?!off\b)/);
    expect(script).not.toContain('auth_basic_user_file');
  });

  it('uses empty production inventory and resets stale first-install state', () => {
    expect(script).toContain('OU_UI_CONTROL_PLANE_INITIAL_STATE=empty');
    expect(script).toContain('reset_control_plane_state_if_needed');
    expect(script).toContain('reset_control_plane_state()');
    expect(script).toContain('按全新安装流程重置');
    expect(script).toContain('仅当你刚安装完成却看到旧假数据/旧任务时使用');
    expect(script).toContain('OU_UI_PRESERVE_STATE');
  });

  it('prints a readable Simplified Chinese install summary', () => {
    expect(script).toContain('OU-UI Next Master 安装完成');
    expect(script).toContain('访问链接：');
    expect(script).toContain('安全路径：');
    expect(script).toContain('Agent 引导令牌：');
    expect(script).toContain('SSL 证书：');
    expect(script).toContain('后端服务：');
    expect(script).toContain('Nginx 配置：');
    expect(script).not.toMatch(/瀹夎|璁块|閾炬|锛\?b|寮曞|绔|鍚庣|閰嶇/);
  });
});
