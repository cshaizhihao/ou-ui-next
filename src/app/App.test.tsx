import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from './App';
import { useAppStore } from './app-store';

async function login() {
  const user = userEvent.setup();

  await user.type(screen.getByPlaceholderText('用户名'), 'admin');
  await user.type(screen.getByPlaceholderText('密码'), 'admin');
  await user.click(screen.getByRole('button', { name: '安全登录' }));

  return user;
}

async function switchLoginToEnglish() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'English' }));
  return user;
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
    expect(screen.getByRole('heading', { name: 'OU-UI Next控制面板' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('用户名')).toHaveClass('glass-input');
    expect(screen.getByPlaceholderText('密码')).toHaveClass('glass-input');
    expect(screen.getByRole('button', { name: '安全登录' })).toHaveClass('btn-glow');
    expect(document.querySelector('.language-switch-login')).toBeInTheDocument();
    expect(document.querySelector('.bg-env')).toBeInTheDocument();
  });

  it('switches the login overlay copy to English before authentication', async () => {
    render(<App />);
    await switchLoginToEnglish();

    expect(screen.getByRole('heading', { name: 'OU-UI Next Control Panel' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Username')).toHaveClass('glass-input');
    expect(screen.getByPlaceholderText('Password')).toHaveClass('glass-input');
    expect(screen.getByRole('button', { name: 'Secure Login' })).toHaveClass('btn-glow');
    expect(screen.queryByRole('heading', { name: 'OU-UI Next控制面板' })).not.toBeInTheDocument();
  });

  it('authenticates demo credentials and reveals the glass control plane shell', async () => {
    render(<App />);
    await login();

    expect(await screen.findByRole('button', { name: '系统总览' })).toBeInTheDocument();
    expect(screen.getByText('主控节点')).toBeInTheDocument();
    expect(screen.queryByText('Master Node')).not.toBeInTheDocument();
    expect(await screen.findByText(/香港入口 Agent/)).toBeInTheDocument();
    expect(screen.getByText(/103\.45\.12\.xxx/)).toBeInTheDocument();
    expect(document.querySelector('.svg-line-dash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '受控主机' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '端口转发' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安全策略' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审计日志' })).toBeInTheDocument();
    expect(document.querySelector('header .btn-glow')).not.toBeInTheDocument();
    expect(document.getElementById('login-overlay')).toBeNull();
    expect(document.getElementById('app-main')).toHaveClass('app-ready');
  });

  it('switches the dashboard workspace copy to English without keeping Chinese dashboard labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', { name: 'System Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh View' })).toBeInTheDocument();
    expect(screen.getByText('Traffic Topology')).toBeInTheDocument();
    expect(screen.queryByText(/\u7cfb\u7edf\u5927\u76d8/)).not.toBeInTheDocument();
  });

  it('switches the subscription workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Node Subscriptions' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Node Subscriptions' })).toBeInTheDocument();
    expect(screen.getByText('Client Subscription Rules')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Identity' })).toBeInTheDocument();
    expect(screen.queryByText(/\u805a\u5408\u8ba2\u9605/)).not.toBeInTheDocument();
  });

  it('switches the routing workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Routing' }));

    expect(await screen.findByRole('heading', { name: 'Routing Policy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compile Routing Policy' })).toBeInTheDocument();
    expect(screen.queryByText(/\u5206\u6d41\u77e9\u9635/)).not.toBeInTheDocument();
  });

  it('switches the security workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Security' }));

    expect(await screen.findByRole('heading', { name: 'Group Authorization' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Submit Permission Change' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\u8bbf\u95ee\u6388\u6743\u77e9\u9635/)).not.toBeInTheDocument();
  });

  it('switches the tuning workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Tuning' }));

    expect(await screen.findByRole('heading', { name: 'System Tuning' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dispatch Tuning Change' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\u7cfb\u7edf\u8c03\u4f18/)).not.toBeInTheDocument();
  });

  it('switches the tasks workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Execution Log' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Execution Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Records' })).toBeInTheDocument();
    expect(screen.queryByText('任务队列')).not.toBeInTheDocument();
  });

  it('switches the audit workspace copy to English without keeping Chinese page labels', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: 'Audit Log' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getByText('Change Ledger')).toBeInTheDocument();
    expect(screen.queryByText('审计日志')).not.toBeInTheDocument();
  });

  it('opens managed hosts as a one-click host installer with separate customer node config', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '受控主机' }));

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
    await user.click(screen.getByRole('button', { name: '客户节点' }));
    expect(screen.getByText('客户节点配置')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增客户节点' }));
    expect(screen.getByLabelText('客户节点名称')).toBeInTheDocument();
    expect(screen.getByLabelText('服务器地址')).toBeInTheDocument();
    expect(screen.getByLabelText('Xray 协议')).toBeInTheDocument();
    expect(screen.getByText('可用订阅链接')).toBeInTheDocument();
    expect(screen.getByText(/vless:\/\//)).toBeInTheDocument();
    expect(screen.getByText('Xray 入站配置')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow')).toBeInTheDocument();
    expect(screen.getByLabelText('Reality Short ID')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Xray 协议'), 'vmess');
    expect(screen.getByLabelText('VMess 加密')).toBeInTheDocument();
    expect(screen.queryByLabelText('Flow')).not.toBeInTheDocument();
    expect(screen.getByLabelText('传输层')).toHaveValue('ws');
    expect(screen.getByText(/vmess:\/\//)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Xray 协议'), 'shadowsocks');
    expect(screen.getByLabelText('Shadowsocks 方法')).toBeInTheDocument();
    expect(screen.getByLabelText('入站端口')).toHaveValue(8388);
    expect(screen.getByLabelText('安全层')).toHaveValue('none');
    expect(screen.queryByLabelText('SNI / Host')).not.toBeInTheDocument();
    expect(screen.getByText(/ss:\/\//)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Xray 协议'), 'hysteria');
    expect(screen.getByLabelText('Hysteria2 Auth')).toBeInTheDocument();
    expect(screen.getByLabelText('传输层')).toHaveValue('udp');
    expect(screen.getByText(/hysteria2:\/\//)).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: '端口转发' }));
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
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findByText('创建多主机端口转发')).toBeInTheDocument();
    expect(screen.getByText('已排队')).toBeInTheDocument();
  });

  it('imports external subscription sources and previews custom subscription rules', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '节点订阅' }));
    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    expect(screen.getByLabelText('源名称')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('源名称'));
    await user.type(screen.getByLabelText('源名称'), '客户自定义订阅源');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect((await screen.findAllByText('客户自定义订阅源')).length).toBeGreaterThan(0);
    expect(screen.getByText('syncing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '订阅身份' }));
    await user.click(screen.getByRole('button', { name: '新增订阅身份' }));
    expect(screen.getByText('订阅地址预览')).toBeInTheDocument();
    expect(screen.getByText(/\/sub\/[A-Za-z0-9]{24}\/clash\/sub_hkg_premium_01/)).toBeInTheDocument();
    expect(screen.getByText('命中节点')).toBeInTheDocument();
  });

  it('opens the host config deploy drawer from the managed host workspace', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '受控主机' }));
    await user.click((await screen.findAllByRole('button', { name: '应用主机设置' }))[0]);

    expect(screen.getByRole('complementary', { name: '应用主机设置' })).toHaveClass('drawer-panel', 'open');
    expect(document.querySelector('.overlay.open')).toBeInTheDocument();
    expect(document.querySelector('.modal-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认应用' }));
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect((await screen.findAllByText(/香港入口 Agent/)).length).toBeGreaterThan(0);
  });

  it('opens the security workspace and creates a permission grant task', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '安全策略' }));

    expect((await screen.findAllByText('operator:admin')).length).toBeGreaterThan(0);
    await user.click((await screen.findAllByRole('button', { name: '提交权限变更' }))[0]);
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findByText('提交转发分组权限变更')).toBeInTheDocument();
  });

  it('deduplicates repeated permission submissions from the UI action layer', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '安全策略' }));
    await user.dblClick((await screen.findAllByRole('button', { name: '提交权限变更' }))[0]);
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findAllByText('提交转发分组权限变更')).toHaveLength(1);
  });

  it('refreshes task inventory without creating a runtime reload task', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '执行记录' }));
    await user.click(screen.getByRole('button', { name: '刷新记录' }));

    expect(screen.queryByText(/刷新执行记录快照/)).not.toBeInTheDocument();
  });

  it('toggles the html.dark theme class from the topbar control', async () => {
    document.documentElement.classList.add('dark');
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '切换深浅主题' }));
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: '切换深浅主题' }));
    expect(document.documentElement).toHaveClass('dark');
    document.documentElement.classList.remove('dark');
  });
});
