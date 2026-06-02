import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { useAppStore } from '../../app/app-store';
import type { Agent, AgentInstallMetadata } from '../../domain';
import type { ForwardRule, Tunnel } from '../../domain/forwarding';
import type { QuotaPolicy, RateLimitPolicy } from '../../domain/quota';
import type { CreateTaskInput } from '../../domain/task';
import { AuditPage } from '../../features/audit/audit-page';
import { DashboardPage } from '../../features/dashboard/dashboard-page';
import { ForwardingPage, type ForwardingCreateMetadata, type ForwardingRule } from '../../features/forwarding/forwarding-page';
import { NodesPage } from '../../features/nodes/nodes-page';
import { PermissionsPage } from '../../features/permissions/permissions-page';
import { RoutingPage } from '../../features/routing/routing-page';
import { SubscriptionMixerPage } from '../../features/subscriptions/subscription-mixer-page';
import { TasksPage } from '../../features/tasks/tasks-page';
import { TuningPage } from '../../features/tuning/tuning-page';
import type { MutationContext } from '../../services/api/control-plane-api';
import { useControlPlaneSnapshot, type ControlPlaneSnapshot } from '../../services/api/use-control-plane-snapshot';
import { useApi } from '../../services/api/use-api';
import { ActionOverlay } from './action-overlay';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

type AppShellProps = {
  ready: boolean;
};

const EMPTY_AGENTS: ControlPlaneSnapshot['agents'] = [];
const EMPTY_NODES: ControlPlaneSnapshot['nodes'] = [];
const EMPTY_SUBSCRIPTIONS: ControlPlaneSnapshot['subscriptionBundles'] = [];
const EMPTY_QUOTA_POLICIES: ControlPlaneSnapshot['quotaPolicies'] = [];
const EMPTY_PERMISSION_GRANTS: ControlPlaneSnapshot['permissionGrants'] = [];
const EMPTY_ROUTING_POLICIES: ControlPlaneSnapshot['routingPolicies'] = [];
const EMPTY_TUNING_PROFILES: ControlPlaneSnapshot['tuningProfiles'] = [];
const EMPTY_TASKS: ControlPlaneSnapshot['tasks'] = [];
const EMPTY_CONFIG_REVISIONS: ControlPlaneSnapshot['configRevisions'] = [];
const EMPTY_PREFLIGHT_PLANS: ControlPlaneSnapshot['preflightPlans'] = [];
const EMPTY_RUNTIME_SNAPSHOTS: ControlPlaneSnapshot['runtimeSnapshots'] = [];
const EMPTY_AUDIT_LOGS: ControlPlaneSnapshot['auditLogs'] = [];

function mapForwardRules(
  domainRules: ForwardRule[],
  tunnels: Tunnel[],
  quotaPolicies: QuotaPolicy[],
  rateLimitPolicies: RateLimitPolicy[],
  agents: Agent[]
): ForwardingRule[] {
  return domainRules.flatMap((rule) => {
    const port = rule.ports[0];

    if (!port) {
      return [];
    }

    const tunnel = tunnels.find((item) => item.id === rule.tunnelId);
    const hop = tunnel?.chain[0];
    const agent = agents.find((item) => item.id === hop?.agentId);
    const quota = quotaPolicies.find((item) => item.id === rule.quotaPolicyId);
    const rateLimit = rateLimitPolicies.find((item) => item.id === rule.rateLimitPolicyId);
    const sourceAddress = agent?.publicAddress ?? hop?.address.split(':')[0] ?? port.listenAddress;

    return [
      {
        id: rule.id,
        name: rule.name,
        protocol: port.protocol,
        sourceAgentId: hop?.agentId ?? 'unassigned-agent',
        sourceAddress,
        listenPort: port.listenPort,
        targetAddress: port.targetAddress,
        targetPort: port.targetPort,
        enabled: rule.enabled,
        quotaBytes: quota?.limitBytes ?? 0,
        usedBytes: quota?.usedBytes ?? 0,
        rateLimitMbps: rateLimit ? Math.min(rateLimit.inboundMbps, rateLimit.outboundMbps) : 0,
        billingDirection: rule.billingDirection,
        pricePerGb: rule.pricePerGb,
        tunnelMode: rule.tunnelMode
      }
    ];
  });
}

function createUiMutationContext(input: CreateTaskInput, idempotencyKeyOverride?: string): MutationContext {
  const idempotencyKey = idempotencyKeyOverride ?? `ui:${input.operation}:${input.targetId}`;

  return {
    actor: 'admin',
    sourceIp: 'ui-preview',
    requestId: idempotencyKey,
    idempotencyKey
  };
}

function findRollbackSnapshotId(
  taskId: string,
  targetId: string,
  configRevisions: ControlPlaneSnapshot['configRevisions'],
  runtimeSnapshots: ControlPlaneSnapshot['runtimeSnapshots']
) {
  const configRevision = configRevisions.find((revision) => revision.taskId === taskId);

  if (configRevision && runtimeSnapshots.some((snapshot) => snapshot.id === configRevision.snapshotBeforeId)) {
    return configRevision.snapshotBeforeId;
  }

  return runtimeSnapshots.find((snapshot) => snapshot.taskId === taskId && snapshot.targetId === targetId)?.id;
}

function createAgentTargetId(metadata: AgentInstallMetadata) {
  const hostSlug = metadata.hostName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `agent-${hostSlug || 'new-host'}`;
}

function createBrowserPublicBaseUrl() {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;
  const basePath = import.meta.env.BASE_URL ?? '/';
  return new URL(basePath, origin).toString().replace(/\/+$/, '');
}

const shellCopy = {
  zh: {
    taskMutationPending: '变更提交中',
    taskQueued: '执行记录已创建',
    taskQueuedDeferred: '执行记录已创建，刷新延后执行',
    taskMutationFailed: '变更提交失败',
    taskNotFound: (taskId: string) => `未找到执行记录：${taskId}`,
    taskNotRollbackReady: (taskId: string) => `当前记录不可回滚：${taskId}`,
    installAgentSummary: '生成一键 Agent 安装命令',
    deployRuntimeSummary: '下发 Universal Agent 配置',
    deployRuntimeTarget: '香港入口 Agent',
    createForwardingSummary: '创建多主机端口转发',
    createForwardingTarget: (listenPort: number) => `多主机端口转发 ${listenPort}`,
    applyForwardingSummary: '应用 FLVX 转发策略',
    applyForwardingTarget: 'FLVX 隧道网络',
    generateSubscriptionSummary: '生成聚合订阅配置',
    generateSubscriptionTarget: '订阅聚合器',
    compileRoutingSummary: '编译分流策略',
    compileRoutingTarget: '分流策略',
    tuningSummary: '下发系统调优变更',
    tuningTarget: '系统调优',
    permissionSummary: '提交隧道分组权限变更',
    permissionTarget: '分组授权',
    rollbackSummary: (targetLabel: string) => `回滚 ${targetLabel} 运行时快照`
  },
  en: {
    taskMutationPending: 'Change submission in progress',
    taskQueued: 'Execution record created',
    taskQueuedDeferred: 'Execution record created; refresh deferred',
    taskMutationFailed: 'Change submission failed',
    taskNotFound: (taskId: string) => `Execution record not found: ${taskId}`,
    taskNotRollbackReady: (taskId: string) => `Execution record is not rollback-ready: ${taskId}`,
    installAgentSummary: 'Generate one-click Agent install command',
    deployRuntimeSummary: 'Deploy Universal Agent configuration',
    deployRuntimeTarget: 'Hong Kong ingress Agent',
    createForwardingSummary: 'Create multi-host port forwarding',
    createForwardingTarget: (listenPort: number) => `Multi-host port forwarding ${listenPort}`,
    applyForwardingSummary: 'Apply FLVX forwarding policy',
    applyForwardingTarget: 'FLVX tunnel fabric',
    generateSubscriptionSummary: 'Generate aggregated subscription bundle',
    generateSubscriptionTarget: 'Subscription mixer',
    compileRoutingSummary: 'Compile routing policy',
    compileRoutingTarget: 'Routing policy',
    tuningSummary: 'Dispatch system tuning change',
    tuningTarget: 'System tuning',
    permissionSummary: 'Submit tunnel-group permission change',
    permissionTarget: 'Group authorization',
    rollbackSummary: (targetLabel: string) => `Rollback ${targetLabel} runtime snapshot`
  }
} as const;

export function AppShell({ ready }: AppShellProps) {
  const api = useApi();
  const language = useAppStore((state) => state.language);
  const t = shellCopy[language];
  const setLanguage = useAppStore((state) => state.setLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [deployDrawerOpen, setDeployDrawerOpen] = useState(false);
  const taskMutationInFlightRef = useRef(false);
  const [taskMutationState, setTaskMutationState] = useState<{
    status: 'idle' | 'pending' | 'succeeded' | 'failed';
    message?: string;
  }>({ status: 'idle' });

  const activeNav = getNavigationItem(activePage, language);
  const snapshot = useControlPlaneSnapshot(ready);
  const agents = snapshot.data?.agents ?? EMPTY_AGENTS;
  const nodes = snapshot.data?.nodes ?? EMPTY_NODES;
  const subscriptions = snapshot.data?.subscriptionBundles ?? EMPTY_SUBSCRIPTIONS;
  const quotaPolicies = snapshot.data?.quotaPolicies ?? EMPTY_QUOTA_POLICIES;
  const permissionGrants = snapshot.data?.permissionGrants ?? EMPTY_PERMISSION_GRANTS;
  const routingPolicies = snapshot.data?.routingPolicies ?? EMPTY_ROUTING_POLICIES;
  const tuningProfiles = snapshot.data?.tuningProfiles ?? EMPTY_TUNING_PROFILES;
  const tasks = snapshot.data?.tasks ?? EMPTY_TASKS;
  const configRevisions = snapshot.data?.configRevisions ?? EMPTY_CONFIG_REVISIONS;
  const preflightPlans = snapshot.data?.preflightPlans ?? EMPTY_PREFLIGHT_PLANS;
  const runtimeSnapshots = snapshot.data?.runtimeSnapshots ?? EMPTY_RUNTIME_SNAPSHOTS;
  const auditLogs = snapshot.data?.auditLogs ?? EMPTY_AUDIT_LOGS;
  const taskMutationBusy = taskMutationState.status === 'pending';
  const forwardingRules = useMemo(
    () =>
      mapForwardRules(
        snapshot.data?.forwardRules ?? [],
        snapshot.data?.tunnels ?? [],
        snapshot.data?.quotaPolicies ?? [],
        snapshot.data?.rateLimitPolicies ?? [],
        snapshot.data?.agents ?? []
      ),
    [snapshot.data]
  );

  const refreshControlPlane = useCallback(() => {
    void snapshot.refetch();
  }, [snapshot]);

  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.tilt-card'));

    function handleMove(this: HTMLElement, event: MouseEvent) {
      const rect = this.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const rotateX = (y / rect.height - 0.5) * -8;
      const rotateY = (x / rect.width - 0.5) * 8;
      this.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
    }

    function handleLeave(this: HTMLElement) {
      this.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    }

    cards.forEach((card) => {
      card.addEventListener('mousemove', handleMove);
      card.addEventListener('mouseleave', handleLeave);
    });

    return () => {
      cards.forEach((card) => {
        card.removeEventListener('mousemove', handleMove);
        card.removeEventListener('mouseleave', handleLeave);
      });
    };
  }, [
    activePage,
    agents,
    nodes,
    forwardingRules,
    subscriptions,
    permissionGrants,
    quotaPolicies,
    routingPolicies,
    tuningProfiles,
    tasks,
    configRevisions,
    preflightPlans,
    runtimeSnapshots,
    auditLogs
  ]);

  const runTask = useCallback(
    async (input: CreateTaskInput, options?: { idempotencyKey?: string }) => {
      if (taskMutationInFlightRef.current) {
        setTaskMutationState({ status: 'pending', message: t.taskMutationPending });
        return undefined;
      }

      taskMutationInFlightRef.current = true;
      setTaskMutationState({ status: 'pending', message: t.taskMutationPending });

      let task;

      try {
        task = await api.createTask(input, createUiMutationContext(input, options?.idempotencyKey));
      } catch (error) {
        const message = error instanceof Error ? error.message : t.taskMutationFailed;
        setTaskMutationState({ status: 'failed', message });
        taskMutationInFlightRef.current = false;
        return undefined;
      }

      setTaskMutationState({ status: 'succeeded', message: t.taskQueued });

      try {
        await snapshot.refetch();
      } catch {
        setTaskMutationState({ status: 'succeeded', message: t.taskQueuedDeferred });
      } finally {
        taskMutationInFlightRef.current = false;
      }

      return task;
    },
    [api, snapshot, t.taskMutationFailed, t.taskMutationPending, t.taskQueued, t.taskQueuedDeferred]
  );

  const handleDeployRuntimeConfig = useCallback(() => {
    setDeployDrawerOpen(true);
  }, []);

  const handleInstallAgent = useCallback(
    (metadata: AgentInstallMetadata) => {
      const targetId = createAgentTargetId(metadata);
      void runTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId,
          targetLabel: `${metadata.hostName} / ${metadata.customerNodeName}`,
          summary: t.installAgentSummary,
          metadata
        },
        {
          idempotencyKey: `ui:agent.install:${targetId}`
        }
      );
    },
    [runTask, t.installAgentSummary]
  );

  const previewAgentInstallCommand = useCallback(
    (metadata: AgentInstallMetadata) =>
      api.createAgentInstallCommand(
        {
          ...metadata,
          publicBaseUrl: createBrowserPublicBaseUrl()
        },
        {
          actor: 'admin',
          sourceIp: 'ui-preview',
          requestId: `ui:agent-install-command:${metadata.hostName}`,
          idempotencyKey: `ui:agent-install-command:${metadata.hostName}`
        }
      ),
    [api]
  );

  const confirmDeployRuntimeConfig = useCallback(() => {
    void runTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: agents[0]?.id ?? 'agent-hkg-01',
      targetLabel: agents[0]?.name ?? t.deployRuntimeTarget,
      summary: t.deployRuntimeSummary
    });
    setDeployDrawerOpen(false);
  }, [agents, runTask, t.deployRuntimeSummary, t.deployRuntimeTarget]);

  const handleCreateForwarding = useCallback(
    (metadata: ForwardingCreateMetadata) => {
      const targetId = `forward-custom-${metadata.listenPort}`;
      void runTask(
        {
          operation: 'forward.create',
          resourceType: 'forward',
          targetId,
          targetLabel: t.createForwardingTarget(metadata.listenPort),
          summary: t.createForwardingSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            'forward.create',
            metadata.listenPort,
            metadata.targetAddress,
            metadata.targetPort,
            metadata.agentIds.join(',')
          ].join(':')
        }
      );
    },
    [runTask, t]
  );

  const handleRunForwarding = useCallback(
    (id: string) => {
      const rule = forwardingRules.find((item) => item.id === id);
      void runTask({
        operation: 'forward.apply',
        targetId: id,
        targetLabel: rule?.name ?? t.applyForwardingTarget,
        summary: t.applyForwardingSummary
      });
    },
    [forwardingRules, runTask, t.applyForwardingSummary, t.applyForwardingTarget]
  );

  const handleRunSubscription = useCallback(
    (id: string) => {
      const bundle = subscriptions.find((item) => item.id === id);
      void runTask({
        operation: 'subscription.generate',
        targetId: id,
        targetLabel: bundle?.name ?? t.generateSubscriptionTarget,
        summary: t.generateSubscriptionSummary
      });
    },
    [runTask, subscriptions, t.generateSubscriptionSummary, t.generateSubscriptionTarget]
  );

  const handleRunRouting = useCallback(
    (id: string) => {
      void runTask({
        operation: 'config.compile',
        targetId: id,
        targetLabel: t.compileRoutingTarget,
        summary: t.compileRoutingSummary
      });
    },
    [runTask, t.compileRoutingSummary, t.compileRoutingTarget]
  );

  const handleRunTuning = useCallback(
    (id: string) => {
      const profile = tuningProfiles.find((item) => item.id === id);
      void runTask({
        operation: 'system.tune',
        targetId: id,
        targetLabel: profile?.name ?? t.tuningTarget,
        summary: t.tuningSummary
      });
    },
    [runTask, t.tuningSummary, t.tuningTarget, tuningProfiles]
  );

  const handleRunPermission = useCallback(
    (id: string) => {
      const grant = permissionGrants.find((item) => item.id === id);
      void runTask({
        operation: 'permission.grant',
        targetId: id,
        targetLabel: grant ? `${grant.subjectType}:${grant.subjectId} -> ${grant.resourceId}` : t.permissionTarget,
        summary: t.permissionSummary
      });
    },
    [permissionGrants, runTask, t.permissionSummary, t.permissionTarget]
  );

  const handleRollbackTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);

      if (!task) {
        setTaskMutationState({ status: 'failed', message: t.taskNotFound(taskId) });
        return;
      }

      if (!task.rollbackAvailable || task.status !== 'succeeded') {
        setTaskMutationState({ status: 'failed', message: t.taskNotRollbackReady(taskId) });
        return;
      }

      const snapshotId = findRollbackSnapshotId(task.id, task.targetId, configRevisions, runtimeSnapshots);
      const rollbackIdempotencyKey = ['ui', 'agent.rollback', task.targetId, task.id, snapshotId]
        .filter(Boolean)
        .join(':');

      void runTask(
        {
          operation: 'agent.rollback',
          resourceType: task.resourceType,
          targetId: task.targetId,
          targetLabel: task.targetLabel,
          summary: t.rollbackSummary(task.targetLabel)
        },
        {
          idempotencyKey: rollbackIdempotencyKey
        }
      );
    },
    [configRevisions, runTask, runtimeSnapshots, t, tasks]
  );

  const content = useMemo(() => {
    switch (activePage) {
      case 'nodes':
        return (
          <NodesPage
            agents={agents}
            language={language}
            nodes={nodes}
            taskMutationBusy={taskMutationBusy}
            onInstallAgent={handleInstallAgent}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
          />
        );
      case 'forwarding':
        return (
          <ForwardingPage
            agents={agents}
            language={language}
            rules={forwardingRules}
            taskMutationBusy={taskMutationBusy}
            onCreateForwarding={handleCreateForwarding}
            onRunTask={handleRunForwarding}
          />
        );
      case 'subscriptions':
        return (
          <SubscriptionMixerPage
            language={language}
            subscriptions={subscriptions}
            taskMutationBusy={taskMutationBusy}
            onRunTask={handleRunSubscription}
          />
        );
      case 'routing':
        return (
          <RoutingPage
            language={language}
            policies={routingPolicies}
            taskMutationBusy={taskMutationBusy}
            onRunTask={handleRunRouting}
          />
        );
      case 'permissions':
        return (
          <PermissionsPage
            forwardingRules={forwardingRules}
            grants={permissionGrants}
            language={language}
            quotaPolicies={quotaPolicies}
            taskMutationBusy={taskMutationBusy}
            onRunTask={handleRunPermission}
          />
        );
      case 'tuning':
        return (
          <TuningPage
            language={language}
            profiles={tuningProfiles}
            taskMutationBusy={taskMutationBusy}
            onRunTask={handleRunTuning}
          />
        );
      case 'tasks':
        return (
          <TasksPage
            tasks={tasks}
            configRevisions={configRevisions}
            language={language}
            preflightPlans={preflightPlans}
            runtimeSnapshots={runtimeSnapshots}
            taskMutationBusy={taskMutationBusy}
            onRollbackTask={handleRollbackTask}
            onRefresh={() => void refreshControlPlane()}
          />
        );
      case 'audit':
        return <AuditPage auditLogs={auditLogs} language={language} />;
      case 'dashboard':
      default:
        return (
          <DashboardPage
            agents={agents}
            nodes={nodes}
            tasks={tasks}
            auditLogs={auditLogs}
            forwardingRules={forwardingRules}
            subscriptions={subscriptions}
            configRevisions={configRevisions}
            preflightPlans={preflightPlans}
            runtimeSnapshots={runtimeSnapshots}
            language={language}
            onRefresh={() => void refreshControlPlane()}
          />
        );
    }
  }, [
    activePage,
    agents,
    auditLogs,
    configRevisions,
    forwardingRules,
    handleCreateForwarding,
    handleInstallAgent,
    handleRollbackTask,
    handleRunForwarding,
    handleRunPermission,
    handleRunRouting,
    handleRunSubscription,
    handleRunTuning,
    language,
    nodes,
    permissionGrants,
    previewAgentInstallCommand,
    preflightPlans,
    quotaPolicies,
    refreshControlPlane,
    routingPolicies,
    runtimeSnapshots,
    subscriptions,
    taskMutationBusy,
    tasks,
    tuningProfiles
  ]);

  return (
    <div aria-hidden={!ready} className={ready ? 'app-container app-ready' : 'app-container'} id="app-main">
      <Sidebar activePage={activePage} language={language} onPageChange={setActivePage} />
      <main className="island-panel min-w-0 flex-1 max-md:min-h-[640px]">
        <Topbar
          title={activeNav.label}
          subtitle={activeNav.description}
          language={language}
          onDeployRuntimeConfig={handleDeployRuntimeConfig}
          onLanguageChange={setLanguage}
          onToggleTheme={toggleTheme}
        />
        <div className="relative flex-1 overflow-y-auto p-8 max-md:p-4">
          {taskMutationState.status !== 'idle' ? (
            <div
              role={taskMutationState.status === 'failed' ? 'alert' : 'status'}
              className={
                taskMutationState.status === 'failed'
                  ? 'mb-4 rounded-xl border border-red-200 bg-red-50/80 p-3 text-xs font-semibold text-red-600 backdrop-blur-xl dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200'
                  : 'mb-4 rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs font-semibold text-blue-600 backdrop-blur-xl dark:border-primary/20 dark:bg-primary/10 dark:text-primary'
              }
            >
              <span className="font-mono uppercase tracking-widest">
                {taskMutationState.status === 'failed' ? t.taskMutationFailed : taskMutationState.message}
              </span>
              {taskMutationState.status === 'failed' && taskMutationState.message ? (
                <span className="ml-2">{taskMutationState.message}</span>
              ) : null}
            </div>
          ) : null}
          <section className="page-view active">{content}</section>
        </div>
      </main>
      <ActionOverlay
        open={deployDrawerOpen}
        title={language === 'zh' ? '运行时配置下发预检' : 'Runtime Config Preflight'}
        description={
          language === 'zh'
            ? '这一步会创建可回滚的 Agent 配置下发任务，并等待已接入 Agent 回传执行结果。'
            : 'This creates a rollback-ready Agent configuration task and waits for the enrolled Agent result.'
        }
        confirmLabel={language === 'zh' ? '确认下发' : 'Confirm Deploy'}
        confirmDisabled={taskMutationBusy}
        language={language}
        onClose={() => setDeployDrawerOpen(false)}
        onConfirm={confirmDeployRuntimeConfig}
      />
    </div>
  );
}
