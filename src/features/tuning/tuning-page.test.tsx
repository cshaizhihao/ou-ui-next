import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agent, TuningProfile } from '../../domain';
import type { DeployTask } from '../../domain/task';
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
    id: 'tune-runtime-reload',
    name: 'TCP Buffer and Backlog',
    enabled: true,
    target: 'network',
    riskLevel: 'medium',
    parameters: [
      { key: 'net.ipv4.tcp_rmem', value: '4096 87380 67108864', status: 'backend_required' },
      { key: 'net.ipv4.tcp_wmem', value: '4096 65536 67108864', status: 'backend_required' },
      { key: 'net.core.somaxconn', value: '65535', status: 'backend_required' },
      { key: 'net.ipv4.tcp_max_syn_backlog', value: '65535', status: 'backend_required' }
    ]
  }
];

function createTask(overrides: Partial<DeployTask>): DeployTask {
  return {
    id: 'task-tune-1',
    operation: 'system.tune',
    resourceType: 'agent',
    resourceId: 'agent-hkg-01',
    status: 'queued',
    targetId: 'agent-hkg-01',
    targetLabel: 'BBR Edge Throughput / agent-hkg-01',
    summary: 'Dispatch system tuning change',
    createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    actor: 'ops@example.com',
    requestedBy: 'ops@example.com',
    requestId: 'req-tune-1',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 1,
    steps: [
      { id: 'preflight', label: 'Read current sysctl values', status: 'succeeded' },
      { id: 'apply', label: 'Apply sysctl values', status: 'running' }
    ],
    ...overrides
  };
}

describe('TuningPage', () => {
  it('splits system tuning into a cockpit rail and execution workspace', () => {
    const recentTask = createTask({
      id: 'task-tune-running',
      status: 'running',
      updatedAt: '2026-06-02T10:20:00.000Z',
      targetLabel: 'TCP Buffer and Backlog / agent-hkg-01'
    });

    render(
      <TuningPage
        agents={agents}
        language="en"
        profiles={profiles}
        tasks={[recentTask]}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Tuning control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Tuning execution workspace' });

    expect(within(rail).getByLabelText('Target Host')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Apply BBR' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Apply TCP Tuning' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: 'Execution Status' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: 'Custom sysctl' })).toBeInTheDocument();
    expect(within(workspace).getByText('TCP Buffer and Backlog / agent-hkg-01')).toBeInTheDocument();
  });

  it('frames system tuning as an operational control surface', () => {
    const failedTask = createTask({
      id: 'task-tune-failed',
      status: 'failed',
      updatedAt: '2026-06-02T10:10:00.000Z',
      targetLabel: 'Custom sysctl / agent-hkg-01',
      failureReason: 'sysctl net.ipv4.tcp_fin_timeout is not allowlisted'
    });

    render(
      <TuningPage
        agents={agents}
        language="en"
        profiles={profiles}
        tasks={[failedTask]}
        onRunTask={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Tuning path')).toBeInTheDocument();
    expect(within(overview).getByText('Profile')).toBeInTheDocument();
    expect(within(overview).getByText('Agent')).toBeInTheDocument();
    expect(within(overview).getByText('Audit Task')).toBeInTheDocument();
    expect(within(overview).getByText('Risk Profiles')).toBeInTheDocument();
    expect(within(overview).getByText('0 High / 2')).toBeInTheDocument();
    expect(within(overview).getByText('Parameters')).toBeInTheDocument();
    expect(within(overview).getByText('6')).toBeInTheDocument();
    expect(within(overview).getByText('Latest Execution')).toBeInTheDocument();
    expect(within(overview).getByText('Failed')).toBeInTheDocument();
  });

  it('uses a v2 tuning cockpit visual system for control and execution panels', async () => {
    const user = userEvent.setup();

    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    await user.type(screen.getByLabelText('Custom sysctl key'), 'net.ipv4.tcp_fin_timeout');
    await user.type(screen.getByLabelText('Custom sysctl value'), '15');
    await user.click(screen.getByRole('button', { name: 'Add sysctl' }));

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Tuning control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Tuning execution workspace' });
    const bbrPanel = within(rail).getByRole('group', { name: 'BBR Configuration' });
    const tcpPanel = within(rail).getByRole('group', { name: 'TCP Tuning' });
    const customPanel = within(workspace).getByRole('region', { name: 'Custom sysctl' });
    const statusPanel = within(workspace).getByRole('region', { name: 'Execution Status' });
    const customRow = within(customPanel).getByRole('article', { name: 'net.ipv4.tcp_fin_timeout' });

    expect(cockpit).toHaveClass('tuning-ops-cockpit');
    expect(rail).toHaveClass('tuning-ops-rail');
    expect(workspace).toHaveClass('tuning-ops-workspace');
    expect(bbrPanel).toHaveClass('tuning-ops-tool-panel');
    expect(tcpPanel).toHaveClass('tuning-ops-tool-panel');
    expect(customPanel).toHaveClass('tuning-ops-custom-panel');
    expect(statusPanel).toHaveClass('tuning-ops-status-panel');
    expect(customRow).toHaveClass('tuning-ops-sysctl-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
  });

  it('renders practical BBR TCP and custom sysctl controls without template search clutter', () => {
    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'System Tuning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply BBR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply TCP Tuning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sysctl' })).toBeDisabled();
    expect(screen.getByLabelText('TCP receive buffer')).toHaveValue('4096 87380 67108864');
    expect(screen.getByLabelText('TCP write buffer')).toHaveValue('4096 65536 67108864');
    expect(screen.getByText('No tuning execution yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search Profiles' })).not.toBeInTheDocument();
  });

  it('dispatches edited TCP buffers to the selected Agent', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={onRunTask} />);

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.clear(screen.getByLabelText('TCP receive buffer'));
    await user.type(screen.getByLabelText('TCP receive buffer'), '4096 131072 134217728');
    await user.click(screen.getByRole('button', { name: 'Apply TCP Tuning' }));

    expect(onRunTask).toHaveBeenCalledWith(
      'tune-runtime-reload',
      'agent-sin-02',
      expect.objectContaining({
        id: 'tune-runtime-reload',
        name: 'TCP Buffer and Backlog',
        target: 'network',
        parameters: expect.arrayContaining([
          expect.objectContaining({ key: 'net.ipv4.tcp_rmem', value: '4096 131072 134217728' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_wmem', value: '4096 65536 67108864' }),
          expect.objectContaining({ key: 'net.core.somaxconn', value: '65535' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_max_syn_backlog', value: '65535' })
        ])
      })
    );
  });

  it('builds and dispatches a custom sysctl plan', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={onRunTask} />);

    await user.type(screen.getByLabelText('Custom sysctl key'), 'net.ipv4.tcp_fin_timeout');
    await user.type(screen.getByLabelText('Custom sysctl value'), '15');
    await user.click(screen.getByRole('button', { name: 'Add sysctl' }));

    const customPanel = screen.getByRole('region', { name: 'Custom sysctl' });
    expect(within(customPanel).getByText('net.ipv4.tcp_fin_timeout')).toBeInTheDocument();
    expect(within(customPanel).getByText('15')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply Custom sysctl' }));

    expect(onRunTask).toHaveBeenCalledWith(
      'custom-sysctl',
      'agent-hkg-01',
      expect.objectContaining({
        id: 'custom-sysctl',
        name: 'Custom sysctl',
        target: 'network',
        riskLevel: 'high',
        parameters: [
          { key: 'net.ipv4.tcp_fin_timeout', value: '15', status: 'backend_required' }
        ]
      })
    );
  });

  it('shows recent tuning execution status steps and errors', () => {
    const failedTask = createTask({
      id: 'task-tune-failed',
      status: 'failed',
      updatedAt: '2026-06-02T10:10:00.000Z',
      targetLabel: 'Custom sysctl / agent-hkg-01',
      failureReason: 'sysctl net.ipv4.tcp_fin_timeout is not allowlisted',
      steps: [
        { id: 'preflight', label: 'Read current sysctl values', status: 'succeeded' },
        { id: 'apply', label: 'Apply sysctl values', status: 'failed' }
      ]
    });
    const olderTask = createTask({
      id: 'task-tune-succeeded',
      status: 'succeeded',
      updatedAt: '2026-06-02T10:05:00.000Z',
      targetLabel: 'BBR Edge Throughput / agent-hkg-01'
    });

    render(
      <TuningPage
        agents={agents}
        language="en"
        profiles={profiles}
        tasks={[olderTask, failedTask]}
        onRunTask={vi.fn()}
      />
    );

    const statusPanel = screen.getByRole('region', { name: 'Execution Status' });
    expect(within(statusPanel).getByText('Failed')).toBeInTheDocument();
    expect(within(statusPanel).getByText('Custom sysctl / agent-hkg-01')).toBeInTheDocument();
    expect(within(statusPanel).getByText('Read current sysctl values')).toBeInTheDocument();
    expect(within(statusPanel).getByText('Apply sysctl values')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('sysctl net.ipv4.tcp_fin_timeout is not allowlisted');
  });

  it('disables tuning actions while a task submission is in progress', () => {
    render(
      <TuningPage
        agents={agents}
        language="en"
        profiles={profiles}
        taskMutationBusy
        tasks={[]}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Submitting change');
    expect(screen.getByRole('button', { name: 'Apply BBR' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply TCP Tuning' })).toBeDisabled();
  });
});
