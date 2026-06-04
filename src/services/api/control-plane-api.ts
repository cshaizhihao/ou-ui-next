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
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportFile,
  SubscriptionInventoryNode,
  ProxyProviderConfig,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
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
  leasedAt?: string;
  leaseExpiresAt?: string;
  ackedAt?: string;
  resultAt?: string;
  lastError?: string;
};

export type AgentCommandLeaseOptions = {
  requestId: string;
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

export interface ControlPlaneApi {
  getApiBoundary(): Promise<ApiBoundaryDescriptor>;
  listAgents(query?: ListQuery): Promise<Agent[]>;
  listNodes(query?: ListQuery): Promise<ManagedNode[]>;
  listInbounds(query?: ListQuery): Promise<XrayInbound[]>;
  listSubscriptionSources(query?: ListQuery): Promise<SubscriptionSource[]>;
  listSubscriptionInventoryNodes(query?: ListQuery): Promise<SubscriptionInventoryNode[]>;
  listSubscriptionBundles(query?: ListQuery): Promise<SubscriptionBundle[]>;
  listSubscriptionClients(query?: ListQuery): Promise<SubscriptionClientIdentity[]>;
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
  listConfigRevisions(query?: ListQuery): Promise<RuntimeConfigRevision[]>;
  listPreflightPlans(query?: ListQuery): Promise<RuntimePreflightPlan[]>;
  listRuntimeSnapshots(query?: ListQuery): Promise<RuntimeSnapshot[]>;
  listAuditLogs(query?: ListQuery): Promise<AuditLog[]>;
  verifyAuditLogChain(logs?: AuditLog[]): Promise<AuditChainVerification>;
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
  rotateAgentCredential(
    credentialId: string,
    input: AgentCredentialRotateRequest,
    context?: MutationContext
  ): Promise<AgentRuntimeCredential>;
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
