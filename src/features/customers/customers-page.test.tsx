import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomerReadModel } from '../../domain';
import { CustomersPage } from './customers-page';

const GB = 1024 ** 3;

const customer: CustomerReadModel = {
  id: 'customer:u-5ba262377532',
  name: '客户甲',
  status: 'limited',
  sourceKinds: ['customer-node', 'forwarding', 'subscription'],
  customerNodeCount: 1,
  subscriptionClientCount: 1,
  forwardRuleCount: 1,
  agentIds: ['agent-hkg-01'],
  customerNodeIds: ['customer-node-alpha-hkg'],
  subscriptionClientIds: ['sub-client-alpha'],
  forwardRuleIds: ['forward-alpha-game'],
  customerNodeUsedTrafficBytes: 4 * GB,
  customerNodeTrafficLimitBytes: 10 * GB,
  subscriptionUsedTrafficBytes: 6 * GB,
  subscriptionTrafficLimitBytes: 12 * GB,
  forwardingUsedTrafficBytes: 3 * GB,
  forwardingTrafficLimitBytes: 8 * GB,
  usedTrafficBytes: 9 * GB,
  trafficLimitBytes: 20 * GB,
  expiresAt: '2026-11-30T00:00:00.000Z',
  lastActivityAt: '2026-06-05T10:10:00.000Z',
  quotaExceeded: true,
  runtimeDisabledByPolicy: true
};

const backupCustomer: CustomerReadModel = {
  ...customer,
  id: 'customer:u-backup',
  name: '客户乙',
  status: 'active',
  sourceKinds: ['subscription'],
  customerNodeCount: 0,
  subscriptionClientCount: 1,
  forwardRuleCount: 0,
  agentIds: ['agent-sin-01'],
  customerNodeIds: [],
  subscriptionClientIds: ['sub-client-backup'],
  forwardRuleIds: [],
  customerNodeUsedTrafficBytes: 0,
  customerNodeTrafficLimitBytes: 0,
  subscriptionUsedTrafficBytes: 2 * GB,
  subscriptionTrafficLimitBytes: 10 * GB,
  forwardingUsedTrafficBytes: 0,
  forwardingTrafficLimitBytes: 0,
  usedTrafficBytes: 2 * GB,
  trafficLimitBytes: 10 * GB,
  quotaExceeded: false,
  runtimeDisabledByPolicy: false
};

describe('CustomersPage', () => {
  it('renders the decoupled customer directory from customer read models', () => {
    render(<CustomersPage customers={[customer]} language="zh" />);

    const overview = screen.getByRole('region', { name: '运营总览' });
    expect(within(overview).getByText(/1\. 审阅客户覆盖/)).toBeInTheDocument();
    expect(within(overview).getByText('客户总数 1')).toBeInTheDocument();
    expect(within(overview).getByText('正常客户 0')).toBeInTheDocument();
    expect(within(overview).getByText('受限客户 1')).toBeInTheDocument();
    expect(within(overview).getByText('聚合用量 9.0 GB')).toBeInTheDocument();

    const row = screen.getByRole('row', { name: /客户甲/ });

    expect(within(row).getByText('客户甲')).toBeInTheDocument();
    expect(within(row).getByText('受限')).toBeInTheDocument();
    expect(within(row).getByText('客户节点')).toBeInTheDocument();
    expect(within(row).getByText('订阅')).toBeInTheDocument();
    expect(within(row).getByText('端口转发')).toBeInTheDocument();
    expect(within(row).getByText('9.0 GB / 20.0 GB')).toBeInTheDocument();
    expect(within(row).getByText('节点 1')).toBeInTheDocument();
    expect(within(row).getByText('订阅 1')).toBeInTheDocument();
    expect(within(row).getByText('转发 1')).toBeInTheDocument();
    expect(within(row).getByText('主机 1')).toBeInTheDocument();
  });

  it('shows an empty state without seeded customer rows', () => {
    render(<CustomersPage customers={[]} language="zh" />);

    expect(screen.getByText('暂无客户')).toBeInTheDocument();
    expect(screen.queryByText('客户甲')).not.toBeInTheDocument();
  });

  it('bulk copies resource IDs for selected filtered customers from the directory table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<CustomersPage customers={[customer, backupCustomer]} language="zh" />);

    await user.type(screen.getByRole('searchbox', { name: '搜索客户' }), 'sub-client-backup');
    await user.click(screen.getByRole('checkbox', { name: '选择当前客户' }));
    await user.click(screen.getByRole('button', { name: '批量复制资源 ID' }));

    expect(writeText).toHaveBeenCalledWith(
      ['客户乙', '客户节点: 暂无资源', '订阅: sub-client-backup', '转发: 暂无资源', '主机: agent-sin-01'].join('\n')
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('customer-node-alpha-hkg'));
  });

  it('bulk copies customer summaries for selected filtered customers from the directory table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<CustomersPage customers={[customer, backupCustomer]} language="en" />);

    await user.selectOptions(screen.getByLabelText('Customer Status'), 'limited');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customers' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Customer Summaries' }));

    expect(writeText).toHaveBeenCalledTimes(1);

    const copiedSummary = writeText.mock.calls[0]?.[0] as string;

    expect(copiedSummary).toContain('Customer: 客户甲');
    expect(copiedSummary).toContain('Status: Limited');
    expect(copiedSummary).toContain('Traffic: 9.0 GB / 20.0 GB');
    expect(copiedSummary).toContain('Customer Nodes: customer-node-alpha-hkg');
    expect(copiedSummary).toContain('Subscriptions: sub-client-alpha');
    expect(copiedSummary).toContain('Forwarding: forward-alpha-game');
    expect(copiedSummary).toContain('Hosts: agent-hkg-01');
    expect(copiedSummary).toContain('Quota Exceeded: true');
    expect(copiedSummary).toContain('Runtime Disabled By Policy: true');
    expect(copiedSummary).not.toContain('客户乙');
    expect(copiedSummary).not.toContain('sub-client-backup');
  });

  it('uses a v2 customer ownership cockpit visual system for resource operations', () => {
    const { container } = render(<CustomersPage customers={[customer, backupCustomer]} language="zh" />);

    const cockpit = screen.getByRole('region', { name: '客户资源 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '客户控制栏' });
    const workspace = within(cockpit).getByRole('region', { name: '客户资源工作区' });
    const overviewPanel = within(rail).getByRole('region', { name: '运营总览' });
    const directoryPanel = within(workspace).getByRole('complementary', { name: '客户目录面板' });
    const row = within(directoryPanel).getByText('客户甲').closest('tr');

    expect(cockpit).toHaveClass('customer-ops-cockpit');
    expect(rail).toHaveClass('customer-ops-rail');
    expect(workspace).toHaveClass('customer-ops-workspace');
    expect(overviewPanel).toHaveClass('customer-ops-overview-panel');
    expect(directoryPanel).toHaveClass('customer-ops-directory-panel');
    expect(row).toHaveClass('customer-ops-row');
    expect(container.outerHTML).toContain('blue-');
    expect(container.outerHTML).toContain('orange-');
    expect(container.outerHTML).not.toContain('cyan-');
    expect(container.outerHTML).not.toContain('purple-');
    expect(container.outerHTML).not.toContain('violet-');
    expect(container.outerHTML).not.toContain('background-clip:text');
  });

  it('filters customers by resource ownership and opens a copyable resource drawer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<CustomersPage customers={[customer, backupCustomer]} language="zh" />);

    await user.type(screen.getByRole('searchbox', { name: '搜索客户' }), 'forward-alpha-game');
    await user.selectOptions(screen.getByLabelText('客户状态'), 'limited');

    const overview = screen.getByRole('region', { name: '运营总览' });
    expect(within(overview).getByText('客户总数 2')).toBeInTheDocument();
    expect(within(overview).getByText('正常客户 1')).toBeInTheDocument();
    expect(within(overview).getByText('受限客户 1')).toBeInTheDocument();

    const row = screen.getByRole('row', { name: /客户甲/ });
    expect(within(row).getByText('客户甲')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /客户乙/ })).not.toBeInTheDocument();
    expect(screen.getByText('当前匹配 1 / 2')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: '查看客户资源' }));

    const drawer = screen.getByRole('dialog', { name: '客户甲 客户资源' });

    expect(within(drawer).getByText('customer-node-alpha-hkg')).toBeInTheDocument();
    expect(within(drawer).getByText('sub-client-alpha')).toBeInTheDocument();
    expect(within(drawer).getByText('forward-alpha-game')).toBeInTheDocument();
    expect(within(drawer).getByText('agent-hkg-01')).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: '复制全部资源 ID' }));

    expect(writeText).toHaveBeenCalledWith(
      ['客户节点: customer-node-alpha-hkg', '订阅: sub-client-alpha', '转发: forward-alpha-game', '主机: agent-hkg-01'].join('\n')
    );
  });
});
