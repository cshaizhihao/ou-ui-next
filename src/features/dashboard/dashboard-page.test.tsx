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
  TrafficRollup,
  TrafficRollupCompaction
} from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { DashboardPage } from './dashboard-page';

const GB = 1024 ** 3;

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
    tasks: [],
    auditLogs: [] as AuditLog[],
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
    configRevisions: [] as RuntimeConfigRevision[],
    preflightPlans: [] as RuntimePreflightPlan[],
    runtimeSnapshots: [] as RuntimeSnapshot[],
    trafficRollups: [] as TrafficRollup[],
    trafficRollupCompactions: [] as TrafficRollupCompaction[],
    trafficRollupExportBusy: false,
    trafficRollupRetentionPolicy: undefined,
    trafficRollupRetentionBusy: false,
    systemAlerts: [] as SystemAlert[],
    language: 'zh' as const,
    onRefresh: vi.fn(),
    ...overrides
  };

  return render(<DashboardPage {...props} />);
}

describe('DashboardPage', () => {
  it('renders a single-screen cockpit instead of dashboard waterfall sections', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: '一屏总览控制台' })).toBeInTheDocument();
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

  it('switches cockpit copy to English without restoring removed ledger and alert panels', () => {
    renderPage({ language: 'en' });

    expect(screen.getByRole('heading', { name: 'Single-screen Control Cockpit' })).toBeInTheDocument();
    expect(screen.getByText('Host Access')).toBeInTheDocument();
    expect(screen.getByText('Customer Nodes')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Real-time traffic topology' })).toBeInTheDocument();

    expect(screen.queryByText('Usage Ledger')).not.toBeInTheDocument();
    expect(screen.queryByText('Active Alerts')).not.toBeInTheDocument();
    expect(screen.queryByText('一屏总览控制台')).not.toBeInTheDocument();
  });

  it('keeps the refresh action wired from the compact cockpit header', async () => {
    const onRefresh = vi.fn();
    renderPage({ onRefresh });

    await screen.getByRole('button', { name: '刷新视图' }).click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
