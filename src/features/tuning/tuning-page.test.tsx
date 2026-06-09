import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agent, TuningProfile } from '../../domain';
import { TuningPage } from './tuning-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseAgent: Agent = {
  id: 'agent-hkg-01',
  name: 'Hong Kong Agent',
  status: 'online',
  region: 'ap-east-1',
  publicAddress: '198.51.100.10',
  connectionMode: 'websocket',
  version: '1.0.0',
  platform: 'linux/amd64',
  capabilities: ['xray', 'port-forwarding'],
  maxTrafficBytes: 8 * 1024 ** 4,
  monthlyTrafficLimitBytes: 800 * 1024 ** 3,
  expiresAt: '2026-09-08T23:59:59.000Z',
  probeConfig: {
    pingTarget: '1.1.1.1',
    pingIntervalSeconds: 30,
    latencyGreenMaxMs: 100,
    latencyYellowMaxMs: 200
  },
  trafficPolicy: {
    accountingMode: 'both',
    monthlyResetDay: 1,
    manualUsedTrafficBytes: 320 * 1024 ** 3,
    telemetrySource: 'agent'
  },
  hardware: {
    cpuModel: 'AMD EPYC',
    kernelVersion: '6.8.0',
    virtualization: 'KVM',
    primaryNetworkInterface: 'eth0',
    detectedAt: '2026-06-02T00:00:00.000Z'
  },
  lastHeartbeatAt: '2026-06-02T00:00:00.000Z',
  telemetry: {
    cpuPercent: 18,
    memoryPercent: 42,
    memoryUsedBytes: 1720 * 1024 ** 2,
    memoryTotalBytes: 4096 * 1024 ** 2,
    diskUsedBytes: 49 * 1024 ** 3,
    diskTotalBytes: 128 * 1024 ** 3,
    txBytes: 1529000000000,
    rxBytes: 4135000000000,
    uploadSpeedBps: 20_190,
    downloadSpeedBps: 24_530,
    uploadTotalBytes: 5.91 * 1024 ** 3,
    downloadTotalBytes: 6.2 * 1024 ** 3,
    monthlyTrafficUsedBytes: 382 * 1024 ** 3,
    latencyMs: 42,
    latencySamplesMs: [42, 45],
    packetLossPercent: 0.2,
    packetLossSamplesPercent: [0, 0.2],
    onlineDays: 15
  }
};

const agents: Agent[] = [
  baseAgent,
  {
    ...baseAgent,
    id: 'agent-sin-02',
    name: 'Singapore Agent',
    publicAddress: '203.0.113.20'
  }
];

const profiles: TuningProfile[] = [
  {
    id: 'tune-bbr-edge',
    name: 'BBR Edge Throughput',
    enabled: true,
    target: 'kernel',
    riskLevel: 'medium',
    parameters: [
      { key: 'net.ipv4.tcp_congestion_control', value: 'bbr', status: 'backend_required' },
      { key: 'net.core.default_qdisc', value: 'fq', status: 'backend_required' }
    ]
  },
  {
    id: 'tune-runtime-safe-reload',
    name: 'Runtime Safe Reload',
    enabled: true,
    target: 'runtime',
    riskLevel: 'low',
    parameters: [{ key: 'xray.reload.strategy', value: 'graceful', status: 'pending' }]
  },
  {
    id: 'tune-syn-flood-guard',
    name: 'SYN Flood Guard',
    enabled: false,
    target: 'network',
    riskLevel: 'high',
    parameters: [
      { key: 'net.ipv4.tcp_max_syn_backlog', value: '65535', status: 'backend_required' },
      { key: 'net.ipv4.tcp_syncookies', value: '1', status: 'applied' }
    ]
  }
];

describe('TuningPage', () => {
  it('filters tuning profiles by query target and risk before dispatching to the selected Agent', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<TuningPage agents={agents} language="en" profiles={profiles} onRunTask={onRunTask} />);

    expect(screen.getByRole('heading', { name: 'System Tuning' })).toBeInTheDocument();
    expect(screen.getByText('Matching 3 / 3')).toBeInTheDocument();
    expect(screen.getByText('Enabled Profiles')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.type(screen.getByRole('searchbox', { name: 'Search Profiles' }), 'syn');
    await user.selectOptions(screen.getByLabelText('Target'), 'network');
    await user.selectOptions(screen.getByLabelText('Risk'), 'high');

    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('SYN Flood Guard')).toBeInTheDocument();
    expect(screen.getByText('net.ipv4.tcp_syncookies')).toBeInTheDocument();
    expect(screen.queryByText('BBR Edge Throughput')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dispatch to Agent' }));

    expect(onRunTask).toHaveBeenCalledWith('tune-syn-flood-guard', 'agent-sin-02');
  });

  it('shows an empty filtered state and disables dispatch when no tuning profile matches', async () => {
    const user = userEvent.setup();

    render(<TuningPage agents={agents} language="en" profiles={profiles} onRunTask={vi.fn()} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Profiles' }), 'wireguard');

    expect(screen.getByText('Matching 0 / 3')).toBeInTheDocument();
    expect(screen.getByText('No matching tuning profiles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispatch to Agent' })).not.toBeInTheDocument();
  });

  it('bulk dispatches only the filtered visible tuning profiles to the selected Agent', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    render(<TuningPage agents={agents} language="en" profiles={profiles} onRunTask={onRunTask} />);

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.selectOptions(screen.getByLabelText('Target'), 'network');
    await user.selectOptions(screen.getByLabelText('Risk'), 'high');

    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('SYN Flood Guard')).toBeInTheDocument();
    expect(screen.queryByText('BBR Edge Throughput')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dispatch Visible Profiles' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 visible tuning profile'));
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith('tune-syn-flood-guard', 'agent-sin-02');
    expect(onRunTask).not.toHaveBeenCalledWith('tune-bbr-edge', 'agent-sin-02');
  });

  it('dispatches only selected tuning profiles to the selected Agent', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    render(<TuningPage agents={agents} language="en" profiles={profiles} onRunTask={onRunTask} />);

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.click(screen.getByRole('checkbox', { name: 'Select BBR Edge Throughput' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch Selected Profiles' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 selected tuning profile'));
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith('tune-bbr-edge', 'agent-sin-02');
    expect(onRunTask).not.toHaveBeenCalledWith('tune-runtime-safe-reload', 'agent-sin-02');
    expect(onRunTask).not.toHaveBeenCalledWith('tune-syn-flood-guard', 'agent-sin-02');
  });

  it('copies a selected tuning dispatch plan for parameter review', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<TuningPage agents={agents} language="en" profiles={profiles} onRunTask={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.type(screen.getByRole('searchbox', { name: 'Search Profiles' }), 'syn');
    await user.click(screen.getByRole('checkbox', { name: 'Select SYN Flood Guard' }));
    await user.click(screen.getByRole('button', { name: 'Copy Selected Dispatch Plan' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPlan = writeText.mock.calls[0]?.[0] as string;
    expect(copiedPlan).toContain('Tuning Dispatch Plan');
    expect(copiedPlan).toContain('Target Agent: Singapore Agent / 203.0.113.20');
    expect(copiedPlan).toContain('Profile Count: 1');
    expect(copiedPlan).toContain('High Risk Profiles: 1');
    expect(copiedPlan).toContain('SYN Flood Guard');
    expect(copiedPlan).toContain('Target: network');
    expect(copiedPlan).toContain('Risk: high');
    expect(copiedPlan).toContain('net.ipv4.tcp_max_syn_backlog=65535');
    expect(copiedPlan).not.toContain('BBR Edge Throughput');
  });
});
