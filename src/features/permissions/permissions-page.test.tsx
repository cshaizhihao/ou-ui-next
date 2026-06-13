import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AgentCredentialSummary,
  AgentSessionSummary,
  OperatorSessionSummary,
  PermissionGrant,
  QuotaPolicy
} from '../../domain';
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

const permissionGrants: PermissionGrant[] = [
  {
    id: 'grant-owner-forward-acme',
    subjectType: 'group',
    subjectId: 'owner',
    resourceType: 'forward-rule',
    resourceId: 'forward-acme-game',
    permissions: ['read', 'operate', 'configure', 'grant'],
    grantedBy: 'system:bootstrap',
    reason: 'owner-scoped forwarding management',
    resourceVersion: 'permv-0101',
    createdAt: '2026-06-05T09:00:00.000Z',
    updatedAt: '2026-06-05T09:00:00.000Z'
  },
  {
    id: 'grant-viewer-subscription',
    subjectType: 'group',
    subjectId: 'viewer',
    resourceType: 'subscription',
    resourceId: 'sub-client-backup',
    permissions: ['read'],
    grantedBy: 'system:bootstrap',
    reason: 'viewer subscription read access',
    resourceVersion: 'permv-0102',
    createdAt: '2026-06-05T09:00:00.000Z',
    updatedAt: '2026-06-05T09:00:00.000Z'
  }
];

const operatorSessions: OperatorSessionSummary[] = [
  {
    id: 'operator-session-current',
    username: 'admin',
    actor: 'operator:admin',
    operatorGroupId: 'owners',
    resourceGroupId: 'global',
    status: 'active',
    issuedAt: '2026-06-05T08:00:00.000Z',
    expiresAt: '2026-06-06T08:00:00.000Z',
    sourceIp: '198.51.100.11',
    userAgent: 'Mozilla/5.0 Chrome Current',
    requestId: 'req-current-session'
  },
  {
    id: 'operator-session-stale-acme',
    username: 'admin',
    actor: 'operator:admin',
    operatorGroupId: 'owners',
    resourceGroupId: 'acme',
    status: 'active',
    issuedAt: '2026-06-04T08:00:00.000Z',
    expiresAt: '2026-06-05T08:00:00.000Z',
    sourceIp: '203.0.113.77',
    userAgent: 'Mozilla/5.0 Firefox Stale',
    requestId: 'req-stale-acme'
  },
  {
    id: 'operator-session-revoked-backup',
    username: 'backup-operator',
    actor: 'operator:backup',
    operatorGroupId: 'support',
    resourceGroupId: 'backup',
    status: 'revoked',
    issuedAt: '2026-06-03T08:00:00.000Z',
    expiresAt: '2026-06-04T08:00:00.000Z',
    sourceIp: '203.0.113.88',
    userAgent: 'Mozilla/5.0 Safari Revoked',
    requestId: 'req-revoked-backup',
    revokedAt: '2026-06-03T09:00:00.000Z',
    revokedBy: 'operator:admin',
    revokedReason: 'manual cleanup'
  }
];

describe('PermissionsPage', () => {
  it('splits permissions into a safety cockpit rail and evidence workspace', () => {
    render(
      <PermissionsPage
        agentCredentials={agentCredentials}
        agentSessions={agentSessions}
        currentOperatorSessionId="operator-session-current"
        grants={permissionGrants}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={quotaPolicies}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeAgentCredential={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
        onRotateAgentCredential={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Permissions safety cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Permissions control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Permissions evidence workspace' });

    expect(within(rail).getByText('Quota Guard')).toBeInTheDocument();
    expect(within(rail).getByText('Resource Scope')).toBeInTheDocument();
    expect(within(rail).getByText('Operator Sessions')).toBeInTheDocument();
    expect(within(workspace).getByRole('heading', { name: 'Access Grants' })).toBeInTheDocument();
    expect(within(workspace).getByRole('heading', { name: 'Operator Sessions' })).toBeInTheDocument();
    expect(within(workspace).getByRole('heading', { name: 'Agent Runtime Credentials' })).toBeInTheDocument();
    expect(within(workspace).getByRole('heading', { name: 'Live Quota Read Model' })).toBeInTheDocument();
  });

  it('uses the primary blue control-plane palette instead of cyan in the permissions cockpit', () => {
    render(
      <PermissionsPage
        agentCredentials={agentCredentials}
        agentSessions={agentSessions}
        currentOperatorSessionId="operator-session-current"
        grants={permissionGrants}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={quotaPolicies}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeAgentCredential={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
        onRotateAgentCredential={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Permissions safety cockpit' });
    expect(cockpit.outerHTML).toContain('blue-');
    expect(cockpit.outerHTML).not.toContain('cyan-');
  });

  it('uses a v2 permissions cockpit visual system for policy evidence surfaces', () => {
    render(
      <PermissionsPage
        agentCredentials={agentCredentials}
        agentSessions={agentSessions}
        currentOperatorSessionId="operator-session-current"
        grants={permissionGrants}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={quotaPolicies}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeAgentCredential={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
        onRotateAgentCredential={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Permissions safety cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Permissions control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Permissions evidence workspace' });
    const grantsPanel = within(workspace).getByRole('group', { name: 'Access Grants' });
    const sessionsPanel = within(workspace).getByRole('region', { name: 'Operator Sessions' });
    const credentialsPanel = within(workspace).getByRole('group', { name: 'Agent Runtime Credentials' });
    const quotaReadModelPanel = within(workspace).getByRole('group', { name: 'Live Quota Read Model' });
    const grantRow = within(grantsPanel).getByRole('article', { name: 'grant-owner-forward-acme' });
    const sessionRow = within(sessionsPanel).getByRole('article', { name: 'operator-session-current' });
    const credentialRow = within(credentialsPanel).getByText('runtime-credential-agent-hkg-01').closest('tr');
    const quotaRow = within(quotaReadModelPanel).getByText('managed-host:agent-hkg-01').closest('tr');

    expect(cockpit).toHaveClass('permissions-safety-cockpit');
    expect(rail).toHaveClass('permissions-safety-rail');
    expect(workspace).toHaveClass('permissions-safety-workspace');
    expect(grantsPanel).toHaveClass('permissions-safety-grants-panel');
    expect(sessionsPanel).toHaveClass('permissions-safety-sessions-panel');
    expect(credentialsPanel).toHaveClass('permissions-safety-credentials-panel');
    expect(quotaReadModelPanel).toHaveClass('permissions-safety-quota-panel');
    expect(grantRow).toHaveClass('permissions-safety-grant-row');
    expect(sessionRow).toHaveClass('permissions-safety-session-row');
    expect(credentialRow).toHaveClass('permissions-safety-credential-row');
    expect(quotaRow).toHaveClass('permissions-safety-quota-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
  });

  it('renders an operational overview band with workflow cues and rollups', () => {
    render(
      <PermissionsPage
        currentOperatorSessionId={undefined}
        grants={permissionGrants}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={quotaPolicies}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText(/Review grants/)).toBeInTheDocument();
    expect(within(overview).getByText(/Check quotas/)).toBeInTheDocument();
    expect(within(overview).getByText(/Audit sessions/)).toBeInTheDocument();
    expect(within(overview).getByText(/Rotate credentials/)).toBeInTheDocument();
    expect(within(overview).getByText('Operator Sessions')).toBeInTheDocument();
    expect(within(overview).getByText('2/3')).toBeInTheDocument();
  });

  it('renders live quota policies and filters them by scope', async () => {
    const user = userEvent.setup();
    const onResetQuota = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

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
    const disabledQuotaRow = screen.getByText('customer-node:node-01:client-a').closest('tr');
    expect(disabledQuotaRow).not.toBeNull();
    expect(within(disabledQuotaRow as HTMLElement).getByText('客户节点 A')).toBeInTheDocument();
    expect(within(disabledQuotaRow as HTMLElement).getByText('已停用')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '客户节点 · 1' }));

    expect(screen.queryByText('香港入口主机')).not.toBeInTheDocument();
    const filteredQuotaRow = screen.getByText('customer-node:node-01:client-a').closest('tr');
    expect(filteredQuotaRow).not.toBeNull();
    expect(within(filteredQuotaRow as HTMLElement).getByText('客户节点 A')).toBeInTheDocument();
    expect(within(filteredQuotaRow as HTMLElement).getByText('xray_client_monthly_quota_exceeded')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重置配额/i }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('重置 客户节点 A 的配额'));
    expect(onResetQuota).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /重置配额/i }));

    expect(onResetQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-node:node-01:client-a' }));
  });

  it('shows a quota reset impact preflight before resetting a quota read model', () => {
    render(
      <PermissionsPage
        currentOperatorSessionId={undefined}
        grants={[]}
        language="en"
        operatorSessions={[]}
        quotaPolicies={[quotaPolicies[1]]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const preflight = screen.getByRole('region', { name: /Quota Reset Impact Preflight/ });
    expect(within(preflight).getByText('Target Customer Node · 客户节点 A')).toBeInTheDocument();
    expect(within(preflight).getByText('Current Usage 8.0 GB / 8.0 GB')).toBeInTheDocument();
    expect(within(preflight).getByText('Usage Ratio 100%')).toBeInTheDocument();
    expect(within(preflight).getByText('Billing Direction Both')).toBeInTheDocument();
    expect(within(preflight).getByText('Reset Window Monthly · Day 9')).toBeInTheDocument();
    expect(within(preflight).getByText('Current State Disabled')).toBeInTheDocument();
    expect(within(preflight).getByText('Guardrail xray_client_monthly_quota_exceeded')).toBeInTheDocument();

    const impactPreview = within(preflight).getByText('Impact Preview').closest('div');
    expect(within(impactPreview as HTMLElement).getByText('Counter Scope customer-node:node-01:client-a')).toBeInTheDocument();
    expect(within(impactPreview as HTMLElement).getByText('Read Model State Disabled')).toBeInTheDocument();
    expect(within(impactPreview as HTMLElement).getByText('Runtime Guard Runtime state unchanged')).toBeInTheDocument();
  });

  it('renders sanitized Agent credential inventory and confirms credential operations before running them', async () => {
    const user = userEvent.setup();
    const onRevokeAgentCredential = vi.fn();
    const onRotateAgentCredential = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

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
    const credentialRow = screen.getByText('runtime-credential-agent-hkg-01').closest('tr');
    expect(credentialRow).not.toBeNull();
    expect(within(credentialRow as HTMLElement).getByText('agent-hkg-01')).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText(/令牌前缀 oat_7f1c2a/)).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText('运行凭证')).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText('活跃')).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText('在线')).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText(/事件 seq 42/)).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText(/命令 seq 7/)).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText(/Agent 版本 1.2.3-agent/)).toBeInTheDocument();
    expect(within(credentialRow as HTMLElement).getByText(/能力 host-agent, xray, port-forwarding/)).toBeInTheDocument();
    expect(screen.queryByText('oat_full_runtime_token_must_not_render')).not.toBeInTheDocument();
    expect(screen.queryByText('sha256:runtime-token-hash-must-not-render')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '轮换凭证' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('轮换凭证 runtime-credential-agent-hkg-01'));
    expect(onRotateAgentCredential).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '轮换凭证' }));
    await user.click(screen.getByRole('button', { name: '撤销凭证' }));

    expect(onRotateAgentCredential).toHaveBeenCalledWith('runtime-credential-agent-hkg-01');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('撤销凭证 runtime-credential-agent-hkg-01'));
    expect(onRevokeAgentCredential).toHaveBeenCalledWith('runtime-credential-agent-hkg-01');
  });

  it('shows an Agent credential operation preflight without leaking credential secrets', () => {
    render(
      <PermissionsPage
        agentCredentials={agentCredentials}
        agentSessions={agentSessions}
        currentOperatorSessionId={undefined}
        grants={[]}
        language="en"
        operatorSessions={[]}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeAgentCredential={vi.fn()}
        onRotateAgentCredential={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const preflight = screen.getByRole('region', { name: 'Agent Credential Operation Preflight' });
    expect(within(preflight).getByText('Bound Agent agent-hkg-01')).toBeInTheDocument();
    expect(within(preflight).getByText('Bound Session sess-agent-hkg-01')).toBeInTheDocument();
    expect(within(preflight).getByText('Capabilities 3')).toBeInTheDocument();
    expect(within(preflight).getByText('Token Prefix oat_7f1c2a')).toBeInTheDocument();
    expect(within(preflight).getByText('Request Evidence req-agent-runtime-credential-001')).toBeInTheDocument();

    const capabilityPreview = within(preflight).getByText('Capability Preview').closest('div');
    expect(within(capabilityPreview as HTMLElement).getByText('host-agent')).toBeInTheDocument();
    expect(within(capabilityPreview as HTMLElement).getByText('xray')).toBeInTheDocument();
    expect(within(capabilityPreview as HTMLElement).getByText('port-forwarding')).toBeInTheDocument();
    expect(screen.queryByText('oat_full_runtime_token_must_not_render')).not.toBeInTheDocument();
    expect(screen.queryByText('sha256:runtime-token-hash-must-not-render')).not.toBeInTheDocument();
  });

  it('filters access grants by resource ownership and required permission before submitting a change task', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <PermissionsPage
        currentOperatorSessionId={undefined}
        grants={permissionGrants}
        language="en"
        operatorSessions={[]}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRunTask={onRunTask}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Grants' }), 'forward-acme');
    await user.selectOptions(screen.getByLabelText('Resource Type'), 'forward-rule');
    await user.selectOptions(screen.getByLabelText('Required Permission'), 'grant');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('group:owner')).toBeInTheDocument();
    expect(screen.getByText(/forward-acme-game/)).toBeInTheDocument();
    expect(screen.queryByText('group:viewer')).not.toBeInTheDocument();
    expect(screen.queryByText(/sub-client-backup/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit Permission Change' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Submit permission change for grant-owner-forward-acme'));
    expect(onRunTask).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Submit Permission Change' }));

    expect(onRunTask).toHaveBeenCalledWith('grant-owner-forward-acme');
  });

  it('filters operator sessions before confirming bulk revoke for selected active non-current sessions', async () => {
    const user = userEvent.setup();
    const onRevokeOperatorSession = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <PermissionsPage
        currentOperatorSessionId="operator-session-current"
        grants={[]}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeOperatorSession={onRevokeOperatorSession}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Operator Sessions' }), 'stale');
    await user.selectOptions(screen.getByLabelText('Session Status'), 'active');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Sessions' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Revoke Sessions' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Revoke 1 selected operator session'));
    expect(onRevokeOperatorSession).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Revoke Sessions' }));

    expect(onRevokeOperatorSession).toHaveBeenCalledTimes(1);
    expect(onRevokeOperatorSession).toHaveBeenCalledWith('operator-session-stale-acme');
    expect(onRevokeOperatorSession).not.toHaveBeenCalledWith('operator-session-current');
    expect(onRevokeOperatorSession).not.toHaveBeenCalledWith('operator-session-revoked-backup');
  });

  it('shows a session bulk impact preflight for selected active operator sessions before revoke actions', async () => {
    const user = userEvent.setup();

    render(
      <PermissionsPage
        currentOperatorSessionId="operator-session-current"
        grants={[]}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Operator Sessions' }), 'stale');
    await user.selectOptions(screen.getByLabelText('Session Status'), 'active');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Sessions' }));

    const preflight = screen.getByRole('region', { name: 'Session Bulk Impact Preflight' });
    expect(within(preflight).getByText('Affected Operators 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Source Addresses 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Client Fingerprints 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Request Evidence 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Expired/Soon 1')).toBeInTheDocument();

    const operatorPreview = within(preflight).getByText('Operator Preview').closest('div');
    const sourcePreview = within(preflight).getByText('Source Preview').closest('div');
    const requestPreview = within(preflight).getByText('Request Preview').closest('div');

    expect(within(operatorPreview as HTMLElement).getByText('admin · operator:admin')).toBeInTheDocument();
    expect(within(sourcePreview as HTMLElement).getByText('203.0.113.77')).toBeInTheDocument();
    expect(within(requestPreview as HTMLElement).getByText('req-stale-acme')).toBeInTheDocument();
  });

  it('copies selected operator session evidence before bulk revoke review', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <PermissionsPage
        currentOperatorSessionId="operator-session-current"
        grants={[]}
        language="en"
        operatorSessions={operatorSessions}
        quotaPolicies={[]}
        forwardingRules={[]}
        onResetQuota={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Operator Sessions' }), 'stale');
    await user.selectOptions(screen.getByLabelText('Session Status'), 'active');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Sessions' }));
    await user.click(screen.getByRole('button', { name: 'Copy Selected Session Evidence' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedEvidence = writeText.mock.calls[0]?.[0] as string;
    expect(copiedEvidence).toContain('Operator Session Evidence');
    expect(copiedEvidence).toContain('Session Count: 1');
    expect(copiedEvidence).toContain('ID: operator-session-stale-acme');
    expect(copiedEvidence).toContain('Actor: operator:admin');
    expect(copiedEvidence).toContain('Status: active');
    expect(copiedEvidence).toContain('Source IP: 203.0.113.77');
    expect(copiedEvidence).toContain('Request ID: req-stale-acme');
    expect(copiedEvidence).toContain('User Agent: Mozilla/5.0 Firefox Stale');
    expect(copiedEvidence).not.toContain('operator-session-current');
    expect(copiedEvidence).not.toContain('operator-session-revoked-backup');
  });
});
