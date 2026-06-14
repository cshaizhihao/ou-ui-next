import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from './App';
import { useAppStore } from './app-store';

type TestUser = ReturnType<typeof userEvent.setup>;

async function login() {
  const user = userEvent.setup();

  await user.type(screen.getByRole('textbox', { name: '用户名' }), 'admin');
  await user.type(screen.getByLabelText('密码'), 'admin');
  await user.click(screen.getByRole('button', { name: '安全登录' }));

  return user;
}

async function switchLoginToEnglish() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'English' }));
  return user;
}

async function openAdvancedNavigation(user: TestUser) {
  const button =
    screen.queryByRole('button', { name: '展开 治理与证据' }) ??
    screen.queryByRole('button', { name: 'Expand Governance & Evidence' });

  if (button) {
    await user.click(button);
  }
}

async function clickNavigation(user: TestUser, label: string | RegExp) {
  const navigation =
    screen.queryByRole('complementary', { name: 'Master 控制面导航' }) ??
    screen.queryByRole('complementary', { name: 'Master control-plane navigation' });
  const button =
    navigation?.querySelectorAll('button')
      ? Array.from(navigation.querySelectorAll('button')).find((candidate) => {
          const accessibleName = candidate.getAttribute('aria-label') ?? candidate.textContent ?? '';
          return typeof label === 'string' ? accessibleName === label : label.test(accessibleName);
        })
      : screen.queryAllByRole('button', { name: label })[0];

  if (button) {
    await user.click(button);
    return;
  }

  await openAdvancedNavigation(user);
  await user.click(await screen.findByRole('button', { name: label }));
}

beforeEach(() => {
  vi.stubEnv('VITE_CONTROL_PLANE_MOCK_SEEDED', 'true');
});

afterEach(() => {
  act(() => {
    useAppStore.getState().reset();
  });
  vi.unstubAllEnvs();
});

describe('App', () => {
  it('renders the OU-UI Next secure login overlay', () => {
    render(<App />);

    expect(screen.getByText('OU-UI NEXT')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'OU-UI Next 控制面板' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveClass('glass-input');
    expect(screen.getByLabelText('密码')).toHaveClass('glass-input');
    expect(screen.getByRole('button', { name: '安全登录' })).toHaveClass('btn-glow');
    expect(document.querySelector('.language-switch-login')).toBeInTheDocument();
    expect(document.querySelector('.bg-env')).toBeInTheDocument();
  });

  it('switches the login overlay copy to English before authentication', async () => {
    render(<App />);
    await switchLoginToEnglish();

    expect(screen.getByRole('heading', { name: 'OU-UI Next Control Panel' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveClass('glass-input');
    expect(screen.getByLabelText('Password')).toHaveClass('glass-input');
    expect(screen.getByRole('button', { name: 'Secure Login' })).toHaveClass('btn-glow');
    expect(screen.queryByRole('heading', { name: 'OU-UI Next 控制面板' })).not.toBeInTheDocument();
  });

  it('authenticates local credentials and reveals the glass control plane shell', async () => {
    render(<App />);
    const user = await login();

    expect(await screen.findByRole('button', { name: '概览' })).toBeInTheDocument();
    expect(screen.getByText('主控节点')).toBeInTheDocument();
    expect(screen.queryByText('Master Node')).not.toBeInTheDocument();
    expect((await screen.findAllByText(/香港入口 Agent/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('主机探针').length).toBeGreaterThan(0);
    expect(document.querySelector('.svg-line-dash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务器' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '节点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '端口转发' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '订阅' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '执行记录' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开 治理与证据' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '受控主机' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '客户' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '调优' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '权限与配额' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通知' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '账户' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审计' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开 治理与证据' }));
    expect(screen.getByRole('button', { name: '客户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分流策略' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调优' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '权限与配额' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通知' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审计' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '节点订阅' })).not.toBeInTheDocument();
    expect(document.querySelector('header .btn-glow')).not.toBeInTheDocument();
    expect(document.getElementById('login-overlay')).toBeNull();
    expect(document.getElementById('app-main')).toHaveClass('app-ready');
  });

  it('switches the dashboard workspace copy to English without keeping Chinese dashboard labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', { name: 'Connectivity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accounts' })).not.toBeInTheDocument();
    await openAdvancedNavigation(user);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.queryByText('Real-time flow preview across the control plane, managed hosts, and port forwarding links.')).not.toBeInTheDocument();
    expect(screen.queryByText(/\u7cfb\u7edf\u603b\u89c8/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通知' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '账户' })).not.toBeInTheDocument();
  });

  it('opens Telegram and admin account settings as real system settings pages', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '通知');
    expect(await screen.findByRole('heading', { level: 3, name: 'Telegram 通知' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '运营总览' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Bot 配置' })).toBeInTheDocument();

    await clickNavigation(user, '账户');
    expect(await screen.findByRole('heading', { level: 3, name: '管理员账户设置' })).toBeInTheDocument();
    expect(screen.getByText('登录凭据重置')).toBeInTheDocument();
  });

  it('switches the subscription workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Subscriptions');

    expect(await screen.findByRole('heading', { level: 3, name: 'Subscription Management' })).toBeInTheDocument();
    expect(screen.getByText('Client Subscription Rules')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Identity' })).toBeInTheDocument();
    expect(screen.queryByText(/\u805a\u5408\u8ba2\u9605/)).not.toBeInTheDocument();
  });

  it('switches the customer-node protocol drawer fields to English without keeping Chinese labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Nodes');
    expect(await screen.findByText('Customer Node Config')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.click(screen.getByText('Advanced Config'));

    expect(screen.getByLabelText('Flow')).toBeInTheDocument();
    expect(screen.getByLabelText('Reality Public Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Reality Short ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('流控模式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reality 公钥')).not.toBeInTheDocument();
  });

  it('renders localized forwarding status labels in the default Chinese workspace', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '\u7aef\u53e3\u8f6c\u53d1');

    expect(await screen.findByRole('heading', { level: 3, name: '\u7aef\u53e3\u8f6c\u53d1' })).toBeInTheDocument();
    expect(screen.getAllByText('\u5df2\u542f\u7528').length).toBeGreaterThan(0);
    expect(screen.getAllByText('\u5df2\u5206\u914d').length).toBeGreaterThan(0);
    expect(screen.queryByText('enabled')).not.toBeInTheDocument();
    expect(screen.queryByText('allocated')).not.toBeInTheDocument();
  });

  it('switches the forwarding workspace copy to English without keeping Chinese or raw status labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Port Forwarding');

    expect(await screen.findByRole('heading', { level: 3, name: 'Port Forwarding' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Forward Rule' })).toBeInTheDocument();
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Allocated').length).toBeGreaterThan(0);
    expect(screen.queryByText('enabled')).not.toBeInTheDocument();
    expect(screen.queryByText('allocated')).not.toBeInTheDocument();
  });

  it('switches the routing workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Routing');

    expect(await screen.findByRole('heading', { name: 'Routing Policy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compile Visible Policies' })).toBeInTheDocument();
    expect(screen.queryByText(/\u5206\u6d41\u77e9\u9635/)).not.toBeInTheDocument();
  });

  it('does not expose the removed access and quota workspace in English navigation', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await openAdvancedNavigation(user);

    expect(screen.queryByRole('button', { name: 'Access & Quotas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '权限与配额' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Group Authorization' })).not.toBeInTheDocument();
  });

  it('switches the tuning workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Tuning');

    expect(await screen.findByRole('heading', { name: 'System Tuning' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Host Tuning Probe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dispatch Tuning Preset' })).toBeInTheDocument();
    expect(screen.queryByText(/\u7cfb\u7edf\u8c03\u4f18/)).not.toBeInTheDocument();
  });

  it('switches the tasks workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Execution');

    expect(await screen.findByRole('heading', { level: 3, name: 'Execution Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Records' })).toBeInTheDocument();
    expect(screen.queryByText('任务队列')).not.toBeInTheDocument();
  });

  it('switches the audit workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await clickNavigation(user, 'Audit');

    expect(await screen.findByRole('heading', { level: 3, name: 'Audit Log' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 4, name: 'Change Ledger' })).toBeInTheDocument();
    expect(screen.queryByText('审计日志')).not.toBeInTheDocument();
  });

  it('opens managed hosts as a one-click host installer with separate customer node config', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '服务器');

    expect(await screen.findByRole('heading', { level: 3, name: '受控主机' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成安装命令' }));
    expect(screen.queryByLabelText('主机名称')).not.toBeInTheDocument();
    expect(screen.getByText('主机代理一键安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制安装命令' })).toBeInTheDocument();
    expect(await screen.findByText(/OU_MASTER='.*\/agent\/v1\/poll'/)).toBeInTheDocument();
    expect(screen.queryByText(/OU_INSTALL_PROFILE=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OU_HOST_NAME=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OU_CUSTOMER_NODE/)).not.toBeInTheDocument();
    expect(screen.getByText(/\/agent\/v1\/poll/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    await clickNavigation(user, '节点');
    expect(screen.getByText('客户节点配置')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增客户节点' }));
    expect(screen.queryByLabelText('协议模板')).not.toBeInTheDocument();
    expect(screen.getByLabelText('客户名称')).toBeInTheDocument();
    expect(screen.getByText('生成结果')).toBeInTheDocument();
    expect(screen.getByText('订阅链接')).toBeInTheDocument();
    expect(screen.getByText(/vless:\/\//)).toBeInTheDocument();
    await user.click(screen.getByText('高级配置'));
    expect(screen.getByLabelText('协议模板')).toBeInTheDocument();
    expect(screen.getByLabelText('客户节点名称')).toBeInTheDocument();
    expect(screen.getByLabelText('服务器地址')).toBeInTheDocument();
    expect(screen.getByLabelText('Xray 协议')).toBeInTheDocument();
    expect(screen.getByText('Xray 入站配置')).toBeInTheDocument();
    expect(screen.getByLabelText('流控模式')).toBeInTheDocument();
    expect(screen.getByLabelText('Reality 短 ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Flow')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reality Public Key')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Xray 协议'), 'vmess');
    expect(screen.getByLabelText('VMess 加密')).toBeInTheDocument();
    expect(screen.queryByLabelText('流控模式')).not.toBeInTheDocument();
    expect(screen.getByLabelText('传输层')).toHaveValue('ws');
    expect(screen.getByText(/vmess:\/\//)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Xray 协议'), 'shadowsocks');
    expect(screen.getByLabelText('Shadowsocks 方法')).toBeInTheDocument();
    expect(screen.getAllByLabelText('入站端口')[0]).toHaveValue(null);
    expect(screen.getByLabelText('安全层')).toHaveValue('none');
    expect(screen.queryByLabelText('服务器名称')).not.toBeInTheDocument();
    expect(screen.getByText(/ss:\/\//)).toBeInTheDocument();

    expect(screen.queryByText('Hysteria2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hysteria2 认证')).not.toBeInTheDocument();
    expect(screen.queryByText(/master\.example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/批量安装/)).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    expect(screen.queryByText('D')).not.toBeInTheDocument();
    expect(screen.queryByText('E')).not.toBeInTheDocument();
  });

  it('opens the forwarding workspace and creates an audited deploy task', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '端口转发');
    await user.click(screen.getByRole('button', { name: '创建转发规则' }));

    expect(screen.getAllByRole('heading', { name: '端口转发' }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('监听端口')).toBeInTheDocument();
    expect(screen.getByLabelText('目标 IP')).toBeInTheDocument();
    expect(screen.getByLabelText('目标端口')).toBeInTheDocument();
    expect(screen.getByText('入口主机')).toBeInTheDocument();
    expect(screen.getByText('已选 2')).toBeInTheDocument();
    expect(screen.getAllByText('香港入口 Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('新加坡转发 Agent').length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue('agent-hkg-01, agent-sin-02')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    await user.clear(screen.getByLabelText('目标 IP'));
    await user.type(screen.getByLabelText('目标 IP'), '172.20.8.10');
    await user.clear(screen.getByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9443');

    await user.click(screen.getByRole('button', { name: '保存' }));
    await clickNavigation(user, '执行记录');

    expect(await screen.findByText('创建多主机端口转发')).toBeInTheDocument();
    expect(screen.getAllByText('已排队').length).toBeGreaterThan(0);
  });

  it('imports external subscription sources and previews custom subscription rules', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '订阅');
    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    expect(screen.getByLabelText('源名称')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('源名称'));
    await user.type(screen.getByLabelText('源名称'), '客户自定义订阅源');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect((await screen.findAllByText('客户自定义订阅源')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '订阅身份' }));
    await user.click(screen.getByRole('button', { name: '新增订阅身份' }));
    expect(screen.getByText('订阅地址预览')).toBeInTheDocument();
    expect(screen.getByText(/\/sub\/[A-Za-z0-9]{24}\/clash\/sub_hkg_premium_01/)).toBeInTheDocument();
    expect(screen.getByText('命中节点')).toBeInTheDocument();
  });

  it('opens the host config deploy drawer from the managed host workspace', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '服务器');
    await user.click((await screen.findAllByRole('button', { name: '应用主机设置' }))[0]);

    expect(screen.getByRole('dialog', { name: '应用主机设置' })).toHaveClass('modal-panel', 'open');
    expect(document.querySelector('.overlay.open')).toBeInTheDocument();
    expect(document.querySelector('.modal-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认应用' }));
    await clickNavigation(user, '执行记录');

    expect((await screen.findAllByText(/香港入口 Agent/)).length).toBeGreaterThan(0);
  });

  it('refreshes task inventory without creating a runtime reload task', async () => {
    render(<App />);
    const user = await login();

    await clickNavigation(user, '执行记录');
    await user.click(screen.getByRole('button', { name: '刷新记录' }));

    expect(screen.queryByText(/刷新执行记录快照/)).not.toBeInTheDocument();
  });

  it('toggles the html.dark theme class from the topbar control', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '切换深浅主题' }));
    expect(document.documentElement).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: '切换深浅主题' }));
    expect(document.documentElement).not.toHaveClass('dark');
    document.documentElement.classList.remove('dark');
  });
});
