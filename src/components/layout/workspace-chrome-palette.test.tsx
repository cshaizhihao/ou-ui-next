import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNav } from './mobile-bottom-nav';
import { OperationsLaunchpad } from './operations-launchpad';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

describe('workspace chrome fauvist palette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps launchpad task paths to the fauvist operational signal palette', () => {
    render(
      <OperationsLaunchpad
        activePage="dashboard"
        agentsCount={1}
        forwardingRulesCount={3}
        language="zh"
        nodesCount={2}
        subscriptionsCount={4}
        onOpenQuickActions={vi.fn()}
        onSelectPage={vi.fn()}
      />
    );

    expect(screen.getByText('操作启动台').closest('section')).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(screen.getByText('操作启动台').closest('section')).not.toHaveTextContent(
      '首屏直达主机、节点、转发与订阅，必要时可压缩成指标带。'
    );
    expect(screen.queryByText('安装 Agent、查看遥测并应用运行时配置')).not.toBeInTheDocument();
    expect(screen.queryByText('创建客户节点、复制分享链接并重置流量')).not.toBeInTheDocument();
    expect(screen.queryByText('管理多主机端口、配额、限速与策略状态')).not.toBeInTheDocument();
    expect(screen.queryByText('聚合订阅源、导出客户端配置与链接')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索 / 执行动作' })).toHaveClass(
      'border-[#1E3AFF]',
      'text-[#1E3AFF]'
    );
    expect(screen.getByText('1 台主机').closest('button')).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]');
    expect(screen.getByText('2 个节点').closest('button')).toHaveClass('border-[#00A878]', 'bg-[#00A878]/[0.12]');
    expect(screen.getByText('3 条规则').closest('button')).toHaveClass('border-[#FF3D18]', 'bg-[#FF3D18]/[0.12]');
    expect(screen.getByText('4 个订阅').closest('button')).toHaveClass('border-[#D9FF00]', 'bg-[#D9FF00]/[0.28]');
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
        onOpenQuickActions={vi.fn()}
        onSelectPage={vi.fn()}
      />
    );

    const launchpad = screen.getByText('操作启动台').closest('section');
    expect(launchpad).toHaveAttribute('data-state', 'expanded');
    expect(document.querySelector('.ou-launchpad-panel')).toHaveClass('motion-safe:animate-[ou-panel-in_180ms_ease-out]');

    fireEvent.click(screen.getByRole('button', { name: /收起/ }));

    expect(launchpad).toHaveAttribute('data-state', 'collapsed');
    expect(document.querySelector('.ou-launchpad-metric-rail')).toHaveClass(
      'motion-safe:animate-[ou-panel-in_180ms_ease-out]'
    );
  });

  it('uses fauvist wayfinding on the sidebar active path and master-node status block', () => {
    render(<Sidebar activePage="forwarding" language="zh" onPageChange={vi.fn()} />);

    const sidebar = screen.getByRole('complementary');
    const activeItem = screen.getByRole('button', { name: '端口转发' });
    const masterNode = screen.getByText('主控节点').closest('div');

    expect(sidebar).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(screen.getByRole('button', { name: '收起 控制面' })).toHaveClass(
      'border-[#D9FF00]',
      'bg-[#D9FF00]/[0.18]'
    );
    expect(activeItem).toHaveClass('nav-active', 'border-[#1E3AFF]', 'bg-[#DCE1FF]');
    expect(masterNode?.parentElement).toHaveClass('border-[#00A878]', 'bg-[#00A878]/[0.12]');
  });

  it('keeps topbar global controls on the same fauvist command, execute, and verify colors', () => {
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

    expect(screen.getByRole('banner')).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    const quickActionButton = screen.getByRole('button', { name: '打开控制面搜索' });
    expect(quickActionButton).toHaveClass('border-[#1E3AFF]', 'text-[#1E3AFF]');
    expect(within(quickActionButton).getByText('12 对象')).toBeInTheDocument();
    expect(within(quickActionButton).getByText('5 动作')).toBeInTheDocument();
    expect(within(quickActionButton).getByText('Ctrl K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toHaveClass('border-[#FF3D18]', 'text-[#FF3D18]');
    expect(screen.getByRole('button', { name: '切换深浅主题' })).toHaveClass('border-[#D9FF00]', 'text-[#07111F]');
  });

  it('keeps mobile navigation saturated without falling back to gray admin chrome', () => {
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
    expect(mobileNavigation).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(within(mobileNavigation).getByRole('button', { name: '执行记录' })).toHaveClass(
      'border-[#1E3AFF]',
      'bg-[#1E3AFF]',
      'text-white'
    );
    expect(within(mobileNavigation).getByRole('button', { name: '搜索' })).toHaveClass(
      'border-[#FF3D18]',
      'bg-[#FF3D18]/[0.14]',
      'text-[#07111F]'
    );
    const quickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });
    const commandBadge = within(quickActionButton).getByText('5 动作');
    expect(commandBadge).toHaveClass('border-[#D9FF00]', 'bg-[#D9FF00]/[0.28]', 'text-[#07111F]');
  });
});
