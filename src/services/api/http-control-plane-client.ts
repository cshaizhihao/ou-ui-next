import type {
  Agent,
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
  TrafficRollup,
  TuningProfile,
  XrayInbound
} from '../../domain';
import type { AgentEventEnvelope } from './api-contract';
import type {
  AgentLogChunk,
  AgentLogChunkQuery,
  ApiBoundaryDescriptor,
  AuditChainVerification,
  CommandOutboxItem,
  ControlPlaneApi,
  MutationContext,
  ObservabilityMetrics
} from './control-plane-api';

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

type HttpMethod = 'GET' | 'POST';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  context?: MutationContext;
  bearerToken?: string;
};

type ControlPlaneSnapshot = {
  apiBoundary: ApiBoundaryDescriptor;
  agents: Agent[];
  nodes: ManagedNode[];
  inbounds: XrayInbound[];
  subscriptionSources: SubscriptionSource[];
  subscriptionInventoryNodes: SubscriptionInventoryNode[];
  subscriptionBundles: SubscriptionBundle[];
  subscriptionClients: SubscriptionClientIdentity[];
  subscriptionExportProfiles: SubscriptionExportProfile[];
  proxyProviders: ProxyProviderConfig[];
  subscriptionExportFiles: SubscriptionExportFile[];
  forwardRules: ForwardRule[];
  quotaPolicies: QuotaPolicy[];
  rateLimitPolicies: RateLimitPolicy[];
  permissionGrants: PermissionGrant[];
  routingPolicies: RoutingPolicy[];
  tuningProfiles: TuningProfile[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
  systemAlerts: SystemAlert[];
  agentCredentials: AgentCredentialSummary[];
  tasks: DeployTask[];
  auditLogs: AuditLog[];
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

function createMutationHeaders(context?: MutationContext) {
  const headers: Record<string, string> = {};

  if (!context) {
    return headers;
  }

  headers['X-Actor'] = context.actor;
  headers['X-Request-Id'] = context.requestId;
  headers['X-Forwarded-For'] = context.sourceIp;

  if (context.operatorGroupId) headers['X-Operator-Group-Id'] = context.operatorGroupId;
  if (context.resourceGroupId) headers['X-Resource-Group-Id'] = context.resourceGroupId;
  if (context.userAgent) headers['User-Agent'] = context.userAgent;
  if (context.idempotencyKey) headers['Idempotency-Key'] = context.idempotencyKey;
  if (context.ifMatch) headers['If-Match'] = context.ifMatch;

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

function createAgentLogChunkPath(query: AgentLogChunkQuery | undefined) {
  const params = new URLSearchParams();

  if (query?.agentId) params.set('agentId', query.agentId);
  if (query?.taskId) params.set('taskId', query.taskId);
  if (query?.commandId) params.set('commandId', query.commandId);
  if (query?.since) params.set('since', query.since);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.pageSize !== undefined) params.set('pageSize', String(query.pageSize));

  const queryString = params.toString();
  return queryString ? `/api/v1/agent-log-chunks?${queryString}` : '/api/v1/agent-log-chunks';
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
    return request<ControlPlaneSnapshot>('/api/v1/snapshot');
  }

  return {
    getApiBoundary: () => request<ApiBoundaryDescriptor>('/api/v1/boundary'),
    getObservabilityMetrics: () => request<ObservabilityMetrics>('/api/v1/observability-metrics'),
    listAgents: () => request<Agent[]>('/api/v1/agents'),
    listNodes: () => request<ManagedNode[]>('/api/v1/nodes'),
    listInbounds: () => request<XrayInbound[]>('/api/v1/inbounds'),
    listSubscriptionSources: () => request<SubscriptionSource[]>('/api/v1/subscription-sources'),
    listSubscriptionInventoryNodes: () => request<SubscriptionInventoryNode[]>('/api/v1/subscription-nodes'),
    listSubscriptionBundles: () => request<SubscriptionBundle[]>('/api/v1/subscription-bundles'),
    listSubscriptionClients: () => request<SubscriptionClientIdentity[]>('/api/v1/subscription-clients'),
    listSubscriptionExportProfiles: () => request<SubscriptionExportProfile[]>('/api/v1/subscription-export-profiles'),
    listProxyProviders: () => request<ProxyProviderConfig[]>('/api/v1/proxy-providers'),
    listSubscriptionExportFiles: () => request<SubscriptionExportFile[]>('/api/v1/subscription-export-files'),
    listForwardRules: () => request<ForwardRule[]>('/api/v1/forward-rules'),
    listQuotaPolicies: () => request<QuotaPolicy[]>('/api/v1/quota-policies'),
    listRateLimitPolicies: () => request<RateLimitPolicy[]>('/api/v1/rate-limit-policies'),
    listPermissionGrants: () => request<PermissionGrant[]>('/api/v1/permission-grants'),
    listRoutingPolicies: () => request<RoutingPolicy[]>('/api/v1/routing-policies'),
    listTuningProfiles: () => request<TuningProfile[]>('/api/v1/tuning-profiles'),
    listTasks: () => request<DeployTask[]>('/api/v1/tasks'),
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
    listAgentCredentials: () => request<AgentCredentialSummary[]>('/api/v1/agent-credentials'),
    listConfigRevisions: () => request<RuntimeConfigRevision[]>('/api/v1/config-revisions'),
    listPreflightPlans: () => request<RuntimePreflightPlan[]>('/api/v1/preflight-plans'),
    listRuntimeSnapshots: () => request<RuntimeSnapshot[]>('/api/v1/runtime-snapshots'),
    listTrafficRollups: () => request<TrafficRollup[]>('/api/v1/traffic-rollups'),
    listSystemAlerts: () => request<SystemAlert[]>('/api/v1/system-alerts'),
    listAgentLogChunks: (query) => request<AgentLogChunk[]>(createAgentLogChunkPath(query)),
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
    rotateAgentCredential: (credentialId: string, input: AgentCredentialRotateRequest, context?: MutationContext) =>
      request<AgentRuntimeCredential>(`/api/v1/agent-credentials/${encodeURIComponent(credentialId)}/rotate`, {
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
