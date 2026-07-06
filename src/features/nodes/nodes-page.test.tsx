import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type {
  Agent,
  DeployTask,
  QuotaPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  XrayInbound
} from '../../domain';
import type { CommandOutboxSummary } from '../../services/api/control-plane-api';
import { NodesPage } from './nodes-page';

const GB = 1024 ** 3;
const UUID_IN_LINK = '[0-9a-f-]{36}';
type TestXrayClient = XrayInbound['clients'][number] & { trafficMultiplier?: number };

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

function createInbound(overrides: Partial<XrayInbound> = {}): XrayInbound {
  const overrideClient = overrides.clients?.[0] as TestXrayClient | undefined;

  return {
    id: 'inbound-premium-vless',
    nodeId: 'node-metered-01',
    agentId: 'agent-metered-01',
    customerName: 'Acme Premium',
    serverAddress: '198.51.100.30',
    clientIdentity: 'client-acme-premium',
    remainingDays: 30,
    subscriptionRule: 'premium-hk',
    protocol: 'vless',
    label: 'Acme Premium VLESS',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: 'client-acme-premium',
        email: 'acme-premium@example.com',
        enabled: true,
        ...(overrideClient?.trafficMultiplier ? { trafficMultiplier: overrideClient.trafficMultiplier } : {}),
        trafficLimitBytes: 100 * GB,
        usedTrafficBytes: 12 * GB,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3
      }
    ],
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      sni: 'acme.example.com',
      fingerprint: 'chrome'
    },
    tls: {
      enabled: false,
      alpn: []
    },
    reality: {
      enabled: true,
      publicKey: 'public-key',
      shortIds: ['a1b2c3d4'],
      serverNames: ['acme.example.com']
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-test-inbound-001',
    ...overrides
  };
}

function createRuntimeTask(overrides: Partial<DeployTask> = {}): DeployTask {
  return {
    id: 'task-xray-apply-01',
    operation: 'inbound.update',
    resourceType: 'inbound',
    resourceId: 'inbound-premium-vless',
    status: 'succeeded',
    targetId: 'inbound-premium-vless',
    targetLabel: 'Acme Premium VLESS',
    summary: 'Update Acme Premium VLESS',
    createdAt: '2026-06-04T04:00:00.000Z',
    updatedAt: '2026-06-04T04:05:00.000Z',
    actor: 'admin',
    requestedBy: 'admin',
    requestId: 'req-task-xray-apply-01',
    sourceIp: '127.0.0.1',
    rollbackAvailable: true,
    rollbackTaskId: 'task-xray-rollback-01',
    attempts: 1,
    steps: [],
    metadata: {},
    ...overrides
  };
}

function createRuntimeCommand(overrides: Partial<CommandOutboxSummary> = {}): CommandOutboxSummary {
  return {
    id: 'outbox-task-xray-apply-01',
    taskId: 'task-xray-apply-01',
    commandId: 'cmd-task-xray-apply-01',
    agentId: 'agent-metered-01',
    seq: 1,
    status: 'completed',
    transport: 'http-pull',
    attempts: 1,
    createdAt: '2026-06-04T04:00:05.000Z',
    updatedAt: '2026-06-04T04:04:50.000Z',
    deadlineAt: '2026-06-04T04:10:00.000Z',
    ackedAt: '2026-06-04T04:00:10.000Z',
    resultAt: '2026-06-04T04:04:50.000Z',
    commandType: 'apply',
    ...overrides
  };
}

function createRuntimeConfigRevision(overrides: Partial<RuntimeConfigRevision> = {}): RuntimeConfigRevision {
  return {
    id: 'cfg-task-xray-apply-01',
    taskId: 'task-xray-apply-01',
    operation: 'inbound.update',
    targetId: 'inbound-premium-vless',
    targetLabel: 'Acme Premium VLESS',
    agentId: 'agent-metered-01',
    moduleKind: 'xray',
    artifactUri: 'memory://cfg-task-xray-apply-01',
    checksum: 'sha256:cfg-task-xray-apply-01',
    signature: 'sig-task-xray-apply-01',
    preflightPlanId: 'preflight-task-xray-apply-01',
    snapshotBeforeId: 'snapshot-task-xray-apply-01',
    status: 'applied',
    createdAt: '2026-06-04T04:00:00.000Z',
    createdBy: 'admin',
    appliedAt: '2026-06-04T04:04:50.000Z',
    diffSummary: {
      added: 0,
      changed: 1,
      removed: 0
    },
    artifact: {
      runtimeDiagnosis: {
        state: 'ready',
        evidenceStage: 'agent-result-verified'
      }
    },
    ...overrides
  };
}

function createRuntimePreflightPlan(overrides: Partial<RuntimePreflightPlan> = {}): RuntimePreflightPlan {
  return {
    id: 'preflight-task-xray-apply-01',
    taskId: 'task-xray-apply-01',
    configRevisionId: 'cfg-task-xray-apply-01',
    targetId: 'inbound-premium-vless',
    agentId: 'agent-metered-01',
    moduleKind: 'xray',
    status: 'passed',
    checks: [],
    createdAt: '2026-06-04T04:00:01.000Z',
    completedAt: '2026-06-04T04:00:03.000Z',
    ...overrides
  };
}

function createRuntimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    id: 'snapshot-task-xray-apply-01',
    taskId: 'task-xray-apply-01',
    targetId: 'inbound-premium-vless',
    targetLabel: 'Acme Premium VLESS',
    agentId: 'agent-metered-01',
    moduleKind: 'xray',
    reason: 'pre_apply',
    status: 'verified',
    checksum: 'sha256:snapshot-task-xray-apply-01',
    capturedAt: '2026-06-04T03:59:59.000Z',
    capturedBy: 'admin',
    verifiedAt: '2026-06-04T04:00:04.000Z',
    state: {},
    ...overrides
  };
}

function createCustomerNodeQuotaPolicy(overrides: Partial<QuotaPolicy> = {}): QuotaPolicy {
  return {
    id: 'customer-node:inbound-premium-vless:client-acme-premium',
    name: 'Acme Premium VLESS quota',
    scope: 'customer-node',
    limitBytes: 100 * GB,
    usedBytes: 12 * GB,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'disabled_by_quota',
    resourceId: 'inbound-premium-vless:client-acme-premium',
    detail: 'Acme Premium',
    resetDay: 1,
    reportedAt: '2026-06-05T10:10:00.000Z',
    ...overrides
  };
}

function createBetaInbound(overrides: Partial<XrayInbound> = {}): XrayInbound {
  return createInbound({
    id: 'inbound-beta-vless',
    label: 'Beta VLESS Edge',
    customerName: 'Beta Team',
    listenPort: 8443,
    clientIdentity: 'client-beta',
    subscriptionRule: 'beta-hk',
    clients: [
      {
        ...createInbound().clients[0],
        id: 'client-beta',
        email: 'beta@example.com'
      }
    ],
    ...overrides
  });
}

async function openHostAdvancedDetails(user: ReturnType<typeof userEvent.setup>, language: 'zh' | 'en' = 'zh') {
  await user.click(screen.getByRole('button', { name: language === 'zh' ? '展开高级详情' : 'Expand advanced details' }));
}

describe('NodesPage', () => {
  it('renders a host-focused operational overview band in the default workspace', () => {
    render(
      <NodesPage
        agents={[createAgent(), { ...createAgent(), id: 'agent-backup-02', name: 'Backup Host', status: 'degraded' }]}
        inbounds={[createInbound()]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Total Hosts')).toBeInTheDocument();
    expect(within(overview).getByText('Online Hosts')).toBeInTheDocument();
    expect(within(overview).getByText('Customer Nodes', { selector: 'p' })).toBeInTheDocument();
    expect(within(overview).queryByText(/Enroll host/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Check telemetry/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Apply config/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Rollback audit/)).not.toBeInTheDocument();
  });

  it('renders a customer-node operational overview band when the workspace is locked to customer nodes', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
        workspaceMode="customerNodes"
      />
    );

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Total Hosts')).toBeInTheDocument();
    expect(within(overview).getByText('Online Hosts')).toBeInTheDocument();
    expect(within(overview).getByText('Customer Nodes', { selector: 'p' })).toBeInTheDocument();
    expect(within(overview).queryByText(/Pick host/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Create node/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Copy subscription/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/Reset \/ renew/)).not.toBeInTheDocument();
  });

  it('keeps the nodes workspace focused on status and actions instead of explanatory workflow cards', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('主机总数')).toBeInTheDocument();
    expect(screen.getByText('在线主机')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成安装命令' })).toBeInTheDocument();
    expect(screen.queryByText('推荐操作路径')).not.toBeInTheDocument();
    expect(screen.queryByText('先让服务器上线并回传遥测')).not.toBeInTheDocument();
  });

  it('frames an empty host workspace as an operational control surface', () => {
    render(
      <NodesPage
        agents={[]}
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

    screen.getByRole('region', { name: '运营总览' });
    expect(screen.getByRole('region', { name: '主机空态' })).toHaveTextContent('先生成安装命令');
    expect(screen.getByRole('region', { name: '主机空态' })).not.toHaveTextContent('把第一台服务器接入 Master');
    expect(screen.getByRole('button', { name: '生成安装命令' })).toBeInTheDocument();
  });

  it('lays out managed hosts as a split workspace with a host rail and action detail pane', () => {
    render(
      <NodesPage
        agents={[createAgent(), { ...createAgent(), id: 'agent-backup-02', name: 'Backup Host', status: 'degraded' }]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByText('主机资源')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '操作详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择主机 Metered Host' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择主机 Backup Host' })).toBeInTheDocument();
  });

  it('shows a selected host detail panel before the host card grid', () => {
    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 86
            }
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: '当前主机' });

    expect(within(detail).getByText(/Metered Host/)).toBeInTheDocument();
    expect(within(detail).queryByRole('heading', { name: '当前主机' })).not.toBeInTheDocument();
    expect(within(detail).getByText('198.51.100.30')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: '应用主机设置' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: '编辑当前主机' })).toBeInTheDocument();
  });

  it('keeps host recovery and removal surfaces action-first without explanatory prose', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-poll-only-01',
            name: 'Poll Only Host',
            telemetry: {
              ...createAgent().telemetry,
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
        onPreviewAgentUpgradeCommand={vi.fn().mockResolvedValue({
          agentId: 'agent-poll-only-01',
          command: 'sudo ou-agent update',
          issuedAt: '2026-06-07T10:00:00.000Z',
          mode: 'update-runtime',
          requiresExistingRuntimeCredential: true,
          scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
        })}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    const advancedDetails = screen.getByRole('group', { name: '高级详情' });
    const hostCard = within(advancedDetails).getByRole('heading', { name: 'Poll Only Host' }).closest('article');
    expect(hostCard).not.toBeNull();
    expect(within(hostCard as HTMLElement).getByText('Agent 恢复')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByRole('button', { name: '复制升级命令' })).toBeInTheDocument();
    expect(hostCard).not.toHaveTextContent('Master 没有收到自动遥测');
    expect(hostCard).not.toHaveTextContent('新 Agent');
    expect(hostCard).not.toHaveTextContent('旧 Agent');

    await user.click(within(hostCard as HTMLElement).getByRole('button', { name: '移除主机' }));

    const dialog = screen.getByRole('dialog', { name: '移除受控主机' });
    expect(dialog).toHaveTextContent('主机别名');
    expect(dialog).toHaveTextContent('Poll Only Host');
    expect(dialog).not.toHaveTextContent('实际生产环境');
    expect(dialog).not.toHaveTextContent('可审计');
    expect(dialog).not.toHaveTextContent('客户节点绑定会一并移除');
  });

  it('surfaces registration and readiness evidence directly in the selected host panel', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            version: '1.2.3-agent',
            platform: 'linux-x64',
            runtimeHostName: 'edge-hkg-01',
            capabilities: ['host-agent', 'xray', 'telemetry', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapSeconds: 45,
              sampleGapReason: 'stale_telemetry_sample',
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
                }
              ]
            }
          },
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 86
            }
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: '当前主机' });

    expect(within(detail).getByText('edge-hkg-01')).toBeInTheDocument();
    expect(within(detail).getByText('1.2.3-agent')).toBeInTheDocument();
    expect(within(detail).getByText('linux-x64')).toBeInTheDocument();
    expect(within(detail).getByText('host-agent · xray · telemetry · self-update')).toBeInTheDocument();
    expect(within(detail).getByText('缺口 45秒')).toBeInTheDocument();
    expect(within(detail).getByText('1 异常 / 2')).toBeInTheDocument();
  });

  it('summarizes selected Agent onboarding readiness as explicit control-plane gates', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            capabilities: ['host-agent', 'xray', 'telemetry', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
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
                }
              ]
            }
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: '当前主机' });
    const readiness = within(detail).getByRole('region', { name: 'Agent 纳管就绪度' });

    expect(readiness).toHaveAttribute('data-agent-readiness-state', 'issues');
    expect(readiness.outerHTML).toContain('#1E3AFF');
    expect(readiness.outerHTML).toContain('#D9FF00');
    expect(readiness.outerHTML).not.toContain('amber-');
    expect(within(readiness).getByText('Agent 通道')).toBeInTheDocument();
    expect(within(readiness).getByText('在线')).toBeInTheDocument();
    expect(within(readiness).getByText('遥测采样')).toBeInTheDocument();
    expect(within(readiness).getByText('正常')).toBeInTheDocument();
    expect(within(readiness).getByText('运行服务')).toBeInTheDocument();
    expect(within(readiness).getByText('1 异常 / 2')).toBeInTheDocument();
  });

  it('keeps selected Agent readiness gates readable in the narrow action pane', () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            capabilities: ['host-agent', 'xray', 'telemetry', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapSeconds: 300,
              sampleGapReason: 'stale_telemetry_sample',
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
                  status: 'failed',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T04:00:00.000Z'
                }
              ]
            }
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: '当前主机' });
    const readiness = within(detail).getByRole('region', { name: 'Agent 纳管就绪度' });
    const gateGrid = readiness.querySelector('.nodes-agent-readiness-grid');

    expect(gateGrid).not.toBeNull();
    expect(gateGrid).toHaveClass('grid-cols-1', 'lg:grid-cols-3');
    expect(gateGrid).not.toHaveClass('sm:grid-cols-3');
    expect(within(readiness).getByText('Agent 通道')).not.toHaveClass('truncate');
    expect(within(readiness).getByText('运行服务')).not.toHaveClass('truncate');
    expect(within(readiness).getByText('2 异常 / 3')).not.toHaveClass('truncate');
  });

  it('localizes selected Agent onboarding readiness gates in English', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: 'Selected host' });
    const readiness = within(detail).getByRole('region', { name: 'Agent onboarding readiness' });

    expect(readiness).toHaveAttribute('data-agent-readiness-state', 'ready');
    expect(within(readiness).getByText('Agent Link')).toBeInTheDocument();
    expect(within(readiness).getByText('Online')).toBeInTheDocument();
    expect(within(readiness).getByText('Telemetry')).toBeInTheDocument();
    expect(within(readiness).getByText('Normal')).toBeInTheDocument();
    expect(within(readiness).getByText('Runtime Services')).toBeInTheDocument();
    expect(within(readiness).getByText('All Healthy')).toBeInTheDocument();
  });

  it('renders managed host cards as light-first control surfaces instead of dark gradient shells', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    const hostCard = screen.getByRole('heading', { name: 'Metered Host' }).closest('article');

    expect(hostCard).not.toBeNull();
    expect(hostCard).toHaveClass('island-card');
    expect(hostCard).not.toHaveClass('bg-[linear-gradient(145deg,rgba(30,35,45,0.45)_0%,rgba(15,18,25,0.75)_100%)]');
    expect(hostCard).not.toHaveClass('text-white/85');
  });

  it('switches the detail pane when an operator chooses a host from the resource rail', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 86
            }
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const detail = screen.getByRole('region', { name: '当前主机' });
    expect(within(detail).getByText('198.51.100.30')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '切换到其他主机 Secondary Host' }));

    expect(within(detail).getByText('203.0.113.8')).toBeInTheDocument();
    expect(within(detail).queryByText('198.51.100.30')).not.toBeInTheDocument();
  });

  it('shows remaining hosts as a thin list beside the selected host detail instead of another card wall', () => {
    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            status: 'degraded'
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const related = screen.getByRole('region', { name: '其他主机' });
    expect(within(related).getByText('203.0.113.8')).toBeInTheDocument();
    expect(within(related).getByText('降级')).toBeInTheDocument();
  });

  it('gives the host workspace a v2 cockpit visual system with tactile selection states', () => {
    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            status: 'degraded'
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const hostRail = screen.getByRole('complementary', { name: '主机资源' });
    const selectedHost = within(hostRail).getByRole('button', { name: '选择主机 Metered Host' });
    const otherHosts = screen.getByRole('region', { name: '其他主机' });
    const otherHost = within(otherHosts).getByRole('button', { name: '切换到其他主机 Secondary Host' });
    const selectedDetail = screen.getByRole('region', { name: '当前主机' });

    expect(hostRail).toHaveClass('nodes-cockpit-rail');
    expect(selectedHost).toHaveClass('nodes-host-pill-active');
    expect(otherHost).toHaveClass('nodes-host-thin-row');
    expect(selectedDetail).toHaveClass('nodes-current-host-hero');
  });

  it('uses the fauvist control-plane palette instead of cyan in the advanced host cockpit', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            status: 'provisioning',
            capabilities: ['host-agent', 'xray', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapReason: 'stale_telemetry_sample',
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onRemoteAgentUpgrade={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    const hostCard = screen.getByRole('heading', { name: 'Metered Host' }).closest('article');
    expect(hostCard).not.toBeNull();
    const hostCockpitMarkup = (hostCard as HTMLElement).outerHTML;

    expect(hostCockpitMarkup).toContain('#1E3AFF');
    expect(hostCockpitMarkup).toContain('#FF3D18');
    expect(hostCockpitMarkup).toContain('#D9FF00');
    expect(hostCockpitMarkup).not.toContain('sky-');
    expect(hostCockpitMarkup).not.toContain('indigo-');
    expect(hostCockpitMarkup).not.toContain('cyan-');
    expect(hostCockpitMarkup).not.toContain('purple-');
    expect(hostCockpitMarkup).not.toContain('violet-');
    expect(hostCockpitMarkup).not.toContain('background-clip:text');
  });

  it('uses acid chartreuse instead of amber for managed host runtime caution states', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            status: 'degraded',
            telemetry: {
              ...createAgent().telemetry,
              latencyMs: 160,
              latencyStatus: 'yellow',
              latencySamplesMs: [42, 160],
              packetLossPercent: 3,
              packetLossSamplesPercent: [0, 3],
              sampleGapDetected: true,
              sampleGapReason: 'stale_telemetry_sample',
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30,
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
                }
              ]
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

    await openHostAdvancedDetails(user, 'en');

    const hostCard = screen.getByRole('heading', { name: 'Metered Host' }).closest('article');
    expect(hostCard).not.toBeNull();
    const hostCockpitMarkup = (hostCard as HTMLElement).outerHTML;

    expect(within(hostCard as HTMLElement).getByText('Degraded')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('Missing')).toBeInTheDocument();
    expect(hostCockpitMarkup).toContain('#D9FF00');
    expect(hostCockpitMarkup).not.toContain('amber-');
  });

  it('frames the first workspace switch as a cockpit control bar with workspace tabs and action lanes', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByRole('region', { name: '运营总览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '受控主机' })).toHaveClass('nodes-workspace-tab');
    expect(screen.getByRole('button', { name: '客户节点' })).toHaveClass('nodes-workspace-tab');
    expect(screen.getByRole('button', { name: '生成安装命令' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '主机资源' })).toHaveClass('nodes-cockpit-rail');
    expect(screen.getByRole('region', { name: '当前主机' })).toBeInTheDocument();
  });

  it('keeps the Nodes overview compact without explanatory copy or generic blue tab styling', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: '运营总览' });
    const switcher = overview.querySelector('.nodes-workspace-switcher');
    const activeTab = within(overview).getByRole('button', { name: '受控主机' });
    const inactiveTab = within(overview).getByRole('button', { name: '客户节点' });

    expect(within(overview).queryByText(/主控端可纳管任意数量服务器/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/先看纳管规模/)).not.toBeInTheDocument();
    expect(activeTab).toHaveClass('nodes-workspace-tab-active', 'border-[#07111F]', 'bg-[#1E3AFF]');
    expect(activeTab).not.toHaveClass('rounded-full', 'bg-blue-500', 'shadow-blue-500/20');
    expect(inactiveTab).toHaveClass('border-[#07111F]/25', 'bg-[#FFFDF5]', 'text-[#35405A]');
    expect(switcher?.outerHTML).not.toContain('bg-blue');
    expect(switcher?.outerHTML).not.toContain('text-blue');
    expect(switcher?.outerHTML).not.toContain('shadow-blue');
    expect(switcher?.outerHTML).not.toContain('border-slate');
    expect(switcher?.outerHTML).not.toContain('text-slate');
    expect(switcher?.outerHTML).not.toContain('bg-slate');
    expect(switcher?.outerHTML).not.toContain('rounded-full');
  });

  it('uses the fauvist control-plane palette across the host cockpit workspace', () => {
    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            status: 'degraded'
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const hostRail = screen.getByRole('complementary', { name: '主机资源' });
    const selectedHost = within(hostRail).getByRole('button', { name: '选择主机 Metered Host' });
    const searchFilter = screen.getByLabelText('搜索主机').closest('label');
    const selectedDetail = screen.getByRole('region', { name: '当前主机' });
    const selectedStatus = within(selectedDetail).getByText('在线', { selector: 'span' });
    const otherHosts = screen.getByRole('region', { name: '其他主机' });
    const otherHost = within(otherHosts).getByRole('button', { name: '切换到其他主机 Secondary Host' });
    const advancedDetails = screen.getByRole('group', { name: '高级详情' });
    const advancedToggle = screen.getByRole('button', { name: '展开高级详情' });

    expect(hostRail).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(searchFilter).toHaveClass('border-[#07111F]/25', 'bg-[#FFFDF5]');
    expect(selectedHost).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]', 'text-[#07111F]');
    expect(selectedDetail).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]/70');
    expect(selectedStatus).toHaveClass('border-[#00A878]', 'text-[#007D5E]');
    expect(otherHosts).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(otherHost).toHaveClass('hover:bg-[#DCE1FF]/55');
    expect(advancedDetails).toHaveClass('border-[#07111F]', 'bg-[#FFFDF5]');
    expect(advancedToggle).toHaveClass('border-[#D9FF00]', 'bg-[#D9FF00]/[0.22]', 'text-[#07111F]');
  });

  it('keeps the host workspace compact in fixed grids instead of oversized card bands', () => {
    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            status: 'degraded'
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: '运营总览' });
    const controlBand = overview.querySelector('.nodes-control-band');
    const summaryGrid = overview.querySelector('.nodes-summary-metric-grid');
    const firstSummaryMetric = overview.querySelector('.nodes-summary-metric');
    const hostRail = screen.getByRole('complementary', { name: '主机资源' });
    const selectedDetail = screen.getByRole('region', { name: '当前主机' });
    const currentMetricGrid = selectedDetail.querySelector('.nodes-current-host-metric-grid');
    const inventoryGrid = selectedDetail.querySelector('.nodes-current-host-inventory-grid');
    const hostWorkspaceHtml = `${overview.outerHTML}${hostRail.outerHTML}${selectedDetail.outerHTML}`;

    expect(controlBand).toHaveClass('p-3');
    expect(controlBand).not.toHaveClass('p-4');
    expect(controlBand).not.toHaveClass('p-5');
    expect(summaryGrid).toHaveClass('grid-cols-3');
    expect(firstSummaryMetric).toHaveClass('min-h-[76px]', 'p-3');
    expect(hostRail).toHaveClass('p-3', 'xl:max-w-[18rem]');
    expect(selectedDetail).toHaveClass('p-3');
    expect(currentMetricGrid).toHaveClass('grid-cols-1', 'md:grid-cols-3');
    expect(inventoryGrid).toHaveClass('grid-cols-2', 'xl:grid-cols-3');
    expect(currentMetricGrid?.outerHTML).toContain('nodes-compact-info-field');
    expect(currentMetricGrid?.outerHTML).toContain('min-h-[58px]');
    expect(inventoryGrid?.outerHTML).toContain('nodes-compact-info-field');
    expect(hostWorkspaceHtml).not.toContain('masonry');
    expect(hostWorkspaceHtml).not.toContain('columns-');
    expect(hostWorkspaceHtml).not.toContain('grid-flow-row-dense');
    expect(hostWorkspaceHtml).not.toContain('row-span');
    expect(hostWorkspaceHtml).not.toContain('col-span-2');
  });

  it('keeps Nodes control and customer surfaces compact without oversized padding shells', () => {
    const { rerender } = render(
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

    const overview = screen.getByRole('region', { name: '运营总览' });
    const controlBand = overview.querySelector('.nodes-control-band');
    const advancedDetails = screen.getByRole('group', { name: '高级详情' });
    const advancedHeader = advancedDetails.querySelector('.nodes-advanced-details-header');

    expect(controlBand).toHaveClass('p-3');
    expect(controlBand).not.toHaveClass('p-4', 'p-5');
    expect(advancedHeader).toHaveClass('p-3');
    expect(advancedHeader).not.toHaveClass('p-4', 'p-5');

    rerender(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const customerWorkspace = screen.getByRole('region', { name: '客户节点配置' });
    const customerHeader = customerWorkspace.querySelector('.nodes-customer-workspace-header');
    const customerFilterBar = customerWorkspace.querySelector('.nodes-customer-filter-bar');
    const populatedSurfaceHtml = customerWorkspace.outerHTML;

    expect(customerHeader).toHaveClass('p-3');
    expect(customerHeader).not.toHaveClass('p-5');
    expect(customerFilterBar).toHaveClass('p-3');
    expect(customerFilterBar).not.toHaveClass('p-4');
    expect(customerWorkspace.querySelector('.nodes-customer-node-table')).toHaveClass('min-w-[860px]');
    expect(customerWorkspace.querySelector('.nodes-customer-node-row-cell')).toHaveClass('px-3', 'py-2.5');
    expect(customerWorkspace.outerHTML).not.toContain('px-5 py-4');

    rerender(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const emptyCustomerWorkspace = screen.getByRole('region', { name: '客户节点配置' });
    const customerEmptyState = screen.getByText('暂无客户节点配置').closest('.nodes-empty-state');
    const compactSurfaceHtml = `${populatedSurfaceHtml}${emptyCustomerWorkspace.outerHTML}`;

    expect(customerEmptyState).toHaveClass('p-3');
    expect(customerEmptyState).not.toHaveClass('p-8', 'p-6');
    expect(compactSurfaceHtml).not.toContain('p-5');
    expect(compactSurfaceHtml).not.toContain('p-6');
    expect(compactSurfaceHtml).not.toContain('masonry');
    expect(compactSurfaceHtml).not.toContain('columns-');
    expect(compactSurfaceHtml).not.toContain('grid-flow-row-dense');
    expect(compactSurfaceHtml).not.toContain('row-span');
  });

  it('uses the OU node surface vocabulary for customer tables, bulk controls, and drawer fields', async () => {
    const user = userEvent.setup();
    const longNodeName = 'Very Long Customer Node Name That Should Wrap Across The Control Plane Surface Without Escaping Its Cell';
    const longSubscriptionRule = 'subscription-rule-with-a-very-long-token-that-must-break-inside-the-table-cell';
    const longInbound = createInbound({
      label: longNodeName,
      customerName: 'Very Long Enterprise Customer Name With 中文字符 And English Segments',
      subscriptionRule: longSubscriptionRule
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[longInbound]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const customerWorkspace = screen.getByRole('region', { name: '客户节点配置' });
    const customerHtml = customerWorkspace.outerHTML;
    const firstRow = customerWorkspace.querySelector('.nodes-customer-node-row');
    const nodeName = screen.getByText(longNodeName);
    const subscriptionRule = screen.getByText(longSubscriptionRule);
    const actionButton = customerWorkspace.querySelector('.nodes-node-action-button');

    expect(customerWorkspace.querySelector('.nodes-customer-filter-bar')).toHaveClass(
      'border-[#07111F]/16',
      'bg-[#EAF3D1]/45'
    );
    expect(customerWorkspace.querySelector('.nodes-customer-node-table')).toHaveClass('min-w-[860px]');
    expect(firstRow).toHaveClass('hover:bg-[#DCE1FF]/42');
    expect(nodeName).toHaveClass('[overflow-wrap:anywhere]');
    expect(subscriptionRule).toHaveClass('break-all');
    expect(actionButton).toHaveClass('border-[#07111F]/18', 'text-[#35405A]');
    expect(actionButton).not.toHaveClass('rounded-lg', 'text-slate-500', 'hover:text-blue-600');
    expect(customerHtml).not.toContain('border-slate-200');
    expect(customerHtml).not.toContain('bg-slate-');
    expect(customerHtml).not.toContain('text-slate-');
    expect(customerHtml).not.toContain('text-blue-');
    expect(customerHtml).not.toContain('border-red-');
    expect(customerHtml).not.toContain('rounded-lg');

    await user.click(screen.getByRole('button', { name: '新增客户节点' }));

    const dialog = screen.getByRole('dialog', { name: '新增客户节点' });
    const drawerField = dialog.querySelector('.nodes-drawer-field');

    expect(drawerField).toHaveClass('border-[#07111F]/18', 'bg-[#FFFDF5]/76');
    expect(drawerField).not.toHaveClass('rounded-lg', 'border-slate-200');
  });

  it('opens advanced host diagnostics as a compact fixed grid without a card wall', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          createAgent(),
          {
            ...createAgent(),
            id: 'agent-secondary-01',
            name: 'Secondary Host',
            publicAddress: '203.0.113.8',
            status: 'degraded'
          },
          {
            ...createAgent(),
            id: 'agent-provisioning-03',
            name: 'Provisioning Host',
            publicAddress: '203.0.113.9',
            status: 'provisioning'
          }
        ]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    const advancedDetails = screen.getByRole('group', { name: '高级详情' });
    const advancedGrid = advancedDetails.querySelector('.nodes-advanced-host-grid');
    const firstHostCard = within(advancedDetails).getByRole('heading', { name: 'Metered Host' }).closest('article');

    expect(advancedGrid).not.toBeNull();
    expect(advancedGrid).toHaveClass('gap-3', 'md:grid-cols-2');
    expect(advancedGrid).not.toHaveClass('gap-5', '2xl:grid-cols-3', 'xl:grid-cols-2');
    expect(firstHostCard).toHaveClass('nodes-managed-host-card', 'p-3', 'gap-3');
    expect(firstHostCard).not.toHaveClass('max-w-[24rem]', 'p-5', 'gap-4');
    expect(advancedGrid?.outerHTML).not.toContain('masonry');
    expect(advancedGrid?.outerHTML).not.toContain('columns-');
    expect(advancedGrid?.outerHTML).not.toContain('grid-flow-row-dense');
    expect(advancedGrid?.outerHTML).not.toContain('row-span');
    expect(advancedGrid?.outerHTML).not.toContain('col-span');
  });

  it('collapses the full managed host card stack into advanced details by default', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const advancedDetails = screen.getByRole('group', { name: '高级详情' });
    expect(advancedDetails).toHaveClass('nodes-advanced-details');
    expect(screen.getByRole('button', { name: '展开高级详情' })).toBeInTheDocument();
    expect(within(advancedDetails).queryByRole('heading', { name: 'Metered Host' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开高级详情' }));

    expect(within(advancedDetails).getByRole('heading', { name: 'Metered Host' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起高级详情' })).toBeInTheDocument();
  });

  it('shows provisioning hosts with registration version, platform, and capabilities before telemetry arrives', async () => {
    const user = userEvent.setup();

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

    await openHostAdvancedDetails(user);

    const hostCard = screen.getByRole('heading', { name: 'Provisioning Host' }).closest('article');

    expect(hostCard).not.toBeNull();
    expect(within(hostCard as HTMLElement).getByText('纳管中')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('edge-hkg-01')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('1.2.3-agent')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('linux-x64')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('host-agent')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('xray')).toBeInTheDocument();
    expect(within(hostCard as HTMLElement).getByText('port-forwarding')).toBeInTheDocument();
    expect(screen.getAllByText('等待 Agent 遥测').length).toBeGreaterThan(0);
  });

  it('normalizes an empty host expiry before saving a poll-only Agent profile', async () => {
    const user = userEvent.setup();
    const onSaveHostConfig = vi.fn();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-poll-only-01',
            name: 'Poll Only Host',
            expiresAt: '',
            telemetry: {
              ...createAgent().telemetry,
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
        onSaveHostConfig={onSaveHostConfig}
      />
    );

    await openHostAdvancedDetails(user);

    await user.click(screen.getByRole('button', { name: '编辑主机' }));
    const dialog = screen.getByRole('dialog', { name: '编辑主机' });
    expect(dialog).not.toHaveTextContent('可用于补录历史用量');
    expect(dialog).not.toHaveTextContent('后台每 30 秒监测一次');

    await user.clear(screen.getByLabelText('主机别名'));
    await user.type(screen.getByLabelText('主机别名'), 'poll-only-renamed');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSaveHostConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-poll-only-01',
          displayName: 'poll-only-renamed',
          expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        })
      );
    });
  });

  it('offers a copyable runtime upgrade command for poll-only hosts', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onPreviewAgentUpgradeCommand = vi.fn().mockResolvedValue({
      agentId: 'agent-poll-only-01',
      command: 'sudo ou-agent update',
      issuedAt: '2026-06-07T10:00:00.000Z',
      mode: 'update-runtime',
      requiresExistingRuntimeCredential: true,
      scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
    });

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-poll-only-01',
            name: 'Poll Only Host',
            telemetry: {
              ...createAgent().telemetry,
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
        onPreviewAgentUpgradeCommand={onPreviewAgentUpgradeCommand}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    await user.click(screen.getByRole('button', { name: '复制升级命令' }));

    await waitFor(() => {
      expect(onPreviewAgentUpgradeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-poll-only-01' }),
        'no_telemetry_sample'
      );
      expect(writeText).toHaveBeenCalledWith('sudo ou-agent update');
    });
    expect(screen.getByText('升级命令已生成并复制')).toBeInTheDocument();
    expect(screen.getByText('sudo ou-agent update')).toBeInTheDocument();
  });

  it('offers one-click remote recovery for Agents with self-update capability', async () => {
    const user = userEvent.setup();
    const onRemoteAgentUpgrade = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-self-update-01',
            name: 'Self Update Host',
            capabilities: ['host-agent', 'xray', 'self-update'],
            telemetry: {
              ...createAgent().telemetry,
              sampleGapDetected: true,
              sampleGapReason: 'stale_telemetry_sample',
              sampleGapSeconds: 300,
              expectedSamplingIntervalSeconds: 30
            }
          }
        ]}
        inbounds={[]}
        language="zh"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onRemoteAgentUpgrade={onRemoteAgentUpgrade}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await openHostAdvancedDetails(user);

    await user.click(screen.getByRole('button', { name: '远程升级 Agent' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认远程升级 Agent Self Update Host'));
    expect(onRemoteAgentUpgrade).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '远程升级 Agent' }));

    expect(onRemoteAgentUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-self-update-01' }),
      'stale_telemetry_sample'
    );
    expect(screen.queryByRole('button', { name: '复制升级命令' })).not.toBeInTheDocument();
  });

  it('shows monthly host usage as manual backfill plus Agent metered traffic', async () => {
    const user = userEvent.setup();

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

    await openHostAdvancedDetails(user);

    expect(screen.getByText('8.0 GB / 20GB')).toBeInTheDocument();
  });

  it('surfaces telemetry sampling gaps on managed host cards', async () => {
    const user = userEvent.setup();

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

    await openHostAdvancedDetails(user, 'en');

    const hostCard = screen.getByRole('heading', { name: 'Metered Host' }).closest('article');
    expect(hostCard).not.toBeNull();
    const recoveryPanel = within(hostCard as HTMLElement).getByText('Agent Recovery').closest('.space-y-2');

    expect(recoveryPanel).not.toBeNull();
    expect((recoveryPanel as HTMLElement).outerHTML).toContain('#D9FF00');
    expect((recoveryPanel as HTMLElement).outerHTML).not.toContain('amber-');
    expect(screen.getAllByText('Gap 5.0min').length).toBeGreaterThan(0);
  });

  it('shows a no-sample gap after the first telemetry window instead of waiting indefinitely', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            telemetry: {
              ...createAgent().telemetry,
              reportedAt: undefined,
              sampleGapDetected: true,
              sampleGapSeconds: 30,
              expectedSamplingIntervalSeconds: 1,
              sampleGapReason: 'no_telemetry_sample'
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

    await openHostAdvancedDetails(user);

    expect(screen.getAllByText('无样本 30秒').length).toBeGreaterThan(0);
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

    await openHostAdvancedDetails(user, 'en');

    expect(screen.getAllByText('1 Issues / 3').length).toBeGreaterThan(0);
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Xray')).toBeInTheDocument();
    expect(screen.getByText('Forwarding')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Missing').closest('div')).toHaveClass(
      'border-[#D9FF00]',
      'bg-[#D9FF00]/[0.18]',
      'text-[#07111F]',
      'dark:border-[#E9FF6A]/25',
      'dark:bg-[#E9FF6A]/10',
      'dark:text-[#F4FFC5]'
    );

    await user.click(screen.getByText('Metered Host'));

    expect(screen.getAllByText('0.42 / 0.35 / 0.31').length).toBeGreaterThan(0);
    expect(screen.getByText(/ou-ui-xray\.service: Missing/)).toBeInTheDocument();
    expect(screen.getByText('Guardrail Stopped')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-tcp.service')).toBeInTheDocument();
    expect(screen.getByText('Guardrail Restored')).toBeInTheDocument();
    expect(screen.getByText('ou-forward-forward-custom-2443-agent-edge-01-udp.service')).toBeInTheDocument();
  });

  it('filters managed hosts by search text, status, capability, and runtime service issues before opening diagnostics', async () => {
    const user = userEvent.setup();
    const brokenXrayHost: Agent = {
      ...createAgent(),
      id: 'agent-xray-broken-01',
      name: 'Broken Xray Edge',
      status: 'degraded',
      publicAddress: '203.0.113.10',
      capabilities: ['host-agent', 'xray', 'telemetry', 'command-channel'],
      telemetry: {
        ...createAgent().telemetry,
        latencyMs: 230,
        latencyStatus: 'red',
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
            status: 'failed',
            enabled: true,
            required: true,
            checkedAt: '2026-06-04T04:00:00.000Z',
            detail: 'exit status 1'
          }
        ]
      }
    };
    const healthyForwardingHost: Agent = {
      ...createAgent(),
      id: 'agent-forwarding-healthy-01',
      name: 'Healthy Forwarding Edge',
      capabilities: ['host-agent', 'port-forwarding', 'telemetry', 'command-channel']
    };

    render(
      <NodesPage
        agents={[brokenXrayHost, healthyForwardingHost]}
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

    await user.type(screen.getByRole('searchbox', { name: 'Search Hosts' }), 'xray');
    await user.selectOptions(screen.getByLabelText('Host Status'), 'degraded');
    await user.selectOptions(screen.getByLabelText('Capability'), 'xray');
    await user.selectOptions(screen.getByLabelText('Runtime Health'), 'issues');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    await openHostAdvancedDetails(user, 'en');

    expect(screen.getByText('Broken Xray Edge')).toBeInTheDocument();
    expect(screen.queryByText('Healthy Forwarding Edge')).not.toBeInTheDocument();

    await user.click(screen.getByText('Broken Xray Edge'));

    expect(screen.getByRole('dialog', { name: 'Edit Host' })).toBeInTheDocument();
    expect(screen.getByText(/ou-ui-xray\.service: Failed/)).toBeInTheDocument();
  });

  it('filters customer nodes by search text, protocol, host, and status before editing an inbound', async () => {
    const user = userEvent.setup();
    const meteredHost = createAgent();
    const backupHost = {
      ...createAgent(),
      id: 'agent-backup-02',
      name: 'Backup Host',
      publicAddress: '198.51.100.31'
    };

    render(
      <NodesPage
        agents={[meteredHost, backupHost]}
        inbounds={[
          createInbound(),
          createInbound({
            id: 'inbound-beta-trojan',
            agentId: 'agent-backup-02',
            customerName: 'Beta Team',
            label: 'Beta Trojan Backup',
            protocol: 'trojan',
            listenPort: 8443,
            status: 'disabled',
            subscriptionRule: 'beta-backup',
            clients: [
              {
                ...createInbound().clients[0],
                id: 'client-beta',
                email: 'beta@example.com',
                enabled: false
              }
            ],
            streamSettings: {
              network: 'ws',
              security: 'tls',
              sni: 'beta.example.com',
              path: '/beta'
            },
            reality: {
              enabled: false,
              shortIds: [],
              serverNames: []
            },
            tls: {
              enabled: true,
              certificateId: 'cert-beta',
              alpn: ['h2']
            }
          })
        ]}
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

    await user.type(screen.getByRole('searchbox', { name: 'Search Customer Nodes' }), 'beta');
    await user.selectOptions(screen.getByLabelText('Protocol'), 'trojan');
    await user.selectOptions(screen.getByLabelText('Assigned Host'), 'agent-backup-02');
    await user.selectOptions(screen.getByLabelText('Node Status'), 'disabled');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Beta Trojan Backup')).toBeInTheDocument();
    expect(screen.queryByText('Acme Premium VLESS')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit Customer Node' });
    expect(within(dialog).getAllByLabelText('Inbound Port')[0]).toHaveValue(8443);
    expect(within(dialog).getByLabelText('Customer Node Name')).toHaveValue('Beta Trojan Backup');
  });

  it('copies customer node single-node and subscription links from the inbound row', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
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

    await user.click(screen.getByRole('button', { name: 'Copy Single-node Link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^vless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`))
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('vless://client-acme-premium@'));

    await user.click(screen.getByRole('button', { name: 'Copy Subscription Link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/[a-z0-9]+\/clash\/premium-hk$/)
    );
  });

  it('bulk copies selected customer node links from the filtered inbound table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound(),
          createBetaInbound()
        ]}
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

    await user.click(screen.getByRole('checkbox', { name: 'Select Acme Premium VLESS' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta VLESS Edge' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Links' }));

    const copiedLinks = writeText.mock.calls[0]?.[0] as string;
    expect(copiedLinks).toMatch(new RegExp(`Acme Premium VLESS\\nvless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`, 's'));
    expect(copiedLinks).toMatch(new RegExp(`Beta VLESS Edge\\nvless://${UUID_IN_LINK}@198\\.51\\.100\\.30:8443\\?`, 's'));
    expect(copiedLinks).not.toContain('vless://client-');
  });

  it('shows a bulk impact preflight for selected customer nodes before risky actions', async () => {
    const user = userEvent.setup();
    const backupHost = {
      ...createAgent(),
      id: 'agent-backup-02',
      name: 'Backup Host',
      publicAddress: '198.51.100.31'
    };

    render(
      <NodesPage
        agents={[createAgent(), backupHost]}
        inbounds={[
          createInbound(),
          createBetaInbound({
            agentId: 'agent-backup-02',
            clients: [
              {
                ...createBetaInbound().clients[0],
                enabled: false,
                expiresAt: '2026-06-10T00:00:00.000Z',
                trafficLimitBytes: 50 * GB,
                usedTrafficBytes: 55 * GB
              }
            ],
            remainingDays: 2,
            status: 'disabled'
          })
        ]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: '选择 Acme Premium VLESS' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 Beta VLESS Edge' }));

    const preflight = screen.getByRole('region', { name: '客户节点批量影响预检' });
    expect(preflight.outerHTML).toContain('#1E3AFF');
    expect(preflight.outerHTML).toContain('#FF3D18');
    expect(preflight.outerHTML).toContain('#D9FF00');
    expect(preflight.outerHTML).not.toContain('sky-');
    expect(preflight.outerHTML).not.toContain('indigo-');
    expect(preflight.outerHTML).not.toContain('cyan-');
    expect(preflight.outerHTML).not.toContain('purple-');
    expect(preflight.outerHTML).not.toContain('violet-');
    expect(preflight.outerHTML).not.toContain('amber-');
    expect(preflight.outerHTML).not.toContain('rose-');
    expect(preflight.outerHTML).not.toContain('background-clip:text');
    expect(within(preflight).getByText('受影响客户 2')).toBeInTheDocument();
    expect(within(preflight).getByText('受控主机 2')).toBeInTheDocument();
    expect(within(preflight).getByText('入站端口 2')).toBeInTheDocument();
    expect(within(preflight).getByText('守护风险 1')).toBeInTheDocument();
    expect(within(preflight).getByText('已过期/即将到期 1')).toBeInTheDocument();
    expect(within(preflight).getByText('已停用 1')).toBeInTheDocument();
    expect(preflight).not.toHaveTextContent('基于已选客户节点');

    const customerPreview = within(preflight).getByText('客户预览').closest('div');
    const nodePreview = within(preflight).getByText('节点预览').closest('div');
    const riskPreview = within(preflight).getByText('风险提示').closest('div');
    expect(customerPreview).not.toBeNull();
    expect(nodePreview).not.toBeNull();
    expect(riskPreview).not.toBeNull();
    expect(within(customerPreview as HTMLElement).getByText('Acme Premium')).toBeInTheDocument();
    expect(within(customerPreview as HTMLElement).getByText('Beta Team')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('Acme Premium VLESS')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('Beta VLESS Edge')).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/Beta VLESS Edge/)).toBeInTheDocument();
    expect((riskPreview as HTMLElement).outerHTML).toContain('#FF3D18');
    expect((riskPreview as HTMLElement).outerHTML).not.toContain('amber-');
    expect((riskPreview as HTMLElement).outerHTML).not.toContain('rose-');
  });

  it('uses the primary blue control-plane palette for customer-node bulk reset controls', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
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

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));

    const resetUsedTrafficButton = screen.getByRole('button', { name: 'Bulk Reset Used Traffic' });
    expect(resetUsedTrafficButton.outerHTML).not.toContain('cyan-');
    expect(resetUsedTrafficButton).toHaveClass('border-[#1E3AFF]/35');
    expect(resetUsedTrafficButton).toHaveClass('text-[#1E3AFF]');
  });

  it('confirms before bulk resetting selected customer node traffic policies from the filtered inbound table', async () => {
    const user = userEvent.setup();
    const onResetCustomerNodeTraffic = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeQuotaPolicy = createCustomerNodeQuotaPolicy();
    const betaQuotaPolicy = createCustomerNodeQuotaPolicy({
      id: 'customer-node:inbound-beta-vless:client-beta',
      name: 'Beta VLESS Edge quota',
      resourceId: 'inbound-beta-vless:client-beta',
      detail: 'Beta Team'
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound(),
          createBetaInbound()
        ]}
        language="en"
        quotaPolicies={[acmeQuotaPolicy, betaQuotaPolicy]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={onResetCustomerNodeTraffic}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset traffic for 2 selected customer nodes'));
    expect(onResetCustomerNodeTraffic).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Traffic' }));

    expect(onResetCustomerNodeTraffic).toHaveBeenCalledTimes(2);
    expect(onResetCustomerNodeTraffic).toHaveBeenNthCalledWith(1, acmeQuotaPolicy);
    expect(onResetCustomerNodeTraffic).toHaveBeenNthCalledWith(2, betaQuotaPolicy);
  });

  it('confirms before bulk updating selected customer node enabled state, traffic quota, and remaining days', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    const bulkDisableButton = screen.getByRole('button', { name: 'Bulk Disable' });

    expect(bulkDisableButton.outerHTML).toContain('#FF3D18');
    expect(bulkDisableButton.outerHTML).not.toContain('amber-');
    expect(bulkDisableButton.outerHTML).not.toContain('rose-');
    await user.click(bulkDisableButton);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Disable 2 selected customer nodes'));
    expect(onSaveCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Disable' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Bulk Add Traffic GB' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Bulk Add Traffic GB' }), '50');
    await user.click(screen.getByRole('button', { name: 'Bulk Add Traffic' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Bulk Renew Days' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Bulk Renew Days' }), '15');
    await user.click(screen.getByRole('button', { name: 'Bulk Renew' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Enable' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Add 50 GB to 2 selected customer nodes'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Renew 2 selected customer nodes by 15 days'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Enable 2 selected customer nodes'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: false
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        trafficLimitGb: 150
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        remainingDays: 45,
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: true
      }),
      'update'
    );
    expect(onSaveCustomerNode.mock.calls.filter((call) => call[0].nodeId === 'inbound-beta-vless')).toHaveLength(4);
  });

  it('updates a single customer node from the simplified row actions', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Traffic' }));
    await user.click(screen.getByRole('button', { name: 'Renew' }));
    await user.click(screen.getByRole('button', { name: 'Disable Node' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Disable Node 1 selected customer node'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        trafficLimitGb: 200
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        remainingDays: 60,
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      }),
      'update'
    );
    expect(onSaveCustomerNode).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), 'update');

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Disable Node' }));

    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        enabled: false
      }),
      'update'
    );
  });

  it('confirms before bulk resetting used traffic and changing reset policy for selected customer nodes', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Used Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset used traffic for 2 selected customer nodes'));
    expect(onSaveCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Reset Used Traffic' }));
    await user.selectOptions(screen.getByLabelText('Bulk Reset Policy'), 'monthly');
    await user.click(screen.getByRole('button', { name: 'Apply Reset Policy' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Apply monthly reset policy to 2 selected customer nodes'));
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        currentUsedTrafficGb: 0
      }),
      'update'
    );
    expect(onSaveCustomerNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'inbound-premium-vless',
        resetPolicy: 'monthly'
      }),
      'update'
    );
    expect(onSaveCustomerNode.mock.calls.filter((call) => call[0].nodeId === 'inbound-beta-vless')).toHaveLength(2);
  });

  it('requires confirmation before bulk deleting selected customer nodes', async () => {
    const user = userEvent.setup();
    const onDeleteCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={onDeleteCustomerNode}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Customer Nodes' }));
    const bulkDeleteButton = screen.getByRole('button', { name: 'Bulk Delete' });

    expect(bulkDeleteButton.outerHTML).toContain('#DC2626');
    expect(bulkDeleteButton.outerHTML).not.toContain('red-');
    expect(bulkDeleteButton.outerHTML).not.toContain('rose-');
    await user.click(bulkDeleteButton);

    expect(onDeleteCustomerNode).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Delete 2 Nodes' }));

    expect(onDeleteCustomerNode).toHaveBeenCalledTimes(2);
    expect(onDeleteCustomerNode).toHaveBeenNthCalledWith(1, expect.objectContaining({ nodeId: 'inbound-premium-vless' }));
    expect(onDeleteCustomerNode).toHaveBeenNthCalledWith(2, expect.objectContaining({ nodeId: 'inbound-beta-vless' }));
  });

  it('confirms before deleting a single customer node row', async () => {
    const user = userEvent.setup();
    const onDeleteCustomerNode = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound(), createBetaInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={onDeleteCustomerNode}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const deleteButton = screen.getAllByRole('button', { name: 'Delete Customer Node' })[0];
    expect(deleteButton.outerHTML).toContain('#DC2626');
    expect(deleteButton.outerHTML).not.toContain('red-');
    expect(deleteButton.outerHTML).not.toContain('rose-');

    await user.click(deleteButton);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete customer node Acme Premium VLESS'));
    expect(onDeleteCustomerNode).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(deleteButton);

    expect(onDeleteCustomerNode).toHaveBeenCalledTimes(1);
    expect(onDeleteCustomerNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'inbound-premium-vless' }));
  });

  it('uses the semantic red destructive palette for host delete confirmation', async () => {
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

    await openHostAdvancedDetails(user, 'en');
    await user.click(screen.getByRole('button', { name: 'Remove Host' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove Managed Host' });
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete' });

    expect(deleteButton.outerHTML).toContain('#DC2626');
    expect(deleteButton.outerHTML).not.toContain('red-');
    expect(deleteButton.outerHTML).not.toContain('rose-');
  });

  it('opens customer node link details with QR code from the inbound row', async () => {
    const user = userEvent.setup();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
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

    await user.click(screen.getByRole('button', { name: 'View Links & QR' }));

    const dialog = screen.getByRole('dialog', { name: 'Customer Node Links' });
    expect(within(dialog).getByText('Acme Premium VLESS')).toBeInTheDocument();
    expect(within(dialog).getByText('Single-node Share Link')).toBeInTheDocument();
    expect(within(dialog).getByText('Subscription Link')).toBeInTheDocument();
    expect(
      within(dialog).getByText((value) => new RegExp(`vless://${UUID_IN_LINK}@198\\.51\\.100\\.30:443\\?`).test(value))
    ).toBeInTheDocument();
    expect(within(dialog).queryByText((value) => value.includes('vless://client-acme-premium@'))).not.toBeInTheDocument();
    expect(within(dialog).getByText((value) => value.includes('/sub/') && value.includes('/clash/premium-hk'))).toBeInTheDocument();
    expect(await within(dialog).findByAltText('Subscription QR Code')).toBeInTheDocument();
  });

  it('keeps the customer node traffic multiplier visible only in the admin UI and never in customer links', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound({ clients: [{ ...createInbound().clients[0], trafficMultiplier: 1.5 } as TestXrayClient] })]}
        language="zh"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.getByRole('columnheader', { name: '流量倍率' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'x1.5' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑客户节点' }));
    const dialog = screen.getByRole('dialog', { name: '编辑客户节点' });
    expect(within(dialog).getByLabelText('流量倍率')).toHaveValue('1.5');

    await user.selectOptions(within(dialog).getByLabelText('流量倍率'), '0.5');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'inbound-premium-vless',
          trafficMultiplier: 0.5
        }),
        'update'
      );
    });

    await user.click(screen.getByRole('button', { name: '查看链接和二维码' }));
    const linksDialog = screen.getByRole('dialog', { name: '客户节点链接' });
    expect(linksDialog.textContent).not.toContain('x0.5');
    expect(linksDialog.textContent).not.toContain('x1.5');
    expect(linksDialog.textContent).not.toContain('trafficMultiplier');
    expect(linksDialog.textContent).not.toContain('倍率');
  });

  it('clones a customer node into a new create task without reusing the inbound id', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clone Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });

    expect((within(dialog).getAllByLabelText('Inbound Port')[0] as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByLabelText('Customer Name')).toHaveValue('Acme Premium');
    expect(within(dialog).getByLabelText('Customer Node Name')).toHaveValue('Acme Premium VLESS Copy');
    expect(within(dialog).getByLabelText('Subscription Rule')).toHaveValue('premium-hk-copy');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-metered-01',
          customerNodeName: 'Acme Premium VLESS Copy',
          customerName: 'Acme Premium',
          listenPort: expect.any(Number),
          subscriptionRule: 'premium-hk-copy',
          xrayProtocol: 'vless'
        }),
        'create'
      );
    });
    const savedMetadata = onSaveCustomerNode.mock.calls[0][0];
    expect(savedMetadata.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(savedMetadata.listenPort).toBeLessThanOrEqual(60_999);
    expect(savedMetadata.listenPort).not.toBe(443);
    expect(savedMetadata.nodeId).not.toBe('inbound-premium-vless');
  });

  it('confirms before resetting customer node traffic from the inbound row when a quota policy is available', async () => {
    const user = userEvent.setup();
    const onResetCustomerNodeTraffic = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const quotaPolicy = createCustomerNodeQuotaPolicy();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        quotaPolicies={[quotaPolicy]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={onResetCustomerNodeTraffic}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reset Traffic' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reset traffic for Acme Premium VLESS'));
    expect(onResetCustomerNodeTraffic).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reset Traffic' }));

    expect(onResetCustomerNodeTraffic).toHaveBeenCalledWith(quotaPolicy);
  });

  it('does not show customer node traffic reset when no quota policy matches the inbound client', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        quotaPolicies={[
          createCustomerNodeQuotaPolicy({
            id: 'customer-node:other-node:other-client',
            resourceId: 'other-node:other-client'
          })
        ]}
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onResetCustomerNodeTraffic={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Reset Traffic' })).not.toBeInTheDocument();
  });

  it('shows verified runtime evidence for customer nodes after Agent result proof is projected', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound({
            runtimeDeployment: {
              source: 'agent-result',
              verifiedAt: '2026-06-04T04:05:00.000Z',
              agentIds: ['agent-metered-01'],
              commandIds: ['cmd-task-xray-apply-01'],
              appliedConfigRevisions: ['cfg-task-xray-apply-01']
            }
          })
        ]}
        language="en"
        workspaceMode="customerNodes"
        tasks={[createRuntimeTask()]}
        commandOutbox={[createRuntimeCommand()]}
        configRevisions={[createRuntimeConfigRevision()]}
        preflightPlans={[createRuntimePreflightPlan()]}
        runtimeSnapshots={[createRuntimeSnapshot()]}
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    const evidence = screen.getByRole('button', { name: 'View runtime evidence Acme Premium VLESS' });

    expect(evidence).toHaveAttribute('data-customer-runtime-evidence-state', 'verified');
    expect(within(evidence).getByText('Agent Verified')).toBeInTheDocument();
    expect(within(evidence).getByText('Agent agent-metered-01')).toBeInTheDocument();
    expect(within(evidence).getByText('1 command')).toBeInTheDocument();
    expect(within(evidence).getByText('Config cfg-task-xray-apply-01')).toBeInTheDocument();
  });

  it('keeps customer-node runtime evidence waiting when no Agent result proof exists', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound({ status: 'applying' })]}
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

    const evidence = screen.getByRole('button', { name: 'View runtime evidence Acme Premium VLESS' });

    expect(evidence).toHaveAttribute('data-customer-runtime-evidence-state', 'waiting');
    expect(within(evidence).getByText('Awaiting Agent Result')).toBeInTheDocument();
    expect(within(evidence).getByText(/waiting for command\/result\/preflight\/snapshot evidence/i)).toBeInTheDocument();
  });

  it('opens a customer-node runtime evidence drawer with task release artifacts', async () => {
    const user = userEvent.setup();
    const onOpenRuntimeEvidenceWorkspace = vi.fn();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound({
            configVersion: 'cfg-task-xray-apply-01',
            runtimeDeployment: {
              source: 'agent-result',
              verifiedAt: '2026-06-04T04:05:00.000Z',
              agentIds: ['agent-metered-01'],
              commandIds: ['cmd-task-xray-apply-01'],
              appliedConfigRevisions: ['cfg-task-xray-apply-01']
            }
          })
        ]}
        language="en"
        workspaceMode="customerNodes"
        tasks={[createRuntimeTask()]}
        commandOutbox={[createRuntimeCommand()]}
        configRevisions={[createRuntimeConfigRevision()]}
        preflightPlans={[createRuntimePreflightPlan()]}
        runtimeSnapshots={[createRuntimeSnapshot()]}
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onOpenRuntimeEvidenceWorkspace={onOpenRuntimeEvidenceWorkspace}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={vi.fn()}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View runtime evidence Acme Premium VLESS' }));

    const drawer = screen.getByRole('dialog', { name: 'Customer Node Runtime Evidence' });

    expect(within(drawer).getByText('Verified')).toBeInTheDocument();
    expect(within(drawer).getByText('task-xray-apply-01 · succeeded')).toBeInTheDocument();
    expect(within(drawer).getByText(/1\/1 completed · cmd-task-xray-apply-01/u)).toBeInTheDocument();
    expect(within(drawer).getByText(/agent-result · Verified/u)).toBeInTheDocument();
    expect(within(drawer).getByText('cfg-task-xray-apply-01 · applied')).toBeInTheDocument();
    expect(within(drawer).getByText('preflight-task-xray-apply-01 · passed')).toBeInTheDocument();
    expect(within(drawer).getByText('snapshot-task-xray-apply-01 · verified')).toBeInTheDocument();
    expect(within(drawer).getByText('task-xray-rollback-01')).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: 'Copy Evidence Package' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      node: {
        id: 'inbound-premium-vless',
        customerName: 'Acme Premium',
        nodeName: 'Acme Premium VLESS',
        listenPort: 443,
        protocol: 'vless'
      },
      task: {
        id: 'task-xray-apply-01',
        rollbackTaskId: 'task-xray-rollback-01'
      },
      commands: [
        {
          commandId: 'cmd-task-xray-apply-01',
          status: 'completed'
        }
      ],
      configRevision: {
        id: 'cfg-task-xray-apply-01'
      },
      preflightPlan: {
        id: 'preflight-task-xray-apply-01'
      },
      runtimeSnapshot: {
        id: 'snapshot-task-xray-apply-01'
      }
    });

    await user.click(within(drawer).getByRole('button', { name: 'Open Task Evidence' }));
    expect(onOpenRuntimeEvidenceWorkspace).toHaveBeenCalledTimes(1);
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

  it('does not render unsupported Xray protocols as editable customer-node runtime rows', () => {
    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound({
            id: 'inbound-preview-hysteria',
            label: 'Preview Hysteria2 Inbound',
            protocol: 'hysteria',
            listenPort: 443,
            clientIdentity: 'client-preview-hysteria',
            clients: [
              {
                ...createInbound().clients[0],
                id: 'client-preview-hysteria',
                email: 'preview-hysteria@example.com',
                auth: 'hy2-preview-secret'
              }
            ],
            streamSettings: {
              network: 'udp',
              security: 'tls',
              sni: 'hy2.example.com'
            }
          })
        ]}
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

    expect(screen.queryByText('Preview Hysteria2 Inbound')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Customer Node' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clone Customer Node' })).not.toBeInTheDocument();
  });

  it('requires an Agent with Xray capability before creating customer nodes', async () => {
    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-forward-only-01',
            name: 'Forward Only Host',
            capabilities: ['host-agent', 'port-forwarding']
          }
        ]}
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

    expect(screen.getByRole('button', { name: 'Add Customer Node' })).toBeDisabled();
  });

  it('limits new customer-node targets to Agents with Xray runtime capability', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[
          {
            ...createAgent(),
            id: 'agent-forward-only-01',
            name: 'Forward Only Host',
            publicAddress: '203.0.113.10',
            capabilities: ['host-agent', 'port-forwarding']
          },
          {
            ...createAgent(),
            id: 'agent-xray-02',
            name: 'Xray Runtime Host',
            publicAddress: '203.0.113.20',
            capabilities: ['host-agent', 'xray']
          }
        ]}
        inbounds={[]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });
    const hostSelect = within(dialog).getByLabelText('Assigned Host');

    expect(within(hostSelect).getByRole('option', { name: 'Xray Runtime Host' })).toBeInTheDocument();
    expect(within(hostSelect).queryByRole('option', { name: 'Forward Only Host' })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Customer Name'), 'Acme');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-xray-02',
          serverAddress: '203.0.113.20'
        }),
        'create'
      );
    });
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

  it('shows customer-node runtime readiness and expected Agent evidence before saving', async () => {
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
    const readiness = within(dialog).getByRole('group', { name: 'Runtime Readiness' });

    expect(readiness).toHaveAttribute('data-customer-runtime-readiness-state', 'ready');
    expect(within(readiness).getByText('Ready to Apply')).toBeInTheDocument();
    expect(within(readiness).getByText('Agent Runtime')).toBeInTheDocument();
    expect(within(readiness).getByText('Protocol Boundary')).toBeInTheDocument();
    expect(within(readiness).getByText('Listener Binding')).toBeInTheDocument();
    expect(within(readiness).getByText('Runtime Evidence')).toBeInTheDocument();
    expect(within(readiness).getByText(/agent-result-verified/)).toBeInTheDocument();
    expect(within(readiness).getByText('command + preflight + snapshot')).toBeInTheDocument();
  });

  it('blocks customer-node save when the selected Agent listener is owned by another Xray protocol', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound({
            label: 'Existing Trojan TLS',
            listenPort: 443,
            protocol: 'trojan'
          })
        ]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });
    await user.type(within(dialog).getAllByLabelText('Inbound Port')[0], '443');

    const readiness = within(dialog).getByRole('group', { name: 'Runtime Readiness' });

    expect(readiness).toHaveAttribute('data-customer-runtime-readiness-state', 'blocked');
    expect(within(readiness).getByText('Blocked')).toBeInTheDocument();
    expect(within(readiness).getByText(/443 is already owned by Existing Trojan TLS's TROJAN inbound/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onSaveCustomerNode).not.toHaveBeenCalled();
  });

  it('leaves the new customer-node listen port blank and auto-allocates a high port on save', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[createInbound()]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.type(screen.getByLabelText('Customer Name'), 'Acme');

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });
    expect((within(dialog).getAllByLabelText('Inbound Port')[0] as HTMLInputElement).value).toBe('');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          listenPort: expect.any(Number)
        }),
        'create'
      );
    });

    const savedMetadata = onSaveCustomerNode.mock.calls[0][0];
    expect(savedMetadata.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(savedMetadata.listenPort).toBeLessThanOrEqual(60_999);
    expect(savedMetadata.listenPort).not.toBe(443);
  });

  it('reuses the existing same-protocol customer-node port when the new listen port is blank', async () => {
    const user = userEvent.setup();
    const onSaveCustomerNode = vi.fn();

    render(
      <NodesPage
        agents={[createAgent()]}
        inbounds={[
          createInbound({
            listenPort: 24567,
            protocol: 'vless',
            label: 'Acme Existing VLESS'
          })
        ]}
        language="en"
        workspaceMode="customerNodes"
        onDeleteCustomerNode={vi.fn()}
        onDeleteHost={vi.fn()}
        onDeployHostConfig={vi.fn()}
        onPreviewAgentInstallCommand={vi.fn()}
        onSaveCustomerNode={onSaveCustomerNode}
        onSaveHostConfig={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Customer Node' }));
    await user.type(screen.getByLabelText('Customer Name'), 'Beta');

    const dialog = screen.getByRole('dialog', { name: 'Add Customer Node' });
    const readiness = within(dialog).getByRole('group', { name: 'Runtime Readiness' });
    expect(readiness).toHaveAttribute('data-customer-runtime-readiness-state', 'ready');
    expect(within(readiness).getByText(/24567 will reuse a same-protocol inbound as client 2/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveCustomerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          xrayProtocol: 'vless',
          listenPort: 24567
        }),
        'create'
      );
    });
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
    await user.click(screen.getByText('Advanced Config'));
    await user.selectOptions(screen.getByLabelText('Protocol Template'), 'vless-tls-ws');

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
