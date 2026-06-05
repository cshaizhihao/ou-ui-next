import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuotaPolicy } from '../../domain';
import { PermissionsPage } from './permissions-page';

const GB = 1024 ** 3;

const quotaPolicies: QuotaPolicy[] = [
  {
    id: 'managed-host:agent-hkg-01',
    name: '香港入口主机',
    scope: 'managed-host',
    limitBytes: 50 * GB,
    usedBytes: 20 * GB,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'active',
    detail: '198.51.100.10',
    resetDay: 9,
    reportedAt: '2026-06-05T10:00:00.000Z'
  },
  {
    id: 'customer-node:node-01:client-a',
    name: '客户节点 A',
    scope: 'customer-node',
    limitBytes: 8 * GB,
    usedBytes: 8 * GB,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'disabled_by_quota',
    detail: 'Acme · customer-a@example.com',
    guardrailReason: 'xray_client_monthly_quota_exceeded',
    resetDay: 9,
    reportedAt: '2026-06-05T10:10:00.000Z'
  }
];

describe('PermissionsPage', () => {
  it('renders live quota policies and filters them by scope', async () => {
    const user = userEvent.setup();
    const onResetQuota = vi.fn();

    render(
      <PermissionsPage
        currentOperatorSessionId={undefined}
        grants={[]}
        language="zh"
        operatorSessions={[]}
        quotaPolicies={quotaPolicies}
        forwardingRules={[]}
        onResetQuota={onResetQuota}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('真实配额读模型')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部 · 2' })).toBeInTheDocument();
    expect(screen.getByText('香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('客户节点 A')).toBeInTheDocument();
    expect(screen.getByText('已停用')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '客户节点 · 1' }));

    expect(screen.queryByText('香港入口主机')).not.toBeInTheDocument();
    expect(screen.getByText('客户节点 A')).toBeInTheDocument();
    expect(screen.getByText('xray_client_monthly_quota_exceeded')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重置配额/i }));

    expect(onResetQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-node:node-01:client-a' }));
  });
});
