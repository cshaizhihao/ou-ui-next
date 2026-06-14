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

describe('command surfaces fauvist palette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('frames quick actions as a fauvist command surface with active, badge, and command colors', () => {
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

    expect(document.querySelector('[data-quick-action-overlay="true"]')).toHaveClass('bg-[#07111F]/55');
    expect(dialog).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' })).toHaveClass('text-[#07111F]');
    expect(firstResult).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]');
    expect(groupBadge).toHaveClass('border-[#FF3D18]', 'text-[#FF3D18]');
    expect(valueBadge).toHaveClass('bg-[#D9FF00]/[0.28]', 'text-[#07111F]');
    expect(commandButton).toHaveClass('border-[#FF3D18]', 'bg-[#FF3D18]/[0.12]', 'text-[#FF3D18]');
  });

  it('uses fauvist colors for quick action empty state after filtering', () => {
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

    expect(screen.getAllByText('没有匹配结果')[0].closest('div')?.parentElement).toHaveClass(
      'border-[#D9FF00]',
      'bg-[#D9FF00]/[0.16]'
    );
  });

  it('frames action overlays with execution and verification boundaries', () => {
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
    const impact = screen.getByText('运行影响').closest('div');

    expect(document.querySelector('[data-action-overlay="true"]')).toHaveClass('bg-[#07111F]/55');
    expect(dialog).toHaveClass('border-[#FF3D18]', 'bg-[#FFFDF5]');
    expect(screen.getByRole('button', { name: '关闭浮窗' })).toHaveClass('border-[#1E3AFF]', 'text-[#1E3AFF]');
    expect(impact).toHaveClass('border-[#D9FF00]', 'bg-[#D9FF00]/[0.16]');
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('border-[#07111F]/25', 'text-[#35405A]');
  });

  it('uses fauvist loading plates for the control-plane skeleton', () => {
    render(<ControlPlaneSkeleton language="zh" />);

    const skeleton = screen.getByRole('status', { name: '正在同步控制面' });
    const loadingCards = skeleton.querySelectorAll('[data-skeleton-card="true"]');

    expect(skeleton).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(screen.getByText('正在同步控制面')).toHaveClass('text-[#07111F]');
    expect(screen.getByText('正在并行拉取主机、客户节点、端口转发、订阅和审计证据。')).toHaveClass('text-[#35405A]');
    expect(loadingCards).toHaveLength(4);
    expect(loadingCards[0]).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]/70');
    expect(loadingCards[1]).toHaveClass('border-[#00A878]', 'bg-[#00A878]/[0.12]');
    expect(loadingCards[2]).toHaveClass('border-[#FF3D18]', 'bg-[#FF3D18]/[0.12]');
    expect(loadingCards[3]).toHaveClass('border-[#D9FF00]', 'bg-[#D9FF00]/[0.22]');
  });
});
