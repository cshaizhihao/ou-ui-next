import { render, screen } from '@testing-library/react';
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

describe('CustomersPage', () => {
  it('renders the decoupled customer directory from customer read models', () => {
    render(<CustomersPage customers={[customer]} language="zh" />);

    expect(screen.getByRole('heading', { name: '客户管理' })).toBeInTheDocument();
    expect(screen.getByText('客户甲')).toBeInTheDocument();
    expect(screen.getByText('受限')).toBeInTheDocument();
    expect(screen.getByText('客户节点')).toBeInTheDocument();
    expect(screen.getByText('订阅')).toBeInTheDocument();
    expect(screen.getByText('端口转发')).toBeInTheDocument();
    expect(screen.getByText('9.0 GB / 20.0 GB')).toBeInTheDocument();
    expect(screen.getByText('节点 1')).toBeInTheDocument();
    expect(screen.getByText('订阅 1')).toBeInTheDocument();
    expect(screen.getByText('转发 1')).toBeInTheDocument();
    expect(screen.getByText('主机 1')).toBeInTheDocument();
  });

  it('shows an empty state without seeded customer rows', () => {
    render(<CustomersPage customers={[]} language="zh" />);

    expect(screen.getByText('暂无客户')).toBeInTheDocument();
    expect(screen.queryByText('客户甲')).not.toBeInTheDocument();
  });
});
