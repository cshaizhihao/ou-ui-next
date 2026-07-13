import type {
  Agent,
  AgentCredentialRevokeRequest,
  AgentCredentialRotateRequest,
  AgentCredentialSummary,
  AgentInstallCommand,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentRuntimeCredential,
  AgentUpgradeCommand,
  AgentUpgradeCommandRequest,
  AgentSessionSummary,
  AuditLog,
  CreateTaskInput,
  CustomerReadModel,
  DeployTask,
  DeployTaskStatus,
  ForwardRule,
  ManagedNode,
  OperatorSessionRevokeRequest,
  OperatorSessionSummary,
  PermissionGrant,
  ProxyProviderConfig,
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
  SubscriptionSource,
  SubscriptionSourceSyncResult,
  SystemAlert,
  TaskOperationReceipt,
  TelegramBindingChallenge,
  TelegramBindingChallengeCreateResult,
  TelegramBindingReadModel,
  TelegramBotSettings,
  TelegramLongPollingResult,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy,
  TrafficRollup,
  TrafficRollupCompaction,
  AgentLogArchive,
  TuningProfile,
  XrayInbound
} from '../../domain';
import type { AgentEventEnvelope } from './api-contract';
import type {
  AgentLogChunk,
  AgentLogArchiveExportQuery,
  AgentLogArchiveExportReadModel,
  AgentLogArchiveQuery,
  AgentLogExportQuery,
  AgentLogExportReadModel,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput,
  AgentLogChunkQuery,
  ApiBoundaryDescriptor,
  AuditChainVerification,
  CommandOutboxItem,
  ControlPlaneApi,
  ControlPlaneSnapshotReadModel,
  ListQuery,
  MutationContext,
  ObservabilityMetrics,
  TrafficRollupCompactionExportQuery,
  TrafficRollupCompactionExportReadModel,
  TrafficRollupCompactionQuery,
  TrafficRollupExportQuery,
  TrafficRollupExportReadModel,
  TrafficRollupQuery,
  TrafficRollupRetentionPolicyReadModel,
  TrafficRollupRetentionPolicyUpdateInput
} from './control-plane-api';

function createListPath(path: string, query?: ListQuery) {
  const params = new URLSearchParams();
  if (query?.page !== undefined) params.set('page', String(query.page));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query?.search) params.set('search', query.search);
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

type HttpControlPlaneClientOptions = {
  baseUrl: string;
  defaultAgentId?: string;
  operatorBearerToken?: string;
  agentBearerToken?: string;
  getCsrfToken?: () => string | undefined;
  fetcher?: typeof fetch;
};

type ResponseEnvelope<T> = {
  data: T;
  requestId: string;
  taskId?: string;
  warnings?: string[];
};

type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
};

type HttpMethod = 'GET' | 'POST' | 'PATCH';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  context?: MutationContext;
  bearerToken?: string;
};

export class HttpControlPlaneClientError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = 'HttpControlPlaneClientError';
    this.code = envelope.error.code;
    this.status = status;
    this.requestId = envelope.requestId;
    this.details = envelope.error.details;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function createStableHeaderHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function createAsciiHeaderIdentifier(value: string | undefined, fallbackPrefix: string, maxLength = 180) {
  const trimmed = value?.trim() ?? '';
  const sanitized = trimmed
    .replace(/[^\x20-\x7e]+/g, '-')
    .replace(/[^A-Za-z0-9._~:/@+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (sanitized && sanitized === trimmed && sanitized.length <= maxLength) {
    return sanitized;
  }

  const hash = createStableHeaderHash(trimmed);
  const prefixBudget = Math.max(1, maxLength - hash.length - 1);
  const prefix = (sanitized || fallbackPrefix).slice(0, prefixBudget).replace(/-$/g, '') || fallbackPrefix;

  return `${prefix}-${hash}`;
}

function createAsciiHeaderText(value: string, fallbackPrefix: string, maxLength = 180) {
  const sanitized = value
    .trim()
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized && sanitized === value.trim() && sanitized.length <= maxLength) {
    return sanitized;
  }

  const suffix = createStableHeaderHash(value);
  const prefixBudget = Math.max(1, maxLength - suffix.length - 1);
  const prefix = (sanitized || fallbackPrefix).slice(0, prefixBudget).trim() || fallbackPrefix;

  return `${prefix}-${suffix}`;
}

function createMutationHeaders(context?: MutationContext) {
  const headers: Record<string, string> = {};

  if (!context) {
    return headers;
  }

  headers['X-Actor'] = createAsciiHeaderIdentifier(context.actor, 'operator');
  headers['X-Request-Id'] = createAsciiHeaderIdentifier(context.requestId, 'req');
  headers['X-Forwarded-For'] = createAsciiHeaderIdentifier(context.sourceIp, 'ui');

  if (context.operatorGroupId) {
    headers['X-Operator-Group-Id'] = createAsciiHeaderIdentifier(context.operatorGroupId, 'operator-group');
  }
  if (context.resourceGroupId) {
    headers['X-Resource-Group-Id'] = createAsciiHeaderIdentifier(context.resourceGroupId, 'resource-group');
  }
  if (context.userAgent) {
    headers['User-Agent'] = createAsciiHeaderText(context.userAgent, 'ou-ui-next');
  }
  if (context.idempotencyKey) {
    headers['Idempotency-Key'] = createAsciiHeaderIdentifier(context.idempotencyKey, 'idem');
  }
  if (context.ifMatch) {
    headers['If-Match'] = createAsciiHeaderIdentifier(context.ifMatch, 'version');
  }

  return headers;
}

function createAuthorizationHeaders(path: string, options: HttpControlPlaneClientOptions): Record<string, string> {
  const token = path.startsWith('/agent/v1/') ? options.agentBearerToken : options.operatorBearerToken;

  return token
    ? {
        Authorization: `Bearer ${token}`
      }
    : {};
}

function createCsrfHeaders(
  path: string,
  method: HttpMethod,
  options: HttpControlPlaneClientOptions
): Record<string, string> {
  if (method === 'GET' || path.startsWith('/agent/v1/')) {
    return {};
  }

  const csrfToken = options.getCsrfToken?.();

  return csrfToken
    ? {
        'X-CSRF-Token': csrfToken
      }
    : {};
}

function createAgentLogChunkPath(query: AgentLogChunkQuery | AgentLogExportQuery | undefined, exportMode = false) {
  const params = new URLSearchParams();
  const exportQuery = query as AgentLogExportQuery | undefined;

  if (query?.agentId) params.set('agentId', query.agentId);
  if (query?.taskId) params.set('taskId', query.taskId);
  if (query?.commandId) params.set('commandId', query.commandId);
  if (query?.since) params.set('since', query.since);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (exportQuery?.format) params.set('format', exportQuery.format);

  const queryString = params.toString();
  const path = exportMode ? '/api/v1/agent-log-chunks:export' : '/api/v1/agent-log-chunks';
  return queryString ? `${path}?${queryString}` : path;
}

function createAgentLogArchivePath(
  query: AgentLogArchiveQuery | AgentLogArchiveExportQuery | undefined,
  exportMode = false
) {
  const params = new URLSearchParams();
  const exportQuery = query as AgentLogArchiveExportQuery | undefined;

  if (query?.agentId) params.set('agentId', query.agentId);
  if (query?.taskId) params.set('taskId', query.taskId);
  if (query?.commandId) params.set('commandId', query.commandId);
  if (query?.stream) params.set('stream', query.stream);
  if (query?.since) params.set('since', query.since);
  if (query?.until) params.set('until', query.until);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (exportQuery?.format) params.set('format', exportQuery.format);

  const queryString = params.toString();
  const path = exportMode ? '/api/v1/agent-log-archives:export' : '/api/v1/agent-log-archives';
  return queryString ? `${path}?${queryString}` : path;
}

function createTrafficRollupPath(query: TrafficRollupQuery | TrafficRollupExportQuery | undefined, exportMode = false) {
  const params = new URLSearchParams();
  const exportQuery = query as TrafficRollupExportQuery | undefined;

  if (query?.dimension) params.set('dimension', query.dimension);
  if (query?.agentId) params.set('agentId', query.agentId);
  if (query?.subjectId) params.set('subjectId', query.subjectId);
  if (query?.since) params.set('since', query.since);
  if (query?.until) params.set('until', query.until);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (exportQuery?.format) params.set('format', exportQuery.format);

  const queryString = params.toString();
  const path = exportMode ? '/api/v1/traffic-rollups:export' : '/api/v1/traffic-rollups';
  return queryString ? `${path}?${queryString}` : path;
}

function createTrafficRollupCompactionPath(
  query: TrafficRollupCompactionQuery | TrafficRollupCompactionExportQuery | undefined,
  exportMode = false
) {
  const params = new URLSearchParams();
  const exportQuery = query as TrafficRollupCompactionExportQuery | undefined;

  if (query?.dimension) params.set('dimension', query.dimension);
  if (query?.agentId) params.set('agentId', query.agentId);
  if (query?.subjectId) params.set('subjectId', query.subjectId);
  if (query?.periodKey) params.set('periodKey', query.periodKey);
  if (query?.since) params.set('since', query.since);
  if (query?.until) params.set('until', query.until);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (exportQuery?.format) params.set('format', exportQuery.format);

  const queryString = params.toString();
  const path = exportMode ? '/api/v1/traffic-rollup-compactions:export' : '/api/v1/traffic-rollup-compactions';
  return queryString ? `${path}?${queryString}` : path;
}

function hasErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return Boolean(value && typeof value === 'object' && 'error' in value && 'requestId' in value);
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export function createHttpControlPlaneClient(options: HttpControlPlaneClientOptions): ControlPlaneApi {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const clientOptions = options;

  async function request<T>(path: string, options?: RequestOptions): Promise<T> {
    const method = options?.method ?? 'GET';
    const headers: Record<string, string> = {};

    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    Object.assign(
      headers,
      options?.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : createAuthorizationHeaders(path, clientOptions),
      createCsrfHeaders(path, method, clientOptions),
      createMutationHeaders(options?.context)
    );

    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options?.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await readJson(response);

    if (!response.ok) {
      if (hasErrorEnvelope(payload)) {
        throw new HttpControlPlaneClientError(response.status, payload);
      }

      throw new Error(`HTTP control-plane request failed: ${response.status} ${response.statusText}`);
    }

    return (payload as ResponseEnvelope<T>).data;
  }

  async function getSnapshot() {
    return request<ControlPlaneSnapshotReadModel>('/api/v1/snapshot');
  }

  return {
    getSnapshot,
    getApiBoundary: () => request<ApiBoundaryDescriptor>('/api/v1/boundary'),
    getObservabilityMetrics: () => request<ObservabilityMetrics>('/api/v1/observability-metrics'),
    getAgentLogRetentionPolicy: () => request<AgentLogRetentionPolicyReadModel>('/api/v1/agent-log-retention-policy'),
    updateAgentLogRetentionPolicy: (input: AgentLogRetentionPolicyUpdateInput, context) =>
      request<AgentLogRetentionPolicyReadModel>('/api/v1/agent-log-retention-policy', {
        method: 'PATCH',
        body: input,
        context
      }),
    getTrafficRollupRetentionPolicy: () =>
      request<TrafficRollupRetentionPolicyReadModel>('/api/v1/traffic-rollup-retention-policy'),
    updateTrafficRollupRetentionPolicy: (input: TrafficRollupRetentionPolicyUpdateInput, context) =>
      request<TrafficRollupRetentionPolicyReadModel>('/api/v1/traffic-rollup-retention-policy', {
        method: 'PATCH',
        body: input,
        context
      }),
    listAgents: (query) => request<Agent[]>(createListPath('/api/v1/agents', query)),
    listCustomers: (query) => request<CustomerReadModel[]>(createListPath('/api/v1/customers', query)),
    listNodes: (query) => request<ManagedNode[]>(createListPath('/api/v1/nodes', query)),
    listInbounds: (query) => request<XrayInbound[]>(createListPath('/api/v1/inbounds', query)),
    listSubscriptionSources: (query) =>
      request<SubscriptionSource[]>(createListPath('/api/v1/subscription-sources', query)),
    listSubscriptionInventoryNodes: (query) =>
      request<SubscriptionInventoryNode[]>(createListPath('/api/v1/subscription-nodes', query)),
    listSubscriptionBundles: (query) =>
      request<SubscriptionBundle[]>(createListPath('/api/v1/subscription-bundles', query)),
    listSubscriptionClients: (query) =>
      request<SubscriptionClientIdentity[]>(createListPath('/api/v1/subscription-clients', query)),
    listSubscriptionExportProfiles: (query) =>
      request<SubscriptionExportProfile[]>(createListPath('/api/v1/subscription-export-profiles', query)),
    listProxyProviders: (query) => request<ProxyProviderConfig[]>(createListPath('/api/v1/proxy-providers', query)),
    listSubscriptionExportFiles: (query) =>
      request<SubscriptionExportFile[]>(createListPath('/api/v1/subscription-export-files', query)),
    listForwardRules: (query) => request<ForwardRule[]>(createListPath('/api/v1/forward-rules', query)),
    listQuotaPolicies: (query) => request<QuotaPolicy[]>(createListPath('/api/v1/quota-policies', query)),
    listRateLimitPolicies: (query) =>
      request<RateLimitPolicy[]>(createListPath('/api/v1/rate-limit-policies', query)),
    listPermissionGrants: (query) =>
      request<PermissionGrant[]>(createListPath('/api/v1/permission-grants', query)),
    listRoutingPolicies: (query) => request<RoutingPolicy[]>(createListPath('/api/v1/routing-policies', query)),
    listTuningProfiles: (query) => request<TuningProfile[]>(createListPath('/api/v1/tuning-profiles', query)),
    listTasks: (query) => request<DeployTask[]>(createListPath('/api/v1/tasks', query)),
    listCommandOutbox: async () => {
      if (clientOptions.defaultAgentId) {
        return request<{ commands: CommandOutboxItem[]; nextPollAfterMs: number }>('/agent/v1/poll', {
          method: 'POST',
          body: {
            agentId: clientOptions.defaultAgentId,
            requestId: `req-agent-poll-${clientOptions.defaultAgentId}`
          }
        }).then((pollResult) => pollResult.commands);
      }

      return request<CommandOutboxItem[]>('/api/v1/command-outbox');
    },
    listAgentSessions: () => request<AgentSessionSummary[]>('/api/v1/agent-sessions'),
    listAgentCredentials: () => request<AgentCredentialSummary[]>('/api/v1/agent-credentials'),
    listOperatorSessions: () => request<OperatorSessionSummary[]>('/api/v1/operator-sessions'),
    listConfigRevisions: () => request<RuntimeConfigRevision[]>('/api/v1/config-revisions'),
    listPreflightPlans: () => request<RuntimePreflightPlan[]>('/api/v1/preflight-plans'),
    listRuntimeSnapshots: () => request<RuntimeSnapshot[]>('/api/v1/runtime-snapshots'),
    listTrafficRollups: (query) => request<TrafficRollup[]>(createTrafficRollupPath(query)),
    listTrafficRollupCompactions: (query) =>
      request<TrafficRollupCompaction[]>(createTrafficRollupCompactionPath(query)),
    listSystemAlerts: () => request<SystemAlert[]>('/api/v1/system-alerts'),
    listAgentLogChunks: (query) => request<AgentLogChunk[]>(createAgentLogChunkPath(query)),
    listAgentLogArchives: (query) => request<AgentLogArchive[]>(createAgentLogArchivePath(query)),
    exportAgentLogChunks: (query) =>
      request<AgentLogExportReadModel>(createAgentLogChunkPath(query, true)),
    exportAgentLogArchives: (query) =>
      request<AgentLogArchiveExportReadModel>(createAgentLogArchivePath(query, true)),
    exportTrafficRollups: (query) =>
      request<TrafficRollupExportReadModel>(createTrafficRollupPath(query, true)),
    exportTrafficRollupCompactions: (query) =>
      request<TrafficRollupCompactionExportReadModel>(createTrafficRollupCompactionPath(query, true)),
    listAuditLogs: () => request<AuditLog[]>('/api/v1/audit-logs'),
    verifyAuditLogChain: (logs?: AuditLog[]) =>
      logs
        ? request<AuditChainVerification>('/api/v1/audit-logs:verify', {
            method: 'POST',
            body: {
              auditLogs: logs
            }
          })
        : request<AuditChainVerification>('/api/v1/audit-logs:verify'),
    getTelegramBotSettings: () =>
      request<TelegramBotSettings>('/api/v1/integrations/telegram-bot/settings'),
    updateTelegramBotSettings: (input, context) =>
      request<TelegramBotSettings>('/api/v1/integrations/telegram-bot/settings', {
        method: 'PATCH',
        body: input,
        context
      }),
    testTelegramBotNotification: (input, context) =>
      request<TelegramNotificationDelivery>('/api/v1/integrations/telegram-bot/test', {
        method: 'POST',
        body: input,
        context
      }),
    listTelegramBindings: () => request<TelegramBindingReadModel[]>('/api/v1/telegram-bindings'),
    createTelegramBinding: (input, context) =>
      request<TelegramBindingReadModel>('/api/v1/telegram-bindings', {
        method: 'POST',
        body: input,
        context
      }),
    revokeTelegramBinding: (bindingId, input, context) =>
      request<TelegramBindingReadModel>(`/api/v1/telegram-bindings/${encodeURIComponent(bindingId)}/revoke`, {
        method: 'POST',
        body: input,
        context
      }),
    createTelegramBindingChallenge: (input, context) =>
      request<TelegramBindingChallengeCreateResult>('/api/v1/telegram-binding-challenges', {
        method: 'POST',
        body: input,
        context
      }),
    listTelegramBindingChallenges: () =>
      request<TelegramBindingChallenge[]>('/api/v1/telegram-binding-challenges'),
    listTelegramNotificationPolicies: () =>
      request<TelegramNotificationPolicy[]>('/api/v1/telegram-notification-policies'),
    updateTelegramNotificationPolicy: (policyId, input, context) =>
      request<TelegramNotificationPolicy>(`/api/v1/telegram-notification-policies/${encodeURIComponent(policyId)}`, {
        method: 'PATCH',
        body: input,
        context
      }),
    listTelegramNotificationDeliveries: () =>
      request<TelegramNotificationDelivery[]>('/api/v1/telegram-notification-deliveries'),
    retryTelegramNotificationDelivery: (deliveryId, context) =>
      request<TelegramNotificationDelivery>(
        `/api/v1/telegram-notification-deliveries/${encodeURIComponent(deliveryId)}/retry`,
        {
          method: 'POST',
          context
        }
      ),
    handleTelegramWebhookUpdate: async () => {
      throw new Error('handleTelegramWebhookUpdate is server-only');
    },
    pollTelegramBotUpdates: (context) =>
      request<TelegramLongPollingResult>('/api/v1/integrations/telegram-bot/poll', {
        method: 'POST',
        context
      }),
    recordAgentRequestDenied: async () => {
      throw new Error('recordAgentRequestDenied is server-only');
    },
    recordOperatorRequestDenied: async () => {
      throw new Error('recordOperatorRequestDenied is server-only');
    },
    createAgentInstallCommand: (input: AgentInstallCommandRequest, context?: MutationContext) =>
      request<AgentInstallCommand>('/api/v1/agents/install-command', {
        method: 'POST',
        body: input,
        context
      }),
    createAgentUpgradeCommand: (input: AgentUpgradeCommandRequest, context?: MutationContext) =>
      request<AgentUpgradeCommand>(`/api/v1/agents/${encodeURIComponent(input.agentId)}/upgrade-command`, {
        method: 'POST',
        body: input,
        context
      }),
    registerAgent: (input: AgentRegistrationRequest, installToken) =>
      request<AgentRuntimeCredential>('/agent/v1/register', {
        method: 'POST',
        body: input,
        bearerToken: installToken
      }),
    revokeAgentCredential: (credentialId: string, input: AgentCredentialRevokeRequest, context?: MutationContext) =>
      request<AgentCredentialSummary>(`/api/v1/agent-credentials/${encodeURIComponent(credentialId)}/revoke`, {
        method: 'POST',
        body: input,
        context
      }),
    revokeOperatorSession: (sessionId: string, input: OperatorSessionRevokeRequest, context?: MutationContext) =>
      request<OperatorSessionSummary>(`/api/v1/operator-sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: 'POST',
        body: input,
        context
      }),
    rotateAgentCredential: (credentialId: string, input: AgentCredentialRotateRequest, context?: MutationContext) =>
      request<AgentRuntimeCredential>(`/api/v1/agent-credentials/${encodeURIComponent(credentialId)}/rotate`, {
        method: 'POST',
        body: input,
        context
      }),
    resetQuotaPolicy: (policyId: string, context?: MutationContext) =>
      request<DeployTask>(`/api/v1/quota-policies/${encodeURIComponent(policyId)}/reset`, {
        method: 'POST',
        context
      }),
    applyXrayClientAction: (input, context?: MutationContext) =>
      request<DeployTask>('/api/v1/xray-client-actions', {
        method: 'POST',
        body: input,
        context
      }),
    executeTaskOperation: (input, context?: MutationContext) =>
      request<TaskOperationReceipt>('/api/v1/operations', {
        method: 'POST',
        body: input,
        context
      }),
    executeXrayClientSubscriptionOperation: (input, context?: MutationContext) =>
      request<TaskOperationReceipt>('/api/v1/operations', {
        method: 'POST',
        body: input,
        context
      }),
    createTask: (input: CreateTaskInput, context?: MutationContext) =>
      request<DeployTask>('/api/v1/tasks', {
        method: 'POST',
        body: input,
        context
      }),
    syncSubscriptionSource: (sourceId: string, context?: MutationContext) =>
      request<SubscriptionSourceSyncResult>(`/api/v1/subscription-sources/${encodeURIComponent(sourceId)}/sync`, {
        method: 'POST',
        context
      }),
    transitionTask: (taskId: string, status: DeployTaskStatus, context?: MutationContext) =>
      request<DeployTask>(`/api/v1/tasks/${encodeURIComponent(taskId)}/transition`, {
        method: 'POST',
        body: { status },
        context
      }),
    issueAgentCommand: (agentId: string, command, context?: MutationContext) =>
      request<CommandOutboxItem>(`/api/v1/agents/${encodeURIComponent(agentId)}/commands`, {
        method: 'POST',
        body: command,
        context
      }),
    leaseAgentCommands: (agentId, leaseOptions) =>
      request<{ commands: CommandOutboxItem[]; nextPollAfterMs: number }>('/agent/v1/poll', {
        method: 'POST',
        body: {
          agentId,
          requestId: leaseOptions.requestId,
          sessionId: leaseOptions.sessionId,
          lastSeenCommandSeq: leaseOptions.lastSeenCommandSeq
        }
      }).then((pollResult) => pollResult.commands),
    sweepCommandTimeouts: (options) =>
      request('/api/v1/command-outbox:sweep-timeouts', {
        method: 'POST',
        body: {
          now: options.now,
          ackTimeoutMs: options.ackTimeoutMs,
          resultTimeoutMs: options.resultTimeoutMs,
          maxCommands: options.maxCommands
        },
        context: {
          actor: 'system:command-timeout-sweeper',
          sourceIp: '127.0.0.1',
          requestId: options.requestId
        }
      }),
    receiveAgentEvent: async (event: AgentEventEnvelope) => {
      await request<{ accepted: number; rejected: number }>('/agent/v1/events', {
        method: 'POST',
        body: {
          events: [event]
        }
      });

      const snapshot = await getSnapshot();
      return snapshot.tasks.find((task) => task.id === ('taskId' in event ? event.taskId : ''));
    }
  };
}
