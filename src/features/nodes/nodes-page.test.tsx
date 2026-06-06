import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { Agent } from '../../domain';
import { NodesPage } from './nodes-page';

const GB = 1024 ** 3;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(screen.getAllByText('等待 Agent 遥测').length).toBeGreaterThan(0);
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

  it('surfaces Agent load average and runtime service health from telemetry', async () => {
    const user = userEvent.setup();
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            telemetry: {
              ...createAgent().telemetry,
              loadAverage1m: 0.42,
              loadAverage5m: 0.35,
              loadAverage15m: 0.31,
              runtimeServices: [
                {
                  name: 'ou-ui-agent.service',
                  moduleKind: 'agent',
                  status: 'active',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                },
                {
                  name: 'ou-ui-xray.service',
                  moduleKind: 'xray',
                  status: 'missing',
                  enabled: false,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                },
                {
                  name: 'ou-ui-forwarding.service',
                  moduleKind: 'port-forwarding',
                  status: 'active',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                }
              ],
              hostGuardrailStoppedUnits: ['ou-forward-forward-custom-2443-agent-edge-01-tcp.service'],
              hostGuardrailRestoredUnits: ['ou-forward-forward-custom-2443-agent-edge-01-udp.service']
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

    expect(screen.getByText('1 Issues / 3')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Xray')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();

    await user.click(screen.getByText('Metered Host'));

    expect(screen.getAllByText('0.42 / 0.35 / 0.31').length).toBeGreaterThan(0);
    expect(screen.getByText(/ou-ui-xray\.service: Missing/)).toBeInTheDocument();
    expect(screen.getByText('Guardrail Stopped')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-tcp.service')).toBeInTheDocument();
    expect(screen.getByText('Guardrail Restored')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-udp.service')).toBeInTheDocument();
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
    await user.click(screen.getByText('Advanced Config'));

    const protocolOptions = within(screen.getByLabelText('Xray Protocol'));

    expect(protocolOptions.getByRole('option', { name: 'VLESS' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'VMess' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'Trojan' })).toBeInTheDocument();
    expect(protocolOptions.getByRole('option', { name: 'Shadowsocks' })).toBeInTheDocument();
    expect(protocolOptions.queryByRole('option', { name: 'Hysteria2' })).not.toBeInTheDocument();
  });

  it('generates both single-node import and public subscription links for customer nodes', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    expect(screen.getByText('Single-node Share Link')).toBeInTheDocument();
    expect(screen.getByText('Subscription Link')).toBeInTheDocument();
    expect(screen.getByText(/vless:\/\//)).toBeInTheDocument();
    expect(
      screen.getByText((value) => value.includes('/sub/') && value.includes('/clash/'))
    ).toBeInTheDocument();
    expect(await screen.findByAltText('Subscription QR Code')).toBeInTheDocument();
  });

  it('opens customer node creation in a centered modal with protocol internals hidden by default', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });

    expect(dialog).toHaveClass('modal-panel', 'open');
    expect(dialog.parentElement).toHaveClass('overlay', 'open', 'items-center', 'justify-center');
    expect(screen.getByText('Generated Result')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reality Private Key')).not.toBeInTheDocument();

    await user.click(screen.getByText('Advanced Config'));

    expect(screen.getByLabelText('Reality Private Key')).toBeInTheDocument();
  });

  it('auto-generates Reality material when advanced security is switched to Reality', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.selectOptions(screen.getByLabelText('Protocol Template'), 'vless-tls-ws');
    await user.click(screen.getByText('Advanced Config'));

    expect(screen.queryByLabelText('Reality Private Key')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Security'), 'reality');

    const publicKeyInput = screen.getByLabelText('Reality Public Key') as HTMLInputElement;
    const privateKeyInput = screen.getByLabelText('Reality Private Key') as HTMLInputElement;
    const shortIdInput = screen.getByLabelText('Reality Short ID') as HTMLInputElement;

    expect(publicKeyInput.value).toMatch(/\S+/);
    expect(privateKeyInput.value).toMatch(/\S+/);
    expect(shortIdInput.value).toMatch(/^[a-f0-9]{8}$/);
    expect(
      screen.getByText((value) => value.includes('security=reality') && value.includes('pbk=') && value.includes('sid='))
    ).toBeInTheDocument();
  });

  it('uses secure random bytes for customer-node credential fallback without Math.random', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index + 1;
        }
        return bytes;
      }
    });
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for customer-node credentials');
    });

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

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.click(screen.getByText('Advanced Config'));

    expect(screen.getByLabelText('Client Identity')).toHaveValue('01020304-0506-4708-890a-0b0c0d0e0f10');
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
