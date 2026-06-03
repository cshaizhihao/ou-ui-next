import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { useAppStore } from '../../app/app-store';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import type { Agent, AgentInstallMetadata } from '../../domain';
import type { ForwardRule, Tunnel } from '../../domain/forwarding';
import type { QuotaPolicy, RateLimitPolicy } from '../../domain/quota';
import type { CreateTaskInput } from '../../domain/task';
import { AuditPage } from '../../features/audit/audit-page';
import { DashboardPage } from '../../features/dashboard/dashboard-page';
import { ForwardingPage, type ForwardingCreateMetadata, type ForwardingRuleView } from '../../features/forwarding/forwarding-page';
import { NodesPage, type CustomerNodeConfigMetadata, type HostConfigMetadata } from '../../features/nodes/nodes-page';
import { PermissionsPage } from '../../features/permissions/permissions-page';
import { RoutingPage } from '../../features/routing/routing-page';
import {
  SubscriptionMixerPage,
  type SubscriptionClientRuleMetadata,
  type SubscriptionSourceImportMetadata
} from '../../features/subscriptions/subscription-mixer-page';
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
const EMPTY_INBOUNDS: ControlPlaneSnapshot['inbounds'] = [];
const EMPTY_SUBSCRIPTIONS: ControlPlaneSnapshot['subscriptionBundles'] = [];
const EMPTY_SUBSCRIPTION_SOURCES: ControlPlaneSnapshot['subscriptionSources'] = [];
const EMPTY_SUBSCRIPTION_CLIENTS: ControlPlaneSnapshot['subscriptionClients'] = [];
const EMPTY_QUOTA_POLICIES: ControlPlaneSnapshot['quotaPolicies'] = [];
const EMPTY_PERMISSION_GRANTS: ControlPlaneSnapshot['permissionGrants'] = [];
const EMPTY_ROUTING_POLICIES: ControlPlaneSnapshot['routingPolicies'] = [];
const EMPTY_TUNING_PROFILES: ControlPlaneSnapshot['tuningProfiles'] = [];
const EMPTY_TASKS: ControlPlaneSnapshot['tasks'] = [];
const EMPTY_CONFIG_REVISIONS: ControlPlaneSnapshot['configRevisions'] = [];
const EMPTY_PREFLIGHT_PLANS: ControlPlaneSnapshot['preflightPlans'] = [];
const EMPTY_RUNTIME_SNAPSHOTS: ControlPlaneSnapshot['runtimeSnapshots'] = [];
const EMPTY_AUDIT_LOGS: ControlPlaneSnapshot['auditLogs'] = [];
const EMPTY_TUNNELS: ControlPlaneSnapshot['tunnels'] = [];

function mapForwardRules(
  domainRules: ForwardRule[],
  tunnels: Tunnel[],
  quotaPolicies: QuotaPolicy[],
  rateLimitPolicies: RateLimitPolicy[],
  agents: Agent[]
): ForwardingRuleView[] {
  return domainRules.flatMap((rule) => {
    const port = rule.ports[0];

    if (!port) {
      return [];
    }

    const tunnel = tunnels.find((item) => item.id === rule.tunnelId);
    const hop = tunnel?.chain[0];
    const agent = agents.find((item) => item.id === port.agentId || item.id === hop?.agentId);
    const quota = quotaPolicies.find((item) => item.id === rule.quotaPolicyId);
    const rateLimit = rateLimitPolicies.find((item) => item.id === rule.rateLimitPolicyId);
    const ipRateLimit = rule.ipRateLimitPolicyId
      ? rateLimitPolicies.find((item) => item.id === rule.ipRateLimitPolicyId)
      : rateLimit;
    const sourceAddress = agent?.publicAddress ?? hop?.address.split(':')[0] ?? port.listenAddress;

    return [
      {
        id: rule.id,
        name: rule.name,
        ownerName: rule.ownerName,
        protocol: port.protocol,
        tunnelId: rule.tunnelId,
        tunnelName: tunnel?.name ?? rule.tunnelId,
        sourceAgentId: port.agentId ?? hop?.agentId ?? 'unassigned-agent',
        entryNodeIds: rule.ports.map((binding) => binding.agentId),
        sourceAddress,
        listenAddress: port.listenAddress,
        listenPort: port.listenPort,
        targetAddress: port.targetAddress,
        targetPort: port.targetPort,
        enabled: rule.enabled,
        portStatus: rule.portStatus,
        bindings: rule.ports,
        bindingCount: rule.ports.length,
        quotaBytes: rule.quotaBytes ?? quota?.limitBytes ?? 0,
        usedBytes: calculateForwardingUsedBytes(rule, quota),
        monthlyResetDay: rule.monthlyResetDay ?? 1,
        currentUsedTrafficGb: gbFromBytes(rule.manualUsedBytes ?? 0),
        rateLimitMbps: rule.rateLimitMbps ?? (rateLimit ? Math.min(rateLimit.inboundMbps, rateLimit.outboundMbps) : 0),
        ipRateLimitMbps:
          rule.ipRateLimitMbps ?? (ipRateLimit ? Math.min(ipRateLimit.inboundMbps, ipRateLimit.outboundMbps) : 0),
        billingDirection: rule.billingDirection,
        pricePerGb: rule.pricePerGb,
        tunnelMode: rule.tunnelMode,
        strategy: rule.strategy,
        maxConnections: rule.maxConnections,
        maxConnectionsPerIp: rule.maxConnectionsPerIp,
        proxyProtocol: rule.proxyProtocol
      }
    ];
  });
}

function createUiMutationContext(
  input: CreateTaskInput,
  idempotencyKeyOverride?: string,
  runtimeConfig?: { operatorGroupId: string; resourceGroupId: string }
): MutationContext {
  const idempotencyKey = idempotencyKeyOverride ?? `ui:${input.operation}:${input.targetId}`;

  return {
    actor: 'admin',
    operatorGroupId: runtimeConfig?.operatorGroupId ?? 'owner',
    resourceGroupId: runtimeConfig?.resourceGroupId ?? 'group-premium',
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
  return `agent-${createStableSlug(metadata.hostName, 'new-host')}`;
}

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function gbFromBytes(bytes: number) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function calculateForwardingUsedBytes(rule: ForwardRule, quota?: QuotaPolicy) {
  const manualUsedBytes = rule.manualUsedBytes ?? 0;
  const meteredBytes =
    rule.billingDirection === 'both'
      ? rule.inboundBytes + rule.outboundBytes
      : rule.billingDirection === 'single'
        ? Math.max(rule.inboundBytes, rule.outboundBytes)
        : rule.billingDirection === 'ingress'
          ? rule.inboundBytes
          : rule.outboundBytes;
  const calculatedBytes = manualUsedBytes + meteredBytes;

  return calculatedBytes > 0 ? calculatedBytes : quota?.usedBytes || 0;
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
    installAgentSummary: '生成一键主机接入命令',
    deployRuntimeSummary: '下发主机代理配置',
    deployRuntimeTarget: '香港入口主机',
    updateHostSummary: '更新受控主机资料',
    deleteHostSummary: '移除受控主机',
    createCustomerNodeSummary: '创建客户 Xray 入站',
    updateCustomerNodeSummary: '更新客户 Xray 入站',
    deleteCustomerNodeSummary: '删除客户 Xray 入站',
    createForwardingSummary: '创建多主机端口转发',
    createForwardingTarget: (listenPort: number) => `多主机端口转发 ${listenPort}`,
    applyForwardingSummary: '应用端口转发策略',
    applyForwardingTarget: '端口转发网络',
    deleteForwardingSummary: '删除端口转发规则',
    createSubscriptionClientSummary: '创建客户订阅规则',
    updateSubscriptionClientSummary: '更新客户订阅规则',
    deleteSubscriptionClientSummary: '删除客户订阅规则',
    generateSubscriptionSummary: '生成聚合订阅配置',
    importSubscriptionSourceSummary: '导入外部订阅源',
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
    installAgentSummary: 'Generate one-click host enrollment command',
    deployRuntimeSummary: 'Deploy host agent configuration',
    deployRuntimeTarget: 'Hong Kong ingress host',
    updateHostSummary: 'Update managed host profile',
    deleteHostSummary: 'Remove managed host',
    createCustomerNodeSummary: 'Create customer Xray inbound',
    updateCustomerNodeSummary: 'Update customer Xray inbound',
    deleteCustomerNodeSummary: 'Delete customer Xray inbound',
    createForwardingSummary: 'Create multi-host port forwarding',
    createForwardingTarget: (listenPort: number) => `Multi-host port forwarding ${listenPort}`,
    applyForwardingSummary: 'Apply port forwarding policy',
    applyForwardingTarget: 'Port forwarding fabric',
    deleteForwardingSummary: 'Delete port forwarding rule',
    createSubscriptionClientSummary: 'Create client subscription rule',
    updateSubscriptionClientSummary: 'Update client subscription rule',
    deleteSubscriptionClientSummary: 'Delete client subscription rule',
    generateSubscriptionSummary: 'Generate aggregated subscription bundle',
    importSubscriptionSourceSummary: 'Import external subscription source',
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
  const runtimeConfig = useMemo(() => resolveAppRuntimeConfig(), []);
  const language = useAppStore((state) => state.language);
  const t = shellCopy[language];
  const setLanguage = useAppStore((state) => state.setLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [deployDrawerOpen, setDeployDrawerOpen] = useState(false);
  const [deployTargetAgentId, setDeployTargetAgentId] = useState<string>();
  const taskMutationInFlightRef = useRef(false);
  const [taskMutationState, setTaskMutationState] = useState<{
    status: 'idle' | 'pending' | 'succeeded' | 'failed';
    message?: string;
  }>({ status: 'idle' });

  const activeNav = getNavigationItem(activePage, language);
  const snapshot = useControlPlaneSnapshot(ready);
  const agents = snapshot.data?.agents ?? EMPTY_AGENTS;
  const deployTargetAgent = agents.find((agent) => agent.id === deployTargetAgentId);
  const nodes = snapshot.data?.nodes ?? EMPTY_NODES;
  const inbounds = snapshot.data?.inbounds ?? EMPTY_INBOUNDS;
  const subscriptions = snapshot.data?.subscriptionBundles ?? EMPTY_SUBSCRIPTIONS;
  const subscriptionSources = snapshot.data?.subscriptionSources ?? EMPTY_SUBSCRIPTION_SOURCES;
  const subscriptionClients = snapshot.data?.subscriptionClients ?? EMPTY_SUBSCRIPTION_CLIENTS;
  const quotaPolicies = snapshot.data?.quotaPolicies ?? EMPTY_QUOTA_POLICIES;
  const permissionGrants = snapshot.data?.permissionGrants ?? EMPTY_PERMISSION_GRANTS;
  const routingPolicies = snapshot.data?.routingPolicies ?? EMPTY_ROUTING_POLICIES;
  const tuningProfiles = snapshot.data?.tuningProfiles ?? EMPTY_TUNING_PROFILES;
  const tasks = snapshot.data?.tasks ?? EMPTY_TASKS;
  const configRevisions = snapshot.data?.configRevisions ?? EMPTY_CONFIG_REVISIONS;
  const preflightPlans = snapshot.data?.preflightPlans ?? EMPTY_PREFLIGHT_PLANS;
  const runtimeSnapshots = snapshot.data?.runtimeSnapshots ?? EMPTY_RUNTIME_SNAPSHOTS;
  const auditLogs = snapshot.data?.auditLogs ?? EMPTY_AUDIT_LOGS;
  const tunnels = snapshot.data?.tunnels ?? EMPTY_TUNNELS;
  const taskMutationBusy = taskMutationState.status === 'pending';
  const forwardingRules = useMemo(
    () =>
      mapForwardRules(
        snapshot.data?.forwardRules ?? [],
        tunnels,
        snapshot.data?.quotaPolicies ?? [],
        snapshot.data?.rateLimitPolicies ?? [],
        snapshot.data?.agents ?? []
      ),
    [snapshot.data, tunnels]
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
        task = await api.createTask(
          input,
          createUiMutationContext(input, options?.idempotencyKey, runtimeConfig)
        );
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
    [api, runtimeConfig, snapshot, t.taskMutationFailed, t.taskMutationPending, t.taskQueued, t.taskQueuedDeferred]
  );

  const handleDeployHostConfig = useCallback((agent: Agent) => {
    setDeployTargetAgentId(agent.id);
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
          targetLabel: metadata.hostName,
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
    const targetAgent = deployTargetAgent ?? agents[0];
    void runTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: targetAgent?.id ?? 'agent-hkg-01',
      targetLabel: targetAgent?.name ?? t.deployRuntimeTarget,
      summary: t.deployRuntimeSummary
    });
    setDeployDrawerOpen(false);
  }, [agents, deployTargetAgent, runTask, t.deployRuntimeSummary, t.deployRuntimeTarget]);

  const handleSaveHostConfig = useCallback(
    (metadata: HostConfigMetadata) => {
      void runTask(
        {
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: metadata.agentId,
          targetLabel: metadata.hostName,
          summary: t.updateHostSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            'agent.update',
            metadata.agentId,
            metadata.hostName,
            metadata.maxTrafficGb,
            metadata.monthlyTrafficGb,
            metadata.trafficAccountingMode,
            metadata.monthlyResetDay,
            metadata.currentUsedTrafficGb,
            metadata.expiresAt,
            metadata.pingTarget,
            metadata.pingIntervalSeconds
          ].join(':')
        }
      );
    },
    [runTask, t.updateHostSummary]
  );

  const handleDeleteHost = useCallback(
    (metadata: HostConfigMetadata) => {
      void runTask(
        {
          operation: 'agent.delete',
          resourceType: 'agent',
          targetId: metadata.agentId,
          targetLabel: metadata.hostName,
          summary: t.deleteHostSummary,
          metadata
        },
        {
          idempotencyKey: ['ui', 'agent.delete', metadata.agentId].join(':')
        }
      );
    },
    [runTask, t.deleteHostSummary]
  );

  const handleSaveCustomerNode = useCallback(
    (metadata: CustomerNodeConfigMetadata, action: 'create' | 'update') => {
      const operation = action === 'create' ? 'inbound.create' : 'inbound.update';
      const targetId = metadata.nodeId || `inbound-${createStableSlug(metadata.customerNodeName, 'customer-node')}`;

      void runTask(
        {
          operation,
          resourceType: 'inbound',
          targetId,
          targetLabel: metadata.customerNodeName,
          summary: action === 'create' ? t.createCustomerNodeSummary : t.updateCustomerNodeSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            operation,
            metadata.agentId,
            metadata.nodeId,
            metadata.listenPort,
            metadata.xrayProtocol,
            metadata.customerName
          ].join(':')
        }
      );
    },
    [runTask, t.createCustomerNodeSummary, t.updateCustomerNodeSummary]
  );

  const handleDeleteCustomerNode = useCallback(
    (metadata: CustomerNodeConfigMetadata) => {
      void runTask(
        {
          operation: 'inbound.delete',
          resourceType: 'inbound',
          targetId: metadata.nodeId,
          targetLabel: metadata.customerNodeName,
          summary: t.deleteCustomerNodeSummary,
          metadata
        },
        {
          idempotencyKey: ['ui', 'inbound.delete', metadata.agentId, metadata.nodeId].join(':')
        }
      );
    },
    [runTask, t.deleteCustomerNodeSummary]
  );

  const handleCreateForwarding = useCallback(
    (metadata: ForwardingCreateMetadata, action: 'create' | 'update' = 'create', ruleId?: string) => {
      const operation = action === 'create' ? 'forward.create' : 'forward.update';
      const targetId = ruleId || `forward-custom-${metadata.listenPort}`;
      void runTask(
        {
          operation,
          resourceType: 'forward',
          targetId,
          targetLabel: metadata.name || t.createForwardingTarget(metadata.listenPort),
          summary: action === 'create' ? t.createForwardingSummary : t.applyForwardingSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            operation,
            targetId,
            metadata.tunnelId,
            metadata.listenAddress,
            metadata.listenPort,
            metadata.targetAddress,
            metadata.targetPort,
            metadata.protocol,
            metadata.entryNodeIds.join(','),
            metadata.billingDirection,
            metadata.monthlyResetDay,
            metadata.currentUsedTrafficGb
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

  const handleDeleteForwarding = useCallback(
    (rule: ForwardingRuleView) => {
      void runTask(
        {
          operation: 'forward.delete',
          resourceType: 'forward',
          targetId: rule.id,
          targetLabel: rule.name,
          summary: t.deleteForwardingSummary,
          metadata: {
            name: rule.name,
            ownerName: rule.ownerName,
            tunnelId: rule.tunnelId,
            listenAddress: rule.listenAddress,
            listenPort: rule.listenPort,
            targetAddress: rule.targetAddress,
            targetPort: rule.targetPort,
            protocol: rule.protocol,
            entryNodeIds: rule.entryNodeIds.length > 0 ? rule.entryNodeIds : [rule.sourceAgentId],
            strategy: rule.strategy,
            quotaGb: Math.round(rule.quotaBytes / 1024 / 1024 / 1024),
            monthlyResetDay: rule.monthlyResetDay,
            currentUsedTrafficGb: rule.currentUsedTrafficGb,
            rateLimitMbps: rule.rateLimitMbps,
            ipRateLimitMbps: rule.ipRateLimitMbps,
            maxConnections: rule.maxConnections,
            maxConnectionsPerIp: rule.maxConnectionsPerIp,
            proxyProtocol: rule.proxyProtocol,
            billingDirection: rule.billingDirection,
            tunnelMode: rule.tunnelMode
          }
        },
        {
          idempotencyKey: ['ui', 'forward.delete', rule.id, rule.entryNodeIds.join(',')].join(':')
        }
      );
    },
    [runTask, t.deleteForwardingSummary]
  );

  const handleImportSubscriptionSource = useCallback(
    (metadata: SubscriptionSourceImportMetadata) => {
      const targetId = metadata.sourceId || `subscription-source-${createStableSlug(metadata.name, 'external-source')}`;

      void runTask(
        {
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId,
          targetLabel: metadata.name,
          summary: t.importSubscriptionSourceSummary,
          metadata
        },
        {
          idempotencyKey: ['ui', 'subscription.import', metadata.kind, metadata.url].join(':')
        }
      );
    },
    [runTask, t.importSubscriptionSourceSummary]
  );

  const handleSaveSubscriptionClient = useCallback(
    (metadata: SubscriptionClientRuleMetadata, action: 'create' | 'update') => {
      void runTask(
        {
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: metadata.subscriptionClientId,
          targetLabel: metadata.displayName,
          summary: action === 'create' ? t.createSubscriptionClientSummary : t.updateSubscriptionClientSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            'subscription.generate',
            metadata.subscriptionClientId,
            metadata.subId,
            metadata.protocol,
            metadata.sourceIds.join(','),
            metadata.selectedTags.join(','),
            metadata.formats.join(',')
          ].join(':')
        }
      );
    },
    [runTask, t.createSubscriptionClientSummary, t.updateSubscriptionClientSummary]
  );

  const handleDeleteSubscriptionClient = useCallback(
    (metadata: SubscriptionClientRuleMetadata) => {
      void runTask(
        {
          operation: 'subscription.delete',
          resourceType: 'subscription',
          targetId: metadata.subscriptionClientId,
          targetLabel: metadata.displayName,
          summary: t.deleteSubscriptionClientSummary,
          metadata
        },
        {
          idempotencyKey: ['ui', 'subscription.delete', metadata.subscriptionClientId].join(':')
        }
      );
    },
    [runTask, t.deleteSubscriptionClientSummary]
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
            inbounds={inbounds}
            language={language}
            taskMutationBusy={taskMutationBusy}
            onDeleteCustomerNode={handleDeleteCustomerNode}
            onDeleteHost={handleDeleteHost}
            onDeployHostConfig={handleDeployHostConfig}
            onInstallAgent={handleInstallAgent}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
            onSaveHostConfig={handleSaveHostConfig}
            onSaveCustomerNode={handleSaveCustomerNode}
          />
        );
      case 'forwarding':
        return (
          <ForwardingPage
            agents={agents}
            language={language}
            rules={forwardingRules}
            taskMutationBusy={taskMutationBusy}
            tunnels={tunnels}
            onCreateForwarding={handleCreateForwarding}
            onDeleteForwarding={handleDeleteForwarding}
            onRunTask={handleRunForwarding}
          />
        );
      case 'subscriptions':
        return (
          <SubscriptionMixerPage
            language={language}
            subscriptions={subscriptions}
            subscriptionClients={subscriptionClients}
            subscriptionSources={subscriptionSources}
            taskMutationBusy={taskMutationBusy}
            onImportSource={handleImportSubscriptionSource}
            onDeleteClient={handleDeleteSubscriptionClient}
            onRunTask={handleRunSubscription}
            onSaveClient={handleSaveSubscriptionClient}
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
    handleDeleteCustomerNode,
    handleDeleteForwarding,
    handleDeleteHost,
    handleDeleteSubscriptionClient,
    handleDeployHostConfig,
    handleInstallAgent,
    handleImportSubscriptionSource,
    handleRollbackTask,
    handleRunForwarding,
    handleRunPermission,
    handleRunRouting,
    handleRunSubscription,
    handleRunTuning,
    handleSaveCustomerNode,
    handleSaveHostConfig,
    handleSaveSubscriptionClient,
    inbounds,
    language,
    nodes,
    permissionGrants,
    previewAgentInstallCommand,
    preflightPlans,
    quotaPolicies,
    refreshControlPlane,
    routingPolicies,
    runtimeSnapshots,
    subscriptionClients,
    subscriptionSources,
    subscriptions,
    taskMutationBusy,
    tasks,
    tunnels,
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
        title={language === 'zh' ? '下发主机配置' : 'Deploy Host Config'}
        description={
          language === 'zh'
            ? `将 ${deployTargetAgent?.name ?? t.deployRuntimeTarget} 的客户节点、Xray 入站与端口转发配置编译为可回滚版本，并下发给这台受控主机。`
            : `Compile customer nodes, Xray inbounds, and port-forwarding rules for ${deployTargetAgent?.name ?? t.deployRuntimeTarget}, then deploy a rollback-ready version to that managed host.`
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
