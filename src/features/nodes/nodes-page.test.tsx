import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agent } from '../../domain';
import { NodesPage } from './nodes-page';

const GB = 1024 ** 3;

function createAgent(): Agent {
  return {
    id: 'agent-metered-01',
    name: 'Metered Host',
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.30',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    maxTrafficBytes: 100 * GB,
    monthlyTrafficLimitBytes: 20 * GB,
    expiresAt: '2026-12-31T23:59:59.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 7,
      manualUsedTrafficBytes: 5 * GB,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
    telemetry: {
      cpuPercent: 10,
      cpuCores: 2,
      memoryPercent: 20,
      memoryUsedBytes: 2 * GB,
      memoryTotalBytes: 8 * GB,
      diskUsedBytes: 10 * GB,
      diskTotalBytes: 64 * GB,
      txBytes: 0,
      rxBytes: 0,
      monthlyIngressBytes: 1 * GB,
      monthlyEgressBytes: 2 * GB,
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

describe('NodesPage', () => {
  it('shows provisioning hosts with registration version, platform, and capabilities before telemetry arrives', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-provisioning-01',
            name: 'Provisioning Host',
            status: 'provisioning',
            version: '1.2.3-agent',
            platform: 'linux-x64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            runtimeHostName: 'edge-hkg-01',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 0,
              latencySamplesMs: [],
              onlineDays: 0,
              reportedAt: undefined
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('纳管中')).toBeInTheDocument();
    expect(screen.getByText('edge-hkg-01')).toBeInTheDocument();
    expect(screen.getByText('1.2.3-agent')).toBeInTheDocument();
    expect(screen.getByText('linux-x64')).toBeInTheDocument();
    expect(screen.getByText('host-agent')).toBeInTheDocument();
    expect(screen.getByText('xray')).toBeInTheDocument();
    expect(screen.getByText('port-forwarding')).toBeInTheDocument();
  });

  it('shows monthly host usage as manual backfill plus Agent metered traffic', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('8.0 GB / 20GB')).toBeInTheDocument();
  });

  it('surfaces telemetry sampling gaps on managed host cards', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30,
              sampleGapReason: 'stale_telemetry_sample'
            }
          }
        ]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('Gap 5.0min')).toBeInTheDocument();
  });

  it('only offers executable Xray inbound protocols for customer nodes', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    expect(screen.getByRole('option', { name: 'VLESS' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'VMess' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Trojan' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Shadowsocks' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Hysteria2' })).not.toBeInTheDocument();
  });

  it('locks the standalone customer node page without host tabs or install actions', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Customer Nodes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Customer Node' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Managed Hosts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customer Nodes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Install Command' })).not.toBeInTheDocument();
  });
});
