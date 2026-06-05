import { createHash, randomUUID } from 'node:crypto';
import { lookup as lookupDns } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type {
  Agent,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AuditLog,
  CreateTaskInput,
  DeployTask,
  DeployTaskStatus,
  ForwardRule,
  ManagedNode,
  OperatorSessionRevokeRequest,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
  SystemAlert,
  TuningProfile,
  XrayInbound
} from '../../domain';
import {
  applyAgentTask,
  applyForwardRuleTask,
  applySubscriptionClientTask,
  applySubscriptionExportProfileTask,
  applySubscriptionSourceTask,
  applyXrayInboundTask,
  createCustomersFromReadModels,
  createSubscriptionClientFromTask,
  createSubscriptionBundlesFromInventory,
  countCrossSourceSubscriptionInventoryDuplicates,
  createProxyProvidersFromSources,
  createSubscriptionExportFilesFromClients,
  createSubscriptionExportProfileFromTask,
  readSubscriptionExportProfileDeleteId,
  createSubscriptionSourceFromTask,
  readSubscriptionSourceDeleteId
} from '../../domain';
import type {
  AgentSessionState,
  ControlPlaneRepository,
  ControlPlaneTransaction,
  PersistedSystemAlertRecord
} from '../../server/control-plane/control-plane-repository';
import {
  normalizeAgentLogRetentionPolicy,
  type AgentLogRetentionPolicy
} from '../../server/control-plane/agent-log-retention';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import type { OperatorSessionStore } from '../../server/control-plane/operator-session-store';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import { applyAgentEventToReadModel, applyAgentLivenessToReadModel } from './agent-telemetry-read-model';
import {
  applyForwardingBillingWindowToReadModel,
  applyForwardingTelemetryToReadModel
} from './forwarding-telemetry-read-model';
import { applyXrayTelemetryToReadModel, applyXrayTrafficWindowToReadModel } from './xray-telemetry-read-model';
import type {
  AgentRequestDeniedAuditInput,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput,
  AuditChainVerification,
  CommandOutboxItem,
  ControlPlaneApi,
  MutationContext,
  OperatorRequestDeniedAuditInput
} from './control-plane-api';
import { createAgentLogExport, createObservabilityMetrics, selectAgentLogChunks, v1ApiBoundary } from './control-plane-api';
import { createQuotaPoliciesFromReadModels } from './quota-policies';
import { deriveForwardQuotaEnforcementTaskIntents } from './forward-quota-enforcement-tasks';
import { deriveXrayGuardrailTaskIntents } from './xray-guardrail-enforcement-tasks';
import {
  applyQuotaResetStateToAgentEvent,
  applyQuotaResetStateToForwardingEvent,
  applyQuotaResetStateToXrayEvent,
  createQuotaResetTaskInput,
  applyQuotaResetTaskToAgents,
  applyQuotaResetTaskToForwardRules,
  applyQuotaResetTaskToInbounds,
  applyQuotaResetTaskToSubscriptionClients,
  applyQuotaResetTasksToExplicitPolicies,
  createQuotaResetReplayState,
  prepareQuotaResetTaskInput,
  readLatestSubscriptionClientResetDescriptor
} from './quota-reset-tasks';
import { projectSubscriptionClientRuntimeState } from './subscription-output';
import { parseSubscriptionSourceContent } from './subscription-source-parser';
import {
  createSystemAlertsFromAgents,
  createSystemAlertsFromCommandOutbox,
  createSystemAlertsFromQuotaPolicies
} from './system-alerts';
import type {
  SystemAlertNotification,
  SystemAlertNotificationBatch,
  SystemAlertNotificationDeliveryRecord,
  SystemAlertNotifier,
  SystemAlertNotificationRetryOptions,
  SystemAlertNotificationRetryResult,
  SystemAlertNotificationType
} from './system-alert-notifications';

type ControlPlaneService = ReturnType<typeof createControlPlaneService>;

type ServiceBackedControlPlaneApiInput = {
  repository: ControlPlaneRepository;
  service: ControlPlaneService;
  operatorSessionStore?: OperatorSessionStore;
  inventory?: Partial<{
    agents: Agent[];
    nodes: ManagedNode[];
    inbounds: XrayInbound[];
    subscriptionSources: SubscriptionSource[];
    subscriptionInventoryNodes: SubscriptionInventoryNode[];
    subscriptionBundles: SubscriptionBundle[];
    subscriptionClients: SubscriptionClientIdentity[];
    subscriptionExportProfiles: SubscriptionExportProfile[];
    quotaPolicies: QuotaPolicy[];
    rateLimitPolicies: RateLimitPolicy[];
    routingPolicies: RoutingPolicy[];
    tuningProfiles: TuningProfile[];
  }>;
  fetcher?: typeof fetch;
  subscriptionSourceRemoteFetcher?: SubscriptionSourceRemoteFetcher;
  subscriptionSourceHostResolver?: SubscriptionSourceHostResolver;
  subscriptionSourceFetch?: Partial<SubscriptionSourceFetchPolicy>;
  subscriptionSourceEgress?: Partial<SubscriptionSourceEgressPolicy>;
  subscriptionSourceProviderBudget?: Partial<SubscriptionSourceProviderBudgetPolicy>;
  agentLogRetention?: Partial<AgentLogRetentionPolicy>;
  systemAlertNotifier?: SystemAlertNotifier;
  systemAlertNotificationRetry?: Partial<SystemAlertNotificationRetryPolicy>;
  readModelNow?: () => string;
};

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const SUBSCRIPTION_SOURCE_FETCH_TIMEOUT_MS = 20_000;
const SUBSCRIPTION_SOURCE_MAX_BODY_BYTES = 5 * 1024 * 1024;
const SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SUBSCRIPTION_SOURCE_SYNC_LEASE_MIN_MS = 60_000;
const SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST = 2;

const AGENT_LOG_RETENTION_DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_ALERT_NOTIFICATION_DELIVERY_HISTORY_LIMIT = 500;
const SYSTEM_ALERT_NOTIFICATION_RETRY_DELAY_MS = 60_000;
const SYSTEM_ALERT_NOTIFICATION_MAX_ATTEMPTS = 3;
const SYSTEM_ALERT_NOTIFICATION_MAX_DELIVERIES_PER_SWEEP = 25;

type SubscriptionSourceFetchPolicy = {
  timeoutMs: number;
  maxBodyBytes: number;
};

type SubscriptionSourceEgressPolicy = {
  allowedHosts: string[];
};

type SubscriptionSourceProviderBudgetPolicy = {
  maxConcurrentFetchesPerHost: number;
};

type SystemAlertNotificationRetryPolicy = {
  retryDelayMs: number;
  maxAttempts: number;
  maxDeliveriesPerSweep: number;
};

type SubscriptionSourceResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type SubscriptionSourceHostResolver = (hostname: string) => Promise<SubscriptionSourceResolvedAddress[]>;

type SubscriptionSourceRemoteTarget = {
  url: URL;
  resolvedAddress: SubscriptionSourceResolvedAddress;
  resolvedAddresses: SubscriptionSourceResolvedAddress[];
};

type SubscriptionSourceRemoteFetcherInput = {
  source: SubscriptionSource;
  target: SubscriptionSourceRemoteTarget;
  headers: Record<string, string>;
  policy: SubscriptionSourceFetchPolicy;
  signal: AbortSignal;
};

type SubscriptionSourceRemoteFetcher = (
  input: SubscriptionSourceRemoteFetcherInput
) => Promise<FetchedSubscriptionSourceContent>;

type FetchedSubscriptionSourceContent = {
  body: string;
  trafficHeader?: string | null;
};

const defaultSubscriptionSourceHostResolver: SubscriptionSourceHostResolver = async (hostname) => {
  const records = await lookupDns(hostname, { all: true });

  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4
  }));
};

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }

  return value;
}

function createStableSha256LikeHash(value: unknown) {
  const normalized = JSON.stringify(normalizeForHash(value));
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function parseTimestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toIsoAfter(value: string, delayMs: number) {
  return new Date(parseTimestampMs(value) + Math.max(1, Math.round(delayMs))).toISOString();
}

function normalizeSystemAlertNotificationRetryPolicy(
  input: Partial<SystemAlertNotificationRetryPolicy> | undefined
): SystemAlertNotificationRetryPolicy {
  return {
    retryDelayMs: Math.max(1, Math.round(input?.retryDelayMs ?? SYSTEM_ALERT_NOTIFICATION_RETRY_DELAY_MS)),
    maxAttempts: Math.max(1, Math.round(input?.maxAttempts ?? SYSTEM_ALERT_NOTIFICATION_MAX_ATTEMPTS)),
    maxDeliveriesPerSweep: Math.max(
      1,
      Math.round(input?.maxDeliveriesPerSweep ?? SYSTEM_ALERT_NOTIFICATION_MAX_DELIVERIES_PER_SWEEP)
    )
  };
}

function sanitizeSystemAlertNotificationError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function createAuditIntegrityHash(log: AuditLog) {
  const hashableLog = { ...log };
  delete hashableLog.hash;
  return createStableSha256LikeHash(hashableLog);
}

function verifyAuditLogs(logs: AuditLog[]): AuditChainVerification {
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    const expectedPrevHash = index < logs.length - 1 ? logs[index + 1].hash : AUDIT_GENESIS_HASH;

    if (log.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'prev_hash.mismatch'
      };
    }

    if (log.hash !== createAuditIntegrityHash(log)) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'hash.mismatch'
      };
    }
  }

  return {
    valid: true,
    checked: logs.length
  };
}

function resolveMutationContext(context: MutationContext | undefined): MutationContext {
  return {
    actor: context?.actor ?? 'admin',
    operatorGroupId: context?.operatorGroupId,
    resourceGroupId: context?.resourceGroupId,
    sourceIp: context?.sourceIp ?? '127.0.0.1',
    userAgent: context?.userAgent,
    requestId: context?.requestId ?? `req-service-api-${Date.now()}`,
    idempotencyKey: context?.idempotencyKey,
    ifMatch: context?.ifMatch
  };
}

function normalizeAgentCapabilities(capabilities: string[] | undefined): Agent['capabilities'] {
  const normalized = (capabilities ?? [])
    .map((capability) => {
      if (capability === 'flvx') return 'port-forwarding';
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'port-forwarding' ||
        capability === 'bbr'
      ) {
        return capability;
      }

      return undefined;
    })
    .filter((capability): capability is Agent['capabilities'][number] => Boolean(capability));

  const fallback: Agent['capabilities'] = ['host-agent'];
  return [...new Set<Agent['capabilities'][number]>(normalized.length > 0 ? normalized : fallback)];
}

function createAgentFromCredential(credential: AgentCredentialSummary, session?: AgentSessionState): Agent {
  const observedAt = session?.lastHeartbeatAt ?? session?.updatedAt ?? credential.lastUsedAt ?? credential.issuedAt;
  const capabilities = normalizeAgentCapabilities(
    session?.capabilities ?? credential.metadata.registrationCapabilities ?? credential.metadata.installProfile
  );

  return {
    id: credential.agentId,
    name: credential.agentId,
    status: session?.status ?? 'provisioning',
    region: 'custom',
    publicAddress: credential.sourceIp || 'pending',
    connectionMode: 'pull',
    version: session?.version ?? credential.metadata.registrationVersion ?? 'unknown',
    platform: credential.metadata.registrationPlatform ?? 'linux/unknown',
    capabilities,
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt: '',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: observedAt,
    telemetry: {
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 0,
      latencySamplesMs: [],
      packetLossPercent: 0,
      packetLossSamplesPercent: [],
      onlineDays: 0,
      samplingExpectedSince: observedAt
    }
  };
}

function sortTasksForReadModelReplay(tasks: DeployTask[]) {
  return clone(tasks).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta === 0 ? left.id.localeCompare(right.id) : timeDelta;
  });
}

function sortAgentEventsForReadModelReplay(events: AgentEventEnvelope[]) {
  return clone(events).sort((left, right) => {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta || left.agentId.localeCompare(right.agentId) || left.seq - right.seq || left.eventId.localeCompare(right.eventId);
  });
}

function readTaskMetadataString(task: DeployTask, key: string, fallback: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readAgentIdFromTask(task: DeployTask) {
  return readTaskMetadataString(task, 'agentId', task.targetId);
}

function updateSubscriptionSourceSyncState(
  sources: SubscriptionSource[],
  sourceId: string,
  patch: Partial<
    Pick<
      SubscriptionSource,
      'status' | 'nodeCount' | 'lastSyncAt' | 'traffic' | 'syncWarnings' | 'syncLeaseOwnerId' | 'syncLeaseExpiresAt'
    >
  >
) {
  return sources.map((source) =>
    source.id === sourceId
      ? {
          ...source,
          ...patch
        }
      : source
  );
}

function createSubscriptionSyncAuditLog(input: {
  source: SubscriptionSource;
  result: SubscriptionSourceSyncResult;
  context: MutationContext;
  before: unknown;
  after: unknown;
}): AuditLog {
  const failed = input.result.status === 'failed';
  const warning = input.result.status === 'warning';

  return {
    id: `audit-subscription-sync-${input.source.id}-${input.context.requestId}-${randomUUID()}`,
    action: failed ? 'subscription.source.sync_failed' : 'subscription.source.synced',
    actor: input.context.actor,
    operatorGroupId: input.context.operatorGroupId,
    resourceGroupId: input.context.resourceGroupId,
    scope: 'control-plane:subscription',
    resourceType: 'subscription',
    operation: 'subscription.sync',
    result: failed ? 'failed' : 'succeeded',
    targetId: input.source.id,
    targetLabel: input.source.name,
    taskId: '',
    severity: failed || warning ? 'warning' : 'info',
    message: failed
      ? `Subscription source sync failed: ${input.source.name}`
      : `Subscription source synced: ${input.source.name}`,
    createdAt: input.result.syncedAt,
    sourceIp: input.context.sourceIp,
    userAgent: input.context.userAgent,
    requestId: input.context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'subscription.sync',
      sourceId: input.source.id
    }),
    before: input.before,
    after: input.after
  };
}

function uniqueAuditValues(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function createAgentRequestDeniedAuditLog(input: AgentRequestDeniedAuditInput, createdAt: string): AuditLog {
  const agentIds = uniqueAuditValues(input.agentIds);
  const sessionIds = uniqueAuditValues(input.sessionIds);
  const targetId = agentIds.length === 1 ? agentIds[0] : agentIds.length > 1 ? 'multiple-agents' : 'agent-authentication';
  const targetLabel = agentIds.length > 1 ? `${agentIds.length} Agent identities` : targetId;
  const authenticatedAgent =
    input.authenticatedAgentId || input.authenticatedSessionId || input.credentialId
      ? {
          agentId: input.authenticatedAgentId,
          sessionId: input.authenticatedSessionId,
          credentialId: input.credentialId
        }
      : undefined;
  const operation = input.endpoint === 'poll' ? 'agent.poll' : 'agent.events';
  const after = {
    endpoint: input.endpoint,
    agentIds,
    sessionIds,
    tokenPresented: input.tokenPresented
  };

  return {
    id: `audit-agent-request-denied-${input.endpoint}-${input.requestId}-${randomUUID()}`,
    action: 'audit.denied',
    actor: input.authenticatedAgentId ? `agent:${input.authenticatedAgentId}` : 'agent:unauthenticated',
    scope: 'control-plane:agent',
    resourceType: 'agent',
    operation,
    result: 'denied',
    targetId,
    targetLabel,
    taskId: '',
    severity: 'critical',
    message: `Agent ${input.endpoint} request denied -> ${input.denialCode}`,
    createdAt,
    sourceIp: input.sourceIp,
    userAgent: input.userAgent,
    requestId: input.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation,
      denialCode: input.denialCode,
      agentIds,
      sessionIds,
      tokenPresented: input.tokenPresented
    }),
    denialCode: input.denialCode,
    denialReason: input.denialReason,
    before: authenticatedAgent ? { authenticatedAgent } : undefined,
    after
  };
}

function createOperatorRequestDeniedAuditLog(input: OperatorRequestDeniedAuditInput, createdAt: string): AuditLog {
  const targetId = `${input.method.toUpperCase()} ${input.path}`;

  return {
    id: `audit-operator-request-denied-${input.requestId}-${randomUUID()}`,
    action: 'audit.denied',
    actor: 'operator:unauthenticated',
    scope: 'control-plane:operator',
    resourceType: 'permission',
    operation: 'operator.auth',
    result: 'denied',
    targetId,
    targetLabel: targetId,
    taskId: '',
    severity: 'critical',
    message: `Operator request denied -> ${input.denialCode}`,
    createdAt,
    sourceIp: input.sourceIp,
    userAgent: input.userAgent,
    requestId: input.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'operator.auth',
      method: input.method.toUpperCase(),
      path: input.path,
      denialCode: input.denialCode,
      tokenPresented: input.tokenPresented
    }),
    denialCode: input.denialCode,
    denialReason: input.denialReason,
    after: {
      method: input.method.toUpperCase(),
      path: input.path,
      tokenPresented: input.tokenPresented
    }
  };
}

function createAgentLogRetentionPolicyUpdatedAuditLog(input: {
  context: MutationContext;
  before: AgentLogRetentionPolicyReadModel;
  after: AgentLogRetentionPolicyReadModel;
  reason?: string;
  createdAt: string;
}): AuditLog {
  return {
    id: `audit-agent-log-retention-${input.context.requestId}-${randomUUID()}`,
    action: 'agent.log_retention.updated',
    actor: input.context.actor,
    operatorGroupId: input.context.operatorGroupId,
    resourceGroupId: input.context.resourceGroupId,
    scope: 'control-plane:agent-log-retention',
    resourceType: 'agent',
    operation: 'agent.log_retention.update',
    result: 'succeeded',
    targetId: 'agent-log-retention-policy',
    targetLabel: 'Agent log retention policy',
    taskId: '',
    severity: 'warning',
    message: 'Agent log retention policy updated',
    createdAt: input.createdAt,
    sourceIp: input.context.sourceIp,
    userAgent: input.context.userAgent,
    requestId: input.context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'agent.log_retention.update',
      maxAgeDays: input.after.maxAgeDays,
      maxEventsPerAgent: input.after.maxEventsPerAgent,
      reason: input.reason
    }),
    before: input.before,
    after: {
      ...input.after,
      reason: input.reason
    }
  };
}

function createSubscriptionSourceRateLimitError(source: SubscriptionSource, now: string, nextAllowedAt: string) {
  return Object.assign(new Error(`subscription_source.rate_limited:${source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: source.id,
      refreshIntervalMinutes: source.refreshIntervalMinutes ?? source.rateLimitPerMinute,
      lastSyncAt: source.lastSyncAt,
      attemptedAt: now,
      nextAllowedAt
    }
  });
}

function createSubscriptionSourceProviderBudgetError(
  source: SubscriptionSource,
  providerHost: string,
  activeSources: SubscriptionSource[],
  now: string,
  maxConcurrentFetchesPerHost: number
) {
  const activeLeaseExpiries = activeSources
    .map((item) => Date.parse(item.syncLeaseExpiresAt ?? ''))
    .filter((timestamp) => !Number.isNaN(timestamp))
    .sort((left, right) => left - right);
  const nextAllowedAt = activeLeaseExpiries[0] ? new Date(activeLeaseExpiries[0]).toISOString() : now;

  return Object.assign(new Error(`subscription_source.provider_budget_exceeded:${source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: source.id,
      providerHost,
      attemptedAt: now,
      nextAllowedAt,
      maxConcurrentFetchesPerHost,
      activeSyncCount: activeSources.length,
      activeSourceIds: activeSources.map((item) => item.id)
    }
  });
}

function createAgentLogRetentionPolicyReadModel(
  policyInput: Partial<AgentLogRetentionPolicy> | undefined,
  source: AgentLogRetentionPolicyReadModel['source']
): AgentLogRetentionPolicyReadModel {
  const policy = normalizeAgentLogRetentionPolicy(policyInput);

  return {
    maxAgeMs: policy.maxAgeMs,
    maxAgeDays: policy.maxAgeMs / AGENT_LOG_RETENTION_DAY_MS,
    maxEventsPerAgent: policy.maxEventsPerAgent,
    source
  };
}

function toAgentLogRetentionPolicy(input: AgentLogRetentionPolicyUpdateInput): AgentLogRetentionPolicy {
  return normalizeAgentLogRetentionPolicy({
    maxAgeMs: Math.round(input.maxAgeDays * AGENT_LOG_RETENTION_DAY_MS),
    maxEventsPerAgent: input.maxEventsPerAgent
  });
}

function createPersistedSystemAlertRecord(
  alert: SystemAlert,
  now: string,
  existing?: PersistedSystemAlertRecord
): PersistedSystemAlertRecord {
  const reactivated = existing?.status === 'resolved';
  const nextRecord: PersistedSystemAlertRecord = {
    ...alert,
    status: 'active',
    firstObservedAt: !existing || reactivated ? alert.observedAt : existing.firstObservedAt,
    lastChangedAt:
      !existing
      || reactivated
      || existing.severity !== alert.severity
      || existing.message !== alert.message
      || existing.title !== alert.title
      || existing.observedAt !== alert.observedAt
      || existing.resourceLabel !== alert.resourceLabel
      || createStableSha256LikeHash(existing.metadata ?? {}) !== createStableSha256LikeHash(alert.metadata ?? {})
        ? now
        : existing.lastChangedAt,
    resolvedAt: undefined
  };

  return nextRecord;
}

function comparePersistedSystemAlertRecords(left: PersistedSystemAlertRecord, right: PersistedSystemAlertRecord) {
  if (left.status !== right.status) {
    return left.status === 'active' ? -1 : 1;
  }

  const leftMs = Date.parse(left.lastChangedAt || left.observedAt || left.firstObservedAt);
  const rightMs = Date.parse(right.lastChangedAt || right.observedAt || right.firstObservedAt);

  if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs !== rightMs) {
    return rightMs - leftMs;
  }

  return left.id.localeCompare(right.id);
}

function toPublicSystemAlert(record: PersistedSystemAlertRecord): SystemAlert {
  return {
    id: record.id,
    kind: record.kind,
    severity: record.severity,
    status: 'active',
    title: record.title,
    message: record.message,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    resourceLabel: record.resourceLabel,
    observedAt: record.observedAt,
    dedupeKey: record.dedupeKey,
    metadata: clone(record.metadata)
  };
}

function createSystemAlertNotification(
  type: SystemAlertNotificationType,
  record: PersistedSystemAlertRecord
): SystemAlertNotification {
  return {
    type,
    notificationKey: `${type}:${record.dedupeKey}:${record.lastChangedAt}`,
    alert: {
      id: record.id,
      kind: record.kind,
      severity: record.severity,
      status: record.status,
      title: record.title,
      message: record.message,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      resourceLabel: record.resourceLabel,
      observedAt: record.observedAt,
      dedupeKey: record.dedupeKey,
      metadata: clone(record.metadata)
    },
    firstObservedAt: record.firstObservedAt,
    lastChangedAt: record.lastChangedAt,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {})
  };
}

function createSystemAlertNotificationBatch(
  notifications: SystemAlertNotification[],
  generatedAt: string
): SystemAlertNotificationBatch {
  return {
    schemaVersion: 'ou-ui-next.system-alerts.v1',
    generatedAt,
    events: clone(notifications)
  };
}

function createSystemAlertNotificationDeliveryId(batch: SystemAlertNotificationBatch) {
  return `system-alert-notification:${createStableSha256LikeHash(batch.events.map((event) => event.notificationKey))}`;
}

function createSystemAlertNotificationDelivery(
  batch: SystemAlertNotificationBatch,
  now: string,
  policy: SystemAlertNotificationRetryPolicy
): SystemAlertNotificationDeliveryRecord {
  return {
    id: createSystemAlertNotificationDeliveryId(batch),
    status: 'pending',
    batch: clone(batch),
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    attemptCount: 0,
    maxAttempts: policy.maxAttempts
  };
}

function compareSystemAlertNotificationDeliveries(
  left: SystemAlertNotificationDeliveryRecord,
  right: SystemAlertNotificationDeliveryRecord
) {
  return parseTimestampMs(right.updatedAt) - parseTimestampMs(left.updatedAt) || right.id.localeCompare(left.id);
}

function compactSystemAlertNotificationDeliveries(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  return clone(
    [...deliveries]
      .sort(compareSystemAlertNotificationDeliveries)
      .slice(0, SYSTEM_ALERT_NOTIFICATION_DELIVERY_HISTORY_LIMIT)
  );
}

function upsertSystemAlertNotificationDeliveries(
  existing: SystemAlertNotificationDeliveryRecord[],
  nextDeliveries: SystemAlertNotificationDeliveryRecord[]
) {
  const byId = new Map(existing.map((delivery) => [delivery.id, delivery] as const));

  for (const delivery of nextDeliveries) {
    if (!byId.has(delivery.id)) {
      byId.set(delivery.id, delivery);
    }
  }

  return compactSystemAlertNotificationDeliveries([...byId.values()]);
}

function isRetryableSystemAlertNotificationDelivery(delivery: SystemAlertNotificationDeliveryRecord) {
  return delivery.status === 'pending' || delivery.status === 'failed';
}

function isDueSystemAlertNotificationDelivery(delivery: SystemAlertNotificationDeliveryRecord, now: string) {
  return isRetryableSystemAlertNotificationDelivery(delivery) && Date.parse(delivery.nextAttemptAt) <= parseTimestampMs(now);
}

const volatileSystemAlertNotificationMetadataKeys = new Set([
  'lastTelemetryAt',
  'lastHeartbeatAt',
  'serviceCheckedAt',
  'sampleGapSeconds',
  'latencyMs',
  'latestUpdatedAt',
  'usedBytes',
  'usageRatioPercent',
  'quotaReportedAt'
]);

function createSystemAlertNotificationMetadataFingerprint(
  metadata: PersistedSystemAlertRecord['metadata']
) {
  const stableMetadata: NonNullable<PersistedSystemAlertRecord['metadata']> = {};

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!volatileSystemAlertNotificationMetadataKeys.has(key)) {
      stableMetadata[key] = value;
    }
  }

  return createStableSha256LikeHash(stableMetadata);
}

function shouldNotifyActiveSystemAlertUpdate(
  existing: PersistedSystemAlertRecord | undefined,
  nextRecord: PersistedSystemAlertRecord
) {
  if (!existing || existing.status === 'resolved') {
    return true;
  }

  return (
    existing.severity !== nextRecord.severity
    || existing.message !== nextRecord.message
    || existing.title !== nextRecord.title
    || existing.resourceLabel !== nextRecord.resourceLabel
    || createSystemAlertNotificationMetadataFingerprint(existing.metadata)
      !== createSystemAlertNotificationMetadataFingerprint(nextRecord.metadata)
  );
}

function reconcileSystemAlertRecords(
  persisted: PersistedSystemAlertRecord[],
  derivedActiveAlerts: SystemAlert[],
  now: string
) {
  const persistedByDedupeKey = new Map(persisted.map((record) => [record.dedupeKey, record] as const));
  const nextRecords: PersistedSystemAlertRecord[] = [];
  const seenDedupeKeys = new Set<string>();
  const notifications: SystemAlertNotification[] = [];
  let changed = false;

  for (const alert of derivedActiveAlerts) {
    const existing = persistedByDedupeKey.get(alert.dedupeKey);
    const nextRecord = createPersistedSystemAlertRecord(alert, now, existing);

    if (!existing || createStableSha256LikeHash(existing) !== createStableSha256LikeHash(nextRecord)) {
      changed = true;
    }

    if (shouldNotifyActiveSystemAlertUpdate(existing, nextRecord)) {
      notifications.push(
        createSystemAlertNotification(!existing || existing.status === 'resolved' ? 'activated' : 'updated', nextRecord)
      );
    }

    nextRecords.push(nextRecord);
    seenDedupeKeys.add(alert.dedupeKey);
  }

  for (const existing of persisted) {
    if (seenDedupeKeys.has(existing.dedupeKey)) {
      continue;
    }

    if (existing.status === 'active') {
      const resolvedRecord: PersistedSystemAlertRecord = {
        ...existing,
        status: 'resolved',
        lastChangedAt: now,
        resolvedAt: now
      };

      nextRecords.push(resolvedRecord);
      notifications.push(createSystemAlertNotification('resolved', resolvedRecord));
      changed = true;
      continue;
    }

    nextRecords.push(existing);
  }

  const records = nextRecords.sort(comparePersistedSystemAlertRecords);
  return {
    records,
    activeAlerts: records.filter((record) => record.status === 'active').map(toPublicSystemAlert),
    changed,
    notifications
  };
}

function assertSubscriptionSourceSyncAllowed(source: SubscriptionSource, now: string) {
  const lastSyncMs = Date.parse(source.lastSyncAt);
  const nowMs = Date.parse(now);
  const leaseExpiresMs = Date.parse(source.syncLeaseExpiresAt ?? '');

  if (
    source.syncLeaseOwnerId &&
    !Number.isNaN(leaseExpiresMs) &&
    !Number.isNaN(nowMs) &&
    nowMs < leaseExpiresMs
  ) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(leaseExpiresMs).toISOString());
  }

  if (source.status === 'syncing') {
    return;
  }

  const intervalMinutes = Math.max(Math.round(source.refreshIntervalMinutes ?? source.rateLimitPerMinute ?? 60), 1);

  if (Number.isNaN(lastSyncMs) || Number.isNaN(nowMs)) {
    return;
  }

  const nextAllowedMs = lastSyncMs + intervalMinutes * 60 * 1000;

  if (nowMs < nextAllowedMs) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(nextAllowedMs).toISOString());
  }
}

function readSubscriptionSourceProviderHost(source: SubscriptionSource) {
  try {
    const url = new URL(source.url);

    if (!SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }

    return normalizeRemoteHostname(url.hostname);
  } catch {
    return undefined;
  }
}

function assertSubscriptionSourceProviderBudgetAllowed(
  source: SubscriptionSource,
  sources: SubscriptionSource[],
  now: string,
  providerBudgetPolicy: SubscriptionSourceProviderBudgetPolicy
) {
  const providerHost = readSubscriptionSourceProviderHost(source);
  const nowMs = Date.parse(now);

  if (!providerHost || Number.isNaN(nowMs)) {
    return;
  }

  const activeSources = sources.filter((item) => {
    if (item.id === source.id) {
      return false;
    }

    if (readSubscriptionSourceProviderHost(item) !== providerHost) {
      return false;
    }

    const leaseExpiresMs = Date.parse(item.syncLeaseExpiresAt ?? '');

    return Boolean(item.syncLeaseOwnerId) && !Number.isNaN(leaseExpiresMs) && nowMs < leaseExpiresMs;
  });

  if (activeSources.length >= providerBudgetPolicy.maxConcurrentFetchesPerHost) {
    throw createSubscriptionSourceProviderBudgetError(
      source,
      providerHost,
      activeSources,
      now,
      providerBudgetPolicy.maxConcurrentFetchesPerHost
    );
  }
}

function createFailedSubscriptionSyncResult(sourceId: string, syncedAt: string, error: unknown): SubscriptionSourceSyncResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    sourceId,
    status: 'failed',
    nodeCount: 0,
    syncedAt,
    nodes: [],
    warnings: [`subscription_source.sync_failed:${message}`]
  };
}

function normalizeSubscriptionSourceFetchPolicy(
  policy: Partial<SubscriptionSourceFetchPolicy> | undefined
): SubscriptionSourceFetchPolicy {
  return {
    timeoutMs:
      typeof policy?.timeoutMs === 'number' && Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0
        ? Math.round(policy.timeoutMs)
        : SUBSCRIPTION_SOURCE_FETCH_TIMEOUT_MS,
    maxBodyBytes:
      typeof policy?.maxBodyBytes === 'number' && Number.isFinite(policy.maxBodyBytes) && policy.maxBodyBytes > 0
        ? Math.round(policy.maxBodyBytes)
        : SUBSCRIPTION_SOURCE_MAX_BODY_BYTES
  };
}

function normalizeSubscriptionSourceEgressPolicy(
  policy: Partial<SubscriptionSourceEgressPolicy> | undefined
): SubscriptionSourceEgressPolicy {
  const allowedHosts = (policy?.allowedHosts ?? [])
    .map((entry) => normalizeSubscriptionSourceEgressAllowlistEntry(entry))
    .filter((entry): entry is string => Boolean(entry));

  return {
    allowedHosts: [...new Set(allowedHosts)]
  };
}

function normalizeSubscriptionSourceProviderBudgetPolicy(
  policy: Partial<SubscriptionSourceProviderBudgetPolicy> | undefined
): SubscriptionSourceProviderBudgetPolicy {
  return {
    maxConcurrentFetchesPerHost:
      typeof policy?.maxConcurrentFetchesPerHost === 'number' &&
      Number.isFinite(policy.maxConcurrentFetchesPerHost) &&
      policy.maxConcurrentFetchesPerHost > 0
        ? Math.round(policy.maxConcurrentFetchesPerHost)
        : SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST
  };
}

function resolveSubscriptionSourceFetchPolicy(
  source: SubscriptionSource,
  defaultPolicy: SubscriptionSourceFetchPolicy
): SubscriptionSourceFetchPolicy {
  return {
    timeoutMs:
      typeof source.fetchTimeoutSeconds === 'number' &&
      Number.isFinite(source.fetchTimeoutSeconds) &&
      source.fetchTimeoutSeconds > 0
        ? Math.round(source.fetchTimeoutSeconds * 1000)
        : defaultPolicy.timeoutMs,
    maxBodyBytes:
      typeof source.maxBodyBytes === 'number' && Number.isFinite(source.maxBodyBytes) && source.maxBodyBytes > 0
        ? Math.round(source.maxBodyBytes)
        : defaultPolicy.maxBodyBytes
  };
}

async function normalizeSubscriptionSourceUrl(
  source: SubscriptionSource,
  hostResolver: SubscriptionSourceHostResolver,
  egressPolicy: SubscriptionSourceEgressPolicy
) {
  let url: URL;

  try {
    url = new URL(source.url);
  } catch {
    throw new Error('subscription source url is invalid');
  }

  if (!SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error('subscription source url protocol must be http or https');
  }

  if (isBlockedSubscriptionSourceRemoteHost(url.hostname)) {
    throw new Error('subscription source host is not allowed for remote fetch');
  }

  if (!isSubscriptionSourceHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('subscription source host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveSubscriptionSourceAllowedAddresses(url, hostResolver);

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function normalizeSubscriptionSourceEgressAllowlistEntry(entry: string) {
  const trimmed = entry.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes('://')) {
    try {
      return normalizeRemoteHostname(new URL(trimmed).hostname);
    } catch {
      return normalizeRemoteHostname(trimmed);
    }
  }

  return normalizeRemoteHostname(trimmed);
}

function isSubscriptionSourceHostAllowedByEgressPolicy(
  hostname: string,
  egressPolicy: SubscriptionSourceEgressPolicy
) {
  if (egressPolicy.allowedHosts.length === 0) {
    return true;
  }

  const normalized = normalizeRemoteHostname(hostname);

  return egressPolicy.allowedHosts.some((allowedHost) => {
    if (allowedHost.startsWith('*.')) {
      const suffix = allowedHost.slice(1);
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }

    if (allowedHost.startsWith('.')) {
      return normalized.endsWith(allowedHost) && normalized.length > allowedHost.length;
    }

    return normalized === allowedHost;
  });
}

async function resolveSubscriptionSourceAllowedAddresses(
  url: URL,
  hostResolver: SubscriptionSourceHostResolver
): Promise<SubscriptionSourceResolvedAddress[]> {
  const normalized = normalizeRemoteHostname(url.hostname);
  const literalIpFamily = isIP(normalized);

  if (literalIpFamily !== 0) {
    return [
      {
        address: normalized,
        family: literalIpFamily === 6 ? 6 : 4
      }
    ];
  }

  let resolvedAddresses: SubscriptionSourceResolvedAddress[];

  try {
    resolvedAddresses = await hostResolver(normalized);
  } catch {
    throw new Error('subscription source host could not be resolved for remote fetch');
  }

  if (resolvedAddresses.length === 0) {
    throw new Error('subscription source host could not be resolved for remote fetch');
  }

  if (resolvedAddresses.some((record) => isBlockedSubscriptionSourceRemoteHost(record.address))) {
    throw new Error('subscription source resolved host is not allowed for remote fetch');
  }

  return resolvedAddresses;
}

function normalizeRemoteHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function parseIpv4Octets(hostname: string) {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)));

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}

function parseIpv6SideHextets(side: string) {
  if (side === '') {
    return [];
  }

  const hextets: number[] = [];

  for (const part of side.split(':')) {
    if (part === '') {
      return undefined;
    }

    if (part.includes('.')) {
      const octets = parseIpv4Octets(part);

      if (!octets) {
        return undefined;
      }

      hextets.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    hextets.push(Number.parseInt(part, 16));
  }

  return hextets;
}

function parseIpv6Hextets(hostname: string) {
  if (isIP(hostname) !== 6) {
    return undefined;
  }

  const compressedParts = hostname.split('::');

  if (compressedParts.length > 2) {
    return undefined;
  }

  const head = parseIpv6SideHextets(compressedParts[0] ?? '');
  const tail = compressedParts.length === 2 ? parseIpv6SideHextets(compressedParts[1] ?? '') : [];

  if (!head || !tail) {
    return undefined;
  }

  if (compressedParts.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const missingHextets = 8 - head.length - tail.length;

  if (missingHextets < 1) {
    return undefined;
  }

  return [...head, ...Array.from({ length: missingHextets }, () => 0), ...tail];
}

function isBlockedIpv4Host(hostname: string) {
  const octets = parseIpv4Octets(hostname);

  if (!octets) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function readIpv6EmbeddedIpv4Host(hextets: number[]) {
  const seventh = hextets[6] ?? 0;
  const eighth = hextets[7] ?? 0;

  return [
    (seventh >> 8) & 0xff,
    seventh & 0xff,
    (eighth >> 8) & 0xff,
    eighth & 0xff
  ].join('.');
}

function isBlockedIpv6Host(hostname: string) {
  const hextets = parseIpv6Hextets(hostname);

  if (!hextets) {
    return false;
  }

  const firstHextet = hextets[0] ?? 0;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  const isIpv4Compatible = hextets.slice(0, 6).every((hextet) => hextet === 0);

  if (isIpv4Mapped || isIpv4Compatible) {
    return isBlockedIpv4Host(readIpv6EmbeddedIpv4Host(hextets));
  }

  const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
  const isMulticast = (firstHextet & 0xff00) === 0xff00;

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast;
}

function isBlockedSubscriptionSourceRemoteHost(hostname: string) {
  const normalized = normalizeRemoteHostname(hostname);

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isBlockedIpv4Host(normalized) ||
    isBlockedIpv6Host(normalized)
  );
}

function readContentLengthBytes(response: Response) {
  const contentLength = response.headers.get('content-length');

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readHeaderContentLengthBytes(value: string | string[] | undefined) {
  const contentLength = Array.isArray(value) ? value[0] : value;

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function createSubscriptionSourceBodyLimitError(maxBodyBytes: number) {
  return new Error(`remote response exceeds ${maxBodyBytes} bytes`);
}

function createSubscriptionSourceRequestHeaders(source: SubscriptionSource) {
  return {
    Accept:
      source.kind === 'v2ray-uri'
        ? 'text/plain,*/*'
        : source.kind === 'sing-box'
          ? 'application/json,text/json,text/plain,*/*'
          : 'text/yaml,application/yaml,text/plain,*/*',
    'User-Agent': source.userAgent || 'OU-UI-Next/1.0'
  };
}

function fetchPinnedSubscriptionSourceContent({
  target,
  headers,
  policy,
  signal
}: SubscriptionSourceRemoteFetcherInput): Promise<FetchedSubscriptionSourceContent> {
  const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const port =
    target.url.port ||
    (target.url.protocol === 'https:' ? '443' : target.url.protocol === 'http:' ? '80' : undefined);
  const hostHeader = target.url.host;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };
    const request = transport(
      {
        protocol: target.url.protocol,
        hostname: target.resolvedAddress.address,
        port,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        headers: {
          ...headers,
          Host: hostHeader
        },
        servername: target.url.hostname,
        signal,
        timeout: policy.timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const statusMessage = response.statusMessage || '';

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`remote responded ${statusCode} ${statusMessage}`.trim())));
          return;
        }

        const contentLengthBytes = readHeaderContentLengthBytes(response.headers['content-length']);

        if (contentLengthBytes !== undefined && contentLengthBytes > policy.maxBodyBytes) {
          response.resume();
          finish(() => reject(createSubscriptionSourceBodyLimitError(policy.maxBodyBytes)));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on('data', (chunk: Buffer | string) => {
          if (settled) {
            return;
          }

          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;

          if (totalBytes > policy.maxBodyBytes) {
            finish(() => reject(createSubscriptionSourceBodyLimitError(policy.maxBodyBytes)));
            request.destroy();
            return;
          }

          chunks.push(buffer);
        });

        response.on('end', () => {
          finish(() =>
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              trafficHeader: Array.isArray(response.headers['subscription-userinfo'])
                ? response.headers['subscription-userinfo'][0]
                : response.headers['subscription-userinfo']
            })
          );
        });

        response.on('error', (error) => {
          finish(() => reject(error));
        });
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`remote fetch timed out after ${policy.timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end();
  });
}

async function withSubscriptionSourceFetchTimeout<T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`remote fetch timed out after ${timeoutMs}ms`));
          controller.abort();
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function fetchSubscriptionSourceContent(
  source: SubscriptionSource,
  fetcher: typeof fetch,
  remoteFetcher: SubscriptionSourceRemoteFetcher | undefined,
  hostResolver: SubscriptionSourceHostResolver,
  egressPolicy: SubscriptionSourceEgressPolicy,
  policy: SubscriptionSourceFetchPolicy
): Promise<FetchedSubscriptionSourceContent> {
  const controller = new AbortController();
  const remoteTarget = await withSubscriptionSourceFetchTimeout(
    normalizeSubscriptionSourceUrl(source, hostResolver, egressPolicy),
    controller,
    policy.timeoutMs
  );
  const headers = createSubscriptionSourceRequestHeaders(source);

  if (remoteFetcher || fetcher === fetch) {
    return withSubscriptionSourceFetchTimeout(
      (remoteFetcher ?? fetchPinnedSubscriptionSourceContent)({
        source,
        target: remoteTarget,
        headers,
        policy,
        signal: controller.signal
      }),
      controller,
      policy.timeoutMs
    );
  }

  const response = await withSubscriptionSourceFetchTimeout(
    fetcher(remoteTarget.url.toString(), {
      headers,
      signal: controller.signal
    }),
    controller,
    policy.timeoutMs
  );

  if (!response.ok) {
    throw new Error(`remote responded ${response.status} ${response.statusText}`);
  }

  const contentLengthBytes = readContentLengthBytes(response);

  if (contentLengthBytes !== undefined && contentLengthBytes > policy.maxBodyBytes) {
    throw createSubscriptionSourceBodyLimitError(policy.maxBodyBytes);
  }

  const body = await withSubscriptionSourceFetchTimeout(response.text(), controller, policy.timeoutMs);

  if (Buffer.byteLength(body, 'utf8') > policy.maxBodyBytes) {
    throw createSubscriptionSourceBodyLimitError(policy.maxBodyBytes);
  }

  return {
    body,
    trafficHeader: response.headers.get('subscription-userinfo')
  };
}

function readSubscriptionClientDeleteId(task: DeployTask): string | undefined {
  if (task.operation !== 'subscription.delete' || readSubscriptionSourceDeleteId(task)) {
    return undefined;
  }

  const clientId = task.metadata?.subscriptionClientId;
  return typeof clientId === 'string' && clientId.trim() ? clientId.trim() : task.targetId;
}

function projectSubscriptionClientReadModel(
  client: SubscriptionClientIdentity,
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[],
  quotaResetReplayState?: ReturnType<typeof createQuotaResetReplayState>,
  nowIso?: string
): SubscriptionClientIdentity {
  const quotaResetBaseline = quotaResetReplayState
    ? readLatestSubscriptionClientResetDescriptor(quotaResetReplayState, client.id)
    : undefined;

  return projectSubscriptionClientRuntimeState({
    client,
    inbounds,
    externalNodes,
    nowIso,
    quotaResetBaseline
  }).client;
}

function projectSubscriptionClientReadModels(
  clients: SubscriptionClientIdentity[],
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[],
  quotaResetReplayState?: ReturnType<typeof createQuotaResetReplayState>,
  nowIso?: string
) {
  return clients.map((client) =>
    projectSubscriptionClientReadModel(client, inbounds, externalNodes, quotaResetReplayState, nowIso)
  );
}

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  operatorSessionStore,
  inventory = {},
  fetcher = fetch,
  subscriptionSourceRemoteFetcher,
  subscriptionSourceHostResolver = defaultSubscriptionSourceHostResolver,
  subscriptionSourceFetch,
  subscriptionSourceEgress,
  subscriptionSourceProviderBudget,
  agentLogRetention,
  systemAlertNotifier,
  systemAlertNotificationRetry,
  readModelNow = () => new Date().toISOString()
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  const subscriptionSourceFetchPolicy = normalizeSubscriptionSourceFetchPolicy(subscriptionSourceFetch);
  const subscriptionSourceEgressPolicy = normalizeSubscriptionSourceEgressPolicy(subscriptionSourceEgress);
  const subscriptionSourceProviderBudgetPolicy = normalizeSubscriptionSourceProviderBudgetPolicy(
    subscriptionSourceProviderBudget
  );
  const systemAlertNotificationRetryPolicy = normalizeSystemAlertNotificationRetryPolicy(systemAlertNotificationRetry);
  const runtimeAgentLogRetentionPolicy = createAgentLogRetentionPolicyReadModel(agentLogRetention, 'runtime-config');
  const seedSubscriptionSources = clone(inventory.subscriptionSources ?? []);
  const seedSubscriptionInventoryNodes = clone(inventory.subscriptionInventoryNodes ?? []);
  const seedSubscriptionClients = clone(inventory.subscriptionClients ?? []);
  const seedSubscriptionExportProfiles = clone(inventory.subscriptionExportProfiles ?? []);
  const seedAgents = clone(inventory.agents ?? []);
  const seedInbounds = clone(inventory.inbounds ?? []);
  let subscriptionSources = clone(seedSubscriptionSources);
  let subscriptionInventoryNodes = clone(seedSubscriptionInventoryNodes);
  let subscriptionClients = clone(seedSubscriptionClients);
  let subscriptionExportProfiles = clone(seedSubscriptionExportProfiles);
  let agents = clone(seedAgents);
  let inbounds = clone(seedInbounds);
  let forwardRulesReadModel: Awaited<ReturnType<ControlPlaneRepository['listForwardRules']>> | undefined;
  let deletedAgentIds = new Set<string>();

  async function readEffectiveAgentLogRetentionPolicy() {
    const persistedPolicy = await repository.getAgentLogRetentionPolicy();
    return persistedPolicy
      ? createAgentLogRetentionPolicyReadModel(persistedPolicy, 'control-plane')
      : runtimeAgentLogRetentionPolicy;
  }

  async function appendStandaloneAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
    const existingLogs = await transaction.listAuditLogs();
    const auditWithPrevHash = {
      ...auditLog,
      prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    const insertedAuditLog = {
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    };

    await transaction.insertAuditLog(insertedAuditLog);
    return insertedAuditLog;
  }

  async function listForwardRuleReadModel() {
    if (!forwardRulesReadModel) {
      forwardRulesReadModel = clone(await repository.listForwardRules());
    }

    return clone(forwardRulesReadModel);
  }

  async function acquireSubscriptionSourceSyncLease(
    sourceId: string,
    syncedAt: string,
    fetchPolicy: SubscriptionSourceFetchPolicy
  ) {
    const leaseOwnerId = `subscription-sync-${sourceId}-${randomUUID()}`;
    const syncedAtMs = Date.parse(syncedAt);
    const leaseStartedAtMs = Number.isNaN(syncedAtMs) ? Date.now() : syncedAtMs;
    const leaseExpiresAt = new Date(
      leaseStartedAtMs + Math.max(fetchPolicy.timeoutMs * 2, SUBSCRIPTION_SOURCE_SYNC_LEASE_MIN_MS)
    ).toISOString();

    return repository.transaction(async (transaction) => {
      const persistedSources = await transaction.listSubscriptionSources();
      const currentSource =
        persistedSources.find((item) => item.id === sourceId) ?? subscriptionSources.find((item) => item.id === sourceId);

      if (!currentSource) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      assertSubscriptionSourceSyncAllowed(currentSource, syncedAt);
      assertSubscriptionSourceProviderBudgetAllowed(
        currentSource,
        persistedSources,
        syncedAt,
        subscriptionSourceProviderBudgetPolicy
      );

      const leasedSource: SubscriptionSource = {
        ...currentSource,
        status: 'syncing',
        syncLeaseOwnerId: leaseOwnerId,
        syncLeaseExpiresAt: leaseExpiresAt
      };

      await transaction.upsertSubscriptionSource(leasedSource);

      return {
        source: currentSource,
        leasedSource
      };
    });
  }

  async function projectRuntimeCredentialAgents(
    baseAgents: Agent[],
    deletedAgentIdsForProjection: Set<string>
  ) {
    const credentials = await service.listAgentCredentials();
    const sessions = await repository.listAgentSessions();
    let nextAgents = clone(baseAgents);

    for (const credential of credentials) {
      if (credential.purpose !== 'runtime' || credential.status !== 'active') {
        continue;
      }

      if (deletedAgentIdsForProjection.has(credential.agentId)) {
        continue;
      }

      if (nextAgents.some((agent) => agent.id === credential.agentId)) {
        continue;
      }

      const session = sessions.find(
        (item) => item.agentId === credential.agentId && (!credential.sessionId || item.sessionId === credential.sessionId)
      );
      nextAgents = [createAgentFromCredential(credential, session), ...nextAgents];
    }

    return nextAgents;
  }

  async function hydrateReadModelsFromPersistedTasks() {
    const tasks = sortTasksForReadModelReplay(await repository.listTasks());
    const persistedSubscriptionSources = await repository.listSubscriptionSources();
    const persistedSubscriptionInventoryNodes = await repository.listSubscriptionInventoryNodes();
    const persistedSubscriptionClients = await repository.listSubscriptionClients();
    const persistedSubscriptionExportProfiles = await repository.listSubscriptionExportProfiles();
    const hasPersistedSubscriptionSources = persistedSubscriptionSources.length > 0;
    const hasPersistedSubscriptionInventoryNodes = persistedSubscriptionInventoryNodes.length > 0;
    const hasPersistedSubscriptionClients = persistedSubscriptionClients.length > 0;
    const hasPersistedSubscriptionExportProfiles = persistedSubscriptionExportProfiles.length > 0;
    const nextDeletedAgentIds = new Set<string>();
    let nextAgents = await projectRuntimeCredentialAgents(seedAgents, nextDeletedAgentIds);
    let nextInbounds = clone(seedInbounds);
    let nextSubscriptionSources = hasPersistedSubscriptionSources ? persistedSubscriptionSources : clone(seedSubscriptionSources);
    let nextSubscriptionInventoryNodes = hasPersistedSubscriptionInventoryNodes
      ? persistedSubscriptionInventoryNodes
      : clone(seedSubscriptionInventoryNodes);
    let nextSubscriptionClients = hasPersistedSubscriptionClients ? persistedSubscriptionClients : clone(seedSubscriptionClients);
    let nextSubscriptionExportProfiles = hasPersistedSubscriptionExportProfiles
      ? persistedSubscriptionExportProfiles
      : clone(seedSubscriptionExportProfiles);
    let nextForwardRules = clone(await repository.listForwardRules());

    for (const task of tasks) {
      if (task.operation === 'agent.delete') {
        nextDeletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        nextSubscriptionInventoryNodes = nextSubscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
      }

      nextAgents = applyAgentTask(nextAgents, task);
      nextAgents = applyQuotaResetTaskToAgents(nextAgents, task);
      nextInbounds = applyXrayInboundTask(nextInbounds, task);
      nextInbounds = applyQuotaResetTaskToInbounds(nextInbounds, task);
      if (!hasPersistedSubscriptionSources) {
        nextSubscriptionSources = applySubscriptionSourceTask(nextSubscriptionSources, task);
      }
      if (!hasPersistedSubscriptionClients) {
        nextSubscriptionClients = applySubscriptionClientTask(nextSubscriptionClients, task);
      }
      nextSubscriptionClients = applyQuotaResetTaskToSubscriptionClients(nextSubscriptionClients, task);
      if (!hasPersistedSubscriptionExportProfiles) {
        nextSubscriptionExportProfiles = applySubscriptionExportProfileTask(nextSubscriptionExportProfiles, task);
      }
      nextForwardRules = applyForwardRuleTask(nextForwardRules, task);
      nextForwardRules = applyQuotaResetTaskToForwardRules(nextForwardRules, task);
    }

    const quotaResetReplayState = createQuotaResetReplayState(tasks);

    for (const rawEvent of sortAgentEventsForReadModelReplay(await repository.listAgentEvents())) {
      const event = applyQuotaResetStateToForwardingEvent(
        applyQuotaResetStateToXrayEvent(applyQuotaResetStateToAgentEvent(rawEvent, quotaResetReplayState), quotaResetReplayState),
        quotaResetReplayState
      );

      if (nextDeletedAgentIds.has(event.agentId)) {
        continue;
      }

      nextAgents = applyAgentEventToReadModel(nextAgents, event);
      nextInbounds = applyXrayTelemetryToReadModel(nextInbounds, event);
      nextForwardRules = applyForwardingTelemetryToReadModel(nextForwardRules, event);
    }

    agents = nextAgents;
    inbounds = nextInbounds;
    subscriptionSources = nextSubscriptionSources;
    subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
    subscriptionClients = nextSubscriptionClients;
    subscriptionExportProfiles = nextSubscriptionExportProfiles;
    forwardRulesReadModel = nextForwardRules;
    deletedAgentIds = nextDeletedAgentIds;
  }

  async function updateSystemAlertNotificationDelivery(
    deliveryId: string,
    update: (delivery: SystemAlertNotificationDeliveryRecord) => SystemAlertNotificationDeliveryRecord
  ) {
    await repository.transaction(async (transaction) => {
      const deliveries = await transaction.listSystemAlertNotificationDeliveries();
      const nextDeliveries = deliveries.map((delivery) =>
        delivery.id === deliveryId ? update(delivery) : delivery
      );
      await transaction.replaceSystemAlertNotificationDeliveries(compactSystemAlertNotificationDeliveries(nextDeliveries));
    });
  }

  async function retrySystemAlertNotifications(
    options: SystemAlertNotificationRetryOptions
  ): Promise<SystemAlertNotificationRetryResult> {
    const result: SystemAlertNotificationRetryResult = {
      attempted: 0,
      delivered: 0,
      failed: 0,
      deadLettered: 0
    };

    if (!systemAlertNotifier) {
      return result;
    }

    const maxDeliveries = Math.max(
      1,
      Math.round(options.maxDeliveries ?? systemAlertNotificationRetryPolicy.maxDeliveriesPerSweep)
    );
    const dueDeliveries = await repository.transaction(async (transaction) => {
      const deliveries = await transaction.listSystemAlertNotificationDeliveries();
      const due = deliveries
        .filter((delivery) => isDueSystemAlertNotificationDelivery(delivery, options.now))
        .sort((left, right) =>
          parseTimestampMs(left.nextAttemptAt) - parseTimestampMs(right.nextAttemptAt) || left.id.localeCompare(right.id)
        )
        .slice(0, maxDeliveries)
        .map((delivery) => ({
          ...delivery,
          status: 'pending' as const,
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: options.now,
          updatedAt: options.now
        }));

      if (due.length === 0) {
        return [];
      }

      const dueById = new Map(due.map((delivery) => [delivery.id, delivery] as const));
      const nextDeliveries = deliveries.map((delivery) => dueById.get(delivery.id) ?? delivery);
      await transaction.replaceSystemAlertNotificationDeliveries(compactSystemAlertNotificationDeliveries(nextDeliveries));

      return due;
    });

    for (const delivery of dueDeliveries) {
      result.attempted += 1;

      try {
        await systemAlertNotifier.notify(delivery.batch);
        result.delivered += 1;
        await updateSystemAlertNotificationDelivery(delivery.id, (current) => ({
          ...current,
          status: 'delivered',
          updatedAt: options.now,
          deliveredAt: options.now,
          attemptCount: delivery.attemptCount,
          lastAttemptAt: options.now,
          nextAttemptAt: options.now,
          lastErrorMessage: undefined,
          deadLetteredAt: undefined
        }));
      } catch (error) {
        const deadLettered = delivery.attemptCount >= delivery.maxAttempts;
        const lastErrorMessage = sanitizeSystemAlertNotificationError(error);

        if (deadLettered) {
          result.deadLettered += 1;
        } else {
          result.failed += 1;
        }

        await updateSystemAlertNotificationDelivery(delivery.id, (current) => ({
          ...current,
          status: deadLettered ? 'dead_letter' : 'failed',
          updatedAt: options.now,
          attemptCount: delivery.attemptCount,
          lastAttemptAt: options.now,
          nextAttemptAt: deadLettered ? options.now : toIsoAfter(options.now, systemAlertNotificationRetryPolicy.retryDelayMs),
          lastErrorMessage,
          ...(deadLettered ? { deadLetteredAt: options.now } : {})
        }));
      }
    }

    return result;
  }

  async function reconcileAndPersistSystemAlerts(
    liveAgents: Agent[],
    commandOutbox: CommandOutboxItem[],
    quotaPolicies: QuotaPolicy[],
    now: string
  ) {
    const derivedActiveAlerts = [
      ...createSystemAlertsFromAgents(liveAgents),
      ...createSystemAlertsFromCommandOutbox(commandOutbox, now),
      ...createSystemAlertsFromQuotaPolicies(quotaPolicies, now)
    ];

    const reconciled = await repository.transaction(async (transaction) => {
      const persistedAlerts = await transaction.listSystemAlertRecords();
      const reconciled = reconcileSystemAlertRecords(persistedAlerts, derivedActiveAlerts, now);

      if (reconciled.changed) {
        await transaction.replaceSystemAlertRecords(reconciled.records);
      }

      if (systemAlertNotifier && reconciled.notifications.length > 0) {
        const deliveries = await transaction.listSystemAlertNotificationDeliveries();
        await transaction.replaceSystemAlertNotificationDeliveries(
          upsertSystemAlertNotificationDeliveries(deliveries, [
            createSystemAlertNotificationDelivery(
              createSystemAlertNotificationBatch(reconciled.notifications, now),
              now,
              systemAlertNotificationRetryPolicy
            )
          ])
        );
      }

      return reconciled;
    });

    if (systemAlertNotifier && reconciled.notifications.length > 0) {
      await retrySystemAlertNotifications({
        now,
        maxDeliveries: systemAlertNotificationRetryPolicy.maxDeliveriesPerSweep
      });
    }

    return clone(reconciled.activeAlerts);
  }

  async function listLiveQuotaPolicies() {
    await hydrateReadModelsFromPersistedTasks();
    const now = readModelNow();
    const liveAgents = applyAgentLivenessToReadModel(agents, now);
    const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
    const liveForwardRules = applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now);
    const quotaPolicyTasks = sortTasksForReadModelReplay(await repository.listTasks());
    const quotaResetReplayState = createQuotaResetReplayState(quotaPolicyTasks);
    const liveQuotaPolicies = applyQuotaResetTasksToExplicitPolicies(inventory.quotaPolicies ?? [], quotaPolicyTasks);
    const liveSubscriptionClients = projectSubscriptionClientReadModels(
      subscriptionClients,
      liveInbounds,
      subscriptionInventoryNodes,
      quotaResetReplayState,
      now
    );

    return createQuotaPoliciesFromReadModels({
      agents: liveAgents,
      inbounds: liveInbounds,
      forwardRules: liveForwardRules,
      subscriptionClients: liveSubscriptionClients,
      quotaPolicies: liveQuotaPolicies
    });
  }

  async function listLiveForwardRulesForQuotaEnforcement() {
    await hydrateReadModelsFromPersistedTasks();
    return applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), readModelNow());
  }

  async function listLiveInboundsForGuardrailEnforcement() {
    await hydrateReadModelsFromPersistedTasks();
    return applyXrayTrafficWindowToReadModel(inbounds, readModelNow());
  }

  function createSystemQuotaEnforcerContext(requestId: string, idempotencyKey: string): MutationContext {
    return {
      actor: 'system:quota-enforcer',
      sourceIp: '127.0.0.1',
      userAgent: 'ou-ui-next-quota-enforcer',
      requestId,
      idempotencyKey
    };
  }

  async function enqueueDerivedForwardQuotaEnforcementTasks(
    beforeRules: ForwardRule[],
    trigger: { kind: 'agent-event' | 'task'; id: string; observedAt: string }
  ) {
    const afterRules = await listLiveForwardRulesForQuotaEnforcement();
    const afterPolicies = await listLiveQuotaPolicies();
    const intents = deriveForwardQuotaEnforcementTaskIntents(
      await repository.listTasks(),
      beforeRules,
      afterRules,
      afterPolicies,
      trigger
    );

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  async function enqueueDerivedXrayGuardrailTasks(trigger: { kind: 'agent-event' | 'task'; id: string; observedAt: string }) {
    const afterInbounds = await listLiveInboundsForGuardrailEnforcement();
    const intents = deriveXrayGuardrailTaskIntents(await repository.listTasks(), afterInbounds, trigger);

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  const api: ControlPlaneApi = {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async getAgentLogRetentionPolicy() {
      return clone(await readEffectiveAgentLogRetentionPolicy());
    },

    async updateAgentLogRetentionPolicy(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const before = await readEffectiveAgentLogRetentionPolicy();
      const policy = toAgentLogRetentionPolicy(input);
      const after = createAgentLogRetentionPolicyReadModel(policy, 'control-plane');

      await repository.transaction(async (transaction) => {
        await transaction.setAgentLogRetentionPolicy(policy);
        await appendStandaloneAuditLog(
          transaction,
          createAgentLogRetentionPolicyUpdatedAuditLog({
            context: resolvedContext,
            before,
            after,
            reason: input.reason,
            createdAt: readModelNow()
          })
        );
      });

      return clone(after);
    },

    async getObservabilityMetrics() {
      const [tasks, commandOutbox, auditLogs] = await Promise.all([
        repository.listTasks(),
        repository.listCommandOutbox(),
        repository.listAuditLogs()
      ]);
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const liveAgents = applyAgentLivenessToReadModel(agents, now);
      const quotaPolicies = await listLiveQuotaPolicies();
      const systemAlerts = await reconcileAndPersistSystemAlerts(liveAgents, commandOutbox, quotaPolicies, now);
      const systemAlertNotificationDeliveries = await repository.listSystemAlertNotificationDeliveries();

      return createObservabilityMetrics({
        generatedAt: now,
        tasks,
        commandOutbox,
        agents: liveAgents,
        systemAlerts,
        systemAlertNotificationDeliveries,
        audit: verifyAuditLogs(clone(auditLogs)),
        auditLogs
      });
    },

    async listAgents() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(applyAgentLivenessToReadModel(agents, readModelNow()));
    },

    async listCustomers() {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        subscriptionClients,
        liveInbounds,
        subscriptionInventoryNodes,
        quotaResetReplayState,
        now
      );
      const liveForwardRules = applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now);

      return clone(
        createCustomersFromReadModels({
          inbounds: liveInbounds,
          subscriptionClients: liveSubscriptionClients,
          forwardRules: liveForwardRules,
          nowIso: now
        })
      );
    },

    async listNodes() {
      return clone(inventory.nodes ?? []);
    },

    async listInbounds() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(applyXrayTrafficWindowToReadModel(inbounds, readModelNow()));
    },

    async listSubscriptionSources() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionSources);
    },

    async listSubscriptionInventoryNodes() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionInventoryNodes);
    },

    async listSubscriptionBundles() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(
        createSubscriptionBundlesFromInventory(
          subscriptionSources,
          subscriptionInventoryNodes,
          subscriptionExportProfiles,
          inventory.subscriptionBundles ?? []
        )
      );
    },

    async listSubscriptionClients() {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      return clone(
        projectSubscriptionClientReadModels(
          subscriptionClients,
          applyXrayTrafficWindowToReadModel(inbounds, now),
          subscriptionInventoryNodes,
          quotaResetReplayState,
          now
        )
      );
    },

    async listSubscriptionExportProfiles() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionExportProfiles);
    },

    async listProxyProviders() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(createProxyProvidersFromSources(subscriptionSources));
    },

    async listSubscriptionExportFiles() {
      await hydrateReadModelsFromPersistedTasks();
      const providers = createProxyProvidersFromSources(subscriptionSources);
      return clone(createSubscriptionExportFilesFromClients(subscriptionClients, providers, subscriptionExportProfiles));
    },

    async listForwardRules() {
      await hydrateReadModelsFromPersistedTasks();
      return applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), readModelNow());
    },

    async listQuotaPolicies() {
      return clone(await listLiveQuotaPolicies());
    },

    async listRateLimitPolicies() {
      return clone(inventory.rateLimitPolicies ?? []);
    },

    async listPermissionGrants() {
      return repository.listPermissionGrants();
    },

    async listRoutingPolicies() {
      return clone(inventory.routingPolicies ?? []);
    },

    async listTuningProfiles() {
      return clone(inventory.tuningProfiles ?? []);
    },

    async listTasks() {
      return repository.listTasks();
    },

    async listCommandOutbox() {
      return repository.listCommandOutbox();
    },

    async listAgentCredentials() {
      return service.listAgentCredentials();
    },

    async listOperatorSessions() {
      return operatorSessionStore?.list() ?? [];
    },

    async listConfigRevisions() {
      return repository.listConfigRevisions();
    },

    async listPreflightPlans() {
      return repository.listPreflightPlans();
    },

    async listRuntimeSnapshots() {
      return repository.listRuntimeSnapshots();
    },

    async listTrafficRollups() {
      return repository.listTrafficRollups();
    },

    async listSystemAlerts() {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      return reconcileAndPersistSystemAlerts(
        applyAgentLivenessToReadModel(agents, now),
        await repository.listCommandOutbox(),
        await listLiveQuotaPolicies(),
        now
      );
    },

    async listAgentLogChunks(query) {
      return selectAgentLogChunks(await repository.listAgentEvents(), query);
    },

    async exportAgentLogChunks(query) {
      return createAgentLogExport(await repository.listAgentEvents(), query, readModelNow());
    },

    async listAuditLogs() {
      return repository.listAuditLogs();
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? (await repository.listAuditLogs())));
    },

    async recordAgentRequestDenied(input: AgentRequestDeniedAuditInput) {
      return repository.transaction((transaction) =>
        appendStandaloneAuditLog(transaction, createAgentRequestDeniedAuditLog(input, readModelNow()))
      );
    },

    async recordOperatorRequestDenied(input: OperatorRequestDeniedAuditInput) {
      return repository.transaction((transaction) =>
        appendStandaloneAuditLog(transaction, createOperatorRequestDeniedAuditLog(input, readModelNow()))
      );
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext) {
      return service.createAgentInstallCommand(input, resolveMutationContext(context));
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const credential = await service.registerAgent(input, installToken, context);
      await hydrateReadModelsFromPersistedTasks();
      return credential;
    },

    async revokeAgentCredential(credentialId, input, context?: MutationContext) {
      return service.revokeAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async revokeOperatorSession(sessionId: string, input: OperatorSessionRevokeRequest, context?: MutationContext) {
      if (!operatorSessionStore) {
        throw new Error(`operator session not found: ${sessionId}`);
      }

      const session = await operatorSessionStore.revoke(sessionId, {
        ...resolveMutationContext(context),
        reason: input.reason
      });

      if (!session) {
        throw new Error(`operator session not found: ${sessionId}`);
      }

      return session;
    },

    async rotateAgentCredential(credentialId, input, context?: MutationContext) {
      return service.rotateAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async resetQuotaPolicy(policyId: string, context?: MutationContext) {
      const policy = (await listLiveQuotaPolicies()).find((item) => item.id === policyId);

      if (!policy) {
        throw new Error(`Quota policy not found: ${policyId}`);
      }

      return api.createTask(createQuotaResetTaskInput(policy), context);
    },

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();
      const beforeForwardRules = await listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = await listLiveInboundsForGuardrailEnforcement();
      const now = readModelNow();
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        subscriptionClients,
        liveInbounds,
        subscriptionInventoryNodes,
        quotaResetReplayState,
        now
      );
      const resetAwareInput =
        input.operation === 'quota.reset'
          ? prepareQuotaResetTaskInput({
              input,
              nowIso: now,
              agents: applyAgentLivenessToReadModel(agents, now),
              inbounds: liveInbounds,
              forwardRules: applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now),
              subscriptionClients: liveSubscriptionClients,
              quotaPolicies: await listLiveQuotaPolicies()
            })
          : input;

      const task = await service.createTask(resetAwareInput, resolveMutationContext(context));

      if (task.operation === 'agent.delete') {
        deletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
        await repository.transaction(async (transaction) => {
          await transaction.deleteSubscriptionSource(deletedSourceId);
          await transaction.replaceSubscriptionInventoryNodesForSource(deletedSourceId, []);
        });
      }

      const importedSubscriptionSource = createSubscriptionSourceFromTask(task);
      const generatedSubscriptionExportProfile = createSubscriptionExportProfileFromTask(task);
      const generatedSubscriptionClientFromTask = createSubscriptionClientFromTask(task);
      if (generatedSubscriptionClientFromTask) {
        await hydrateReadModelsFromPersistedTasks();
      }
      const generatedSubscriptionClient = generatedSubscriptionClientFromTask
        ? projectSubscriptionClientReadModel(
            generatedSubscriptionClientFromTask,
            applyXrayTrafficWindowToReadModel(inbounds, readModelNow()),
            subscriptionInventoryNodes
          )
        : undefined;
      const deletedSubscriptionClientId = readSubscriptionClientDeleteId(task);
      const deletedSubscriptionExportProfileId = readSubscriptionExportProfileDeleteId(task);

      subscriptionSources = applySubscriptionSourceTask(subscriptionSources, task);
      inbounds = applyXrayInboundTask(inbounds, task);
      inbounds = applyQuotaResetTaskToInbounds(inbounds, task);
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      forwardRulesReadModel = applyQuotaResetTaskToForwardRules(forwardRulesReadModel, task);
      agents = applyAgentTask(agents, task);
      agents = applyQuotaResetTaskToAgents(agents, task);
      subscriptionClients = generatedSubscriptionClient
        ? [
            generatedSubscriptionClient,
            ...subscriptionClients.filter((client) => client.id !== generatedSubscriptionClient.id)
          ]
        : applySubscriptionClientTask(subscriptionClients, task);
      subscriptionClients = applyQuotaResetTaskToSubscriptionClients(subscriptionClients, task);
      subscriptionExportProfiles = applySubscriptionExportProfileTask(subscriptionExportProfiles, task);

      if (
        importedSubscriptionSource ||
        generatedSubscriptionClient ||
        deletedSubscriptionClientId ||
        generatedSubscriptionExportProfile ||
        deletedSubscriptionExportProfileId
      ) {
        await repository.transaction(async (transaction) => {
          if (importedSubscriptionSource) {
            await transaction.upsertSubscriptionSource(importedSubscriptionSource);
          }

          if (generatedSubscriptionExportProfile) {
            await transaction.upsertSubscriptionExportProfile(generatedSubscriptionExportProfile);
          }

          if (deletedSubscriptionExportProfileId) {
            await transaction.deleteSubscriptionExportProfile(deletedSubscriptionExportProfileId);
          }

          if (generatedSubscriptionClient) {
            await transaction.upsertSubscriptionClient(generatedSubscriptionClient);
          }

          if (deletedSubscriptionClientId) {
            await transaction.deleteSubscriptionClient(deletedSubscriptionClientId);
          }
        });
      }

      if (
        input.metadata?.quotaEnforcementAutomatic !== true &&
        ['quota.reset', 'forward.create', 'forward.update', 'forward.apply', 'forward.resume'].includes(task.operation)
      ) {
        await enqueueDerivedForwardQuotaEnforcementTasks(beforeForwardRules, {
          kind: 'task',
          id: task.id,
          observedAt: task.createdAt
        });
      }

      if (input.metadata?.xrayGuardrailAutomatic !== true && task.operation === 'quota.reset') {
        const afterInbounds = await listLiveInboundsForGuardrailEnforcement();
        if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
          await enqueueDerivedXrayGuardrailTasks({
            kind: 'task',
            id: task.id,
            observedAt: task.createdAt
          });
        }
      }

      return task;
    },

    async syncSubscriptionSource(sourceId: string, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();

      const source = subscriptionSources.find((item) => item.id === sourceId);
      const syncedAt = new Date().toISOString();
      const mutationContext = resolveMutationContext(context);

      if (!source) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      const fetchPolicy = resolveSubscriptionSourceFetchPolicy(source, subscriptionSourceFetchPolicy);
      const leased = await acquireSubscriptionSourceSyncLease(sourceId, syncedAt, fetchPolicy);
      const syncSource = leased.source;
      subscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
        status: 'syncing',
        syncLeaseOwnerId: leased.leasedSource.syncLeaseOwnerId,
        syncLeaseExpiresAt: leased.leasedSource.syncLeaseExpiresAt
      });
      const auditBefore = {
        id: syncSource.id,
        status: syncSource.status,
        nodeCount: syncSource.nodeCount,
        lastSyncAt: syncSource.lastSyncAt,
        syncWarnings: syncSource.syncWarnings ?? []
      };

      try {
        const response = await fetchSubscriptionSourceContent(
          syncSource,
          fetcher,
          subscriptionSourceRemoteFetcher,
          subscriptionSourceHostResolver,
          subscriptionSourceEgressPolicy,
          fetchPolicy
        );
        const result = parseSubscriptionSourceContent({
          source: syncSource,
          body: response.body,
          syncedAt,
          trafficHeader: response.trafficHeader
        });
        const crossSourceDuplicateCount = countCrossSourceSubscriptionInventoryDuplicates(
          result.nodes,
          subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId),
          syncSource.dedupeKey
        );
        const syncedResult: SubscriptionSourceSyncResult = {
          ...result,
          status: result.status === 'synced' && crossSourceDuplicateCount > 0 ? 'warning' : result.status,
          warnings:
            crossSourceDuplicateCount > 0
              ? [...result.warnings, `subscription_source.cross_source_duplicates:${crossSourceDuplicateCount}`]
              : result.warnings
        };

        const nextSubscriptionInventoryNodes = [
          ...syncedResult.nodes,
          ...subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId)
        ];
        const nextSubscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: syncedResult.status,
          nodeCount: syncedResult.nodeCount,
          lastSyncAt: syncedResult.syncedAt,
          traffic: syncedResult.traffic,
          syncWarnings: syncedResult.warnings,
          syncLeaseOwnerId: undefined,
          syncLeaseExpiresAt: undefined
        });
        const syncedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (syncedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source: syncSource,
            result: syncedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: syncedResult.status,
              nodeCount: syncedResult.nodeCount,
              syncedAt: syncedResult.syncedAt,
              warnings: syncedResult.warnings
            }
          });

          await repository.transaction(async (transaction) => {
            await transaction.replaceSubscriptionInventoryNodesForSource(sourceId, syncedResult.nodes);
            await transaction.upsertSubscriptionSource(syncedSource);
            await appendStandaloneAuditLog(transaction, auditLog);
          });
          subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
          subscriptionSources = nextSubscriptionSources;
        }

        return clone(syncedResult);
      } catch (error) {
        const failedResult = createFailedSubscriptionSyncResult(sourceId, syncedAt, error);
        const nextSubscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId);
        const nextSubscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: 'failed',
          nodeCount: 0,
          lastSyncAt: syncedAt,
          traffic: undefined,
          syncWarnings: failedResult.warnings,
          syncLeaseOwnerId: undefined,
          syncLeaseExpiresAt: undefined
        });
        const failedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (failedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source: syncSource,
            result: failedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: failedResult.status,
              nodeCount: failedResult.nodeCount,
              syncedAt: failedResult.syncedAt,
              warnings: failedResult.warnings
            }
          });

          await repository.transaction(async (transaction) => {
            await transaction.replaceSubscriptionInventoryNodesForSource(sourceId, []);
            await transaction.upsertSubscriptionSource(failedSource);
            await appendStandaloneAuditLog(transaction, auditLog);
          });
          subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
          subscriptionSources = nextSubscriptionSources;
        }
        return clone(failedResult);
      }
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext) {
      const task = await service.transitionTask(taskId, status, resolveMutationContext(context));
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      return task;
    },

    async issueAgentCommand(agentId: string, command: AgentCommandEnvelope, context?: MutationContext) {
      return service.issueAgentCommand(agentId, command, resolveMutationContext(context));
    },

    async leaseAgentCommands(agentId, options) {
      return service.leaseAgentCommands(agentId, options);
    },

    async sweepCommandTimeouts(options) {
      return service.sweepCommandTimeouts(options);
    },

    async retrySystemAlertNotifications(options) {
      return retrySystemAlertNotifications(options);
    },

    async receiveAgentEvent(event: AgentEventEnvelope) {
      const beforeForwardRules = await listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = await listLiveInboundsForGuardrailEnforcement();
      const result = await service.receiveAgentEvent(event);
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      const resetAwareEvent = applyQuotaResetStateToForwardingEvent(
        applyQuotaResetStateToXrayEvent(applyQuotaResetStateToAgentEvent(event, quotaResetReplayState), quotaResetReplayState),
        quotaResetReplayState
      );
      if (!deletedAgentIds.has(event.agentId)) {
        agents = applyAgentEventToReadModel(agents, resetAwareEvent);
        inbounds = applyXrayTelemetryToReadModel(inbounds, resetAwareEvent);
        forwardRulesReadModel = applyForwardingTelemetryToReadModel(await listForwardRuleReadModel(), resetAwareEvent);
      }
      if (result) {
        forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), result);
      }

      await enqueueDerivedForwardQuotaEnforcementTasks(beforeForwardRules, {
        kind: 'agent-event',
        id: event.eventId,
        observedAt: event.observedAt
      });
      const afterInbounds = await listLiveInboundsForGuardrailEnforcement();
      if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
        await enqueueDerivedXrayGuardrailTasks({
          kind: 'agent-event',
          id: event.eventId,
          observedAt: event.observedAt
        });
      }
      return result;
    }
  };

  return api;
}
