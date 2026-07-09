import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNavigationItem, getNavigationItems, type PageId } from '../../app/navigation';
import { useAppStore, type AppLanguage } from '../../app/app-store';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import {
  isXrayRuntimeProtocol,
  selectSubscriptionExportProfileForClient,
  type Agent,
  type AgentCredentialSummary,
  type AgentInstallMetadata,
  type AuditLog,
  type ManagedNode,
  type OperatorSessionSummary,
  type SubscriptionClientFormat,
  type SubscriptionExportFile,
  type SubscriptionSource,
  type TrafficRollup,
  type XrayInbound
} from '../../domain';
import { calculateForwardingBilledBytes, type ForwardRule } from '../../domain/forwarding';
import type { QuotaPolicy, RateLimitPolicy } from '../../domain/quota';
import type { CreateTaskInput } from '../../domain/task';
import { buildXrayShareLink, extractShareHostLabel } from '../../domain/xray-share-link';
import type {
  ControlPlaneBackupPreflightResult
} from '../../features/admin/admin-account-settings-page';
import type { CustomerFocusIntent } from '../../features/customers/customers-page';
import type {
  ForwardingFocusIntent,
  ForwardingCreateMetadata,
  ForwardingRuleView
} from '../../features/forwarding/forwarding-page';
import {
  createForwardingDeleteIdempotencyKey,
  createForwardingDeleteTaskInput,
  createForwardingIdempotencyKey,
  createForwardingRunTaskInput,
  createForwardingTargetId,
  createForwardingUpsertTaskInput
} from '../../features/forwarding/forwarding-task-inputs';
import type {
  CustomerNodeClientActionResult,
  CustomerNodeClientActionMutation,
  CustomerNodeConfigMetadata,
  CustomerNodeSaveResult,
  HostConfigMetadata,
  NodesFocusIntent
} from '../../features/nodes/nodes-page';
import {
  createCustomerNodeInboundIdempotencyKey,
  createCustomerNodeInboundTaskInput
} from '../../features/nodes/customer-node-task-inputs';
import {
  createAddedCustomerNodeClientSubscriptionMetadata,
  createCustomerNodeClientSubscriptionMetadata,
  createCustomerNodeAllSubscriptionText,
  createCustomerNodeSubscriptionMetadata
} from '../../features/nodes/customer-node-subscription-binding';
import type {
  SubscriptionClientRuleMetadata,
  SubscriptionMixerFocusIntent,
  SubscriptionExportProfileMetadata,
  SubscriptionSourceImportMetadata
} from '../../features/subscriptions/subscription-mixer-page';
import {
  createSubscriptionClientDeleteIdempotencyKey,
  createSubscriptionClientDeleteTaskInput,
  createSubscriptionClientGenerateIdempotencyKey,
  createSubscriptionClientGenerateTaskInput,
  createSubscriptionExportIdempotencyKey,
  createSubscriptionExportProfileDeleteIdempotencyKey,
  createSubscriptionExportProfileDeleteTaskInput,
  createSubscriptionExportProfileUpsertIdempotencyKey,
  createSubscriptionExportProfileUpsertTaskInput,
  createSubscriptionExportTaskInput,
  createSubscriptionSourceDeleteIdempotencyKey,
  createSubscriptionSourceDeleteTaskInput,
  createSubscriptionSourceImportIdempotencyKey,
  createSubscriptionSourceImportSyncTaskInput,
  createSubscriptionSourceImportTargetId,
  createSubscriptionSourceImportTaskInput,
  createSubscriptionSourceSyncIdempotencyKey,
  createSubscriptionSourceSyncTaskInput
} from '../../features/subscriptions/subscription-task-inputs';
import type { TuningProfile } from '../../features/tuning/tuning-page';
import {
  createBoundedMutationKey,
  createUiMutationContext,
  createUiRequestContext,
  formatTaskMutationError
} from './app-shell-mutations';
import {
  createControlPlaneBackupPackage,
  createControlPlaneBackupSummary,
  preflightControlPlaneBackupPackage
} from './control-plane-backup';
import { createOperatorSessionUrl } from '../../features/auth/operator-session-url';
import { copyText } from '../../lib/copy';
import { createDefaultTelegramBotSettings, createDefaultTelegramNotificationPolicy } from '../../services/api/telegram-bot';
import type {
  AgentLogArchiveExportReadModel,
  AgentLogExportReadModel,
  AgentLogRetentionPolicyUpdateInput,
  TrafficRollupCompactionExportReadModel,
  TrafficRollupExportReadModel,
  TrafficRollupRetentionPolicyUpdateInput
} from '../../services/api/control-plane-api';
import { useControlPlaneSnapshot, type ControlPlaneSnapshot } from '../../services/api/use-control-plane-snapshot';
import { useApi } from '../../services/api/use-api';
import { useOperatorSessions } from '../../services/api/use-operator-sessions';
import { ActionOverlay } from './action-overlay';
import {
  AdminAccountSettingsPage,
  AuditPage,
  CustomersPage,
  DashboardPage,
  ForwardingPage,
  NodesPage,
  RoutingPage,
  SubscriptionMixerPage,
  TasksPage,
  TelegramNotificationSettingsPage,
  TuningPage
} from './app-shell-pages';
import type { ManualRoutingRuleMetadata } from '../../features/routing/routing-page';
import { prefetchAppShellPage } from './app-shell-page-prefetch';
import { ControlPlaneSkeleton } from './control-plane-skeleton';
import { AppShellWorkspaceChrome } from './app-shell-workspace-chrome';
import { QuickActionPalette, type QuickActionCommand, type QuickActionItem } from './quick-action-palette';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileBottomNav } from './mobile-bottom-nav';

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
const EMPTY_ROUTING_POLICIES: ControlPlaneSnapshot['routingPolicies'] = [];
const EMPTY_TUNING_PROFILES: ControlPlaneSnapshot['tuningProfiles'] = [];
const EMPTY_TASKS: ControlPlaneSnapshot['tasks'] = [];
const EMPTY_COMMAND_OUTBOX: ControlPlaneSnapshot['commandOutbox'] = [];
const EMPTY_CONFIG_REVISIONS: ControlPlaneSnapshot['configRevisions'] = [];
const EMPTY_PREFLIGHT_PLANS: ControlPlaneSnapshot['preflightPlans'] = [];
const EMPTY_RUNTIME_SNAPSHOTS: ControlPlaneSnapshot['runtimeSnapshots'] = [];
const EMPTY_TRAFFIC_ROLLUPS: ControlPlaneSnapshot['trafficRollups'] = [];
const EMPTY_TRAFFIC_ROLLUP_COMPACTIONS: ControlPlaneSnapshot['trafficRollupCompactions'] = [];
const EMPTY_SYSTEM_ALERTS: ControlPlaneSnapshot['systemAlerts'] = [];
const DEFAULT_AGENT_LOG_RETENTION_POLICY: ControlPlaneSnapshot['agentLogRetentionPolicy'] = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxAgeDays: 7,
  maxEventsPerAgent: 5000,
  source: 'runtime-config'
};
const DEFAULT_TRAFFIC_ROLLUP_RETENTION_POLICY: ControlPlaneSnapshot['trafficRollupRetentionPolicy'] = {
  maxAgeMs: 62 * 24 * 60 * 60 * 1000,
  maxAgeDays: 62,
  maxRecordsPerScope: 200_000,
  source: 'runtime-config',
  runtimeDefault: {
    maxAgeMs: 62 * 24 * 60 * 60 * 1000,
    maxAgeDays: 62,
    maxRecordsPerScope: 200_000
  }
};
const EMPTY_AGENT_CREDENTIALS: AgentCredentialSummary[] = [];
const EMPTY_AGENT_SESSIONS: ControlPlaneSnapshot['agentSessions'] = [];
const EMPTY_AGENT_LOG_CHUNKS: ControlPlaneSnapshot['agentLogChunks'] = [];
const EMPTY_AGENT_LOG_ARCHIVES: ControlPlaneSnapshot['agentLogArchives'] = [];
const EMPTY_AUDIT_LOGS: ControlPlaneSnapshot['auditLogs'] = [];
const EMPTY_OPERATOR_SESSIONS: OperatorSessionSummary[] = [];
const EMPTY_TELEGRAM_BINDINGS: ControlPlaneSnapshot['telegramBindings'] = [];
const EMPTY_TELEGRAM_NOTIFICATION_DELIVERIES: ControlPlaneSnapshot['telegramNotificationDeliveries'] = [];
const DEFAULT_TELEGRAM_BOT_SETTINGS = createDefaultTelegramBotSettings('1970-01-01T00:00:00.000Z');
const DEFAULT_TELEGRAM_NOTIFICATION_POLICY = createDefaultTelegramNotificationPolicy('1970-01-01T00:00:00.000Z');
const DEFAULT_TELEGRAM_NOTIFICATION_POLICIES: ControlPlaneSnapshot['telegramNotificationPolicies'] = [
  DEFAULT_TELEGRAM_NOTIFICATION_POLICY
];

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
        rateLimitMbps: rule.rateLimitMbps ?? resolveRateLimitMbps(rateLimit),
        rateLimitMode: rule.rateLimitMode ?? rateLimit?.mode ?? 'bi-directional',
        rateLimitDirection: rule.rateLimitDirection ?? inferRateLimitDirection(rateLimit),
        ipRateLimitMbps:
          rule.ipRateLimitMbps ?? resolveRateLimitMbps(ipRateLimit),
        billingDirection: rule.billingDirection,
        pricePerGb: rule.pricePerGb,
        tunnelMode: rule.tunnelMode,
        strategy: rule.strategy,
        maxConnections: rule.maxConnections,
        maxConnectionsPerIp: rule.maxConnectionsPerIp,
        proxyProtocol: rule.proxyProtocol,
        blockedRuntimeControls: rule.blockedRuntimeControls,
        blockedRuntimeControlValues: rule.blockedRuntimeControlValues,
        quotaExceeded: rule.quotaExceeded,
        runtimeDisabledByPolicy: rule.runtimeDisabledByPolicy,
        guardrailReason: rule.guardrailReason
      }
    ];
  });
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


function gbFromBytes(bytes: number) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function readCustomerNodeClientIdentity(inbound: XrayInbound, client: XrayInbound['clients'][number]) {
  return inbound.clients.length > 1 ? client.id : inbound.clientIdentity ?? client.id;
}

function readCustomerNodeClientCredential(inbound: XrayInbound, client: XrayInbound['clients'][number]) {
  return client.password ?? client.auth ?? readCustomerNodeClientIdentity(inbound, client);
}

function createCustomerNodeShareLink(metadata: CustomerNodeConfigMetadata) {
  return buildXrayShareLink({
    protocol: metadata.xrayProtocol as Parameters<typeof buildXrayShareLink>[0]['protocol'],
    clientIdentity: metadata.clientIdentity,
    clientCredential: metadata.clientCredential,
    hysteriaAuth: metadata.hysteriaAuth,
    fallbackSeed: `${metadata.nodeId}:${metadata.agentId}:${metadata.customerName}`,
    serverAddress: metadata.serverAddress,
    listenPort: metadata.listenPort,
    security: metadata.security,
    network: metadata.streamNetwork,
    sni: metadata.sni,
    path: metadata.path,
    flow: metadata.flow,
    fingerprint: metadata.fingerprint,
    realityPublicKey: metadata.realityPublicKey,
    realityShortId: metadata.realityShortId,
    vmessSecurity: metadata.vmessSecurity,
    shadowsocksMethod: metadata.shadowsocksMethod,
    label: metadata.customerNodeName || metadata.customerName
  });
}

function calculateForwardingUsedBytes(rule: ForwardRule, quota?: QuotaPolicy) {
  return calculateForwardingBilledBytes(rule, quota?.usedBytes || 0);
}

function findCustomerNodeQuotaPolicy(
  inbound: XrayInbound,
  client: XrayInbound['clients'][number],
  quotaPolicies: QuotaPolicy[]
) {
  const clientIdentity = inbound.clientIdentity ?? client.id;
  const candidates = new Set(
    [
      `customer-node:${inbound.id}:${clientIdentity}`,
      `customer-node:${inbound.id}:${client.id}`,
      `customer-node:${inbound.id}:${client.email}`,
      `${inbound.id}:${clientIdentity}`,
      `${inbound.id}:${client.id}`,
      `${inbound.id}:${client.email}`,
      inbound.id
    ].filter(Boolean)
  );

  return quotaPolicies.find((policy) => {
    if (policy.scope !== 'customer-node') {
      return false;
    }

    if (candidates.has(policy.id) || (policy.resourceId ? candidates.has(policy.resourceId) : false)) {
      return true;
    }

    return (
      policy.id.includes(inbound.id) &&
      (policy.id.includes(clientIdentity) || policy.id.includes(client.id) || Boolean(client.email && policy.id.includes(client.email)))
    );
  });
}

function createCustomerNodeMetadataFromInbound(
  inbound: XrayInbound,
  client: XrayInbound['clients'][number],
  agents: Agent[],
  nodes: ManagedNode[],
  enabled: boolean
): CustomerNodeConfigMetadata {
  const runtimeNode = nodes.find((node) => node.id === inbound.nodeId);
  const agentId = inbound.agentId ?? runtimeNode?.agentId ?? inbound.nodeId;
  const agentAddress = agents.find((agent) => agent.id === agentId)?.publicAddress ?? '';
  const nodeAddress = runtimeNode ? extractShareHostLabel(runtimeNode.entrypoint) : '';
  const remainingDays =
    inbound.remainingDays
    ?? Math.max(Math.ceil((Date.parse(client.expiresAt) - Date.now()) / 24 / 60 / 60 / 1000), 0);
  const usedTrafficBytes = client.manualUsedTrafficBytes ?? client.usedTrafficBytes ?? 0;

  if (!isXrayRuntimeProtocol(inbound.protocol)) {
    throw new Error(`Unsupported Xray inbound protocol: ${inbound.protocol}`);
  }

  return {
    nodeId: inbound.id,
    agentId,
    customerNodeName: inbound.label,
    customerName: inbound.customerName ?? client.email,
    serverAddress: (inbound.serverAddress ?? nodeAddress) || agentAddress,
    xrayProtocol: inbound.protocol,
    listenPort: inbound.listenPort,
    clientIdentity: readCustomerNodeClientIdentity(inbound, client),
    clientEmail: client.email,
    clientCredential: readCustomerNodeClientCredential(inbound, client),
    clientLevel: client.level ?? 0,
    clientComment: client.comment ?? '',
    telegramId: client.tgId ?? '',
    resetPolicy: client.resetPolicy ?? 'never',
    vmessSecurity: client.security ?? 'auto',
    shadowsocksMethod: client.method ?? '2022-blake3-aes-128-gcm',
    hysteriaAuth: client.auth ?? '',
    streamNetwork: inbound.streamSettings.network,
    security: inbound.streamSettings.security,
    sni: inbound.streamSettings.sni ?? '',
    path: inbound.streamSettings.path ?? inbound.streamSettings.serviceName ?? inbound.path ?? '',
    flow: client.flow ?? inbound.flow ?? '',
    fingerprint: inbound.streamSettings.fingerprint ?? inbound.reality.fingerprint ?? 'chrome',
    alpn: inbound.tls.alpn,
    realityPublicKey: inbound.reality.publicKey ?? '',
    realityPrivateKey: inbound.reality.privateKey ?? '',
    realityTarget: inbound.reality.target ?? '',
    realityShortId: inbound.reality.shortIds[0] ?? '',
    fallbackName: inbound.fallbacks[0]?.name ?? '',
    fallbackDestination: inbound.fallbacks[0]?.destination ?? '',
    fallbackXver: inbound.fallbacks[0]?.xver ?? 0,
    sniffingEnabled: inbound.sniffingEnabled,
    ipLimit: client.ipLimit,
    trafficMultiplier: client.trafficMultiplier ?? 1,
    trafficLimitGb: gbFromBytes(client.trafficLimitBytes),
    monthlyResetDay: client.monthlyResetDay ?? 1,
    currentUsedTrafficGb: gbFromBytes(usedTrafficBytes),
    remainingDays,
    expiresAt: client.expiresAt,
    quotaExceeded: client.quotaExceeded,
    clientExpired: client.clientExpired,
    runtimeDisabledByPolicy: client.runtimeDisabledByPolicy,
    guardrailReason: client.guardrailReason,
    subscriptionRule: inbound.subscriptionRule ?? 'manual',
    enabled
  };
}

function createCustomerNodeClientMetadataListFromInbound(
  inbound: XrayInbound,
  targetClient: XrayInbound['clients'][number],
  targetEnabled: boolean
): NonNullable<CustomerNodeConfigMetadata['clients']> {
  return inbound.clients.map((client) => {
    const remainingDays =
      inbound.remainingDays
      ?? Math.max(Math.ceil((Date.parse(client.expiresAt) - Date.now()) / 24 / 60 / 60 / 1000), 0);
    const usedTrafficBytes = client.manualUsedTrafficBytes ?? client.usedTrafficBytes ?? 0;

    return {
      clientIdentity: readCustomerNodeClientIdentity(inbound, client),
      clientEmail: client.email,
      clientCredential: readCustomerNodeClientCredential(inbound, client),
      clientLevel: client.level ?? 0,
      clientComment: client.comment ?? '',
      telegramId: client.tgId ?? '',
      resetPolicy: client.resetPolicy ?? 'never',
      vmessSecurity: client.security ?? 'auto',
      shadowsocksMethod: client.method ?? '2022-blake3-aes-128-gcm',
      hysteriaAuth: client.auth ?? '',
      flow: client.flow ?? inbound.flow ?? '',
      ipLimit: client.ipLimit,
      trafficMultiplier: client.trafficMultiplier ?? 1,
      trafficLimitGb: gbFromBytes(client.trafficLimitBytes),
      monthlyResetDay: client.monthlyResetDay ?? 1,
      currentUsedTrafficGb: gbFromBytes(usedTrafficBytes),
      remainingDays,
      expiresAt: client.expiresAt,
      quotaExceeded: client.quotaExceeded,
      clientExpired: client.clientExpired,
      runtimeDisabledByPolicy: client.runtimeDisabledByPolicy,
      guardrailReason: client.guardrailReason,
      subscriptionRule: client.subId ?? inbound.subscriptionRule ?? 'manual',
      enabled: client.id === targetClient.id || client.email === targetClient.email ? targetEnabled : client.enabled
    };
  });
}

function createQuickActionItems({
  agents,
  customers,
  forwardingRules,
  inbounds,
  language,
  nodes,
  quotaPolicies,
  systemAlerts,
  tasks,
  subscriptionClients,
  subscriptionSources
}: {
  agents: Agent[];
  customers: ControlPlaneSnapshot['customers'];
  forwardingRules: ForwardingRuleView[];
  inbounds: XrayInbound[];
  language: AppLanguage;
  nodes: ManagedNode[];
  quotaPolicies: QuotaPolicy[];
  systemAlerts: ControlPlaneSnapshot['systemAlerts'];
  tasks: ControlPlaneSnapshot['tasks'];
  subscriptionClients: ControlPlaneSnapshot['subscriptionClients'];
  subscriptionSources: ControlPlaneSnapshot['subscriptionSources'];
}): QuickActionItem[] {
  const pageGroup = language === 'zh' ? '页面' : 'Page';
  const hostGroup = language === 'zh' ? '主机' : 'Host';
  const customerGroup = language === 'zh' ? '客户' : 'Customer';
  const customerNodeGroup = language === 'zh' ? '客户节点' : 'Customer Node';
  const forwardingGroup = language === 'zh' ? '转发' : 'Forward';
  const subscriptionGroup = language === 'zh' ? '订阅' : 'Sub';
  const statusGroup = language === 'zh' ? '状态' : 'Status';
  const openText = language === 'zh' ? '打开' : 'Open';
  const applyForwardingCommand = language === 'zh' ? '应用' : 'Apply';
  const pauseForwardingCommand = language === 'zh' ? '暂停' : 'Pause';
  const resumeForwardingCommand = language === 'zh' ? '恢复' : 'Resume';
  const resetTrafficCommand = language === 'zh' ? '重置流量' : 'Reset Traffic';
  const enableCustomerNodeCommand = language === 'zh' ? '启用' : 'Enable';
  const disableCustomerNodeCommand = language === 'zh' ? '停用' : 'Disable';
  const copyCustomerNodeLinkCommand = language === 'zh' ? '复制链接' : 'Copy Link';
  const copyCustomerNodeSubscriptionCommand = language === 'zh' ? '复制订阅' : 'Copy Sub';
  const copyAllCustomerNodeSubscriptionsCommand = language === 'zh' ? '复制全部' : 'Copy All';
  const syncSubscriptionCommand = language === 'zh' ? '同步' : 'Sync';
  const copySubscriptionLinkCommand = language === 'zh' ? '复制链接' : 'Copy Link';
  const copyAllSubscriptionLinksCommand = language === 'zh' ? '复制全部' : 'Copy All';
  const managedNodesById = new Map(nodes.map((node) => [node.id, node]));
  const runtimeInbounds = inbounds.filter((inbound) => isXrayRuntimeProtocol(inbound.protocol));
  const activeRuntimeTasks = tasks.filter((task) =>
    task.status === 'queued' || task.status === 'running' || task.status === 'retrying'
  );
  const failedRuntimeTasks = tasks.filter((task) => task.status === 'failed');
  const quotaRiskClients = runtimeInbounds.flatMap((inbound) =>
    inbound.clients.filter(
      (client) =>
        client.quotaExceeded === true ||
        client.clientExpired === true ||
        client.runtimeDisabledByPolicy === true ||
        Boolean(client.guardrailReason && client.guardrailReason !== 'ok')
    )
  );

  return [
    {
      id: 'status:control-plane',
      title: language === 'zh' ? '状态中心' : 'Status Center',
      description:
        language === 'zh'
          ? `${openText} ${getNavigationItem('dashboard', language).label} · Agent、Runtime、配额`
          : `${openText} ${getNavigationItem('dashboard', language).label} · Agent, runtime, quota`,
      group: statusGroup,
      keywords: language === 'zh'
        ? ['状态', '状态中心', 'Agent 在线', 'Runtime Apply', '失败任务', '配额风险']
        : ['status', 'status center', 'agent online', 'runtime apply', 'failed tasks', 'quota risk'],
      pageId: 'dashboard',
      badge: String(systemAlerts.length)
    },
    {
      id: 'status:failed-tasks',
      title: language === 'zh' ? '失败任务' : 'Failed Tasks',
      description: `${openText} ${getNavigationItem('tasks', language).label} · ${failedRuntimeTasks.length}`,
      group: statusGroup,
      keywords: language === 'zh' ? ['失败', '任务', '证据', '回滚'] : ['failed', 'tasks', 'evidence', 'rollback'],
      pageId: 'tasks',
      badge: String(failedRuntimeTasks.length)
    },
    {
      id: 'status:quota-risk',
      title: language === 'zh' ? '配额风险' : 'Quota Risk',
      description: `${openText} ${getNavigationItem('customerNodes', language).label} · ${quotaRiskClients.length}`,
      group: statusGroup,
      keywords: language === 'zh'
        ? ['配额', '到期', '流量', '停用', '客户节点']
        : ['quota', 'expired', 'traffic', 'disabled', 'customer nodes'],
      pageId: 'customerNodes',
      badge: String(quotaRiskClients.length)
    },
    {
      id: 'status:runtime-apply',
      title: language === 'zh' ? 'Runtime Apply' : 'Runtime Apply',
      description: `${openText} ${getNavigationItem('tasks', language).label} · ${activeRuntimeTasks.length}`,
      group: statusGroup,
      keywords: language === 'zh'
        ? ['运行时', '应用', '排队', '执行中', 'Agent']
        : ['runtime', 'apply', 'queued', 'running', 'agent'],
      pageId: 'tasks',
      badge: String(activeRuntimeTasks.length)
    },
    {
      id: 'status:settings',
      title: language === 'zh' ? '账户与设置' : 'Accounts & Settings',
      description: `${openText} ${getNavigationItem('adminAccounts', language).label}`,
      group: statusGroup,
      keywords: language === 'zh' ? ['设置', '账户', '会话', '安全'] : ['settings', 'accounts', 'sessions', 'security'],
      pageId: 'adminAccounts'
    },
    ...getNavigationItems(language).map((item): QuickActionItem => ({
      id: `page:${item.id}`,
      title: item.label,
      description: item.description,
      group: pageGroup,
      keywords: [item.id, item.label, item.description],
      pageId: item.id
    })),
    ...agents.map((agent): QuickActionItem => ({
      id: `agent:${agent.id}`,
      title: agent.name,
      description: `${openText} ${getNavigationItem('nodes', language).label} · ${agent.region} · ${agent.status}`,
      group: hostGroup,
      keywords: [agent.id, agent.name, agent.region, agent.publicAddress, agent.status, agent.version],
      pageId: 'nodes',
      badge: agent.status,
      intent: {
        kind: 'host.deploy',
        targetId: agent.id
      }
    })),
    ...customers.map((customer): QuickActionItem => ({
      id: `customer:${customer.id}`,
      title: customer.name,
      description: `${openText} ${getNavigationItem('customers', language).label} · ${customer.sourceKinds.join(' / ')}`,
      group: customerGroup,
      keywords: [
        customer.id,
        customer.name,
        customer.status,
        ...customer.agentIds,
        ...customer.customerNodeIds,
        ...customer.subscriptionClientIds,
        ...customer.forwardRuleIds
      ],
      pageId: 'customers',
      badge: customer.status,
      intent: {
        kind: 'customer.resources',
        targetId: customer.id
      }
    })),
    ...runtimeInbounds.map((inbound): QuickActionItem => {
      const primaryClient = inbound.clients[0];
      const customerName = inbound.customerName ?? primaryClient?.email ?? '';
      const managedNode = managedNodesById.get(inbound.nodeId);
      const resolvedAgentId = inbound.agentId ?? managedNode?.agentId ?? '';
      const streamKeyword = [
        inbound.streamSettings.network,
        inbound.streamSettings.security,
        inbound.streamSettings.sni ?? '',
        inbound.streamSettings.path ?? '',
        inbound.streamSettings.serviceName ?? '',
        inbound.path ?? ''
      ].filter((keyword): keyword is string => Boolean(keyword));

      return {
        id: `customer-node:${inbound.id}`,
        title: inbound.label,
        description: `${openText} ${getNavigationItem('customerNodes', language).label} · ${customerName || inbound.nodeId} · ${inbound.protocol}:${inbound.listenPort}`,
        group: customerNodeGroup,
        keywords: [
          inbound.id,
          inbound.nodeId,
          resolvedAgentId,
          managedNode?.name ?? '',
          inbound.label,
          customerName,
          inbound.clientIdentity ?? '',
          inbound.subscriptionRule ?? '',
          inbound.protocol,
          inbound.listenAddress,
          String(inbound.listenPort),
          inbound.status,
          ...streamKeyword,
          ...inbound.clients.flatMap((client) => [
            client.id,
            client.email,
            client.comment ?? '',
            client.tgId ?? '',
            client.resetPolicy ?? '',
            client.flow ?? ''
          ])
        ],
        pageId: 'customerNodes',
        badge: inbound.status,
        intent: {
          kind: 'customer-node.edit',
          targetId: inbound.id
        }
      };
    }),
    ...runtimeInbounds.flatMap((inbound): QuickActionItem[] => {
      const managedNode = managedNodesById.get(inbound.nodeId);
      const resolvedAgentId = inbound.agentId ?? managedNode?.agentId ?? '';

      return inbound.clients.map((client): QuickActionItem => {
        const quotaPolicy = findCustomerNodeQuotaPolicy(inbound, client, quotaPolicies);

        const commands: QuickActionCommand[] = [
          {
            kind: 'customer-node.copy-share-link',
            label: copyCustomerNodeLinkCommand,
            aliases: language === 'zh' ? ['链接'] : ['link'],
            targetId: `${inbound.id}:${client.id}`
          },
          {
            kind: 'customer-node.copy-subscription-link',
            label: copyCustomerNodeSubscriptionCommand,
            aliases: language === 'zh' ? ['订阅'] : ['sub', 'subscription'],
            targetId: `${inbound.id}:${client.id}`
          },
          {
            kind: 'customer-node.copy-all-subscription-links',
            label: copyAllCustomerNodeSubscriptionsCommand,
            aliases: language === 'zh' ? ['全部', '全格式'] : ['all', 'all formats'],
            targetId: `${inbound.id}:${client.id}`
          },
          {
            kind: 'customer-node.set-enabled',
            label: client.enabled ? disableCustomerNodeCommand : enableCustomerNodeCommand,
            aliases: client.enabled
              ? language === 'zh'
                ? ['禁用', '关闭']
                : ['disable', 'off']
              : language === 'zh'
                ? ['开启', '恢复']
                : ['enable', 'on', 'resume'],
            targetId: `${inbound.id}:${client.id}`,
            value: client.enabled ? 'false' : 'true'
          }
        ];

        if (quotaPolicy) {
          commands.push({
            kind: 'customer-node.reset-traffic',
            label: resetTrafficCommand,
            aliases: language === 'zh' ? ['重置'] : ['reset'],
            targetId: quotaPolicy.id
          });
        }

        return {
          id: `customer-node-client:${inbound.id}:${client.id}`,
          title: client.email,
          description: `${openText} ${getNavigationItem('customerNodes', language).label} · ${inbound.label} · ${inbound.protocol}:${inbound.listenPort}`,
          group: customerNodeGroup,
          keywords: [
            client.id,
            client.email,
            client.comment ?? '',
            client.tgId ?? '',
            client.subId ?? '',
            client.resetPolicy ?? '',
            client.flow ?? '',
            client.credentialType ?? '',
            quotaPolicy?.id ?? '',
            quotaPolicy?.name ?? '',
            inbound.id,
            inbound.label,
            inbound.customerName ?? '',
            inbound.clientIdentity ?? '',
            inbound.subscriptionRule ?? '',
            inbound.protocol,
            inbound.listenAddress,
            String(inbound.listenPort),
            inbound.status,
            inbound.nodeId,
            resolvedAgentId,
            managedNode?.name ?? ''
          ],
          pageId: 'customerNodes',
          badge: client.enabled ? (language === 'zh' ? '启用' : 'on') : (language === 'zh' ? '停用' : 'off'),
          intent: {
            kind: 'customer-node.edit',
            targetId: inbound.id
          },
          commands
        };
      });
    }),
    ...forwardingRules.map((rule): QuickActionItem => ({
      id: `forward:${rule.id}`,
      title: rule.name,
      description: `${openText} ${getNavigationItem('forwarding', language).label} · ${rule.ownerName} · ${rule.listenPort} -> ${rule.targetAddress}:${rule.targetPort}`,
      group: forwardingGroup,
      keywords: [
        rule.id,
        rule.name,
        rule.ownerName,
        rule.protocol,
        rule.listenAddress,
        String(rule.listenPort),
        rule.targetAddress,
        String(rule.targetPort),
        ...rule.entryNodeIds
      ],
      pageId: 'forwarding',
      badge: rule.enabled ? (language === 'zh' ? '启用' : 'on') : (language === 'zh' ? '停用' : 'off'),
      intent: {
        kind: 'forward.edit',
        targetId: rule.id
      },
      commands: [
        {
          kind: 'forward.apply',
          label: applyForwardingCommand,
          targetId: rule.id
        },
        rule.enabled
          ? {
              kind: 'forward.pause',
              label: pauseForwardingCommand,
              aliases: language === 'zh' ? ['停用', '关闭'] : ['disable', 'off'],
              targetId: rule.id
            }
          : {
              kind: 'forward.resume',
              label: resumeForwardingCommand,
              aliases: language === 'zh' ? ['启用', '开启'] : ['enable', 'on'],
              targetId: rule.id
            }
      ]
    })),
    ...subscriptionSources.map((source): QuickActionItem => ({
      id: `subscription-source:${source.id}`,
      title: source.name,
      description: `${openText} ${getNavigationItem('subscriptions', language).label} · ${source.kind} · ${source.nodeCount} nodes`,
      group: subscriptionGroup,
      keywords: [
        source.id,
        source.name,
        source.kind,
        source.url,
        source.status,
        source.dedupeKey,
        source.includeFilter ?? '',
        source.excludeFilter ?? ''
      ],
      pageId: 'subscriptions',
      badge: source.status,
      command: {
        kind: 'subscription.sync',
        label: syncSubscriptionCommand,
        aliases: language === 'zh' ? ['刷新', '更新'] : ['refresh', 'update'],
        targetId: source.id
      }
    })),
    ...subscriptionClients.map((client): QuickActionItem => ({
      id: `subscription-client:${client.id}`,
      title: client.displayName,
      description: `${openText} ${getNavigationItem('subscriptions', language).label} · ${client.email} · ${client.protocol}`,
      group: subscriptionGroup,
      keywords: [
        client.id,
        client.displayName,
        client.customerName ?? '',
        client.ruleName ?? '',
        client.subId,
        client.email,
        client.protocol,
        client.group,
        ...client.sourceIds,
        ...client.selectedTags,
        client.includeFilter,
        client.excludeFilter,
        client.routingRule
      ],
      pageId: 'subscriptions',
      badge: client.enabled ? (language === 'zh' ? '启用' : 'on') : (language === 'zh' ? '停用' : 'off'),
      intent: {
        kind: 'subscription.links',
        targetId: client.id
      },
      commands: [
        {
          kind: 'subscription.copy-uri',
          label: copySubscriptionLinkCommand,
          aliases: language === 'zh' ? ['链接'] : ['link'],
          targetId: client.id,
          value: createSubscriptionClientUrl(client, 'uri')
        },
        {
          kind: 'subscription.copy-all',
          label: copyAllSubscriptionLinksCommand,
          aliases: language === 'zh' ? ['全部', '全格式'] : ['all', 'all formats'],
          targetId: client.id,
          value: createSubscriptionClientAllFormatText(client, language)
        }
      ]
    }))
  ];
}

function inferRateLimitDirection(rateLimit?: RateLimitPolicy) {
  if (!rateLimit || rateLimit.mode !== 'one-way') {
    return 'both';
  }

  if (rateLimit.outboundMbps > 0 && rateLimit.inboundMbps <= 0) {
    return 'egress';
  }

  return 'ingress';
}

function resolveRateLimitMbps(rateLimit?: RateLimitPolicy) {
  if (!rateLimit) {
    return 0;
  }

  return rateLimit.mode === 'one-way'
    ? Math.max(rateLimit.inboundMbps, rateLimit.outboundMbps)
    : Math.min(rateLimit.inboundMbps, rateLimit.outboundMbps);
}

function createBrowserPublicBaseUrl() {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;
  const basePath = import.meta.env.BASE_URL ?? '/';
  return new URL(basePath, origin).toString().replace(/\/+$/, '');
}

function downloadDiagnosticExportFile(
  exportFile:
    | AgentLogExportReadModel
    | AgentLogArchiveExportReadModel
    | TrafficRollupExportReadModel
    | TrafficRollupCompactionExportReadModel
) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }

  const blob = new Blob([exportFile.content], { type: exportFile.contentType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = exportFile.filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
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

function createSubscriptionOutputFormatLabel(
  format: SubscriptionClientRuleMetadata['outputFormats'][number],
  language: AppLanguage
) {
  const labels: Record<SubscriptionClientRuleMetadata['outputFormats'][number], string> = {
    uri: 'URI',
    v2ray: language === 'zh' ? 'V2Ray JSON' : 'V2Ray JSON',
    clash: 'Clash',
    mihomo: 'Mihomo',
    'sing-box': 'Sing-box',
    shadowrocket: 'Shadowrocket',
    stash: 'Stash'
  };

  return labels[format];
}

function resolveSubscriptionTrafficFilter(routingRule: string): SubscriptionClientRuleMetadata['trafficFilter'] {
  const match = /\btraffic:(available|quota-exceeded|high|low|limited|unlimited)\b/i.exec(routingRule);
  const value = match?.[1]?.toLowerCase();

  return value &&
    (['available', 'quota-exceeded', 'high', 'low', 'limited', 'unlimited'] as const).some((item) => item === value)
    ? (value as SubscriptionClientRuleMetadata['trafficFilter'])
    : '';
}

function createSubscriptionClientUrl(
  client: ControlPlaneSnapshot['subscriptionClients'][number],
  format: keyof SubscriptionClientRuleMetadata['subscriptionUrlPreview']
) {
  const securePathPreview =
    client.securePathPreview || `/${client.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  return `${createBrowserPublicBaseUrl()}/sub${securePathPreview}/${format}/${client.subId}`;
}

function createSubscriptionClientAllFormatText(
  client: ControlPlaneSnapshot['subscriptionClients'][number],
  language: AppLanguage
) {
  const outputFormats = client.outputFormats?.length
    ? client.outputFormats
    : Array.from(new Set(client.formats.map(mapSubscriptionFormatToOutputFormat)));

  return outputFormats
    .map((format) => {
      return `${createSubscriptionOutputFormatLabel(format, language)}: ${createSubscriptionClientUrl(client, format)}`;
    })
    .join('\n');
}

function createSubscriptionClientExportMetadata(
  client: ControlPlaneSnapshot['subscriptionClients'][number]
): SubscriptionClientRuleMetadata {
  const outputFormats: SubscriptionClientRuleMetadata['outputFormats'] = client.outputFormats?.length
    ? client.outputFormats
    : Array.from(new Set(client.formats.map(mapSubscriptionFormatToOutputFormat)));
  const remainingDays = Math.max(Math.ceil((Date.parse(client.expiresAt) - Date.now()) / 24 / 60 / 60 / 1000), 0);
  const securePathPreview = client.securePathPreview || '';
  const trafficFilter = resolveSubscriptionTrafficFilter(client.routingRule);
  const createSubscriptionUrl = (format: keyof SubscriptionClientRuleMetadata['subscriptionUrlPreview']) =>
    securePathPreview ? createSubscriptionClientUrl(client, format) : '';

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
    trafficFilter,
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
      uri: createSubscriptionUrl('uri'),
      shadowrocket: createSubscriptionUrl('shadowrocket'),
      stash: createSubscriptionUrl('stash')
    },
    clientRule: {
      protocolFilter: client.protocol as SubscriptionClientRuleMetadata['protocol'],
      sourceIds: client.sourceIds,
      tagFilter: client.selectedTags,
      regionFilter: client.regionFilter,
      includeFilter: client.includeFilter,
      excludeFilter: client.excludeFilter,
      routingRule: client.routingRule,
      trafficFilter,
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

function normalizeSubscriptionBindingKey(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function isCustomerNodeClientActionTarget(
  client: XrayInbound['clients'][number],
  input: Pick<CustomerNodeClientActionMutation, 'clientId' | 'clientEmail'>
) {
  const inputClientId = normalizeSubscriptionBindingKey(input.clientId);
  const inputClientEmail = normalizeSubscriptionBindingKey(input.clientEmail);

  return (
    (inputClientId !== '' && normalizeSubscriptionBindingKey(client.id) === inputClientId) ||
    (inputClientEmail !== '' && normalizeSubscriptionBindingKey(client.email) === inputClientEmail)
  );
}

function findExistingCustomerNodeSubscriptionClient(input: {
  subscriptionClients: ControlPlaneSnapshot['subscriptionClients'];
  inbound: XrayInbound;
  client: XrayInbound['clients'][number];
  fallbackMetadata: SubscriptionClientRuleMetadata;
}) {
  const fallbackId = normalizeSubscriptionBindingKey(input.fallbackMetadata.subscriptionClientId);
  const fallbackSubId = normalizeSubscriptionBindingKey(input.fallbackMetadata.subId);
  const clientSubId = normalizeSubscriptionBindingKey(input.client.subId);
  const clientEmail = normalizeSubscriptionBindingKey(input.client.email);
  const protocol = normalizeSubscriptionBindingKey(input.inbound.protocol);
  const expectedGroups = new Set(
    [
      input.fallbackMetadata.group,
      input.inbound.agentId,
      input.inbound.nodeId
    ].map(normalizeSubscriptionBindingKey).filter(Boolean)
  );

  return input.subscriptionClients.find((subscriptionClient) => {
    const subscriptionId = normalizeSubscriptionBindingKey(subscriptionClient.id);
    const subscriptionSubId = normalizeSubscriptionBindingKey(subscriptionClient.subId);
    const subscriptionEmail = normalizeSubscriptionBindingKey(subscriptionClient.email);
    const subscriptionProtocol = normalizeSubscriptionBindingKey(subscriptionClient.protocol);
    const subscriptionGroup = normalizeSubscriptionBindingKey(subscriptionClient.group);

    if (fallbackId && subscriptionId === fallbackId) {
      return true;
    }

    if (fallbackSubId && subscriptionSubId === fallbackSubId) {
      return true;
    }

    if (clientSubId && subscriptionSubId === clientSubId) {
      return true;
    }

    return (
      clientEmail !== '' &&
      subscriptionEmail === clientEmail &&
      subscriptionProtocol === protocol &&
      expectedGroups.has(subscriptionGroup)
    );
  });
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
    upgradeAgentSummary: '远程升级 Agent 运行时',
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
    confirmSyncSubscriptionSource: (name: string) => `确认同步外部订阅源 ${name}？`,
    confirmResetQuota: (name: string) => `确认重置 ${name} 的流量配额？`,
    confirmSetCustomerNodeEnabled: (action: string, email: string) => `确认${action} ${email}？`,
    subscriptionSyncPending: '正在同步外部订阅节点',
    subscriptionSyncSucceeded: (count: number) => `外部订阅同步完成，解析 ${count} 个节点`,
    subscriptionSyncFailed: '外部订阅同步失败',
    compileRoutingSummary: '编译分流策略',
    compileRoutingTarget: '分流策略',
    tuningSummary: '下发系统调优变更',
    tuningTarget: '系统调优',
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
    telegramMutationPending: '正在保存 Telegram 通知设置',
    telegramMutationSucceeded: 'Telegram 通知设置已更新',
    telegramMutationFailed: 'Telegram 通知设置更新失败',
    telegramTestPending: '正在发送 Telegram 测试通知',
    telegramTestSucceeded: 'Telegram 测试通知已提交',
    telegramTestFailed: 'Telegram 测试通知失败',
    telegramBindingPending: '正在更新 Telegram 绑定',
    telegramBindingSucceeded: 'Telegram 绑定已更新',
    telegramBindingFailed: 'Telegram 绑定更新失败',
    telegramDeliveryRetryPending: '正在重试 Telegram 投递',
    telegramDeliveryRetrySucceeded: 'Telegram 投递已重新排队',
    telegramDeliveryRetryFailed: 'Telegram 投递重试失败',
    agentLogRetentionUpdatePending: '正在保存 Agent 日志留存策略',
    agentLogRetentionUpdateSucceeded: 'Agent 日志留存策略已保存',
    agentLogRetentionUpdateFailed: 'Agent 日志留存策略保存失败',
    trafficRollupRetentionUpdatePending: '正在保存流量历史留存策略',
    trafficRollupRetentionUpdateSucceeded: '流量历史留存策略已保存',
    trafficRollupRetentionUpdateFailed: '流量历史留存策略保存失败',
    trafficRollupExportPending: '正在导出流量历史',
    trafficRollupExportSucceeded: (count: number) => `流量历史已导出：${count} 条`,
    trafficRollupExportFailed: '流量历史导出失败',
    trafficRollupCompactionExportPending: '正在导出流量压缩归档',
    trafficRollupCompactionExportSucceeded: (count: number) => `流量压缩归档已导出：${count} 条`,
    trafficRollupCompactionExportFailed: '流量压缩归档导出失败',
    agentLogExportPending: '正在导出 Agent 运行日志',
    agentLogExportSucceeded: (count: number) => `Agent 运行日志已导出：${count} 条`,
    agentLogExportFailed: 'Agent 运行日志导出失败',
    agentLogArchiveExportPending: '正在导出 Agent 日志归档',
    agentLogArchiveExportSucceeded: (count: number) => `Agent 日志归档已导出：${count} 个`,
    agentLogArchiveExportFailed: 'Agent 日志归档导出失败',
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
    upgradeAgentSummary: 'Remote upgrade Agent runtime',
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
    confirmSyncSubscriptionSource: (name: string) => `Sync external subscription source ${name}?`,
    confirmResetQuota: (name: string) => `Reset traffic quota for ${name}?`,
    confirmSetCustomerNodeEnabled: (action: string, email: string) => `${action} ${email}?`,
    subscriptionSyncPending: 'Syncing external subscription nodes',
    subscriptionSyncSucceeded: (count: number) => `External subscription synced with ${count} parsed nodes`,
    subscriptionSyncFailed: 'External subscription sync failed',
    compileRoutingSummary: 'Compile routing policy',
    compileRoutingTarget: 'Routing policy',
    tuningSummary: 'Dispatch system tuning change',
    tuningTarget: 'System tuning',
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
    telegramMutationPending: 'Saving Telegram notification settings',
    telegramMutationSucceeded: 'Telegram notification settings updated',
    telegramMutationFailed: 'Telegram notification settings update failed',
    telegramTestPending: 'Sending Telegram test notification',
    telegramTestSucceeded: 'Telegram test notification submitted',
    telegramTestFailed: 'Telegram test notification failed',
    telegramBindingPending: 'Updating Telegram binding',
    telegramBindingSucceeded: 'Telegram binding updated',
    telegramBindingFailed: 'Telegram binding update failed',
    telegramDeliveryRetryPending: 'Retrying Telegram delivery',
    telegramDeliveryRetrySucceeded: 'Telegram delivery requeued',
    telegramDeliveryRetryFailed: 'Telegram delivery retry failed',
    agentLogRetentionUpdatePending: 'Saving Agent log retention policy',
    agentLogRetentionUpdateSucceeded: 'Agent log retention policy saved',
    agentLogRetentionUpdateFailed: 'Agent log retention policy save failed',
    trafficRollupRetentionUpdatePending: 'Saving traffic history retention policy',
    trafficRollupRetentionUpdateSucceeded: 'Traffic history retention policy saved',
    trafficRollupRetentionUpdateFailed: 'Traffic history retention policy save failed',
    trafficRollupExportPending: 'Exporting traffic history',
    trafficRollupExportSucceeded: (count: number) => `Traffic history exported: ${count}`,
    trafficRollupExportFailed: 'Traffic history export failed',
    trafficRollupCompactionExportPending: 'Exporting compacted traffic archive',
    trafficRollupCompactionExportSucceeded: (count: number) => `Compacted traffic archive exported: ${count}`,
    trafficRollupCompactionExportFailed: 'Compacted traffic archive export failed',
    agentLogExportPending: 'Exporting Agent runtime logs',
    agentLogExportSucceeded: (count: number) => `Agent runtime logs exported: ${count}`,
    agentLogExportFailed: 'Agent runtime log export failed',
    agentLogArchiveExportPending: 'Exporting Agent log archives',
    agentLogArchiveExportSucceeded: (count: number) => `Agent log archives exported: ${count}`,
    agentLogArchiveExportFailed: 'Agent log archive export failed',
    rollbackSummary: (targetLabel: string) => `Rollback ${targetLabel} runtime snapshot`
  }
} as const;


function formatQuickActionConfirmation(commandLabel: string, targetLabel: string, language: AppLanguage) {
  return `${commandLabel} ${targetLabel}${language === 'zh' ? '？' : '?'}`;
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
  const [customerFocusIntent, setCustomerFocusIntent] = useState<CustomerFocusIntent>();
  const [deployDrawerOpen, setDeployDrawerOpen] = useState(false);
  const [deployTargetAgentId, setDeployTargetAgentId] = useState<string>();
  const [forwardingFocusIntent, setForwardingFocusIntent] = useState<ForwardingFocusIntent>();
  const [nodesFocusIntent, setNodesFocusIntent] = useState<NodesFocusIntent>();
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [subscriptionFocusIntent, setSubscriptionFocusIntent] = useState<SubscriptionMixerFocusIntent>();
  const quickActionButtonRef = useRef<HTMLButtonElement | null>(null);
  const quickActionReturnFocusRef = useRef<HTMLElement | null>(null);
  const deployReturnFocusRef = useRef<HTMLElement | null>(null);
  const taskMutationInFlightRef = useRef(false);
  const [taskMutationState, setTaskMutationState] = useState<{
    status: 'idle' | 'pending' | 'succeeded' | 'failed';
    message?: string;
  }>({ status: 'idle' });
  const [controlPlaneBackupPreflightResult, setControlPlaneBackupPreflightResult] =
    useState<ControlPlaneBackupPreflightResult>();

  const activeNav = getNavigationItem(activePage, language);
  const snapshot = useControlPlaneSnapshot(ready);
  const operatorSessionsQuery = useOperatorSessions(ready && activePage === 'adminAccounts');
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
  const routingPolicies = snapshot.data?.routingPolicies ?? EMPTY_ROUTING_POLICIES;
  const tuningProfiles = snapshot.data?.tuningProfiles ?? EMPTY_TUNING_PROFILES;
  const tasks = snapshot.data?.tasks ?? EMPTY_TASKS;
  const commandOutbox = snapshot.data?.commandOutbox ?? EMPTY_COMMAND_OUTBOX;
  const configRevisions = snapshot.data?.configRevisions ?? EMPTY_CONFIG_REVISIONS;
  const preflightPlans = snapshot.data?.preflightPlans ?? EMPTY_PREFLIGHT_PLANS;
  const runtimeSnapshots = snapshot.data?.runtimeSnapshots ?? EMPTY_RUNTIME_SNAPSHOTS;
  const trafficRollups = snapshot.data?.trafficRollups ?? EMPTY_TRAFFIC_ROLLUPS;
  const trafficRollupCompactions = snapshot.data?.trafficRollupCompactions ?? EMPTY_TRAFFIC_ROLLUP_COMPACTIONS;
  const systemAlerts = snapshot.data?.systemAlerts ?? EMPTY_SYSTEM_ALERTS;
  const agentLogRetentionPolicy = snapshot.data?.agentLogRetentionPolicy ?? DEFAULT_AGENT_LOG_RETENTION_POLICY;
  const trafficRollupRetentionPolicy =
    snapshot.data?.trafficRollupRetentionPolicy ?? DEFAULT_TRAFFIC_ROLLUP_RETENTION_POLICY;
  const agentCredentials = snapshot.data?.agentCredentials ?? EMPTY_AGENT_CREDENTIALS;
  const agentSessions = snapshot.data?.agentSessions ?? EMPTY_AGENT_SESSIONS;
  const agentLogChunks = snapshot.data?.agentLogChunks ?? EMPTY_AGENT_LOG_CHUNKS;
  const agentLogArchives = snapshot.data?.agentLogArchives ?? EMPTY_AGENT_LOG_ARCHIVES;
  const auditLogs = snapshot.data?.auditLogs ?? EMPTY_AUDIT_LOGS;
  const telegramBotSettings = snapshot.data?.telegramBotSettings ?? DEFAULT_TELEGRAM_BOT_SETTINGS;
  const telegramBindings = snapshot.data?.telegramBindings ?? EMPTY_TELEGRAM_BINDINGS;
  const telegramNotificationPolicies =
    snapshot.data?.telegramNotificationPolicies.length
      ? snapshot.data.telegramNotificationPolicies
      : DEFAULT_TELEGRAM_NOTIFICATION_POLICIES;
  const telegramNotificationDeliveries =
    snapshot.data?.telegramNotificationDeliveries ?? EMPTY_TELEGRAM_NOTIFICATION_DELIVERIES;
  const operatorSessions = operatorSessionsQuery.data ?? EMPTY_OPERATOR_SESSIONS;
  const taskMutationBusy = taskMutationState.status === 'pending';
  const controlPlaneBackup = useMemo(() => {
    if (!snapshot.data || !operatorSessionsQuery.data) {
      return undefined;
    }

    return createControlPlaneBackupPackage({
      generatedAt: new Date().toISOString(),
      operatorSessions,
      runtimeConfig,
      snapshot: snapshot.data
    });
  }, [operatorSessions, operatorSessionsQuery.data, runtimeConfig, snapshot.data]);
  const controlPlaneBackupSummary = useMemo(
    () => (controlPlaneBackup ? createControlPlaneBackupSummary(controlPlaneBackup) : undefined),
    [controlPlaneBackup]
  );
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
  const agentsOnlineCount = useMemo(() => agents.filter((agent) => agent.status === 'online').length, [agents]);
  const runtimeApplyingCount = useMemo(
    () => tasks.filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'retrying').length,
    [tasks]
  );
  const failedTasksCount = useMemo(() => tasks.filter((task) => task.status === 'failed').length, [tasks]);
  const quotaRiskCount = useMemo(
    () =>
      inbounds.reduce(
        (total, inbound) =>
          total +
          inbound.clients.filter(
            (client) =>
              client.quotaExceeded === true ||
              client.clientExpired === true ||
              client.runtimeDisabledByPolicy === true ||
              Boolean(client.guardrailReason && client.guardrailReason !== 'ok')
          ).length,
        0
      ),
    [inbounds]
  );
  const quickActionItems = useMemo(
    () =>
      createQuickActionItems({
        agents,
        customers,
        forwardingRules,
        inbounds,
        language,
        nodes,
        quotaPolicies,
        systemAlerts,
        tasks,
        subscriptionClients,
        subscriptionSources
      }),
    [
      agents,
      customers,
      forwardingRules,
      inbounds,
      language,
      nodes,
      quotaPolicies,
      systemAlerts,
      tasks,
      subscriptionClients,
      subscriptionSources
    ]
  );
  const quickActionScope = useMemo(
    () => ({
      objects: quickActionItems.length,
      commands: quickActionItems.reduce(
        (total, item) => total + (item.commands ?? (item.command ? [item.command] : [])).length,
        0
      )
    }),
    [quickActionItems]
  );

  const refreshControlPlane = useCallback(() => {
    void snapshot.refetch();
  }, [snapshot]);

  const getStableFocusTarget = useCallback(() => {
    if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) {
      return undefined;
    }

    if (document.activeElement === document.body || document.activeElement === document.documentElement) {
      return undefined;
    }

    return document.activeElement;
  }, []);

  const openQuickActions = useCallback((returnFocusTarget?: HTMLElement | null) => {
    quickActionReturnFocusRef.current = returnFocusTarget ?? getStableFocusTarget() ?? quickActionButtonRef.current;
    setQuickActionsOpen(true);
  }, [getStableFocusTarget]);

  const closeQuickActions = useCallback((options?: { restoreFocus?: boolean }) => {
    setQuickActionsOpen(false);

    if (options?.restoreFocus) {
      const returnTarget = quickActionReturnFocusRef.current;
      quickActionReturnFocusRef.current = null;

      window.setTimeout(() => {
        if (returnTarget?.isConnected) {
          returnTarget.focus();
          return;
        }

        quickActionButtonRef.current?.focus();
      }, 0);
      return;
    }

    quickActionReturnFocusRef.current = null;
  }, []);

  const restoreDeployFocus = useCallback(() => {
    const returnTarget = deployReturnFocusRef.current;
    deployReturnFocusRef.current = null;

    window.setTimeout(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }

      quickActionButtonRef.current?.focus();
    }, 0);
  }, []);

  const closeDeployDrawer = useCallback((options?: { restoreFocus?: boolean }) => {
    setDeployDrawerOpen(false);

    if (options?.restoreFocus) {
      restoreDeployFocus();
      return;
    }

    deployReturnFocusRef.current = null;
  }, [restoreDeployFocus]);

  const navigateToPage = useCallback((pageId: PageId) => {
    setActivePage(pageId);
    setCustomerFocusIntent(undefined);
    setForwardingFocusIntent(undefined);
    setNodesFocusIntent(undefined);
    setSubscriptionFocusIntent(undefined);
    setDeployDrawerOpen(false);
    deployReturnFocusRef.current = null;
  }, []);

  useEffect(() => {
    function handleQuickActionShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openQuickActions();
        return;
      }

      if (event.key === 'Escape' && quickActionsOpen) {
        event.preventDefault();
        closeQuickActions({ restoreFocus: true });
      }
    }

    window.addEventListener('keydown', handleQuickActionShortcut);

    return () => {
      window.removeEventListener('keydown', handleQuickActionShortcut);
    };
  }, [closeQuickActions, openQuickActions, quickActionsOpen]);

  const handleOpenHostWorkspace = useCallback(() => {
    navigateToPage('nodes');
  }, [navigateToPage]);

  const handleOpenForwardingWorkspace = useCallback(() => {
    navigateToPage('forwarding');
  }, [navigateToPage]);

  const handleOpenReleaseEvidenceWorkspace = useCallback(() => {
    navigateToPage('tasks');
  }, [navigateToPage]);

  const handleSelectQuickAction = useCallback((item: QuickActionItem) => {
    prefetchAppShellPage(item.pageId);

    if (item.intent) {
      if (item.intent.kind === 'customer.resources') {
        setCustomerFocusIntent({
          id: `${item.intent.kind}:${item.intent.targetId}:${Date.now()}`,
          kind: item.intent.kind,
          targetId: item.intent.targetId
        });
      }

      if (item.intent.kind === 'forward.edit') {
        setForwardingFocusIntent({
          id: `${item.intent.kind}:${item.intent.targetId}:${Date.now()}`,
          kind: item.intent.kind,
          targetId: item.intent.targetId
        });
      }

      if (item.intent.kind === 'host.deploy' || item.intent.kind === 'customer-node.edit') {
        setNodesFocusIntent({
          id: `${item.intent.kind}:${item.intent.targetId}:${Date.now()}`,
          kind: item.intent.kind,
          targetId: item.intent.targetId
        });
      }

      if (item.intent.kind === 'subscription.links') {
        setSubscriptionFocusIntent({
          id: `${item.intent.kind}:${item.intent.targetId}:${Date.now()}`,
          kind: item.intent.kind,
          targetId: item.intent.targetId
        });
      }
    }

    setActivePage(item.pageId);
    setQuickActionsOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    if (runtimeConfig.controlPlaneMode !== 'http') {
      logout();
      return;
    }

    setTaskMutationState({ status: 'pending', message: t.logoutPending });

    try {
      const response = await fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl ?? ''), {
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

  const runQuotaResetTask = useCallback(
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

  const handleDeployHostConfig = useCallback((agent: Agent) => {
    deployReturnFocusRef.current = getStableFocusTarget() ?? quickActionButtonRef.current;
    setDeployTargetAgentId(agent.id);
    setDeployDrawerOpen(true);
  }, [getStableFocusTarget]);

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

  const previewAgentUpgradeCommand = useCallback(
    (agent: Agent, reason: string) => {
      const requestId = createBoundedMutationKey(`ui:agent-upgrade-command:${agent.id}:${Date.now()}`, 150);
      const scriptUrl = `${createBrowserPublicBaseUrl()}/install/ou-agent.sh`;

      return api.createAgentUpgradeCommand(
        {
          agentId: agent.id,
          reason,
          scriptUrl
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
      closeDeployDrawer({ restoreFocus: true });
      return;
    }

    void runTask({
      operation: 'agent.deploy',
      resourceType: 'agent',
      targetId: targetAgent.id,
      targetLabel: targetAgent.name,
      summary: t.deployRuntimeSummary
    });
    closeDeployDrawer({ restoreFocus: true });
  }, [agents, closeDeployDrawer, deployTargetAgent, runTask, t.deployRuntimeSummary, t.noManagedHostForDeploy]);

  const handleRemoteAgentUpgrade = useCallback(
    (agent: Agent, reason: string) => {
      const scriptUrl = `${createBrowserPublicBaseUrl()}/install/ou-agent.sh`;

      void runTask(
        {
          operation: 'agent.upgrade',
          resourceType: 'agent',
          targetId: agent.id,
          targetLabel: agent.name,
          summary: t.upgradeAgentSummary,
          metadata: {
            reason,
            scriptUrl
          }
        },
        {
          idempotencyKey: createBoundedMutationKey(`ui:agent-upgrade:${agent.id}:${reason}:${Date.now()}`, 190)
        }
      );
    },
    [runTask, t.upgradeAgentSummary]
  );

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
    async (metadata: CustomerNodeConfigMetadata, action: 'create' | 'update'): Promise<CustomerNodeSaveResult> => {
      const operation = action === 'create' ? 'inbound.create' : 'inbound.update';
      const subscriptionMetadata = createCustomerNodeSubscriptionMetadata(metadata, createBrowserPublicBaseUrl());
      const inboundInput = createCustomerNodeInboundTaskInput(metadata, action, {
        create: t.createCustomerNodeSummary,
        update: t.updateCustomerNodeSummary
      });

      const inboundTask = await runTask(
        inboundInput,
        {
          idempotencyKey: createCustomerNodeInboundIdempotencyKey(metadata, operation)
        }
      );

      if (!inboundTask) {
        return {
          accepted: false,
          action,
          targetNodeId: metadata.nodeId,
          targetLabel: metadata.customerNodeName
        };
      }

      const subscriptionTask = await runTask(
        createSubscriptionClientGenerateTaskInput(subscriptionMetadata, action, {
          create: t.createSubscriptionClientSummary,
          update: t.updateSubscriptionClientSummary
        }),
        {
          idempotencyKey: createSubscriptionClientGenerateIdempotencyKey(subscriptionMetadata, action)
        }
      );

      return {
        accepted: true,
        action,
        runtimeTaskId: inboundTask.id,
        subscriptionTaskId: subscriptionTask?.id,
        targetNodeId: metadata.nodeId,
        targetLabel: metadata.customerNodeName
      };
    },
    [
      runTask,
      t.createCustomerNodeSummary,
      t.createSubscriptionClientSummary,
      t.updateCustomerNodeSummary,
      t.updateSubscriptionClientSummary
    ]
  );

  const handleApplyCustomerNodeClientAction = useCallback(
    async (input: CustomerNodeClientActionMutation) => {
      if (taskMutationInFlightRef.current) {
        setTaskMutationState({ status: 'pending', message: t.taskMutationPending });
        return false;
      }

      taskMutationInFlightRef.current = true;
      setTaskMutationState({ status: 'pending', message: t.taskMutationPending });
      let actionResult: CustomerNodeClientActionResult | undefined;

      try {
        const xrayClientActionInbound =
          input.action.kind === 'add-client' || input.action.kind === 'delete-client'
            ? inbounds.find((inbound) => inbound.id === input.inboundId)
            : undefined;

        if ((input.action.kind === 'add-client' || input.action.kind === 'delete-client') && !xrayClientActionInbound) {
          throw new Error(`Xray inbound not found for ${input.inboundId}.`);
        }

        const addedClientSubscriptionMetadata =
          input.action.kind === 'add-client' && xrayClientActionInbound
            ? createAddedCustomerNodeClientSubscriptionMetadata({
                inbound: xrayClientActionInbound,
                action: input.action,
                publicBaseUrl: createBrowserPublicBaseUrl(),
                observedAt: input.observedAt
              })
            : undefined;
        const deletedClient =
          input.action.kind === 'delete-client' && xrayClientActionInbound
            ? xrayClientActionInbound.clients.find((client) => isCustomerNodeClientActionTarget(client, input))
            : undefined;

        if (input.action.kind === 'delete-client' && !deletedClient) {
          throw new Error(`Xray client not found for inbound ${input.inboundId}.`);
        }

        const deletedClientSubscriptionMetadata =
          input.action.kind === 'delete-client' && xrayClientActionInbound && deletedClient
            ? (() => {
                const fallbackMetadata = createCustomerNodeClientSubscriptionMetadata({
                  inbound: xrayClientActionInbound,
                  client: deletedClient,
                  publicBaseUrl: createBrowserPublicBaseUrl()
                });
                const existingSubscriptionClient = findExistingCustomerNodeSubscriptionClient({
                  subscriptionClients,
                  inbound: xrayClientActionInbound,
                  client: deletedClient,
                  fallbackMetadata
                });

                return existingSubscriptionClient
                  ? createCustomerNodeClientSubscriptionMetadata({
                      inbound: xrayClientActionInbound,
                      client: deletedClient,
                      publicBaseUrl: createBrowserPublicBaseUrl(),
                      existingSubscriptionClient
                    })
                  : fallbackMetadata;
              })()
            : undefined;

        const runtimeTask = await api.applyXrayClientAction(input, {
          ...createUiRequestContext('xray.client.action', input.inboundId, runtimeConfig),
          idempotencyKey: undefined
        });
        actionResult = {
          accepted: true,
          actionKind: input.action.kind,
          runtimeTaskId: runtimeTask.id,
          targetClientId:
            input.clientId ||
            (input.action.kind === 'add-client' ? input.action.clientIdentity : undefined) ||
            deletedClient?.id,
          targetClientEmail:
            input.clientEmail ||
            (input.action.kind === 'add-client' ? input.action.clientEmail : undefined) ||
            deletedClient?.email
        };

        if (addedClientSubscriptionMetadata) {
          const subscriptionInput = createSubscriptionClientGenerateTaskInput(
            addedClientSubscriptionMetadata,
            'create',
            {
              create: t.createSubscriptionClientSummary,
              update: t.updateSubscriptionClientSummary
            }
          );

          const subscriptionTask = await api.createTask(
            subscriptionInput,
            createUiMutationContext(
              subscriptionInput,
              createSubscriptionClientGenerateIdempotencyKey(addedClientSubscriptionMetadata, 'create'),
              runtimeConfig
            )
          );
          actionResult.subscriptionTaskId = subscriptionTask.id;
        }

        if (deletedClientSubscriptionMetadata && deletedClient) {
          const deleteInput = createSubscriptionClientDeleteTaskInput(
            deletedClientSubscriptionMetadata,
            t.deleteSubscriptionClientSummary,
            {
              ...(input.reason === 'operator-delete-customer-node'
                ? { deletedWithCustomerNodeId: input.inboundId }
                : {}),
              deletedWithXrayInboundId: input.inboundId,
              deletedWithXrayClientId: deletedClient.id,
              deletedWithXrayClientEmail: deletedClient.email,
              deletedWithXrayClientAction: true
            }
          );
          const deleteScope =
            input.reason === 'operator-delete-customer-node'
              ? `customer-node:${input.inboundId}`
              : `xray-client:${input.inboundId}:${deletedClientSubscriptionMetadata.subId}`;

          const subscriptionTask = await api.createTask(
            deleteInput,
            createUiMutationContext(
              deleteInput,
              createSubscriptionClientDeleteIdempotencyKey(deletedClientSubscriptionMetadata, deleteScope),
              runtimeConfig
            )
          );
          actionResult.subscriptionTaskId = subscriptionTask.id;
        }
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.taskMutationFailed)
        });
        taskMutationInFlightRef.current = false;
        return false;
      }

      setTaskMutationState({ status: 'succeeded', message: t.taskQueued });

      try {
        await snapshot.refetch();
      } catch {
        setTaskMutationState({ status: 'succeeded', message: t.taskQueuedDeferred });
      } finally {
        taskMutationInFlightRef.current = false;
      }

      return actionResult ?? true;
    },
    [
      api,
      inbounds,
      language,
      runtimeConfig,
      snapshot,
      subscriptionClients,
      t.createSubscriptionClientSummary,
      t.deleteSubscriptionClientSummary,
      t.taskMutationFailed,
      t.taskMutationPending,
      t.taskQueued,
      t.taskQueuedDeferred,
      t.updateSubscriptionClientSummary
    ]
  );

  const handleDeleteCustomerNode = useCallback(
    (metadata: CustomerNodeConfigMetadata) => {
      void (async () => {
        await handleApplyCustomerNodeClientAction({
          inboundId: metadata.nodeId,
          clientId: metadata.clientIdentity,
          clientEmail: metadata.clientEmail,
          action: {
            kind: 'delete-client'
          },
          reason: 'operator-delete-customer-node'
        });
      })();
    },
    [handleApplyCustomerNodeClientAction]
  );

  const handleCreateForwarding = useCallback(
    (metadata: ForwardingCreateMetadata, action: 'create' | 'update' = 'create', ruleId?: string) => {
      const operation = action === 'create' ? 'forward.create' : 'forward.update';
      const targetId = createForwardingTargetId(metadata, ruleId);
      void runTask(
        createForwardingUpsertTaskInput(metadata, action, {
          ruleId,
          createSummary: t.createForwardingSummary,
          updateSummary: t.applyForwardingSummary,
          defaultTargetLabel: t.createForwardingTarget(metadata.listenPort)
        }),
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
      const operation = action === 'pause' ? 'forward.pause' : action === 'resume' ? 'forward.resume' : 'forward.apply';
      const input = createForwardingRunTaskInput(id, rule, action, {
        apply: t.applyForwardingSummary,
        pause: t.pauseForwardingSummary,
        resume: t.resumeForwardingSummary,
        defaultTargetLabel: t.applyForwardingTarget
      });

      void runTask(input, {
        idempotencyKey: createForwardingIdempotencyKey(operation, id, input.metadata as ForwardingCreateMetadata | undefined)
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
        createForwardingDeleteTaskInput(rule, t.deleteForwardingSummary),
        {
          idempotencyKey: createForwardingDeleteIdempotencyKey(rule)
        }
      );
    },
    [runTask, t.deleteForwardingSummary]
  );

  const handleImportSubscriptionSource = useCallback(
    (metadata: SubscriptionSourceImportMetadata) => {
      const targetId = createSubscriptionSourceImportTargetId(metadata);

      return (async () => {
        const importInput = createSubscriptionSourceImportTaskInput(metadata, t.importSubscriptionSourceSummary);
        const task = await runTask(importInput, {
          idempotencyKey: createSubscriptionSourceImportIdempotencyKey(metadata)
        });

        if (!task) {
          return false;
        }

        const syncInput = createSubscriptionSourceImportSyncTaskInput(metadata, t.subscriptionSyncPending);

        setTaskMutationState({ status: 'pending', message: t.subscriptionSyncPending });

        try {
          const result = await api.syncSubscriptionSource(
            targetId,
            createUiMutationContext(
              syncInput,
              createSubscriptionSourceSyncIdempotencyKey(targetId, 'import', Date.now()),
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
        createSubscriptionClientGenerateTaskInput(metadata, action, {
          create: t.createSubscriptionClientSummary,
          update: t.updateSubscriptionClientSummary
        }),
        {
          idempotencyKey: createSubscriptionClientGenerateIdempotencyKey(metadata, action)
        }
      );
    },
    [runTask, t.createSubscriptionClientSummary, t.updateSubscriptionClientSummary]
  );

  const handleDeleteSubscriptionClient = useCallback(
    (metadata: SubscriptionClientRuleMetadata) => {
      void runTask(
        createSubscriptionClientDeleteTaskInput(metadata, t.deleteSubscriptionClientSummary),
        {
          idempotencyKey: createSubscriptionClientDeleteIdempotencyKey(metadata)
        }
      );
    },
    [runTask, t.deleteSubscriptionClientSummary]
  );

  const handleSaveSubscriptionExportProfile = useCallback(
    (metadata: SubscriptionExportProfileMetadata, action: 'create' | 'update') => {
      void runTask(
        createSubscriptionExportProfileUpsertTaskInput(metadata, t.saveSubscriptionProfileSummary),
        {
          idempotencyKey: createSubscriptionExportProfileUpsertIdempotencyKey(metadata, action)
        }
      );
    },
    [runTask, t.saveSubscriptionProfileSummary]
  );

  const handleDeleteSubscriptionExportProfile = useCallback(
    (metadata: SubscriptionExportProfileMetadata) => {
      void runTask(
        createSubscriptionExportProfileDeleteTaskInput(metadata, t.deleteSubscriptionProfileSummary),
        {
          idempotencyKey: createSubscriptionExportProfileDeleteIdempotencyKey(metadata.profileId)
        }
      );
    },
    [runTask, t.deleteSubscriptionProfileSummary]
  );

  const handleDeleteSubscriptionSource = useCallback(
    (source: SubscriptionSource) => {
      return runTask(
        createSubscriptionSourceDeleteTaskInput(source, t.deleteSubscriptionSourceSummary),
        {
          idempotencyKey: createSubscriptionSourceDeleteIdempotencyKey(source.id)
        }
      ).then(Boolean);
    },
    [runTask, t.deleteSubscriptionSourceSummary]
  );

  const handleSyncSubscriptionSource = useCallback(
    (source: SubscriptionSource) => {
      return (async () => {
        const syncInput = createSubscriptionSourceSyncTaskInput(source, t.subscriptionSyncPending);

        setTaskMutationState({ status: 'pending', message: t.subscriptionSyncPending });

        try {
          const result = await api.syncSubscriptionSource(
            source.id,
            createUiMutationContext(
              syncInput,
              createSubscriptionSourceSyncIdempotencyKey(source.id, 'manual', Date.now()),
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

  const handleRunQuickActionCommand = useCallback(
    (item: QuickActionItem, command: QuickActionCommand) => {
      switch (command.kind) {
        case 'customer-node.copy-all-subscription-links': {
          const [inboundId, clientId] = command.targetId.split(':');
          const inbound = inbounds.find((current) => current.id === inboundId);
          const client = inbound?.clients.find((current) => current.id === clientId);

          if (!inbound || !client) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          const metadata = createCustomerNodeMetadataFromInbound(inbound, client, agents, nodes, client.enabled);
          const subscriptionMetadata = createCustomerNodeSubscriptionMetadata(metadata, createBrowserPublicBaseUrl());
          void copyText(createCustomerNodeAllSubscriptionText(subscriptionMetadata));
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          break;
        }
        case 'customer-node.copy-subscription-link': {
          const [inboundId, clientId] = command.targetId.split(':');
          const inbound = inbounds.find((current) => current.id === inboundId);
          const client = inbound?.clients.find((current) => current.id === clientId);

          if (!inbound || !client) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          const metadata = createCustomerNodeMetadataFromInbound(inbound, client, agents, nodes, client.enabled);
          const subscriptionMetadata = createCustomerNodeSubscriptionMetadata(metadata, createBrowserPublicBaseUrl());
          void copyText(subscriptionMetadata.subscriptionUrlPreview.clash);
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          break;
        }
        case 'customer-node.copy-share-link': {
          const [inboundId, clientId] = command.targetId.split(':');
          const inbound = inbounds.find((current) => current.id === inboundId);
          const client = inbound?.clients.find((current) => current.id === clientId);

          if (!inbound || !client) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          const metadata = createCustomerNodeMetadataFromInbound(inbound, client, agents, nodes, client.enabled);
          void copyText(createCustomerNodeShareLink(metadata));
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          break;
        }
        case 'customer-node.set-enabled': {
          const [inboundId, clientId] = command.targetId.split(':');
          const inbound = inbounds.find((current) => current.id === inboundId);
          const client = inbound?.clients.find((current) => current.id === clientId);
          const enabled = command.value === 'true';

          if (!inbound || !client) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          const confirmed =
            typeof window === 'undefined' || window.confirm(t.confirmSetCustomerNodeEnabled(command.label, client.email));

          setActivePage(item.pageId);
          setQuickActionsOpen(false);

          if (!confirmed) {
            return;
          }

          void handleSaveCustomerNode(
            {
              ...createCustomerNodeMetadataFromInbound(inbound, client, agents, nodes, enabled),
              clients: createCustomerNodeClientMetadataListFromInbound(inbound, client, enabled)
            },
            'update'
          );
          break;
        }
        case 'customer-node.reset-traffic': {
          const policy = quotaPolicies.find((current) => current.id === command.targetId);

          if (!policy) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          const confirmed = typeof window === 'undefined' || window.confirm(t.confirmResetQuota(policy.name));

          setActivePage(item.pageId);
          setQuickActionsOpen(false);

          if (!confirmed) {
            return;
          }

          runQuotaResetTask(policy);
          break;
        }
        case 'forward.apply':
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          handleRunForwarding(command.targetId, 'apply');
          break;
        case 'forward.pause':
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          if (
            typeof window !== 'undefined' &&
            !window.confirm(formatQuickActionConfirmation(command.label, item.title, language))
          ) {
            break;
          }
          handleRunForwarding(command.targetId, 'pause');
          break;
        case 'forward.resume':
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          if (
            typeof window !== 'undefined' &&
            !window.confirm(formatQuickActionConfirmation(command.label, item.title, language))
          ) {
            break;
          }
          handleRunForwarding(command.targetId, 'resume');
          break;
        case 'subscription.sync': {
          const source = subscriptionSources.find((current) => current.id === command.targetId);

          if (!source) {
            setTaskMutationState({ status: 'failed', message: t.subscriptionSyncFailed });
            return;
          }

          const confirmed =
            typeof window === 'undefined' || window.confirm(t.confirmSyncSubscriptionSource(source.name));

          setActivePage(item.pageId);
          setQuickActionsOpen(false);

          if (!confirmed) {
            return;
          }

          void handleSyncSubscriptionSource(source);
          break;
        }
        case 'subscription.copy-uri':
        case 'subscription.copy-all':
          if (!command.value) {
            setTaskMutationState({ status: 'failed', message: t.taskMutationFailed });
            return;
          }

          void copyText(command.value);
          setActivePage(item.pageId);
          setQuickActionsOpen(false);
          break;
      }
    },
    [
      agents,
      handleRunForwarding,
      handleSaveCustomerNode,
      handleSyncSubscriptionSource,
      inbounds,
      language,
      nodes,
      quotaPolicies,
      runQuotaResetTask,
      subscriptionSources,
      t
    ]
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
        createSubscriptionExportTaskInput(file, exportMetadata, t.generateSubscriptionSummary),
        {
          idempotencyKey: createSubscriptionExportIdempotencyKey(file, exportMetadata)
        }
      );
    },
    [runTask, subscriptionClients, subscriptionExportProfiles, t.generateSubscriptionSummary]
  );

  const handleRunRouting = useCallback(
    (id: string, policyIds: string[] = [], manualRule?: ManualRoutingRuleMetadata) => {
      const scopedPolicyIds = [...new Set(policyIds)].filter((policyId) => policyId.trim() !== '');
      const idempotencyParts = ['ui', 'config.compile', id, ...scopedPolicyIds];

      if (manualRule) {
        idempotencyParts.push(manualRule.manualRuleId);
      }

      void runTask(
        {
          operation: 'config.compile',
          targetId: id,
          targetLabel: t.compileRoutingTarget,
          summary: t.compileRoutingSummary,
          metadata: {
            policyIds: scopedPolicyIds,
            policyCount: scopedPolicyIds.length,
            ...(manualRule ? { manualRule } : {})
          }
        },
        {
          idempotencyKey: idempotencyParts.join(':')
        }
      );
    },
    [runTask, t.compileRoutingSummary, t.compileRoutingTarget]
  );

  const handleRunTuning = useCallback(
    (id: string, agentId: string, profileOverride?: TuningProfile) => {
      const profile = profileOverride ?? tuningProfiles.find((item) => item.id === id);
      const selectedAgent = agents.find((item) => item.id === agentId);
      const tuningPreset = profile
        ? {
            id: profile.id,
            name: profile.name,
            target: profile.target,
            riskLevel: profile.riskLevel
          }
        : undefined;
      const probeState = {
        bbrInstalled: Boolean(
          selectedAgent?.capabilities.includes('bbr')
          || selectedAgent?.telemetry.runtimeServices?.some(
            (service) => service.moduleKind === 'bbr' && service.status === 'active'
          )
        ),
        tcpProbeReady: Boolean(selectedAgent?.telemetry.reportedAt || selectedAgent?.lastHeartbeatAt),
        kernelVersion: selectedAgent?.hardware.kernelVersion ?? ''
      };
      const sysctlPlan = profile
        ? {
            id: profile.id,
            name: profile.name,
            target: profile.target,
            riskLevel: profile.riskLevel,
            parameters: profile.parameters
          }
        : undefined;
      void runTask({
        operation: 'system.tune',
        resourceType: 'agent',
        targetId: agentId,
        targetLabel: profile ? `${profile.name} / ${agentId}` : agentId,
        summary: t.tuningSummary,
        metadata: {
          agentId,
          tuningProfileId: id,
          tuningProfileName: profile?.name ?? t.tuningTarget,
          tuningTarget: profile?.target ?? 'network',
          tuningRiskLevel: profile?.riskLevel ?? 'medium',
          tuningPreset,
          probeState,
          sysctlPlan,
          tuningActions: ['install_or_enable_bbr', 'set_tcp_congestion_control', 'apply_tcp_buffers'],
          sysctl: Object.fromEntries((profile?.parameters ?? []).map((parameter) => [parameter.key, parameter.value])),
          parameters: profile?.parameters ?? [],
          requiresRoot: true,
          rollbackMode: 'graceful_restart'
        },
        riskConfirmation: {
          operation: 'system.tune',
          targetId: agentId,
          reason: profile?.name ?? t.tuningTarget
        }
      });
    },
    [agents, runTask, t.tuningSummary, t.tuningTarget, tuningProfiles]
  );

  const handleResetQuota = useCallback(
    (policy: QuotaPolicy) => {
      runQuotaResetTask(policy);
    },
    [runQuotaResetTask]
  );

  const runControlPlaneAction = useCallback(
    async <T,>(input: {
      action: () => Promise<T>;
      failedMessage: string;
      operation: string;
      pendingMessage: string;
      succeededMessage: string;
      targetId: string;
    }) => {
      if (taskMutationState.status === 'pending') {
        return undefined;
      }

      setTaskMutationState({ status: 'pending', message: input.pendingMessage });

      try {
        const result = await input.action();
        await snapshot.refetch();
        setTaskMutationState({ status: 'succeeded', message: input.succeededMessage });
        return result;
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, input.failedMessage)
        });
        return undefined;
      }
    },
    [language, snapshot, taskMutationState.status]
  );

  const handleUpdateTelegramSettings = useCallback(
    (input: Parameters<typeof api.updateTelegramBotSettings>[0]) =>
      runControlPlaneAction({
        operation: 'telegram_bot.settings.update',
        targetId: 'telegram-bot',
        pendingMessage: t.telegramMutationPending,
        succeededMessage: t.telegramMutationSucceeded,
        failedMessage: t.telegramMutationFailed,
        action: () =>
          api.updateTelegramBotSettings(
            input,
            createUiRequestContext(
              'telegram_bot.settings.update',
              'telegram-bot',
              runtimeConfig,
              ['ui', 'telegram_bot.settings.update', createStableHash(input.reason ?? '')].join(':')
            )
          )
      }),
    [api, runControlPlaneAction, runtimeConfig, t.telegramMutationFailed, t.telegramMutationPending, t.telegramMutationSucceeded]
  );

  const handleTestTelegramNotification = useCallback(
    (input: Parameters<typeof api.testTelegramBotNotification>[0]) =>
      runControlPlaneAction({
        operation: 'telegram_bot.test',
        targetId: 'telegram-bot-test',
        pendingMessage: t.telegramTestPending,
        succeededMessage: t.telegramTestSucceeded,
        failedMessage: t.telegramTestFailed,
        action: () =>
          api.testTelegramBotNotification(
            input,
            createUiRequestContext(
              'telegram_bot.test',
              'telegram-bot-test',
              runtimeConfig,
              ['ui', 'telegram_bot.test', Date.now()].join(':')
            )
          )
      }),
    [api, runControlPlaneAction, runtimeConfig, t.telegramTestFailed, t.telegramTestPending, t.telegramTestSucceeded]
  );

  const handleCreateTelegramBinding = useCallback(
    (input: Parameters<typeof api.createTelegramBinding>[0]) =>
      runControlPlaneAction({
        operation: 'telegram_binding.create',
        targetId: input.customerId,
        pendingMessage: t.telegramBindingPending,
        succeededMessage: t.telegramBindingSucceeded,
        failedMessage: t.telegramBindingFailed,
        action: () =>
          api.createTelegramBinding(
            input,
            createUiRequestContext(
              'telegram_binding.create',
              input.customerId,
              runtimeConfig,
              ['ui', 'telegram_binding.create', input.telegramChatId, input.customerId, input.scopeType].join(':')
            )
          )
      }),
    [api, runControlPlaneAction, runtimeConfig, t.telegramBindingFailed, t.telegramBindingPending, t.telegramBindingSucceeded]
  );

  const handleCreateTelegramChallenge = useCallback(
    (input: Parameters<typeof api.createTelegramBindingChallenge>[0]) =>
      runControlPlaneAction({
        operation: 'telegram_binding_challenge.create',
        targetId: input.customerId,
        pendingMessage: t.telegramBindingPending,
        succeededMessage: t.telegramBindingSucceeded,
        failedMessage: t.telegramBindingFailed,
        action: () =>
          api.createTelegramBindingChallenge(
            input,
            createUiRequestContext(
              'telegram_binding_challenge.create',
              input.customerId,
              runtimeConfig,
              ['ui', 'telegram_binding_challenge.create', input.customerId, input.scopeType, Date.now()].join(':')
            )
          )
      }),
    [api, runControlPlaneAction, runtimeConfig, t.telegramBindingFailed, t.telegramBindingPending, t.telegramBindingSucceeded]
  );

  const handleRevokeTelegramBinding = useCallback(
    (bindingId: string, reason?: string) =>
      runControlPlaneAction({
        operation: 'telegram_binding.revoke',
        targetId: bindingId,
        pendingMessage: t.telegramBindingPending,
        succeededMessage: t.telegramBindingSucceeded,
        failedMessage: t.telegramBindingFailed,
        action: () =>
          api.revokeTelegramBinding(
            bindingId,
            { reason: reason?.trim() || 'operator revoked Telegram binding' },
            createUiRequestContext(
              'telegram_binding.revoke',
              bindingId,
              runtimeConfig,
              ['ui', 'telegram_binding.revoke', bindingId, Date.now()].join(':')
            )
          )
      }).then(() => undefined),
    [api, runControlPlaneAction, runtimeConfig, t.telegramBindingFailed, t.telegramBindingPending, t.telegramBindingSucceeded]
  );

  const handleUpdateTelegramPolicy = useCallback(
    (policyId: string, input: Parameters<typeof api.updateTelegramNotificationPolicy>[1]) =>
      runControlPlaneAction({
        operation: 'telegram_notification_policy.update',
        targetId: policyId,
        pendingMessage: t.telegramMutationPending,
        succeededMessage: t.telegramMutationSucceeded,
        failedMessage: t.telegramMutationFailed,
        action: () =>
          api.updateTelegramNotificationPolicy(
            policyId,
            input,
            createUiRequestContext(
              'telegram_notification_policy.update',
              policyId,
              runtimeConfig,
              ['ui', 'telegram_notification_policy.update', policyId, createStableHash(input.reason ?? '')].join(':')
            )
          )
      }),
    [api, runControlPlaneAction, runtimeConfig, t.telegramMutationFailed, t.telegramMutationPending, t.telegramMutationSucceeded]
  );

  const handleRetryTelegramDelivery = useCallback(
    (deliveryId: string) =>
      runControlPlaneAction({
        operation: 'telegram_notification.delivery_retry',
        targetId: deliveryId,
        pendingMessage: t.telegramDeliveryRetryPending,
        succeededMessage: t.telegramDeliveryRetrySucceeded,
        failedMessage: t.telegramDeliveryRetryFailed,
        action: () =>
          api.retryTelegramNotificationDelivery(
            deliveryId,
            createUiRequestContext(
              'telegram_notification.delivery_retry',
              deliveryId,
              runtimeConfig,
              ['ui', 'telegram_notification.delivery_retry', deliveryId, Date.now()].join(':')
            )
          )
      }).then(() => undefined),
    [
      api,
      runControlPlaneAction,
      runtimeConfig,
      t.telegramDeliveryRetryFailed,
      t.telegramDeliveryRetryPending,
      t.telegramDeliveryRetrySucceeded
    ]
  );

  const handleUpdateAgentLogRetentionPolicy = useCallback(
    (input: AgentLogRetentionPolicyUpdateInput) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.agentLogRetentionUpdatePending });

      void (async () => {
        try {
          await api.updateAgentLogRetentionPolicy(
            input,
            createUiRequestContext(
              'agent.log_retention.update',
              'agent-log-retention-policy',
              runtimeConfig,
              [
                'ui',
                'agent.log_retention.update',
                input.maxAgeDays,
                input.maxEventsPerAgent,
                createStableHash(input.reason ?? '')
              ].join(':')
            )
          );
          await snapshot.refetch();
          setTaskMutationState({ status: 'succeeded', message: t.agentLogRetentionUpdateSucceeded });
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.agentLogRetentionUpdateFailed)
          });
        }
      })();
    },
    [
      api,
      language,
      runtimeConfig,
      snapshot,
      t.agentLogRetentionUpdateFailed,
      t.agentLogRetentionUpdatePending,
      t.agentLogRetentionUpdateSucceeded,
      taskMutationState.status
    ]
  );

  const handleUpdateTrafficRollupRetentionPolicy = useCallback(
    (input: TrafficRollupRetentionPolicyUpdateInput) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.trafficRollupRetentionUpdatePending });

      void (async () => {
        try {
          await api.updateTrafficRollupRetentionPolicy(
            input,
            createUiRequestContext(
              'traffic.rollup_retention.update',
              'traffic-rollup-retention-policy',
              runtimeConfig,
              [
                'ui',
                'traffic.rollup_retention.update',
                input.maxAgeDays,
                input.maxRecordsPerScope,
                createStableHash(input.reason ?? '')
              ].join(':')
            )
          );
          await snapshot.refetch();
          setTaskMutationState({ status: 'succeeded', message: t.trafficRollupRetentionUpdateSucceeded });
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.trafficRollupRetentionUpdateFailed)
          });
        }
      })();
    },
    [
      api,
      language,
      runtimeConfig,
      snapshot,
      t.trafficRollupRetentionUpdateFailed,
      t.trafficRollupRetentionUpdatePending,
      t.trafficRollupRetentionUpdateSucceeded,
      taskMutationState.status
    ]
  );

  const handleExportAgentLogs = useCallback(() => {
    if (taskMutationState.status === 'pending') {
      return;
    }

    setTaskMutationState({ status: 'pending', message: t.agentLogExportPending });

    void (async () => {
      try {
        const exportFile = await api.exportAgentLogChunks({
          limit: 1000,
          format: 'jsonl'
        });
        downloadDiagnosticExportFile(exportFile);
        setTaskMutationState({ status: 'succeeded', message: t.agentLogExportSucceeded(exportFile.count) });
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.agentLogExportFailed)
        });
      }
    })();
  }, [
    api,
    language,
    t,
    taskMutationState.status
  ]);

  const handleExportAgentLogArchives = useCallback(() => {
    if (taskMutationState.status === 'pending') {
      return;
    }

    setTaskMutationState({ status: 'pending', message: t.agentLogArchiveExportPending });

    void (async () => {
      try {
        const exportFile = await api.exportAgentLogArchives({
          limit: 1000,
          format: 'jsonl'
        });
        downloadDiagnosticExportFile(exportFile);
        setTaskMutationState({ status: 'succeeded', message: t.agentLogArchiveExportSucceeded(exportFile.count) });
      } catch (error) {
        setTaskMutationState({
          status: 'failed',
          message: formatTaskMutationError(error, language, t.agentLogArchiveExportFailed)
        });
      }
    })();
  }, [
    api,
    language,
    t,
    taskMutationState.status
  ]);

  const handleExportTrafficRollups = useCallback(
    (dimension: TrafficRollup['dimension']) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.trafficRollupExportPending });

      void (async () => {
        try {
          const exportFile = await api.exportTrafficRollups({
            dimension,
            limit: 1000,
            format: 'jsonl'
          });
          downloadDiagnosticExportFile(exportFile);
          setTaskMutationState({ status: 'succeeded', message: t.trafficRollupExportSucceeded(exportFile.count) });
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.trafficRollupExportFailed)
          });
        }
      })();
    },
    [
      api,
      language,
      t,
      taskMutationState.status
    ]
  );

  const handleExportTrafficRollupCompactions = useCallback(
    (dimension: TrafficRollup['dimension']) => {
      if (taskMutationState.status === 'pending') {
        return;
      }

      setTaskMutationState({ status: 'pending', message: t.trafficRollupCompactionExportPending });

      void (async () => {
        try {
          const exportFile = await api.exportTrafficRollupCompactions({
            dimension,
            limit: 1000,
            format: 'jsonl'
          });
          downloadDiagnosticExportFile(exportFile);
          setTaskMutationState({
            status: 'succeeded',
            message: t.trafficRollupCompactionExportSucceeded(exportFile.count)
          });
        } catch (error) {
          setTaskMutationState({
            status: 'failed',
            message: formatTaskMutationError(error, language, t.trafficRollupCompactionExportFailed)
          });
        }
      })();
    },
    [
      api,
      language,
      t,
      taskMutationState.status
    ]
  );

  const handleVerifyAuditLogs = useCallback(
    (logs: AuditLog[]) => api.verifyAuditLogChain(logs),
    [api]
  );

  const handleCopyControlPlaneBackup = useCallback(() => {
    if (!controlPlaneBackup) {
      return;
    }

    void copyText(JSON.stringify(controlPlaneBackup, null, 2));
  }, [controlPlaneBackup]);

  const handlePreflightControlPlaneBackup = useCallback(
    (backupText: string) => {
      setControlPlaneBackupPreflightResult(preflightControlPlaneBackupPackage(backupText, snapshot.data));
    },
    [snapshot.data]
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
            focusIntent={nodesFocusIntent}
            inbounds={inbounds}
            language={language}
            nodes={nodes}
            quotaPolicies={quotaPolicies}
            subscriptionClients={subscriptionClients}
            tasks={tasks}
            commandOutbox={commandOutbox}
            configRevisions={configRevisions}
            preflightPlans={preflightPlans}
            runtimeSnapshots={runtimeSnapshots}
            returnFocusRef={quickActionButtonRef}
            workspaceMode="hosts"
            taskMutationBusy={taskMutationBusy}
            onDeleteCustomerNode={handleDeleteCustomerNode}
            onDeleteHost={handleDeleteHost}
            onDeployHostConfig={handleDeployHostConfig}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
            onPreviewAgentUpgradeCommand={previewAgentUpgradeCommand}
            onRemoteAgentUpgrade={handleRemoteAgentUpgrade}
            onOpenRuntimeEvidenceWorkspace={handleOpenReleaseEvidenceWorkspace}
            onRollbackRuntimeTask={handleRollbackTask}
            onResetCustomerNodeTraffic={handleResetQuota}
            onApplyCustomerNodeClientAction={handleApplyCustomerNodeClientAction}
            onSaveHostConfig={handleSaveHostConfig}
            onSaveCustomerNode={handleSaveCustomerNode}
          />
        );
      case 'customerNodes':
        return (
          <NodesPage
            agents={agents}
            focusIntent={nodesFocusIntent}
            inbounds={inbounds}
            language={language}
            nodes={nodes}
            quotaPolicies={quotaPolicies}
            subscriptionClients={subscriptionClients}
            tasks={tasks}
            commandOutbox={commandOutbox}
            configRevisions={configRevisions}
            preflightPlans={preflightPlans}
            runtimeSnapshots={runtimeSnapshots}
            returnFocusRef={quickActionButtonRef}
            workspaceMode="customerNodes"
            taskMutationBusy={taskMutationBusy}
            onDeleteCustomerNode={handleDeleteCustomerNode}
            onDeleteHost={handleDeleteHost}
            onDeployHostConfig={handleDeployHostConfig}
            onPreviewAgentInstallCommand={previewAgentInstallCommand}
            onPreviewAgentUpgradeCommand={previewAgentUpgradeCommand}
            onRemoteAgentUpgrade={handleRemoteAgentUpgrade}
            onOpenRuntimeEvidenceWorkspace={handleOpenReleaseEvidenceWorkspace}
            onRollbackRuntimeTask={handleRollbackTask}
            onResetCustomerNodeTraffic={handleResetQuota}
            onApplyCustomerNodeClientAction={handleApplyCustomerNodeClientAction}
            onSaveHostConfig={handleSaveHostConfig}
            onSaveCustomerNode={handleSaveCustomerNode}
          />
        );
      case 'customers':
        return (
          <CustomersPage
            customers={customers}
            focusIntent={customerFocusIntent}
            language={language}
            returnFocusRef={quickActionButtonRef}
          />
        );
      case 'forwarding':
        return (
          <ForwardingPage
            agents={agents}
            focusIntent={forwardingFocusIntent}
            language={language}
            returnFocusRef={quickActionButtonRef}
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
            focusIntent={subscriptionFocusIntent}
            language={language}
            returnFocusRef={quickActionButtonRef}
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
      case 'telegram':
        return (
          <TelegramNotificationSettingsPage
            bindings={telegramBindings}
            deliveries={telegramNotificationDeliveries}
            language={language}
            mutationBusy={taskMutationBusy}
            policies={telegramNotificationPolicies}
            settings={telegramBotSettings}
            onCreateBinding={handleCreateTelegramBinding}
            onCreateChallenge={handleCreateTelegramChallenge}
            onRetryDelivery={handleRetryTelegramDelivery}
            onRevokeBinding={handleRevokeTelegramBinding}
            onTestNotification={handleTestTelegramNotification}
            onUpdatePolicy={handleUpdateTelegramPolicy}
            onUpdateSettings={handleUpdateTelegramSettings}
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
      case 'adminAccounts':
        return (
          <AdminAccountSettingsPage
            agentCredentials={agentCredentials}
            agentSessions={agentSessions}
            controlPlaneBackupPreflightResult={controlPlaneBackupPreflightResult}
            controlPlaneBackupSummary={controlPlaneBackupSummary}
            controlPlaneMode={runtimeConfig.controlPlaneMode}
            currentOperatorSessionId={operatorSessionId}
            language={language}
            loginUsername={runtimeConfig.loginUsername}
            operatorGroupId={runtimeConfig.operatorGroupId}
            operatorSessions={operatorSessions}
            operatorSessionsError={
              operatorSessionsQuery.error
                ? formatTaskMutationError(operatorSessionsQuery.error, language, t.operatorSessionRevokeFailed)
                : undefined
            }
            operatorSessionsLoading={operatorSessionsQuery.isLoading}
            resourceGroupId={runtimeConfig.resourceGroupId}
            taskMutationBusy={taskMutationBusy}
            onCopyControlPlaneBackup={controlPlaneBackup ? handleCopyControlPlaneBackup : undefined}
            onPreflightControlPlaneBackup={handlePreflightControlPlaneBackup}
            onRevokeAgentCredential={handleRevokeAgentCredential}
            onRevokeOperatorSession={handleRevokeOperatorSession}
            onRotateAgentCredential={handleRotateAgentCredential}
          />
        );
      case 'tuning':
        return (
          <TuningPage
            agents={agents}
            language={language}
            profiles={tuningProfiles}
            tasks={tasks}
            taskMutationBusy={taskMutationBusy}
            onRunTask={handleRunTuning}
          />
        );
      case 'tasks':
        return (
          <TasksPage
            tasks={tasks}
            agentLogChunks={agentLogChunks}
            agentLogArchives={agentLogArchives}
            agentLogArchiveExportBusy={taskMutationBusy}
            agentLogExportBusy={taskMutationBusy}
            agentLogRetentionPolicy={agentLogRetentionPolicy}
            agentLogRetentionBusy={taskMutationBusy}
            commandOutbox={commandOutbox}
            configRevisions={configRevisions}
            language={language}
            preflightPlans={preflightPlans}
            runtimeSnapshots={runtimeSnapshots}
            taskMutationBusy={taskMutationBusy}
            onExportAgentLogArchives={handleExportAgentLogArchives}
            onExportAgentLogs={handleExportAgentLogs}
            onUpdateAgentLogRetentionPolicy={handleUpdateAgentLogRetentionPolicy}
            onRollbackTask={handleRollbackTask}
            onRefresh={() => void refreshControlPlane()}
          />
        );
      case 'audit':
        return <AuditPage auditLogs={auditLogs} language={language} onVerifyAuditLogs={handleVerifyAuditLogs} />;
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
            trafficRollupCompactions={trafficRollupCompactions}
            trafficRollupExportBusy={taskMutationBusy}
            trafficRollupRetentionBusy={taskMutationBusy}
            trafficRollupRetentionPolicy={trafficRollupRetentionPolicy}
            systemAlerts={systemAlerts}
            language={language}
            onExportTrafficRollupCompactions={handleExportTrafficRollupCompactions}
            onExportTrafficRollups={handleExportTrafficRollups}
            onOpenForwardingWorkspace={handleOpenForwardingWorkspace}
            onOpenHostWorkspace={handleOpenHostWorkspace}
            onOpenReleaseEvidenceWorkspace={handleOpenReleaseEvidenceWorkspace}
            onUpdateTrafficRollupRetentionPolicy={handleUpdateTrafficRollupRetentionPolicy}
            onRefresh={() => void refreshControlPlane()}
          />
        );
    }
  }, [
    activePage,
    agentCredentials,
    agentSessions,
    agentLogArchives,
    agentLogChunks,
    agentLogRetentionPolicy,
    agents,
    auditLogs,
    commandOutbox,
    configRevisions,
    customers,
    customerFocusIntent,
    controlPlaneBackupPreflightResult,
    forwardingFocusIntent,
    forwardingRules,
    controlPlaneBackup,
    controlPlaneBackupSummary,
    handleApplyCustomerNodeClientAction,
    handleCreateForwarding,
    handleCopyControlPlaneBackup,
    handleDeleteCustomerNode,
    handleDeleteForwarding,
    handleDeleteHost,
    handleDeleteSubscriptionClient,
    handleDeleteSubscriptionExportProfile,
    handleDeleteSubscriptionSource,
    handleDeployHostConfig,
    handleRemoteAgentUpgrade,
    handleExportAgentLogArchives,
    handleExportAgentLogs,
    handleExportTrafficRollupCompactions,
    handleExportTrafficRollups,
    handleVerifyAuditLogs,
    handleImportSubscriptionSource,
    handleGenerateSubscriptionExportFile,
    handleCreateTelegramBinding,
    handleCreateTelegramChallenge,
    handleOpenForwardingWorkspace,
    handleOpenHostWorkspace,
    handleOpenReleaseEvidenceWorkspace,
    handlePreflightControlPlaneBackup,
    handleRevokeAgentCredential,
    handleRetryTelegramDelivery,
    handleRevokeOperatorSession,
    handleRevokeTelegramBinding,
    handleResetQuota,
    handleRollbackTask,
    handleRunForwarding,
    handleRunRouting,
    handleRunTuning,
    handleRotateAgentCredential,
    handleSaveCustomerNode,
    handleSaveHostConfig,
    handleSaveSubscriptionExportProfile,
    handleSaveSubscriptionClient,
    handleSyncSubscriptionSource,
    handleTestTelegramNotification,
    handleUpdateTelegramPolicy,
    handleUpdateTelegramSettings,
    handleUpdateAgentLogRetentionPolicy,
    handleUpdateTrafficRollupRetentionPolicy,
    inbounds,
    language,
    nodes,
    nodesFocusIntent,
    operatorSessionId,
    operatorSessions,
    operatorSessionsQuery.error,
    operatorSessionsQuery.isLoading,
    proxyProviders,
    previewAgentInstallCommand,
    previewAgentUpgradeCommand,
    preflightPlans,
    quotaPolicies,
    refreshControlPlane,
    routingPolicies,
    runtimeConfig,
    runtimeSnapshots,
    systemAlerts,
    telegramBindings,
    telegramBotSettings,
    telegramNotificationDeliveries,
    telegramNotificationPolicies,
    trafficRollupRetentionPolicy,
    trafficRollupCompactions,
    trafficRollups,
    subscriptionClients,
    subscriptionExportProfiles,
    subscriptionExportFiles,
    subscriptionFocusIntent,
    subscriptionInventoryNodes,
    subscriptionSources,
    subscriptions,
    taskMutationBusy,
    tasks,
    t.operatorSessionRevokeFailed,
    tuningProfiles
  ]);

  return (
    <div
      aria-hidden={!ready}
      className={ready ? 'app-container app-ready ou-shell h-[100dvh] overflow-hidden' : 'app-container ou-shell h-[100dvh] overflow-hidden'}
      id="app-main"
    >
      <div
        aria-hidden={quickActionsOpen ? true : undefined}
        className="contents ou-shell"
        data-testid="app-shell-background"
        inert={quickActionsOpen ? true : undefined}
      >
        <Sidebar activePage={activePage} language={language} onPageChange={navigateToPage} />
        <main className="island-panel h-full min-h-0 min-w-0 flex-1 overflow-hidden max-md:min-h-[100dvh] max-md:pb-28">
          <Topbar
            title={activeNav.label}
            language={language}
            quickActionScope={quickActionScope}
            showGlobalActions
            onLanguageChange={setLanguage}
            onLogout={() => void handleLogout()}
            onOpenQuickActions={openQuickActions}
            onToggleTheme={toggleTheme}
            quickActionButtonRef={quickActionButtonRef}
          />
          <div className="relative min-h-0 flex-1 overflow-y-auto p-8 max-md:px-3 max-md:pb-28 max-md:pt-3">
            {taskMutationState.status !== 'idle' ? (
              <div
                role={taskMutationState.status === 'failed' ? 'alert' : 'status'}
                className={
                  taskMutationState.status === 'failed'
                    ? 'ou-tone-danger mb-4 border p-3 text-xs font-semibold shadow-[var(--ou-shadow-interactive)]'
                    : 'surface-muted mb-4 border p-3 text-xs font-semibold text-[var(--ou-text-muted)] shadow-[var(--ou-shadow-interactive)]'
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
            <AppShellWorkspaceChrome
              activePage={activePage}
              agentsCount={agents.length}
              agentsOnlineCount={agentsOnlineCount}
              alertsCount={systemAlerts.length}
              failedTasksCount={failedTasksCount}
              forwardingRulesCount={forwardingRules.length}
              language={language}
              loading={snapshot.isLoading}
              nodesCount={nodes.length}
              quotaRiskCount={quotaRiskCount}
              runtimeApplyingCount={runtimeApplyingCount}
              subscriptionsCount={subscriptions.length}
              tasksCount={tasks.length}
              onOpenQuickActions={openQuickActions}
              onPrefetchPage={prefetchAppShellPage}
              onSelectPage={navigateToPage}
            />
            {snapshot.isLoading && activePage !== 'dashboard' ? <ControlPlaneSkeleton language={language} /> : null}
            {!snapshot.isLoading ? (
              <Suspense fallback={<ControlPlaneSkeleton language={language} />}>
                <section className="page-view active ou-page-enter">{content}</section>
              </Suspense>
            ) : null}
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
          onClose={() => closeDeployDrawer({ restoreFocus: true })}
          onConfirm={confirmDeployRuntimeConfig}
        />
        <MobileBottomNav
          activePage={activePage}
          language={language}
          quickActionScope={quickActionScope}
          onOpenQuickActions={openQuickActions}
          onPageChange={navigateToPage}
          onPrefetchPage={prefetchAppShellPage}
        />
      </div>
      <QuickActionPalette
        items={quickActionItems}
        language={language}
        open={quickActionsOpen}
        onClose={() => closeQuickActions({ restoreFocus: true })}
        onRunCommand={handleRunQuickActionCommand}
        onSelect={handleSelectQuickAction}
      />
    </div>
  );
}
