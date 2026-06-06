import { render, screen } from '@testing-library/react';
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
});
