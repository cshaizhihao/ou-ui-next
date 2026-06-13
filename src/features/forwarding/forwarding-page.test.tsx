import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agent } from '../../domain';
import { ForwardingPage, type ForwardingRuleView } from './forwarding-page';

const GB = 1024 ** 3;

function createAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.10',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'port-forwarding'],
    maxTrafficBytes: 100 * GB,
    monthlyTrafficLimitBytes: 50 * GB,
    expiresAt: '2026-12-31T23:59:59.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
    telemetry: {
      cpuPercent: 10,
      memoryPercent: 20,
      memoryUsedBytes: 2 * GB,
      memoryTotalBytes: 8 * GB,
      diskUsedBytes: 10 * GB,
      diskTotalBytes: 64 * GB,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 42,
      latencySamplesMs: [42],
      packetLossPercent: 0,
      packetLossSamplesPercent: [0],
      onlineDays: 1,
      reportedAt: '2026-06-04T04:00:00.000Z'
    }
  };
}

function createRule(overrides: Partial<ForwardingRuleView> = {}): ForwardingRuleView {
  const id = overrides.id ?? 'forward-hkg-443';
  const agentId = overrides.sourceAgentId ?? 'agent-hkg-01';

  return {
    id,
    name: 'HKG HTTPS Forward',
    ownerName: 'Acme',
    protocol: 'tcp+udp',
    tunnelId: 'tunnel-premium',
    tunnelName: 'Premium Tunnel',
    sourceAgentId: agentId,
    entryNodeIds: [agentId],
    sourceAddress: '198.51.100.10',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    targetAddress: '10.0.0.10',
    targetPort: 8443,
    enabled: true,
    portStatus: 'allocated',
    bindings: [
      {
        agentId,
        listenAddress: '0.0.0.0',
        listenPort: 443,
        targetAddress: '10.0.0.10',
        targetPort: 8443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: [`ou-forward-${id}-${agentId}.service`]
      }
    ],
    bindingCount: 1,
    quotaBytes: 100 * GB,
    usedBytes: 12 * GB,
    monthlyResetDay: 1,
    currentUsedTrafficGb: 0,
    rateLimitMbps: 80,
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
    ipRateLimitMbps: 0,
    billingDirection: 'both',
    pricePerGb: 0,
    tunnelMode: 'direct',
    strategy: 'round-robin',
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    ...overrides
  };
}

describe('ForwardingPage', () => {
  it('shows an operational overview for forwarding density and risk', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({
            id: 'forward-b',
            enabled: false,
            quotaExceeded: true,
            bindingCount: 2,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-hkg-01.service']
              },
              {
                agentId: 'agent-lax-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-lax-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('Operational Overview')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total rules' })).toHaveTextContent('2');
    expect(screen.getByRole('group', { name: 'Enabled rules' })).toHaveTextContent('1');
    expect(screen.getByRole('group', { name: 'Entry bindings' })).toHaveTextContent('3');
    expect(screen.getByRole('group', { name: 'Risk flags' })).toHaveTextContent('1');
  });

  it('creates forwarding metadata from the simple operator flow with advanced fields hidden by default', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));

    expect(screen.getByRole('dialog', { name: 'Create Forward Rule' })).toHaveClass('modal-panel', 'open');
    expect(screen.getByText('Selected 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rule Name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Listen Address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current Used Traffic')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Listen Port'), '2443');
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Customer 2443->172.20.8.10:9443',
        ownerName: 'Customer',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        entryNodeIds: ['agent-hkg-01', 'agent-lax-01'],
        quotaGb: 0,
        monthlyResetDay: 1,
        currentUsedTrafficGb: 0,
        rateLimitMbps: 0,
        rateLimitMode: 'bi-directional',
        rateLimitDirection: 'both',
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        billingDirection: 'both',
        tunnelMode: 'direct',
        enabled: true
      }),
      'create',
      undefined
    );
  });

  it('auto-allocates a high listen port and shows a copyable entry endpoint when the port is omitted', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onCreateForwarding = vi.fn();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText
      }
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule({ listenPort: 2443 })]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).toHaveBeenCalledTimes(1);
    const metadata = onCreateForwarding.mock.calls[0][0];

    expect(metadata.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(metadata.listenPort).toBeLessThanOrEqual(60_999);
    expect(metadata.listenPort).not.toBe(2443);

    const endpoint = `198.51.100.10:${metadata.listenPort}`;
    expect(screen.getByRole('status')).toHaveTextContent(endpoint);

    await user.click(screen.getByRole('button', { name: 'Copy Entry Endpoint' }));

    expect(writeText).toHaveBeenCalledWith(endpoint);
  });

  it('blocks duplicate entry bindings before submitting a new forwarding rule', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule({ name: 'Existing HTTPS Forward' })]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));
    await user.type(screen.getByLabelText('Listen Port'), '443');
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');

    const conflictAlert = screen.getByRole('alert');
    expect(within(conflictAlert).getByText(/Port conflict/)).toBeInTheDocument();
    expect(within(conflictAlert).getByText(/Existing HTTPS Forward/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).not.toHaveBeenCalled();
  });

  it('surfaces billing direction mix and one-way limiter direction from existing rule models', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule(),
          createRule({
            id: 'forward-lax-8443',
            name: 'LAX Egress Forward',
            sourceAgentId: 'agent-lax-01',
            entryNodeIds: ['agent-lax-01'],
            listenPort: 8443,
            rateLimitMbps: 40,
            rateLimitMode: 'one-way',
            rateLimitDirection: 'egress',
            billingDirection: 'egress'
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('Both 1 · Out 1')).toBeInTheDocument();
    expect(screen.getByText('Bi-directional / Both')).toBeInTheDocument();
    expect(screen.getByText('One-way / Egress')).toBeInTheDocument();
  });

  it('renders a scan-friendly runtime path for each forwarding rule', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[
          createRule({
            id: 'forward-runtime-path',
            name: 'HKG Runtime Path',
            listenAddress: '0.0.0.0',
            listenPort: 2443,
            targetAddress: '172.20.8.10',
            targetPort: 9443,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443,
                protocol: 'tcp+udp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-runtime-path-agent-hkg-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const runtimePath = screen.getByRole('group', { name: 'Runtime Path HKG Runtime Path' });

    expect(within(runtimePath).getByText('Entry')).toBeInTheDocument();
    expect(within(runtimePath).getByText('HKG Entry')).toBeInTheDocument();
    expect(within(runtimePath).getByText('0.0.0.0:2443')).toBeInTheDocument();
    expect(within(runtimePath).getByText('Target')).toBeInTheDocument();
    expect(within(runtimePath).getByText('172.20.8.10:9443')).toBeInTheDocument();
    expect(within(runtimePath).getByText('Runtime Service')).toBeInTheDocument();
    expect(within(runtimePath).getByText('ou-forward-forward-runtime-path-agent-hkg-01.service')).toBeInTheDocument();
  });

  it('filters forwarding rules before selecting visible rows for bulk pause actions', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });
    const pausedAcmeRule = createRule({
      id: 'forward-acme-paused',
      name: 'Acme Paused Forward',
      ownerName: 'Acme',
      enabled: false,
      portStatus: 'paused',
      listenPort: 2445,
      targetAddress: '10.0.0.22',
      targetPort: 2445
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule, backupRule, pausedAcmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={onRunTask}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.selectOptions(screen.getByLabelText('Rule Status'), 'allocated');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));

    expect(screen.getByText('Acme Game Forward')).toBeInTheDocument();
    expect(screen.queryByText('Backup Game Forward')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Paused Forward')).not.toBeInTheDocument();
    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bulk Pause' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pause 1 selected forwarding rule'));
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith('forward-acme-game', 'pause');
    expect(screen.getByRole('checkbox', { name: 'Select Acme Game Forward' })).toBeChecked();
  });

  it('shows a bulk impact preflight for selected forwarding rules before risky actions', async () => {
    const user = userEvent.setup();
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      usedBytes: 88 * GB,
      quotaBytes: 100 * GB,
      quotaExceeded: true,
      guardrailReason: 'forward_rule_quota_exceeded'
    });
    const backupRule = createRule({
      id: 'forward-backup-paused',
      name: 'Backup Paused Forward',
      ownerName: 'Backup',
      sourceAgentId: 'agent-lax-01',
      entryNodeIds: ['agent-lax-01'],
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444,
      enabled: false,
      portStatus: 'paused',
      usedBytes: 12 * GB,
      quotaBytes: 50 * GB,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'forward_rule_disabled_by_policy',
      bindings: [
        {
          agentId: 'agent-lax-01',
          listenAddress: '0.0.0.0',
          listenPort: 2444,
          targetAddress: '10.0.0.21',
          targetPort: 2444,
          protocol: 'tcp+udp',
          status: 'paused'
        }
      ]
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Acme Game Forward' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Backup Paused Forward' }));

    const preflight = screen.getByRole('region', { name: 'Forwarding Bulk Impact Preflight' });
    expect(within(preflight).getByText('Affected Customers 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Entry Hosts 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Port Bindings 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Guardrail Risks 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Paused/Disabled 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Used Traffic 100.0 GB')).toBeInTheDocument();

    const customerPreview = within(preflight).getByText('Customer Preview').closest('div');
    const bindingPreview = within(preflight).getByText('Binding Preview').closest('div');
    const riskPreview = within(preflight).getByText('Risk Notes').closest('div');
    expect(customerPreview).not.toBeNull();
    expect(bindingPreview).not.toBeNull();
    expect(riskPreview).not.toBeNull();
    expect(within(customerPreview as HTMLElement).getByText('Acme')).toBeInTheDocument();
    expect(within(customerPreview as HTMLElement).getByText('Backup')).toBeInTheDocument();
    expect(within(bindingPreview as HTMLElement).getByText(/HKG Entry/)).toBeInTheDocument();
    expect(within(bindingPreview as HTMLElement).getByText(/LAX Entry/)).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/forward_rule_quota_exceeded/)).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/forward_rule_disabled_by_policy/)).toBeInTheDocument();
  });

  it('migrates selected filtered forwarding rules to a replacement entry host', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.selectOptions(screen.getByLabelText('Bulk Migrate Entry Host'), 'agent-lax-01');
    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Migrate 1 selected forwarding rule to LAX Entry'));
    expect(onCreateForwarding).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(onCreateForwarding).toHaveBeenCalledTimes(1);
    expect(onCreateForwarding).toHaveBeenCalledWith(
      expect.objectContaining({
        name: acmeRule.name,
        ownerName: acmeRule.ownerName,
        listenPort: acmeRule.listenPort,
        targetAddress: acmeRule.targetAddress,
        targetPort: acmeRule.targetPort,
        entryNodeIds: ['agent-lax-01']
      }),
      'update',
      acmeRule.id
    );
    expect(onCreateForwarding).not.toHaveBeenCalledWith(
      expect.anything(),
      'update',
      backupRule.id
    );
  });

  it('blocks bulk entry migration when the replacement host already owns the binding', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      bindings: [
        {
          agentId: 'agent-hkg-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.20',
          targetPort: 2443,
          protocol: 'tcp+udp',
          status: 'allocated'
        }
      ]
    });
    const existingLaxRule = createRule({
      id: 'forward-existing-lax',
      name: 'Existing LAX Forward',
      ownerName: 'Ops',
      sourceAgentId: 'agent-lax-01',
      entryNodeIds: ['agent-lax-01'],
      listenPort: 2443,
      targetAddress: '10.0.0.99',
      targetPort: 9443,
      bindings: [
        {
          agentId: 'agent-lax-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.99',
          targetPort: 9443,
          protocol: 'tcp+udp',
          status: 'allocated'
        }
      ]
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, existingLaxRule]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.selectOptions(screen.getByLabelText('Bulk Migrate Entry Host'), 'agent-lax-01');

    const conflictAlert = screen.getByRole('alert');
    expect(within(conflictAlert).getByText(/Port conflict/)).toBeInTheDocument();
    expect(within(conflictAlert).getByText(/Existing LAX Forward/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk Migrate Entry' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onCreateForwarding).not.toHaveBeenCalled();
  });

  it('confirms row runtime and delete actions before changing a forwarding rule', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const onDeleteForwarding = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={onDeleteForwarding}
        onRunTask={onRunTask}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Delete Rule' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Deploy Acme Game Forward'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pause Acme Game Forward'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete Rule Acme Game Forward'));
    expect(onRunTask).not.toHaveBeenCalled();
    expect(onDeleteForwarding).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await user.click(screen.getByRole('button', { name: 'Delete Rule' }));

    expect(onRunTask).toHaveBeenCalledWith('forward-acme-game', 'apply');
    expect(onDeleteForwarding).toHaveBeenCalledWith(acmeRule);
  });

  it('requires confirmation before bulk deleting selected filtered forwarding rules', async () => {
    const user = userEvent.setup();
    const onDeleteForwarding = vi.fn();
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={onDeleteForwarding}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Delete' }));

    expect(onDeleteForwarding).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Delete 1 Rules' }));

    expect(onDeleteForwarding).toHaveBeenCalledTimes(1);
    expect(onDeleteForwarding).toHaveBeenCalledWith(acmeRule);
    expect(onDeleteForwarding).not.toHaveBeenCalledWith(backupRule);
    expect(screen.queryByText('Acme Game Forward')).not.toBeInTheDocument();
    expect(screen.getByText('No matching forwarding rules')).toBeInTheDocument();
  });
});
