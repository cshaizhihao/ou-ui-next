import type {
  Agent,
  AgentLogArchive,
  AgentStatus,
  AgentCredentialRevokeRequest,
  AgentCredentialRotateRequest,
  AgentCredentialSummary,
  AgentInstallCommand,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentRuntimeCredential,
  AgentSessionSummary,
  AuditLog,
  CreateTaskInput,
  CustomerReadModel,
  DeployTask,
  DeployTaskOperation,
  DeployTaskStatus,
  ForwardRule,
  ManagedNode,
  OperatorSessionRevokeRequest,
  OperatorSessionSummary,
  PermissionGrant,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimeModuleKind,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportProfile,
  SubscriptionExportFile,
  SubscriptionInventoryNode,
  ProxyProviderConfig,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
  SystemAlert,
  SystemAlertKind,
  SystemAlertSeverity,
  TelegramBindingChallenge,
  TelegramBindingChallengeCreateInput,
  TelegramBindingChallengeCreateResult,
  TelegramBindingCreateInput,
  TelegramBindingReadModel,
  TelegramBindingRevokeInput,
  TelegramBotSettings,
  TelegramBotSettingsUpdateInput,
  TelegramLongPollingResult,
  TelegramNotificationDelivery,
  TelegramNotificationDeliveryStatus,
  TelegramNotificationPolicy,
  TelegramNotificationPolicyUpdateInput,
  TelegramTestNotificationInput,
  TelegramWebhookHandleResult,
  TelegramWebhookUpdate,
  TrafficRollup,
  TrafficRollupCompaction,
  TrafficRollupDimension,
  TuningProfile,
  XrayInbound
} from '../../domain';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import type {
  SystemAlertNotificationDeliveryRecord,
  SystemAlertNotificationDeliveryStatus,
  SystemAlertNotificationRetryOptions,
  SystemAlertNotificationRetryResult
} from './system-alert-notifications';

export type ApiVersion = 'v1';

export type ApiTransport = 'rest' | 'sse' | 'websocket' | 'agent-command';

export type ApiBoundaryDescriptor = {
  version: ApiVersion;
  restBasePath: '/api/v1';
  eventStreamPath: '/events/v1';
  agentStreamPath: '/agent/v1';
  supportsIdempotency: boolean;
  transports: ApiTransport[];
  taskStatuses: DeployTaskStatus[];
  taskTransitions: Record<DeployTaskStatus, DeployTaskStatus[]>;
};

export type ListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
};

export type AgentLogChunkQuery = ListQuery & {
  agentId?: string;
  taskId?: string;
  commandId?: string;
  since?: string;
  limit?: number;
};

export type AgentLogChunk = {
  eventId: string;
  agentId: string;
  sessionId: string;
  seq: number;
  observedAt: string;
  commandId: string;
  taskId: string;
  chunkSeq: number;
  stream: 'stdout' | 'stderr' | 'agent' | 'runtime';
  content: string;
};

export type AgentLogExportFormat = 'jsonl' | 'json';

export type AgentLogExportQuery = AgentLogChunkQuery & {
  format?: AgentLogExportFormat;
};

export type AgentLogExportReadModel = {
  format: AgentLogExportFormat;
  contentType: string;
  filename: string;
  generatedAt: string;
  count: number;
  query: AgentLogExportQuery;
  chunks: AgentLogChunk[];
  content: string;
};

export type AgentLogArchiveQuery = ListQuery & {
  agentId?: string;
  taskId?: string;
  commandId?: string;
  stream?: AgentLogChunk['stream'];
  since?: string;
  until?: string;
  limit?: number;
};

export type AgentLogArchiveExportFormat = 'jsonl' | 'json';

export type AgentLogArchiveExportQuery = AgentLogArchiveQuery & {
  format?: AgentLogArchiveExportFormat;
};

export type AgentLogArchiveExportReadModel = {
  format: AgentLogArchiveExportFormat;
  contentType: string;
  filename: string;
  generatedAt: string;
  count: number;
  query: AgentLogArchiveExportQuery;
  archives: AgentLogArchive[];
  content: string;
};

export type TrafficRollupQuery = ListQuery & {
  dimension?: TrafficRollupDimension;
  agentId?: string;
  subjectId?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type TrafficRollupExportFormat = 'jsonl' | 'json';

export type TrafficRollupExportQuery = TrafficRollupQuery & {
  format?: TrafficRollupExportFormat;
};

export type TrafficRollupExportReadModel = {
  format: TrafficRollupExportFormat;
  contentType: string;
  filename: string;
  generatedAt: string;
  count: number;
  query: TrafficRollupExportQuery;
  rollups: TrafficRollup[];
  content: string;
};

export type TrafficRollupCompactionQuery = ListQuery & {
  dimension?: TrafficRollupDimension;
  agentId?: string;
  subjectId?: string;
  periodKey?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type TrafficRollupCompactionExportFormat = 'jsonl' | 'json';

export type TrafficRollupCompactionExportQuery = TrafficRollupCompactionQuery & {
  format?: TrafficRollupCompactionExportFormat;
};

export type TrafficRollupCompactionExportReadModel = {
  format: TrafficRollupCompactionExportFormat;
  contentType: string;
  filename: string;
  generatedAt: string;
  count: number;
  query: TrafficRollupCompactionExportQuery;
  compactions: TrafficRollupCompaction[];
  content: string;
};

export type AgentLogRetentionPolicyReadModel = {
  maxAgeMs: number;
  maxAgeDays: number;
  maxEventsPerAgent: number;
  source: 'runtime-config' | 'control-plane';
};

export type AgentLogRetentionPolicyUpdateInput = {
  maxAgeDays: number;
  maxEventsPerAgent: number;
  reason?: string;
};

export type TrafficRollupRetentionPolicyValues = {
  maxAgeMs: number;
  maxAgeDays: number;
  maxRecordsPerScope: number;
};

export type TrafficRollupRetentionPolicyReadModel = TrafficRollupRetentionPolicyValues & {
  source: 'runtime-config' | 'control-plane';
  runtimeDefault: TrafficRollupRetentionPolicyValues;
  controlPlaneOverride?: TrafficRollupRetentionPolicyValues;
};

export type TrafficRollupRetentionPolicyUpdateInput = {
  maxAgeDays: number;
  maxRecordsPerScope: number;
  reason?: string;
};

export type AgentRequestDeniedAuditInput = {
  endpoint: 'poll' | 'events' | 'credential_rotate';
  requestId: string;
  sourceIp: string;
  userAgent?: string;
  denialCode: 'unauthorized' | 'identity.mismatch';
  denialReason: string;
  tokenPresented: boolean;
  agentIds?: string[];
  sessionIds?: string[];
  authenticatedAgentId?: string;
  authenticatedSessionId?: string;
  credentialId?: string;
};

export type OperatorRequestDeniedAuditInput = {
  method: string;
  path: string;
  requestId: string;
  sourceIp: string;
  userAgent?: string;
  denialCode: 'unauthorized' | 'operator_auth.rate_limited' | 'csrf.required';
  denialReason: string;
  tokenPresented: boolean;
};

export type MutationContext = {
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  sourceIp: string;
  userAgent?: string;
  requestId: string;
  idempotencyKey?: string;
  ifMatch?: string;
};

export type CommandOutboxStatus =
  | 'pending'
  | 'dispatched'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'dead_letter';

export type CommandOutboxItem = {
  id: string;
  taskId: string;
  commandId: string;
  agentId: string;
  seq: number;
  status: CommandOutboxStatus;
  transport: 'websocket' | 'http-pull' | 'grpc';
  command: AgentCommandEnvelope;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  leaseOwnerId?: string;
  leaseSessionId?: string;
  leasedAt?: string;
  leaseExpiresAt?: string;
  ackedAt?: string;
  resultAt?: string;
  lastError?: string;
};

export type AgentCommandLeaseOptions = {
  requestId: string;
  leaseOwnerId?: string;
  sessionId?: string;
  lastSeenCommandSeq?: number;
  now?: string;
  leaseDurationMs?: number;
  maxCommands?: number;
};

export type CommandTimeoutSweepOptions = {
  requestId: string;
  now?: string;
  ackTimeoutMs?: number;
  resultTimeoutMs?: number;
  maxCommands?: number;
};

export type CommandTimeoutSweepResult = {
  scanned: number;
  expired: number;
  deadLettered: number;
  taskFailures: number;
};

export type TelegramNotificationDeliveryRetryOptions = {
  now?: string;
  maxDeliveries?: number;
};

export type TelegramNotificationDeliveryRetryResult = {
  attempted: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  skippedReason?: 'settings_disabled' | 'token_missing';
};

export type TelegramNotificationScheduleScanOptions = {
  now?: string;
  maxDeliveries?: number;
};

export type TelegramNotificationScheduleScanSkipReason =
  | 'binding_inactive'
  | 'permission_disabled'
  | 'policy_disabled'
  | 'notification_type_disabled'
  | 'no_traffic_limit'
  | 'threshold_not_crossed'
  | 'no_expiry'
  | 'outside_expiry_window'
  | 'no_subscription_output'
  | 'duplicate_delivery'
  | 'rate_limited'
  | 'no_admin_recipients'
  | 'max_deliveries_reached';

export type TelegramNotificationScheduleScanResult = {
  enabled: boolean;
  scannedBindings: number;
  scannedSystemAlerts: number;
  enqueuedDeliveries: number;
  trafficThresholdDeliveries: number;
  expiryReminderDeliveries: number;
  subscriptionUpdatedDeliveries: number;
  providerSyncWarningDeliveries: number;
  providerSyncFailedDeliveries: number;
  dailyReportDeliveries: number;
  weeklyReportDeliveries: number;
  systemAlertDeliveries: number;
  skipped: Partial<Record<TelegramNotificationScheduleScanSkipReason, number>>;
  skippedReason?: 'settings_disabled' | 'token_missing' | 'no_schedules_enabled';
};

export type AuditChainVerification = {
  valid: boolean;
  checked: number;
  brokenAt?: string;
  reason?: 'hash.mismatch' | 'prev_hash.mismatch';
};

export type ObservabilityAuditMetrics = AuditChainVerification & {
  denied: number;
  quotaExceeded: number;
  writeFailures: number;
};

export type ControlPlaneRuntimeObservabilityMetricsInput = {
  auditWriteFailures?: number;
  externalArchiveSinkFailures?: number;
  externalArchiveFailedRecords?: number;
};

export type ControlPlaneRuntimeObservabilityMetricsArgument =
  | ControlPlaneRuntimeObservabilityMetricsInput
  | number;

export type ObservabilityExternalArchiveMetrics = {
  sinkFailures: number;
  failedRecords: number;
};

export type ObservabilityLatencySummary = {
  count: number;
  sumMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  buckets: ObservabilityLatencyBucket[];
};

export type ObservabilityLatencyBucket = {
  leMs: number;
  count: number;
};

export type ObservabilityTrafficRollupStorageMetrics = {
  retained: number;
  earliestSampledAt: string | null;
  latestSampledAt: string | null;
  meteredBytesTotal: number;
};

export type ObservabilityTrafficRollupMetrics = ObservabilityTrafficRollupStorageMetrics & {
  byDimension: Record<TrafficRollupDimension, ObservabilityTrafficRollupStorageMetrics>;
};

export type ObservabilityTrafficRollupCompactionStorageMetrics = {
  buckets: number;
  samples: number;
  earliestBucketStartAt: string | null;
  latestBucketStartAt: string | null;
  meteredBytesTotal: number;
};

export type ObservabilityTrafficRollupCompactionMetrics = ObservabilityTrafficRollupCompactionStorageMetrics & {
  byDimension: Record<TrafficRollupDimension, ObservabilityTrafficRollupCompactionStorageMetrics>;
};

export type ObservabilityQuotaPolicyScopeMetrics = {
  total: number;
  exceeded: number;
  disabled: number;
  resetPending: number;
  limitBytesTotal: number;
  usedBytesTotal: number;
};

export type ObservabilityQuotaPolicyMetrics = ObservabilityQuotaPolicyScopeMetrics & {
  byScope: Record<QuotaPolicy['scope'], ObservabilityQuotaPolicyScopeMetrics>;
  byEnforcementState: Record<QuotaPolicy['enforcementState'], number>;
};

export type ObservabilityAgentLogStorageMetrics = {
  retained: number;
  contentBytes: number;
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
};

export type ObservabilityAgentLogMetrics = ObservabilityAgentLogStorageMetrics & {
  byStream: Record<AgentLogChunk['stream'], ObservabilityAgentLogStorageMetrics>;
};

export type ObservabilityAgentLogArchiveStorageMetrics = {
  buckets: number;
  chunks: number;
  contentBytes: number;
  earliestBucketStartAt: string | null;
  latestBucketStartAt: string | null;
};

export type ObservabilityAgentLogArchiveMetrics = ObservabilityAgentLogArchiveStorageMetrics & {
  byStream: Record<AgentLogChunk['stream'], ObservabilityAgentLogArchiveStorageMetrics>;
};

export type ObservabilityMetrics = {
  generatedAt: string;
  tasks: {
    total: number;
    active: number;
    failed: number;
    rollbacks: number;
    completionLatencyMs: ObservabilityLatencySummary;
    completionLatencyByOperation: Record<string, ObservabilityLatencySummary>;
    runtimeApplyLatencyByModule: Record<string, ObservabilityLatencySummary>;
    byStatus: Record<DeployTaskStatus, number>;
  };
  commandOutbox: {
    total: number;
    backlog: number;
    activeLeases: number;
    overdue: number;
    deadLetters: number;
    ackLatencyMs: ObservabilityLatencySummary;
    resultLatencyMs: ObservabilityLatencySummary;
    byStatus: Record<CommandOutboxStatus, number>;
  };
  agents: {
    total: number;
    offline: number;
    degraded: number;
    byStatus: Record<AgentStatus, number>;
  };
  systemAlerts: {
    total: number;
    warning: number;
    critical: number;
    byKind: Record<SystemAlertKind, number>;
    bySeverity: Record<SystemAlertSeverity, number>;
  };
  systemAlertNotifications: {
    total: number;
    pending: number;
    failed: number;
    delivered: number;
    deadLetters: number;
    overdue: number;
    byStatus: Record<SystemAlertNotificationDeliveryStatus, number>;
    byChannel: Record<
      string,
      {
        label: string;
        total: number;
        pending: number;
        failed: number;
        delivered: number;
        deadLetters: number;
        overdue: number;
      }
    >;
  };
  telegramNotifications: {
    total: number;
    pending: number;
    failed: number;
    delivered: number;
    deadLetters: number;
    suppressed: number;
    overdue: number;
    byStatus: Record<TelegramNotificationDeliveryStatus, number>;
  };
  quotaPolicies: ObservabilityQuotaPolicyMetrics;
  trafficRollups: ObservabilityTrafficRollupMetrics;
  trafficRollupCompactions: ObservabilityTrafficRollupCompactionMetrics;
  agentLogs: ObservabilityAgentLogMetrics;
  agentLogArchives: ObservabilityAgentLogArchiveMetrics;
  externalArchive: ObservabilityExternalArchiveMetrics;
  audit: ObservabilityAuditMetrics;
};

type ObservabilityMetricsInput = {
  generatedAt: string;
  tasks: DeployTask[];
  commandOutbox: CommandOutboxItem[];
  agents: Agent[];
  systemAlerts: SystemAlert[];
  systemAlertNotificationDeliveries: SystemAlertNotificationDeliveryRecord[];
  telegramNotificationDeliveries: TelegramNotificationDelivery[];
  quotaPolicies: QuotaPolicy[];
  agentEvents: AgentEventEnvelope[];
  agentLogArchives: AgentLogArchive[];
  trafficRollups: TrafficRollup[];
  trafficRollupCompactions: TrafficRollupCompaction[];
  audit: AuditChainVerification;
  auditLogs: AuditLog[];
  runtimeMetrics?: ControlPlaneRuntimeObservabilityMetricsArgument;
  auditWriteFailures?: number;
  externalArchiveSinkFailures?: number;
  externalArchiveFailedRecords?: number;
};

function readMetricCount(value: number | undefined) {
  return Math.max(0, Math.round(value ?? 0));
}

export function normalizeControlPlaneRuntimeObservabilityMetrics(
  input?: ControlPlaneRuntimeObservabilityMetricsArgument
): Required<ControlPlaneRuntimeObservabilityMetricsInput> {
  if (typeof input === 'number') {
    return {
      auditWriteFailures: readMetricCount(input),
      externalArchiveSinkFailures: 0,
      externalArchiveFailedRecords: 0
    };
  }

  return {
    auditWriteFailures: readMetricCount(input?.auditWriteFailures),
    externalArchiveSinkFailures: readMetricCount(input?.externalArchiveSinkFailures),
    externalArchiveFailedRecords: readMetricCount(input?.externalArchiveFailedRecords)
  };
}

function readLogChunkLimit(query: AgentLogChunkQuery | undefined) {
  const requested = query?.limit ?? query?.pageSize ?? 200;
  const normalized = Number.isFinite(requested) ? Math.round(requested) : 200;
  return Math.min(Math.max(normalized, 1), 1000);
}

function readTrafficRollupLimit(query: { limit?: number; pageSize?: number } | undefined, defaultLimit?: number) {
  const requested = query?.limit ?? query?.pageSize ?? defaultLimit;

  if (requested === undefined) {
    return undefined;
  }

  const normalized = Number.isFinite(requested) ? Math.round(requested) : defaultLimit ?? 1000;
  return Math.min(Math.max(normalized, 1), 5000);
}

export function selectAgentLogChunks(
  events: AgentEventEnvelope[],
  query: AgentLogChunkQuery = {}
): AgentLogChunk[] {
  const sinceMs = query.since ? Date.parse(query.since) : undefined;
  const limit = readLogChunkLimit(query);

  const matchingEvents = events
    .filter((event): event is Extract<AgentEventEnvelope, { type: 'log_chunk' }> => event.type === 'log_chunk')
    .filter((event) => !query.agentId || event.agentId === query.agentId)
    .filter((event) => !query.taskId || event.taskId === query.taskId)
    .filter((event) => !query.commandId || event.commandId === query.commandId)
    .filter((event) => {
      if (sinceMs === undefined || Number.isNaN(sinceMs)) {
        return true;
      }

      const observedMs = Date.parse(event.observedAt);
      return !Number.isNaN(observedMs) && observedMs >= sinceMs;
    });

  return dedupeAgentLogChunkEvents(matchingEvents)
    .sort((left, right) => {
      const observedDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
      return observedDelta || right.seq - left.seq || right.payload.chunkSeq - left.payload.chunkSeq;
    })
    .slice(0, limit)
    .map((event) => ({
      eventId: event.eventId,
      agentId: event.agentId,
      sessionId: event.sessionId,
      seq: event.seq,
      observedAt: event.observedAt,
      commandId: event.commandId,
      taskId: event.taskId,
      chunkSeq: event.payload.chunkSeq,
      stream: event.payload.stream,
      content: event.payload.content
    }));
}

function createAgentLogChunkDedupeKey(event: Extract<AgentEventEnvelope, { type: 'log_chunk' }>) {
  return [event.agentId, event.taskId, event.commandId, String(event.payload.chunkSeq)].join('\u0000');
}

function shouldKeepAgentLogChunkCandidate(
  current: Extract<AgentEventEnvelope, { type: 'log_chunk' }>,
  candidate: Extract<AgentEventEnvelope, { type: 'log_chunk' }>
) {
  const currentObservedAtMs = Date.parse(current.observedAt);
  const candidateObservedAtMs = Date.parse(candidate.observedAt);

  if (!Number.isNaN(currentObservedAtMs) && !Number.isNaN(candidateObservedAtMs) && candidateObservedAtMs !== currentObservedAtMs) {
    return candidateObservedAtMs < currentObservedAtMs;
  }

  return candidate.seq < current.seq;
}

function dedupeAgentLogChunkEvents(
  events: Array<Extract<AgentEventEnvelope, { type: 'log_chunk' }>>
) {
  const retained = new Map<string, Extract<AgentEventEnvelope, { type: 'log_chunk' }>>();

  for (const event of events) {
    const key = createAgentLogChunkDedupeKey(event);
    const current = retained.get(key);

    if (!current || shouldKeepAgentLogChunkCandidate(current, event)) {
      retained.set(key, event);
    }
  }

  return [...retained.values()];
}

function createAgentLogExportFilename(generatedAt: string, format: AgentLogExportFormat) {
  const timestamp = generatedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '') || 'latest';
  return `ou-ui-agent-runtime-logs-${timestamp}.${format === 'jsonl' ? 'jsonl' : 'json'}`;
}

function normalizeAgentLogExportQuery(query: AgentLogExportQuery = {}): AgentLogExportQuery {
  return {
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
    ...(query.commandId ? { commandId: query.commandId } : {}),
    ...(query.since ? { since: query.since } : {}),
    limit: readLogChunkLimit(query),
    format: query.format === 'json' ? 'json' : 'jsonl'
  };
}

export function createAgentLogExport(
  events: AgentEventEnvelope[],
  query: AgentLogExportQuery = {},
  generatedAt = new Date().toISOString()
): AgentLogExportReadModel {
  const normalizedQuery = normalizeAgentLogExportQuery(query);
  const chunks = selectAgentLogChunks(events, normalizedQuery);
  const format = normalizedQuery.format ?? 'jsonl';
  const contentType = format === 'json'
    ? 'application/json; charset=utf-8'
    : 'application/x-ndjson; charset=utf-8';
  const content = format === 'json'
    ? `${JSON.stringify({ generatedAt, query: normalizedQuery, count: chunks.length, chunks }, null, 2)}\n`
    : chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (chunks.length > 0 ? '\n' : '');

  return {
    format,
    contentType,
    filename: createAgentLogExportFilename(generatedAt, format),
    generatedAt,
    count: chunks.length,
    query: normalizedQuery,
    chunks,
    content
  };
}

export function selectAgentLogArchives(archives: AgentLogArchive[], query: AgentLogArchiveQuery = {}) {
  const sinceMs = query.since ? Date.parse(query.since) : undefined;
  const untilMs = query.until ? Date.parse(query.until) : undefined;
  const limit = readLogChunkLimit(query);

  return archives
    .filter((archive) => !query.agentId || archive.agentId === query.agentId)
    .filter((archive) => !query.taskId || archive.taskId === query.taskId)
    .filter((archive) => !query.commandId || archive.commandId === query.commandId)
    .filter((archive) => !query.stream || archive.stream === query.stream)
    .filter((archive) => {
      const observedMs = Date.parse(archive.lastObservedAt);

      if (Number.isNaN(observedMs)) {
        return false;
      }

      if (sinceMs !== undefined && !Number.isNaN(sinceMs) && observedMs < sinceMs) {
        return false;
      }

      return !(untilMs !== undefined && !Number.isNaN(untilMs) && observedMs > untilMs);
    })
    .sort((left, right) => {
      const observedDelta = Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt);
      return observedDelta || right.lastSeq - left.lastSeq || right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

function createAgentLogArchiveExportFilename(generatedAt: string, format: AgentLogArchiveExportFormat) {
  const timestamp = generatedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '') || 'latest';
  return `ou-ui-agent-log-archives-${timestamp}.${format === 'jsonl' ? 'jsonl' : 'json'}`;
}

function normalizeAgentLogArchiveExportQuery(
  query: AgentLogArchiveExportQuery = {}
): AgentLogArchiveExportQuery {
  return {
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
    ...(query.commandId ? { commandId: query.commandId } : {}),
    ...(query.stream ? { stream: query.stream } : {}),
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
    limit: readLogChunkLimit(query),
    format: query.format === 'json' ? 'json' : 'jsonl'
  };
}

export function createAgentLogArchiveExport(
  archives: AgentLogArchive[],
  query: AgentLogArchiveExportQuery = {},
  generatedAt = new Date().toISOString()
): AgentLogArchiveExportReadModel {
  const normalizedQuery = normalizeAgentLogArchiveExportQuery(query);
  const selectedArchives = selectAgentLogArchives(archives, normalizedQuery);
  const format = normalizedQuery.format ?? 'jsonl';
  const contentType = format === 'json'
    ? 'application/json; charset=utf-8'
    : 'application/x-ndjson; charset=utf-8';
  const content = format === 'json'
    ? `${JSON.stringify({ generatedAt, query: normalizedQuery, count: selectedArchives.length, archives: selectedArchives }, null, 2)}\n`
    : selectedArchives.map((archive) => JSON.stringify(archive)).join('\n') + (selectedArchives.length > 0 ? '\n' : '');

  return {
    format,
    contentType,
    filename: createAgentLogArchiveExportFilename(generatedAt, format),
    generatedAt,
    count: selectedArchives.length,
    query: normalizedQuery,
    archives: selectedArchives,
    content
  };
}

export function selectTrafficRollups(rollups: TrafficRollup[], query: TrafficRollupQuery = {}) {
  const sinceMs = query.since ? Date.parse(query.since) : undefined;
  const untilMs = query.until ? Date.parse(query.until) : undefined;
  const limit = readTrafficRollupLimit(query);

  return rollups
    .filter((rollup) => !query.dimension || rollup.dimension === query.dimension)
    .filter((rollup) => !query.agentId || rollup.agentId === query.agentId)
    .filter((rollup) => !query.subjectId || rollup.subjectId === query.subjectId)
    .filter((rollup) => {
      const observedMs = Date.parse(rollup.observedAt);

      if (Number.isNaN(observedMs)) {
        return false;
      }

      if (sinceMs !== undefined && !Number.isNaN(sinceMs) && observedMs < sinceMs) {
        return false;
      }

      return !(untilMs !== undefined && !Number.isNaN(untilMs) && observedMs > untilMs);
    })
    .sort((left, right) => {
      const observedDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
      return observedDelta || left.id.localeCompare(right.id);
    })
    .slice(0, limit ?? rollups.length);
}

function createTrafficRollupExportFilename(generatedAt: string, format: TrafficRollupExportFormat) {
  const timestamp = generatedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '') || 'latest';
  return `ou-ui-traffic-rollups-${timestamp}.${format === 'jsonl' ? 'jsonl' : 'json'}`;
}

function normalizeTrafficRollupExportQuery(query: TrafficRollupExportQuery = {}): TrafficRollupExportQuery {
  return {
    ...(query.dimension ? { dimension: query.dimension } : {}),
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
    limit: readTrafficRollupLimit(query, 1000),
    format: query.format === 'json' ? 'json' : 'jsonl'
  };
}

export function createTrafficRollupExport(
  rollups: TrafficRollup[],
  query: TrafficRollupExportQuery = {},
  generatedAt = new Date().toISOString()
): TrafficRollupExportReadModel {
  const normalizedQuery = normalizeTrafficRollupExportQuery(query);
  const selectedRollups = selectTrafficRollups(rollups, normalizedQuery);
  const format = normalizedQuery.format ?? 'jsonl';
  const contentType = format === 'json'
    ? 'application/json; charset=utf-8'
    : 'application/x-ndjson; charset=utf-8';
  const content = format === 'json'
    ? `${JSON.stringify({ generatedAt, query: normalizedQuery, count: selectedRollups.length, rollups: selectedRollups }, null, 2)}\n`
    : selectedRollups.map((rollup) => JSON.stringify(rollup)).join('\n') + (selectedRollups.length > 0 ? '\n' : '');

  return {
    format,
    contentType,
    filename: createTrafficRollupExportFilename(generatedAt, format),
    generatedAt,
    count: selectedRollups.length,
    query: normalizedQuery,
    rollups: selectedRollups,
    content
  };
}

export function selectTrafficRollupCompactions(
  compactions: TrafficRollupCompaction[],
  query: TrafficRollupCompactionQuery = {}
) {
  const sinceMs = query.since ? Date.parse(query.since) : undefined;
  const untilMs = query.until ? Date.parse(query.until) : undefined;
  const limit = readTrafficRollupLimit(query);

  return compactions
    .filter((compaction) => !query.dimension || compaction.dimension === query.dimension)
    .filter((compaction) => !query.agentId || compaction.agentId === query.agentId)
    .filter((compaction) => !query.subjectId || compaction.subjectId === query.subjectId)
    .filter((compaction) => !query.periodKey || compaction.periodKey === query.periodKey)
    .filter((compaction) => {
      const bucketStartAtMs = Date.parse(compaction.bucketStartAt);

      if (Number.isNaN(bucketStartAtMs)) {
        return false;
      }

      if (sinceMs !== undefined && !Number.isNaN(sinceMs) && bucketStartAtMs < sinceMs) {
        return false;
      }

      return !(untilMs !== undefined && !Number.isNaN(untilMs) && bucketStartAtMs > untilMs);
    })
    .sort((left, right) => {
      const bucketDelta = Date.parse(right.bucketStartAt) - Date.parse(left.bucketStartAt);
      return bucketDelta || left.id.localeCompare(right.id);
    })
    .slice(0, limit ?? compactions.length);
}

function createTrafficRollupCompactionExportFilename(
  generatedAt: string,
  format: TrafficRollupCompactionExportFormat
) {
  const timestamp = generatedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '') || 'latest';
  return `ou-ui-traffic-rollup-compactions-${timestamp}.${format === 'jsonl' ? 'jsonl' : 'json'}`;
}

function normalizeTrafficRollupCompactionExportQuery(
  query: TrafficRollupCompactionExportQuery = {}
): TrafficRollupCompactionExportQuery {
  return {
    ...(query.dimension ? { dimension: query.dimension } : {}),
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.periodKey ? { periodKey: query.periodKey } : {}),
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
    limit: readTrafficRollupLimit(query, 1000),
    format: query.format === 'json' ? 'json' : 'jsonl'
  };
}

export function createTrafficRollupCompactionExport(
  compactions: TrafficRollupCompaction[],
  query: TrafficRollupCompactionExportQuery = {},
  generatedAt = new Date().toISOString()
): TrafficRollupCompactionExportReadModel {
  const normalizedQuery = normalizeTrafficRollupCompactionExportQuery(query);
  const selectedCompactions = selectTrafficRollupCompactions(compactions, normalizedQuery);
  const format = normalizedQuery.format ?? 'jsonl';
  const contentType = format === 'json'
    ? 'application/json; charset=utf-8'
    : 'application/x-ndjson; charset=utf-8';
  const content = format === 'json'
    ? `${JSON.stringify({ generatedAt, query: normalizedQuery, count: selectedCompactions.length, compactions: selectedCompactions }, null, 2)}\n`
    : selectedCompactions.map((compaction) => JSON.stringify(compaction)).join('\n') + (selectedCompactions.length > 0 ? '\n' : '');

  return {
    format,
    contentType,
    filename: createTrafficRollupCompactionExportFilename(generatedAt, format),
    generatedAt,
    count: selectedCompactions.length,
    query: normalizedQuery,
    compactions: selectedCompactions,
    content
  };
}

export const v1ApiBoundary: ApiBoundaryDescriptor = {
  version: 'v1',
  restBasePath: '/api/v1',
  eventStreamPath: '/events/v1',
  agentStreamPath: '/agent/v1',
  supportsIdempotency: true,
  transports: ['rest', 'sse', 'websocket', 'agent-command'],
  taskStatuses: ['queued', 'running', 'succeeded', 'failed', 'retrying', 'rolled_back', 'canceled'],
  taskTransitions: {
    queued: ['running', 'failed', 'canceled'],
    running: ['succeeded', 'failed', 'retrying', 'canceled'],
    retrying: ['running', 'failed', 'canceled'],
    succeeded: ['rolled_back'],
    failed: ['retrying', 'rolled_back'],
    rolled_back: [],
    canceled: []
  }
};

const commandOutboxStatuses: CommandOutboxStatus[] = [
  'pending',
  'dispatched',
  'acknowledged',
  'completed',
  'failed',
  'expired',
  'dead_letter'
];
const agentStatuses: AgentStatus[] = ['online', 'offline', 'degraded', 'provisioning'];
const systemAlertKinds: SystemAlertKind[] = [
  'agent.telemetry_sampling_gap',
  'agent.offline',
  'agent.runtime_service_unhealthy',
  'agent.high_latency',
  'command_outbox.overdue',
  'command_outbox.dead_letter',
  'runtime.apply_health_failed',
  'runtime.reload_failed',
  'audit.write_failed',
  'external_archive.sink_failed',
  'system_alert_notification.overdue',
  'system_alert_notification.dead_letter',
  'subscription_source.sync_warning',
  'subscription_source.sync_failed',
  'quota.exceeded'
];
const systemAlertSeverities: SystemAlertSeverity[] = ['warning', 'critical'];
const systemAlertNotificationDeliveryStatuses: SystemAlertNotificationDeliveryStatus[] = [
  'pending',
  'failed',
  'delivered',
  'dead_letter'
];
const telegramNotificationDeliveryStatuses: TelegramNotificationDeliveryStatus[] = [
  'pending',
  'failed',
  'delivered',
  'dead_letter',
  'suppressed'
];
const trafficRollupDimensions: TrafficRollupDimension[] = ['agent', 'forward-rule', 'xray-client'];
const agentLogStreams: AgentLogChunk['stream'][] = ['stdout', 'stderr', 'agent', 'runtime'];
const runtimeModuleKinds: RuntimeModuleKind[] = ['host-agent', 'xray', 'gost', 'hysteria2', 'port-forwarding', 'bbr'];
const runtimeApplyOperations = new Set<DeployTaskOperation>([
  'agent.deploy',
  'agent.upgrade',
  'agent.update',
  'agent.delete',
  'agent.rollback',
  'module.install',
  'inbound.create',
  'inbound.update',
  'inbound.delete',
  'config.apply',
  'runtime.reload',
  'forward.create',
  'forward.update',
  'forward.apply',
  'forward.delete',
  'forward.pause',
  'forward.resume',
  'tunnel.create',
  'tunnel.update',
  'tunnel.redeploy',
  'system.tune'
]);

function countBy<T extends string>(values: readonly T[], items: T[]) {
  return Object.fromEntries(values.map((value) => [value, items.filter((item) => item === value).length])) as Record<
    T,
    number
  >;
}

function readSystemAlertNotificationChannelId(delivery: SystemAlertNotificationDeliveryRecord) {
  return delivery.channelId?.trim() || 'default-webhook';
}

function readSystemAlertNotificationChannelLabel(delivery: SystemAlertNotificationDeliveryRecord, channelId: string) {
  return delivery.channelLabel?.trim() || channelId;
}

function summarizeSystemAlertNotificationChannels(
  deliveries: SystemAlertNotificationDeliveryRecord[],
  nowMs: number
): ObservabilityMetrics['systemAlertNotifications']['byChannel'] {
  const byChannel: ObservabilityMetrics['systemAlertNotifications']['byChannel'] = {};

  for (const delivery of deliveries) {
    const channelId = readSystemAlertNotificationChannelId(delivery);
    const summary = byChannel[channelId] ?? {
      label: readSystemAlertNotificationChannelLabel(delivery, channelId),
      total: 0,
      pending: 0,
      failed: 0,
      delivered: 0,
      deadLetters: 0,
      overdue: 0
    };
    const nextAttemptAtMs = Date.parse(delivery.nextAttemptAt);

    summary.total += 1;
    summary.pending += delivery.status === 'pending' ? 1 : 0;
    summary.failed += delivery.status === 'failed' ? 1 : 0;
    summary.delivered += delivery.status === 'delivered' ? 1 : 0;
    summary.deadLetters += delivery.status === 'dead_letter' ? 1 : 0;
    summary.overdue +=
      (delivery.status === 'pending' || delivery.status === 'failed')
      && !Number.isNaN(nextAttemptAtMs)
      && nextAttemptAtMs <= nowMs
        ? 1
        : 0;
    byChannel[channelId] = summary;
  }

  return byChannel;
}

function isActiveCommandOutboxStatus(status: CommandOutboxStatus) {
  return status === 'pending' || status === 'dispatched' || status === 'acknowledged';
}

function readDurationMs(start: string | undefined, end: string | undefined) {
  if (!start || !end) {
    return undefined;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }

  return Math.round(endMs - startMs);
}

const observabilityLatencyBucketBoundsMs = [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 120_000, 300_000];
const quotaPolicyScopes = ['managed-host', 'customer-node', 'forwarding-account', 'tunnel', 'forward-rule', 'user'] as const;
const quotaEnforcementStates = ['active', 'exceeded', 'disabled_by_quota', 'reset_pending'] as const;

function summarizeLatencyMs(values: Array<number | undefined>): ObservabilityLatencySummary {
  const sorted = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return {
      count: 0,
      sumMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      buckets: observabilityLatencyBucketBoundsMs.map((leMs) => ({ leMs, count: 0 }))
    };
  }

  const percentile = (ratio: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
  };

  return {
    count: sorted.length,
    sumMs: sorted.reduce((total, value) => total + value, 0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    buckets: observabilityLatencyBucketBoundsMs.map((leMs) => ({
      leMs,
      count: sorted.filter((value) => value <= leMs).length
    }))
  };
}

function summarizeLatencyMsByKey<T>(
  items: T[],
  readKey: (item: T) => string | undefined,
  readValue: (item: T) => number | undefined
) {
  const valuesByKey = new Map<string, Array<number | undefined>>();

  for (const item of items) {
    const key = readKey(item);

    if (!key) {
      continue;
    }

    valuesByKey.set(key, [...(valuesByKey.get(key) ?? []), readValue(item)]);
  }

  return Object.fromEntries(
    [...valuesByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, summarizeLatencyMs(values)])
  ) as Record<string, ObservabilityLatencySummary>;
}

function readPositiveIntegerMetric(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function createEmptyQuotaPolicyScopeMetrics(): ObservabilityQuotaPolicyScopeMetrics {
  return {
    total: 0,
    exceeded: 0,
    disabled: 0,
    resetPending: 0,
    limitBytesTotal: 0,
    usedBytesTotal: 0
  };
}

function addQuotaPolicyToScopeMetrics(metrics: ObservabilityQuotaPolicyScopeMetrics, policy: QuotaPolicy) {
  metrics.total += 1;
  metrics.limitBytesTotal += readPositiveIntegerMetric(policy.limitBytes);
  metrics.usedBytesTotal += readPositiveIntegerMetric(policy.usedBytes);

  if (policy.enforcementState === 'exceeded') {
    metrics.exceeded += 1;
  }

  if (policy.enforcementState === 'disabled_by_quota') {
    metrics.disabled += 1;
  }

  if (policy.enforcementState === 'reset_pending') {
    metrics.resetPending += 1;
  }
}

function summarizeQuotaPolicies(policies: QuotaPolicy[]): ObservabilityQuotaPolicyMetrics {
  const totals = createEmptyQuotaPolicyScopeMetrics();
  const byScope = Object.fromEntries(
    quotaPolicyScopes.map((scope) => [scope, createEmptyQuotaPolicyScopeMetrics()])
  ) as Record<QuotaPolicy['scope'], ObservabilityQuotaPolicyScopeMetrics>;

  for (const policy of policies) {
    addQuotaPolicyToScopeMetrics(totals, policy);
    addQuotaPolicyToScopeMetrics(byScope[policy.scope], policy);
  }

  return {
    ...totals,
    byScope,
    byEnforcementState: countBy(quotaEnforcementStates, policies.map((policy) => policy.enforcementState))
  };
}

function readUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function summarizeAgentLogStorage(
  events: Array<Extract<AgentEventEnvelope, { type: 'log_chunk' }>>
): ObservabilityAgentLogStorageMetrics {
  let earliestObservedAtMs: number | undefined;
  let latestObservedAtMs: number | undefined;
  let contentBytes = 0;

  for (const event of events) {
    contentBytes += readUtf8ByteLength(event.payload.content);

    const observedAtMs = Date.parse(event.observedAt);
    if (Number.isNaN(observedAtMs)) {
      continue;
    }

    earliestObservedAtMs =
      earliestObservedAtMs === undefined ? observedAtMs : Math.min(earliestObservedAtMs, observedAtMs);
    latestObservedAtMs = latestObservedAtMs === undefined ? observedAtMs : Math.max(latestObservedAtMs, observedAtMs);
  }

  return {
    retained: events.length,
    contentBytes,
    earliestObservedAt:
      earliestObservedAtMs === undefined ? null : new Date(earliestObservedAtMs).toISOString(),
    latestObservedAt: latestObservedAtMs === undefined ? null : new Date(latestObservedAtMs).toISOString()
  };
}

function summarizeAgentLogs(events: AgentEventEnvelope[]): ObservabilityAgentLogMetrics {
  const logEvents = dedupeAgentLogChunkEvents(
    events.filter((event): event is Extract<AgentEventEnvelope, { type: 'log_chunk' }> => event.type === 'log_chunk')
  );

  return {
    ...summarizeAgentLogStorage(logEvents),
    byStream: Object.fromEntries(
      agentLogStreams.map((stream) => [
        stream,
        summarizeAgentLogStorage(logEvents.filter((event) => event.payload.stream === stream))
      ])
    ) as Record<AgentLogChunk['stream'], ObservabilityAgentLogStorageMetrics>
  };
}

function summarizeAgentLogArchiveStorage(
  archives: AgentLogArchive[]
): ObservabilityAgentLogArchiveStorageMetrics {
  let earliestBucketStartAtMs: number | undefined;
  let latestBucketStartAtMs: number | undefined;
  let chunks = 0;
  let contentBytes = 0;

  for (const archive of archives) {
    chunks += readPositiveIntegerMetric(archive.chunkCount);
    contentBytes += readPositiveIntegerMetric(archive.contentBytes);

    const bucketStartAtMs = Date.parse(archive.bucketStartAt);
    if (Number.isNaN(bucketStartAtMs)) {
      continue;
    }

    earliestBucketStartAtMs =
      earliestBucketStartAtMs === undefined
        ? bucketStartAtMs
        : Math.min(earliestBucketStartAtMs, bucketStartAtMs);
    latestBucketStartAtMs =
      latestBucketStartAtMs === undefined ? bucketStartAtMs : Math.max(latestBucketStartAtMs, bucketStartAtMs);
  }

  return {
    buckets: archives.length,
    chunks,
    contentBytes,
    earliestBucketStartAt:
      earliestBucketStartAtMs === undefined ? null : new Date(earliestBucketStartAtMs).toISOString(),
    latestBucketStartAt:
      latestBucketStartAtMs === undefined ? null : new Date(latestBucketStartAtMs).toISOString()
  };
}

function summarizeAgentLogArchives(archives: AgentLogArchive[]): ObservabilityAgentLogArchiveMetrics {
  return {
    ...summarizeAgentLogArchiveStorage(archives),
    byStream: Object.fromEntries(
      agentLogStreams.map((stream) => [
        stream,
        summarizeAgentLogArchiveStorage(archives.filter((archive) => archive.stream === stream))
      ])
    ) as Record<AgentLogChunk['stream'], ObservabilityAgentLogArchiveStorageMetrics>
  };
}

function summarizeTrafficRollupStorage(rollups: TrafficRollup[]): ObservabilityTrafficRollupStorageMetrics {
  let earliestSampledAtMs: number | undefined;
  let latestSampledAtMs: number | undefined;
  let meteredBytesTotal = 0;

  for (const rollup of rollups) {
    meteredBytesTotal += readPositiveIntegerMetric(rollup.meteredBytes);

    const sampledAtMs = Date.parse(rollup.sampledAt);
    if (Number.isNaN(sampledAtMs)) {
      continue;
    }

    earliestSampledAtMs =
      earliestSampledAtMs === undefined ? sampledAtMs : Math.min(earliestSampledAtMs, sampledAtMs);
    latestSampledAtMs = latestSampledAtMs === undefined ? sampledAtMs : Math.max(latestSampledAtMs, sampledAtMs);
  }

  return {
    retained: rollups.length,
    earliestSampledAt:
      earliestSampledAtMs === undefined ? null : new Date(earliestSampledAtMs).toISOString(),
    latestSampledAt: latestSampledAtMs === undefined ? null : new Date(latestSampledAtMs).toISOString(),
    meteredBytesTotal
  };
}

function summarizeTrafficRollups(rollups: TrafficRollup[]): ObservabilityTrafficRollupMetrics {
  return {
    ...summarizeTrafficRollupStorage(rollups),
    byDimension: Object.fromEntries(
      trafficRollupDimensions.map((dimension) => [
        dimension,
        summarizeTrafficRollupStorage(rollups.filter((rollup) => rollup.dimension === dimension))
      ])
    ) as Record<TrafficRollupDimension, ObservabilityTrafficRollupStorageMetrics>
  };
}

function summarizeTrafficRollupCompactionStorage(
  compactions: TrafficRollupCompaction[]
): ObservabilityTrafficRollupCompactionStorageMetrics {
  let earliestBucketStartAtMs: number | undefined;
  let latestBucketStartAtMs: number | undefined;
  let samples = 0;
  let meteredBytesTotal = 0;

  for (const compaction of compactions) {
    samples += readPositiveIntegerMetric(compaction.sampleCount);
    meteredBytesTotal += readPositiveIntegerMetric(compaction.meteredBytesTotal);

    const bucketStartAtMs = Date.parse(compaction.bucketStartAt);
    if (Number.isNaN(bucketStartAtMs)) {
      continue;
    }

    earliestBucketStartAtMs =
      earliestBucketStartAtMs === undefined
        ? bucketStartAtMs
        : Math.min(earliestBucketStartAtMs, bucketStartAtMs);
    latestBucketStartAtMs =
      latestBucketStartAtMs === undefined
        ? bucketStartAtMs
        : Math.max(latestBucketStartAtMs, bucketStartAtMs);
  }

  return {
    buckets: compactions.length,
    samples,
    earliestBucketStartAt:
      earliestBucketStartAtMs === undefined ? null : new Date(earliestBucketStartAtMs).toISOString(),
    latestBucketStartAt:
      latestBucketStartAtMs === undefined ? null : new Date(latestBucketStartAtMs).toISOString(),
    meteredBytesTotal
  };
}

function summarizeTrafficRollupCompactions(
  compactions: TrafficRollupCompaction[]
): ObservabilityTrafficRollupCompactionMetrics {
  return {
    ...summarizeTrafficRollupCompactionStorage(compactions),
    byDimension: Object.fromEntries(
      trafficRollupDimensions.map((dimension) => [
        dimension,
        summarizeTrafficRollupCompactionStorage(
          compactions.filter((compaction) => compaction.dimension === dimension)
        )
      ])
    ) as Record<TrafficRollupDimension, ObservabilityTrafficRollupCompactionStorageMetrics>
  };
}

function readMetadataModuleKind(task: DeployTask): RuntimeModuleKind | undefined {
  const value = task.metadata?.moduleKind;

  if (typeof value !== 'string') {
    return undefined;
  }

  return runtimeModuleKinds.includes(value as RuntimeModuleKind) ? (value as RuntimeModuleKind) : undefined;
}

function resolveRuntimeApplyModuleKind(task: DeployTask) {
  const metadataModuleKind = readMetadataModuleKind(task);

  if (metadataModuleKind) {
    return metadataModuleKind;
  }

  if (task.operation.startsWith('agent.')) {
    return 'host-agent';
  }

  if (task.operation.startsWith('inbound.')) {
    return 'xray';
  }

  if (task.operation.startsWith('forward.') || task.operation.startsWith('tunnel.')) {
    return 'port-forwarding';
  }

  if (task.operation.startsWith('system.')) {
    return 'bbr';
  }

  return 'unknown';
}

function isDeniedAuditLog(log: AuditLog) {
  return log.action === 'audit.denied' || log.result === 'denied';
}

function isQuotaExceededAuditLog(log: AuditLog) {
  if (!isDeniedAuditLog(log)) {
    return false;
  }

  const normalizedText = [log.denialCode, log.denialReason, log.message]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/[-_.]+/g, ' ');

  return (
    (normalizedText.includes('quota') && normalizedText.includes('exceed')) ||
    normalizedText.includes('over quota') ||
    normalizedText.includes('disabled by quota')
  );
}

export function createObservabilityMetrics(input: ObservabilityMetricsInput): ObservabilityMetrics {
  const runtimeMetrics = normalizeControlPlaneRuntimeObservabilityMetrics(
    input.runtimeMetrics ?? {
      auditWriteFailures: input.auditWriteFailures,
      externalArchiveSinkFailures: input.externalArchiveSinkFailures,
      externalArchiveFailedRecords: input.externalArchiveFailedRecords
    }
  );
  const generatedAtMs = Date.parse(input.generatedAt);
  const nowMs = Number.isNaN(generatedAtMs) ? Date.now() : generatedAtMs;
  const taskStatuses = input.tasks.map((task) => task.status);
  const commandStatuses = input.commandOutbox.map((item) => item.status);
  const agentStatusValues = input.agents.map((agent) => agent.status);
  const alertKinds = input.systemAlerts.map((alert) => alert.kind);
  const alertSeverities = input.systemAlerts.map((alert) => alert.severity);
  const systemAlertNotificationStatuses = input.systemAlertNotificationDeliveries.map((delivery) => delivery.status);
  const telegramNotificationStatuses = input.telegramNotificationDeliveries.map((delivery) => delivery.status);
  const activeTaskStatuses = new Set<DeployTaskStatus>(['queued', 'running', 'retrying']);
  const terminalTaskStatuses = new Set<DeployTaskStatus>(['succeeded', 'failed', 'rolled_back', 'canceled']);
  const terminalTasks = input.tasks.filter((task) => terminalTaskStatuses.has(task.status));
  const runtimeApplyTasks = terminalTasks.filter((task) => runtimeApplyOperations.has(task.operation));
  const deniedAuditLogs = input.auditLogs.filter(isDeniedAuditLog);

  return {
    generatedAt: input.generatedAt,
    tasks: {
      total: input.tasks.length,
      active: input.tasks.filter((task) => activeTaskStatuses.has(task.status)).length,
      failed: input.tasks.filter((task) => task.status === 'failed').length,
      rollbacks: input.tasks.filter((task) => task.status === 'rolled_back' || task.operation === 'agent.rollback').length,
      completionLatencyMs: summarizeLatencyMs(
        terminalTasks.map((task) => readDurationMs(task.createdAt, task.updatedAt))
      ),
      completionLatencyByOperation: summarizeLatencyMsByKey(
        terminalTasks,
        (task) => task.operation,
        (task) => readDurationMs(task.createdAt, task.updatedAt)
      ),
      runtimeApplyLatencyByModule: summarizeLatencyMsByKey(
        runtimeApplyTasks,
        resolveRuntimeApplyModuleKind,
        (task) => readDurationMs(task.createdAt, task.updatedAt)
      ),
      byStatus: countBy(v1ApiBoundary.taskStatuses, taskStatuses)
    },
    commandOutbox: {
      total: input.commandOutbox.length,
      backlog: input.commandOutbox.filter((item) => isActiveCommandOutboxStatus(item.status)).length,
      activeLeases: input.commandOutbox.filter((item) => {
        const leaseExpiresAtMs = item.leaseExpiresAt ? Date.parse(item.leaseExpiresAt) : Number.NaN;
        return isActiveCommandOutboxStatus(item.status) && !Number.isNaN(leaseExpiresAtMs) && leaseExpiresAtMs >= nowMs;
      }).length,
      overdue: input.commandOutbox.filter((item) => {
        const deadlineAtMs = Date.parse(item.deadlineAt);
        return isActiveCommandOutboxStatus(item.status) && !Number.isNaN(deadlineAtMs) && deadlineAtMs < nowMs;
      }).length,
      deadLetters: input.commandOutbox.filter((item) => item.status === 'dead_letter').length,
      ackLatencyMs: summarizeLatencyMs(input.commandOutbox.map((item) => readDurationMs(item.createdAt, item.ackedAt))),
      resultLatencyMs: summarizeLatencyMs(
        input.commandOutbox.map((item) => readDurationMs(item.ackedAt ?? item.createdAt, item.resultAt))
      ),
      byStatus: countBy(commandOutboxStatuses, commandStatuses)
    },
    agents: {
      total: input.agents.length,
      offline: input.agents.filter((agent) => agent.status === 'offline').length,
      degraded: input.agents.filter((agent) => agent.status === 'degraded').length,
      byStatus: countBy(agentStatuses, agentStatusValues)
    },
    systemAlerts: {
      total: input.systemAlerts.length,
      warning: input.systemAlerts.filter((alert) => alert.severity === 'warning').length,
      critical: input.systemAlerts.filter((alert) => alert.severity === 'critical').length,
      byKind: countBy(systemAlertKinds, alertKinds),
      bySeverity: countBy(systemAlertSeverities, alertSeverities)
    },
    systemAlertNotifications: {
      total: input.systemAlertNotificationDeliveries.length,
      pending: input.systemAlertNotificationDeliveries.filter((delivery) => delivery.status === 'pending').length,
      failed: input.systemAlertNotificationDeliveries.filter((delivery) => delivery.status === 'failed').length,
      delivered: input.systemAlertNotificationDeliveries.filter((delivery) => delivery.status === 'delivered').length,
      deadLetters: input.systemAlertNotificationDeliveries.filter((delivery) => delivery.status === 'dead_letter').length,
      overdue: input.systemAlertNotificationDeliveries.filter((delivery) => {
        const nextAttemptAtMs = Date.parse(delivery.nextAttemptAt);
        return (
          (delivery.status === 'pending' || delivery.status === 'failed')
          && !Number.isNaN(nextAttemptAtMs)
          && nextAttemptAtMs <= nowMs
        );
      }).length,
      byStatus: countBy(systemAlertNotificationDeliveryStatuses, systemAlertNotificationStatuses),
      byChannel: summarizeSystemAlertNotificationChannels(input.systemAlertNotificationDeliveries, nowMs)
    },
    telegramNotifications: {
      total: input.telegramNotificationDeliveries.length,
      pending: input.telegramNotificationDeliveries.filter((delivery) => delivery.status === 'pending').length,
      failed: input.telegramNotificationDeliveries.filter((delivery) => delivery.status === 'failed').length,
      delivered: input.telegramNotificationDeliveries.filter((delivery) => delivery.status === 'delivered').length,
      deadLetters: input.telegramNotificationDeliveries.filter((delivery) => delivery.status === 'dead_letter').length,
      suppressed: input.telegramNotificationDeliveries.filter((delivery) => delivery.status === 'suppressed').length,
      overdue: input.telegramNotificationDeliveries.filter((delivery) => {
        const nextAttemptAtMs = Date.parse(delivery.nextAttemptAt);
        return (
          (delivery.status === 'pending' || delivery.status === 'failed')
          && !Number.isNaN(nextAttemptAtMs)
          && nextAttemptAtMs <= nowMs
        );
      }).length,
      byStatus: countBy(telegramNotificationDeliveryStatuses, telegramNotificationStatuses)
    },
    quotaPolicies: summarizeQuotaPolicies(input.quotaPolicies),
    trafficRollups: summarizeTrafficRollups(input.trafficRollups),
    trafficRollupCompactions: summarizeTrafficRollupCompactions(input.trafficRollupCompactions),
    agentLogs: summarizeAgentLogs(input.agentEvents),
    agentLogArchives: summarizeAgentLogArchives(input.agentLogArchives),
    externalArchive: {
      sinkFailures: runtimeMetrics.externalArchiveSinkFailures,
      failedRecords: runtimeMetrics.externalArchiveFailedRecords
    },
    audit: {
      ...input.audit,
      denied: deniedAuditLogs.length,
      quotaExceeded: deniedAuditLogs.filter(isQuotaExceededAuditLog).length,
      writeFailures: runtimeMetrics.auditWriteFailures
    }
  };
}

export interface ControlPlaneApi {
  getApiBoundary(): Promise<ApiBoundaryDescriptor>;
  getObservabilityMetrics(
    externalAlerts?: SystemAlert[],
    runtimeMetrics?: ControlPlaneRuntimeObservabilityMetricsArgument
  ): Promise<ObservabilityMetrics>;
  getAgentLogRetentionPolicy(): Promise<AgentLogRetentionPolicyReadModel>;
  updateAgentLogRetentionPolicy(
    input: AgentLogRetentionPolicyUpdateInput,
    context?: MutationContext
  ): Promise<AgentLogRetentionPolicyReadModel>;
  getTrafficRollupRetentionPolicy(): Promise<TrafficRollupRetentionPolicyReadModel>;
  updateTrafficRollupRetentionPolicy(
    input: TrafficRollupRetentionPolicyUpdateInput,
    context?: MutationContext
  ): Promise<TrafficRollupRetentionPolicyReadModel>;
  listAgents(query?: ListQuery): Promise<Agent[]>;
  listCustomers(query?: ListQuery): Promise<CustomerReadModel[]>;
  listNodes(query?: ListQuery): Promise<ManagedNode[]>;
  listInbounds(query?: ListQuery): Promise<XrayInbound[]>;
  listSubscriptionSources(query?: ListQuery): Promise<SubscriptionSource[]>;
  listSubscriptionInventoryNodes(query?: ListQuery): Promise<SubscriptionInventoryNode[]>;
  listSubscriptionBundles(query?: ListQuery): Promise<SubscriptionBundle[]>;
  listSubscriptionClients(query?: ListQuery): Promise<SubscriptionClientIdentity[]>;
  listSubscriptionExportProfiles(query?: ListQuery): Promise<SubscriptionExportProfile[]>;
  listProxyProviders(query?: ListQuery): Promise<ProxyProviderConfig[]>;
  listSubscriptionExportFiles(query?: ListQuery): Promise<SubscriptionExportFile[]>;
  listForwardRules(query?: ListQuery): Promise<ForwardRule[]>;
  listQuotaPolicies(query?: ListQuery): Promise<QuotaPolicy[]>;
  listRateLimitPolicies(query?: ListQuery): Promise<RateLimitPolicy[]>;
  listPermissionGrants(query?: ListQuery): Promise<PermissionGrant[]>;
  listRoutingPolicies(query?: ListQuery): Promise<RoutingPolicy[]>;
  listTuningProfiles(query?: ListQuery): Promise<TuningProfile[]>;
  listTasks(query?: ListQuery): Promise<DeployTask[]>;
  listCommandOutbox(query?: ListQuery): Promise<CommandOutboxItem[]>;
  listAgentSessions(query?: ListQuery): Promise<AgentSessionSummary[]>;
  listAgentCredentials(query?: ListQuery): Promise<AgentCredentialSummary[]>;
  listOperatorSessions(query?: ListQuery): Promise<OperatorSessionSummary[]>;
  listConfigRevisions(query?: ListQuery): Promise<RuntimeConfigRevision[]>;
  listPreflightPlans(query?: ListQuery): Promise<RuntimePreflightPlan[]>;
  listRuntimeSnapshots(query?: ListQuery): Promise<RuntimeSnapshot[]>;
  listTrafficRollups(query?: TrafficRollupQuery): Promise<TrafficRollup[]>;
  listTrafficRollupCompactions(query?: TrafficRollupCompactionQuery): Promise<TrafficRollupCompaction[]>;
  listSystemAlerts(query?: ListQuery, externalAlerts?: SystemAlert[]): Promise<SystemAlert[]>;
  listAgentLogChunks(query?: AgentLogChunkQuery): Promise<AgentLogChunk[]>;
  listAgentLogArchives(query?: AgentLogArchiveQuery): Promise<AgentLogArchive[]>;
  exportAgentLogChunks(query?: AgentLogExportQuery): Promise<AgentLogExportReadModel>;
  exportAgentLogArchives(query?: AgentLogArchiveExportQuery): Promise<AgentLogArchiveExportReadModel>;
  exportTrafficRollups(query?: TrafficRollupExportQuery): Promise<TrafficRollupExportReadModel>;
  exportTrafficRollupCompactions(
    query?: TrafficRollupCompactionExportQuery
  ): Promise<TrafficRollupCompactionExportReadModel>;
  listAuditLogs(query?: ListQuery): Promise<AuditLog[]>;
  verifyAuditLogChain(logs?: AuditLog[]): Promise<AuditChainVerification>;
  getTelegramBotSettings(): Promise<TelegramBotSettings>;
  updateTelegramBotSettings(
    input: TelegramBotSettingsUpdateInput,
    context?: MutationContext
  ): Promise<TelegramBotSettings>;
  testTelegramBotNotification(
    input: TelegramTestNotificationInput,
    context?: MutationContext
  ): Promise<TelegramNotificationDelivery>;
  listTelegramBindings(query?: ListQuery): Promise<TelegramBindingReadModel[]>;
  createTelegramBinding(
    input: TelegramBindingCreateInput,
    context?: MutationContext
  ): Promise<TelegramBindingReadModel>;
  revokeTelegramBinding(
    bindingId: string,
    input: TelegramBindingRevokeInput,
    context?: MutationContext
  ): Promise<TelegramBindingReadModel>;
  createTelegramBindingChallenge(
    input: TelegramBindingChallengeCreateInput,
    context?: MutationContext
  ): Promise<TelegramBindingChallengeCreateResult>;
  listTelegramBindingChallenges(query?: ListQuery): Promise<TelegramBindingChallenge[]>;
  listTelegramNotificationPolicies(query?: ListQuery): Promise<TelegramNotificationPolicy[]>;
  updateTelegramNotificationPolicy(
    policyId: string,
    input: TelegramNotificationPolicyUpdateInput,
    context?: MutationContext
  ): Promise<TelegramNotificationPolicy>;
  listTelegramNotificationDeliveries(query?: ListQuery): Promise<TelegramNotificationDelivery[]>;
  retryTelegramNotificationDelivery(
    deliveryId: string,
    context?: MutationContext
  ): Promise<TelegramNotificationDelivery>;
  retryTelegramNotificationDeliveries?(
    options?: TelegramNotificationDeliveryRetryOptions
  ): Promise<TelegramNotificationDeliveryRetryResult>;
  scanTelegramNotificationSchedules?(
    options?: TelegramNotificationScheduleScanOptions
  ): Promise<TelegramNotificationScheduleScanResult>;
  handleTelegramWebhookUpdate(
    secretPath: string,
    update: TelegramWebhookUpdate
  ): Promise<TelegramWebhookHandleResult>;
  pollTelegramBotUpdates(context?: MutationContext): Promise<TelegramLongPollingResult>;
  recordAgentRequestDenied(input: AgentRequestDeniedAuditInput): Promise<AuditLog>;
  recordOperatorRequestDenied(input: OperatorRequestDeniedAuditInput): Promise<AuditLog>;
  createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext): Promise<AgentInstallCommand>;
  registerAgent(
    input: AgentRegistrationRequest,
    installToken: string,
    context?: Pick<MutationContext, 'sourceIp' | 'userAgent'>
  ): Promise<AgentRuntimeCredential>;
  revokeAgentCredential(
    credentialId: string,
    input: AgentCredentialRevokeRequest,
    context?: MutationContext
  ): Promise<AgentCredentialSummary>;
  revokeOperatorSession(
    sessionId: string,
    input: OperatorSessionRevokeRequest,
    context?: MutationContext
  ): Promise<OperatorSessionSummary>;
  rotateAgentCredential(
    credentialId: string,
    input: AgentCredentialRotateRequest,
    context?: MutationContext
  ): Promise<AgentRuntimeCredential>;
  resetQuotaPolicy(policyId: string, context?: MutationContext): Promise<DeployTask>;
  createTask(input: CreateTaskInput, context?: MutationContext): Promise<DeployTask>;
  syncSubscriptionSource(sourceId: string, context?: MutationContext): Promise<SubscriptionSourceSyncResult>;
  transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext): Promise<DeployTask>;
  issueAgentCommand(
    agentId: string,
    command: AgentCommandEnvelope,
    context?: MutationContext
  ): Promise<CommandOutboxItem>;
  leaseAgentCommands(agentId: string, options: AgentCommandLeaseOptions): Promise<CommandOutboxItem[]>;
  sweepCommandTimeouts(options: CommandTimeoutSweepOptions): Promise<CommandTimeoutSweepResult>;
  retrySystemAlertNotifications?(
    options: SystemAlertNotificationRetryOptions
  ): Promise<SystemAlertNotificationRetryResult>;
  receiveAgentEvent(event: AgentEventEnvelope): Promise<DeployTask | undefined>;
}
