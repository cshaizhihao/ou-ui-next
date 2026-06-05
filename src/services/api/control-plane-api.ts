import type {
  Agent,
  AgentStatus,
  AgentCredentialRevokeRequest,
  AgentCredentialRotateRequest,
  AgentCredentialSummary,
  AgentInstallCommand,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentRuntimeCredential,
  AuditLog,
  CreateTaskInput,
  DeployTask,
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
  SystemAlertSeverity,
  TrafficRollup,
  TuningProfile,
  XrayInbound
} from '../../domain';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';

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

export type AgentRequestDeniedAuditInput = {
  endpoint: 'poll' | 'events';
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

export type AuditChainVerification = {
  valid: boolean;
  checked: number;
  brokenAt?: string;
  reason?: 'hash.mismatch' | 'prev_hash.mismatch';
};

export type ObservabilityAuditMetrics = AuditChainVerification & {
  denied: number;
  quotaExceeded: number;
};

export type ObservabilityLatencySummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type ObservabilityMetrics = {
  generatedAt: string;
  tasks: {
    total: number;
    active: number;
    failed: number;
    rollbacks: number;
    completionLatencyMs: ObservabilityLatencySummary;
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
    bySeverity: Record<SystemAlertSeverity, number>;
  };
  audit: ObservabilityAuditMetrics;
};

type ObservabilityMetricsInput = {
  generatedAt: string;
  tasks: DeployTask[];
  commandOutbox: CommandOutboxItem[];
  agents: Agent[];
  systemAlerts: SystemAlert[];
  audit: AuditChainVerification;
  auditLogs: AuditLog[];
};

function readLogChunkLimit(query: AgentLogChunkQuery | undefined) {
  const requested = query?.limit ?? query?.pageSize ?? 200;
  const normalized = Number.isFinite(requested) ? Math.round(requested) : 200;
  return Math.min(Math.max(normalized, 1), 1000);
}

export function selectAgentLogChunks(
  events: AgentEventEnvelope[],
  query: AgentLogChunkQuery = {}
): AgentLogChunk[] {
  const sinceMs = query.since ? Date.parse(query.since) : undefined;
  const limit = readLogChunkLimit(query);

  return events
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
    })
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
const systemAlertSeverities: SystemAlertSeverity[] = ['warning', 'critical'];

function countBy<T extends string>(values: readonly T[], items: T[]) {
  return Object.fromEntries(values.map((value) => [value, items.filter((item) => item === value).length])) as Record<
    T,
    number
  >;
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

function summarizeLatencyMs(values: Array<number | undefined>): ObservabilityLatencySummary {
  const sorted = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0
    };
  }

  const percentile = (ratio: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
  };

  return {
    count: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0
  };
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
  const generatedAtMs = Date.parse(input.generatedAt);
  const nowMs = Number.isNaN(generatedAtMs) ? Date.now() : generatedAtMs;
  const taskStatuses = input.tasks.map((task) => task.status);
  const commandStatuses = input.commandOutbox.map((item) => item.status);
  const agentStatusValues = input.agents.map((agent) => agent.status);
  const alertSeverities = input.systemAlerts.map((alert) => alert.severity);
  const activeTaskStatuses = new Set<DeployTaskStatus>(['queued', 'running', 'retrying']);
  const terminalTaskStatuses = new Set<DeployTaskStatus>(['succeeded', 'failed', 'rolled_back', 'canceled']);
  const deniedAuditLogs = input.auditLogs.filter(isDeniedAuditLog);

  return {
    generatedAt: input.generatedAt,
    tasks: {
      total: input.tasks.length,
      active: input.tasks.filter((task) => activeTaskStatuses.has(task.status)).length,
      failed: input.tasks.filter((task) => task.status === 'failed').length,
      rollbacks: input.tasks.filter((task) => task.status === 'rolled_back' || task.operation === 'agent.rollback').length,
      completionLatencyMs: summarizeLatencyMs(
        input.tasks
          .filter((task) => terminalTaskStatuses.has(task.status))
          .map((task) => readDurationMs(task.createdAt, task.updatedAt))
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
      bySeverity: countBy(systemAlertSeverities, alertSeverities)
    },
    audit: {
      ...input.audit,
      denied: deniedAuditLogs.length,
      quotaExceeded: deniedAuditLogs.filter(isQuotaExceededAuditLog).length
    }
  };
}

export interface ControlPlaneApi {
  getApiBoundary(): Promise<ApiBoundaryDescriptor>;
  getObservabilityMetrics(): Promise<ObservabilityMetrics>;
  listAgents(query?: ListQuery): Promise<Agent[]>;
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
  listAgentCredentials(query?: ListQuery): Promise<AgentCredentialSummary[]>;
  listOperatorSessions(query?: ListQuery): Promise<OperatorSessionSummary[]>;
  listConfigRevisions(query?: ListQuery): Promise<RuntimeConfigRevision[]>;
  listPreflightPlans(query?: ListQuery): Promise<RuntimePreflightPlan[]>;
  listRuntimeSnapshots(query?: ListQuery): Promise<RuntimeSnapshot[]>;
  listTrafficRollups(query?: ListQuery): Promise<TrafficRollup[]>;
  listSystemAlerts(query?: ListQuery): Promise<SystemAlert[]>;
  listAgentLogChunks(query?: AgentLogChunkQuery): Promise<AgentLogChunk[]>;
  listAuditLogs(query?: ListQuery): Promise<AuditLog[]>;
  verifyAuditLogChain(logs?: AuditLog[]): Promise<AuditChainVerification>;
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
  receiveAgentEvent(event: AgentEventEnvelope): Promise<DeployTask | undefined>;
}
