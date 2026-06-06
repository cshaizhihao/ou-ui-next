import { render, screen } from '@testing-library/react';
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
        modules: [
          {
            id: 'module-xray-01',
            kind: 'xray',
            label: 'Xray Runtime',
            version: '1.8.0',
            state: 'running',
            configVersion: 'config-001',
            hotReload: true,
            lastReloadAt: '2026-06-05T10:00:00.000Z'
          }
        ],
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
    trafficRollups: [
      {
        id: 'traffic-agent-1',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        subjectLabel: 'agent-hkg-01',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-05T10:00:00.000Z',
        sampledAt: '2026-06-05T10:00:00.000Z',
        periodKey: '2026-06',
        monthlyResetDay: 9,
        accountingMode: 'both',
        ingressBytes: 2 * GB,
        egressBytes: 3 * GB,
        meteredBytes: 5 * GB,
        source: 'agent-telemetry'
      },
      {
        id: 'traffic-agent-2',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        subjectLabel: 'agent-hkg-01',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-05T11:00:00.000Z',
        sampledAt: '2026-06-05T11:00:00.000Z',
        periodKey: '2026-06',
        monthlyResetDay: 9,
        accountingMode: 'both',
        ingressBytes: 1 * GB,
        egressBytes: 2 * GB,
        meteredBytes: 3 * GB,
        source: 'agent-telemetry'
      },
      {
        id: 'traffic-forward-1',
        dimension: 'forward-rule',
        subjectId: 'forward-rule-01',
        subjectLabel: 'forward-rule-01',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-05T11:05:00.000Z',
        sampledAt: '2026-06-05T11:05:00.000Z',
        periodKey: '2026-06',
        monthlyResetDay: 9,
        accountingMode: 'both',
        ingressBytes: 4 * GB,
        egressBytes: 2 * GB,
        meteredBytes: 6 * GB,
        source: 'agent-telemetry',
        metadata: {
          ruleId: 'forward-rule-01',
          serviceName: 'forward-rule-01.service'
        }
      },
      {
        id: 'traffic-xray-1',
        dimension: 'xray-client',
        subjectId: 'customer-node-01:client-a',
        subjectLabel: 'customer-a@example.com',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-05T11:10:00.000Z',
        sampledAt: '2026-06-05T11:10:00.000Z',
        periodKey: '2026-06',
        monthlyResetDay: 9,
        accountingMode: 'egress',
        ingressBytes: 512 * 1024 * 1024,
        egressBytes: 2 * GB,
        meteredBytes: 2 * GB,
        source: 'agent-telemetry',
        metadata: {
          inboundId: 'customer-node-01',
          clientEmail: 'customer-a@example.com'
        }
      }
    ] as TrafficRollup[],
    trafficRollupCompactions: [
      {
        id: 'traffic-compaction-agent-hkg-2026-05-31',
        granularity: 'day',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        subjectLabel: '香港入口主机',
        agentId: 'agent-hkg-01',
        periodKey: '2026-05',
        bucketStartAt: '2026-05-31T00:00:00.000Z',
        bucketEndAt: '2026-06-01T00:00:00.000Z',
        firstObservedAt: '2026-05-31T01:00:00.000Z',
        lastObservedAt: '2026-05-31T23:30:00.000Z',
        firstSampledAt: '2026-05-31T01:00:00.000Z',
        lastSampledAt: '2026-05-31T23:30:00.000Z',
        sampleCount: 3,
        ingressBytesTotal: 2 * GB,
        egressBytesTotal: 1 * GB,
        meteredBytesTotal: 3 * GB,
        compactedAt: '2026-06-05T11:30:00.000Z',
        source: 'retention-prune'
      },
      {
        id: 'traffic-compaction-xray-client-a-2026-05-31',
        granularity: 'day',
        dimension: 'xray-client',
        subjectId: 'customer-node-01:client-a',
        subjectLabel: 'customer-a@example.com',
        agentId: 'agent-hkg-01',
        periodKey: '2026-05',
        bucketStartAt: '2026-05-31T00:00:00.000Z',
        bucketEndAt: '2026-06-01T00:00:00.000Z',
        firstObservedAt: '2026-05-31T08:00:00.000Z',
        lastObservedAt: '2026-05-31T22:00:00.000Z',
        firstSampledAt: '2026-05-31T08:00:00.000Z',
        lastSampledAt: '2026-05-31T22:00:00.000Z',
        sampleCount: 2,
        ingressBytesTotal: 512 * 1024 * 1024,
        egressBytesTotal: 2 * GB,
        meteredBytesTotal: 2 * GB,
        compactedAt: '2026-06-05T11:30:00.000Z',
        source: 'retention-prune'
      }
    ] as TrafficRollupCompaction[],
    trafficRollupExportBusy: false,
    trafficRollupRetentionPolicy: {
      maxAgeMs: 62 * 24 * 60 * 60 * 1000,
      maxAgeDays: 62,
      maxRecordsPerScope: 200_000,
      source: 'runtime-config' as const,
      runtimeDefault: {
        maxAgeMs: 62 * 24 * 60 * 60 * 1000,
        maxAgeDays: 62,
        maxRecordsPerScope: 200_000
      }
    },
    trafficRollupRetentionBusy: false,
    systemAlerts: [] as SystemAlert[],
    language: 'zh' as const,
    onExportTrafficRollups: vi.fn(),
    onExportTrafficRollupCompactions: vi.fn(),
    onUpdateTrafficRollupRetentionPolicy: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides
  };

  render(<DashboardPage {...props} />);
  return props;
}

describe('DashboardPage', () => {
  it('prioritizes host probes and removes long dashboard history sections', () => {
    renderPage();

    expect(screen.getByText('主机探针')).toBeInTheDocument();
    expect(screen.getByText('香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('agent-hkg-01')).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('内存')).toBeInTheDocument();
    expect(screen.getByText('磁盘')).toBeInTheDocument();
    expect(screen.getAllByText('8.0 GB / 50GB').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.queryByText('流量历史')).not.toBeInTheDocument();
    expect(screen.queryByText('节点运行热区')).not.toBeInTheDocument();
    expect(screen.queryByText('订阅与执行信号')).not.toBeInTheDocument();
  });

  it('switches host probe dashboard copy to English without keeping Chinese dashboard labels', () => {
    renderPage({ language: 'en' });

    expect(screen.getByText('Host Probes')).toBeInTheDocument();
    expect(screen.getByText('Live throughput 8.0 GB')).toBeInTheDocument();
    expect(screen.getByText('Traffic Topology')).toBeInTheDocument();
    expect(screen.queryByText('流量历史')).not.toBeInTheDocument();
    expect(screen.queryByText('主机探针')).not.toBeInTheDocument();
  });

  it('renders runtime service health alerts with localized dashboard labels', () => {
    renderPage({
      language: 'en',
      systemAlerts: [
        {
          id: 'alert-agent-runtime-service-agent-hkg-01-ou-ui-xray.service',
          kind: 'agent.runtime_service_unhealthy',
          severity: 'critical',
          status: 'active',
          title: 'Agent runtime service unhealthy',
          message: 'Agent 香港入口主机 reports required runtime service ou-ui-xray.service is missing.',
          resourceType: 'agent',
          resourceId: 'agent-hkg-01',
          resourceLabel: '香港入口主机',
          observedAt: '2026-06-05T10:00:00.000Z',
          dedupeKey: 'agent:agent-hkg-01:runtime_service:ou-ui-xray.service',
          metadata: {
            serviceName: 'ou-ui-xray.service',
            serviceStatus: 'missing'
          }
        }
      ]
    });

    expect(screen.getByText('Runtime Service / 香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders high latency alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-agent-high-latency-agent-hkg-01',
          kind: 'agent.high_latency',
          severity: 'critical',
          status: 'active',
          title: 'Agent high latency',
          message: 'Agent 香港入口主机 reports latency above the configured red threshold.',
          resourceType: 'agent',
          resourceId: 'agent-hkg-01',
          resourceLabel: '香港入口主机',
          observedAt: '2026-06-05T10:00:00.000Z',
          dedupeKey: 'agent:agent-hkg-01:high_latency',
          metadata: {
            latencyMs: 260,
            latencyYellowMaxMs: 200
          }
        }
      ]
    });

    expect(screen.getByText('高延迟 / 香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders offline Agent alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-agent-offline-agent-hkg-01',
          kind: 'agent.offline',
          severity: 'critical',
          status: 'active',
          title: 'Agent offline',
          message: 'Agent 香港入口主机 has not reported heartbeat or telemetry within the configured liveness window.',
          resourceType: 'agent',
          resourceId: 'agent-hkg-01',
          resourceLabel: '香港入口主机',
          observedAt: '2026-06-05T10:05:00.000Z',
          dedupeKey: 'agent:agent-hkg-01:offline',
          metadata: {
            lastRuntimeSignalAt: '2026-06-05T10:00:00.000Z',
            offlineAfterSeconds: 300
          }
        }
      ]
    });

    expect(screen.getByText('主机离线 / 香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders command outbox alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-command-outbox-dead-letter',
          kind: 'command_outbox.dead_letter',
          severity: 'critical',
          status: 'active',
          title: 'Command outbox dead letter',
          message: '1 command outbox item is dead-lettered.',
          resourceType: 'command_outbox',
          resourceId: 'command-outbox',
          resourceLabel: 'Command outbox',
          observedAt: '2026-06-05T10:00:00.000Z',
          dedupeKey: 'command_outbox:dead_letter',
          metadata: {
            deadLetterCount: 4,
            deadLetterAckTimeoutCount: 1,
            deadLetterResultTimeoutCount: 1,
            deadLetterUnknownReasonCount: 1,
            deadLetterOtherReasonCount: 1,
            deadLetterReasonSummary: 'agent.transport.failure:1,command.ack.timeout:1,command.result.timeout:1,unknown:1'
          }
        }
      ]
    });

    expect(screen.getByText('命令死信 / Command outbox')).toBeInTheDocument();
    expect(screen.getByText('死信原因: ACK 1 / 结果 1 / 未知 1 / 其它 1')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders runtime reload failed alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-runtime-reload-failed-xray-runtime-hkg',
          kind: 'runtime.reload_failed',
          severity: 'critical',
          status: 'active',
          title: 'Runtime reload failed',
          message: 'Runtime reload for Xray Runtime HKG failed.',
          resourceType: 'runtime_release',
          resourceId: 'xray-runtime-hkg',
          resourceLabel: 'Xray Runtime HKG',
          observedAt: '2026-06-05T10:05:00.000Z',
          dedupeKey: 'runtime_reload:xray-runtime-hkg:failed',
          metadata: {
            taskId: 'task-runtime-reload-hkg',
            failureReason: 'xray reload health check failed'
          }
        }
      ]
    });

    expect(screen.getByText('重载失败 / Xray Runtime HKG')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders runtime apply health failed alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-runtime-apply-health-failed-forward-hkg-443',
          kind: 'runtime.apply_health_failed',
          severity: 'critical',
          status: 'active',
          title: 'Runtime apply health failed',
          message: 'Runtime apply for Forward HKG 443 failed post-apply health checks and triggered rollback.',
          resourceType: 'runtime_release',
          resourceId: 'forward-hkg-443',
          resourceLabel: 'Forward HKG 443',
          observedAt: '2026-06-05T10:05:00.000Z',
          dedupeKey: 'runtime_apply_health:forward-hkg-443:failed',
          metadata: {
            taskId: 'task-forward-apply-health-failed',
            rollbackTaskId: 'task-auto-rollback-forward-hkg-443'
          }
        }
      ]
    });

    expect(screen.getByText('应用健康失败 / Forward HKG 443')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders audit write failed alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-audit-write-failed',
          kind: 'audit.write_failed',
          severity: 'critical',
          status: 'active',
          title: 'Audit write failed',
          message: '1 audit write failure occurred in this control-plane process.',
          resourceType: 'audit',
          resourceId: 'audit-ledger',
          resourceLabel: 'Audit ledger',
          observedAt: '2026-06-05T10:05:00.000Z',
          dedupeKey: 'audit:write_failed',
          metadata: {
            writeFailures: 1
          }
        }
      ]
    });

    expect(screen.getByText('审计写入失败 / Audit ledger')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders system alert notification delivery health alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-system-alert-notification-dead-letter',
          kind: 'system_alert_notification.dead_letter',
          severity: 'critical',
          status: 'active',
          title: 'System alert notification dead letter',
          message: 'System alert notification deliveries are dead-lettered.',
          resourceType: 'system_alert_notification',
          resourceId: 'system-alert-notifications',
          resourceLabel: 'System alert notifications',
          observedAt: '2026-06-05T10:05:00.000Z',
          dedupeKey: 'system_alert_notification:dead_letter',
          metadata: {
            deadLetterDeliveryCount: 1
          }
        }
      ]
    });

    expect(screen.getByText('通知死信 / System alert notifications')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('renders quota exceeded alerts with localized dashboard labels', () => {
    renderPage({
      language: 'zh',
      systemAlerts: [
        {
          id: 'alert-quota-exceeded-managed-host-agent-hkg-01',
          kind: 'quota.exceeded',
          severity: 'critical',
          status: 'active',
          title: 'Quota exceeded',
          message: 'Quota policy 香港入口主机 is disabled_by_quota.',
          resourceType: 'quota_policy',
          resourceId: 'managed-host:agent-hkg-01',
          resourceLabel: '香港入口主机',
          observedAt: '2026-06-05T10:00:00.000Z',
          dedupeKey: 'quota_policy:managed-host:agent-hkg-01:exceeded',
          metadata: {
            enforcementState: 'disabled_by_quota',
            usedBytes: 1200,
            limitBytes: 1000
          }
        }
      ]
    });

    expect(screen.getByText('配额超限 / 香港入口主机')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });
});
