import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OperatorSessionSummary } from '../../domain';
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
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('orange-');
    expect(within(backupPanel).getByText('Failed Tasks').closest('div')?.outerHTML).toContain('orange-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
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
    expect(result.outerHTML).toContain('orange-');
    expect(within(result).getByText('Sensitive Data Redacted')).toBeInTheDocument();
    expect(within(result).getByText('Dry-run only, no restore executed')).toBeInTheDocument();
    expect(within(result).getByText('agent-hkg-01')).toBeInTheDocument();
    expect(within(result).getByText('forward-hkg-443')).toBeInTheDocument();
  });
});
