import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentCredentialSummary, AuditLog, XrayInbound } from '../../domain';
import type { RuntimeConfigRevision, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import { useAppStore } from '../../app/app-store';
import { normalizeXrayClientCredentials } from '../../domain/protocol-credentials';
import { ApiProvider } from '../../services/api/api-provider';
import type { AgentLogChunk, ControlPlaneApi } from '../../services/api/control-plane-api';
import { createMockApi } from '../../services/mock/mock-api';
import {
  seedAgents,
  seedForwardRules,
  seedInbounds,
  seedNodes,
  seedSubscriptionClients,
  seedSubscriptionSources
} from '../../services/mock/mock-data';
import { AppShell } from './app-shell';

type TestUser = ReturnType<typeof userEvent.setup>;

const rollbackReadyTask: DeployTask = {
  id: 'task-rollback-source',
  operation: 'forward.apply',
  resourceType: 'forward',
  resourceId: 'forward-hkg-443',
  status: 'succeeded',
  targetId: 'forward-hkg-443',
  targetLabel: '端口转发网络',
  summary: '应用端口转发策略',
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  actor: 'admin',
  requestedBy: 'admin',
  requestId: 'req-rollback-source',
  sourceIp: 'ui-preview',
  rollbackAvailable: true,
  attempts: 1,
  progressPercent: 100,
  steps: []
};

const rollbackConfigRevision: RuntimeConfigRevision = {
  id: 'cfg-rollback-source',
  taskId: rollbackReadyTask.id,
  operation: rollbackReadyTask.operation,
  targetId: rollbackReadyTask.targetId,
  targetLabel: rollbackReadyTask.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'port-forwarding',
  artifactUri: 'ou-ui://artifacts/config-revisions/cfg-rollback-source.json',
  checksum: 'sha256:rollback-source',
  signature: 'sig-v1:rollback-source',
  preflightPlanId: 'preflight-rollback-source',
  snapshotBeforeId: 'snapshot-before-forward-hkg-443',
  status: 'applied',
  createdAt: rollbackReadyTask.createdAt,
  createdBy: rollbackReadyTask.actor,
  diffSummary: {
    added: 1,
    changed: 0,
    removed: 0
  },
  artifact: {}
};

const rollbackSnapshot: RuntimeSnapshot = {
  id: rollbackConfigRevision.snapshotBeforeId,
  taskId: rollbackReadyTask.id,
  targetId: rollbackReadyTask.targetId,
  targetLabel: rollbackReadyTask.targetLabel,
  agentId: rollbackConfigRevision.agentId,
  moduleKind: rollbackConfigRevision.moduleKind,
  reason: 'pre_apply',
  status: 'verified',
  checksum: 'sha256:snapshot-before-forward-hkg-443',
  capturedAt: rollbackReadyTask.createdAt,
  capturedBy: rollbackReadyTask.actor,
  state: {}
};

const retainedAgentLogChunk: AgentLogChunk = {
  eventId: 'evt-shell-agent-log-001',
  agentId: 'agent-hkg-01',
  sessionId: 'sess-shell-agent-log-01',
  seq: 8,
  observedAt: '2026-06-04T07:30:00.000Z',
  commandId: 'cmd-shell-forward-apply',
  taskId: rollbackReadyTask.id,
  chunkSeq: 2,
  stream: 'runtime',
  content: 'runtime applied forwarding revision'
};

const runtimeCredentialSummary: AgentCredentialSummary = {
  id: 'runtime-credential-shell-agent-hkg-01',
  agentId: 'agent-hkg-01',
  tokenPrefix: 'oat_shell7f',
  status: 'active',
  purpose: 'runtime',
  issuedAt: '2026-06-05T09:00:00.000Z',
  expiresAt: '2026-09-03T09:00:00.000Z',
  issuedBy: 'agent:agent-hkg-01',
  sourceIp: '198.51.100.10',
  requestId: 'req-shell-agent-credential',
  lastUsedAt: '2026-06-05T10:00:00.000Z',
  sessionId: 'sess-shell-agent-hkg-01',
  metadata: {
    installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
  }
};

const mihomoExportProfile = {
  id: 'profile-mihomo-compatible',
  name: 'Mihomo Compatible Profile',
  client: 'mihomo',
  sourceIds: seedSubscriptionClients[0].sourceIds,
  includeFilter: 'premium',
  excludeFilter: 'expired',
  regionFilter: ['hk'],
  outputFormats: ['mihomo', 'clash', 'uri'],
  templateName: seedSubscriptionClients[0].templateName,
  proxyGroups: [
    {
      id: 'proxy-group-premium-auto',
      name: 'Premium Auto',
      strategy: 'url-test',
      filterTags: ['premium']
    }
  ],
  includeTrafficHeaders: false,
  updatedAt: '2026-06-04T00:00:00.000Z'
} as const;

function withSnapshotFromLists(api: ControlPlaneApi) {
  if (!vi.isMockFunction(api.getSnapshot)) {
    api.getSnapshot = vi.fn(async () => {
      const [
        apiBoundary,
        agents,
        customers,
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionInventoryNodes,
        subscriptionBundles,
        subscriptionClients,
        subscriptionExportProfiles,
        proxyProviders,
        subscriptionExportFiles,
        forwardRules,
        quotaPolicies,
        rateLimitPolicies,
        permissionGrants,
        routingPolicies,
        tuningProfiles,
        tasks,
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        trafficRollupCompactions,
        systemAlerts,
        agentLogRetentionPolicy,
        trafficRollupRetentionPolicy,
        agentCredentials,
        agentSessions,
        agentLogChunks,
        agentLogArchives,
        telegramBotSettings,
        telegramBindings,
        telegramNotificationPolicies,
        telegramNotificationDeliveries,
        auditLogs
      ] = await Promise.all([
        api.getApiBoundary(),
        api.listAgents(),
        api.listCustomers(),
        api.listNodes(),
        api.listInbounds(),
        api.listSubscriptionSources(),
        api.listSubscriptionInventoryNodes(),
        api.listSubscriptionBundles(),
        api.listSubscriptionClients(),
        api.listSubscriptionExportProfiles(),
        api.listProxyProviders(),
        api.listSubscriptionExportFiles(),
        api.listForwardRules(),
        api.listQuotaPolicies(),
        api.listRateLimitPolicies(),
        api.listPermissionGrants(),
        api.listRoutingPolicies(),
        api.listTuningProfiles(),
        api.listTasks(),
        api.listConfigRevisions(),
        api.listPreflightPlans(),
        api.listRuntimeSnapshots(),
        api.listTrafficRollups(),
        api.listTrafficRollupCompactions(),
        api.listSystemAlerts(),
        api.getAgentLogRetentionPolicy(),
        api.getTrafficRollupRetentionPolicy(),
        api.listAgentCredentials(),
        api.listAgentSessions(),
        api.listAgentLogChunks({ limit: 200 }),
        api.listAgentLogArchives({ limit: 200 }),
        api.getTelegramBotSettings(),
        api.listTelegramBindings(),
        api.listTelegramNotificationPolicies(),
        api.listTelegramNotificationDeliveries(),
        api.listAuditLogs()
      ]);

      return {
        apiBoundary,
        agents,
        customers,
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionInventoryNodes,
        subscriptionBundles,
        subscriptionClients,
        subscriptionExportProfiles,
        proxyProviders,
        subscriptionExportFiles,
        forwardRules,
        quotaPolicies,
        rateLimitPolicies,
        permissionGrants,
        routingPolicies,
        tuningProfiles,
        tasks,
        commandOutbox: [],
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        trafficRollupCompactions,
        systemAlerts,
        agentLogRetentionPolicy,
        trafficRollupRetentionPolicy,
        agentCredentials,
        agentSessions,
        agentLogChunks,
        agentLogArchives,
        telegramBotSettings,
        telegramBindings,
        telegramNotificationPolicies,
        telegramNotificationDeliveries,
        auditLogs
      };
    });
  }

  return api;
}

function renderShell(api: ControlPlaneApi) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={withSnapshotFromLists(api)}>
        <AppShell ready />
      </ApiProvider>
    </QueryClientProvider>
  );
}

async function openAdvancedNavigation(user: TestUser) {
  const button =
    screen.queryByRole('button', { name: '展开 治理与证据' }) ??
    screen.queryByRole('button', { name: 'Expand Governance & Evidence' });

  if (button) {
    await user.click(button);
  }
}

async function openHostAdvancedDetails(user: TestUser) {
  const button = await screen.findByRole('button', { name: /^(展开高级详情|Expand advanced details)$/ });
  await user.click(button);
}

async function clickNavigation(user: TestUser, label: string | RegExp) {
  const button = screen.queryAllByRole('button', { name: label })[0];

  if (button) {
    await user.click(button);
    return;
  }

  await openAdvancedNavigation(user);
  await user.click(await screen.findByRole('button', { name: label }));
}

async function findForwardingRuleTableRegion(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector('.forwarding-rule-table-region')).toBeInstanceOf(HTMLElement);
  });

  return document.querySelector<HTMLElement>('.forwarding-rule-table-region')!;
}

async function findForwardingRuleTableRow(ruleName = '端口转发网络'): Promise<HTMLElement> {
  const tableRegion = await findForwardingRuleTableRegion();
  const ruleLabel = await within(tableRegion).findByText(ruleName);
  const ruleRow = ruleLabel.closest('tr');

  if (!(ruleRow instanceof HTMLElement)) {
    throw new Error(`Missing forwarding rule table row for ${ruleName}`);
  }

  return ruleRow;
}

async function getRollbackAction() {
  await waitFor(() => {
    expect(document.querySelector('button[data-task-action="rollback"]')).not.toBeNull();
  });

  return document.querySelector<HTMLButtonElement>('button[data-task-action="rollback"]')!;
}

function stubMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 767px)' || query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
}

describe('AppShell', () => {
  it('applies the taste v2 experimental cinematic shell instead of the legacy grid-only chrome', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    const app = document.getElementById('app-main');
    const background = await screen.findByTestId('app-shell-background');

    expect(app).toHaveClass('ou-shell');
    expect(background).toHaveClass('ou-shell');
    expect(document.querySelector('.ou-shell-backdrop')).toBeNull();
    expect(document.querySelector('.ou-shell-grid')).toBeNull();
    expect(document.querySelector('.ou-shell-color-block')).toBeNull();
    expect(document.querySelector('.ou-shell-ribbon')).toBeNull();
  });

  it('upgrades navigation and launchpad chrome to taste v2 controls', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    expect(await screen.findByRole('complementary')).toHaveClass('ou-shell-sidebar');
    await waitFor(() => {
      expect(document.querySelector('.ou-command-pill')).not.toBeNull();
      expect(document.querySelector('.ou-card-enter')).not.toBeNull();
      expect(document.querySelector('.ou-action-card')).not.toBeNull();
    });
  });

  it('keeps the global shell chrome searchable, dense, and on the operational palette', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    const topbar = await screen.findByRole('banner');
    const sidebar = await screen.findByRole('complementary', { name: 'Master 控制面导航' });
    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });
    const activeNavItem = screen.getByRole('button', { name: '概览' });
    const statusStrip = within(sidebar).getByRole('region', { name: '控制面状态' });
    const shellChromeHtml = `${topbar.outerHTML}${sidebar.outerHTML}`;

    expect(topbar).toHaveClass('control-plane-topbar');
    expect(sidebar).toHaveClass('control-plane-sidebar');
    expect(quickActionButton).toHaveClass('control-plane-search-trigger');
    expect(quickActionButton).toHaveClass('min-w-[320px]');
    expect(quickActionButton.querySelectorAll('.control-plane-search-scope-chip')).toHaveLength(2);
    expect(activeNavItem).toHaveAttribute('aria-current', 'page');
    expect(activeNavItem).toHaveClass('control-plane-nav-item');
    expect(sidebar.querySelectorAll('.control-plane-nav-group')).toHaveLength(2);
    expect(statusStrip).toHaveClass('control-plane-shell-status-strip');
    expect(statusStrip).toHaveTextContent('主控节点');
    expect(statusStrip).toHaveTextContent('证据链');
    expect(statusStrip).toHaveTextContent('在线');
    expect(shellChromeHtml).toContain('ou-tone-primary');
    expect(shellChromeHtml).toContain('ou-tone-danger');
    expect(shellChromeHtml).toContain('ou-tone-warning');
    expect(shellChromeHtml).toContain('ou-tone-success');
    expect(shellChromeHtml).not.toContain('slate-');
    expect(shellChromeHtml).not.toContain('rounded-xl');
    expect(shellChromeHtml).not.toContain('rounded-2xl');
  });

  it('keeps desktop shell height inside the viewport with internal content scrolling', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    const app = document.getElementById('app-main');
    const sidebar = await screen.findByRole('complementary', { name: 'Master 控制面导航' });
    const main = document.querySelector('main');
    const workspaceScrollRegion = main?.querySelector('.relative.flex-1.overflow-y-auto');

    expect(app).toHaveClass('h-[100dvh]', 'overflow-hidden');
    expect(sidebar).toHaveClass('min-h-0', 'h-full');
    expect(main).toHaveClass('min-h-0', 'h-full', 'overflow-hidden');
    expect(workspaceScrollRegion).toHaveClass('min-h-0');
  });

  it('exposes dashboard launchpad task paths as first-screen control actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    expect(await screen.findByRole('button', { name: /接入服务器/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /交付客户节点/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /配置端口转发/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成订阅/ })).toBeInTheDocument();
    expect(screen.queryByText('安装 Agent、查看遥测并应用运行时配置')).not.toBeInTheDocument();
    expect(screen.queryByText('创建客户节点、复制分享链接并重置流量')).not.toBeInTheDocument();
    expect(screen.queryByText('管理多主机端口、配额、限速与策略状态')).not.toBeInTheDocument();
    expect(screen.queryByText('聚合订阅源、导出客户端配置与链接')).not.toBeInTheDocument();
    expect(screen.queryByText('首屏直达主机、节点、转发与订阅，必要时可压缩成指标带。')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /接入服务器/ }));

    expect((await screen.findAllByRole('heading', { name: '受控主机' })).length).toBeGreaterThan(0);
  });

  it('keeps the dashboard launchpad collapsed by default so it does not pad the first screen', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const launchpad = await screen.findByText('操作启动台');
    const launchpadShell = launchpad.closest('section');

    expect(launchpadShell).toHaveAttribute('data-state', 'collapsed');
    expect(document.querySelector('.ou-launchpad-panel')).toBeNull();
    expect(document.querySelector('.ou-launchpad-metric-rail')).toBeInTheDocument();

    await user.click(within(launchpadShell as HTMLElement).getByRole('button', { name: '展开' }));

    expect(launchpadShell).toHaveAttribute('data-state', 'expanded');
    expect(document.querySelector('.ou-launchpad-panel')).toBeInTheDocument();
    expect(screen.getByText('接入服务器').closest('button')).toHaveClass('min-h-[68px]', 'p-2.5');
  });

  it('routes dashboard first-screen response actions into the compact dashboard cockpit', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const cockpit = await screen.findByRole('region', { name: 'Master Control Plane Overview' });
    const controlSurface = within(cockpit).getByRole('region', { name: '控制面' });
    const hostTelemetry = within(cockpit).getByRole('region', { name: '主机遥测' });

    expect(within(controlSurface).getByRole('img', { name: '主机到已挂载主机到节点连通性' })).toBeInTheDocument();
    expect(within(controlSurface).getByRole('button', { name: '刷新视图' })).toBeInTheDocument();
    expect(within(hostTelemetry).getByRole('button', { name: '管理主机' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '首屏处置入口' })).not.toBeInTheDocument();
    expect(screen.queryByText('Release Evidence')).not.toBeInTheDocument();

    await user.click(within(cockpit).getByRole('button', { name: '刷新视图' }));
    expect(screen.getByRole('button', { name: '刷新视图' })).toBeInTheDocument();
  });

  afterEach(() => {
    act(() => {
      useAppStore.getState().reset();
    });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renders inventory even when a forwarding rule has no allocated ports yet', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      listForwardRules: async () => [{ ...seedForwardRules[0], ports: [] }]
    };
    renderShell(api);

    await clickNavigation(user, '服务器');
    await openHostAdvancedDetails(user);

    expect((await screen.findAllByText(seedAgents[0].name)).length).toBeGreaterThan(0);
  });

  it('renders a real empty dashboard on fresh installs instead of seeded node signals', async () => {
    renderShell(createMockApi());

    expect(await screen.findByRole('heading', { name: '连通性' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '主机到已挂载主机到节点连通性' })).toBeInTheDocument();
    expect(screen.getByText('主机')).toBeInTheDocument();
    expect(screen.getByText('已挂载主机')).toBeInTheDocument();
    expect(screen.getAllByText('节点').length).toBeGreaterThan(0);
    expect(screen.queryByText('节点运行热区')).not.toBeInTheDocument();
    expect(screen.queryByText('订阅与执行信号')).not.toBeInTheDocument();
    expect(screen.queryByText('等待受控主机接入')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无主机探针，主机代理完成注册后会显示实时遥测。')).not.toBeInTheDocument();
    expect(screen.queryByText(seedNodes[0].name)).not.toBeInTheDocument();
  });

  it('opens the decoupled customer directory from the primary navigation', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await clickNavigation(user, '客户');

    expect(await screen.findByText('客户目录')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: '客户管理' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Acme Team')).toBeInTheDocument();
    expect(screen.getAllByText('端口转发').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a loading skeleton visible after navigating away from the dashboard while the snapshot is pending', async () => {
    const user = userEvent.setup();
    const neverSettlingApi = {
      ...createMockApi({ seedInventory: true }),
      getSnapshot: vi.fn(() => new Promise<never>(() => {}))
    };

    renderShell(neverSettlingApi);

    await clickNavigation(user, '调优');

    expect(screen.getByRole('status', { name: '同步中' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调优' })).toHaveAttribute('aria-current', 'page');
  });

  it('summarizes global search scope when the operator opens quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));

    const scope = await screen.findByRole('region', { name: '控制面搜索范围' });

    expect(scope).toHaveTextContent('可搜索对象');
    expect(scope).toHaveTextContent('可执行命令');
    expect(scope).toHaveTextContent('当前匹配');
  });

  it('copies a structured control-plane backup package from admin settings', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true, seedRuntimeEvidence: true }));

    await clickNavigation(user, '账户');
    await user.click(await screen.findByRole('button', { name: '复制控制面备份包' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const backup = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      kind: string;
      schemaVersion: number;
      generatedBy: {
        loginUsername: string;
        controlPlaneMode: string;
        operatorGroupId: string;
        resourceGroupId: string;
      };
      restorePlan: {
        command: string;
        includes: string[];
        redaction: string;
      };
      inventory: {
        agents: unknown[];
        customerNodes: unknown[];
        forwardingRules: unknown[];
        subscriptionClients: unknown[];
        subscriptionSources: unknown[];
        routingPolicies: unknown[];
        tuningProfiles: unknown[];
        permissionGrants: unknown[];
      };
      runtimeEvidence: {
        configRevisions: unknown[];
        preflightPlans: unknown[];
        runtimeSnapshots: unknown[];
        failedTasks: Array<{ id: string; operation: string; failureReason?: string }>;
      };
      audit: {
        logCount: number;
        latestHash?: string;
        firstLogId?: string;
        latestLogId?: string;
      };
      security: {
        agentCredentials: Array<{ id: string; tokenPrefix: string; tokenHash?: string }>;
        operatorSessions: Array<{ id: string; status: string }>;
        telegramBotSettings: {
          botTokenSet: boolean;
          botTokenPreview?: string;
        };
      };
    };

    expect(backup.kind).toBe('ou-ui-next.control-plane.backup');
    expect(backup.schemaVersion).toBe(1);
    expect(backup.generatedBy).toEqual(
      expect.objectContaining({
        loginUsername: 'admin',
        controlPlaneMode: 'mock',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium'
      })
    );
    expect(backup.restorePlan.command).toBe('sudo ou-ui restore-control-plane-backup --stdin');
    expect(backup.restorePlan.includes).toEqual(
      expect.arrayContaining(['inventory', 'runtimeEvidence', 'audit', 'security'])
    );
    expect(backup.inventory.agents.length).toBeGreaterThan(0);
    expect(backup.inventory.customerNodes.length).toBeGreaterThan(0);
    expect(backup.inventory.forwardingRules.length).toBeGreaterThan(0);
    expect(backup.inventory.subscriptionClients.length).toBeGreaterThan(0);
    expect(backup.runtimeEvidence.configRevisions).toHaveLength(1);
    expect(backup.runtimeEvidence.preflightPlans).toHaveLength(1);
    expect(backup.runtimeEvidence.runtimeSnapshots).toHaveLength(1);
    expect(backup.runtimeEvidence.failedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-seed-forward-port-conflict',
          operation: 'forward.apply',
          failureReason: expect.stringContaining('port_conflict')
        })
      ])
    );
    expect(backup.audit.logCount).toBe(4);
    expect(backup.audit.firstLogId).toBe('audit-seed-forward-port-conflict-created');
    expect(backup.audit.latestLogId).toBe('audit-seed-forward-port-conflict-rollback-succeeded');
    expect(backup.audit.latestHash).toMatch(/^sha256:/);
    expect(backup.security.operatorSessions.length).toBeGreaterThan(0);
    expect(backup.security.agentCredentials.every((credential) => credential.tokenHash === undefined)).toBe(true);
    expect(JSON.stringify(backup)).not.toContain('local-password');
  });

  it('preflights a pasted control-plane backup before any restore action is executed', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true, seedRuntimeEvidence: true }));

    await clickNavigation(user, '账户');
    await user.click(await screen.findByRole('button', { name: '复制控制面备份包' }));

    const backupText = writeText.mock.calls[0]?.[0] as string;
    const backup = JSON.parse(backupText) as {
      schemaVersion: number;
      inventory: {
        agents: unknown[];
        hosts: unknown[];
        customerNodes: unknown[];
        customers: unknown[];
        forwardingRules: unknown[];
        subscriptionClients: unknown[];
        subscriptionSources: unknown[];
        routingPolicies: unknown[];
        tuningProfiles: unknown[];
        permissionGrants: unknown[];
      };
      runtimeEvidence: {
        configRevisions: unknown[];
        preflightPlans: unknown[];
        runtimeSnapshots: unknown[];
      };
      audit: {
        logCount: number;
      };
    };
    const inventoryResourceCount =
      backup.inventory.agents.length +
      backup.inventory.hosts.length +
      backup.inventory.customerNodes.length +
      backup.inventory.customers.length +
      backup.inventory.forwardingRules.length +
      backup.inventory.subscriptionClients.length +
      backup.inventory.subscriptionSources.length +
      backup.inventory.routingPolicies.length +
      backup.inventory.tuningProfiles.length +
      backup.inventory.permissionGrants.length;
    const runtimeArtifactCount =
      backup.runtimeEvidence.configRevisions.length +
      backup.runtimeEvidence.preflightPlans.length +
      backup.runtimeEvidence.runtimeSnapshots.length;

    const textarea = await screen.findByLabelText('粘贴控制面备份包');
    fireEvent.change(textarea, { target: { value: backupText } });
    await user.click(screen.getByRole('button', { name: '运行恢复预检' }));

    const result = await screen.findByRole('region', { name: '恢复预检结果' });
    expect(within(result).getByText('需要人工确认')).toBeInTheDocument();
    expect(within(result).getByText(`Schema v${backup.schemaVersion}`)).toBeInTheDocument();
    expect(within(result).getByText('库存资源')).toBeInTheDocument();
    expect(within(result).getByText(`库存资源 ${inventoryResourceCount}`)).toBeInTheDocument();
    expect(within(result).getByText('运行时证据')).toBeInTheDocument();
    expect(within(result).getByText(`运行时证据 ${runtimeArtifactCount}`)).toBeInTheDocument();
    expect(within(result).getByText('审计日志')).toBeInTheDocument();
    expect(within(result).getByText(`审计日志 ${backup.audit.logCount}`)).toBeInTheDocument();
    expect(within(result).getByText('资源冲突')).toBeInTheDocument();
    expect(within(result).getByText(/agent-hkg-01/)).toBeInTheDocument();
    expect(within(result).getByText('敏感信息已脱敏')).toBeInTheDocument();
    expect(within(result).getByText('sudo ou-ui restore-control-plane-backup --stdin')).toBeInTheDocument();
    expect(within(result).getByText('仅预检，未执行恢复')).toBeInTheDocument();
  });

  it('opens global quick actions and jumps to matching resource workspaces', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme');

    expect(await screen.findByRole('dialog', { name: '控制面搜索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acme 香港 Premium 订阅' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '端口转发网络' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Acme 香港 Premium 订阅' }));

    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('finds executable quick actions by command kind terms and shows action counts', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'copy');

    const result = await screen.findByRole('button', { name: 'Acme 香港 Premium 订阅' });
    const resultRow = result.closest('[role="listitem"]') as HTMLElement;

    expect(result).toBeInTheDocument();
    expect(resultRow).not.toBeNull();
    expect(within(resultRow).getByText(/\d+ 个动作/)).toBeInTheDocument();
    expect(within(resultRow).getByRole('button', { name: /复制链接 Acme 香港 Premium 订阅/ })).toBeInTheDocument();
  });

  it('summarizes global quick action scope in the topbar search trigger', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });

    expect(within(quickActionButton).getByText(/\d+ 对象/)).toBeInTheDocument();
    expect(within(quickActionButton).getByText(/\d+ 动作/)).toBeInTheDocument();
    expect(within(quickActionButton).getByText('Ctrl K')).toBeInTheDocument();
  });

  it('summarizes executable quick action scope on the mobile search entry', async () => {
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    const mobileQuickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });

    expect(within(mobileQuickActionButton).getByText(/\d+ 动作/)).toBeInTheDocument();
  });

  it('exposes forwarding and governance workspaces from the mobile bottom navigation', async () => {
    const user = userEvent.setup();
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    const forwardingButton = within(mobileNavigation).getByRole('button', { name: '端口转发' });
    const governanceButton = within(mobileNavigation).getByRole('button', { name: '治理' });

    expect(forwardingButton).toHaveClass('touch-manipulation', 'min-h-11');
    expect(governanceButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(forwardingButton);

    expect((await screen.findAllByRole('heading', { name: '端口转发', hidden: true })).length).toBeGreaterThan(0);
  });

  it('opens advanced policy pages from the mobile governance tray', async () => {
    const user = userEvent.setup();
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    const governanceButton = within(mobileNavigation).getByRole('button', { name: '治理' });

    await user.click(governanceButton);

    expect(governanceButton).toHaveAttribute('aria-expanded', 'true');

    const tray = await screen.findByRole('region', { name: '手机治理入口' });
    expect(tray).toHaveClass('mobile-governance-tray');
    expect(within(tray).getByRole('button', { name: '分流策略' })).toHaveClass('touch-manipulation', 'min-h-11');

    await user.click(within(tray).getByRole('button', { name: '分流策略' }));

    expect((await screen.findAllByRole('heading', { name: '分流策略', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: '手机治理入口' })).not.toBeInTheDocument();
  });

  it('opens global quick actions with Ctrl+K and closes it with Escape', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');

    expect(await screen.findByRole('dialog', { name: '控制面搜索' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('returns focus to the global quick action trigger after closing the palette', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });

    await user.click(quickActionButton);
    expect(await screen.findByRole('dialog', { name: '控制面搜索' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
    expect(quickActionButton).toHaveFocus();
  });

  it('keeps visible focus states on global quick action controls', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });
    expect(quickActionButton).toHaveClass('focus-visible:ring-2');

    await user.click(quickActionButton);
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme');

    const subscriptionResult = await screen.findByRole('button', {
      name: 'Acme 香港 Premium 订阅'
    });
    expect(subscriptionResult).toHaveClass('focus-visible:ring-2');
    expect(await screen.findByRole('button', { name: '复制链接 Acme 香港 Premium 订阅' })).toHaveClass(
      'focus-visible:ring-2'
    );
  });

  it('focuses the quick action search box immediately on desktop pointers', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: fine)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));

    const searchbox = await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' });
    await waitFor(() => {
      expect(searchbox).toHaveFocus();
    });
  });

  it('does not attach mousemove tilt handlers to cards', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) => {
      if (selector === '.tilt-card') {
        return [{ addEventListener, removeEventListener }] as unknown as NodeListOf<Element>;
      }

      return [] as unknown as NodeListOf<Element>;
    });

    renderShell(createMockApi({ seedInventory: true }));

    await screen.findByRole('button', { name: '打开控制面搜索' });

    expect(querySelectorAll).not.toHaveBeenCalledWith('.tilt-card');
    expect(addEventListener).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
  });

  it('focuses the quick action close button instead of the search box on coarse mobile pointers', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));

    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });
    await user.click(quickActionButton);

    const searchbox = await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' });
    expect(searchbox).not.toHaveFocus();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭控制面搜索' })).toHaveFocus();
    });

    await user.click(searchbox);
    await user.type(searchbox, 'Acme');

    expect(searchbox).toHaveValue('Acme');
    expect(await screen.findByRole('button', { name: 'Acme 香港 Premium 订阅' })).toBeInTheDocument();
  });

  it('keeps Tab focus inside the quick action dialog', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: fine)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    const searchbox = await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' });
    await waitFor(() => {
      expect(searchbox).toHaveFocus();
    });

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    const dialog = screen.getByRole('dialog', { name: '控制面搜索' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(searchbox);

    await user.keyboard('{Tab}');
    expect(searchbox).toHaveFocus();
  });

  it('hides the app background from assistive technology while quick actions are open', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const appBackground = await screen.findByTestId('app-shell-background');
    expect(appBackground).not.toHaveAttribute('aria-hidden');
    expect(appBackground).not.toHaveAttribute('inert');

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));

    expect(await screen.findByRole('dialog', { name: '控制面搜索' })).toBeInTheDocument();
    expect(appBackground).toHaveAttribute('aria-hidden', 'true');
    expect(appBackground).toHaveAttribute('inert');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
    expect(appBackground).not.toHaveAttribute('aria-hidden');
    expect(appBackground).not.toHaveAttribute('inert');
  });

  it('keeps mobile quick action controls large enough for touch and text entry', async () => {
    const user = userEvent.setup();
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    await waitFor(() => {
      expect(document.querySelector('.ou-action-card')).not.toBeNull();
    });

    const quickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });
    expect(quickActionButton).toHaveClass('touch-manipulation', 'min-h-11');

    await user.click(quickActionButton);
    const dialog = await screen.findByRole('dialog', { name: '控制面搜索' });
    const searchbox = await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' });
    fireEvent.change(searchbox, { target: { value: 'Acme 香港 Premium' } });
    await waitFor(() => {
      expect(searchbox).toHaveValue('Acme 香港 Premium');
    });

    expect(dialog.closest('[data-quick-action-overlay="true"]')).toHaveClass('overscroll-contain');
    expect(searchbox).toHaveClass('max-sm:text-base');
    expect(screen.getByRole('button', { name: '关闭控制面搜索' })).toHaveClass(
      'touch-manipulation',
      'max-sm:h-11',
      'max-sm:w-11'
    );
    expect(await screen.findByRole('button', { name: '复制链接 Acme 香港 Premium 订阅' })).toHaveClass(
      'touch-manipulation',
      'max-sm:min-h-11'
    );
  });

  it('opens global quick actions from the mobile bottom bar and restores focus there', async () => {
    const user = userEvent.setup();
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    const mobileQuickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });

    expect(mobileQuickActionButton).toHaveClass('touch-manipulation', 'min-h-11');

    await user.click(mobileQuickActionButton);

    expect(await screen.findByRole('dialog', { name: '控制面搜索' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
      expect(mobileQuickActionButton).toHaveFocus();
    });
  });

  it('keeps the mobile bottom bar as the only visible quick action entry point on mobile', async () => {
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    await waitFor(() => {
      expect(document.querySelector('.ou-action-card')).not.toBeNull();
    });

    const mobileQuickActionButton = within(mobileNavigation).getByRole('button', { name: '搜索' });
    const topbarQuickActionButton = screen.getByRole('button', { name: '打开控制面搜索' });
    const launchpadQuickActionButton = screen.getByRole('button', { name: '搜索 / 执行动作' });

    expect(mobileQuickActionButton).not.toHaveClass('max-md:hidden');
    expect(topbarQuickActionButton).toHaveClass('max-md:hidden');
    expect(launchpadQuickActionButton).toHaveClass('max-md:hidden');
  });

  it('reserves enough mobile scroll clearance for the fixed bottom navigation', async () => {
    stubMobileViewport();

    renderShell(createMockApi({ seedInventory: true }));

    const mobileNavigation = await screen.findByRole('navigation', { name: '手机快捷导航' });
    const main = document.querySelector('main');
    const workspaceScrollRegion = main?.querySelector('.relative.flex-1.overflow-y-auto');

    expect(mobileNavigation).toHaveClass('bottom-3');
    expect(main).toHaveClass('max-md:pb-28');
    expect(workspaceScrollRegion).toHaveClass('max-md:pb-28');
  });

  it('exposes quick action results as a list without nesting buttons inside options', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    const searchbox = screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' });
    await user.type(searchbox, 'Acme');

    const resultsList = await screen.findByRole('list', { name: '搜索结果' });
    const activeOptionId = searchbox.getAttribute('aria-activedescendant');

    expect(searchbox).toHaveAttribute('aria-controls', 'quick-action-results');
    expect(activeOptionId).toBeNull();
    expect(within(resultsList).queryByRole('option')).not.toBeInTheDocument();
    expect(within(resultsList).getAllByRole('listitem').length).toBeGreaterThan(0);
    const [currentButton] = within(resultsList).getAllByRole('button', { current: true });
    expect(currentButton).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');

    expect(searchbox).not.toHaveAttribute('aria-activedescendant');
    const [nextCurrentButton] = within(resultsList).getAllByRole('button', { current: true });
    expect(nextCurrentButton).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '当前搜索结果' })).toHaveTextContent(
      nextCurrentButton.getAttribute('aria-label') ?? ''
    );
  });

  it('resets quick action search state after closing and reopening', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Mihomo Provider');

    expect(screen.queryByRole('button', { name: '端口转发网络' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');

    expect(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '概览' })).toBeInTheDocument();
    expect(screen.queryByText('运行状态')).not.toBeInTheDocument();
  });

  it('opens the first matching quick action result with Enter', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme 香港 Premium');
    await user.keyboard('{Enter}');

    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('moves between matching quick action results with arrow keys before Enter', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    const drawer = await screen.findByRole('dialog', { name: '编辑转发规则' });
    expect(within(drawer).getByLabelText('监听端口')).toHaveValue(443);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs the active quick action command with Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      syncSubscriptionSource: vi.fn().mockResolvedValue({
        sourceId: seedSubscriptionSources[0].id,
        status: 'synced',
        nodeCount: 84,
        syncedAt: '2026-06-04T00:00:00.000Z',
        nodes: [],
        warnings: []
      })
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Mihomo Provider');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步外部订阅源 Mihomo Provider / HKG'));
    await waitFor(() => {
      expect(api.syncSubscriptionSource).toHaveBeenCalledWith(
        seedSubscriptionSources[0].id,
        expect.objectContaining({
          requestId: expect.stringContaining('subscription.sync.manual')
        })
      );
    });
    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('opens a subscription client link drawer directly from global quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme 香港 Premium');
    await user.click(await screen.findByRole('button', { name: 'Acme 香港 Premium 订阅' }));

    const drawer = await screen.findByRole('dialog', { name: 'Acme 香港 Premium 订阅 订阅链接' });
    expect(within(drawer).getByText(/\/sub\/subacmehgmium\/uri\/sub_acme_hkg_premium/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '复制 URI 链接' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('opens a forwarding edit drawer directly from global quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: '端口转发网络' }));

    const drawer = await screen.findByRole('dialog', { name: '编辑转发规则' });
    expect(within(drawer).getByLabelText('监听端口')).toHaveValue(443);
    expect(within(drawer).getByLabelText('目标 IP')).toHaveValue('10.12.0.8');
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('returns focus to the global quick action trigger after closing a drawer opened from quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });

    await user.click(quickActionButton);
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: '端口转发网络' }));

    expect(await screen.findByRole('dialog', { name: '编辑转发规则' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑转发规则' })).not.toBeInTheDocument();
      expect(quickActionButton).toHaveFocus();
    });
  });

  it('opens a customer resource drawer directly from global quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme Team');
    await user.click(await screen.findByRole('button', { name: 'Acme Team' }));

    const drawer = await screen.findByRole('dialog', { name: 'Acme Team 客户资源' });
    expect(within(drawer).getByText('forward-hkg-443')).toBeInTheDocument();
    expect(within(drawer).getByText('agent-hkg-01')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '复制全部资源 ID' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('verifies the audit chain from the audit workspace through the control-plane API', async () => {
    const user = userEvent.setup();
    const auditLog: AuditLog = {
      id: 'audit-shell-verify-001',
      action: 'task.succeeded',
      actor: 'operator:shell',
      scope: 'control-plane:task',
      resourceType: 'module',
      operation: 'system.tune',
      result: 'succeeded',
      targetId: 'tuning-bbr-default',
      targetLabel: 'BBR tuning',
      taskId: 'task-shell-verify-001',
      severity: 'info',
      message: 'Shell audit verification event',
      createdAt: '2026-06-05T12:00:00.000Z',
      sourceIp: '198.51.100.44',
      requestId: 'req-shell-audit-verify',
      prevHash: 'sha256:prev-shell-audit',
      hash: 'sha256:hash-shell-audit'
    };
    const api = {
      ...createMockApi({ seedInventory: true }),
      listAuditLogs: vi.fn().mockResolvedValue([auditLog]),
      verifyAuditLogChain: vi.fn().mockResolvedValue({
        valid: true,
        checked: 1
      })
    };

    renderShell(api);

    await clickNavigation(user, '审计');
    await user.click(await screen.findByRole('button', { name: '验证审计链' }));

    await waitFor(() => {
      expect(api.verifyAuditLogChain).toHaveBeenCalledWith([auditLog]);
    });
    expect(await screen.findByRole('status', { name: '审计链状态' })).toHaveTextContent('审计链有效');
  });

  it('opens a host deploy drawer directly from global quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '香港入口 Agent');
    await user.click(await screen.findByRole('button', { name: '香港入口 Agent' }));

    const drawer = await screen.findByRole('dialog', { name: '应用主机设置' });
    expect(within(drawer).getByText(/香港入口 Agent/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '确认应用' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('keeps keyboard focus inside the host deploy confirmation dialog', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '香港入口 Agent');
    await user.click(await screen.findByRole('button', { name: '香港入口 Agent' }));

    const dialog = await screen.findByRole('dialog', { name: '应用主机设置' });
    const closeButton = within(dialog).getByRole('button', { name: '关闭浮窗' });
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(closeButton);

    await user.keyboard('{Tab}');
    expect(closeButton).toHaveFocus();
  });

  it('returns focus to the global quick action trigger after confirming host deploy from quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    const quickActionButton = await screen.findByRole('button', { name: '打开控制面搜索' });

    await user.click(quickActionButton);
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '香港入口 Agent');
    await user.click(await screen.findByRole('button', { name: '香港入口 Agent' }));

    const dialog = await screen.findByRole('dialog', { name: '应用主机设置' });
    const confirmButton = within(dialog).getByRole('button', { name: '确认应用' });

    await user.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '应用主机设置' })).not.toBeInTheDocument();
      expect(quickActionButton).toHaveFocus();
    });
  });

  it('closes the host deploy confirmation dialog with Escape', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '香港入口 Agent');
    await user.click(await screen.findByRole('button', { name: '香港入口 Agent' }));

    expect(await screen.findByRole('dialog', { name: '应用主机设置' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '应用主机设置' })).not.toBeInTheDocument();
  });

  it('opens a customer node edit drawer directly from global quick actions', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Primary VLESS Gateway');
    await user.click(await screen.findByRole('button', { name: 'Primary VLESS Gateway' }));

    const drawer = await screen.findByRole('dialog', { name: '编辑客户节点' });
    expect(within(drawer).getByLabelText('客户节点名称')).toHaveValue('Primary VLESS Gateway');
    expect(within(drawer).getByLabelText('客户名称')).toHaveValue('ops-hkg');
    expect(within(drawer).getAllByLabelText('入站端口')[0]).toHaveValue(443);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('does not expose unsupported Xray runtime protocols in global customer-node quick actions', async () => {
    const user = userEvent.setup();
    const api = createMockApi({ seedInventory: true });
    const previewHysteriaInbound: XrayInbound = {
      ...seedInbounds[0],
      id: 'inbound-preview-hysteria-global',
      label: 'Preview Hysteria2 Global Gateway',
      protocol: 'hysteria',
      listenPort: 4433,
      clientIdentity: 'client-preview-hysteria-global',
      clients: [
        {
          ...seedInbounds[0].clients[0],
          id: 'client-preview-hysteria-global',
          email: 'preview-hysteria-global@example.com',
          auth: 'hy2-preview-global-secret'
        }
      ]
    };
    api.listInbounds = vi.fn(async () => [
      ...seedInbounds,
      previewHysteriaInbound
    ]);

    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Preview Hysteria2 Global Gateway');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Preview Hysteria2 Global Gateway' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'preview-hysteria-global@example.com' })).not.toBeInTheDocument();
    });
  });

  it('opens a customer node edit drawer from a matched Xray client quick action', async () => {
    const user = userEvent.setup();

    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');

    const customerNodeResult = (await screen.findAllByRole('button', { name: 'ops-hkg' })).find((button) =>
      button.closest('[role="listitem"]')?.textContent?.includes('客户节点')
    );

    expect(customerNodeResult).toBeInTheDocument();

    await user.click(customerNodeResult as HTMLElement);

    const drawer = await screen.findByRole('dialog', { name: '编辑客户节点' });
    expect(within(drawer).getByLabelText('客户节点名称')).toHaveValue('Primary VLESS Gateway');
    expect(within(drawer).getByLabelText('客户名称')).toHaveValue('ops-hkg');
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('resets matched Xray client traffic directly from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({
        seedInventory: true,
        inventory: {
          quotaPolicies: [
            {
              id: 'customer-node:inbound-vless-hkg-443:client-ops-hkg',
              name: 'Primary VLESS Gateway quota',
              scope: 'customer-node' as const,
              limitBytes: 5 * 1024 ** 4,
              usedBytes: 1.2 * 1024 ** 4,
              resetWindow: 'monthly' as const,
              billingDirection: 'both' as const,
              enforcementState: 'disabled_by_quota' as const,
              resourceId: 'inbound-vless-hkg-443:client-ops-hkg',
              detail: 'ops-hkg'
            }
          ]
        }
      }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '重置流量 ops-hkg' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Primary VLESS Gateway'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'quota.reset',
          resourceType: 'quota',
          targetId: 'customer-node:inbound-vless-hkg-443:client-ops-hkg',
          targetLabel: 'Primary VLESS Gateway',
          metadata: expect.objectContaining({
            quotaPolicyScope: 'customer-node'
          })
        }),
        expect.objectContaining({
          idempotencyKey: 'ui:quota.reset:customer-node:inbound-vless-hkg-443:client-ops-hkg:customer-node'
        })
      );
    });
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('deletes a customer node through the typed Xray client action API and removes its subscription binding', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      applyXrayClientAction: vi.fn().mockResolvedValue(rollbackReadyTask),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '节点');
    await user.click(await screen.findByRole('button', { name: '删除客户节点' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Primary VLESS Gateway'));
    await waitFor(() => {
      expect(api.applyXrayClientAction).toHaveBeenCalledWith(
        expect.objectContaining({
          inboundId: 'inbound-vless-hkg-443',
          clientId: 'client-ops-hkg',
          clientEmail: 'ops-hkg',
          action: {
            kind: 'delete-client'
          },
          reason: 'operator-delete-customer-node'
        }),
        expect.objectContaining({
          requestId: 'ui:xray.client.action:inbound-vless-hkg-443',
          idempotencyKey: undefined
        })
      );
    });
    expect(api.createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'inbound.delete'
      }),
      expect.anything()
    );

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.delete',
          resourceType: 'subscription',
          targetId: 'sub-client-ops-hkg-manual',
          metadata: expect.objectContaining({
            subscriptionClientId: 'sub-client-ops-hkg-manual',
            deletedWithCustomerNodeId: 'inbound-vless-hkg-443'
          })
        }),
        expect.objectContaining({
          idempotencyKey:
            'ui:subscription.delete.customer-node:inbound-vless-hkg-443:sub-client-ops-hkg-manual'
        })
      );
    });
  });

  it('creates a subscription binding task when adding a shared-inbound Xray client', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      applyXrayClientAction: vi.fn().mockResolvedValue(rollbackReadyTask),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '节点');
    await user.click((await screen.findAllByRole('button', { name: '管理客户端' }))[0]);

    const dialog = await screen.findByRole('dialog', { name: /入站客户端/ });
    await user.type(within(dialog).getByLabelText('客户端邮箱'), 'carol@example.com');
    await user.clear(within(dialog).getByLabelText('流量上限'));
    await user.type(within(dialog).getByLabelText('流量上限'), '50');
    await user.clear(within(dialog).getByLabelText('有效天数'));
    await user.type(within(dialog).getByLabelText('有效天数'), '45');
    await user.clear(within(dialog).getByLabelText('IP 限制'));
    await user.type(within(dialog).getByLabelText('IP 限制'), '1');
    await user.type(within(dialog).getByLabelText('订阅规则'), 'premium-hk:carol');
    await user.click(within(dialog).getByRole('button', { name: '添加客户端' }));

    await waitFor(() => {
      expect(api.applyXrayClientAction).toHaveBeenCalledWith(
        expect.objectContaining({
          inboundId: 'inbound-vless-hkg-443',
          action: expect.objectContaining({
            kind: 'add-client',
            clientEmail: 'carol@example.com',
            trafficLimitGb: 50,
            remainingDays: 45,
            ipLimit: 1,
            subscriptionRule: 'premium-hk:carol'
          }),
          reason: 'customer-node-client:add'
        }),
        expect.objectContaining({
          requestId: 'ui:xray.client.action:inbound-vless-hkg-443',
          idempotencyKey: undefined
        })
      );
    });

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-carol-example-com-premium-hk-carol',
          metadata: expect.objectContaining({
            subscriptionClientId: 'sub-client-carol-example-com-premium-hk-carol',
            customerName: 'carol@example.com',
            subId: 'premium-hk:carol',
            email: 'carol@example.com',
            protocol: 'vless',
            group: 'node-hkg-edge-01',
            trafficLimitGb: 50,
            remainingDays: 45,
            ipLimit: 1,
            outputFormats: expect.arrayContaining(['uri', 'v2ray', 'clash', 'mihomo', 'sing-box', 'shadowrocket', 'stash'])
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining(
            'ui:subscription.generate:sub-client-carol-example-com-premium-hk-carol'
          )
        })
      );
    });
  });

  it('removes the matching subscription binding when deleting a shared-inbound Xray client', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const sharedInbound: XrayInbound = {
      ...seedInbounds[0],
      subscriptionRule: 'premium-hk',
      clients: [
        seedInbounds[0].clients[0],
        {
          id: 'client-carol',
          email: 'carol@example.com',
          enabled: true,
          subId: 'premium-hk:carol',
          password: 'carol-secret',
          trafficLimitBytes: 50 * 1024 ** 3,
          usedTrafficBytes: 5 * 1024 ** 3,
          expiresAt: '2026-12-31T23:59:59.000Z',
          ipLimit: 1
        }
      ]
    };
    const api = {
      ...createMockApi({ seedInventory: true }),
      listInbounds: vi.fn().mockResolvedValue([sharedInbound]),
      listSubscriptionClients: vi.fn().mockResolvedValue([
        ...seedSubscriptionClients,
        {
          ...seedSubscriptionClients[0],
          id: 'sub-client-carol-existing',
          displayName: 'Carol Premium 订阅',
          subId: 'premium-hk:carol',
          email: 'carol@example.com',
          protocol: 'vless',
          group: 'node-hkg-edge-01',
          securePathPreview: '/ExistingCarolSecurePath',
          routingRule: 'premium-hk:carol',
          sourceIds: [],
          selectedTags: [],
          includeFilter: '',
          excludeFilter: '',
          regionFilter: [],
          outputFormats: ['uri', 'v2ray', 'clash', 'mihomo', 'sing-box', 'shadowrocket', 'stash']
        }
      ]),
      applyXrayClientAction: vi.fn().mockResolvedValue(rollbackReadyTask),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '节点');
    await user.click((await screen.findAllByRole('button', { name: '管理客户端' }))[0]);

    const dialog = await screen.findByRole('dialog', { name: /入站客户端/ });
    await user.click(within(dialog).getAllByRole('button', { name: '删除客户端' })[1]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('carol@example.com'));
    await waitFor(() => {
      expect(api.applyXrayClientAction).toHaveBeenCalledWith(
        expect.objectContaining({
          inboundId: 'inbound-vless-hkg-443',
          clientId: 'client-carol',
          clientEmail: 'carol@example.com',
          action: {
            kind: 'delete-client'
          },
          reason: 'customer-node-client:delete'
        }),
        expect.objectContaining({
          requestId: 'ui:xray.client.action:inbound-vless-hkg-443',
          idempotencyKey: undefined
        })
      );
    });

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.delete',
          resourceType: 'subscription',
          targetId: 'sub-client-carol-existing',
          metadata: expect.objectContaining({
            subscriptionClientId: 'sub-client-carol-existing',
            subId: 'premium-hk:carol',
            deletedWithXrayInboundId: 'inbound-vless-hkg-443',
            deletedWithXrayClientId: 'client-carol',
            deletedWithXrayClientEmail: 'carol@example.com',
            deletedWithXrayClientAction: true
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining(
            'ui:subscription.delete:xray-client:inbound-vless-hkg-443:premium-hk:carol:sub-client-carol-existing'
          )
        })
      );
    });
  });

  it('resets matched Xray client traffic with a short quick action alias', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({
        seedInventory: true,
        inventory: {
          quotaPolicies: [
            {
              id: 'customer-node:inbound-vless-hkg-443:client-ops-hkg',
              name: 'Primary VLESS Gateway quota',
              scope: 'customer-node' as const,
              limitBytes: 5 * 1024 ** 4,
              usedBytes: 1.2 * 1024 ** 4,
              resetWindow: 'monthly' as const,
              billingDirection: 'both' as const,
              enforcementState: 'disabled_by_quota' as const,
              resourceId: 'inbound-vless-hkg-443:client-ops-hkg',
              detail: 'ops-hkg'
            }
          ]
        }
      }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '重置 ops-hkg');
    await user.keyboard('{Enter}');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Primary VLESS Gateway'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'quota.reset',
          targetId: 'customer-node:inbound-vless-hkg-443:client-ops-hkg'
        }),
        expect.objectContaining({
          idempotencyKey: 'ui:quota.reset:customer-node:inbound-vless-hkg-443:client-ops-hkg:customer-node'
        })
      );
    });
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('disables a matched Xray client directly from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '停用 ops-hkg' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('停用 ops-hkg'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.update',
          resourceType: 'inbound',
          targetId: 'inbound-vless-hkg-443',
          targetLabel: 'Primary VLESS Gateway',
          metadata: expect.objectContaining({
            customerNodeName: 'Primary VLESS Gateway',
            clientEmail: 'ops-hkg',
            enabled: false,
            clients: [
              expect.objectContaining({
                clientEmail: 'ops-hkg',
                enabled: false
              })
            ]
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('ui:inbound.update:agent-hkg-01:inbound-vless-hkg-443:443:vless:ops-hkg')
        })
      );
    });
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('disables one shared Xray client without dropping peer clients from submitted metadata', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const sharedInbounds: XrayInbound[] = seedInbounds.map((inbound) =>
      inbound.id === 'inbound-vless-hkg-443'
        ? {
            ...inbound,
            clients: [
              inbound.clients[0],
              {
                ...inbound.clients[0],
                id: 'client-peer-hkg',
                email: 'peer-hkg',
                enabled: true,
                trafficLimitBytes: 2 * 1024 * 1024 * 1024 * 1024,
                usedTrafficBytes: 0.4 * 1024 * 1024 * 1024 * 1024,
                expiresAt: '2026-11-30T23:59:59.000Z',
                ipLimit: 2
              }
            ]
          }
        : inbound
    );
    const api = {
      ...createMockApi({ seedInventory: true }),
      listInbounds: vi.fn().mockResolvedValue(sharedInbounds),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '停用 ops-hkg' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.update',
          targetId: 'inbound-vless-hkg-443'
        }),
        expect.anything()
      );
    });

    const [input] = api.createTask.mock.calls.find(([request]) => request.operation === 'inbound.update') ?? [];

    expect(input?.metadata).toMatchObject({
      enabled: true,
      clients: [
        expect.objectContaining({
          clientIdentity: 'client-ops-hkg',
          clientEmail: 'ops-hkg',
          enabled: false
        }),
        expect.objectContaining({
          clientIdentity: 'client-peer-hkg',
          clientEmail: 'peer-hkg',
          enabled: true
        })
      ]
    });
  });

  it('disables a matched Xray client with a short quick action alias', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '禁用 ops-hkg');
    await user.keyboard('{Enter}');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('停用 ops-hkg'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.update',
          targetId: 'inbound-vless-hkg-443',
          metadata: expect.objectContaining({
            clientEmail: 'ops-hkg',
            enabled: false,
            clients: [
              expect.objectContaining({
                clientEmail: 'ops-hkg',
                enabled: false
              })
            ]
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('ui:inbound.update:agent-hkg-01:inbound-vless-hkg-443:443:vless:ops-hkg')
        })
      );
    });
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('resumes a disabled Xray client with a short quick action alias', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const disabledInbounds = seedInbounds.map((inbound) =>
      inbound.id === 'inbound-vless-hkg-443'
        ? {
            ...inbound,
            clients: inbound.clients.map((client) =>
              client.id === 'client-ops-hkg'
                ? {
                    ...client,
                    enabled: false
                  }
                : client
            )
          }
        : inbound
    );
    const api = {
      ...createMockApi({ seedInventory: true }),
      listInbounds: vi.fn().mockResolvedValue(disabledInbounds),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '恢复 ops-hkg');
    await user.keyboard('{Enter}');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('启用 ops-hkg'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.update',
          targetId: 'inbound-vless-hkg-443',
          metadata: expect.objectContaining({
            clientEmail: 'ops-hkg',
            enabled: true,
            clients: [
              expect.objectContaining({
                clientEmail: 'ops-hkg',
                enabled: true
              })
            ]
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('ui:inbound.update:agent-hkg-01:inbound-vless-hkg-443:443:vless:ops-hkg')
        })
      );
    });
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies a matched Xray client share link directly from global quick actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '复制链接 ops-hkg' }));

    const normalized = normalizeXrayClientCredentials({
      protocol: 'vless',
      clientIdentity: 'client-ops-hkg',
      clientCredential: 'client-ops-hkg',
      fallbackSeed: 'inbound-vless-hkg-443:agent-hkg-01:ops-hkg'
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`vless://${normalized.clientId}@`));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('type=tcp'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('security=reality'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('pbk=reality-public-key-preview'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#Primary%20VLESS%20Gateway'));
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies saved VLESS Reality share links with the same normalized UUID used by runtime artifacts', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '复制链接 ops-hkg' }));

    const normalized = normalizeXrayClientCredentials({
      protocol: 'vless',
      clientIdentity: 'client-ops-hkg',
      clientCredential: 'client-ops-hkg',
      fallbackSeed: 'inbound-vless-hkg-443:agent-hkg-01:ops-hkg'
    });
    const copiedLink = writeText.mock.calls[0]?.[0] as string;

    expect(copiedLink).toContain(`vless://${normalized.clientId}@`);
    expect(copiedLink).not.toContain('vless://client-ops-hkg@');
    expect(copiedLink).toContain('type=tcp');
    expect(copiedLink).toContain('security=reality');
    expect(copiedLink).toContain('pbk=reality-public-key-preview');
    expect(copiedLink).toContain('sid=a1b2c3d4');
    expect(copiedLink).toContain('sni=hk.example.com');
    expect(copiedLink).toContain('@103.45.12.xxx:443');
  });

  it('copies a matched Xray client subscription link directly from global quick actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '复制订阅 ops-hkg' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/[A-Za-z0-9]+\/clash\/manual$/)
    );
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies all matched Xray client subscription formats directly from global quick actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'ops-hkg');
    await user.click(await screen.findByRole('button', { name: '复制全部 ops-hkg' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /URI: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/uri\/manual\nV2Ray JSON: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/v2ray\/manual\nClash: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/clash\/manual\nMihomo: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/mihomo\/manual\nSing-box: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/sing-box\/manual\nShadowrocket: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/shadowrocket\/manual\nStash: http:\/\/localhost(?::\d+)?\/sub\/[A-Za-z0-9]+\/stash\/manual/
      )
    );
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs a matched quick action command with Enter when the query names the command', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '复制全部 ops-hkg');
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Sing-box:'));
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs a matched quick action share-link command with Enter when the query uses a short alias', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '链接 ops-hkg');
    await user.keyboard('{Enter}');

    const normalized = normalizeXrayClientCredentials({
      protocol: 'vless',
      clientIdentity: 'client-ops-hkg',
      clientCredential: 'client-ops-hkg',
      fallbackSeed: 'inbound-vless-hkg-443:agent-hkg-01:ops-hkg'
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`vless://${normalized.clientId}@`));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('vless://client-ops-hkg@'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('security=reality'));
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs a matched quick action command with Enter when the query uses a short command alias', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '订阅 ops-hkg');
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/sub\/[A-Za-z0-9]+\/clash\/manual$/));
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs a matched quick action all-formats command with Enter when the query uses a short alias', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '全部 ops-hkg');
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('URI:'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Sing-box:'));
    expect((await screen.findAllByRole('heading', { name: '客户节点', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('runs a forwarding apply task directly from global quick actions', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: '应用 端口转发网络' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.apply',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: '端口转发网络',
        metadata: expect.objectContaining({
          listenAddress: '0.0.0.0',
          listenPort: 443,
          targetAddress: '10.12.0.8',
          targetPort: 8443,
          protocol: 'tcp+udp',
          entryNodeIds: ['agent-hkg-01'],
          billingDirection: 'both'
        })
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.apply:forward-hkg-443')
      })
    );
    expect((await screen.findAllByRole('heading', { name: '端口转发' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('pauses an enabled forwarding rule directly from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: '暂停 端口转发网络' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('暂停 端口转发网络'));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.pause',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: '端口转发网络',
        metadata: expect.objectContaining({
          enabled: false,
          listenPort: 443,
          targetPort: 8443
        }),
        riskConfirmation: {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443'
        }
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.pause:forward-hkg-443')
      })
    );
    expect((await screen.findAllByRole('heading', { name: '端口转发' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('uses English punctuation when confirming a forwarding pause from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    act(() => {
      useAppStore.setState({ language: 'en' });
    });
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: 'Open control-plane search' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search control plane, hosts, customers, forwarding, and subscriptions' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: 'Pause 端口转发网络' }));

    expect(confirm).toHaveBeenCalledWith('Pause 端口转发网络?');
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('resumes a paused forwarding rule directly from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const pausedRule = {
      ...seedForwardRules[0],
      enabled: false,
      portStatus: 'paused' as const,
      ports: seedForwardRules[0].ports.map((port) => ({
        ...port,
        status: 'paused' as const
      }))
    };
    const api = {
      ...createMockApi({ seedInventory: true }),
      listForwardRules: vi.fn().mockResolvedValue([pausedRule]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '端口转发网络');
    await user.click(await screen.findByRole('button', { name: '恢复 端口转发网络' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('恢复 端口转发网络'));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.resume',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: '端口转发网络',
        metadata: expect.objectContaining({
          enabled: true
        }),
        riskConfirmation: {
          operation: 'forward.resume',
          targetId: 'forward-hkg-443'
        }
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.resume:forward-hkg-443')
      })
    );
    expect((await screen.findAllByRole('heading', { name: '端口转发' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('syncs an external subscription source directly from global quick actions', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    const api = {
      ...createMockApi({ seedInventory: true }),
      syncSubscriptionSource: vi.fn().mockResolvedValue({
        sourceId: seedSubscriptionSources[0].id,
        status: 'synced',
        nodeCount: 84,
        syncedAt: '2026-06-04T00:00:00.000Z',
        nodes: [],
        warnings: []
      })
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Mihomo Provider');
    await user.click(await screen.findByRole('button', { name: '同步 Mihomo Provider / HKG' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步外部订阅源 Mihomo Provider / HKG'));
    expect(api.syncSubscriptionSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.clear(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Mihomo Provider');
    await user.click(await screen.findByRole('button', { name: '同步 Mihomo Provider / HKG' }));

    await waitFor(() => {
      expect(api.syncSubscriptionSource).toHaveBeenCalledWith(
        seedSubscriptionSources[0].id,
        expect.objectContaining({
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          requestId: expect.stringContaining('subscription.sync.manual')
        })
      );
    });
    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('syncs an external subscription source from global quick actions with a refresh alias', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      syncSubscriptionSource: vi.fn().mockResolvedValue({
        sourceId: seedSubscriptionSources[0].id,
        status: 'synced',
        nodeCount: 84,
        syncedAt: '2026-06-04T00:00:00.000Z',
        nodes: [],
        warnings: []
      })
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '刷新 Mihomo Provider');
    await user.keyboard('{Enter}');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步外部订阅源 Mihomo Provider / HKG'));
    await waitFor(() => {
      expect(api.syncSubscriptionSource).toHaveBeenCalledWith(
        seedSubscriptionSources[0].id,
        expect.objectContaining({
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          requestId: expect.stringContaining('subscription.sync.manual')
        })
      );
    });
    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies a subscription client URI directly from global quick actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme 香港 Premium');
    await user.click(await screen.findByRole('button', { name: '复制链接 Acme 香港 Premium 订阅' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/subacmehgmium\/uri\/sub_acme_hkg_premium$/)
    );
    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies a subscription client URI from global quick actions with a short alias', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '链接 Acme 香港 Premium');
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/subacmehgmium\/uri\/sub_acme_hkg_premium$/)
    );
    expect(screen.queryByRole('dialog', { name: 'Acme 香港 Premium 订阅 订阅链接' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies all subscription client formats directly from global quick actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '打开控制面搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), 'Acme 香港 Premium');
    await user.click(await screen.findByRole('button', { name: '复制全部 Acme 香港 Premium 订阅' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /URI: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/uri\/sub_acme_hkg_premium\nClash: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/clash\/sub_acme_hkg_premium\nMihomo: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/mihomo\/sub_acme_hkg_premium/
      )
    );
    expect((await screen.findAllByRole('heading', { name: '订阅管理', hidden: true })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('copies all subscription client formats from global quick actions with a short alias', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderShell(createMockApi({ seedInventory: true }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('searchbox', { name: '搜索控制面、主机、客户、转发和订阅' }), '全部 Acme 香港 Premium');
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /URI: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/uri\/sub_acme_hkg_premium\nClash: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/clash\/sub_acme_hkg_premium\nMihomo: http:\/\/localhost(?::\d+)?\/sub\/subacmehgmium\/mihomo\/sub_acme_hkg_premium/
      )
    );
    expect(screen.queryByRole('dialog', { name: 'Acme 香港 Premium 订阅 订阅链接' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '控制面搜索' })).not.toBeInTheDocument();
  });

  it('generates a one-click host agent install command without creating a deploy task', async () => {
    const user = userEvent.setup();
    const baseApi = createMockApi({ seedInventory: true });
    const api = {
      ...baseApi,
      createAgentInstallCommand: vi.fn(baseApi.createAgentInstallCommand),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '服务器');
    await user.click(screen.getByRole('button', { name: '生成安装命令' }));

    expect(screen.queryByText(/批量安装/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/主机代理一键安装/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/OU_MASTER='.*\/agent\/v1\/poll'/)).toBeInTheDocument();
    expect(screen.queryByText(/OU_INSTALL_PROFILE=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OU_HOST_NAME=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OU_CUSTOMER_NODE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/master\.example\.com/)).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: '复制安装命令' })).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.createAgentInstallCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
          publicBaseUrl: expect.any(String)
        }),
        expect.any(Object)
      );
    });
  });

  it('generates a host agent install command on a fresh empty installation', async () => {
    const user = userEvent.setup();
    const baseApi = createMockApi();
    const api = {
      ...baseApi,
      createAgentInstallCommand: vi.fn(baseApi.createAgentInstallCommand),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '服务器');
    expect(screen.getByText('暂无受控主机')).toBeInTheDocument();
    expect(screen.queryByText(seedNodes[0].name)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '生成安装命令' }));

    expect(await screen.findByText(/OU_MASTER='.*\/agent\/v1\/poll'/)).toBeInTheDocument();
    expect(screen.getByText(/OU_INSTALL_TOKEN=/)).toBeInTheDocument();
    expect(screen.queryByText(/OU_HOST_NAME=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OU_CUSTOMER_NODE/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制安装命令' })).toBeEnabled();
    expect(api.createTask).not.toHaveBeenCalled();
    expect(api.createAgentInstallCommand).toHaveBeenCalledTimes(1);
  });

  it('creates managed host update and delete tasks from the host workspace', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '服务器');
    await openHostAdvancedDetails(user);
    await user.click((await screen.findAllByRole('button', { name: '编辑主机' }))[0]);
    await user.clear(screen.getByLabelText('主机别名'));
    await user.type(screen.getByLabelText('主机别名'), 'edge-renamed-01');
    await user.clear(screen.getByLabelText('运行时主机名'));
    await user.type(screen.getByLabelText('运行时主机名'), 'edge-runtime-01');
    const maxTrafficInput = screen.getAllByLabelText('最大流量')[0];
    await user.clear(maxTrafficInput);
    await user.type(maxTrafficInput, '2048');
    await user.selectOptions(screen.getByLabelText('流量计算类型'), 'egress');
    await user.selectOptions(screen.getByLabelText('流量重置日期'), '7');
    await user.clear(screen.getByLabelText('当前已用流量'));
    await user.type(screen.getByLabelText('当前已用流量'), '256');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'edge-renamed-01',
          metadata: expect.objectContaining({
            agentId: 'agent-hkg-01',
            displayName: 'edge-renamed-01',
            runtimeHostName: 'edge-runtime-01',
            maxTrafficGb: 2048,
            trafficAccountingMode: 'egress',
            monthlyResetDay: 7,
            currentUsedTrafficGb: 256
          })
        }),
        expect.any(Object)
      );
    });

    await user.click((await screen.findAllByRole('button', { name: '移除主机' }))[0]);
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'agent.delete',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'edge-renamed-01',
          riskConfirmation: {
            operation: 'agent.delete',
            targetId: 'agent-hkg-01'
          },
          metadata: expect.objectContaining({
            agentId: 'agent-hkg-01',
            displayName: 'edge-renamed-01',
            runtimeHostName: 'edge-runtime-01',
            maxTrafficGb: 2048,
            trafficAccountingMode: 'egress',
            monthlyResetDay: 7,
            currentUsedTrafficGb: 256
          })
        }),
        expect.any(Object)
      );
    });
  });

  it('creates multi-host forwarding tasks with custom listen port and target endpoint metadata', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await screen.findByRole('button', { name: '创建转发规则' });
    await user.click(screen.getByRole('button', { name: '创建转发规则' }));
    await user.clear(await screen.findByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    await user.clear(screen.getByLabelText('目标 IP'));
    await user.type(screen.getByLabelText('目标 IP'), '172.20.8.10');
    await user.clear(screen.getByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9443');
    await user.selectOptions(screen.getByLabelText('计费方向'), 'single');
    await user.selectOptions(screen.getByLabelText('重置日期'), '15');
    await user.click(screen.getByText('高级配置'));
    await user.clear(screen.getByLabelText('当前已用流量'));
    await user.type(screen.getByLabelText('当前已用流量'), '33.5');
    expect((await screen.findAllByText('香港入口 Agent')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('新加坡转发 Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('已选 2')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('agent-hkg-01, agent-sin-02')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.create',
        metadata: expect.objectContaining({
          ownerName: '客户',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          billingDirection: 'single',
          monthlyResetDay: 15,
          currentUsedTrafficGb: 33.5,
          entryNodeIds: ['agent-hkg-01', 'agent-sin-02']
        })
      }),
      expect.any(Object)
    );
    const forwardingContext = vi.mocked(api.createTask).mock.calls[0][1];
    expect(forwardingContext).toEqual(
      expect.objectContaining({
        requestId: expect.stringMatching(/^ui:forward\.create:forward-custom-2443:[a-z0-9]+$/),
        idempotencyKey: expect.stringMatching(/^ui:forward\.create:forward-custom-2443:[a-z0-9]+$/)
      })
    );
    expect(forwardingContext.requestId.length).toBeLessThanOrEqual(160);
    expect(forwardingContext.idempotencyKey?.length).toBeLessThanOrEqual(200);
  });

  it('keeps forwarding submission disabled until the target port is valid and accepts auto-allocated listen ports', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await user.click(screen.getByRole('button', { name: '创建转发规则' }));
    await user.type(await screen.findByLabelText('目标 IP'), '172.20.8.10');

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    await user.type(screen.getByLabelText('目标端口'), '9443');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();

    await user.type(screen.getByLabelText('监听端口'), '70000');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    await user.clear(screen.getByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('creates port forwarding on a fresh install without any forwarding group or tunnel seed', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      listForwardRules: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await user.click(screen.getByRole('button', { name: '创建转发规则' }));
    expect(screen.queryByLabelText('转发分组')).not.toBeInTheDocument();

    await user.clear(await screen.findByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    await user.clear(screen.getByLabelText('目标 IP'));
    await user.type(screen.getByLabelText('目标 IP'), '172.20.8.10');
    await user.clear(screen.getByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9443');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.create',
        metadata: expect.not.objectContaining({
          tunnelId: expect.any(String)
        })
      }),
      expect.any(Object)
    );
  });

  it('updates an existing forwarding rule instead of creating a duplicate from the edit drawer', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await user.click((await screen.findAllByRole('button', { name: '编辑转发规则' }))[0]);
    await user.clear(await screen.findByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9555');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.update',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        metadata: expect.objectContaining({
          targetPort: 9555,
          entryNodeIds: ['agent-hkg-01']
        })
      }),
      expect.any(Object)
    );
  });

  it('applies an existing forwarding rule with complete runtime metadata', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await user.click((await screen.findAllByRole('button', { name: '应用' }))[0]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('应用 端口转发网络'));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.apply',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        metadata: expect.objectContaining({
          listenAddress: '0.0.0.0',
          listenPort: 443,
          targetAddress: '10.12.0.8',
          targetPort: 8443,
          protocol: 'tcp+udp',
          entryNodeIds: ['agent-hkg-01'],
          billingDirection: 'both'
        })
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.apply:forward-hkg-443')
      })
    );
  });

  it('pauses an enabled forwarding rule through a confirmed forwarding task', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    await user.click((await screen.findAllByRole('button', { name: '停用' }))[0]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('停用 端口转发网络'));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.pause',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        metadata: expect.objectContaining({
          enabled: false,
          listenPort: 443,
          targetPort: 8443
        }),
        riskConfirmation: {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443'
        }
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.pause:forward-hkg-443')
      })
    );
  });

  it('resumes a disabled forwarding rule instead of sending a fresh apply task', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const pausedRule = {
      ...seedForwardRules[0],
      enabled: false,
      portStatus: 'paused' as const,
      ports: seedForwardRules[0].ports.map((port) => ({
        ...port,
        status: 'paused' as const
      }))
    };
    const api = {
      ...createMockApi({ seedInventory: true }),
      listForwardRules: vi.fn().mockResolvedValue([pausedRule]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    const forwardingRow = await findForwardingRuleTableRow();
    await user.click(within(forwardingRow).getByRole('button', { name: '恢复' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('恢复 端口转发网络'));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.resume',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        metadata: expect.objectContaining({
          enabled: true
        }),
        riskConfirmation: {
          operation: 'forward.resume',
          targetId: 'forward-hkg-443'
        }
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('forward.resume:forward-hkg-443')
      })
    );
  });

  it('does not expose tunnel fabrics while the Agent runtime cannot execute them', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '端口转发');

    expect(screen.queryByRole('button', { name: '隧道链路' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建隧道链路' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新部署隧道' })).not.toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('creates customer node inbound tasks with Xray metadata from the customer node workspace', async () => {
    const user = userEvent.setup();
    const acceptedInboundTask: DeployTask = {
      ...rollbackReadyTask,
      id: 'task-customer-node-save-inbound',
      operation: 'inbound.create',
      resourceType: 'inbound',
      targetLabel: '客户专属 VLESS 入口'
    };
    const acceptedSubscriptionTask: DeployTask = {
      ...rollbackReadyTask,
      id: 'task-customer-node-save-subscription',
      operation: 'subscription.generate',
      resourceType: 'subscription',
      targetLabel: 'Acme subscription'
    };
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn()
        .mockResolvedValueOnce(acceptedInboundTask)
        .mockResolvedValueOnce(acceptedSubscriptionTask)
    };
    renderShell(api);

    await clickNavigation(user, '节点');
    await user.click(screen.getByRole('button', { name: '新增客户节点' }));
    await user.clear(screen.getByLabelText('客户名称'));
    await user.type(screen.getByLabelText('客户名称'), 'Acme');
    await user.click(screen.getByText('高级配置'));
    await user.clear(screen.getByLabelText('客户节点名称'));
    await user.type(screen.getByLabelText('客户节点名称'), '客户专属 VLESS 入口');
    await user.clear(screen.getByLabelText('服务器地址'));
    await user.type(screen.getByLabelText('服务器地址'), 'edge.customer.example.com');
    await user.clear(screen.getByLabelText('订阅规则'));
    await user.type(screen.getByLabelText('订阅规则'), 'region:hk AND tier:premium');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetLabel: '客户专属 VLESS 入口',
          metadata: expect.objectContaining({
            customerNodeName: '客户专属 VLESS 入口',
            serverAddress: 'edge.customer.example.com',
            xrayProtocol: 'vless',
            listenPort: expect.any(Number),
            expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            subscriptionRule: 'region:hk AND tier:premium',
            clients: [
              expect.objectContaining({
                clientEmail: 'Acme',
                subscriptionRule: 'region:hk AND tier:premium',
                enabled: true
              })
            ]
          })
        }),
        expect.any(Object)
      );
    });
    const createRequest = api.createTask.mock.calls.find(([request]) => request.operation === 'inbound.create')?.[0];
    expect(createRequest?.metadata?.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(createRequest?.metadata?.listenPort).toBeLessThanOrEqual(60_999);
    expect(createRequest?.metadata?.listenPort).not.toBe(443);
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetLabel: 'Acme subscription',
          metadata: expect.objectContaining({
            customerName: 'Acme',
            subId: 'region:hk AND tier:premium',
            protocol: 'vless',
            routingRule: 'region:hk AND tier:premium',
            securePathPreview: expect.stringMatching(/^\/[a-z0-9]{24}$/),
            subscriptionUrlPreview: expect.objectContaining({
              clash: expect.stringContaining('/sub/'),
              shadowrocket: expect.stringContaining('/shadowrocket/'),
              stash: expect.stringContaining('/stash/')
            }),
            outputFormats: expect.arrayContaining(['clash', 'mihomo', 'uri', 'shadowrocket', 'stash'])
          })
        }),
        expect.any(Object)
      );
    });
    expect(api.createTask).toHaveBeenCalledTimes(2);
    const saveFeedback = await screen.findByRole('region', { name: '客户节点保存反馈' });

    expect(within(saveFeedback).getByText('新增节点 已接收 · 客户专属 VLESS 入口')).toBeInTheDocument();
    expect(within(saveFeedback).getByText('Runtime task-customer-node-save-inbound')).toBeInTheDocument();
    expect(within(saveFeedback).getByText('Subscription task-customer-node-save-subscription')).toBeInTheDocument();
  });

  it('creates quota reset tasks from the customer node traffic reset action', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({
        seedInventory: true,
        inventory: {
          quotaPolicies: [
            {
              id: 'customer-node:inbound-vless-hkg-443:client-ops-hkg',
              name: 'Primary VLESS Gateway quota',
              scope: 'customer-node' as const,
              limitBytes: 5 * 1024 ** 4,
              usedBytes: 1.2 * 1024 ** 4,
              resetWindow: 'monthly' as const,
              billingDirection: 'both' as const,
              enforcementState: 'disabled_by_quota' as const,
              resourceId: 'inbound-vless-hkg-443:client-ops-hkg',
              detail: 'ops-hkg'
            }
          ]
        }
      }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '节点');
    await user.click(await screen.findByRole('button', { name: '重置流量' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Primary VLESS Gateway'));
    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'quota.reset',
          resourceType: 'quota',
          targetId: 'customer-node:inbound-vless-hkg-443:client-ops-hkg',
          targetLabel: 'Primary VLESS Gateway',
          metadata: expect.objectContaining({
            quotaPolicyScope: 'customer-node'
          })
        }),
        expect.objectContaining({
          idempotencyKey: 'ui:quota.reset:customer-node:inbound-vless-hkg-443:client-ops-hkg:customer-node'
        })
      );
    });
  });

  it('creates subscription import tasks when an external source is saved', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask),
      syncSubscriptionSource: vi.fn().mockResolvedValue({
        sourceId: 'source-custom',
        status: 'synced',
        nodeCount: 2,
        syncedAt: '2026-06-04T00:00:00.000Z',
        nodes: [],
        warnings: []
      })
    };
    renderShell(api);

    await clickNavigation(user, '订阅');
    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    await user.clear(screen.getByLabelText('源名称'));
    await user.type(screen.getByLabelText('源名称'), '客户自定义订阅源');
    await user.clear(screen.getByLabelText('源地址'));
    await user.type(screen.getByLabelText('源地址'), 'https://provider.example.com/custom.yaml');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetLabel: '客户自定义订阅源',
          metadata: expect.objectContaining({
            kind: 'clash',
            name: '客户自定义订阅源',
            url: 'https://provider.example.com/custom.yaml',
            dedupeKey: 'server-port'
          })
        }),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(api.syncSubscriptionSource).toHaveBeenCalledWith(
        expect.stringMatching(/^source-/),
        expect.objectContaining({
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          requestId: expect.stringContaining('subscription.sync')
        })
      );
    });
  });

  it('syncs an existing external subscription source from the subscriptions workspace', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    act(() => {
      useAppStore.setState({ language: 'en' });
    });
    const api = {
      ...createMockApi({ seedInventory: true }),
      syncSubscriptionSource: vi.fn().mockResolvedValue({
        sourceId: seedSubscriptionSources[0].id,
        status: 'synced',
        nodeCount: 84,
        syncedAt: '2026-06-04T00:00:00.000Z',
        nodes: [],
        warnings: []
      })
    };
    renderShell(api);

    await clickNavigation(user, 'Subscriptions');
    await user.click(screen.getByRole('button', { name: 'External Sources' }));
    await user.click((await screen.findAllByRole('button', { name: 'Sync Now' }))[0]);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Sync external subscription source'));

    await waitFor(() => {
      expect(api.syncSubscriptionSource).toHaveBeenCalledWith(
        seedSubscriptionSources[0].id,
        expect.objectContaining({
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          requestId: expect.stringContaining('subscription.sync.manual')
        })
      );
    });
  });

  it('generates subscription export files with complete client rule metadata', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    act(() => {
      useAppStore.setState({ language: 'en' });
    });
    const api = {
      ...createMockApi({ seedInventory: true }),
      listSubscriptionExportProfiles: vi.fn().mockResolvedValue([mihomoExportProfile]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, 'Subscriptions');
    await waitFor(() => {
      expect(api.listSubscriptionExportProfiles).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: 'Export Files' }));
    await user.click(await screen.findByRole('button', { name: 'Generate' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Generate export file'));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.export',
          resourceType: 'subscription',
          targetId: seedSubscriptionClients[0].id,
          metadata: expect.objectContaining({
            subscriptionClientId: seedSubscriptionClients[0].id,
            subId: seedSubscriptionClients[0].subId,
            protocol: seedSubscriptionClients[0].protocol,
            sourceIds: seedSubscriptionClients[0].sourceIds,
            formats: seedSubscriptionClients[0].formats,
            templateName: seedSubscriptionClients[0].templateName,
            profileId: 'profile-mihomo-compatible',
            proxyGroups: [
              expect.objectContaining({
                name: 'Premium Auto',
                strategy: 'url-test'
              })
            ],
            includeTrafficHeaders: false,
            clientRule: expect.objectContaining({
              protocolFilter: seedSubscriptionClients[0].protocol,
              sourceIds: seedSubscriptionClients[0].sourceIds
            })
          })
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining(`subscription.export:${seedSubscriptionClients[0].id}`)
        })
      );
    });
  });

  it('creates client subscription rule tasks with custom filters and formats', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await clickNavigation(user, '订阅');
    await user.click(screen.getByRole('button', { name: '新增订阅身份' }));
    await user.clear(screen.getByLabelText('规则名称'));
    await user.type(screen.getByLabelText('规则名称'), '客户 A 香港订阅');
    await user.clear(screen.getByLabelText('Sub ID'));
    await user.type(screen.getByLabelText('Sub ID'), 'sub_customer_a_hk');
    await user.clear(screen.getByLabelText('包含关键字'));
    await user.type(screen.getByLabelText('包含关键字'), '香港|Premium');
    await user.clear(screen.getByLabelText('地区过滤'));
    await user.type(screen.getByLabelText('地区过滤'), 'hk');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetLabel: '客户 A 香港订阅',
          metadata: expect.objectContaining({
            displayName: '客户 A 香港订阅',
            subId: 'sub_customer_a_hk',
            includeFilter: '香港|Premium',
            regionFilter: ['hk'],
            sortStrategy: 'latency',
            formats: expect.arrayContaining(['plain', 'clash', 'json', 'sing-box']),
            outputFormats: expect.arrayContaining(['uri', 'clash', 'v2ray', 'sing-box']),
            clientRule: expect.objectContaining({
              protocolFilter: 'vless',
              outputFormats: expect.arrayContaining(['uri', 'clash', 'v2ray', 'sing-box'])
            })
          })
        }),
        expect.any(Object)
      );
    });
  });

  it('surfaces failed task mutations instead of swallowing rejected promises', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const permissionError = Object.assign(new Error('permission.denied'), {
      code: 'permission.denied',
      details: {
        before: {
          actorPermissions: ['operate', 'read']
        },
        after: {
          requiredPermission: 'configure',
          resourceId: 'group-premium'
        }
      }
    });
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockRejectedValue(permissionError)
    };

    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    const forwardingRow = await findForwardingRuleTableRow();
    await user.click(within(forwardingRow).getByRole('button', { name: '应用' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('当前账号缺少 configure 权限');
    expect(alert).toHaveTextContent('资源组：group-premium');
    expect(alert).toHaveTextContent('已有权限：operate, read');
    expect(alert).toHaveClass('ou-tone-danger');
    expect(alert.outerHTML).not.toMatch(/\b(?:border|bg|text|ring)-(?:red|slate|orange)-/u);
    expect(alert.outerHTML).not.toMatch(/\brounded-xl\b/u);
    expect(alert.outerHTML).not.toMatch(/\bbackdrop-blur/u);
  });

  it('keeps a managed host visible when its delete task is rejected', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockRejectedValue(new Error('permission.denied'))
    };

    renderShell(api);

    await clickNavigation(user, '服务器');
    await openHostAdvancedDetails(user);
    expect(await screen.findAllByText(seedAgents[0].name)).not.toHaveLength(0);

    await user.click((await screen.findAllByRole('button', { name: '移除主机' }))[0]);
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号没有执行此变更的权限');
    expect(screen.getAllByText(seedAgents[0].name)).not.toHaveLength(0);
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'agent.delete',
        targetId: seedAgents[0].id,
        riskConfirmation: {
          operation: 'agent.delete',
          targetId: seedAgents[0].id
        }
      }),
      expect.any(Object)
    );
  });

  it('prevents duplicate task mutations while one task request is in flight', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    let resolveCreateTask: (task: DeployTask) => void = () => undefined;
    const createTaskPromise = new Promise<DeployTask>((resolve) => {
      resolveCreateTask = resolve;
    });
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn(() => createTaskPromise)
    };

    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    const forwardingRow = await findForwardingRuleTableRow();
    await user.dblClick(within(forwardingRow).getByRole('button', { name: '应用' }));

    expect(confirm).toHaveBeenCalled();
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('变更提交中')).toBeInTheDocument();

    await act(async () => {
      resolveCreateTask(rollbackReadyTask);
      await createTaskPromise;
    });
  });

  it('keeps a created task queued when the post-mutation refresh fails', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      listTasks: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('snapshot.unavailable')),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '端口转发');
    const forwardingRow = await findForwardingRuleTableRow();
    await user.click(within(forwardingRow).getByRole('button', { name: '应用' }));

    expect(await screen.findByRole('status')).toHaveTextContent('执行记录已创建');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dispatches system tuning as a real Agent task with risk metadata', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    vi.stubGlobal('confirm', vi.fn(() => true));

    renderShell(api);

    await clickNavigation(user, '调优');
    await user.click(await screen.findByRole('button', { name: '下发调优预设' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'system.tune',
          resourceType: 'agent',
          targetId: seedAgents[0].id,
          targetLabel: `BBR + FQ 预设 / ${seedAgents[0].id}`,
          metadata: expect.objectContaining({
            agentId: seedAgents[0].id,
            tuningProfileId: 'bbr-fq',
            tuningProfileName: 'BBR + FQ 预设',
            tuningTarget: 'kernel',
            tuningRiskLevel: 'medium',
            tuningPreset: expect.objectContaining({
              id: 'bbr-fq',
              name: 'BBR + FQ 预设',
              target: 'kernel',
              riskLevel: 'medium'
            }),
            probeState: expect.objectContaining({
              bbrInstalled: false,
              tcpProbeReady: true,
              kernelVersion: '6.8.0-31-generic'
            }),
            sysctlPlan: expect.objectContaining({
              id: 'bbr-fq',
              name: 'BBR + FQ 预设',
              target: 'kernel',
              riskLevel: 'medium',
              parameters: expect.arrayContaining([
                expect.objectContaining({
                  key: 'net.ipv4.tcp_congestion_control',
                  value: 'bbr'
                }),
                expect.objectContaining({
                  key: 'net.core.default_qdisc',
                  value: 'fq'
                })
              ])
            }),
            requiresRoot: true,
            rollbackMode: 'graceful_restart'
          }),
          riskConfirmation: {
            operation: 'system.tune',
            targetId: seedAgents[0].id,
            reason: 'BBR + FQ 预设'
          }
        }),
        expect.any(Object)
      );
    });
    const [taskInput] = api.createTask.mock.calls[0] ?? [];
    expect(taskInput.metadata.tuningActions).toEqual([
      'install_or_enable_bbr',
      'set_tcp_congestion_control',
      'apply_tcp_buffers'
    ]);
    expect(taskInput.metadata.sysctl).toEqual({
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.default_qdisc': 'fq'
    });
  });

  it('dispatches routing compilation with the filtered policy scope in metadata', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    renderShell(api);

    await clickNavigation(user, '分流策略');
    await user.type(await screen.findByRole('searchbox', { name: '搜索策略' }), 'streaming');
    await user.selectOptions(screen.getByLabelText('动作'), 'proxy');
    await user.selectOptions(screen.getByLabelText('风险'), 'medium');
    await user.click(screen.getByRole('button', { name: '编译当前策略' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'config.compile',
          targetId: 'routing-policy-matrix',
          metadata: expect.objectContaining({
            policyIds: ['route-streaming-proxy'],
            policyCount: 1
          })
        }),
        expect.objectContaining({
          idempotencyKey: 'ui:config.compile:routing-policy-matrix:route-streaming-proxy'
        })
      );
    });
  });

  it('dispatches administrator-authored manual routing rules as structured compile metadata', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    renderShell(api);

    await clickNavigation(user, '分流策略');
    const manualRule = await screen.findByRole('region', { name: '手写分流规则' });
    await user.type(within(manualRule).getByLabelText('生成主机'), '香港入口主机');
    await user.type(within(manualRule).getByLabelText('访问域名'), 'stream.example.com');
    await user.selectOptions(within(manualRule).getByLabelText('出站协议'), 'proxy');
    await user.type(within(manualRule).getByLabelText('出站标签'), 'HK-PREMIUM');
    await user.click(within(manualRule).getByRole('button', { name: '编译手写规则' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'config.compile',
          targetId: 'routing-manual-rule',
          metadata: expect.objectContaining({
            policyIds: [],
            policyCount: 0,
            manualRule: {
              accessDomain: 'stream.example.com',
              generatedHost: '香港入口主机',
              manualRuleId: 'manual:香港入口主机:stream.example.com:proxy:HK-PREMIUM',
              match: 'host:香港入口主机 AND domain:stream.example.com',
              outboundProtocol: 'proxy',
              outboundTag: 'HK-PREMIUM'
            }
          })
        }),
        expect.objectContaining({
          idempotencyKey: 'ui:config.compile:routing-manual-rule:manual:香港入口主机:stream.example.com:proxy:HK-PREMIUM'
        })
      );
    });
  });

  it('creates an agent rollback task from a rollback-ready task', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const api = {
      ...createMockApi({ seedInventory: true }),
      listTasks: vi.fn().mockResolvedValue([rollbackReadyTask]),
      listConfigRevisions: vi.fn().mockResolvedValue([rollbackConfigRevision]),
      listRuntimeSnapshots: vi.fn().mockResolvedValue([rollbackSnapshot]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '执行记录');
    await user.click(await getRollbackAction());

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`回滚任务 ${rollbackReadyTask.id}`));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'agent.rollback',
        targetId: rollbackReadyTask.targetId,
        targetLabel: rollbackReadyTask.targetLabel,
        riskConfirmation: {
          operation: 'agent.rollback',
          targetId: rollbackReadyTask.targetId
        }
      }),
      expect.objectContaining({
        idempotencyKey: `ui:agent.rollback:${rollbackReadyTask.targetId}:${rollbackReadyTask.id}:${rollbackSnapshot.id}`
      })
    );
  });

  it('shows retained Agent runtime logs in the execution workspace', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi({ seedInventory: true }),
      listAgentLogChunks: vi.fn().mockResolvedValue([retainedAgentLogChunk])
    };

    renderShell(api);

    await clickNavigation(user, '执行记录');

    expect(await screen.findByText('主机代理运行日志 · 1')).toBeInTheDocument();
    const logArticle = screen.getByText('runtime applied forwarding revision').closest('article');
    expect(logArticle).not.toBeNull();
    expect(within(logArticle!).getByText('运行时')).toBeInTheDocument();
    expect(within(logArticle!).getByText(/cmd-shell-forward-apply/)).toBeInTheDocument();
  });

  it('exports retained Agent runtime logs from the execution workspace', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:agent-runtime-logs');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const NativeURL = URL;

    class TestURL extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }

    vi.stubGlobal('URL', TestURL);

    const api = {
      ...createMockApi({ seedInventory: true }),
      listAgentLogChunks: vi.fn().mockResolvedValue([retainedAgentLogChunk]),
      exportAgentLogChunks: vi.fn().mockResolvedValue({
        format: 'jsonl' as const,
        contentType: 'application/x-ndjson; charset=utf-8',
        filename: 'ou-ui-agent-runtime-logs-test.jsonl',
        generatedAt: '2026-06-05T11:00:00.000Z',
        count: 1,
        query: {
          limit: 1000,
          format: 'jsonl' as const
        },
        chunks: [retainedAgentLogChunk],
        content: `${JSON.stringify(retainedAgentLogChunk)}\n`
      })
    };

    renderShell(api);

    await clickNavigation(user, '执行记录');
    await user.click(await screen.findByRole('button', { name: '导出日志' }));

    await waitFor(() => {
      expect(api.exportAgentLogChunks).toHaveBeenCalledWith({
        limit: 1000,
        format: 'jsonl'
      });
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:agent-runtime-logs');
    expect(await screen.findByRole('status')).toHaveTextContent('Agent 运行日志已导出：1 条');

    clickSpy.mockRestore();
  });

  it('updates Agent log retention policy from the execution workspace', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const baseApi = createMockApi({ seedInventory: true });
    const api = {
      ...baseApi,
      updateAgentLogRetentionPolicy: vi.fn(baseApi.updateAgentLogRetentionPolicy)
    };

    vi.stubGlobal('confirm', confirm);

    renderShell(api);

    await clickNavigation(user, '执行记录');
    await user.clear(await screen.findByLabelText('保留天数'));
    await user.type(screen.getByLabelText('保留天数'), '14');
    await user.clear(screen.getByLabelText('单机上限'));
    await user.type(screen.getByLabelText('单机上限'), '300');
    await user.click(screen.getByRole('button', { name: '保存策略' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认保存 Agent 日志留存策略'));

    await waitFor(() => {
      expect(api.updateAgentLogRetentionPolicy).toHaveBeenCalledWith(
        {
          maxAgeDays: 14,
          maxEventsPerAgent: 300,
          reason: '操作员更新主机代理日志留存策略'
        },
        expect.objectContaining({
          actor: 'admin',
          requestId: expect.stringContaining('agent.log_retention.update')
        })
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Agent 日志留存策略已保存');
    expect(await screen.findByText('保留 14 天')).toBeInTheDocument();
    expect(screen.getByText('每台主机代理 300 条')).toBeInTheDocument();
    expect(screen.getByText('控制面配置')).toBeInTheDocument();
  });

  it('keeps removed traffic history controls out of the system dashboard', async () => {
    renderShell(createMockApi({ seedInventory: true }));

    expect((await screen.findAllByText('主机探针')).length).toBeGreaterThan(0);
    expect(screen.queryByText('流量历史')).not.toBeInTheDocument();
    expect(screen.queryByText('流量历史留存')).not.toBeInTheDocument();
    expect(screen.queryByText('压缩归档')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出历史' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出归档' })).not.toBeInTheDocument();
  });

  it('lists operator sessions in the security workspace and revokes a selected session', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const baseApi = createMockApi({ seedInventory: true });
    const sessions = [
      {
        id: 'operator-session-current-001',
        username: 'operator_001',
        actor: 'operator:alice',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        status: 'active' as const,
        issuedAt: '2026-06-05T00:00:00.000Z',
        expiresAt: '2026-06-05T08:00:00.000Z',
        sourceIp: '203.0.113.10',
        userAgent: 'vitest-session-current',
        requestId: 'req-operator-session-current'
      },
      {
        id: 'operator-session-remote-002',
        username: 'operator_001',
        actor: 'operator:bob',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-premium',
        status: 'active' as const,
        issuedAt: '2026-06-05T00:05:00.000Z',
        expiresAt: '2026-06-05T08:05:00.000Z',
        sourceIp: '198.51.100.24',
        userAgent: 'vitest-session-remote',
        requestId: 'req-operator-session-remote'
      }
    ];
    const api = {
      ...baseApi,
      listOperatorSessions: vi.fn().mockResolvedValue(sessions),
      revokeOperatorSession: vi.fn().mockResolvedValue({
        ...sessions[1],
        status: 'revoked' as const,
        revokedAt: '2026-06-05T00:10:00.000Z',
        revokedBy: 'operator:alice',
        revokedReason: 'operator initiated session revocation'
      })
    };

    act(() => {
      useAppStore.getState().authenticate({
        csrfToken: 'csrf-session-ui-001',
        operatorSessionId: 'operator-session-current-001'
      });
    });
    vi.stubEnv('VITE_CONTROL_PLANE_MODE', 'http');
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', '/secure-panel');
    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '账户');

    expect(await screen.findByRole('heading', { name: '操作员会话' })).toBeInTheDocument();
    expect(screen.getByText('operator-session-current-001')).toBeInTheDocument();
    expect(screen.getByText('当前会话')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '撤销会话' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('operator-session-remote-002'));
    await waitFor(() => {
      expect(api.revokeOperatorSession).toHaveBeenCalledWith(
        'operator-session-remote-002',
        {
          reason: 'operator initiated session revocation'
        },
        expect.objectContaining({
          actor: 'admin',
          requestId: expect.stringContaining('ui:operator.session.revoke:operator-session-remote-002')
        })
      );
    });
  });

  it('lists seeded operator sessions in the mock security workspace', async () => {
    const user = userEvent.setup();
    const api = createMockApi({ seedInventory: true });

    act(() => {
      useAppStore.getState().authenticate({
        operatorSessionId: 'operator-session-local-current'
      });
    });
    renderShell(api);

    await clickNavigation(user, '账户');

    expect(await screen.findByRole('heading', { name: '操作员会话' })).toBeInTheDocument();
    expect(await screen.findByText('operator-session-local-current')).toBeInTheDocument();
    expect(screen.getByText('operator-session-remote-review')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Agent 运行凭证' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制已选会话证据' })).not.toBeInTheDocument();
  });

  it('manages sanitized Agent credentials in the security workspace', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    const baseApi = createMockApi({ seedInventory: true });
    const api = {
      ...baseApi,
      listAgentCredentials: vi.fn().mockResolvedValue([runtimeCredentialSummary]),
      rotateAgentCredential: vi.fn().mockResolvedValue({
        agentId: runtimeCredentialSummary.agentId,
        agentToken: 'oat_shell_full_token_must_not_render',
        tokenPrefix: 'oat_shell8f',
        credentialId: 'runtime-credential-shell-agent-hkg-02',
        issuedAt: '2026-06-05T10:15:00.000Z',
        expiresAt: '2026-09-03T10:15:00.000Z',
        sessionId: runtimeCredentialSummary.sessionId
      }),
      revokeAgentCredential: vi.fn().mockResolvedValue({
        ...runtimeCredentialSummary,
        status: 'revoked' as const,
        revokedAt: '2026-06-05T10:20:00.000Z',
        revokedBy: 'operator',
        revokedReason: 'operator initiated Agent credential revocation'
      })
    };

    vi.stubGlobal('confirm', confirm);
    renderShell(api);

    await clickNavigation(user, '账户');

    expect(await screen.findByText('Agent 运行凭证')).toBeInTheDocument();
    const credentialRow = screen.getByText(runtimeCredentialSummary.id).closest('tr');
    expect(credentialRow).not.toBeNull();
    expect(within(credentialRow as HTMLElement).getByText(/令牌前缀 oat_shell7f/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent 凭证操作预检' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '轮换凭证' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`轮换凭证 ${runtimeCredentialSummary.id}`));
    await waitFor(() => {
      expect(api.rotateAgentCredential).toHaveBeenCalledWith(
        runtimeCredentialSummary.id,
        {
          reason: 'operator initiated Agent runtime credential rotation'
        },
        expect.objectContaining({
          requestId: expect.stringContaining(`ui:agent.credential.rotate:${runtimeCredentialSummary.id}`)
        })
      );
    });
    expect(screen.queryByText('oat_shell_full_token_must_not_render')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '撤销凭证' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`撤销凭证 ${runtimeCredentialSummary.id}`));
    await waitFor(() => {
      expect(api.revokeAgentCredential).toHaveBeenCalledWith(
        runtimeCredentialSummary.id,
        {
          reason: 'operator initiated Agent credential revocation'
        },
        expect.objectContaining({
          requestId: expect.stringContaining(`ui:agent.credential.revoke:${runtimeCredentialSummary.id}`)
        })
      );
    });
  });

  it('calls the server logout endpoint from the topbar in HTTP mode', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            authenticated: false
          },
          requestId: 'req-topbar-logout'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    act(() => {
      useAppStore.getState().authenticate({
        csrfToken: 'csrf-topbar-logout-001',
        operatorSessionId: 'operator-session-current-001'
      });
    });
    vi.stubEnv('VITE_CONTROL_PLANE_MODE', 'http');
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', '/secure-panel');
    vi.stubGlobal('fetch', fetcher);
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        '/secure-panel/api/v1/auth/session',
        expect.objectContaining({
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': 'csrf-topbar-logout-001'
          }
        })
      );
    });
    expect(useAppStore.getState().authenticated).toBe(false);
  });

  it('calls the same-origin logout endpoint when production HTTP mode has no base URL', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            authenticated: false
          },
          requestId: 'req-topbar-same-origin-logout'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    act(() => {
      useAppStore.getState().authenticate({
        csrfToken: 'csrf-topbar-same-origin-logout-001',
        operatorSessionId: 'operator-session-current-001'
      });
    });
    vi.stubEnv('VITE_CONTROL_PLANE_MODE', 'http');
    vi.stubGlobal('fetch', fetcher);
    renderShell(createMockApi({ seedInventory: true }));

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        '/api/v1/auth/session',
        expect.objectContaining({
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': 'csrf-topbar-same-origin-logout-001'
          }
        })
      );
    });
    expect(useAppStore.getState().authenticated).toBe(false);
  });
});
