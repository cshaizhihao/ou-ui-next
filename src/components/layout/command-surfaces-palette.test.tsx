import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionOverlay } from './action-overlay';
import { ControlPlaneSkeleton } from './control-plane-skeleton';
import { QuickActionPalette, type QuickActionItem } from './quick-action-palette';

const quickActionItems: QuickActionItem[] = [
  {
    id: 'forwarding-acme',
    title: '端口转发网络',
    description: '打开 端口转发',
    group: '端口转发',
    keywords: ['forwarding', 'acme'],
    pageId: 'forwarding',
    badge: '443',
    commands: [
      {
        kind: 'forward.apply',
        label: '应用',
        targetId: 'forwarding-acme'
      }
    ]
  },
  {
    id: 'subscription-acme',
    title: 'Acme 香港 Premium 订阅',
    description: '打开 订阅',
    group: '订阅',
    keywords: ['subscription', 'acme'],
    pageId: 'subscriptions',
    commands: [
      {
        kind: 'subscription.copy-uri',
        label: '复制链接',
        targetId: 'subscription-acme'
      }
    ]
  }
];

describe('command surfaces operations palette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('frames quick actions as an operations command surface with active, badge, and command tones', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '控制面搜索' });
    const firstResult = document.getElementById('quick-action-result-forwarding-acme') as HTMLElement;
    const groupBadge = within(firstResult).getByText('端口转发');
    const valueBadge = within(firstResult).getByText('443');
    const commandButton = screen.getByRole('button', { name: '应用 端口转发网络' });

    expect(document.querySelector('[data-quick-action-overlay="true"]')).toHaveClass('bg-[var(--ou-scrim)]');
    expect(dialog).toHaveClass('surface-shell');
    expect(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' })).toHaveClass('text-[var(--ou-text)]');
    expect(firstResult).toHaveClass('border-[var(--ou-primary)]', 'bg-[var(--ou-primary-soft)]');
    expect(groupBadge).toHaveClass('ou-tone-danger');
    expect(valueBadge).toHaveClass('ou-tone-warning');
    expect(commandButton).toHaveClass('ou-tone-danger');
  });

  it('keeps quick action results free of visible explanatory descriptions', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const results = screen.getByRole('list', { name: '搜索结果' });

    expect(within(results).getByRole('button', { name: '端口转发网络' })).toBeInTheDocument();
    expect(results).not.toHaveTextContent('打开 端口转发');
    expect(results).not.toHaveTextContent('打开 订阅');

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), {
      target: { value: '打开 订阅' }
    });

    expect(within(results).getByRole('button', { name: 'Acme 香港 Premium 订阅' })).toBeInTheDocument();
    expect(results).not.toHaveTextContent('打开 订阅');
  });

  it('summarizes control-plane search scope before the result list', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const scope = screen.getByRole('region', { name: '控制面搜索范围' });

    expect(scope).toHaveTextContent('可搜索对象');
    expect(scope).toHaveTextContent('2');
    expect(scope).toHaveTextContent('可执行命令');
    expect(scope).toHaveTextContent('2');
    expect(scope).toHaveTextContent('当前匹配');
    expect(scope).toHaveTextContent('2');

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), {
      target: { value: 'subscription' }
    });

    expect(scope).toHaveTextContent('当前匹配');
    expect(scope).toHaveTextContent('1');
  });

  it('localizes the control-plane search scope summary in English', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="en"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const scope = screen.getByRole('region', { name: 'Control Plane Scope' });

    expect(scope).toHaveTextContent('Searchable Objects');
    expect(scope).toHaveTextContent('2');
    expect(scope).toHaveTextContent('Executable Commands');
    expect(scope).toHaveTextContent('2');
    expect(scope).toHaveTextContent('Current Matches');
    expect(scope).toHaveTextContent('2');
  });

  it('surfaces localized keyboard hints for quick action search', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const shortcuts = screen.getByRole('list', { name: '控制面搜索快捷键' });

    expect(within(shortcuts).getByText('Enter')).toBeInTheDocument();
    expect(within(shortcuts).getByText('打开结果')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Ctrl Enter')).toBeInTheDocument();
    expect(within(shortcuts).getByText('执行动作')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Esc')).toBeInTheDocument();
    expect(within(shortcuts).getByText('关闭')).toBeInTheDocument();
  });

  it('localizes quick action keyboard hints in English', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="en"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const shortcuts = screen.getByRole('list', { name: 'Control Plane Search Shortcuts' });

    expect(within(shortcuts).getByText('Enter')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Open result')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Ctrl Enter')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Run action')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Esc')).toBeInTheDocument();
    expect(within(shortcuts).getByText('Close')).toBeInTheDocument();
  });

  it('surfaces executable command counts on each quick action result', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const firstResult = document.getElementById('quick-action-result-forwarding-acme') as HTMLElement;
    const secondResult = document.getElementById('quick-action-result-subscription-acme') as HTMLElement;

    expect(within(firstResult).getByText('1 个动作')).toBeInTheDocument();
    expect(within(secondResult).getByText('1 个动作')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), {
      target: { value: 'copy' }
    });

    const filteredResult = document.getElementById('quick-action-result-subscription-acme') as HTMLElement;
    expect(filteredResult).not.toBeNull();
    expect(within(filteredResult).getByText('1 个动作')).toBeInTheDocument();
  });

  it('stacks quick action result metadata and commands into touch-safe mobile rows', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const firstResult = document.getElementById('quick-action-result-forwarding-acme') as HTMLElement;
    const resultButton = within(firstResult).getByRole('button', { name: '端口转发网络' });
    const metadataRail = within(firstResult).getByText('端口转发').parentElement;
    const commandButton = within(firstResult).getByRole('button', { name: '应用 端口转发网络' });
    const commandRail = commandButton.parentElement;

    expect(firstResult).toHaveClass('max-sm:flex-col');
    expect(resultButton).toHaveClass('max-sm:flex-col', 'max-sm:items-start', 'max-sm:gap-3');
    expect(metadataRail).toHaveClass('max-sm:flex-wrap', 'max-sm:self-stretch');
    expect(commandRail).toHaveClass('max-sm:mt-0', 'max-sm:flex-wrap', 'max-sm:border-t');
    expect(commandButton).toHaveClass('max-sm:min-h-11', 'max-sm:flex-1');
  });

  it('localizes quick action result command counts in English', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="en"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    const firstResult = document.getElementById('quick-action-result-forwarding-acme') as HTMLElement;

    expect(within(firstResult).getByText('1 action')).toBeInTheDocument();
  });

  it('uses warning tone for quick action empty state after filtering', () => {
    render(
      <QuickActionPalette
        items={quickActionItems}
        language="zh"
        open
        onClose={vi.fn()}
        onRunCommand={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), {
      target: { value: 'missing-query' }
    });

    expect(screen.getAllByText('没有匹配结果')[0].closest('div')?.parentElement).toHaveClass('ou-tone-warning');
  });

  it('keeps action overlays compact without fixed runtime-impact filler copy', () => {
    render(
      <ActionOverlay
        confirmLabel="执行变更"
        description="应用端口转发策略"
        language="zh"
        open
        title="应用主机设置"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '应用主机设置' });

    expect(document.querySelector('[data-action-overlay="true"]')).toHaveClass('bg-[var(--ou-scrim)]');
    expect(dialog).toHaveClass('modal-panel', 'ou-surface');
    expect(screen.getByRole('button', { name: '关闭浮窗' })).toHaveClass('ou-tone-primary');
    expect(dialog).toHaveTextContent('应用端口转发策略');
    expect(dialog).not.toHaveTextContent('运行影响');
    expect(dialog).not.toHaveTextContent('应用前先生成配置快照');
    expect(dialog).not.toHaveTextContent('通知主机代理执行变更');
    expect(dialog).not.toHaveTextContent('成功后保留回滚点');
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('text-[var(--ou-text-muted)]');
  });

  it('uses a compact operations loading status for the control-plane skeleton', () => {
    render(<ControlPlaneSkeleton language="zh" />);

    const skeleton = screen.getByRole('status', { name: '同步中' });
    const loadingCards = skeleton.querySelectorAll('[data-skeleton-card="true"]');

    expect(skeleton).toHaveClass('surface-shell', 'p-3');
    expect(screen.getByText('同步中')).toHaveClass('text-[var(--ou-text)]');
    expect(screen.queryByText('正在并行拉取主机、客户节点、端口转发、订阅和审计证据。')).not.toBeInTheDocument();
    expect(loadingCards).toHaveLength(0);
    expect(skeleton.querySelector('.ou-skeleton')).toHaveClass('bg-[var(--ou-primary-soft)]');
  });
});
