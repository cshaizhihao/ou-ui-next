import { render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type {
  Agent,
  AuditLog,
  ManagedNode,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SystemAlert,
  DeployTask,
  TrafficRollup,
  TrafficRollupCompaction
} from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { DashboardPage } from './dashboard-page';

const GB = 1024 ** 3;
const task: DeployTask = {
  id: 'task-release-001',
  operation: 'forward.apply',
  resourceType: 'forward',
  resourceId: 'forward-rule-01',
  status: 'succeeded',
  targetId: 'forward-rule-01',
  targetLabel: '东京游戏转发',
  summary: 'Apply forwarding policy',
  createdAt: '2026-06-05T10:15:00.000Z',
  updatedAt: '2026-06-05T10:16:00.000Z',
  actor: 'operator',
  requestedBy: 'operator',
  requestId: 'req-release-001',
  sourceIp: 'ui-preview',
  rollbackAvailable: true,
  attempts: 1,
  steps: []
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function createAgent(): Agent {
  return {
    id: 'agent-hkg-01',
    name: '香港入口主机',
    status: 'online',
    region: 'hk',
    publicAddress: '198.51.100.10',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    maxTrafficBytes: 100 * GB,
    monthlyTrafficLimitBytes: 50 * GB,
    expiresAt: '2026-12-31T00:00:00.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 9,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-05T10:00:00.000Z',
    telemetry: {
      cpuPercent: 12,
      cpuCores: 4,
      memoryPercent: 30,
      memoryUsedBytes: 2 * GB,
      memoryTotalBytes: 8 * GB,
      diskUsedBytes: 12 * GB,
      diskTotalBytes: 64 * GB,
      txBytes: 5 * GB,
      rxBytes: 3 * GB,
      monthlyIngressBytes: 3 * GB,
      monthlyEgressBytes: 5 * GB,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 5 * GB,
      downloadTotalBytes: 3 * GB,
      monthlyTrafficUsedBytes: 8 * GB,
      latencyMs: 42,
      latencySamplesMs: [40, 42],
      packetLossPercent: 0,
      packetLossSamplesPercent: [0],
      onlineDays: 12,
      reportedAt: '2026-06-05T10:00:00.000Z'
    }
  };
}

function renderPage(overrides: Partial<Parameters<typeof DashboardPage>[0]> = {}) {
  const props = {
    agents: [createAgent()],
    nodes: [
      {
        id: 'customer-node-01',
        agentId: 'agent-hkg-01',
        name: '客户节点 A',
        status: 'healthy',
        entrypoint: 'edge.example.com:443',
        modules: [],
        activeInboundCount: 1,
        activeForwardCount: 0,
        updatedAt: '2026-06-05T10:00:00.000Z'
      } satisfies ManagedNode
    ],
    tasks: [task],
    auditLogs: [
      {
        id: 'audit-dashboard-001',
        action: 'task.succeeded',
        actor: 'operator',
        scope: 'control-plane',
        resourceType: 'forward',
        operation: 'forward.apply',
        result: 'succeeded',
        targetId: 'forward-rule-01',
        targetLabel: '东京游戏转发',
        taskId: task.id,
        severity: 'info',
        message: 'Forwarding policy applied',
        createdAt: '2026-06-05T10:16:30.000Z',
        sourceIp: 'ui-preview',
        requestId: 'req-release-001',
        hash: 'sha256:audit-dashboard'
      }
    ] as AuditLog[],
    forwardingRules: [
      {
        id: 'forward-rule-01',
        name: '东京游戏转发',
        ownerName: 'Acme',
        protocol: 'tcp',
        tunnelId: 'tunnel-01',
        tunnelName: 'Direct Tunnel',
        sourceAgentId: 'agent-hkg-01',
        entryNodeIds: ['agent-hkg-01'],
        sourceAddress: '0.0.0.0',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '10.8.0.10',
        targetPort: 9443,
        enabled: true,
        portStatus: 'allocated',
        bindings: [],
        bindingCount: 1,
        quotaBytes: 50 * GB,
        usedBytes: 0,
        monthlyResetDay: 9,
        currentUsedTrafficGb: 0,
        rateLimitMbps: 100,
        rateLimitMode: 'bi-directional',
        rateLimitDirection: 'both',
        ipRateLimitMbps: 20,
        billingDirection: 'both',
        pricePerGb: 0,
        tunnelMode: 'direct',
        strategy: 'fifo',
        maxConnections: 100,
        maxConnectionsPerIp: 10,
        proxyProtocol: false
      } satisfies ForwardingRuleView
    ],
    subscriptions: [],
    configRevisions: [
      {
        id: 'cfg-dashboard-001',
        taskId: task.id,
        operation: 'forward.apply',
        targetId: 'forward-rule-01',
        targetLabel: '东京游戏转发',
        agentId: 'agent-hkg-01',
        moduleKind: 'port-forwarding',
        artifactUri: 'ou-ui://artifacts/config-revisions/cfg-dashboard-001.json',
        checksum: 'sha256:cfg-dashboard',
        signature: 'sig-v1:dashboard',
        preflightPlanId: 'preflight-dashboard-001',
        snapshotBeforeId: 'snapshot-dashboard-001',
        status: 'applied',
        createdAt: '2026-06-05T10:14:00.000Z',
        createdBy: 'operator',
        appliedAt: '2026-06-05T10:16:00.000Z',
        diffSummary: { added: 1, changed: 1, removed: 0 },
        artifact: {}
      }
    ] as RuntimeConfigRevision[],
    preflightPlans: [
      {
        id: 'preflight-dashboard-001',
        taskId: task.id,
        configRevisionId: 'cfg-dashboard-001',
        targetId: 'forward-rule-01',
        agentId: 'agent-hkg-01',
        moduleKind: 'port-forwarding',
        status: 'passed',
        checks: [{ id: 'port-free', label: 'Port available', status: 'passed', severity: 'critical' }],
        createdAt: '2026-06-05T10:14:20.000Z',
        completedAt: '2026-06-05T10:14:40.000Z'
      }
    ] as RuntimePreflightPlan[],
    runtimeSnapshots: [
      {
        id: 'snapshot-dashboard-001',
        taskId: task.id,
        targetId: 'forward-rule-01',
        targetLabel: '东京游戏转发',
        agentId: 'agent-hkg-01',
        moduleKind: 'port-forwarding',
        reason: 'pre_apply',
        status: 'captured',
        checksum: 'sha256:snapshot-dashboard',
        capturedAt: '2026-06-05T10:14:10.000Z',
        capturedBy: 'operator',
        state: {}
      }
    ] as RuntimeSnapshot[],
    trafficRollups: [] as TrafficRollup[],
    trafficRollupCompactions: [] as TrafficRollupCompaction[],
    trafficRollupExportBusy: false,
    trafficRollupRetentionPolicy: undefined,
    trafficRollupRetentionBusy: false,
    systemAlerts: [
      {
        id: 'alert-dashboard-001',
        kind: 'agent.high_latency',
        severity: 'warning',
        status: 'active',
        title: 'Latency elevated',
        message: 'Agent latency is elevated',
        resourceType: 'agent',
        resourceId: 'agent-hkg-01',
        resourceLabel: '香港入口主机',
        observedAt: '2026-06-05T10:17:00.000Z',
        dedupeKey: 'agent-hkg-01:latency'
      }
    ] as SystemAlert[],
    language: 'zh' as const,
    onRefresh: vi.fn(),
    ...overrides
  };

  return render(<DashboardPage {...props} />);
}

describe('DashboardPage', () => {
  it('frames the home screen as a formal Master control-plane overview', () => {
    renderPage();

    const shell = screen.getByRole('region', { name: 'Master Control Plane Overview' });

    expect(shell).toHaveClass('dashboard-control-plane');
    expect(screen.getByText('Master Control Plane')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Customer Nodes')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    expect(screen.getByText('Audit Evidence')).toBeInTheDocument();
    expect(screen.getByText('Release Evidence')).toBeInTheDocument();
    expect(screen.getByText('Config 1 / Preflight 1 / Snapshot 1')).toBeInTheDocument();
    expect(screen.getByText('Audit & Alerts')).toBeInTheDocument();
    expect(screen.getByText('Audit 1 / Alerts 1')).toBeInTheDocument();
    expect(document.querySelector('.dashboard-control-plane-surface')).toHaveClass('!bg-slate-950');
    expect(screen.getByText('实时查看核心资源、交付链路与服务状态。')).toHaveClass('text-white/[.62]');
    expect(screen.getByText('Release Evidence')).toHaveClass('text-slate-500');
    expect(document.querySelector('.dashboard-control-plane-media')).not.toBeNull();
    expect(document.querySelector('.dashboard-control-plane-bento')).not.toBeNull();
    expect(document.querySelector('.dashboard-control-plane-hosts')).not.toBeNull();
    expect(document.querySelector('[style*="picsum.photos"]')).toBeNull();
    expect(screen.queryByText('控制面正在呼吸')).not.toBeInTheDocument();
  });

  it('renders an operator-facing cockpit instead of dashboard waterfall sections', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: '运营态势' })).toBeInTheDocument();
    expect(screen.getByText('实时查看核心资源、交付链路与服务状态。')).toBeInTheDocument();
    expect(screen.getByText('主机接入')).toBeInTheDocument();
    expect(screen.getByText('客户节点')).toBeInTheDocument();
    expect(screen.getAllByText('端口转发').length).toBeGreaterThan(0);
    expect(screen.getByText('订阅交付')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '实时流量拓扑' })).toBeInTheDocument();
    expect(screen.getByText('香港入口主机')).toBeInTheDocument();

    expect(screen.queryByText('用量账本')).not.toBeInTheDocument();
    expect(screen.queryByText('活动告警')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: '搜索用量账本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: '搜索告警' })).not.toBeInTheDocument();
  });

  it('uses the primary blue control-plane palette instead of cyan in the dashboard cockpit', () => {
    renderPage();

    const cockpit = document.querySelector('.dashboard-control-plane');
    expect(cockpit).not.toBeNull();
    expect((cockpit as HTMLElement).outerHTML).toContain('blue-');
    expect((cockpit as HTMLElement).outerHTML).not.toContain('cyan-');
  });

  it('keeps the dashboard cockpit on the blue and orange operational palette without sky or indigo drift', () => {
    renderPage();

    const cockpit = document.querySelector('.dashboard-control-plane');
    expect(cockpit).not.toBeNull();

    const markup = (cockpit as HTMLElement).outerHTML;
    expect(markup).toContain('blue-');
    expect(markup).toContain('orange-');
    expect(markup).not.toContain('sky-');
    expect(markup).not.toContain('indigo-');
    expect(markup).not.toContain('cyan-');
    expect(markup).not.toContain('purple-');
    expect(markup).not.toContain('violet-');
    expect(markup).not.toContain('amber-');
    expect(markup).not.toContain('rose-');
    expect(markup).not.toContain('background-clip:text');
  });

  it('uses orange signal tone for degraded host probes without amber drift', () => {
    renderPage({
      agents: [
        {
          ...createAgent(),
          status: 'degraded'
        }
      ]
    });

    const hostTelemetry = screen.getByRole('region', { name: '主机遥测' });
    expect(hostTelemetry.outerHTML).toContain('orange-');
    expect(hostTelemetry.outerHTML).not.toContain('amber-');
  });

  it('switches cockpit copy to English without restoring removed ledger and alert panels', () => {
    renderPage({ language: 'en' });

    expect(screen.getByRole('heading', { name: 'Operations Overview' })).toBeInTheDocument();
    expect(screen.getByText('Monitor core resources, delivery paths, and service readiness in real time.')).toBeInTheDocument();
    expect(screen.getByText('Host Access')).toBeInTheDocument();
    expect(screen.getByText('Customer Nodes')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Real-time traffic topology' })).toBeInTheDocument();

    expect(screen.queryByText('Single-screen Control Cockpit')).not.toBeInTheDocument();
    expect(screen.queryByText('一屏总览控制台')).not.toBeInTheDocument();
    expect(screen.queryByText('Only the four primary lanes stay here; ledger, alerts, and audit live in their workspaces.')).not.toBeInTheDocument();
  });

  it('keeps the refresh action wired from the compact cockpit header', async () => {
    const onRefresh = vi.fn();
    renderPage({ onRefresh });

    await screen.getByRole('button', { name: '刷新视图' }).click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('splits the first screen into a control surface and an operations rail', () => {
    renderPage({ onOpenHostWorkspace: vi.fn() });

    expect(screen.getByRole('region', { name: '控制面' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '运维侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '主机遥测' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '发布证据' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '审计与告警' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '管理主机' })).toBeInTheDocument();
  });

  it('surfaces the latest release evidence chain directly on the home control plane', () => {
    renderPage();

    const releaseEvidence = screen.getByRole('region', { name: '发布证据' });

    expect(releaseEvidence).toHaveTextContent('cfg-dashboard-001');
    expect(releaseEvidence).toHaveTextContent('applied');
    expect(releaseEvidence).toHaveTextContent('preflight-dashboard-001');
    expect(releaseEvidence).toHaveTextContent('passed');
    expect(releaseEvidence).toHaveTextContent('snapshot-dashboard-001');
    expect(releaseEvidence).toHaveTextContent('captured');
  });
});
