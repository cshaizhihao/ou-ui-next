import { render, screen } from '@testing-library/react';
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
  it('surfaces account identity, server credential commands, and operator session revocation', async () => {
    const user = userEvent.setup();
    const onRevokeOperatorSession = vi.fn();

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

    expect(onRevokeOperatorSession).toHaveBeenCalledWith('operator-session-remote');
  });
});
