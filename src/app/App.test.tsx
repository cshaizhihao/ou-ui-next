import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

afterEach(() => {
  act(() => {
    useAppStore.getState().reset();
  });
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
    expect(screen.getByText('Master Node')).toBeInTheDocument();
    expect(await screen.findByText(/香港入口 Agent/)).toBeInTheDocument();
    expect(screen.getByText(/103\.45\.12\.xxx/)).toBeInTheDocument();
    expect(document.querySelector('.svg-line-dash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '受控主机' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '端口转发' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安全策略' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审计日志' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下发运行时配置' })).not.toBeInTheDocument();
    expect(document.getElementById('login-overlay')).toHaveClass('hidden-overlay');
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
    expect(screen.getByLabelText('主机名称')).toBeInTheDocument();
    expect(screen.getByText('主机代理一键安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建安装任务' })).toBeInTheDocument();
    expect(await screen.findByText(/OU_INSTALL_PROFILE='probe,xray,flvx,forwarding,telemetry,command-channel'/)).toBeInTheDocument();
    expect(screen.queryByText(/OU_CUSTOMER_NODE/)).not.toBeInTheDocument();
    expect(screen.getByText(/\/agent\/v1\/poll/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '客户节点' }));
    expect(screen.getByText('客户节点配置')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增客户节点' }));
    expect(screen.getByLabelText('客户节点名称')).toBeInTheDocument();
    expect(screen.getByLabelText('Xray 协议')).toBeInTheDocument();
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
    expect(screen.getByText('香港入口 Agent')).toBeInTheDocument();
    expect(screen.getByText('新加坡转发 Agent')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('agent-hkg-01, agent-sin-02')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findByText('创建多主机端口转发')).toBeInTheDocument();
    expect(screen.getByText('已排队')).toBeInTheDocument();
  });

  it('opens the host config deploy drawer from the managed host workspace', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '受控主机' }));
    await user.click((await screen.findAllByRole('button', { name: '下发主机配置' }))[0]);

    expect(screen.getByRole('complementary', { name: '下发主机配置' })).toHaveClass('drawer-panel', 'open');
    expect(document.querySelector('.overlay.open')).toBeInTheDocument();
    expect(document.querySelector('.modal-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认下发' }));
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect((await screen.findAllByText(/香港入口 Agent/)).length).toBeGreaterThan(0);
  });

  it('opens the security workspace and creates a permission grant task', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '安全策略' }));

    expect(await screen.findByText('operator:admin')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '提交权限变更' }));
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findByText('提交隧道分组权限变更')).toBeInTheDocument();
  });

  it('deduplicates repeated permission submissions from the UI action layer', async () => {
    render(<App />);
    const user = await login();

    await user.click(await screen.findByRole('button', { name: '安全策略' }));
    await user.dblClick(await screen.findByRole('button', { name: '提交权限变更' }));
    await user.click(screen.getByRole('button', { name: '执行记录' }));

    expect(await screen.findAllByText('提交隧道分组权限变更')).toHaveLength(1);
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
