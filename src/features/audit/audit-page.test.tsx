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
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#1E3AFF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#FF3D18');
    expect(within(rail).getByRole('group', { name: 'Critical audit records' }).outerHTML).toContain('#FF3D18');
    expect(within(rail).getByRole('group', { name: 'Denied audit records' }).outerHTML).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
  });

  it('keeps the audit evidence cockpit compact and rejects masonry-style layout', () => {
    render(
      <AuditPage
        auditLogs={[deniedAuditLog, succeededAuditLog]}
        language="en"
        onVerifyAuditLogs={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Audit evidence cockpit' });
    const cockpitGrid = cockpit.firstElementChild as HTMLElement;
    const rail = within(cockpit).getByRole('complementary', { name: 'Audit evidence control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Audit ledger workspace' });
    const workspaceStack = workspace.firstElementChild as HTMLElement;
    const ledger = within(workspace).getByRole('group', { name: 'Change Ledger' });
    const deniedRow = within(ledger).getByRole('article', {
      name: 'Forwarding apply denied by quota guard'
    });
    const gates = within(rail).getByRole('region', { name: 'Audit Evidence Gates' });
    const gateRow = within(gates).getByRole('group', { name: 'Hash Chain' });
    const totalCard = within(rail).getByRole('group', { name: 'Total audit records' });
    const layoutHtml = `${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`;

    expect(cockpitGrid).toHaveClass('audit-evidence-cockpit-grid');
    expect(cockpitGrid).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(rail).toHaveClass('p-3');
    expect(rail).not.toHaveClass('p-4');
    expect(workspaceStack).toHaveClass('space-y-3');
    expect(workspaceStack).toHaveClass('p-3');
    expect(ledger).toHaveClass('p-3');
    expect(ledger).not.toHaveClass('p-5');
    expect(deniedRow).toHaveClass('p-3');
    expect(deniedRow).not.toHaveClass('rounded-xl');
    expect(gateRow).toHaveClass('audit-evidence-gate-row');
    expect(gateRow).toHaveClass('min-h-[76px]');
    expect(gateRow).toHaveClass('px-3');
    expect(gateRow).toHaveClass('py-2.5');
    expect(gateRow).not.toHaveClass('min-h-20');
    expect(gateRow).not.toHaveClass('px-4');
    expect(gateRow).not.toHaveClass('py-3');
    expect(totalCard).toHaveClass('audit-summary-card');
    expect(totalCard).toHaveClass('min-h-[76px]');
    expect(totalCard).toHaveClass('p-3');
    expect(totalCard).not.toHaveClass('rounded-xl');
    expect(layoutHtml).not.toContain('masonry');
    expect(layoutHtml).not.toContain('columns-');
    expect(layoutHtml).not.toContain('grid-flow-row-dense');
    expect(layoutHtml).not.toContain('row-span');
    expect(layoutHtml).not.toContain('col-span');
  });

  it('surfaces audit evidence gates on the control rail', () => {
    const rollbackAuditLog: AuditLog = {
      ...succeededAuditLog,
      id: 'audit-rollback-001',
      action: 'task.rolled_back',
      operation: 'agent.rollback',
      result: 'succeeded',
      targetId: 'forward-acme-game',
      targetLabel: 'Acme Game Forward',
      taskId: 'task-forward-rollback-001',
      message: 'Forwarding runtime rolled back',
      prevHash: 'sha256:sync-anchor',
      hash: 'sha256:rollback-anchor'
    };

    render(
      <AuditPage
        auditLogs={[deniedAuditLog, succeededAuditLog, rollbackAuditLog]}
        language="en"
        onVerifyAuditLogs={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Audit evidence cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Audit evidence control rail' });
    const gates = within(rail).getByRole('region', { name: 'Audit Evidence Gates' });

    expect(gates).toHaveClass('audit-evidence-gate-panel');
    expect(gates.outerHTML).toContain('#1E3AFF');
    expect(gates.outerHTML).toContain('#FF3D18');
    expect(gates.outerHTML).toContain('#D9FF00');
    expect(gates.outerHTML).toContain('#00A878');
    expect(within(gates).getByRole('group', { name: 'Hash Chain' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'Denied Events' })).toHaveTextContent('Issues');
    expect(within(gates).getByRole('group', { name: 'Rollback Trace' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'Evidence Export' })).toHaveTextContent('Ready');
  });

  it('renders the operational overview as a restrained evidence panel', () => {
    const { container } = render(<AuditPage auditLogs={[deniedAuditLog, succeededAuditLog]} language="en" />);

    const overview = screen.getByRole('region', { name: 'Operational Overview' });

    expect(overview).toHaveClass('audit-operational-overview');
    expect(overview).toHaveClass('p-3');
    expect(overview).toHaveClass('md:p-3');
    expect(overview).not.toHaveClass('rounded-xl');
    expect(overview).not.toHaveClass('rounded-[1.5rem]');
    expect(overview).not.toHaveClass('p-5');
    expect(overview).not.toHaveClass('p-4');
    expect(overview.outerHTML).toContain('audit-operational-overview-strip');
    expect(overview.outerHTML).not.toContain('columns-');
    expect(overview.outerHTML).not.toContain('masonry');
    expect(overview.outerHTML).not.toContain('grid-flow-row-dense');
    expect(overview.outerHTML).toContain('#1E3AFF');
    expect(overview.outerHTML).toContain('#FF3D18');
    expect(overview).not.toHaveClass('backdrop-blur-2xl');
    expect(container.querySelector('[aria-label="Operational Overview"]')).toBe(overview);
  });

  it('keeps empty audit ledger states compact instead of oversized blank cards', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<AuditPage auditLogs={[]} language="en" />);

    const emptyWorkspace = screen.getByRole('region', { name: 'Audit ledger workspace' });
    const emptyLedger = within(emptyWorkspace).getByRole('group', { name: 'Change Ledger' });
    const emptyState = within(emptyLedger).getByText('No audit events yet').closest('.audit-ledger-empty-state');

    expect(emptyState).toHaveClass('p-3');
    expect(emptyState).not.toHaveClass('p-8', 'p-6', 'p-5', 'rounded-xl');

    unmount();

    render(<AuditPage auditLogs={[deniedAuditLog, succeededAuditLog]} language="en" />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Audit Logs' }), 'missing audit evidence');

    const filteredWorkspace = screen.getByRole('region', { name: 'Audit ledger workspace' });
    const filteredLedger = within(filteredWorkspace).getByRole('group', { name: 'Change Ledger' });
    const filteredEmptyState = within(filteredLedger)
      .getByText('No matching audit records')
      .closest('.audit-ledger-filter-empty-state');

    expect(filteredEmptyState).toHaveClass('p-3');
    expect(filteredEmptyState).not.toHaveClass('p-8', 'p-6', 'p-5', 'rounded-xl');
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

  it('keeps long audit drawer evidence readable in the fauvist evidence system', async () => {
    const user = userEvent.setup();
    const longHash =
      'sha256:9c42f0de1c6b4b2d9ff001e3affff3d1800a87807111f35405a' +
      '9c42f0de1c6b4b2d9ff001e3affff3d1800a87807111f35405a';
    const longRequestId =
      'req-production-rollout-us-east-1-universal-agent-super-long-idempotency-key-2026-06-14-' +
      'tenant-ou-acme-forwarding-rollback-trace-artifact-checksum-anchor';
    const longAuditLog: AuditLog = {
      ...deniedAuditLog,
      id: `audit-${longHash}`,
      targetId:
        'forward-acme-game-prod-us-east-1-tcp-443-customer-node-primary-super-long-target-identifier',
      targetLabel: 'Acme Game Forward Production Primary TCP 443',
      taskId:
        'task-runtime-rollback-forward-acme-game-prod-us-east-1-2026-06-14-checksum-artifact-evidence',
      requestId: longRequestId,
      requestBodyHash: longHash,
      denialReason:
        'Operator request denied because the proposed forwarding runtime exceeds the production quota boundary and requires rollback evidence review before release.',
      prevHash: `${longHash}-previous-ledger-anchor`,
      hash: `${longHash}-current-ledger-anchor`,
      before: {
        artifact:
          '/var/lib/ou-ui-next/evidence/forwarding/runtime/releases/2026-06-14/acme-game-prod-primary-before.json',
        checksum: `${longHash}-before-artifact-checksum`,
        rollbackPlan:
          'restore-forwarding-runtime-from-prior-agent-snapshot-and-preserve-customer-subscription-identity'
      },
      after: {
        artifact:
          '/var/lib/ou-ui-next/evidence/forwarding/runtime/releases/2026-06-14/acme-game-prod-primary-after.json',
        checksum: `${longHash}-after-artifact-checksum`,
        reviewerNote:
          'rollback evidence remains attached to the audit drawer so operators can inspect the full artifact path and checksum without truncation'
      }
    };

    render(<AuditPage auditLogs={[longAuditLog]} language="en" />);

    await user.click(screen.getByRole('button', { name: 'View Audit Evidence' }));
    const drawer = screen.getByRole('dialog', { name: 'Audit Evidence' });
    const drawerHtml = drawer.outerHTML;

    within(drawer)
      .getAllByText(longRequestId)
      .forEach((requestId) => expect(requestId).toHaveClass('break-all'));
    expect(within(drawer).getByText(/Operator request denied because/)).toHaveClass('break-words');
    expect(drawer.querySelectorAll('.audit-evidence-json-value')).toHaveLength(2);
    drawer
      .querySelectorAll('.audit-evidence-json-value')
      .forEach((jsonBlock) => expect(jsonBlock).toHaveClass('break-words'));
    expect(drawer.querySelector('.audit-evidence-summary-card')).toBeInTheDocument();
    expect(drawer.querySelector('.audit-evidence-context-card')).toBeInTheDocument();
    expect(drawer.querySelector('.audit-evidence-request-card')).toBeInTheDocument();
    expect(drawer.querySelector('.audit-evidence-denial-card')).toBeInTheDocument();
    expect(drawer.querySelector('.audit-evidence-integrity-card')).toBeInTheDocument();
    expect(drawer.querySelectorAll('.audit-evidence-json-card')).toHaveLength(2);
    expect(drawer.querySelector('.audit-evidence-field')).toBeInTheDocument();
    expect(drawer.querySelector('.audit-evidence-drawer-stack')).toHaveClass('space-y-3');
    for (const selector of [
      '.audit-evidence-summary-card',
      '.audit-evidence-context-card',
      '.audit-evidence-request-card',
      '.audit-evidence-denial-card',
      '.audit-evidence-integrity-card',
      '.audit-evidence-json-card'
    ]) {
      drawer
        .querySelectorAll(selector)
        .forEach((evidenceCard) => expect(evidenceCard).toHaveClass('p-3'));
      drawer
        .querySelectorAll(selector)
        .forEach((evidenceCard) => expect(evidenceCard).not.toHaveClass('p-4', 'p-5', 'rounded-xl'));
    }
    expect(drawerHtml).toContain('#1E3AFF');
    expect(drawerHtml).toContain('#FF3D18');
    expect(drawerHtml).toContain('#D9FF00');
    expect(drawerHtml).toContain('#00A878');
    expect(drawerHtml).not.toContain('masonry');
    expect(drawerHtml).not.toContain('columns-');
    expect(drawerHtml).not.toContain('grid-flow-row-dense');
    expect(drawerHtml).not.toContain('truncate');
    expect(drawerHtml).not.toContain('blue-');
    expect(drawerHtml).not.toContain('orange-');
    expect(drawerHtml).not.toContain('amber-');
    expect(drawerHtml).not.toContain('purple-');
    expect(drawerHtml).not.toContain('sky-');
    expect(drawerHtml).not.toContain('indigo-');
    expect(drawerHtml).not.toContain('cyan-');
    expect(drawerHtml).not.toContain('rose-');
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
