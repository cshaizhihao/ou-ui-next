import type {
  AgentStatus,
  AuditLog,
  DeployTask,
  ForwardRule,
  PermissionGrant,
  RuntimeModuleKind,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot
} from '../../domain';
import type { AgentInstallMetadata } from '../../domain/agent-install';
import type { AgentEventEnvelope } from '../../services/api/api-contract';
import type { CommandOutboxItem } from '../../services/api/control-plane-api';

export type TaskIdempotencyRecord = {
  key: string;
  taskId: string;
  actor: string;
  method: 'POST';
  path: '/api/v1/tasks';
  requestId: string;
  idempotencyKey: string;
  requestBodyHash: string;
};

export type AgentRuntimeCapability = RuntimeModuleKind | 'system';

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
  metadata: AgentInstallMetadata;
};

export type ControlPlaneRepositoryState = {
  tasks: DeployTask[];
  auditLogs: AuditLog[];
  commandOutbox: CommandOutboxItem[];
  agentEvents: AgentEventEnvelope[];
  agentSessions: AgentSessionState[];
  agentCredentials: AgentCredentialRecord[];
  idempotencyRecords: TaskIdempotencyRecord[];
  forwardRules: ForwardRule[];
  permissionGrants: PermissionGrant[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
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
  insertTask(task: DeployTask): Promise<void>;
  updateTask(task: DeployTask): Promise<void>;
  insertAuditLog(auditLog: AuditLog): Promise<void>;
  listCommandOutbox(): Promise<CommandOutboxItem[]>;
  findCommandOutboxItem(commandId: string, agentId: string): Promise<CommandOutboxItem | undefined>;
  updateCommandOutboxItem(item: CommandOutboxItem): Promise<void>;
  insertCommandOutbox(item: CommandOutboxItem): Promise<void>;
  findAgentEvent(eventId: string): Promise<AgentEventEnvelope | undefined>;
  insertAgentEvent(event: AgentEventEnvelope): Promise<void>;
  findAgentSession(agentId: string, sessionId: string): Promise<AgentSessionState | undefined>;
  upsertAgentSession(session: AgentSessionState): Promise<void>;
  findAgentCredentialByTokenHash(tokenHash: string): Promise<AgentCredentialRecord | undefined>;
  upsertAgentCredential(record: AgentCredentialRecord): Promise<void>;
  findIdempotencyRecord(key: string): Promise<TaskIdempotencyRecord | undefined>;
  insertIdempotencyRecord(record: TaskIdempotencyRecord): Promise<void>;
  findForwardRule(ruleId: string): Promise<ForwardRule | undefined>;
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
};

export type ControlPlaneRepository = {
  transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>): Promise<T>;
  listTasks(): Promise<DeployTask[]>;
  listAuditLogs(): Promise<AuditLog[]>;
  listCommandOutbox(): Promise<CommandOutboxItem[]>;
  listAgentEvents(): Promise<AgentEventEnvelope[]>;
  listAgentSessions(): Promise<AgentSessionState[]>;
  listAgentCredentials(): Promise<AgentCredentialRecord[]>;
  findAgentCredentialByTokenHash(tokenHash: string): Promise<AgentCredentialRecord | undefined>;
  listForwardRules(): Promise<ForwardRule[]>;
  listPermissionGrants(): Promise<PermissionGrant[]>;
  listConfigRevisions(): Promise<RuntimeConfigRevision[]>;
  listPreflightPlans(): Promise<RuntimePreflightPlan[]>;
  listRuntimeSnapshots(): Promise<RuntimeSnapshot[]>;
  findIdempotencyRecord(key: string): Promise<TaskIdempotencyRecord | undefined>;
};
