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
    expect(within(rail).getByRole('region', { name: 'Host Tuning Probe' })).toBeInTheDocument();
    expect(within(rail).getByRole('group', { name: 'Tuning Preset Panel' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Dispatch Tuning Preset' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: 'Execution Status' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: 'Preset Execution Plan' })).toBeInTheDocument();
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

    await user.selectOptions(screen.getByLabelText('Tuning Preset'), 'tcp-high-throughput');

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Tuning control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Tuning execution workspace' });
    const probePanel = within(rail).getByRole('region', { name: 'Host Tuning Probe' });
    const presetPanel = within(rail).getByRole('group', { name: 'Tuning Preset Panel' });
    const presetPlan = within(workspace).getByRole('region', { name: 'Preset Execution Plan' });
    const statusPanel = within(workspace).getByRole('region', { name: 'Execution Status' });
    const presetRow = within(presetPlan).getByRole('article', { name: 'net.ipv4.tcp_rmem' });

    expect(cockpit).toHaveClass('tuning-ops-cockpit');
    expect(rail).toHaveClass('tuning-ops-rail');
    expect(workspace).toHaveClass('tuning-ops-workspace');
    expect(probePanel).toHaveClass('tuning-ops-tool-panel');
    expect(presetPanel).toHaveClass('tuning-ops-tool-panel');
    expect(presetPlan).toHaveClass('tuning-ops-plan-panel');
    expect(statusPanel).toHaveClass('tuning-ops-status-panel');
    expect(presetRow).toHaveClass('tuning-ops-plan-row');
    const cockpitHtml = `${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`;
    expect(cockpitHtml).toContain('#1E3AFF');
    expect(cockpitHtml).toContain('#DCE1FF');
    expect(cockpitHtml).toContain('#FF3D18');
    expect(cockpitHtml).toContain('#FFD8C6');
    expect(cockpitHtml).toContain('#00A878');
    expect(cockpitHtml).not.toContain('blue-');
    expect(cockpitHtml).not.toContain('orange-');
    expect(cockpitHtml).not.toContain('slate-');
    expect(cockpitHtml).not.toContain('emerald-');
    expect(cockpitHtml).not.toContain('sky-');
    expect(cockpitHtml).not.toContain('indigo-');
    expect(cockpitHtml).not.toContain('cyan-');
    expect(cockpitHtml).not.toContain('purple-');
    expect(cockpitHtml).not.toContain('violet-');
    expect(cockpitHtml).not.toContain('rose-');
    expect(cockpitHtml).not.toContain('amber-');
    expect(cockpitHtml).not.toContain('background-clip:text');
  });

  it('surfaces system tuning release gates on the control rail', () => {
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

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Tuning control rail' });
    const gates = within(rail).getByRole('region', { name: 'System Tuning Release Gates' });

    expect(gates).toHaveClass('tuning-release-gate-panel');
    expect(gates.outerHTML).toContain('#1E3AFF');
    expect(gates.outerHTML).toContain('#FF3D18');
    expect(gates.outerHTML).toContain('#D9FF00');
    expect(gates.outerHTML).toContain('#00A878');
    expect(within(gates).getByRole('group', { name: 'Agent Target' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'TCP Profile' })).toHaveTextContent('Ready');
    expect(within(gates).queryByRole('group', { name: 'Custom Sysctl' })).not.toBeInTheDocument();
    expect(within(gates).getByRole('group', { name: 'Execution Health' })).toHaveTextContent('Issues');
    expect(within(gates).getByRole('group', { name: 'Dispatch Readiness' })).toHaveTextContent('Ready');
  });

  it('detects BBR and TCP status from the selected host and dispatches administrator presets instead of manual TCP buffers', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(
      <TuningPage
        agents={[
          {
            ...baseAgent,
            capabilities: ['xray', 'port-forwarding', 'bbr'],
            telemetry: {
              ...baseAgent.telemetry,
              runtimeServices: [
                {
                  name: 'ou-ui-bbr.service',
                  moduleKind: 'bbr',
                  status: 'active',
                  enabled: true,
                  required: false,
                  checkedAt: '2026-06-02T00:00:00.000Z'
                }
              ]
            }
          }
        ]}
        language="zh"
        profiles={profiles}
        tasks={[]}
        onRunTask={onRunTask}
      />
    );

    const cockpit = screen.getByRole('region', { name: '系统调优 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '调优控制轨' });

    expect(within(rail).getByRole('region', { name: '主机调优探测' })).toBeInTheDocument();
    expect(within(rail).getByText('BBR 已安装')).toBeInTheDocument();
    expect(within(rail).getByText('TCP 状态')).toBeInTheDocument();
    expect(screen.queryByLabelText('TCP 接收缓冲')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('TCP 发送缓冲')).not.toBeInTheDocument();
    expect(within(rail).queryByText('net.ipv4.tcp_rmem=4096 87380 134217728')).not.toBeInTheDocument();
    expect(within(rail).queryByText('net.ipv4.tcp_wmem=4096 65536 134217728')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('调优预设'), 'tcp-high-throughput');

    expect(within(rail).queryByText('net.ipv4.tcp_rmem=4096 87380 134217728')).not.toBeInTheDocument();
    expect(within(rail).queryByText('net.ipv4.tcp_wmem=4096 65536 134217728')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下发调优预设' }));

    expect(onRunTask).toHaveBeenCalledWith(
      'tcp-high-throughput',
      'agent-hkg-01',
      expect.objectContaining({
        id: 'tcp-high-throughput',
        name: 'TCP 高吞吐预设',
        parameters: expect.arrayContaining([
          expect.objectContaining({ key: 'net.ipv4.tcp_congestion_control', value: 'bbr' }),
          expect.objectContaining({ key: 'net.core.default_qdisc', value: 'fq' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_rmem', value: '4096 87380 134217728' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_wmem', value: '4096 65536 134217728' })
        ])
      })
    );
  });

  it('keeps the system tuning cockpit compact without masonry or oversized cards', async () => {
    const user = userEvent.setup();

    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Tuning Preset'), 'tcp-high-throughput');

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });
    const cockpitGrid = cockpit.querySelector('.tuning-ops-cockpit-grid');
    const rail = within(cockpit).getByRole('complementary', { name: 'Tuning control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Tuning execution workspace' });
    const workspaceStack = workspace.querySelector('.tuning-ops-workspace-stack');
    const actionGrid = workspace.querySelector('.tuning-ops-action-grid');
    const statusPanel = within(workspace).getAllByRole('region', { name: 'Execution Status' })[0];
    const presetPlan = within(workspace).getByRole('region', { name: 'Preset Execution Plan' });
    const presetPanel = within(rail).getByRole('group', { name: 'Tuning Preset Panel' });
    const presetRow = within(presetPlan).getByRole('article', { name: 'net.ipv4.tcp_rmem' });
    const railMetric = within(rail).getByRole('group', { name: 'Host Status' });
    const summaryGrid = document.querySelector('.tuning-summary-grid');
    const summaryCard = document.querySelector('.tuning-summary-card');
    const layoutHtml = cockpit.outerHTML;

    expect(cockpitGrid).toBeInTheDocument();
    expect(cockpitGrid as HTMLElement).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(summaryGrid).toBeInTheDocument();
    expect(summaryGrid as HTMLElement).toHaveClass('xl:w-[28rem]', 'xl:grid-cols-2');
    expect(summaryGrid as HTMLElement).not.toHaveClass('xl:w-[30rem]', 'xl:grid-cols-1');
    expect(rail).toHaveClass('p-3');
    expect(rail).not.toHaveClass('p-4');
    expect(workspaceStack).toBeInTheDocument();
    expect(workspaceStack as HTMLElement).toHaveClass('space-y-3', 'p-3');
    expect(actionGrid).toBeInTheDocument();
    expect(actionGrid as HTMLElement).toHaveClass('xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]');
    expect(actionGrid as HTMLElement).not.toHaveClass('lg:grid-cols-[minmax(0,0.9fr)_minmax(19rem,0.65fr)]');
    expect(statusPanel).toHaveClass('tuning-ops-status-panel', 'p-3');
    expect(statusPanel).not.toHaveClass('p-5', 'rounded-xl');
    expect(presetPlan).toHaveClass('tuning-ops-plan-panel', 'p-3');
    expect(presetPlan).not.toHaveClass('p-5', 'rounded-xl');
    expect(presetPanel).toHaveClass('tuning-ops-tool-panel', 'p-3');
    expect(presetPanel).not.toHaveClass('p-5', 'rounded-xl');
    expect(presetRow).toHaveClass('tuning-ops-plan-row', 'min-h-[54px]', 'px-3', 'py-2');
    expect(presetRow).not.toHaveClass('min-h-[76px]');
    expect(presetRow).not.toHaveClass('rounded-xl');
    expect(railMetric).toHaveClass('tuning-ops-metric', 'min-h-[64px]', 'px-3', 'py-2');
    expect(railMetric).not.toHaveClass('min-h-[76px]');
    expect(railMetric).not.toHaveClass('rounded-xl');
    expect(summaryCard).toHaveClass('tuning-summary-card', 'min-h-[64px]', 'p-2.5');
    expect(summaryCard).not.toHaveClass('min-h-[76px]', 'rounded-xl', 'p-3', 'p-4');
    expect(layoutHtml).not.toContain('masonry');
    expect(layoutHtml).not.toContain('columns-');
    expect(layoutHtml).not.toContain('grid-flow-row-dense');
    expect(layoutHtml).not.toContain('auto-rows');
    expect(layoutHtml).not.toContain('row-span');
  });

  it('renders practical BBR TCP and custom sysctl controls without template search clutter', () => {
    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'System Tuning' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Host Tuning Probe' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tuning Preset Panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dispatch Tuning Preset' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Custom sysctl' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Custom sysctl key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Custom sysctl value')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add sysctl' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Custom sysctl' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tuning Preset')).toHaveValue('bbr-fq');
    expect(screen.queryByLabelText('TCP receive buffer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('TCP write buffer')).not.toBeInTheDocument();
    expect(screen.queryByText('net.ipv4.tcp_rmem=4096 87380 67108864')).not.toBeInTheDocument();
    expect(screen.queryByText('net.ipv4.tcp_wmem=4096 65536 67108864')).not.toBeInTheDocument();
    expect(screen.getByText('No tuning execution yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search Profiles' })).not.toBeInTheDocument();
  });

  it('keeps tuning focused on host probe state and administrator presets without explanatory filler', () => {
    render(<TuningPage agents={agents} language="zh" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: '系统调优 cockpit' });

    expect(cockpit).toHaveTextContent('主机调优探测');
    expect(cockpit).toHaveTextContent('BBR 未确认');
    expect(cockpit).toHaveTextContent('TCP 状态');
    expect(cockpit).toHaveTextContent('调优预设');
    expect(cockpit).toHaveTextContent('下发调优预设');
    expect(cockpit).not.toHaveTextContent('自定义 sysctl');
    expect(cockpit).not.toHaveTextContent('应用自定义 sysctl');
    expect(cockpit).not.toHaveTextContent('apply_sysctl');
    expect(cockpit).not.toHaveTextContent('先确认调优 profile');
    expect(cockpit).not.toHaveTextContent('避免在前端盲填');
    expect(cockpit).not.toHaveTextContent('适合常规入口主机');
    expect(cockpit).not.toHaveTextContent('适合混合客户节点');
    expect(cockpit).not.toHaveTextContent('把 Agent 目标');
    expect(screen.queryByLabelText('TCP 接收缓冲')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('TCP 发送缓冲')).not.toBeInTheDocument();
  });

  it('dispatches the selected TCP preset to the selected Agent', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={onRunTask} />);

    await user.selectOptions(screen.getByLabelText('Target Host'), 'agent-sin-02');
    await user.selectOptions(screen.getByLabelText('Tuning Preset'), 'tcp-high-throughput');
    await user.click(screen.getByRole('button', { name: 'Dispatch Tuning Preset' }));

    expect(onRunTask).toHaveBeenCalledWith(
      'tcp-high-throughput',
      'agent-sin-02',
      expect.objectContaining({
        id: 'tcp-high-throughput',
        name: 'TCP High Throughput Preset',
        target: 'network',
        parameters: expect.arrayContaining([
          expect.objectContaining({ key: 'net.ipv4.tcp_rmem', value: '4096 87380 134217728' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_wmem', value: '4096 65536 134217728' }),
          expect.objectContaining({ key: 'net.core.somaxconn', value: '65535' }),
          expect.objectContaining({ key: 'net.ipv4.tcp_max_syn_backlog', value: '65535' })
        ])
      })
    );
  });

  it('does not expose custom sysctl dispatch from the tuning cockpit', () => {
    render(<TuningPage agents={agents} language="en" profiles={profiles} tasks={[]} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'System tuning cockpit' });

    expect(within(cockpit).queryByRole('region', { name: 'Custom sysctl' })).not.toBeInTheDocument();
    expect(within(cockpit).queryByLabelText('Custom sysctl key')).not.toBeInTheDocument();
    expect(within(cockpit).queryByLabelText('Custom sysctl value')).not.toBeInTheDocument();
    expect(within(cockpit).queryByRole('button', { name: 'Apply Custom sysctl' })).not.toBeInTheDocument();
    expect(cockpit).not.toHaveTextContent('apply_sysctl');
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
    expect(statusPanel.outerHTML).toContain('#FF3D18');
    expect(statusPanel.outerHTML).toContain('#FFD8C6');
    expect(statusPanel.outerHTML).not.toContain('orange-');
    expect(statusPanel.outerHTML).not.toContain('rose-');
    expect(statusPanel.outerHTML).not.toContain('amber-');
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
    expect(screen.getByRole('status').outerHTML).toContain('#FF3D18');
    expect(screen.getByRole('status').outerHTML).toContain('#FFD8C6');
    expect(screen.getByRole('status').outerHTML).not.toContain('orange-');
    expect(screen.getByRole('status').outerHTML).not.toContain('amber-');
    expect(screen.getByRole('button', { name: 'Dispatch Tuning Preset' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Apply Custom sysctl' })).not.toBeInTheDocument();
  });
});
