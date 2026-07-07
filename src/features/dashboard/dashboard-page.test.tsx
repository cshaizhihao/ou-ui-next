import { render, screen, within } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type { Agent, ManagedNode } from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import type { SubscriptionBundle } from '../subscriptions/subscription-mixer-page';
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

function createNode(): ManagedNode {
  return {
    id: 'customer-node-01',
    agentId: 'agent-hkg-01',
    name: '客户节点 A',
    status: 'healthy',
    entrypoint: 'edge.example.com:443',
    modules: [],
    activeInboundCount: 1,
    activeForwardCount: 0,
    updatedAt: '2026-06-05T10:00:00.000Z'
  };
}

function createForwardingRule(): ForwardingRuleView {
  return {
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
  };
}

function renderPage(overrides: Partial<Parameters<typeof DashboardPage>[0]> = {}) {
  const onRefresh = vi.fn();
  const onOpenHostWorkspace = vi.fn();

  const props: Parameters<typeof DashboardPage>[0] = {
    agents: [createAgent()],
    nodes: [createNode()],
    forwardingRules: [createForwardingRule()],
    subscriptions: [] as SubscriptionBundle[],
    trafficRollups: [],
    trafficRollupCompactions: [],
    language: 'zh',
    onRefresh,
    onOpenHostWorkspace,
    ...overrides
  };

  return {
    onRefresh,
    onOpenHostWorkspace,
    ...render(<DashboardPage {...props} />)
  };
}

describe('DashboardPage', () => {
  it('frames the home screen as a compact control-plane cockpit', () => {
    renderPage();

    const cockpit = screen.getByRole('region', { name: 'Master Control Plane Overview' });
    const controlSurface = within(cockpit).getByRole('region', { name: '控制面' });
    const operationsRail = within(cockpit).getByRole('region', { name: '运维侧栏' });
    const hostTelemetry = within(cockpit).getByRole('region', { name: '主机遥测' });
    const controlSurfaceCard = controlSurface.querySelector('.dashboard-control-plane-surface');

    expect(cockpit).toHaveClass('dashboard-control-plane');
    expect(controlSurfaceCard).toHaveClass('dashboard-control-plane-surface');
    expect(within(controlSurface).getByRole('img', { name: '主机到已挂载主机到节点连通性' })).toBeInTheDocument();
    expect(within(cockpit).getByRole('button', { name: '刷新视图' })).toBeInTheDocument();
    expect(within(hostTelemetry).getByRole('button', { name: '管理主机' })).toBeInTheDocument();
    expect(operationsRail).toBeInTheDocument();
    expect(screen.getByText('主机接入')).toBeInTheDocument();
    expect(screen.getByText('客户节点')).toBeInTheDocument();
    expect(screen.getByText('端口转发')).toBeInTheDocument();
    expect(screen.getByText('订阅交付')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Release Evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Audit & Alerts' })).not.toBeInTheDocument();
    expect(screen.queryByText('Response Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Production Readiness')).not.toBeInTheDocument();
  });

  it('uses a v2 control-surface visual system for the dashboard topology and metrics', () => {
    renderPage();

    const cockpit = screen.getByRole('region', { name: 'Master Control Plane Overview' });
    const cockpitHtml = cockpit.outerHTML;

    expect(cockpit).toHaveClass('dashboard-control-plane');
    expect(cockpitHtml).toContain('var(--ou-primary)');
    expect(cockpitHtml).toContain('var(--ou-danger)');
    expect(cockpitHtml).toContain('var(--ou-warning)');
    expect(cockpitHtml).toContain('var(--ou-success)');
    expect(cockpitHtml).toContain('var(--ou-surface)');
    expect(cockpitHtml).toContain('ou-tone-primary');
    expect(cockpitHtml).toContain('ou-tone-success');
    expect(cockpitHtml).toContain('ou-tone-warning');
    expect(cockpitHtml).toContain('ou-tone-danger');
    expect(cockpitHtml).toContain('dashboard-control-plane-media');
    expect(cockpitHtml).toContain('dashboard-control-plane-metric-grid');
    expect(cockpitHtml).not.toContain('#1E3AFF');
    expect(cockpitHtml).not.toContain('#FF3D18');
    expect(cockpitHtml).not.toContain('#D9FF00');
    expect(cockpitHtml).not.toContain('#00A878');
    expect(cockpitHtml).not.toContain('#FFFDF5');
    expect(cockpitHtml).not.toContain('#FDFFF1');
    expect(cockpitHtml).not.toContain('sky-');
    expect(cockpitHtml).not.toContain('indigo-');
    expect(cockpitHtml).not.toContain('cyan-');
    expect(cockpitHtml).not.toContain('purple-');
    expect(cockpitHtml).not.toContain('violet-');
    expect(cockpitHtml).not.toContain('amber-');
    expect(cockpitHtml).not.toContain('rose-');
    expect(cockpitHtml).not.toContain('background-clip:text');
  });

  it('keeps the dashboard cockpit compact without masonry or oversized cards', () => {
    renderPage();

    const cockpit = screen.getByRole('region', { name: 'Master Control Plane Overview' });
    const controlSurface = within(cockpit).getByRole('region', { name: '控制面' });
    const hostTelemetry = within(cockpit).getByRole('region', { name: '主机遥测' });
    const cockpitHtml = cockpit.outerHTML;

    expect(cockpit).toHaveClass('grid', 'grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]');
    expect(cockpit).toHaveClass('max-xl:grid-cols-1');
    expect(controlSurface).toHaveClass('grid');
    expect(hostTelemetry).toHaveClass('min-w-0');
    expect(cockpitHtml).not.toContain('masonry');
    expect(cockpitHtml).not.toContain('columns-');
    expect(cockpitHtml).not.toContain('grid-flow-row-dense');
    expect(cockpitHtml).not.toContain('row-span');
    expect(cockpitHtml).not.toContain('col-span');
  });

  it('wires refresh and host management actions from the cockpit', async () => {
    const { onRefresh, onOpenHostWorkspace } = renderPage();

    await screen.getByRole('button', { name: '刷新视图' }).click();
    await screen.getByRole('button', { name: '管理主机' }).click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenHostWorkspace).toHaveBeenCalledTimes(1);
  });
});
