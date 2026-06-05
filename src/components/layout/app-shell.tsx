import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNavigationItem, type PageId } from '../../app/navigation';
import { useAppStore, type AppLanguage } from '../../app/app-store';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import {
  selectSubscriptionExportProfileForClient,
  type Agent,
  type AgentCredentialSummary,
  type AgentInstallMetadata,
  type OperatorSessionSummary,
  type SubscriptionClientFormat,
  type SubscriptionExportFile,
  type SubscriptionSource
} from '../../domain';
import { calculateForwardingBilledBytes, type ForwardRule } from '../../domain/forwarding';
import type { QuotaPolicy, RateLimitPolicy } from '../../domain/quota';
import type { CreateTaskInput } from '../../domain/task';
import { AuditPage } from '../../features/audit/audit-page';
import { CustomersPage } from '../../features/customers/customers-page';
import { DashboardPage } from '../../features/dashboard/dashboard-page';
import {
  ForwardingPage,
  type ForwardingCreateMetadata,
  type ForwardingRuleView
} from '../../features/forwarding/forwarding-page';
import { NodesPage, type CustomerNodeConfigMetadata, type HostConfigMetadata } from '../../features/nodes/nodes-page';
import { PermissionsPage } from '../../features/permissions/permissions-page';
import { RoutingPage } from '../../features/routing/routing-page';
import {
  SubscriptionMixerPage,
  type SubscriptionClientRuleMetadata,
  type SubscriptionExportProfileMetadata,
  type SubscriptionSourceImportMetadata
} from '../../features/subscriptions/subscription-mixer-page';
import { TasksPage } from '../../features/tasks/tasks-page';
import { TuningPage } from '../../features/tuning/tuning-page';
import { createOperatorSessionUrl } from '../../features/auth/operator-session-url';
import type { MutationContext } from '../../services/api/control-plane-api';
import { useControlPlaneSnapshot, type ControlPlaneSnapshot } from '../../services/api/use-control-plane-snapshot';
import { useApi } from '../../services/api/use-api';
import { useOperatorSessions } from '../../services/api/use-operator-sessions';
import { ActionOverlay } from './action-overlay';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

type AppShellProps = {
  ready: boolean;
};

const EMPTY_AGENTS: ControlPlaneSnapshot['agents'] = [];
const EMPTY_CUSTOMERS: ControlPlaneSnapshot['customers'] = [];
const EMPTY_NODES: ControlPlaneSnapshot['nodes'] = [];
const EMPTY_INBOUNDS: ControlPlaneSnapshot['inbounds'] = [];
const EMPTY_SUBSCRIPTIONS: ControlPlaneSnapshot['subscriptionBundles'] = [];
const EMPTY_SUBSCRIPTION_SOURCES: ControlPlaneSnapshot['subscriptionSources'] = [];
const EMPTY_SUBSCRIPTION_INVENTORY_NODES: ControlPlaneSnapshot['subscriptionInventoryNodes'] = [];
const EMPTY_SUBSCRIPTION_CLIENTS: ControlPlaneSnapshot['subscriptionClients'] = [];
const EMPTY_SUBSCRIPTION_EXPORT_PROFILES: ControlPlaneSnapshot['subscriptionExportProfiles'] = [];
const EMPTY_PROXY_PROVIDERS: ControlPlaneSnapshot['proxyProviders'] = [];
const EMPTY_SUBSCRIPTION_EXPORT_FILES: ControlPlaneSnapshot['subscriptionExportFiles'] = [];
const EMPTY_QUOTA_POLICIES: ControlPlaneSnapshot['quotaPolicies'] = [];
const EMPTY_PERMISSION_GRANTS: ControlPlaneSnapshot['permissionGrants'] = [];
const EMPTY_ROUTING_POLICIES: ControlPlaneSnapshot['routingPolicies'] = [];
const EMPTY_TUNING_PROFILES: ControlPlaneSnapshot['tuningProfiles'] = [];
const EMPTY_TASKS: ControlPlaneSnapshot['tasks'] = [];
const EMPTY_CONFIG_REVISIONS: ControlPlaneSnapshot['configRevisions'] = [];
const EMPTY_PREFLIGHT_PLANS: ControlPlaneSnapshot['preflightPlans'] = [];
const EMPTY_RUNTIME_SNAPSHOTS: ControlPlaneSnapshot['runtimeSnapshots'] = [];
const EMPTY_TRAFFIC_ROLLUPS: ControlPlaneSnapshot['trafficRollups'] = [];
const EMPTY_SYSTEM_ALERTS: ControlPlaneSnapshot['systemAlerts'] = [];
const DEFAULT_AGENT_LOG_RETENTION_POLICY: ControlPlaneSnapshot['agentLogRetentionPolicy'] = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxAgeDays: 7,
  maxEventsPerAgent: 5000,
  source: 'runtime-config'
};
const EMPTY_AGENT_CREDENTIALS: AgentCredentialSummary[] = [];
const EMPTY_AGENT_LOG_CHUNKS: ControlPlaneSnapshot['agentLogChunks'] = [];
const EMPTY_AUDIT_LOGS: ControlPlaneSnapshot['auditLogs'] = [];
const EMPTY_OPERATOR_SESSIONS: OperatorSessionSummary[] = [];
function mapForwardRules(
  domainRules: ForwardRule[],
  quotaPolicies: QuotaPolicy[],
  rateLimitPolicies: RateLimitPolicy[],
  agents: Agent[]
): ForwardingRuleView[] {
  return domainRules.flatMap((rule) => {
    const port = rule.ports[0];

    if (!port) {
      return [];
    }

    const agent = agents.find((item) => item.id === port.agentId);
    const quota = quotaPolicies.find((item) => item.id === rule.quotaPolicyId);
    const rateLimit = rateLimitPolicies.find((item) => item.id === rule.rateLimitPolicyId);
    const ipRateLimit = rule.ipRateLimitPolicyId
      ? rateLimitPolicies.find((item) => item.id === rule.ipRateLimitPolicyId)
      : rateLimit;
    const sourceAddress = agent?.publicAddress ?? port.listenAddress;

    return [
      {
        id: rule.id,
        name: rule.name,
        ownerName: rule.ownerName,
        protocol: port.protocol,
        tunnelId: rule.tunnelId,
        tunnelName: rule.tunnelId,
        sourceAgentId: port.agentId ?? 'unassigned-agent',
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
        proxyProtocol: rule.proxyProtocol,
        quotaExceeded: rule.quotaExceeded,
        runtimeDisabledByPolicy: rule.runtimeDisabledByPolicy,
        guardrailReason: rule.guardrailReason
      }
    ];
  });
}

function createUiMutationContext(
  input: CreateTaskInput,
  idempotencyKeyOverride?: string,
  runtimeConfig?: { loginUsername: string; operatorGroupId: string; resourceGroupId: string }
): MutationContext {
  return createUiRequestContext(input.operation, input.targetId, runtimeConfig, idempotencyKeyOverride);
}

function createUiRequestContext(
  operation: string,
  targetId: string,
  runtimeConfig?: { loginUsername: string; operatorGroupId: string; resourceGroupId: string },
  idempotencyKeyOverride?: string
): MutationContext {
  const rawIdempotencyKey = idempotencyKeyOverride ?? `ui:${operation}:${targetId}`;
  const idempotencyKey = createBoundedMutationKey(rawIdempotencyKey, 190);
  const requestId = createBoundedMutationKey(idempotencyKey, 150);

  return {
    actor: runtimeConfig?.loginUsername ?? 'local-operator',
    operatorGroupId: runtimeConfig?.operatorGroupId ?? 'owner',
    resourceGroupId: runtimeConfig?.resourceGroupId ?? 'group-premium',
    sourceIp: 'ui-preview',
    requestId,
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

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function withRiskConfirmation<T extends CreateTaskInput>(
  input: T
): T & { riskConfirmation: NonNullable<CreateTaskInput['riskConfirmation']> } {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function createBoundedMutationKey(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const [scope = 'ui', operation = 'request', targetId = 'target'] = value.split(':');
  const safeTargetId = targetId.length > 72 ? `${targetId.slice(0, 60)}-${createStableHash(targetId)}` : targetId;
  const readableKey = [scope, operation, safeTargetId, createStableHash(value)].join(':');

  if (readableKey.length <= maxLength) {
    return readableKey;
  }

  return [scope.slice(0, 16), operation.slice(0, 64), createStableHash(targetId), createStableHash(value)].join(':');
}

function gbFromBytes(bytes: number) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function calculateForwardingUsedBytes(rule: ForwardRule, quota?: QuotaPolicy) {
  return calculateForwardingBilledBytes(rule, quota?.usedBytes || 0);
}

function createForwardingMetadataFromRule(rule: ForwardingRuleView): ForwardingCreateMetadata {
  return {
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
    tunnelMode: rule.tunnelMode,
    enabled: rule.enabled
  };
}

function createForwardingIdempotencyKey(operation: string, targetId: string, metadata?: ForwardingCreateMetadata) {
  if (!metadata) {
    return ['ui', operation, targetId, 'unknown'].join(':');
  }

  const identity = JSON.stringify({
    name: metadata.name,
    ownerName: metadata.ownerName,
    tunnelId: metadata.tunnelId ?? '',
    listenAddress: metadata.listenAddress,
    listenPort: metadata.listenPort,
    targetAddress: metadata.targetAddress,
    targetPort: metadata.targetPort,
    protocol: metadata.protocol,
    entryNodeIds: metadata.entryNodeIds,
    strategy: metadata.strategy,
    quotaGb: metadata.quotaGb,
    monthlyResetDay: metadata.monthlyResetDay,
    currentUsedTrafficGb: metadata.currentUsedTrafficGb,
    rateLimitMbps: metadata.rateLimitMbps,
    ipRateLimitMbps: metadata.ipRateLimitMbps,
    maxConnections: metadata.maxConnections,
    maxConnectionsPerIp: metadata.maxConnectionsPerIp,
    proxyProtocol: metadata.proxyProtocol,
    billingDirection: metadata.billingDirection,
    tunnelMode: metadata.tunnelMode,
    enabled: metadata.enabled
  });

  return ['ui', operation, targetId, createStableHash(identity)].join(':');
}

function createBrowserPublicBaseUrl() {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;
  const basePath = import.meta.env.BASE_URL ?? '/';
  return new URL(basePath, origin).toString().replace(/\/+$/, '');
}

function mapSubscriptionFormatToOutputFormat(
  format: SubscriptionClientFormat
): SubscriptionClientRuleMetadata['outputFormats'][number] {
  if (format === 'plain') return 'uri';
  if (format === 'json') return 'v2ray';
  if (format === 'clash') return 'clash';
  if (format === 'mihomo') return 'mihomo';
  if (format === 'sing-box') return 'sing-box';
  return 'uri';
}

function createSubscriptionClientExportMetadata(
  client: ControlPlaneSnapshot['subscriptionClients'][number]
): SubscriptionClientRuleMetadata {
  const outputFormats: SubscriptionClientRuleMetadata['outputFormats'] = client.outputFormats?.length
    ? client.outputFormats
    : Array.from(new Set(client.formats.map(mapSubscriptionFormatToOutputFormat)));
  const remainingDays = Math.max(Math.ceil((Date.parse(client.expiresAt) - Date.now()) / 24 / 60 / 60 / 1000), 0);
  const securePathPreview = client.securePathPreview || '';
  const publicBaseUrl = createBrowserPublicBaseUrl();
  const createSubscriptionUrl = (format: keyof SubscriptionClientRuleMetadata['subscriptionUrlPreview']) =>
    securePathPreview ? `${publicBaseUrl}/sub${securePathPreview}/${format}/${client.subId}` : '';

  return {
    subscriptionClientId: client.id,
    customerName: client.customerName ?? client.displayName,
    ruleName: client.ruleName ?? client.displayName,
    displayName: client.displayName,
    subId: client.subId,
    email: client.email,
    protocol: client.protocol as SubscriptionClientRuleMetadata['protocol'],
    group: client.group,
    trafficLimitGb: gbFromBytes(client.trafficLimitBytes),
    usedTrafficGb: gbFromBytes(client.usedTrafficBytes),
    remainingDays,
    ipLimit: client.ipLimit,
    requestLimitPerHour: client.requestLimitPerHour,
    sourceIds: client.sourceIds,
    selectedTags: client.selectedTags,
    includeFilter: client.includeFilter,
    excludeFilter: client.excludeFilter,
    regionFilter: client.regionFilter,
    routingRule: client.routingRule,
    maxLatencyMs: client.maxLatencyMs,
    sortStrategy: client.sortStrategy,
    formats: client.formats,
    outputFormats,
    templateName: client.templateName,
    enabled: client.enabled,
    generatedNodeCount: client.generatedNodeCount,
    accessTokenPreview: client.accessTokenPreview,
    securePathPreview,
    subscriptionUrlPreview: {
      clash: createSubscriptionUrl('clash'),
      mihomo: createSubscriptionUrl('mihomo'),
      v2ray: createSubscriptionUrl('v2ray'),
      'sing-box': createSubscriptionUrl('sing-box'),
      uri: createSubscriptionUrl('uri')
    },
    clientRule: {
      protocolFilter: client.protocol as SubscriptionClientRuleMetadata['protocol'],
      sourceIds: client.sourceIds,
      tagFilter: client.selectedTags,
      regionFilter: client.regionFilter,
      includeFilter: client.includeFilter,
      excludeFilter: client.excludeFilter,
      routingRule: client.routingRule,
      maxLatencyMs: client.maxLatencyMs,
      sortStrategy: client.sortStrategy,
      outputFormats,
      trafficConstraint: {
        limitGb: gbFromBytes(client.trafficLimitBytes),
        usedGb: gbFromBytes(client.usedTrafficBytes),
        remainingDays,
        ipLimit: client.ipLimit,
        requestLimitPerHour: client.requestLimitPerHour
      },
      access: {
        subId: client.subId,
        tokenPreview: client.accessTokenPreview,
        securePathPreview
      }
    }
  };
}

const shellCopy = {
  zh: {
    taskMutationPending: '变更提交中',
    taskQueued: '执行记录已创建',
    taskQueuedDeferred: '执行记录已创建，刷新延后执行',
    taskMutationFailed: '变更提交失败',
    permissionDeniedHint: '当前账号没有执行此变更的权限。请在服务器运行 ou d 检查安装状态；如果是刚安装后看到旧数据，运行 ou r 重置控制面状态。',
    unauthorizedHint: '控制面认证未通过。请使用 ou c 查看最新面板地址、账号和密码，并确认没有直接访问后端端口。',
    taskNotFound: (taskId: string) => `未找到执行记录：${taskId}`,
    taskNotRollbackReady: (taskId: string) => `当前记录不可回滚：${taskId}`,
    deployRuntimeSummary: '应用主机设置',
    deployRuntimeTarget: '受控主机',
    updateHostSummary: '更新受控主机资料',
    deleteHostSummary: '移除受控主机',
    createCustomerNodeSummary: '创建客户 Xray 入站',
    updateCustomerNodeSummary: '更新客户 Xray 入站',
    deleteCustomerNodeSummary: '删除客户 Xray 入站',
    createForwardingSummary: '创建多主机端口转发',
    createForwardingTarget: (listenPort: number) => `多主机端口转发 ${listenPort}`,
    applyForwardingSummary: '应用端口转发策略',
    pauseForwardingSummary: '停用端口转发规则',
    resumeForwardingSummary: '恢复端口转发规则',
    applyForwardingTarget: '端口转发网络',
    deleteForwardingSummary: '删除端口转发规则',
    createSubscriptionClientSummary: '创建客户订阅规则',
    updateSubscriptionClientSummary: '更新客户订阅规则',
    deleteSubscriptionClientSummary: '删除客户订阅规则',
    deleteSubscriptionSourceSummary: '删除外部订阅源',
    generateSubscriptionSummary: '生成聚合订阅配置',
    saveSubscriptionProfileSummary: '保存订阅导出配置',
    deleteSubscriptionProfileSummary: '删除订阅导出配置',
    importSubscriptionSourceSummary: '导入外部订阅源',
    subscriptionSyncPending: '正在同步外部订阅节点',
    subscriptionSyncSucceeded: (count: number) => `外部订阅同步完成，解析 ${count} 个节点`,
    subscriptionSyncFailed: '外部订阅同步失败',
    compileRoutingSummary: '编译分流策略',
    compileRoutingTarget: '分流策略',
    tuningSummary: '下发系统调优变更',
    tuningTarget: '系统调优',
    permissionSummary: '提交转发分组权限变更',
    permissionTarget: '分组授权',
    resetQuotaSummary: (targetLabel: string) => `重置 ${targetLabel} 配额`,
    noManagedHostForDeploy: '请先安装并注册一台受控主机，然后再应用主机设置。',
    logoutPending: '正在退出登录',
    logoutFailed: '退出登录失败',
    operatorSessionRevokePending: '正在撤销操作员会话',
    operatorSessionCurrentRevokePending: '正在撤销当前会话并退出',
    operatorSessionRevokeSucceeded: '操作员会话已撤销',
    operatorSessionRevokeFailed: '操作员会话撤销失败',
    agentCredentialRevokePending: '正在撤销 Agent 凭证',
    agentCredentialRevokeSucceeded: 'Agent 凭证已撤销',
    agentCredentialRevokeFailed: 'Agent 凭证撤销失败',
    agentCredentialRotatePending: '正在轮换 Agent 运行凭证',
    agentCredentialRotateSucceeded: 'Agent 运行凭证已轮换，新令牌不会在面板展示',
    agentCredentialRotateFailed: 'Agent 运行凭证轮换失败',
    rollbackSummary: (targetLabel: string) => `回滚 ${targetLabel} 运行时快照`
  },
  en: {
    taskMutationPending: 'Change submission in progress',
    taskQueued: 'Execution record created',
    taskQueuedDeferred: 'Execution record created; refresh deferred',
    taskMutationFailed: 'Change submission failed',
    permissionDeniedHint: 'The current operator is not allowed to run this change. Run ou d on the server to inspect the installation, or ou r if stale first-install data is visible.',
    unauthorizedHint: 'Control-plane authentication failed. Run ou c for the current panel URL and credentials, and avoid opening the backend port directly.',
    taskNotFound: (taskId: string) => `Execution record not found: ${taskId}`,
    taskNotRollbackReady: (taskId: string) => `Execution record is not rollback-ready: ${taskId}`,
    deployRuntimeSummary: 'Apply host settings',
    deployRuntimeTarget: 'Managed Host',
    updateHostSummary: 'Update managed host profile',
    deleteHostSummary: 'Remove managed host',
    createCustomerNodeSummary: 'Create customer Xray inbound',
    updateCustomerNodeSummary: 'Update customer Xray inbound',
    deleteCustomerNodeSummary: 'Delete customer Xray inbound',
    createForwardingSummary: 'Create multi-host port forwarding',
    createForwardingTarget: (listenPort: number) => `Multi-host port forwarding ${listenPort}`,
    applyForwardingSummary: 'Apply port forwarding policy',
    pauseForwardingSummary: 'Pause port forwarding rule',
    resumeForwardingSummary: 'Resume port forwarding rule',
    applyForwardingTarget: 'Port forwarding fabric',
    deleteForwardingSummary: 'Delete port forwarding rule',
    createSubscriptionClientSummary: 'Create client subscription rule',
    updateSubscriptionClientSummary: 'Update client subscription rule',
    deleteSubscriptionClientSummary: 'Delete client subscription rule',
    deleteSubscriptionSourceSummary: 'Delete external subscription source',
    generateSubscriptionSummary: 'Generate aggregated subscription bundle',
    saveSubscriptionProfileSummary: 'Save subscription export profile',
    deleteSubscriptionProfileSummary: 'Delete subscription export profile',
    importSubscriptionSourceSummary: 'Import external subscription source',
    subscriptionSyncPending: 'Syncing external subscription nodes',
    subscriptionSyncSucceeded: (count: number) => `External subscription synced with ${count} parsed nodes`,
    subscriptionSyncFailed: 'External subscription sync failed',
    compileRoutingSummary: 'Compile routing policy',
    compileRoutingTarget: 'Routing policy',
    tuningSummary: 'Dispatch system tuning change',
    tuningTarget: 'System tuning',
    permissionSummary: 'Submit forwarding-group permission change',
    permissionTarget: 'Group authorization',
    resetQuotaSummary: (targetLabel: string) => `Reset ${targetLabel} quota`,
    noManagedHostForDeploy: 'Install and register a managed host before applying host settings.',
    logoutPending: 'Signing out',
    logoutFailed: 'Sign-out failed',
    operatorSessionRevokePending: 'Revoking operator session',
    operatorSessionCurrentRevokePending: 'Revoking current session and signing out',
    operatorSessionRevokeSucceeded: 'Operator session revoked',
    operatorSessionRevokeFailed: 'Operator session revoke failed',
    agentCredentialRevokePending: 'Revoking Agent credential',
    agentCredentialRevokeSucceeded: 'Agent credential revoked',
    agentCredentialRevokeFailed: 'Agent credential revoke failed',
    agentCredentialRotatePending: 'Rotating Agent runtime credential',
    agentCredentialRotateSucceeded: 'Agent runtime credential rotated; the new token is not shown in the panel',
    agentCredentialRotateFailed: 'Agent runtime credential rotation failed',
    rollbackSummary: (targetLabel: string) => `Rollback ${targetLabel} runtime snapshot`
  }
} as const;

function readControlPlaneErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  if (error instanceof Error && error.message.includes('permission.denied')) {
    return 'permission.denied';
  }

  if (error instanceof Error && error.message.includes('unauthorized')) {
    return 'unauthorized';
  }

  return undefined;
}

function readControlPlaneErrorDetails(error: unknown) {
  if (error && typeof error === 'object' && 'details' in error) {
    return (error as { details?: unknown }).details;
  }

  return undefined;
}

function readPermissionDenialDetails(details: unknown) {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const denial = details as {
    before?: { actorPermissions?: unknown };
    after?: { requiredPermission?: unknown; resourceId?: unknown };
  };
  const actorPermissions = Array.isArray(denial.before?.actorPermissions)
    ? denial.before.actorPermissions.filter((permission): permission is string => typeof permission === 'string')
    : [];

  return {
    requiredPermission:
      typeof denial.after?.requiredPermission === 'string' ? denial.after.requiredPermission : undefined,
    resourceId: typeof denial.after?.resourceId === 'string' ? denial.after.resourceId : undefined,
    actorPermissions
  };
}

function formatTaskMutationError(error: unknown, language: AppLanguage, fallback: string) {
  const code = readControlPlaneErrorCode(error);
  const t = shellCopy[language];

  if (code === 'permission.denied') {
    const denialDetails = readPermissionDenialDetails(readControlPlaneErrorDetails(error));

    if (denialDetails?.requiredPermission || denialDetails?.resourceId) {
      const permissions = denialDetails.actorPermissions.length > 0
        ? denialDetails.actorPermissions.join(', ')
        : language === 'zh'
          ? '无'
          : 'none';

      return language === 'zh'
        ? `当前账号缺少 ${denialDetails.requiredPermission ?? '所需'} 权限，资源组：${denialDetails.resourceId ?? '未知'}；已有权限：${permissions}。请运行 ou d 检查安装状态，必要时运行 ou r 清理旧状态。`
        : `The current operator is missing ${denialDetails.requiredPermission ?? 'required'} permission on ${denialDetails.resourceId ?? 'unknown resource group'}; current permissions: ${permissions}. Run ou d to inspect the installation, or ou r to clear stale state.`;
    }

    return t.permissionDeniedHint;
  }

  if (code === 'unauthorized') {
    return t.unauthorizedHint;
  }

  return error instanceof Error ? error.message : fallback;
}

export function AppShell({ ready }: AppShellProps) {
  const api = useApi();
  const runtimeConfig = useMemo(() => resolveAppRuntimeConfig(), []);
  const logout = useAppStore((state) => state.logout);
  const language = useAppStore((state) => state.language);
  const csrfToken = useAppStore((state) => state.csrfToken);
  const operatorSessionId = useAppStore((state) => state.operatorSessionId);
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
  const operatorSessionsQuery = useOperatorSessions(
    ready && runtimeConfig.controlPlaneMode === 'http' && activePage === 'permissions'
  );
  const agents = snapshot.data?.agents ?? EMPTY_AGENTS;
  const customers = snapshot.data?.customers ?? EMPTY_CUSTOMERS;
  const deployTargetAgent = agents.find((agent) => agent.id === deployTargetAgentId);
  const nodes = snapshot.data?.nodes ?? EMPTY_NODES;
  const inbounds = snapshot.data?.inbounds ?? EMPTY_INBOUNDS;
  const subscriptions = snapshot.data?.subscriptionBundles ?? EMPTY_SUBSCRIPTIONS;
  const subscriptionSources = snapshot.data?.subscriptionSources ?? EMPTY_SUBSCRIPTION_SOURCES;
  const subscriptionInventoryNodes = snapshot.data?.subscriptionInventoryNodes ?? EMPTY_SUBSCRIPTION_INVENTORY_NODES;
  const subscriptionClients = snapshot.data?.subscriptionClients ?? EMPTY_SUBSCRIPTION_CLIENTS;
  const subscriptionExportProfiles = snapshot.data?.subscriptionExportProfiles ?? EMPTY_SUBSCRIPTION_EXPORT_PROFILES;
  const proxyProviders = snapshot.data?.proxyProviders ?? EMPTY_PROXY_PROVIDERS;
  const subscriptionExportFiles = snapshot.data?.subscriptionExportFiles ?? EMPTY_SUBSCRIPTION_EXPORT_FILES;
  const quotaPolicies = snapshot.data?.quotaPolicies ?? EMPTY_QUOTA_POLICIES;
  const permissionGrants = snapshot.data?.permissionGrants ?? EMPTY_PERMISSION_GRANTS;
  const routingPolicies = snapshot.data?.routingPolicies ?? EMPTY_ROUTING_POLICIES;
  const tuningProfiles = snapshot.data?.tuningProfiles ?? EMPTY_TUNING_PROFILES;
  const tasks = snapshot.data?.tasks ?? EMPTY_TASKS;
  const configRevisions = snapshot.data?.configRevisions ?? EMPTY_CONFIG_REVISIONS;
  const preflightPlans = snapshot.data?.preflightPlans ?? EMPTY_PREFLIGHT_PLANS;
  const runtimeSnapshots = snapshot.data?.runtimeSnapshots ?? EMPTY_RUNTIME_SNAPSHOTS;
  const trafficRollups = snapshot.data?.trafficRollups ?? EMPTY_TRAFFIC_ROLLUPS;
  const systemAlerts = snapshot.data?.systemAlerts ?? EMPTY_SYSTEM_ALERTS;
  const agentLogRetentionPolicy = snapshot.data?.agentLogRetentionPolicy ?? DEFAULT_AGENT_LOG_RETENTION_POLICY;
  const agentCredentials = snapshot.data?.agentCredentials ?? EMPTY_AGENT_CREDENTIALS;
  const agentLogChunks = snapshot.data?.agentLogChunks ?? EMPTY_AGENT_LOG_CHUNKS;
  const auditLogs = snapshot.data?.auditLogs ?? EMPTY_AUDIT_LOGS;
  const operatorSessions = operatorSessionsQuery.data ?? EMPTY_OPERATOR_SESSIONS;
  const taskMutationBusy = taskMutationState.status === 'pending';
  const forwardingRules = useMemo(
    () =>
      mapForwardRules(
        snapshot.data?.forwardRules ?? [],
        snapshot.data?.quotaPolicies ?? [],
        snapshot.data?.rateLimitPolicies ?? [],
        snapshot.data?.agents ?? []
      ),
    [snapshot.data]
  );

  const refreshControlPlane = useCallback(() => {
    void snapshot.refetch();
  }, [snapshot]);

  const handleLogout = useCallback(async () => {
    if (runtimeConfig.controlPlaneMode !== 'http' || !runtimeConfig.controlPlaneBaseUrl) {
      logout();
      return;
    }

    setTaskMutationState({ status: 'pending', message: t.logoutPending });

    try {
      const response = await fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl), {
        method: 'DELETE',
        credentials: 'include',
        headers: csrfToken
          ? {
              'X-CSRF-Token': csrfToken
            }
          : undefined
      });

      if (!response.ok && response.status !== 401) {
        throw new Error(`HTTP control-plane logout failed: ${response.status} ${response.statusText}`);
      }

      logout();
    } catch (error) {
      setTaskMutationState({
        status: 'failed',
        message: formatTaskMutationError(error, language, t.logoutFailed)
      });
    }
  }, [csrfToken, language, logout, runtimeConfig, t.logoutFailed, t.logoutPending]);

  const handleRevokeOperatorSession = useCallback(
    async (sessionId: string) => {
      const session = operatorSessions.find((item) => item.id === sessionId);

      if (!session) {
        return;
      }

      const isCurrentSession = operatorSessionId === sessionId;
      setTaskMutationState({
        status: 'pending',
        message: isCurrentSession ? t.operatorSessionCurrentRevokePending : t.operatorSessionRevokePending
      });

      try {
        await api.revokeOperatorSession(
          sessionId,
          {
            reason: isCurrentSession
              ? 'operator initiated current-session revocation'
              : 'operator initiated session revocation'
          },
          createUiRequestContext('operator.session.revoke', sessionId, runtimeConfig)
        );

        if (isCurrentSession) {
          logout();
          return;
        }

        await Promise.all([operatorSessionsQuery.refetch(), snapshot.refetch()]);
        setTaskMutationState({ status: 'succeeded', message: t.operatorSessionRevokeSucceeded });
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.operatorSessionRevokeFailed)
        });
      }
    },
    [
      api,
      language,
      logout,
      operatorSessionId,
      operatorSessions,
      operatorSessionsQuery,
      runtimeConfig,
      snapshot,
      t.operatorSessionCurrentRevokePending,
      t.operatorSessionRevokeFailed,
      t.operatorSessionRevokePending,
      t.operatorSessionRevokeSucceeded
    ]
  );

  const handleRevokeAgentCredential = useCallback(
    async (credentialId: string) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.agentCredentialRevokePending });

      try {
        await api.revokeAgentCredential(
          credentialId,
          {
            reason: 'operator initiated Agent credential revocation'
          },
          createUiRequestContext('agent.credential.revoke', credentialId, runtimeConfig)
        );
        await snapshot.refetch();
        setTaskMutationState({ status: 'succeeded', message: t.agentCredentialRevokeSucceeded });
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.agentCredentialRevokeFailed)
        });
      }
    },
    [
      api,
      language,
      runtimeConfig,
      snapshot,
      t.agentCredentialRevokeFailed,
      t.agentCredentialRevokePending,
      t.agentCredentialRevokeSucceeded,
      taskMutationState.status
    ]
  );

  const handleRotateAgentCredential = useCallback(
    async (credentialId: string) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      const credential = agentCredentials.find((item) => item.id === credentialId);

      if (!credential || credential.status !== 'active' || credential.purpose !== 'runtime') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.agentCredentialRotatePending });

      try {
        await api.rotateAgentCredential(
          credentialId,
          {
            reason: 'operator initiated Agent runtime credential rotation'
          },
          createUiRequestContext('agent.credential.rotate', credentialId, runtimeConfig)
        );
        await snapshot.refetch();
        setTaskMutationState({ status: 'succeeded', message: t.agentCredentialRotateSucceeded });
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.agentCredentialRotateFailed)
        });
      }
    },
    [
      agentCredentials,
      api,
      language,
      runtimeConfig,
      snapshot,
      t.agentCredentialRotateFailed,
      t.agentCredentialRotatePending,
      t.agentCredentialRotateSucceeded,
      taskMutationState.status
    ]
  );

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
    customers,
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
    trafficRollups,
    agentCredentials,
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
        const message = formatTaskMutationError(error, language, t.taskMutationFailed);
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
    [api, language, runtimeConfig, snapshot, t.taskMutationFailed, t.taskMutationPending, t.taskQueued, t.taskQueuedDeferred]
  );

  const handleDeployHostConfig = useCallback((agent: Agent) => {
    setDeployTargetAgentId(agent.id);
    setDeployDrawerOpen(true);
  }, []);

  const previewAgentInstallCommand = useCallback(
    (metadata: AgentInstallMetadata) => {
      const requestId = `ui:agent-install-command:${Date.now()}`;

      return api.createAgentInstallCommand(
        {
          ...metadata,
          publicBaseUrl: createBrowserPublicBaseUrl()
        },
        {
          actor: runtimeConfig?.loginUsername ?? 'local-operator',
          operatorGroupId: runtimeConfig?.operatorGroupId ?? 'owner',
          resourceGroupId: runtimeConfig?.resourceGroupId ?? 'group-premium',
          sourceIp: 'ui-preview',
          requestId,
          idempotencyKey: requestId
        }
      );
    },
    [api, runtimeConfig]
  );

  const confirmDeployRuntimeConfig = useCallback(() => {
    const targetAgent = deployTargetAgent ?? agents[0];

    if (!targetAgent) {
      setTaskMutationState({ status: 'failed', message: t.noManagedHostForDeploy });
      setDeployDrawerOpen(false);
      return;
    }

    void runTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: targetAgent.id,
      targetLabel: targetAgent.name,
      summary: t.deployRuntimeSummary
    });
    setDeployDrawerOpen(false);
  }, [agents, deployTargetAgent, runTask, t.deployRuntimeSummary, t.noManagedHostForDeploy]);

  const handleSaveHostConfig = useCallback(
    (metadata: HostConfigMetadata) => {
      void runTask(
        {
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: metadata.agentId,
          targetLabel: metadata.displayName,
          summary: t.updateHostSummary,
          metadata
        },
        {
          idempotencyKey: [
            'ui',
            'agent.update',
            metadata.agentId,
            metadata.displayName,
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
      return runTask(
        withRiskConfirmation({
          operation: 'agent.delete',
          resourceType: 'agent',
          targetId: metadata.agentId,
          targetLabel: metadata.displayName,
          summary: t.deleteHostSummary,
          metadata
        }),
        {
          idempotencyKey: ['ui', 'agent.delete', metadata.agentId].join(':')
        }
      ).then(Boolean);
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
        withRiskConfirmation({
          operation: 'inbound.delete',
          resourceType: 'inbound',
          targetId: metadata.nodeId,
          targetLabel: metadata.customerNodeName,
          summary: t.deleteCustomerNodeSummary,
          metadata
        }),
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
          idempotencyKey: createForwardingIdempotencyKey(operation, targetId, metadata)
        }
      );
    },
    [runTask, t]
  );

  const handleRunForwarding = useCallback(
    (id: string, action: 'apply' | 'pause' | 'resume' = 'apply') => {
      const rule = forwardingRules.find((item) => item.id === id);
      const metadata = rule
        ? createForwardingMetadataFromRule({
            ...rule,
            enabled: action === 'pause' ? false : action === 'resume' ? true : rule.enabled
          })
        : undefined;
      const operation: CreateTaskInput['operation'] =
        action === 'pause' ? 'forward.pause' : action === 'resume' ? 'forward.resume' : 'forward.apply';
      const summary =
        action === 'pause'
          ? t.pauseForwardingSummary
          : action === 'resume'
            ? t.resumeForwardingSummary
            : t.applyForwardingSummary;
      const baseInput: CreateTaskInput = {
        operation,
        resourceType: 'forward',
        targetId: id,
        targetLabel: rule?.name ?? t.applyForwardingTarget,
        summary,
        metadata
      };
      const input = action === 'pause' || action === 'resume' ? withRiskConfirmation(baseInput) : baseInput;

      void runTask(input, {
        idempotencyKey: createForwardingIdempotencyKey(operation, id, metadata)
      });
    },
    [
      forwardingRules,
      runTask,
      t.applyForwardingSummary,
      t.applyForwardingTarget,
      t.pauseForwardingSummary,
      t.resumeForwardingSummary
    ]
  );

  const handleDeleteForwarding = useCallback(
    (rule: ForwardingRuleView) => {
      void runTask(
        withRiskConfirmation({
          operation: 'forward.delete',
          resourceType: 'forward',
          targetId: rule.id,
          targetLabel: rule.name,
          summary: t.deleteForwardingSummary,
          metadata: createForwardingMetadataFromRule(rule)
        }),
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

      return (async () => {
        const importInput: CreateTaskInput = {
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId,
          targetLabel: metadata.name,
          summary: t.importSubscriptionSourceSummary,
          metadata
        };
        const task = await runTask(importInput, {
          idempotencyKey: ['ui', 'subscription.import', metadata.kind, metadata.url].join(':')
        });

        if (!task) {
          return false;
        }

        const syncInput: CreateTaskInput = {
          operation: 'subscription.sync',
          resourceType: 'subscription',
          targetId,
          targetLabel: metadata.name,
          summary: t.subscriptionSyncPending,
          metadata
        };

        setTaskMutationState({ status: 'pending', message: t.subscriptionSyncPending });

        try {
          const result = await api.syncSubscriptionSource(
            targetId,
            createUiMutationContext(
              syncInput,
              ['ui', 'subscription.sync', targetId, Date.now()].join(':'),
              runtimeConfig
            )
          );
          await snapshot.refetch();

          if (result.status === 'failed') {
            setTaskMutationState({ status: 'failed', message: t.subscriptionSyncFailed });
            return true;
          }

          setTaskMutationState({ status: 'succeeded', message: t.subscriptionSyncSucceeded(result.nodeCount) });
          return true;
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.subscriptionSyncFailed)
          });
          return true;
        }
      })();
    },
    [api, language, runTask, runtimeConfig, snapshot, t]
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
        withRiskConfirmation({
          operation: 'subscription.delete',
          resourceType: 'subscription',
          targetId: metadata.subscriptionClientId,
          targetLabel: metadata.displayName,
          summary: t.deleteSubscriptionClientSummary,
          metadata
        }),
        {
          idempotencyKey: ['ui', 'subscription.delete', metadata.subscriptionClientId].join(':')
        }
      );
    },
    [runTask, t.deleteSubscriptionClientSummary]
  );

  const handleSaveSubscriptionExportProfile = useCallback(
    (metadata: SubscriptionExportProfileMetadata, action: 'create' | 'update') => {
      const targetId = metadata.profileId || `subscription-profile-${createStableSlug(metadata.name, 'export-profile')}`;

      void runTask(
        {
          operation: 'subscription.profile.upsert',
          resourceType: 'subscription',
          targetId,
          targetLabel: metadata.name,
          summary: t.saveSubscriptionProfileSummary,
          metadata: {
            ...metadata,
            profileId: targetId
          }
        },
        {
          idempotencyKey: [
            'ui',
            'subscription.profile.upsert',
            action,
            targetId,
            metadata.client,
            metadata.templateName,
            metadata.outputFormats.join(','),
            metadata.sourceIds.join(','),
            metadata.proxyGroups.map((group) => `${group.name}:${group.strategy}:${group.filterTags.join('|')}`).join(',')
          ].join(':')
        }
      );
    },
    [runTask, t.saveSubscriptionProfileSummary]
  );

  const handleDeleteSubscriptionExportProfile = useCallback(
    (metadata: SubscriptionExportProfileMetadata) => {
      void runTask(
        withRiskConfirmation({
          operation: 'subscription.profile.delete',
          resourceType: 'subscription',
          targetId: metadata.profileId,
          targetLabel: metadata.name,
          summary: t.deleteSubscriptionProfileSummary,
          metadata: {
            profileId: metadata.profileId,
            name: metadata.name
          }
        }),
        {
          idempotencyKey: ['ui', 'subscription.profile.delete', metadata.profileId].join(':')
        }
      );
    },
    [runTask, t.deleteSubscriptionProfileSummary]
  );

  const handleDeleteSubscriptionSource = useCallback(
    (source: SubscriptionSource) => {
      return runTask(
        withRiskConfirmation({
          operation: 'subscription.delete',
          resourceType: 'subscription',
          targetId: source.id,
          targetLabel: source.name,
          summary: t.deleteSubscriptionSourceSummary,
          metadata: {
            sourceId: source.id,
            name: source.name,
            url: source.url
          }
        }),
        {
          idempotencyKey: ['ui', 'subscription.delete.source', source.id].join(':')
        }
      ).then(Boolean);
    },
    [runTask, t.deleteSubscriptionSourceSummary]
  );

  const handleSyncSubscriptionSource = useCallback(
    (source: SubscriptionSource) => {
      return (async () => {
        const syncInput: CreateTaskInput = {
          operation: 'subscription.sync',
          resourceType: 'subscription',
          targetId: source.id,
          targetLabel: source.name,
          summary: t.subscriptionSyncPending,
          metadata: {
            sourceId: source.id,
            name: source.name,
            url: source.url,
            kind: source.kind,
            includeFilter: source.includeFilter ?? '',
            excludeFilter: source.excludeFilter ?? '',
            dedupeKey: source.dedupeKey,
            refreshIntervalMinutes: source.refreshIntervalMinutes ?? source.rateLimitPerMinute
          }
        };

        setTaskMutationState({ status: 'pending', message: t.subscriptionSyncPending });

        try {
          const result = await api.syncSubscriptionSource(
            source.id,
            createUiMutationContext(
              syncInput,
              ['ui', 'subscription.sync.manual', source.id, Date.now()].join(':'),
              runtimeConfig
            )
          );
          await snapshot.refetch();

          if (result.status === 'failed') {
            setTaskMutationState({ status: 'failed', message: t.subscriptionSyncFailed });
            return false;
          }

          setTaskMutationState({ status: 'succeeded', message: t.subscriptionSyncSucceeded(result.nodeCount) });
          return true;
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.subscriptionSyncFailed)
          });
          return false;
        }
      })();
    },
    [api, language, runtimeConfig, snapshot, t]
  );

  const handleGenerateSubscriptionExportFile = useCallback(
    (file: SubscriptionExportFile) => {
      const client = subscriptionClients.find((item) => item.id === file.subscriptionClientId);

      if (!client) {
        setTaskMutationState({ status: 'failed', message: `${file.name}: subscription client not found` });
        return;
      }
      const exportProfile = file.exportProfileId
        ? subscriptionExportProfiles.find((profile) => profile.id === file.exportProfileId)
        : selectSubscriptionExportProfileForClient(subscriptionExportProfiles, client);
      const exportMetadata = {
        ...createSubscriptionClientExportMetadata(client),
        ...(exportProfile
          ? {
              profileId: exportProfile.id,
              exportProfileName: exportProfile.name,
              client: exportProfile.client,
              sourceIds: exportProfile.sourceIds,
              includeFilter: exportProfile.includeFilter,
              excludeFilter: exportProfile.excludeFilter,
              regionFilter: exportProfile.regionFilter,
              proxyGroups: exportProfile.proxyGroups,
              includeTrafficHeaders: exportProfile.includeTrafficHeaders,
              outputFormats: exportProfile.outputFormats
            }
          : {})
      };

      void runTask(
        {
          operation: 'subscription.export',
          resourceType: 'subscription',
          targetId: file.subscriptionClientId,
          targetLabel: file.name,
          summary: t.generateSubscriptionSummary,
          metadata: exportMetadata
        },
        {
          idempotencyKey: [
            'ui',
            'subscription.export',
            file.subscriptionClientId,
            file.templateName,
            file.formats.join(','),
            exportProfile?.id ?? 'default',
            client.sourceIds.join(','),
            client.selectedTags.join(',')
          ].join(':')
        }
      );
    },
    [runTask, subscriptionClients, subscriptionExportProfiles, t.generateSubscriptionSummary]
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

  const handleResetQuota = useCallback(
    (policy: QuotaPolicy) => {
      const idempotencyKey = ['ui', 'quota.reset', policy.id, policy.scope].join(':');

      void runTask(
        withRiskConfirmation({
          operation: 'quota.reset',
          resourceType: 'quota',
          targetId: policy.id,
          targetLabel: policy.name,
          summary: t.resetQuotaSummary(policy.name),
          metadata: {
            quotaPolicyScope: policy.scope
          }
        }),
        {
          idempotencyKey
        }
      );
    },
    [runTask, t]
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
        withRiskConfirmation({
          operation: 'agent.rollback',
          resourceType: task.resourceType,
          targetId: task.targetId,
          targetLabel: task.targetLabel,
          summary: t.rollbackSummary(task.targetLabel)
        }),
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
            workspaceMode="hosts"
            taskMutationBusy={taskMutationBusy}
            onDeleteCustomerNode={handleDeleteCustomerNode}
            onDeleteHost={handleDeleteHost}
            onDeployHostConfig={handleDeployHostConfig}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
            onSaveHostConfig={handleSaveHostConfig}
            onSaveCustomerNode={handleSaveCustomerNode}
          />
        );
      case 'customerNodes':
        return (
          <NodesPage
            agents={agents}
            inbounds={inbounds}
            language={language}
            workspaceMode="customerNodes"
            taskMutationBusy={taskMutationBusy}
            onDeleteCustomerNode={handleDeleteCustomerNode}
            onDeleteHost={handleDeleteHost}
            onDeployHostConfig={handleDeployHostConfig}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
            onSaveHostConfig={handleSaveHostConfig}
            onSaveCustomerNode={handleSaveCustomerNode}
          />
        );
      case 'customers':
        return <CustomersPage customers={customers} language={language} />;
      case 'forwarding':
        return (
          <ForwardingPage
            agents={agents}
            language={language}
            rules={forwardingRules}
            taskMutationBusy={taskMutationBusy}
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
            subscriptionExportProfiles={subscriptionExportProfiles}
            proxyProviders={proxyProviders}
            subscriptionExportFiles={subscriptionExportFiles}
            subscriptionInventoryNodes={subscriptionInventoryNodes}
            subscriptionSources={subscriptionSources}
            taskMutationBusy={taskMutationBusy}
            onImportSource={handleImportSubscriptionSource}
            onDeleteSource={handleDeleteSubscriptionSource}
            onSyncSource={handleSyncSubscriptionSource}
            onDeleteClient={handleDeleteSubscriptionClient}
            onSaveExportProfile={handleSaveSubscriptionExportProfile}
            onDeleteExportProfile={handleDeleteSubscriptionExportProfile}
            onGenerateExportFile={handleGenerateSubscriptionExportFile}
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
            agentCredentials={agentCredentials}
            currentOperatorSessionId={operatorSessionId}
            forwardingRules={forwardingRules}
            grants={permissionGrants}
            language={language}
            operatorSessions={operatorSessions}
            operatorSessionsError={
              operatorSessionsQuery.error
                ? formatTaskMutationError(operatorSessionsQuery.error, language, t.operatorSessionRevokeFailed)
                : undefined
            }
            operatorSessionsLoading={operatorSessionsQuery.isLoading}
            quotaPolicies={quotaPolicies}
            taskMutationBusy={taskMutationBusy}
            onRevokeAgentCredential={handleRevokeAgentCredential}
            onRevokeOperatorSession={handleRevokeOperatorSession}
            onRotateAgentCredential={handleRotateAgentCredential}
            onResetQuota={handleResetQuota}
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
            agentLogChunks={agentLogChunks}
            agentLogRetentionPolicy={agentLogRetentionPolicy}
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
            trafficRollups={trafficRollups}
            systemAlerts={systemAlerts}
            language={language}
            onRefresh={() => void refreshControlPlane()}
          />
        );
    }
  }, [
    activePage,
    agentCredentials,
    agentLogChunks,
    agentLogRetentionPolicy,
    agents,
    auditLogs,
    configRevisions,
    customers,
    forwardingRules,
    handleCreateForwarding,
    handleDeleteCustomerNode,
    handleDeleteForwarding,
    handleDeleteHost,
    handleDeleteSubscriptionClient,
    handleDeleteSubscriptionExportProfile,
    handleDeleteSubscriptionSource,
    handleDeployHostConfig,
    handleImportSubscriptionSource,
    handleGenerateSubscriptionExportFile,
    handleRevokeAgentCredential,
    handleRevokeOperatorSession,
    handleResetQuota,
    handleRollbackTask,
    handleRunForwarding,
    handleRunPermission,
    handleRunRouting,
    handleRunTuning,
    handleRotateAgentCredential,
    handleSaveCustomerNode,
    handleSaveHostConfig,
    handleSaveSubscriptionExportProfile,
    handleSaveSubscriptionClient,
    handleSyncSubscriptionSource,
    inbounds,
    language,
    nodes,
    operatorSessionId,
    operatorSessions,
    operatorSessionsQuery.error,
    operatorSessionsQuery.isLoading,
    permissionGrants,
    proxyProviders,
    previewAgentInstallCommand,
    preflightPlans,
    quotaPolicies,
    refreshControlPlane,
    routingPolicies,
    runtimeSnapshots,
    systemAlerts,
    trafficRollups,
    subscriptionClients,
    subscriptionExportProfiles,
    subscriptionExportFiles,
    subscriptionInventoryNodes,
    subscriptionSources,
    subscriptions,
    taskMutationBusy,
    tasks,
    t.operatorSessionRevokeFailed,
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
          onLogout={() => void handleLogout()}
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
        title={language === 'zh' ? '应用主机设置' : 'Apply Host Settings'}
        description={
          language === 'zh'
            ? `将 ${deployTargetAgent?.name ?? t.deployRuntimeTarget} 的客户节点、Xray 入站与端口转发配置编译为可回滚版本，并应用到这台受控主机。`
            : `Compile customer nodes, Xray inbounds, and port-forwarding rules for ${deployTargetAgent?.name ?? t.deployRuntimeTarget}, then apply a rollback-ready version to that managed host.`
        }
        confirmLabel={language === 'zh' ? '确认应用' : 'Apply Settings'}
        confirmDisabled={taskMutationBusy}
        language={language}
        onClose={() => setDeployDrawerOpen(false)}
        onConfirm={confirmDeployRuntimeConfig}
      />
    </div>
  );
}
