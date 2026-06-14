import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentCredentialSummary, AgentSessionSummary, OperatorSessionSummary } from '../../domain';
import { AdminAccountSettingsPage } from './admin-account-settings-page';

function createSession(overrides: Partial<OperatorSessionSummary> = {}): OperatorSessionSummary {
  return {
    id: 'operator-session-current',
    username: 'alice',
    actor: 'operator:alice',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    status: 'active',
    issuedAt: '2026-06-05T00:00:00.000Z',
    expiresAt: '2026-06-06T00:00:00.000Z',
    sourceIp: '127.0.0.1',
    userAgent: 'Vitest Browser',
    requestId: 'req-session-current',
    ...overrides
  };
}

const runtimeCredentialSummary: AgentCredentialSummary = {
  id: 'runtime-credential-agent-hkg-01',
  agentId: 'agent-hkg-01',
  purpose: 'runtime',
  status: 'active',
  tokenPrefix: 'oat_7f1c2a',
  issuedAt: '2026-06-05T00:00:00.000Z',
  expiresAt: '2026-09-03T00:00:00.000Z',
  lastUsedAt: '2026-06-05T01:00:00.000Z',
  issuedBy: 'operator:admin',
  sourceIp: '203.0.113.8',
  requestId: 'req-agent-runtime-credential-001',
  sessionId: 'sess-agent-hkg-01',
  metadata: {
    installProfile: ['host-agent', 'xray'],
    registrationCapabilities: ['host-agent', 'xray', 'port-forwarding']
  }
};

const agentSessionSummary: AgentSessionSummary = {
  agentId: 'agent-hkg-01',
  sessionId: 'sess-agent-hkg-01',
  status: 'online',
  version: '1.2.3-agent',
  capabilities: ['host-agent', 'xray', 'port-forwarding'],
  lastSeq: 42,
  lastSeenCommandSeq: 7,
  updatedAt: '2026-06-05T01:05:00.000Z',
  lastHeartbeatAt: '2026-06-05T01:05:00.000Z'
};

describe('AdminAccountSettingsPage', () => {
  it('splits account settings into a control rail and safety workspace cockpit', () => {
    render(
      <AdminAccountSettingsPage
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: 'sha256:latest-audit-anchor',
          operatorSessionCount: 2
        }}
        controlPlaneMode="http"
        currentOperatorSessionId="operator-session-current"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession()]}
        resourceGroupId="group-premium"
        onCopyControlPlaneBackup={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Account settings cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Account control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Control-plane safety workspace' });

    expect(within(rail).getByText('Current Login Identity')).toBeInTheDocument();
    expect(within(rail).getByText('sudo ou-ui rotate-credentials')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Show Current Credentials' })).toBeInTheDocument();

    expect(within(workspace).getByRole('heading', { name: 'Control-plane Backup' })).toBeInTheDocument();
    expect(within(workspace).getByText('sudo ou-ui restore-control-plane-backup --stdin')).toBeInTheDocument();
    expect(within(workspace).getByRole('heading', { name: 'Operator Sessions' })).toBeInTheDocument();
  });

  it('uses a v2 safety cockpit visual system for account backup and session controls', () => {
    render(
      <AdminAccountSettingsPage
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: 'sha256:latest-audit-anchor',
          operatorSessionCount: 2
        }}
        controlPlaneMode="http"
        currentOperatorSessionId="operator-session-current"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession()]}
        resourceGroupId="group-premium"
        onCopyControlPlaneBackup={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Account settings cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Account control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Control-plane safety workspace' });
    const backupPanel = within(workspace).getByRole('group', { name: 'Control-plane Backup' });
    const sessionsPanel = within(workspace).getByRole('group', { name: 'Operator Sessions' });
    const currentSession = within(sessionsPanel).getByRole('article', { name: 'alice operator:alice' });

    expect(cockpit).toHaveClass('account-safety-cockpit');
    expect(rail).toHaveClass('account-safety-rail');
    expect(workspace).toHaveClass('account-safety-workspace');
    expect(backupPanel).toHaveClass('account-safety-backup-panel');
    expect(sessionsPanel).toHaveClass('account-safety-sessions-panel');
    expect(currentSession).toHaveClass('account-safety-session-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#1E3AFF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#D9FF00');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#00A878');
    expect(within(backupPanel).getByText('Failed Tasks').closest('div')?.outerHTML).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('orange-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('amber-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('rose-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
  });

  it('uses compact structured grids instead of oversized or masonry-like safety cards', () => {
    render(
      <AdminAccountSettingsPage
        controlPlaneBackupPreflightResult={{
          status: 'warning',
          schemaLabel: 'Schema v1',
          inventoryResources: 18,
          runtimeArtifacts: 3,
          auditLogCount: 4,
          conflictCount: 2,
          conflictPreview: ['agent-hkg-01', 'forward-hkg-443'],
          redactionPassed: true,
          restoreCommand: 'sudo ou-ui restore-control-plane-backup --stdin',
          notes: ['resource_conflicts.require_confirmation']
        }}
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: 'sha256:latest-audit-anchor',
          operatorSessionCount: 2
        }}
        controlPlaneMode="http"
        currentOperatorSessionId="operator-session-current"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession(), createSession({ id: 'operator-session-remote' })]}
        resourceGroupId="group-premium"
        onCopyControlPlaneBackup={vi.fn()}
        onPreflightControlPlaneBackup={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Account settings cockpit' });
    const shellGrid = cockpit.querySelector('.account-safety-shell-grid');
    const rail = within(cockpit).getByRole('complementary', { name: 'Account control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Control-plane safety workspace' });
    const workspaceGrid = workspace.querySelector('.account-safety-dashboard-grid');
    const backupPanel = within(workspace).getByRole('group', { name: 'Control-plane Backup' });
    const sessionsPanel = within(workspace).getByRole('group', { name: 'Operator Sessions' });
    const compactMetricGrid = backupPanel.querySelector('.account-safety-compact-metrics-grid');
    const preflight = within(backupPanel).getByRole('region', { name: 'Restore Preflight Result' });
    const page = cockpit.closest('.admin-account-cockpit');
    const pageHtml = `${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`;

    expect(page).toHaveClass('space-y-3', 'md:space-y-4');
    expect(shellGrid).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(workspaceGrid).toHaveClass('account-safety-dashboard-grid');
    expect(workspaceGrid).toHaveClass('items-start');
    expect(workspaceGrid).toHaveClass('2xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)]');
    expect(rail.querySelectorAll('.account-safety-identity-row')).toHaveLength(4);
    expect(rail.querySelector('.account-safety-identity-list')).toHaveClass('gap-2');
    expect(backupPanel).toHaveClass('p-3');
    expect(sessionsPanel).toHaveClass('p-3');
    expect(compactMetricGrid).toHaveClass('grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]');
    expect(backupPanel.querySelector('.account-safety-backup-metric')).toHaveClass('p-2.5');
    expect(backupPanel.querySelector('.account-safety-backup-field')).toHaveClass('p-3');
    expect(preflight).toHaveClass('p-3');
    expect(pageHtml).not.toContain('masonry');
    expect(pageHtml).not.toContain('columns-');
    expect(pageHtml).not.toContain('grid-flow-row-dense');
    expect(pageHtml).not.toContain('row-span');
    expect(pageHtml).not.toContain('space-y-5');
    expect(pageHtml).not.toContain('space-y-6');
    expect(pageHtml).not.toContain('p-4');
    expect(pageHtml).not.toContain('p-5');
  });

  it('keeps long account safety evidence readable in the fauvist safety system', () => {
    const longAuditHash =
      'sha256:9c42f0de1c6b4b2d9ff001e3affff3d1800a87807111f35405a' +
      '9c42f0de1c6b4b2d9ff001e3affff3d1800a87807111f35405a';
    const longRestoreCommand =
      'sudo ou-ui restore-control-plane-backup --stdin --require-audit-anchor sha256:9c42f0de1c6b4b2d9ff001e3affff3d1800a87807111f35405a --dry-run';
    const longSession = createSession({
      id:
        'operator-session-prod-us-east-1-admin-rollout-2026-06-14-super-long-session-anchor',
      actor: 'operator:admin-production-reviewer-with-long-audit-context',
      requestId:
        'req-admin-account-session-revoke-prod-us-east-1-2026-06-14-control-plane-safety-long-id',
      userAgent:
        'OU-UI Next Production Browser Smoke / admin safety workspace / rollback evidence review / long client fingerprint'
    });

    render(
      <AdminAccountSettingsPage
        controlPlaneBackupPreflightResult={{
          status: 'warning',
          schemaLabel: 'Schema v1 production acceptance bundle',
          inventoryResources: 18,
          runtimeArtifacts: 3,
          auditLogCount: 4,
          conflictCount: 2,
          conflictPreview: [
            'agent-prod-us-east-1-control-plane-managed-host-primary-long-conflict',
            'forward-prod-us-east-1-tcp-443-customer-node-primary-long-conflict'
          ],
          redactionPassed: true,
          restoreCommand: longRestoreCommand,
          notes: [
            'resource conflicts require operator confirmation before restore because production forwarding and customer subscription identities overlap'
          ]
        }}
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: longAuditHash,
          operatorSessionCount: 1
        }}
        controlPlaneMode="http"
        currentOperatorSessionId={longSession.id}
        language="en"
        loginUsername="admin-production-super-long-login-identity"
        operatorGroupId="operator-group-owner-production-rollback-approval-long-boundary"
        operatorSessions={[longSession]}
        resourceGroupId="resource-group-premium-customer-production-long-boundary"
        onCopyControlPlaneBackup={vi.fn()}
        onPreflightControlPlaneBackup={vi.fn()}
        onRevokeOperatorSession={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Account settings cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Account control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Control-plane safety workspace' });
    const backupPanel = within(workspace).getByRole('group', { name: 'Control-plane Backup' });
    const sessionsPanel = within(workspace).getByRole('group', { name: 'Operator Sessions' });
    const sessionRow = within(sessionsPanel).getByRole('article', {
      name: `${longSession.username} ${longSession.actor}`
    });
    const preflight = within(backupPanel).getByRole('region', { name: 'Restore Preflight Result' });
    const pageHtml = `${rail.outerHTML}${workspace.outerHTML}`;

    expect(rail.querySelector('.account-safety-identity-card')).toBeInTheDocument();
    expect(rail.querySelector('.account-safety-command-card')).toBeInTheDocument();
    expect(backupPanel.querySelectorAll('.account-safety-backup-metric')).toHaveLength(10);
    expect(backupPanel.querySelectorAll('.account-safety-backup-field')).toHaveLength(2);
    expect(preflight).toHaveClass('account-safety-preflight-card');
    expect(sessionRow.querySelectorAll('.account-safety-session-meta')).toHaveLength(4);
    expect(within(rail).getByText('operator-group-owner-production-rollback-approval-long-boundary')).toHaveClass(
      'break-all'
    );
    expect(within(backupPanel).getByText(longAuditHash)).toHaveClass('break-all');
    expect(within(preflight).getByText(longRestoreCommand)).toHaveClass('break-all');
    expect(within(preflight).getByText(/resource conflicts require operator confirmation/)).toHaveClass('break-words');
    expect(within(sessionRow).getByText(new RegExp(longSession.requestId))).toHaveClass('break-all');
    expect(within(sessionRow).getByText(new RegExp(longSession.userAgent ?? ''))).toHaveClass('break-words');
    expect(pageHtml).toContain('#1E3AFF');
    expect(pageHtml).toContain('#FF3D18');
    expect(pageHtml).toContain('#D9FF00');
    expect(pageHtml).toContain('#00A878');
    expect(pageHtml).not.toContain('truncate');
    expect(pageHtml).not.toContain('blue-');
    expect(pageHtml).not.toContain('orange-');
    expect(pageHtml).not.toContain('amber-');
    expect(pageHtml).not.toContain('purple-');
    expect(pageHtml).not.toContain('sky-');
    expect(pageHtml).not.toContain('indigo-');
    expect(pageHtml).not.toContain('cyan-');
    expect(pageHtml).not.toContain('rose-');
  });

  it('surfaces account identity, server credential commands, and operator session revocation', async () => {
    const user = userEvent.setup();
    const onRevokeOperatorSession = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <AdminAccountSettingsPage
        controlPlaneMode="http"
        currentOperatorSessionId="operator-session-current"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[
          createSession(),
          createSession({
            id: 'operator-session-remote',
            sourceIp: '203.0.113.12',
            requestId: 'req-session-remote'
          }),
          createSession({
            id: 'operator-session-revoked',
            status: 'revoked',
            requestId: 'req-session-revoked'
          })
        ]}
        resourceGroupId="group-premium"
        onRevokeOperatorSession={onRevokeOperatorSession}
      />
    );

    expect(screen.getByRole('heading', { name: 'Admin Accounts' })).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('group-premium')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('sudo ou-ui rotate-credentials')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show Current Credentials' }));
    expect(screen.getByText('sudo ou-ui credentials')).toBeInTheDocument();

    expect(screen.getByText('Current Session')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.12/)).toBeInTheDocument();

    const remoteRevokeButton = screen
      .getAllByRole('button', { name: 'Revoke Session' })
      .find((button) => !button.hasAttribute('disabled'));

    expect(remoteRevokeButton).toBeDefined();
    await user.click(remoteRevokeButton!);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Revoke operator session operator-session-remote'));
    expect(onRevokeOperatorSession).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(remoteRevokeButton!);

    expect(onRevokeOperatorSession).toHaveBeenCalledWith('operator-session-remote');
  });

  it('manages sanitized Agent runtime credentials from the account safety workspace', async () => {
    const user = userEvent.setup();
    const onRevokeAgentCredential = vi.fn();
    const onRotateAgentCredential = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <AdminAccountSettingsPage
        agentCredentials={[runtimeCredentialSummary]}
        agentSessions={[agentSessionSummary]}
        controlPlaneMode="http"
        currentOperatorSessionId="operator-session-current"
        language="zh"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession()]}
        resourceGroupId="group-premium"
        onRevokeAgentCredential={onRevokeAgentCredential}
        onRotateAgentCredential={onRotateAgentCredential}
        onRevokeOperatorSession={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 运行凭证')).toBeInTheDocument();
    const credentialRow = screen.getByText(runtimeCredentialSummary.id).closest('tr');
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
    expect(screen.getByRole('region', { name: 'Agent 凭证操作预检' })).toBeInTheDocument();
    expect(screen.queryByText('oat_shell_full_token_must_not_render')).not.toBeInTheDocument();
    expect(screen.queryByText('sha256:runtime-token-hash-must-not-render')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '轮换凭证' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`轮换凭证 ${runtimeCredentialSummary.id}`));
    expect(onRotateAgentCredential).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '轮换凭证' }));
    await user.click(screen.getByRole('button', { name: '撤销凭证' }));

    expect(onRotateAgentCredential).toHaveBeenCalledWith(runtimeCredentialSummary.id);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`撤销凭证 ${runtimeCredentialSummary.id}`));
    expect(onRevokeAgentCredential).toHaveBeenCalledWith(runtimeCredentialSummary.id);
  });

  it('surfaces the control-plane backup summary and copy action', async () => {
    const user = userEvent.setup();
    const onCopyControlPlaneBackup = vi.fn();

    render(
      <AdminAccountSettingsPage
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: 'sha256:latest-audit-anchor',
          operatorSessionCount: 2
        }}
        controlPlaneMode="http"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession()]}
        resourceGroupId="group-premium"
        onCopyControlPlaneBackup={onCopyControlPlaneBackup}
      />
    );

    expect(screen.getByRole('heading', { name: 'Control-plane Backup' })).toBeInTheDocument();
    expect(screen.getByText('sudo ou-ui restore-control-plane-backup --stdin')).toBeInTheDocument();
    expect(screen.getByText('sha256:latest-audit-anchor')).toBeInTheDocument();
    expect(screen.getByText('Sensitive tokens keep only state or prefixes; login passwords, Telegram tokens, and Agent token hashes are excluded.')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy Control-plane Backup Package' }));

    expect(onCopyControlPlaneBackup).toHaveBeenCalledTimes(1);
  });

  it('accepts a pasted control-plane backup package for restore preflight review', async () => {
    const user = userEvent.setup();
    const onPreflightControlPlaneBackup = vi.fn();

    render(
      <AdminAccountSettingsPage
        controlPlaneBackupPreflightResult={{
          status: 'warning',
          schemaLabel: 'Schema v1',
          inventoryResources: 18,
          runtimeArtifacts: 3,
          auditLogCount: 4,
          conflictCount: 2,
          conflictPreview: ['agent-hkg-01', 'forward-hkg-443'],
          redactionPassed: true,
          restoreCommand: 'sudo ou-ui restore-control-plane-backup --stdin',
          notes: ['resource_conflicts.require_confirmation']
        }}
        controlPlaneBackupSummary={{
          inventoryResources: 18,
          runtimeArtifacts: 3,
          failedTasks: 1,
          auditLogCount: 4,
          latestAuditHash: 'sha256:latest-audit-anchor',
          operatorSessionCount: 2
        }}
        controlPlaneMode="http"
        language="en"
        loginUsername="admin"
        operatorGroupId="owner"
        operatorSessions={[createSession()]}
        resourceGroupId="group-premium"
        onCopyControlPlaneBackup={vi.fn()}
        onPreflightControlPlaneBackup={onPreflightControlPlaneBackup}
      />
    );

    expect(screen.getByRole('button', { name: 'Run Restore Preflight' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Paste Control-plane Backup Package'), {
      target: { value: '{"kind":"ou-ui-next.control-plane.backup"}' }
    });
    await user.click(screen.getByRole('button', { name: 'Run Restore Preflight' }));

    expect(onPreflightControlPlaneBackup).toHaveBeenCalledWith('{"kind":"ou-ui-next.control-plane.backup"}');
    const result = screen.getByRole('region', { name: 'Restore Preflight Result' });
    expect(result).toBeInTheDocument();
    expect(within(result).getByText('Needs Manual Review')).toBeInTheDocument();
    expect(result.outerHTML).toContain('#FF3D18');
    expect(result.outerHTML).toContain('#D9FF00');
    expect(result.outerHTML).not.toContain('orange-');
    expect(result.outerHTML).not.toContain('amber-');
    expect(within(result).getByText('Sensitive Data Redacted')).toBeInTheDocument();
    expect(within(result).getByText('Dry-run only, no restore executed')).toBeInTheDocument();
    expect(within(result).getByText('agent-hkg-01')).toBeInTheDocument();
    expect(within(result).getByText('forward-hkg-443')).toBeInTheDocument();
  });
});
