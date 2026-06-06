import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentCredentialSummary, AgentSessionSummary, QuotaPolicy } from '../../domain';
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

const agentCredentials: Array<AgentCredentialSummary & { agentToken?: string; tokenHash?: string }> = [
  {
    id: 'runtime-credential-agent-hkg-01',
    agentId: 'agent-hkg-01',
    tokenPrefix: 'oat_7f1c2a',
    status: 'active',
    purpose: 'runtime',
    issuedAt: '2026-06-05T09:00:00.000Z',
    expiresAt: '2026-09-03T09:00:00.000Z',
    issuedBy: 'agent:agent-hkg-01',
    sourceIp: '198.51.100.10',
    requestId: 'req-agent-runtime-credential-001',
    lastUsedAt: '2026-06-05T10:00:00.000Z',
    sessionId: 'sess-agent-hkg-01',
    metadata: {
      installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
    },
    agentToken: 'oat_full_runtime_token_must_not_render',
    tokenHash: 'sha256:runtime-token-hash-must-not-render'
  }
];

const agentSessions: AgentSessionSummary[] = [
  {
    agentId: 'agent-hkg-01',
    sessionId: 'sess-agent-hkg-01',
    status: 'online',
    lastSeq: 42,
    lastSeenCommandSeq: 7,
    version: '1.2.3-agent',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    lastHeartbeatAt: '2026-06-05T10:15:00.000Z',
    updatedAt: '2026-06-05T10:16:00.000Z'
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

  it('renders sanitized Agent credential inventory and triggers credential operations', async () => {
    const user = userEvent.setup();
    const onRevokeAgentCredential = vi.fn();
    const onRotateAgentCredential = vi.fn();

    render(
      <PermissionsPage
        agentCredentials={agentCredentials}
        agentSessions={agentSessions}
        currentOperatorSessionId={undefined}
        grants={[]}
        language="zh"
        operatorSessions={[]}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeAgentCredential={onRevokeAgentCredential}
        onRotateAgentCredential={onRotateAgentCredential}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 运行凭证')).toBeInTheDocument();
    expect(screen.getByText('agent-hkg-01')).toBeInTheDocument();
    expect(screen.getByText(/令牌前缀 oat_7f1c2a/)).toBeInTheDocument();
    expect(screen.getByText('运行凭证')).toBeInTheDocument();
    expect(screen.getByText('活跃')).toBeInTheDocument();
    expect(screen.getByText('在线')).toBeInTheDocument();
    expect(screen.getByText(/事件 seq 42/)).toBeInTheDocument();
    expect(screen.getByText(/命令 seq 7/)).toBeInTheDocument();
    expect(screen.getByText(/Agent 版本 1.2.3-agent/)).toBeInTheDocument();
    expect(screen.getByText(/能力 host-agent, xray, port-forwarding/)).toBeInTheDocument();
    expect(screen.queryByText('oat_full_runtime_token_must_not_render')).not.toBeInTheDocument();
    expect(screen.queryByText('sha256:runtime-token-hash-must-not-render')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '轮换凭证' }));
    await user.click(screen.getByRole('button', { name: '撤销凭证' }));

    expect(onRotateAgentCredential).toHaveBeenCalledWith('runtime-credential-agent-hkg-01');
    expect(onRevokeAgentCredential).toHaveBeenCalledWith('runtime-credential-agent-hkg-01');
  });
});
