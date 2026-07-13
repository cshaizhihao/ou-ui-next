import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneStatusCenter } from './control-plane-status-center';
import { MobileBottomNav } from './mobile-bottom-nav';
import { OperationsLaunchpad } from './operations-launchpad';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

describe('workspace chrome operations palette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps launchpad task paths to semantic operational tones', () => {
    render(
      <OperationsLaunchpad
        activePage="dashboard"
        agentsCount={1}
        forwardingRulesCount={3}
        language="zh"
        nodesCount={2}
        subscriptionsCount={4}
        tasksCount={5}
        alertsCount={1}
        onOpenQuickActions={vi.fn()}
        onSelectPage={vi.fn()}
      />
    );

    expect(screen.getByText('操作启动台').closest('section')).toHaveClass('surface-shell');
    expect(screen.getByText('操作启动台').closest('section')).not.toHaveTextContent(
      '首屏直达主机、节点、转发与订阅，必要时可压缩成指标带。'
    );
    expect(screen.queryByText('安装 Agent、查看遥测并应用运行时配置')).not.toBeInTheDocument();
    expect(screen.queryByText('创建客户节点、复制分享链接并重置流量')).not.toBeInTheDocument();
    expect(screen.queryByText('管理多主机端口、配额、限速与策略状态')).not.toBeInTheDocument();
    expect(screen.queryByText('聚合订阅源、导出客户端配置与链接')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索 / 执行动作' })).toHaveClass('ou-command-pill');
    expect(screen.getByText('1 台主机').closest('button')).toHaveAttribute('data-tone', 'primary');
    expect(screen.getByText('2 个节点').closest('button')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('3 条规则').closest('button')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByText('4 个订阅').closest('button')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('5 条记录').closest('button')).toHaveAttribute('data-tone', 'primary');
    expect(screen.getByText('1 个告警').closest('button')).toHaveAttribute('data-tone', 'danger');
  });

  it('marks launchpad expand and collapse states for first-screen motion continuity', () => {
    render(
      <OperationsLaunchpad
        activePage="dashboard"
        agentsCount={1}
        forwardingRulesCount={3}
        language="zh"
        nodesCount={2}
        subscriptionsCount={4}
        tasksCount={5}
        alertsCount={1}
        onOpenQuickActions={vi.fn()}
        onSelectPage={vi.fn()}
      />
    );

    const launchpad = screen.getByText('操作启动台').closest('section');
    expect(launchpad).toHaveAttribute('data-state', 'collapsed');
    expect(document.querySelector('.ou-launchpad-panel')).toBeNull();
    expect(document.querySelector('.ou-launchpad-metric-rail')).toHaveClass(
      'motion-safe:animate-[ou-panel-in_180ms_ease-out]'
    );

    fireEvent.click(screen.getByRole('button', { name: /展开/ }));

    expect(launchpad).toHaveAttribute('data-state', 'expanded');
    expect(document.querySelector('.ou-launchpad-panel')).toHaveClass(
      'motion-safe:animate-[ou-panel-in_180ms_ease-out]'
    );
  });

  it('keeps launchpad action cards compact instead of padding the dashboard first screen', () => {
    render(
      <OperationsLaunchpad
        activePage="dashboard"
        agentsCount={1}
        forwardingRulesCount={3}
        language="zh"
        nodesCount={2}
        subscriptionsCount={4}
        tasksCount={5}
        alertsCount={0}
        onOpenQuickActions={vi.fn()}
        onSelectPage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /展开/ }));

    const actionButton = screen.getByText('接入服务器').closest('button');

    expect(actionButton).toHaveClass('min-h-[68px]', 'p-2.5');
    expect(actionButton).not.toHaveClass('min-h-[92px]', 'p-3');
  });

  it('surfaces a real control-plane status center on dashboard chrome', () => {
    const onSelectPage = vi.fn();

    render(
      <ControlPlaneStatusCenter
        agentsOnlineCount={2}
        agentsTotalCount={3}
        alertsCount={7}
        failedTasksCount={1}
        language="zh"
        quotaRiskCount={4}
        runtimeApplyingCount={2}
        onSelectPage={onSelectPage}
      />
    );

    const statusCenter = screen.getByRole('region', { name: '控制面状态中心' });
    expect(statusCenter).toHaveClass('surface-shell');
    expect(screen.getByText('Agent 在线')).toBeInTheDocument();
    expect(screen.getByText('Runtime Apply')).toBeInTheDocument();
    expect(screen.getByText('失败任务')).toBeInTheDocument();
    expect(screen.getByText('配额风险')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    fireEvent.click(screen.getByText('失败任务').closest('button')!);
    expect(onSelectPage).toHaveBeenCalledWith('recovery');
  });

  it('uses semantic wayfinding on the sidebar active path and master-node status block', () => {
    render(<Sidebar activePage="forwarding" language="zh" onPageChange={vi.fn()} />);

    const sidebar = screen.getByRole('complementary');
    const activeItem = screen.getByRole('button', { name: '端口转发' });
    const masterNode = screen.getByText('主控节点').closest('div');

    expect(sidebar).toHaveClass('control-plane-sidebar');
    expect(screen.getByRole('button', { name: '收起 运行工作台' })).toHaveClass('ou-tone-warning');
    expect(activeItem).toHaveClass('nav-active');
    expect(masterNode?.parentElement).toHaveClass('control-plane-shell-status-strip');
    expect(sidebar).not.toHaveTextContent('运行状态');
    expect(sidebar).not.toHaveTextContent('多主机端口转发');
    expect(sidebar).not.toHaveTextContent('主机、节点、转发、订阅');
    expect(sidebar.querySelector('.control-plane-nav-description')).toBeNull();
    expect(sidebar.querySelector('.control-plane-nav-group-description')).toBeNull();
  });

  it('keeps sidebar chrome hard-edged instead of reverting to soft glass badges', () => {
    render(<Sidebar activePage="forwarding" language="zh" onPageChange={vi.fn()} />);

    const sidebar = screen.getByRole('complementary');
    const chromeHtml = sidebar.outerHTML;

    expect(sidebar).toHaveClass('ou-shell-sidebar');
    expect(sidebar).not.toHaveClass('island-panel');
    expect(chromeHtml).not.toMatch(/\brounded-full\b|\bbackdrop-blur/u);
    expect(chromeHtml).not.toMatch(/\bbg-white\/|\bbg-black\//u);
  });

  it('keeps topbar global controls on command, danger, and warning tones', () => {
    render(
      <Topbar
        title="概览"
        subtitle="运行状态"
        language="zh"
        quickActionScope={{ commands: 5, objects: 12 }}
        onLanguageChange={vi.fn()}
        onLogout={vi.fn()}
        onOpenQuickActions={vi.fn()}
        onToggleTheme={vi.fn()}
      />
    );

    expect(screen.getByRole('banner')).toHaveClass('control-plane-topbar');
    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
    expect(screen.queryByText('运行状态')).not.toBeInTheDocument();
    const quickActionButton = screen.getByRole('button', { name: '打开控制面搜索' });
    expect(quickActionButton).toHaveClass('control-plane-search-trigger', 'ou-command-pill');
    expect(within(quickActionButton).getByText('12 对象')).toBeInTheDocument();
    expect(within(quickActionButton).getByText('5 动作')).toBeInTheDocument();
    expect(within(quickActionButton).getByText('Ctrl K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toHaveClass('ou-tone-danger');
    expect(screen.getByRole('button', { name: '切换深浅主题' })).toHaveClass('ou-tone-warning');
  });

  it('keeps topbar controls compact and square-edged outside expected pill controls', () => {
    render(
      <Topbar
        title="概览"
        subtitle="运行状态"
        language="zh"
        quickActionScope={{ commands: 5, objects: 12 }}
        onLanguageChange={vi.fn()}
        onLogout={vi.fn()}
        onOpenQuickActions={vi.fn()}
        onToggleTheme={vi.fn()}
      />
    );

    const topbar = screen.getByRole('banner');

    expect(topbar).toHaveClass('ou-shell-topbar');
    expect(topbar.className).not.toMatch(/\bbackdrop-blur\b|\bbg-white\/|\bbg-black\//u);
    expect(screen.getByRole('button', { name: '退出登录' })).not.toHaveClass('rounded-full');
    expect(screen.getByRole('button', { name: '切换深浅主题' })).not.toHaveClass('rounded-full');
  });

  it('keeps mobile navigation on semantic operations tones', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    );

    render(
      <MobileBottomNav
        activePage="tasks"
        language="zh"
        quickActionScope={{ commands: 5, objects: 12 }}
        onOpenQuickActions={vi.fn()}
        onPageChange={vi.fn()}
      />
    );

    const mobileNavigation = screen.getByRole('navigation', { name: '手机快捷导航' });
    expect(mobileNavigation).toHaveClass('ou-mobile-nav');
    expect(mobileNavigation.outerHTML).not.toMatch(/\brounded-2xl\b|\bbackdrop-blur\b/u);
    expect(within(mobileNavigation).getByRole('button', { name: '治理' })).toHaveClass('ou-tone-warning');
    fireEvent.click(within(mobileNavigation).getByRole('button', { name: '治理' }));

    const governanceTray = screen.getByRole('region', { name: '手机治理入口' });
    expect(governanceTray).toHaveClass('mobile-governance-tray');
    expect(within(governanceTray).getByRole('button', { name: '执行记录' })).toHaveAttribute('aria-current', 'page');
    expect(within(mobileNavigation).getByRole('button', { name: '搜索' })).toHaveClass('ou-tone-danger');
    const quickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });
    const commandBadge = within(quickActionButton).getByText('5 动作');
    expect(commandBadge).toHaveClass('ou-chip', 'ou-tone-warning', 'whitespace-nowrap');
  });
});
