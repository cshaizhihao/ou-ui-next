import type {
  AgentStatus,
  AuditLog,
  DeployTask,
  ForwardRule,
  OperatorSessionStatus,
  PermissionGrant,
  RuntimeModuleKind,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionClientIdentity,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  TrafficRollup
} from '../../domain';
import type { AgentInstallMetadata } from '../../domain/agent-install';
import type { AgentEventEnvelope } from '../../services/api/api-contract';
import type { CommandOutboxItem } from '../../services/api/control-plane-api';
import type { AgentLogRetentionPolicy, AgentLogRetentionPruneResult } from './agent-log-retention';

export type TaskIdempotencyRecord = {
  key: string;
  taskId: string;
  actor: string;
  method: 'POST';
  path: '/api/v1/tasks' | '/api/v1/agents/install-command';
  requestId: string;
  idempotencyKey: string;
  requestBodyHash: string;
};

export type AgentRuntimeCapability = RuntimeModuleKind | 'system';

export type OperatorSessionRecord = {
  id: string;
  username: string;
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  status: OperatorSessionStatus;
  issuedAt: string;
  expiresAt: string;
  sourceIp: string;
  userAgent?: string;
  requestId: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
};

export type AgentCredentialRecord = {
  id: string;
  agentId: string;
  tokenHash: string;
  tokenPrefix: string;
  status: 'active' | 'revoked' | 'expired';
  purpose: 'install' | 'runtime';
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  sourceIp: string;
  requestId: string;
  lastUsedAt?: string;
  sessionId?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  replacedByCredentialId?: string;
  metadata: AgentInstallMetadata;
};

export type ControlPlaneRepositoryState = {
  tasks: DeployTask[];
  auditLogs: AuditLog[];
  commandOutbox: CommandOutboxItem[];
  agentEvents: AgentEventEnvelope[];
  agentSessions: AgentSessionState[];
  operatorSessions: OperatorSessionRecord[];
  agentCredentials: AgentCredentialRecord[];
  idempotencyRecords: TaskIdempotencyRecord[];
  forwardRules: ForwardRule[];
  subscriptionSources: SubscriptionSource[];
  subscriptionClients: SubscriptionClientIdentity[];
  subscriptionExportProfiles: SubscriptionExportProfile[];
  subscriptionInventoryNodes: SubscriptionInventoryNode[];
  permissionGrants: PermissionGrant[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
};

export type AgentSessionState = {
  agentId: string;
  sessionId: string;
  status: Extract<AgentStatus, 'online' | 'degraded' | 'offline'>;
  lastSeq: number;
  lastSeenCommandSeq?: number;
  version?: string;
  capabilities?: AgentRuntimeCapability[];
  lastHeartbeatAt?: string;
  updatedAt: string;
};

export type ControlPlaneTransaction = {
  findTask(taskId: string): Promise<DeployTask | undefined>;
  listTasks(): Promise<DeployTask[]>;
  listAuditLogs(): Promise<AuditLog[]>;
  insertTask(task: DeployTask): Promise<void>;
  updateTask(task: DeployTask): Promise<void>;
  insertAuditLog(auditLog: AuditLog): Promise<void>;
  listCommandOutbox(): Promise<CommandOutboxItem[]>;
  findCommandOutboxItem(commandId: string, agentId: string): Promise<CommandOutboxItem | undefined>;
  updateCommandOutboxItem(item: CommandOutboxItem): Promise<void>;
  insertCommandOutbox(item: CommandOutboxItem): Promise<void>;
  findAgentEvent(eventId: string): Promise<AgentEventEnvelope | undefined>;
  insertAgentEvent(event: AgentEventEnvelope): Promise<void>;
  pruneAgentLogEvents(policy: AgentLogRetentionPolicy, now: string): Promise<AgentLogRetentionPruneResult>;
  findAgentSession(agentId: string, sessionId: string): Promise<AgentSessionState | undefined>;
  upsertAgentSession(session: AgentSessionState): Promise<void>;
  findOperatorSession(sessionId: string): Promise<OperatorSessionRecord | undefined>;
  listOperatorSessions(): Promise<OperatorSessionRecord[]>;
  upsertOperatorSession(session: OperatorSessionRecord): Promise<void>;
  findAgentCredentialById(id: string): Promise<AgentCredentialRecord | undefined>;
  findAgentCredentialByTokenHash(tokenHash: string): Promise<AgentCredentialRecord | undefined>;
  upsertAgentCredential(record: AgentCredentialRecord): Promise<void>;
  findIdempotencyRecord(key: string): Promise<TaskIdempotencyRecord | undefined>;
  insertIdempotencyRecord(record: TaskIdempotencyRecord): Promise<void>;
  findForwardRule(ruleId: string): Promise<ForwardRule | undefined>;
  listSubscriptionSources(): Promise<SubscriptionSource[]>;
  upsertSubscriptionSource(source: SubscriptionSource): Promise<void>;
  deleteSubscriptionSource(sourceId: string): Promise<void>;
  listSubscriptionClients(): Promise<SubscriptionClientIdentity[]>;
  upsertSubscriptionClient(client: SubscriptionClientIdentity): Promise<void>;
  deleteSubscriptionClient(clientId: string): Promise<void>;
  listSubscriptionExportProfiles(): Promise<SubscriptionExportProfile[]>;
  upsertSubscriptionExportProfile(profile: SubscriptionExportProfile): Promise<void>;
  deleteSubscriptionExportProfile(profileId: string): Promise<void>;
  listSubscriptionInventoryNodes(): Promise<SubscriptionInventoryNode[]>;
  replaceSubscriptionInventoryNodesForSource(sourceId: string, nodes: SubscriptionInventoryNode[]): Promise<void>;
  listPermissionGrants(): Promise<PermissionGrant[]>;
  upsertPermissionGrant(grant: PermissionGrant): Promise<void>;
  insertConfigRevision(configRevision: RuntimeConfigRevision): Promise<void>;
  listConfigRevisions(): Promise<RuntimeConfigRevision[]>;
  updateConfigRevision(configRevision: RuntimeConfigRevision): Promise<void>;
  insertPreflightPlan(preflightPlan: RuntimePreflightPlan): Promise<void>;
  listPreflightPlans(): Promise<RuntimePreflightPlan[]>;
  updatePreflightPlan(preflightPlan: RuntimePreflightPlan): Promise<void>;
  insertRuntimeSnapshot(runtimeSnapshot: RuntimeSnapshot): Promise<void>;
  listRuntimeSnapshots(): Promise<RuntimeSnapshot[]>;
  updateRuntimeSnapshot(runtimeSnapshot: RuntimeSnapshot): Promise<void>;
  insertTrafficRollup(trafficRollup: TrafficRollup): Promise<void>;
  listTrafficRollups(): Promise<TrafficRollup[]>;
};

export type ControlPlaneRepository = {
  transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>): Promise<T>;
  listTasks(): Promise<DeployTask[]>;
  listAuditLogs(): Promise<AuditLog[]>;
  listCommandOutbox(): Promise<CommandOutboxItem[]>;
  listAgentEvents(): Promise<AgentEventEnvelope[]>;
  listAgentSessions(): Promise<AgentSessionState[]>;
  listOperatorSessions(): Promise<OperatorSessionRecord[]>;
  listAgentCredentials(): Promise<AgentCredentialRecord[]>;
  findAgentCredentialById(id: string): Promise<AgentCredentialRecord | undefined>;
  findAgentCredentialByTokenHash(tokenHash: string): Promise<AgentCredentialRecord | undefined>;
  listForwardRules(): Promise<ForwardRule[]>;
  listSubscriptionSources(): Promise<SubscriptionSource[]>;
  listSubscriptionClients(): Promise<SubscriptionClientIdentity[]>;
  listSubscriptionExportProfiles(): Promise<SubscriptionExportProfile[]>;
  listSubscriptionInventoryNodes(): Promise<SubscriptionInventoryNode[]>;
  listPermissionGrants(): Promise<PermissionGrant[]>;
  listConfigRevisions(): Promise<RuntimeConfigRevision[]>;
  listPreflightPlans(): Promise<RuntimePreflightPlan[]>;
  listRuntimeSnapshots(): Promise<RuntimeSnapshot[]>;
  listTrafficRollups(): Promise<TrafficRollup[]>;
  findIdempotencyRecord(key: string): Promise<TaskIdempotencyRecord | undefined>;
};
