import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { AuditLog } from '../../domain/audit';
import { AuditPage } from './audit-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const deniedAuditLog: AuditLog = {
  id: 'audit-denied-001',
  action: 'audit.denied',
  actor: 'operator:alice',
  scope: 'group:owner',
  resourceType: 'forward',
  operation: 'forward.apply',
  result: 'denied',
  targetId: 'forward-acme-game',
  targetLabel: 'Acme Game Forward',
  taskId: 'task-forward-denied-001',
  severity: 'critical',
  message: 'Forwarding apply denied by quota guard',
  createdAt: '2026-06-05T10:00:00.000Z',
  sourceIp: '203.0.113.55',
  userAgent: 'OU-UI/1.0',
  requestId: 'req-denied-001',
  requestBodyHash: 'sha256:request-body',
  denialCode: 'quota_exceeded',
  denialReason: 'Monthly quota exceeded for customer:u-acme',
  prevHash: 'sha256:prev-anchor',
  hash: 'sha256:current-anchor',
  before: {
    enabled: true,
    monthlyBytes: 21474836480
  },
  after: {
    enabled: false,
    disabledBy: 'quota_guard'
  }
};

const succeededAuditLog: AuditLog = {
  id: 'audit-succeeded-001',
  action: 'task.succeeded',
  actor: 'operator:bob',
  scope: 'group:ops',
  resourceType: 'subscription',
  operation: 'subscription.sync',
  result: 'succeeded',
  targetId: 'source-sg-backup',
  targetLabel: 'Backup Singapore Source',
  taskId: 'task-subscription-sync-001',
  severity: 'info',
  message: 'Subscription source synchronized',
  createdAt: '2026-06-05T11:00:00.000Z',
  sourceIp: '198.51.100.23',
  requestId: 'req-sync-001',
  prevHash: 'sha256:current-anchor',
  hash: 'sha256:sync-anchor'
};

describe('AuditPage', () => {
  it('frames audit evidence as a cockpit with a control rail and ledger workspace', () => {
    render(
      <AuditPage
        auditLogs={[deniedAuditLog, succeededAuditLog]}
        language="en"
        onVerifyAuditLogs={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Audit evidence cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Audit evidence control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Audit ledger workspace' });

    expect(within(rail).getByText('Evidence path')).toBeInTheDocument();
    expect(within(rail).getByRole('group', { name: 'Total audit records' })).toHaveTextContent('2');
    expect(within(rail).getByRole('group', { name: 'Visible audit records' })).toHaveTextContent('2');
    expect(within(rail).getByRole('searchbox', { name: 'Search Audit Logs' })).toBeInTheDocument();
    expect(within(rail).getByLabelText('Severity')).toBeInTheDocument();
    expect(within(rail).getByLabelText('Result')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Copy Visible Audit Evidence' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Verify Audit Chain' })).toBeInTheDocument();

    expect(within(workspace).getByRole('heading', { level: 4, name: 'Change Ledger' })).toBeInTheDocument();
    expect(within(workspace).getByText('Matching 2 / 2')).toBeInTheDocument();
    expect(within(workspace).getByText('Forwarding apply denied by quota guard')).toBeInTheDocument();
    expect(within(workspace).getByText('Subscription source synchronized')).toBeInTheDocument();
  });

  it('uses a v2 evidence cockpit visual system for the audit ledger', () => {
    render(
      <AuditPage
        auditLogs={[deniedAuditLog, succeededAuditLog]}
        language="en"
        onVerifyAuditLogs={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Audit evidence cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Audit evidence control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Audit ledger workspace' });
    const ledger = within(workspace).getByRole('group', { name: 'Change Ledger' });
    const deniedRow = within(ledger).getByRole('article', {
      name: 'Forwarding apply denied by quota guard'
    });

    expect(cockpit).toHaveClass('audit-evidence-cockpit');
    expect(rail).toHaveClass('audit-evidence-rail');
    expect(workspace).toHaveClass('audit-evidence-workspace');
    expect(ledger).toHaveClass('audit-evidence-ledger');
    expect(deniedRow).toHaveClass('audit-evidence-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('orange-');
    expect(within(rail).getByRole('group', { name: 'Critical audit records' }).outerHTML).toContain('orange-');
    expect(within(rail).getByRole('group', { name: 'Denied audit records' }).outerHTML).toContain('orange-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
  });

  it('filters audit logs and opens copyable evidence for a denied change', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<AuditPage auditLogs={[deniedAuditLog, succeededAuditLog]} language="en" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Audit Logs' }), 'quota guard');
    await user.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await user.selectOptions(screen.getByLabelText('Result'), 'denied');

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Forwarding apply denied by quota guard')).toBeInTheDocument();
    expect(screen.queryByText('Subscription source synchronized')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View Audit Evidence' }));
    const drawer = screen.getByRole('dialog', { name: 'Audit Evidence' });

    expect(within(drawer).getAllByText('req-denied-001').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('quota_exceeded')).toBeInTheDocument();
    expect(within(drawer).getByText(/sha256:current-anchor/)).toBeInTheDocument();
    expect(within(drawer).getByText(/disabledBy/)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: 'Copy Audit Evidence' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"id": "audit-denied-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"denialCode": "quota_exceeded"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"hash": "sha256:current-anchor"'));
  });

  it('filters audit logs before bulk copying the visible evidence set', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<AuditPage auditLogs={[deniedAuditLog, succeededAuditLog]} language="en" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Audit Logs' }), 'quota guard');
    await user.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await user.selectOptions(screen.getByLabelText('Result'), 'denied');

    await user.click(screen.getByRole('button', { name: 'Copy Visible Audit Evidence' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      auditLogCount: number;
      auditLogs: Array<{
        id: string;
        result: AuditLog['result'];
        denialCode?: string;
      }>;
    };

    expect(copiedPayload.auditLogCount).toBe(1);
    expect(copiedPayload.auditLogs).toEqual([
      expect.objectContaining({
        id: 'audit-denied-001',
        result: 'denied',
        denialCode: 'quota_exceeded'
      })
    ]);
    expect(writeText.mock.calls[0]?.[0]).not.toContain('audit-succeeded-001');
  });

  it('verifies the full audit chain while filters narrow the visible evidence set', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onVerifyAuditLogs = vi.fn().mockResolvedValue({
      valid: true,
      checked: 2
    });
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <AuditPage
        auditLogs={[deniedAuditLog, succeededAuditLog]}
        language="en"
        onVerifyAuditLogs={onVerifyAuditLogs}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Audit Logs' }), 'quota guard');
    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Matching 1 / 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify Audit Chain' }));

    expect(onVerifyAuditLogs).toHaveBeenCalledWith([deniedAuditLog, succeededAuditLog]);
    const status = await screen.findByRole('status', { name: 'Audit Chain Status' });
    expect(status).toHaveTextContent('Audit chain valid');
    expect(status).toHaveTextContent('Checked 2 records');

    await user.click(within(status).getByRole('button', { name: 'Copy Verification Result' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"auditLogCount": 2'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"valid": true'));
  });
});
