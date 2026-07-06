import type {
  Agent,
  AgentLogArchive,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentUpgradeCommandRequest,
  AgentSessionSummary,
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
  ResourcePermission,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
  TelegramBindingChallenge,
  TelegramBindingReadModel,
  TelegramBotSettings,
  TelegramChatBinding,
  TelegramCustomerBinding,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy,
  TrafficRollup,
  TrafficRollupCompaction,
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
  buildRuntimeArtifact,
  composeAgentInstallCommand,
  composeAgentUpgradeCommand,
  createCustomersFromReadModels,
  createSubscriptionBundlesFromInventory,
  countCrossSourceSubscriptionInventoryDuplicates,
  createProxyProvidersFromSources,
  createRuntimeAgentToken,
  DEFAULT_AGENT_INSTALL_SCRIPT_URL,
  createSubscriptionExportFilesFromClients,
  markTaskAgentRuntimeDeploymentVerified,
  readSubscriptionSourceDeleteId
} from '../../domain';
import type {
  AgentCommandLeaseOptions,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput,
  AgentRequestDeniedAuditInput,
  AuditChainVerification,
  CommandTimeoutSweepOptions,
  CommandOutboxItem,
  ControlPlaneApi,
  ControlPlaneRuntimeObservabilityMetricsArgument,
  MutationContext,
  OperatorRequestDeniedAuditInput,
  TrafficRollupRetentionPolicyReadModel,
  TrafficRollupRetentionPolicyValues,
  TrafficRollupRetentionPolicyUpdateInput
} from '../api/control-plane-api';
import {
  agentCommandEnvelopeSchema,
  type AgentEventEnvelope,
  parseAgentEventEnvelope,
  parseCreateTaskRequest,
  parseMutationContext
} from '../api/api-contract';
import {
  applyAgentEventToReadModel,
  applyAgentLivenessToReadModel
} from '../api/agent-telemetry-read-model';
import {
  createSystemAlertsFromAgents,
  createSystemAlertsFromCommandOutbox,
  createSystemAlertsFromQuotaPolicies,
  createSystemAlertsFromRuntimeTasks,
  createSystemAlertsFromSubscriptionSources
} from '../api/system-alerts';
import {
  mergeTrafficRollupCompactions,
  pruneTrafficRollups
} from '../../server/control-plane/traffic-rollup-retention';
import {
  createAgentLogExport,
  createAgentLogArchiveExport,
  createObservabilityMetrics,
  createTrafficRollupCompactionExport,
  createTrafficRollupExport,
  selectAgentLogChunks,
  selectAgentLogArchives,
  selectTrafficRollupCompactions,
  selectTrafficRollups,
  summarizeCommandOutboxItem,
  v1ApiBoundary
} from '../api/control-plane-api';
import {
  applyForwardingBillingWindowToReadModel,
  applyForwardingTelemetryToReadModel
} from '../api/forwarding-telemetry-read-model';
import { deriveForwardQuotaEnforcementTaskIntents } from '../api/forward-quota-enforcement-tasks';
import { deriveXrayGuardrailTaskIntents } from '../api/xray-guardrail-enforcement-tasks';
import { findXrayInboundPortConflictDenial } from '../api/xray-inbound-port-conflicts';
import { createQuotaPoliciesFromReadModels } from '../api/quota-policies';
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
} from '../api/quota-reset-tasks';
import { createTrafficRollupsFromAgentTelemetry } from '../api/traffic-rollups';
import { applyXrayTelemetryToReadModel, applyXrayTrafficWindowToReadModel } from '../api/xray-telemetry-read-model';
import { projectSubscriptionClientRuntimeState } from '../api/subscription-output';
import {
  applyTelegramBotSettingsUpdate,
  applyTelegramNotificationPolicyUpdate,
  createDefaultTelegramBotSettings,
  createDefaultTelegramNotificationPolicy,
  createStableTelegramHash,
  createTelegramBinding as createTelegramBindingRecord,
  createTelegramBindingChallenge as createTelegramBindingChallengeRecord,
  createTelegramBindingModels,
  createTelegramTestDelivery,
  redactTelegramBotSettingsAudit,
  TELEGRAM_DEFAULT_POLICY_ID
} from '../api/telegram-bot';
import {
  seedAgents,
  seedAuditLogs,
  seedForwardRules,
  seedInbounds,
  seedNodes,
  seedOperatorSessions,
  seedPermissionGrants,
  seedQuotaPolicies,
  seedRateLimitPolicies,
  seedRoutingPolicies,
  seedSubscriptionBundles,
  seedSubscriptionClients,
  seedSubscriptionSources,
  seedTasks,
  seedTuningProfiles
} from './mock-data';

const MOCK_AGENT_LOG_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MOCK_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT = 5000;
const MOCK_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS = 62 * 24 * 60 * 60 * 1000;
const MOCK_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE = 200_000;
const MOCK_TRAFFIC_ROLLUP_RETENTION_RUNTIME_DEFAULT: TrafficRollupRetentionPolicyValues = {
  maxAgeMs: MOCK_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS,
  maxAgeDays: MOCK_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS / 24 / 60 / 60 / 1000,
  maxRecordsPerScope: MOCK_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE
};

type MockApiState = {
  agents: Agent[];
  nodes: ManagedNode[];
  inbounds: XrayInbound[];
  subscriptionSources: SubscriptionSource[];
  subscriptionInventoryNodes: SubscriptionInventoryNode[];
  subscriptionBundles: SubscriptionBundle[];
  subscriptionClients: SubscriptionClientIdentity[];
  subscriptionExportProfiles: SubscriptionExportProfile[];
  forwardRules: ForwardRule[];
  quotaPolicies: QuotaPolicy[];
  rateLimitPolicies: RateLimitPolicy[];
  permissionGrants: PermissionGrant[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
  trafficRollupCompactions: TrafficRollupCompaction[];
  agentLogArchives: AgentLogArchive[];
  routingPolicies: RoutingPolicy[];
  tuningProfiles: TuningProfile[];
  tasks: DeployTask[];
  commandOutbox: CommandOutboxItem[];
  agentEvents: AgentEventEnvelope[];
  agentSessions: AgentSessionSummary[];
  agentCredentials: MockAgentCredentialRecord[];
  operatorSessions: OperatorSessionSummary[];
  telegramBotSettings: TelegramBotSettings;
  telegramChatBindings: TelegramChatBinding[];
  telegramCustomerBindings: TelegramCustomerBinding[];
  telegramBindingChallenges: TelegramBindingChallenge[];
  telegramBindingChallengeSecrets: Array<{
    challengeId: string;
    codeHash: string;
    createdAt: string;
    expiresAt: string;
    consumedAt?: string;
  }>;
  telegramNotificationPolicies: TelegramNotificationPolicy[];
  telegramNotificationDeliveries: TelegramNotificationDelivery[];
  auditLogs: AuditLog[];
  taskIdempotencyIndex: Record<string, IdempotencyRecord>;
  agentLogRetentionPolicy: AgentLogRetentionPolicyReadModel;
  trafficRollupRetentionPolicy: TrafficRollupRetentionPolicyReadModel;
  sequence: number;
};

type MockAgentCredentialRecord = AgentCredentialSummary & {
  tokenHash: string;
};

type CreateMockApiOptions = {
  seedInventory?: boolean;
  seedRuntimeEvidence?: boolean;
  readModelNow?: () => string;
  inventory?: Partial<Pick<MockApiState, 'agents' | 'forwardRules' | 'quotaPolicies'>>;
};

type IdempotencyRecord = {
  taskId: string;
  actor: string;
  method: 'POST';
  path: '/api/v1/tasks' | '/api/v1/agents/install-command';
  requestId: string;
  idempotencyKey: string;
  requestBodyHash: string;
};

class MockControlPlaneMutationError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, details?: unknown) {
    super(code);
    this.name = 'MockControlPlaneMutationError';
    this.code = code;
    this.details = details;
  }
}

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

function projectSubscriptionClientReadModel(
  client: SubscriptionClientIdentity,
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[],
  quotaResetReplayState?: ReturnType<typeof createQuotaResetReplayState>,
  nowIso?: string
) {
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTokenPrefix(token: string) {
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function createMockAgentCredentialTokenHash(token: string) {
  return createStableSha256LikeHash({ agentCredentialToken: token });
}

function sanitizeAgentCredential(credential: MockAgentCredentialRecord): AgentCredentialSummary {
  const summary = { ...credential } as AgentCredentialSummary & { tokenHash?: string };
  delete summary.tokenHash;
  return summary;
}

function nextTimestamp(sequence: number) {
  return new Date(Date.UTC(2026, 5, 2, 0, 0, sequence)).toISOString();
}

function inferResourceType(operation: CreateTaskInput['operation']) {
  if (operation.startsWith('agent.')) return 'agent';
  if (operation.startsWith('module.')) return 'module';
  if (operation.startsWith('inbound.')) return 'inbound';
  if (operation.startsWith('subscription.')) return 'subscription';
  if (operation.startsWith('forward.')) return 'forward';
  if (operation.startsWith('permission.')) return 'permission';
  if (operation.startsWith('quota.')) return 'quota';
  if (operation.startsWith('tunnel.')) return 'tunnel';
  if (operation.startsWith('config.') || operation.startsWith('runtime.') || operation.startsWith('system.')) return 'module';
  return 'node';
}

function createTaskSteps(summary: string) {
  return [
    { id: 'step-validate', label: `校验请求: ${summary}`, status: 'pending' as const },
    { id: 'step-apply', label: '应用配置变更', status: 'pending' as const },
    { id: 'step-audit', label: '记录审计事件', status: 'pending' as const }
  ];
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
  let first = 0x811c9dc5;
  let second = 0x01000193;

  for (let index = 0; index < normalized.length; index += 1) {
    first ^= normalized.charCodeAt(index);
    first = Math.imul(first, 0x01000193);
    second ^= normalized.charCodeAt(normalized.length - index - 1);
    second = Math.imul(second, 0x811c9dc5);
  }

  const seed = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return `sha256:${seed.repeat(4).slice(0, 64)}`;
}

function createTaskRequestHash(input: CreateTaskInput) {
  return createStableSha256LikeHash(input);
}

function createAuditIntegrityHash(log: AuditLog) {
  const hashableLog = { ...log };
  delete hashableLog.hash;
  return createStableSha256LikeHash(hashableLog);
}

function sealAuditLogChain(logsOldestFirst: AuditLog[]): AuditLog[] {
  let previousHash = AUDIT_GENESIS_HASH;
  const sealedLogs: AuditLog[] = [];

  logsOldestFirst.forEach((log) => {
    const auditWithPrevHash = {
      ...log,
      prevHash: previousHash
    };
    const sealedLog = {
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    };

    sealedLogs.push(sealedLog);
    previousHash = sealedLog.hash;
  });

  return sealedLogs.reverse();
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

function addMilliseconds(timestamp: string, milliseconds: number) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function createArtifactChecksum(artifact: Record<string, unknown>) {
  return createStableSha256LikeHash(artifact);
}

function createSignature(checksum: string) {
  return `sig-v1:${checksum.replace('sha256:', '').slice(0, 32)}`;
}

function shouldCreateAgentCommand(operation: CreateTaskInput['operation']) {
  return [
    'agent.deploy',
    'agent.upgrade',
    'agent.update',
    'agent.delete',
    'agent.rollback',
    'config.apply',
    'inbound.create',
    'inbound.update',
    'inbound.delete',
    'runtime.reload',
    'forward.create',
    'forward.update',
    'forward.apply',
    'forward.pause',
    'forward.resume',
    'forward.delete',
    'tunnel.create',
    'tunnel.update',
    'tunnel.redeploy',
    'system.tune'
  ].includes(operation);
}

function requiresAgentResultForRuntimeSuccess(operation: DeployTask['operation']) {
  return shouldCreateAgentCommand(operation);
}

function readStringMetadata(task: DeployTask, key: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readRollbackModeMetadata(task: DeployTask): 'hot_reload' | 'graceful_restart' {
  const value = readStringMetadata(task, 'rollbackMode');
  return value === 'hot_reload' || value === 'graceful_restart' ? value : 'graceful_restart';
}

function resolveAgentIdForTask(task: DeployTask) {
  if (task.operation.startsWith('inbound.')) {
    return readStringMetadata(task, 'agentId') ?? task.targetId;
  }

  return task.resourceType === 'agent' ? task.targetId : readStringMetadata(task, 'agentId');
}

function readForwardingTargetAgentIds(task: DeployTask) {
  const agentIds = task.metadata?.entryNodeIds ?? task.metadata?.agentIds;

  if (!Array.isArray(agentIds)) {
    return [];
  }

  return [...new Set(agentIds.filter((agentId): agentId is string => typeof agentId === 'string' && agentId.trim() !== ''))];
}

function readTunnelTargetAgentIds(task: DeployTask) {
  const metadata = task.metadata;
  const candidateIds = [
    ...(Array.isArray(metadata?.entryAgentIds) ? metadata.entryAgentIds : []),
    ...(Array.isArray(metadata?.agentIds) ? metadata.agentIds : [])
  ];

  return [
    ...new Set(candidateIds.filter((agentId): agentId is string => typeof agentId === 'string' && agentId.trim() !== ''))
  ];
}

function resolveAgentIdsForTask(task: DeployTask) {
  const targetAgentIds = task.operation.startsWith('forward.')
    ? readForwardingTargetAgentIds(task)
    : task.operation.startsWith('tunnel.')
      ? readTunnelTargetAgentIds(task)
      : [];
  const fallbackAgentId = resolveAgentIdForTask(task);
  return targetAgentIds.length > 0 ? targetAgentIds : fallbackAgentId ? [fallbackAgentId] : [];
}

function readForwardRuleAgentIds(rule: ForwardRule | undefined) {
  if (!rule) {
    return [];
  }

  return [
    ...new Set(
      rule.ports
        .map((port) => port.agentId)
        .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.trim() !== '')
    )
  ];
}

function resolveAgentIdsForTaskInState(task: DeployTask, state: MockApiState) {
  const directAgentIds = resolveAgentIdsForTask(task);

  if (directAgentIds.length > 0) {
    return directAgentIds;
  }

  if (task.operation.startsWith('forward.')) {
    return readForwardRuleAgentIds(state.forwardRules.find((rule) => rule.id === task.targetId));
  }

  return [];
}

function findXrayCapabilityDenialForTask(task: DeployTask, agents: Agent[]) {
  if (!task.operation.startsWith('inbound.')) {
    return undefined;
  }

  if (task.metadata?.xrayGuardrailAutomatic === true) {
    return undefined;
  }

  const targetAgentIds = resolveAgentIdsForTask(task);
  const unsupportedAgentIds = targetAgentIds.filter((agentId) => {
    const agent = agents.find((item) => item.id === agentId);
    return agent ? !agent.capabilities.includes('xray') : false;
  });

  if (unsupportedAgentIds.length === 0) {
    return undefined;
  }

  return {
    denialReason: 'Xray inbound operations require the target Agent to advertise the xray runtime capability.',
    unsupportedAgentIds,
    requiredCapability: 'xray'
  };
}

function shouldNamespaceCommandArtifacts(task: DeployTask) {
  return (
    (task.operation.startsWith('forward.') && readForwardingTargetAgentIds(task).length > 0) ||
    (task.operation.startsWith('tunnel.') && readTunnelTargetAgentIds(task).length > 0)
  );
}

function resolveModuleKindForTask(operation: CreateTaskInput['operation']): 'host-agent' | 'xray' | 'port-forwarding' | 'bbr' | 'system' {
  if (operation.startsWith('agent.')) return 'host-agent';
  if (operation.startsWith('inbound.')) return 'xray';
  if (operation.startsWith('forward.') || operation.startsWith('tunnel.')) return 'port-forwarding';
  if (operation.startsWith('system.')) return 'bbr';
  return 'system';
}

function createCommandOutboxItem(task: DeployTask, sequence: number, agentId: string): CommandOutboxItem {
  const artifactSuffix = shouldNamespaceCommandArtifacts(task) ? `-${agentId}` : '';
  const commandId = `cmd-${task.id}${artifactSuffix}`;
  const deadlineAt = addMinutes(task.createdAt, 5);
  const moduleKind = resolveModuleKindForTask(task.operation);
  const artifactModuleKind = moduleKind === 'system' ? 'bbr' : moduleKind;
  const applyArtifact =
    task.operation === 'agent.rollback' || task.operation === 'runtime.reload' || task.operation === 'agent.upgrade'
      ? undefined
      : buildRuntimeArtifact({
          task,
          agentId,
          moduleKind: artifactModuleKind
        });
  const artifactChecksum = applyArtifact
    ? createArtifactChecksum(applyArtifact)
    : createStableSha256LikeHash({ commandId, moduleKind });
  const baseCommand = {
    commandId,
    requestId: task.requestId,
    taskId: task.id,
    agentId,
    seq: sequence,
    issuedAt: task.createdAt,
    deadlineAt
  };
  const command =
    task.operation === 'agent.rollback'
      ? {
          ...baseCommand,
          type: 'rollback' as const,
          payload: {
            snapshotId: readStringMetadata(task, 'snapshotId') ?? `snapshot-before-${task.targetId}`,
            targetConfigRevision: readStringMetadata(task, 'targetConfigRevision') ?? `cfg-rollback-${task.id}`,
            rollbackReason: readStringMetadata(task, 'rollbackReason') ?? task.summary,
            rollbackMode: readRollbackModeMetadata(task)
          }
        }
      : task.operation === 'agent.upgrade'
        ? {
            ...baseCommand,
            type: 'upgrade' as const,
            payload: {
              mode: 'update-runtime' as const,
              scriptUrl: DEFAULT_AGENT_INSTALL_SCRIPT_URL,
              reason: readStringMetadata(task, 'reason') ?? task.summary
            }
          }
      : task.operation === 'runtime.reload'
        ? {
            ...baseCommand,
            type: 'reload' as const,
            payload: {
              moduleKind: 'system' as const,
              moduleId: task.targetId,
              configRevision: `cfg-${task.id}`,
              reloadMode: 'graceful_restart' as const
            }
          }
        : {
            ...baseCommand,
            type: 'apply' as const,
            payload: {
              configRevision: `cfg-${task.id}${artifactSuffix}`,
              moduleKind,
              artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}${artifactSuffix}.json`,
              checksum: artifactChecksum,
              signature: createSignature(artifactChecksum),
              artifact: applyArtifact,
              preflightPlanId: `preflight-${task.id}${artifactSuffix}`,
              snapshotBeforeId: `snapshot-before-${task.targetId}${artifactSuffix}`,
              applyMode: 'graceful_restart' as const,
              dryRun: false,
              rollbackTaskId: null
            }
          };

  return {
    id: `outbox-${String(sequence).padStart(4, '0')}`,
    taskId: task.id,
    commandId,
    agentId,
    seq: sequence,
    status: 'pending',
    transport: 'websocket',
    command,
    attempts: 0,
    createdAt: task.createdAt,
    updatedAt: task.createdAt,
    deadlineAt
  };
}

function createCommandOutboxItems(task: DeployTask, firstSequence: number, agentIds: string[]) {
  return agentIds.map((agentId, index) => createCommandOutboxItem(task, firstSequence + index, agentId));
}

const allowedTaskTransitions = v1ApiBoundary.taskTransitions;

function assertValidTaskTransition(from: DeployTaskStatus, to: DeployTaskStatus) {
  if (!allowedTaskTransitions[from].includes(to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}

function resolveMutationContext(context: MutationContext | undefined, sequence: number): MutationContext {
  return {
    actor: context?.actor ?? 'admin',
    operatorGroupId: context?.operatorGroupId,
    resourceGroupId: context?.resourceGroupId,
    sourceIp: context?.sourceIp ?? '127.0.0.1',
    userAgent: context?.userAgent,
    requestId: context?.requestId ?? `req-preview-${String(sequence).padStart(4, '0')}`,
    idempotencyKey: context?.idempotencyKey,
    ifMatch: context?.ifMatch
  };
}

function createIdempotencyRecordKey(context: MutationContext) {
  return `${context.actor}:POST:/api/v1/tasks:${context.idempotencyKey ?? context.requestId}`;
}

function createAgentInstallCommandIdempotencyRecordKey(context: MutationContext) {
  return `${context.actor}:POST:/api/v1/agents/install-command:${context.idempotencyKey ?? context.requestId}`;
}

function getActorPermissions(
  permissionGrants: PermissionGrant[],
  context: MutationContext,
  resourceId: string,
  observedAt: string,
  resourceType?: PermissionGrant['resourceType']
): Set<ResourcePermission> {
  const actorPermissions = new Set<ResourcePermission>();

  permissionGrants
    .filter((grant) => grant.resourceId === resourceId)
    .filter((grant) => !resourceType || grant.resourceType === resourceType)
    .filter((grant) => isPermissionGrantActive(grant, observedAt))
    .filter(
      (grant) =>
        (grant.subjectType === 'user' && grant.subjectId === context.actor) ||
        (grant.subjectType === 'group' && grant.subjectId === context.operatorGroupId)
    )
    .forEach((grant) => {
      grant.permissions.forEach((permission) => actorPermissions.add(permission));
    });

  return actorPermissions;
}

function isPermissionGrantActive(grant: PermissionGrant, observedAt: string) {
  if (grant.revokedAt) {
    return false;
  }

  if (!grant.expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(grant.expiresAt);
  const observedAtMs = Date.parse(observedAt);

  if (Number.isNaN(expiresAtMs) || Number.isNaN(observedAtMs)) {
    return false;
  }

  return expiresAtMs > observedAtMs;
}

function hasBootstrapPrivileges(context: MutationContext) {
  return context.actor === 'admin' || context.actor === 'operator:admin';
}

function resolvePermissionGrantDenial(
  input: CreateTaskInput,
  context: MutationContext,
  permissionGrants: PermissionGrant[],
  observedAt: string
) {
  if (hasBootstrapPrivileges(context)) {
    return undefined;
  }

  if (input.operation !== 'permission.grant' || !input.permissionChange) {
    return undefined;
  }

  const actorPermissions = getActorPermissions(
    permissionGrants,
    context,
    input.permissionChange.resourceId,
    observedAt,
    input.permissionChange.resourceType
  );
  const requestedPermissions = input.permissionChange.permissions;
  const missingPermissions = requestedPermissions.filter((permission) => !actorPermissions.has(permission));

  if (!actorPermissions.has('grant')) {
    return {
      denialCode: 'permission.denied',
      denialReason: 'Actor does not hold grant permission on the target resource group.',
      before: {
        actorPermissions: Array.from(actorPermissions).sort()
      },
      after: {
        requestedPermissions
      }
    };
  }

  if (missingPermissions.length > 0) {
    return {
      denialCode: 'permission.denied',
      denialReason: 'Actor cannot grant permissions they do not already hold.',
      before: {
        actorPermissions: Array.from(actorPermissions).sort()
      },
      after: {
        requestedPermissions,
        missingPermissions
      }
    };
  }

  return undefined;
}

function hasSamePermissionSet(left: ResourcePermission[], right: ResourcePermission[]) {
  return left.length === right.length && left.every((permission) => right.includes(permission));
}

function resolveLastAdministrativeGrantDenial(
  grant: PermissionGrant,
  permissionGrants: PermissionGrant[],
  observedAt: string
) {
  if (!grant.permissions.includes('grant') || !isPermissionGrantActive(grant, observedAt)) {
    return undefined;
  }

  const remainingAdministrativeGrants = permissionGrants.filter(
    (item) =>
      item.id !== grant.id &&
      isPermissionGrantActive(item, observedAt) &&
      item.resourceType === grant.resourceType &&
      item.resourceId === grant.resourceId &&
      item.permissions.includes('grant')
  );

  if (remainingAdministrativeGrants.length > 0) {
    return undefined;
  }

  return {
    denialCode: 'permission_grant.last_admin_path',
    denialReason: 'Permission revoke would remove the last administrative grant path for this resource.',
    before: {
      grantId: grant.id,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      permissions: grant.permissions
    },
    after: {
      remainingAdministrativeGrantCount: 0,
      requiredPermission: 'grant'
    }
  };
}

function resolvePermissionRevokeDenial(input: CreateTaskInput, permissionGrants: PermissionGrant[], observedAt: string) {
  if (input.operation !== 'permission.revoke') {
    return undefined;
  }

  if (!input.permissionChange) {
    return {
      denialCode: 'permission_change.required',
      denialReason: 'Permission revoke requires an explicit permissionChange payload.',
      after: {
        requiredPayload: 'permissionChange'
      }
    };
  }

  const grant = permissionGrants.find((item) => item.id === input.targetId);

  if (!grant) {
    return {
      denialCode: 'permission_grant.not_found',
      denialReason: 'Permission grant does not exist.',
      after: {
        grantId: input.targetId
      }
    };
  }

  if (grant.revokedAt) {
    return {
      denialCode: 'permission_grant.already_revoked',
      denialReason: 'Permission grant is already revoked.',
      before: {
        grantId: grant.id,
        revokedAt: grant.revokedAt
      }
    };
  }

  const matchesGrant =
    grant.subjectType === input.permissionChange.subjectType &&
    grant.subjectId === input.permissionChange.subjectId &&
    grant.resourceType === input.permissionChange.resourceType &&
    grant.resourceId === input.permissionChange.resourceId &&
    hasSamePermissionSet(grant.permissions, input.permissionChange.permissions);

  if (!matchesGrant) {
    return {
      denialCode: 'permission_grant.mismatch',
      denialReason: 'Permission revoke payload does not match the target grant.',
      before: {
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
        permissions: grant.permissions
      },
      after: input.permissionChange
    };
  }

  const lastAdministrativeGrantDenial = resolveLastAdministrativeGrantDenial(grant, permissionGrants, observedAt);

  if (lastAdministrativeGrantDenial) {
    return lastAdministrativeGrantDenial;
  }

  return undefined;
}

const highRiskOperations = new Set<CreateTaskInput['operation']>([
  'agent.delete',
  'agent.rollback',
  'inbound.delete',
  'runtime.reload',
  'forward.delete',
  'subscription.delete',
  'subscription.profile.delete',
  'quota.reset',
  'permission.revoke'
]);

function resolveHighRiskConfirmationDenial(input: CreateTaskInput) {
  if (!highRiskOperations.has(input.operation)) {
    return undefined;
  }

  if (input.riskConfirmation?.operation === input.operation && input.riskConfirmation.targetId === input.targetId) {
    return undefined;
  }

  return {
    denialCode: 'high_risk_confirmation.required',
    denialReason: 'High-risk operations require explicit confirmation that matches the operation and target.',
    before: {
      operation: input.operation,
      targetId: input.targetId
    },
    after: {
      requiredConfirmation: {
        operation: input.operation,
        targetId: input.targetId
      },
      providedConfirmation: input.riskConfirmation
        ? {
            operation: input.riskConfirmation.operation,
            targetId: input.riskConfirmation.targetId
          }
        : undefined
    }
  };
}

function resolveRequiredPermission(operation: CreateTaskInput['operation']): ResourcePermission {
  if (
    [
      'agent.rollback',
      'runtime.reload',
      'forward.pause',
      'forward.resume',
      'subscription.sync',
      'subscription.export',
      'subscription.generate'
    ].includes(operation)
  ) {
    return 'operate';
  }

  if (operation === 'permission.grant' || operation === 'permission.revoke') {
    return 'grant';
  }

  return 'configure';
}

function resolveAuthorizationResourceId(input: CreateTaskInput, context: MutationContext) {
  return input.permissionChange?.resourceId ?? context.resourceGroupId ?? input.targetId;
}

function resolveOperationPermissionDenial(
  input: CreateTaskInput,
  context: MutationContext,
  permissionGrants: PermissionGrant[],
  observedAt: string
) {
  if (hasBootstrapPrivileges(context)) {
    return undefined;
  }

  if (input.operation === 'permission.grant' && !input.permissionChange) {
    return undefined;
  }

  if (!context.operatorGroupId && !context.resourceGroupId) {
    return undefined;
  }

  const requiredPermission = resolveRequiredPermission(input.operation);
  const resourceId = resolveAuthorizationResourceId(input, context);
  const actorPermissions = getActorPermissions(
    permissionGrants,
    context,
    resourceId,
    observedAt,
    input.permissionChange?.resourceType
  );

  if (!actorPermissions.has(requiredPermission)) {
    return {
      denialCode: 'permission.denied',
      denialReason: `Actor does not hold ${requiredPermission} permission on the target resource group.`,
      before: {
        actorPermissions: Array.from(actorPermissions).sort()
      },
      after: {
        requiredPermission,
        resourceId
      }
    };
  }

  return undefined;
}

function resolveAgentInstallCommandPermissionDenial(
  context: MutationContext,
  permissionGrants: PermissionGrant[],
  observedAt: string
) {
  if (hasBootstrapPrivileges(context)) {
    return undefined;
  }

  const requiredPermission: ResourcePermission = 'configure';
  const resourceId = context.resourceGroupId ?? 'agent-enrollment';
  const actorPermissions = getActorPermissions(permissionGrants, context, resourceId, observedAt, 'agent');

  if (!actorPermissions.has(requiredPermission)) {
    return {
      denialCode: 'permission.denied',
      denialReason: 'Actor does not hold configure permission for Agent enrollment.',
      before: {
        actorPermissions: Array.from(actorPermissions).sort()
      },
      after: {
        requiredPermission,
        resourceId
      }
    };
  }

  return undefined;
}

function resolveResourceVersion(input: CreateTaskInput, state: MockApiState) {
  if (input.operation.startsWith('forward.')) {
    return state.forwardRules.find((rule) => rule.id === input.targetId)?.resourceVersion;
  }

  if (input.operation.startsWith('permission.') && input.permissionChange) {
    return state.permissionGrants.find((grant) => grant.id === input.targetId)?.resourceVersion;
  }

  return undefined;
}

function resolveResourceVersionDenial(input: CreateTaskInput, context: MutationContext, state: MockApiState) {
  if (!context.ifMatch) {
    return undefined;
  }

  const currentResourceVersion = resolveResourceVersion(input, state);

  if (currentResourceVersion && currentResourceVersion !== context.ifMatch) {
    return {
      denialCode: 'resource_version.conflict',
      denialReason: 'If-Match resource version does not match the current resource version.',
      before: {
        expectedResourceVersion: context.ifMatch
      },
      after: {
        currentResourceVersion
      }
    };
  }

  return undefined;
}

function createProvisioningAgentFromRegistration(input: AgentRegistrationRequest, sourceIp: string, issuedAt: string): Agent {
  const capabilitySet = new Set<Agent['capabilities'][number]>();

  for (const capability of input.capabilities ?? ['host-agent']) {
    if (
      capability === 'host-agent' ||
      capability === 'xray' ||
      capability === 'port-forwarding' ||
      capability === 'telemetry' ||
      capability === 'command-channel' ||
      capability === 'self-update'
    ) {
      capabilitySet.add(capability);
    }
  }

  const capabilities = [...capabilitySet];

  return {
    id: input.agentId,
    name: input.agentId,
    status: 'provisioning',
    region: 'custom',
    publicAddress: sourceIp,
    connectionMode: 'pull',
    version: input.version ?? 'unknown',
    platform: input.platform ?? 'linux/unknown',
    capabilities: capabilities.length > 0 ? capabilities : ['host-agent'],
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
    lastHeartbeatAt: issuedAt,
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
      samplingExpectedSince: issuedAt
    }
  };
}

function normalizeMockAgentSessionCapabilities(
  capabilities: readonly string[] | undefined
): AgentSessionSummary['capabilities'] {
  if (!capabilities) {
    return undefined;
  }

  const normalized = capabilities
    .map((capability) => {
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'port-forwarding' ||
        capability === 'bbr' ||
        capability === 'system' ||
        capability === 'telemetry' ||
        capability === 'command-channel' ||
        capability === 'self-update'
      ) {
        return capability;
      }

      return undefined;
    })
    .filter((capability): capability is NonNullable<AgentSessionSummary['capabilities']>[number] =>
      Boolean(capability)
    );

  return [...new Set<NonNullable<AgentSessionSummary['capabilities']>[number]>(normalized)];
}

function readMockCredentialSessionCapabilities(
  credential: MockAgentCredentialRecord | undefined
): AgentSessionSummary['capabilities'] {
  return normalizeMockAgentSessionCapabilities(
    credential?.metadata.registrationCapabilities ?? credential?.metadata.installProfile
  );
}

function findMockRuntimeCredentialForSession(
  state: MockApiState,
  agentId: string,
  sessionId: string
): MockAgentCredentialRecord | undefined {
  const runtimeCredentials = state.agentCredentials
    .filter((credential) => credential.agentId === agentId && credential.purpose === 'runtime')
    .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt));

  return runtimeCredentials.find(
    (credential) => credential.status === 'active' && (!credential.sessionId || credential.sessionId === sessionId)
  );
}

function upsertMockAgentSession(state: MockApiState, session: AgentSessionSummary) {
  const nextSessions = state.agentSessions.filter(
    (item) => item.agentId !== session.agentId || item.sessionId !== session.sessionId
  );

  state.agentSessions = [clone(session), ...nextSessions];
}

function recordMockAgentPollSession(
  state: MockApiState,
  agentId: string,
  options: AgentCommandLeaseOptions,
  observedAt: string
) {
  if (!options.sessionId) {
    return;
  }

  const existing = state.agentSessions.find(
    (item) => item.agentId === agentId && item.sessionId === options.sessionId
  );
  const credentialCapabilities = readMockCredentialSessionCapabilities(
    findMockRuntimeCredentialForSession(state, agentId, options.sessionId)
  );

  upsertMockAgentSession(state, {
    agentId,
    sessionId: options.sessionId,
    status: 'online',
    lastSeq: existing?.lastSeq ?? 0,
    lastSeenCommandSeq: options.lastSeenCommandSeq ?? existing?.lastSeenCommandSeq,
    version: existing?.version,
    capabilities: existing?.capabilities ?? credentialCapabilities,
    lastHeartbeatAt: existing?.lastHeartbeatAt,
    updatedAt: observedAt
  });
}

function recordMockAgentEventSession(state: MockApiState, agentEvent: AgentEventEnvelope) {
  const existing = state.agentSessions.find(
    (item) => item.agentId === agentEvent.agentId && item.sessionId === agentEvent.sessionId
  );
  const heartbeatPayload = agentEvent.type === 'heartbeat' ? agentEvent.payload : undefined;
  const credentialCapabilities = readMockCredentialSessionCapabilities(
    findMockRuntimeCredentialForSession(state, agentEvent.agentId, agentEvent.sessionId)
  );
  const eventCapabilities =
    heartbeatPayload?.capabilities !== undefined
      ? normalizeMockAgentSessionCapabilities(heartbeatPayload.capabilities)
      : undefined;
  const nextCapabilities =
    heartbeatPayload?.capabilities !== undefined
      ? eventCapabilities
      : existing?.capabilities !== undefined
        ? existing.capabilities
        : credentialCapabilities;

  upsertMockAgentSession(state, {
    agentId: agentEvent.agentId,
    sessionId: agentEvent.sessionId,
    status: 'online',
    lastSeq: Math.max(existing?.lastSeq ?? 0, agentEvent.seq),
    lastSeenCommandSeq: heartbeatPayload?.lastSeenCommandSeq ?? existing?.lastSeenCommandSeq,
    version: heartbeatPayload?.version ?? existing?.version,
    capabilities: nextCapabilities,
    lastHeartbeatAt: agentEvent.type === 'heartbeat' ? agentEvent.observedAt : existing?.lastHeartbeatAt,
    updatedAt: agentEvent.observedAt
  });
}

function leaseMockCommandOutbox(
  state: MockApiState,
  agentId: string,
  options: AgentCommandLeaseOptions
): CommandOutboxItem[] {
  const now = options.now ?? nextTimestamp(state.sequence++);
  const nowMs = Date.parse(now);
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const maxCommands = options.maxCommands ?? 50;
  const leaseOwnerId = options.leaseOwnerId ?? agentId;
  const leased: CommandOutboxItem[] = [];

  recordMockAgentPollSession(state, agentId, options, now);

  for (const item of state.commandOutbox) {
    if (item.agentId !== agentId || leased.length >= maxCommands) {
      continue;
    }

    const deadlineMs = Date.parse(item.deadlineAt);
    const leaseExpiresMs = item.leaseExpiresAt ? Date.parse(item.leaseExpiresAt) : undefined;
    const isDeadlineExpired = deadlineMs <= nowMs;
    const isPending = item.status === 'pending';
    const isExpiredLease = item.status === 'dispatched' && leaseExpiresMs !== undefined && leaseExpiresMs <= nowMs;
    const shouldReplayUnseenCommand =
      options.sessionId !== undefined &&
      options.lastSeenCommandSeq !== undefined &&
      item.status === 'dispatched' &&
      item.leaseSessionId === options.sessionId &&
      item.ackedAt === undefined &&
      item.seq > options.lastSeenCommandSeq;

    if (isDeadlineExpired && (item.status === 'pending' || item.status === 'dispatched')) {
      item.status = 'expired';
      item.updatedAt = now;
      item.lastError = 'command.deadline.expired';
      const task = state.tasks.find((candidate) => candidate.id === item.taskId);

      if (task) {
        updateMockRuntimeReleaseFromCommandFailure(state, task, item, now, 'command.deadline.expired');
        failMockCommandTask(state, item, now, 'command.deadline.expired');
      }
      continue;
    }

    if (!isPending && !isExpiredLease && !shouldReplayUnseenCommand) {
      continue;
    }

    item.status = 'dispatched';
    item.command = options.sessionId
      ? {
          ...item.command,
          sessionId: options.sessionId
        }
      : item.command;
    item.attempts += 1;
    item.updatedAt = now;
    item.leaseOwnerId = leaseOwnerId;
    item.leaseSessionId = options.sessionId;
    item.leasedAt = now;
    item.leaseExpiresAt = addMilliseconds(now, leaseDurationMs);
    delete item.lastError;
    leased.push(clone(item));
  }

  return leased;
}

function failMockCommandTask(
  state: MockApiState,
  item: CommandOutboxItem,
  observedAt: string,
  reason: RuntimeCommandFailureReason
) {
  const task = state.tasks.find((candidate) => candidate.id === item.taskId);

  if (!task || !['queued', 'running', 'retrying'].includes(task.status)) {
    return false;
  }

  const previousStatus = task.status;
  task.status = 'failed';
  task.updatedAt = observedAt;
  task.rollbackAvailable = false;
  task.failureReason = reason;
  task.progressPercent = 0;
  task.steps = task.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? 'failed' : 'pending'
  }));
  void previousStatus;
  return true;
}

function sweepMockCommandTimeouts(state: MockApiState, options: CommandTimeoutSweepOptions) {
  const now = options.now ?? nextTimestamp(state.sequence++);
  const nowMs = Date.parse(now);
  const ackTimeoutMs = options.ackTimeoutMs ?? 15_000;
  const resultTimeoutMs = options.resultTimeoutMs ?? 120_000;
  const maxCommands = options.maxCommands ?? 500;
  const result = {
    scanned: 0,
    expired: 0,
    deadLettered: 0,
    taskFailures: 0
  };

  for (const item of state.commandOutbox) {
    if (result.scanned >= maxCommands) {
      break;
    }

    if (!['pending', 'dispatched', 'acknowledged'].includes(item.status)) {
      continue;
    }

    result.scanned += 1;

    if (Date.parse(item.deadlineAt) <= nowMs) {
      item.status = 'expired';
      item.updatedAt = now;
      item.lastError = 'command.deadline.expired';
      const task = state.tasks.find((candidate) => candidate.id === item.taskId);

      if (task) {
        updateMockRuntimeReleaseFromCommandFailure(state, task, item, now, 'command.deadline.expired');
      }
      result.expired += 1;
      result.taskFailures += failMockCommandTask(state, item, now, 'command.deadline.expired') ? 1 : 0;
      continue;
    }

    if (item.status === 'dispatched' && item.leasedAt && !item.ackedAt && Date.parse(item.leasedAt) + ackTimeoutMs <= nowMs) {
      item.status = 'dead_letter';
      item.updatedAt = now;
      item.lastError = 'command.ack.timeout';
      const task = state.tasks.find((candidate) => candidate.id === item.taskId);

      if (task) {
        updateMockRuntimeReleaseFromCommandFailure(state, task, item, now, 'command.ack.timeout');
      }
      result.deadLettered += 1;
      result.taskFailures += failMockCommandTask(state, item, now, 'command.ack.timeout') ? 1 : 0;
      continue;
    }

    if (item.status === 'acknowledged' && item.ackedAt && Date.parse(item.ackedAt) + resultTimeoutMs <= nowMs) {
      item.status = 'dead_letter';
      item.updatedAt = now;
      item.lastError = 'command.result.timeout';
      const task = state.tasks.find((candidate) => candidate.id === item.taskId);

      if (task) {
        updateMockRuntimeReleaseFromCommandFailure(state, task, item, now, 'command.result.timeout');
      }
      result.deadLettered += 1;
      result.taskFailures += failMockCommandTask(state, item, now, 'command.result.timeout') ? 1 : 0;
    }
  }

  return result;
}

function createMockRuntimeReleaseArtifacts(
  task: DeployTask,
  command: CommandOutboxItem['command']
):
  | {
      configRevision: RuntimeConfigRevision;
      preflightPlan: RuntimePreflightPlan;
      runtimeSnapshot: RuntimeSnapshot;
    }
  | undefined {
  if (command.type !== 'apply') {
    return undefined;
  }

  const payload = command.payload;
  const moduleKind = payload.moduleKind === 'system' ? 'bbr' : payload.moduleKind;
  const artifactUri = payload.artifactUri ?? `ou-ui://artifacts/config-revisions/${payload.configRevision}.json`;
  const signature = payload.signature ?? createSignature(payload.checksum);
  const preflightPlanId = payload.preflightPlanId ?? `preflight-${task.id}`;
  const snapshotBeforeId = payload.snapshotBeforeId ?? `snapshot-before-${task.targetId}`;

  return {
    configRevision: {
      id: payload.configRevision,
      taskId: task.id,
      operation: task.operation,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      agentId: command.agentId,
      moduleKind,
      artifactUri,
      checksum: payload.checksum,
      signature,
      preflightPlanId,
      snapshotBeforeId,
      status: 'compiled',
      createdAt: task.createdAt,
      createdBy: task.actor,
      diffSummary: {
        added: 1,
        changed: 2,
        removed: 0
      },
      artifact: {
        ...buildRuntimeArtifact({
          task,
          agentId: command.agentId,
          moduleKind
        })
      }
    },
    preflightPlan: {
      id: preflightPlanId,
      taskId: task.id,
      configRevisionId: payload.configRevision,
      targetId: task.targetId,
      agentId: command.agentId,
      moduleKind,
      status: 'pending',
      createdAt: task.createdAt,
      checks: createRuntimePreflightChecks()
    },
    runtimeSnapshot: {
      id: snapshotBeforeId,
      taskId: task.id,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      agentId: command.agentId,
      moduleKind,
      reason: 'pre_apply',
      status: 'captured',
      checksum: createStableSha256LikeHash({
        taskId: task.id,
        targetId: task.targetId,
        moduleKind
      }),
      capturedAt: task.createdAt,
      capturedBy: task.actor,
      state: {
        targetId: task.targetId,
        previousConfigRevision: `cfg-active-${task.targetId}`,
        moduleKind
      }
    }
  };
}

function createRuntimePreflightChecks(): RuntimePreflightPlan['checks'] {
  return [
    {
      id: 'artifact-integrity',
      label: 'Verify runtime artifact checksum and signature',
      status: 'pending',
      severity: 'critical'
    },
    {
      id: 'schema',
      label: 'Validate generated runtime configuration schema',
      status: 'pending',
      severity: 'critical'
    },
    {
      id: 'port-conflict',
      label: 'Check runtime port and tunnel binding conflicts',
      status: 'pending',
      severity: 'critical'
    },
    {
      id: 'runtime-availability',
      label: 'Check required runtime binaries and service availability',
      status: 'pending',
      severity: 'critical'
    },
    {
      id: 'result-verification',
      label: 'Verify Agent applied the expected config revision',
      status: 'pending',
      severity: 'critical'
    },
    {
      id: 'rollback-snapshot',
      label: 'Confirm rollback snapshot availability before apply',
      status: 'pending',
      severity: 'warning'
    }
  ];
}

function createSeedRuntimeEvidence() {
  const failureReason = 'port_conflict: 0.0.0.0:443 is already in use';
  const taskCreatedAt = '2026-06-02T00:00:44.000Z';
  const taskFailedAt = '2026-06-02T00:01:12.000Z';
  const rollbackCreatedAt = '2026-06-02T00:01:14.000Z';
  const rollbackCompletedAt = '2026-06-02T00:01:42.000Z';
  const agentId = 'agent-hkg-01';
  const commandId = 'cmd-seed-forward-port-conflict';
  const taskId = 'task-seed-forward-port-conflict';
  const rollbackTaskId = 'task-seed-forward-port-conflict-rollback';
  const configRevisionId = 'cfg-task-seed-forward-port-conflict';
  const preflightPlanId = 'preflight-task-seed-forward-port-conflict';
  const snapshotBeforeId = 'snapshot-before-forward-hkg-443-seed';
  const sourceTask: DeployTask = {
    id: taskId,
    operation: 'forward.apply',
    resourceType: 'forward',
    resourceId: 'forward-hkg-443',
    status: 'failed',
    targetId: 'forward-hkg-443',
    targetLabel: '端口转发网络',
    summary: '应用端口转发网络规则',
    createdAt: taskCreatedAt,
    updatedAt: taskFailedAt,
    actor: 'sre:seed',
    requestedBy: 'sre:seed',
    requestId: 'req-seed-forward-port-conflict',
    idempotencyKey: 'idem-seed-forward-port-conflict',
    sourceIp: 'ui-seed',
    rollbackAvailable: false,
    attempts: 1,
    progressPercent: 65,
    failureReason,
    rollbackTaskId,
    metadata: {
      retryable: false,
      listenAddress: '0.0.0.0',
      listenPort: 443,
      targetEndpoint: '10.12.0.8:8443',
      agentId,
      configRevisionId,
      preflightPlanId,
      snapshotBeforeId
    },
    steps: [
      { id: 'compile-runtime', label: 'Compile forwarding runtime config', status: 'succeeded' },
      { id: 'preflight-port', label: 'Check listen port availability', status: 'failed' },
      { id: 'apply-runtime', label: 'Apply forwarding runtime', status: 'pending' },
      { id: 'record-audit', label: 'Record audit event', status: 'pending' }
    ]
  };
  const rollbackTask: DeployTask = {
    id: rollbackTaskId,
    operation: 'agent.rollback',
    resourceType: 'forward',
    resourceId: sourceTask.resourceId,
    status: 'succeeded',
    targetId: sourceTask.targetId,
    targetLabel: sourceTask.targetLabel,
    summary: '回滚端口转发网络到上一份快照',
    createdAt: rollbackCreatedAt,
    updatedAt: rollbackCompletedAt,
    actor: 'system:runtime-rollback',
    requestedBy: 'system:runtime-rollback',
    requestId: 'req-seed-forward-port-conflict-rollback',
    idempotencyKey: 'idem-seed-forward-port-conflict-rollback',
    sourceIp: 'system',
    rollbackAvailable: false,
    attempts: 1,
    progressPercent: 100,
    metadata: {
      runtimeRollbackAutomatic: true,
      runtimeRollbackSourceTaskId: taskId,
      runtimeRollbackSourceCommandId: commandId,
      runtimeRollbackSourceConfigRevision: configRevisionId,
      runtimeRollbackReason: failureReason,
      agentId,
      snapshotId: snapshotBeforeId,
      targetConfigRevision: 'cfg-rollback-task-seed-forward-port-conflict',
      rollbackReason: failureReason,
      rollbackMode: 'graceful_restart'
    },
    steps: [
      { id: 'rollback-validate', label: 'Validate rollback snapshot', status: 'succeeded' },
      { id: 'rollback-apply', label: 'Restore forwarding runtime', status: 'succeeded' },
      { id: 'rollback-audit', label: 'Record rollback audit', status: 'succeeded' }
    ]
  };
  const checksum = createStableSha256LikeHash({ taskId, configRevisionId, failureReason });
  const artifact = buildRuntimeArtifact({
    task: sourceTask,
    agentId,
    moduleKind: 'port-forwarding'
  });
  const configRevision: RuntimeConfigRevision = {
    id: configRevisionId,
    taskId,
    operation: sourceTask.operation,
    targetId: sourceTask.targetId,
    targetLabel: sourceTask.targetLabel,
    agentId,
    moduleKind: 'port-forwarding',
    artifactUri: `ou-ui://artifacts/config-revisions/${configRevisionId}.json`,
    checksum,
    signature: createSignature(checksum),
    preflightPlanId,
    snapshotBeforeId,
    status: 'failed',
    createdAt: taskCreatedAt,
    createdBy: sourceTask.actor,
    failedAt: taskFailedAt,
    failureReason,
    healthSummary: {
      runtime: 'preflight_failed',
      failedChecks: ['port-conflict']
    },
    diffSummary: {
      added: 1,
      changed: 1,
      removed: 0
    },
    artifact
  };
  const preflightPlan: RuntimePreflightPlan = {
    id: preflightPlanId,
    taskId,
    configRevisionId,
    targetId: sourceTask.targetId,
    agentId,
    moduleKind: 'port-forwarding',
    status: 'failed',
    checks: createRuntimePreflightChecks().map((check) => ({
      ...check,
      status: check.id === 'port-conflict' ? 'failed' : check.status
    })),
    createdAt: taskCreatedAt,
    completedAt: taskFailedAt,
    failureReason
  };
  const runtimeSnapshot: RuntimeSnapshot = {
    id: snapshotBeforeId,
    taskId,
    targetId: sourceTask.targetId,
    targetLabel: sourceTask.targetLabel,
    agentId,
    moduleKind: 'port-forwarding',
    reason: 'pre_apply',
    status: 'verified',
    checksum: createStableSha256LikeHash({ taskId, snapshotBeforeId }),
    capturedAt: taskCreatedAt,
    capturedBy: sourceTask.actor,
    verifiedAt: taskFailedAt,
    state: {
      targetId: sourceTask.targetId,
      previousConfigRevision: 'cfg-active-forward-hkg-443',
      listenAddress: '0.0.0.0',
      listenPort: 443,
      targetEndpoint: '10.12.0.8:8443'
    }
  };
  const logEvent: Extract<AgentEventEnvelope, { type: 'log_chunk' }> = {
    type: 'log_chunk',
    eventId: 'evt-seed-forward-port-conflict-stderr',
    commandId,
    taskId,
    agentId,
    seq: 44,
    sessionId: 'sess-agent-hkg-01',
    observedAt: taskFailedAt,
    payload: {
      chunkSeq: 1,
      stream: 'stderr',
      content: failureReason
    }
  };
  const archive: AgentLogArchive = {
    id: 'archive-seed-forward-port-conflict',
    agentId,
    sessionIds: [logEvent.sessionId],
    taskId,
    commandId,
    stream: 'stderr',
    bucketStartAt: taskCreatedAt,
    bucketEndAt: taskFailedAt,
    firstObservedAt: taskFailedAt,
    lastObservedAt: taskFailedAt,
    firstSeq: logEvent.seq,
    lastSeq: logEvent.seq,
    firstChunkSeq: logEvent.payload.chunkSeq,
    lastChunkSeq: logEvent.payload.chunkSeq,
    chunkCount: 1,
    contentBytes: failureReason.length,
    contentSha256: createStableSha256LikeHash({ taskId, commandId, content: failureReason }),
    archivedAt: '2026-06-02T00:02:00.000Z',
    source: 'retention-prune'
  };
  const auditLogs = sealAuditLogChain([
    {
      id: 'audit-seed-forward-port-conflict-created',
      action: 'task.created',
      actor: sourceTask.actor,
      scope: 'control-plane:forward',
      resourceType: sourceTask.resourceType,
      operation: sourceTask.operation,
      result: 'accepted',
      targetId: sourceTask.targetId,
      targetLabel: sourceTask.targetLabel,
      taskId,
      severity: 'info',
      message: `${sourceTask.summary} -> task.created`,
      createdAt: taskCreatedAt,
      sourceIp: sourceTask.sourceIp,
      userAgent: 'ou-ui-next-seeded-evidence',
      requestId: sourceTask.requestId,
      requestBodyHash: createStableSha256LikeHash({
        operation: sourceTask.operation,
        targetId: sourceTask.targetId,
        summary: sourceTask.summary
      }),
      after: {
        status: 'created',
        resourceId: sourceTask.resourceId,
        configRevisionId,
        preflightPlanId,
        snapshotBeforeId
      }
    },
    {
      id: 'audit-seed-forward-port-conflict-failed',
      action: 'task.failed',
      actor: 'agent:agent-hkg-01',
      scope: 'control-plane:forward',
      resourceType: sourceTask.resourceType,
      operation: sourceTask.operation,
      result: 'failed',
      targetId: sourceTask.targetId,
      targetLabel: sourceTask.targetLabel,
      taskId,
      severity: 'warning',
      message: `${sourceTask.summary} -> ${failureReason}`,
      createdAt: taskFailedAt,
      sourceIp: 'agent-hkg-01',
      userAgent: 'ou-agent/1.0.0-canary.3',
      requestId: 'req-seed-forward-port-conflict-result',
      requestBodyHash: createStableSha256LikeHash({
        taskId,
        commandId,
        failureReason
      }),
      before: {
        status: 'running'
      },
      after: {
        status: 'failed',
        resourceId: sourceTask.resourceId,
        failureReason,
        failedCheckId: 'port-conflict',
        configRevisionId,
        preflightPlanId,
        snapshotBeforeId
      }
    },
    {
      id: 'audit-seed-forward-port-conflict-rollback-created',
      action: 'task.created',
      actor: rollbackTask.actor,
      scope: 'control-plane:forward',
      resourceType: rollbackTask.resourceType,
      operation: rollbackTask.operation,
      result: 'accepted',
      targetId: rollbackTask.targetId,
      targetLabel: rollbackTask.targetLabel,
      taskId: rollbackTaskId,
      severity: 'info',
      message: `${rollbackTask.summary} -> task.created`,
      createdAt: rollbackCreatedAt,
      sourceIp: rollbackTask.sourceIp,
      userAgent: 'ou-ui-next-runtime-rollback',
      requestId: rollbackTask.requestId,
      requestBodyHash: createStableSha256LikeHash({
        operation: rollbackTask.operation,
        sourceTaskId: taskId,
        snapshotBeforeId
      }),
      before: {
        sourceTaskId: taskId,
        failedConfigRevisionId: configRevisionId
      },
      after: {
        status: 'created',
        resourceId: rollbackTask.resourceId,
        rollbackReason: failureReason,
        snapshotId: snapshotBeforeId
      }
    },
    {
      id: 'audit-seed-forward-port-conflict-rollback-succeeded',
      action: 'task.succeeded',
      actor: 'agent:agent-hkg-01',
      scope: 'control-plane:forward',
      resourceType: rollbackTask.resourceType,
      operation: rollbackTask.operation,
      result: 'succeeded',
      targetId: rollbackTask.targetId,
      targetLabel: rollbackTask.targetLabel,
      taskId: rollbackTaskId,
      severity: 'info',
      message: `${rollbackTask.summary} -> task.succeeded`,
      createdAt: rollbackCompletedAt,
      sourceIp: 'agent-hkg-01',
      userAgent: 'ou-agent/1.0.0-canary.3',
      requestId: 'req-seed-forward-port-conflict-rollback-result',
      requestBodyHash: createStableSha256LikeHash({
        rollbackTaskId,
        snapshotBeforeId,
        restoredConfigRevision: 'cfg-active-forward-hkg-443'
      }),
      before: {
        status: 'running'
      },
      after: {
        status: 'succeeded',
        resourceId: rollbackTask.resourceId,
        restoredSnapshotId: snapshotBeforeId,
        restoredConfigRevision: 'cfg-active-forward-hkg-443'
      }
    }
  ]);

  return {
    tasks: [sourceTask, rollbackTask],
    configRevisions: [configRevision],
    preflightPlans: [preflightPlan],
    runtimeSnapshots: [runtimeSnapshot],
    agentEvents: [logEvent],
    agentLogArchives: [archive],
    auditLogs
  };
}

function inferFailedPreflightCheckIds(failureReason: string | undefined, checks: RuntimePreflightPlan['checks']) {
  const reason = (failureReason ?? '').toLowerCase();
  const matched = new Set<string>();

  const failureRules: Array<[string, RegExp]> = [
    ['artifact-integrity', /(checksum|signature|artifact integrity|artifact checksum)/],
    ['schema', /(schema|config preflight|unsupported runtime artifactversion|artifact does not contain|requires listenport|requires targetport|payload must include a runtime artifact object|unsupported xray inbound protocol)/],
    ['port-conflict', /(port_conflict|port conflict|listen port is not available|address already in use|port_bind|\bbind\b)/],
    ['runtime-availability', /(binary is not installed|gost is required|neither gost nor socat|systemctl is required|did not become active|service|socat|xray binary|nft)/],
    ['result-verification', /(agent_result\.config_revision_mismatch|config revision mismatch|applied config revision)/],
    ['rollback-snapshot', /(snapshot|rollback)/]
  ];

  failureRules.forEach(([id, pattern]) => {
    if (pattern.test(reason)) {
      matched.add(id);
    }
  });

  if (matched.size > 0) {
    return matched;
  }

  return new Set(checks.filter((check) => check.severity === 'critical').map((check) => check.id));
}

function updatePreflightChecksFromResult(
  checks: RuntimePreflightPlan['checks'],
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
) {
  if (agentEvent.payload.status === 'succeeded') {
    return checks.map((check) => ({ ...check, status: 'passed' as const }));
  }

  return updatePreflightChecksForFailure(checks, agentEvent.payload.failureReason);
}

function updatePreflightChecksForFailure(
  checks: RuntimePreflightPlan['checks'],
  failureReason: string | undefined,
  failedCheckIds = inferFailedPreflightCheckIds(failureReason, checks)
) {
  const availableCheckIds = new Set(checks.map((check) => check.id));
  const effectiveFailedCheckIds = [...failedCheckIds].some((id) => availableCheckIds.has(id))
    ? failedCheckIds
    : inferFailedPreflightCheckIds(failureReason, checks);

  return checks.map((check) => ({
    ...check,
    status: effectiveFailedCheckIds.has(check.id) ? ('failed' as const) : check.status
  }));
}

type RuntimeCommandFailureReason = 'command.deadline.expired' | 'command.ack.timeout' | 'command.result.timeout';

function inferCommandFailurePreflightCheckIds(
  outboxItem: CommandOutboxItem,
  failureReason: RuntimeCommandFailureReason,
  checks: RuntimePreflightPlan['checks']
) {
  const failedCheckIds = new Set<string>();

  if (
    failureReason === 'command.result.timeout' ||
    (failureReason === 'command.deadline.expired' && Boolean(outboxItem.ackedAt))
  ) {
    failedCheckIds.add('result-verification');
  } else if (failureReason === 'command.ack.timeout' || failureReason === 'command.deadline.expired') {
    failedCheckIds.add('runtime-availability');
  }

  if (failedCheckIds.size === 0) {
    return inferFailedPreflightCheckIds(failureReason, checks);
  }

  return failedCheckIds;
}

function getExpectedAppliedConfigRevision(command: CommandOutboxItem['command']) {
  if (command.type === 'apply' || command.type === 'reload') {
    return command.payload.configRevision;
  }

  if (command.type === 'rollback') {
    return command.payload.targetConfigRevision;
  }

  return undefined;
}

function markTaskVerifiedByAgentResults(task: DeployTask, outboxItems: CommandOutboxItem[], verifiedAt: string) {
  return markTaskAgentRuntimeDeploymentVerified(task, {
    verifiedAt,
    agentIds: outboxItems.map((item) => item.agentId),
    commandIds: outboxItems.map((item) => item.commandId),
    appliedConfigRevisions: outboxItems.flatMap((item) => getExpectedAppliedConfigRevision(item.command) ?? [])
  });
}

function assertAgentEventMatchesCommandTask(
  agentEvent: Extract<AgentEventEnvelope, { type: 'ack' | 'result' | 'log_chunk' }>,
  outboxItem: CommandOutboxItem
) {
  if (
    outboxItem.taskId === agentEvent.taskId &&
    outboxItem.command.taskId === agentEvent.taskId &&
    outboxItem.command.commandId === agentEvent.commandId &&
    outboxItem.command.agentId === agentEvent.agentId
  ) {
    return;
  }

  throw new MockControlPlaneMutationError('agent_event.command_task_mismatch', {
    denialReason: 'Agent event command, task, and Agent identity must match the command outbox lease.',
    eventTaskId: agentEvent.taskId,
    commandTaskId: outboxItem.taskId,
    commandId: agentEvent.commandId,
    agentId: agentEvent.agentId
  });
}

function isSameLogicalLogChunk(
  left: Extract<AgentEventEnvelope, { type: 'log_chunk' }>,
  right: Extract<AgentEventEnvelope, { type: 'log_chunk' }>
) {
  return (
    left.agentId === right.agentId &&
    left.taskId === right.taskId &&
    left.commandId === right.commandId &&
    left.payload.chunkSeq === right.payload.chunkSeq
  );
}

function normalizeResultEventForCommand(
  command: CommandOutboxItem['command'],
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
): Extract<AgentEventEnvelope, { type: 'result' }> {
  const expectedConfigRevision = getExpectedAppliedConfigRevision(command);

  if (!expectedConfigRevision || agentEvent.payload.status === 'failed') {
    return agentEvent;
  }

  const appliedConfigRevision = agentEvent.payload.appliedConfigRevision;

  if (appliedConfigRevision === expectedConfigRevision) {
    return agentEvent;
  }

  const failureReason = `agent_result.config_revision_mismatch expected=${expectedConfigRevision} actual=${appliedConfigRevision ?? 'missing'}`;

  return {
    ...agentEvent,
    payload: {
      ...agentEvent.payload,
      status: 'failed',
      failureReason,
      retryable: false,
      healthSummary: {
        ...(agentEvent.payload.healthSummary ?? {}),
        runtime: 'command_failed',
        commandType: command.type,
        expectedConfigRevision,
        appliedConfigRevision: appliedConfigRevision ?? null,
        failureReason
      }
    }
  };
}

function updateMockRuntimeReleaseFromResult(
  state: MockApiState,
  task: DeployTask,
  command: CommandOutboxItem['command'],
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
) {
  if (command.type === 'apply') {
    const configRevisionId = command.payload.configRevision;
    const preflightPlanId = command.payload.preflightPlanId ?? `preflight-${task.id}`;
    const snapshotBeforeId = command.payload.snapshotBeforeId ?? `snapshot-before-${task.targetId}`;
    const configRevision = state.configRevisions.find((item) => item.id === configRevisionId);
    const preflightPlan = state.preflightPlans.find((item) => item.id === preflightPlanId);
    const runtimeSnapshot = state.runtimeSnapshots.find((item) => item.id === snapshotBeforeId);

    if (configRevision) {
      configRevision.status = agentEvent.payload.status === 'succeeded' ? 'applied' : 'failed';
      configRevision.appliedAt = agentEvent.payload.status === 'succeeded' ? agentEvent.observedAt : configRevision.appliedAt;
      configRevision.failedAt = agentEvent.payload.status === 'failed' ? agentEvent.observedAt : configRevision.failedAt;
      configRevision.failureReason =
        agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : configRevision.failureReason;
      configRevision.healthSummary = agentEvent.payload.healthSummary ?? configRevision.healthSummary;
    }

    if (preflightPlan) {
      preflightPlan.status = agentEvent.payload.status === 'succeeded' ? 'passed' : 'failed';
      preflightPlan.completedAt = agentEvent.observedAt;
      preflightPlan.failureReason =
        agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : preflightPlan.failureReason;
      preflightPlan.checks = updatePreflightChecksFromResult(preflightPlan.checks, agentEvent);
    }

    if (runtimeSnapshot && agentEvent.payload.status === 'succeeded') {
      runtimeSnapshot.status = 'verified';
      runtimeSnapshot.verifiedAt = agentEvent.observedAt;
    }
  }

  if (command.type === 'rollback' && agentEvent.payload.status === 'rolled_back') {
    const runtimeSnapshot = state.runtimeSnapshots.find((item) => item.id === command.payload.snapshotId);

    if (runtimeSnapshot) {
      runtimeSnapshot.status = 'restored';
      runtimeSnapshot.restoredAt = agentEvent.observedAt;
      runtimeSnapshot.restoredByTaskId = task.id;
    }
  }
}

function updateMockRuntimeReleaseFromCommandFailure(
  state: MockApiState,
  task: DeployTask,
  outboxItem: CommandOutboxItem,
  observedAt: string,
  failureReason: RuntimeCommandFailureReason
) {
  const command = outboxItem.command;

  if (command.type !== 'apply') {
    return;
  }

  const configRevisionId = command.payload.configRevision;
  const preflightPlanId = command.payload.preflightPlanId ?? `preflight-${task.id}`;
  const configRevision = state.configRevisions.find((item) => item.id === configRevisionId);
  const preflightPlan = state.preflightPlans.find((item) => item.id === preflightPlanId);

  if (configRevision) {
    configRevision.status = 'failed';
    configRevision.failedAt = observedAt;
    configRevision.failureReason = failureReason;
    configRevision.healthSummary = {
      ...(configRevision.healthSummary ?? {}),
      runtime: 'command_failed',
      commandType: command.type,
      commandId: outboxItem.commandId,
      agentId: outboxItem.agentId,
      failureReason
    };
  }

  if (preflightPlan) {
    preflightPlan.status = 'failed';
    preflightPlan.completedAt = observedAt;
    preflightPlan.failureReason = failureReason;
    preflightPlan.checks = updatePreflightChecksForFailure(
      preflightPlan.checks,
      failureReason,
      inferCommandFailurePreflightCheckIds(outboxItem, failureReason, preflightPlan.checks)
    );
  }
}

function readHealthSummaryString(
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>,
  key: string
) {
  const value = agentEvent.payload.healthSummary?.[key];
  return typeof value === 'string' ? value : undefined;
}

function shouldCreateHealthFailureRollback(
  task: DeployTask,
  command: CommandOutboxItem['command'],
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
) {
  if (command.type !== 'apply' || agentEvent.payload.status !== 'failed') {
    return false;
  }

  if (task.metadata?.runtimeRollbackAutomatic === true || task.metadata?.runtimeAutoRollback === false) {
    return false;
  }

  const runtimeState = readHealthSummaryString(agentEvent, 'runtime');
  const failureReason = agentEvent.payload.failureReason ?? '';

  return (
    runtimeState === 'unhealthy' ||
    agentEvent.payload.healthSummary?.rollbackRecommended === true ||
    /health check|post-apply health|runtime unhealthy|reload health/i.test(failureReason)
  );
}

function createRuntimeRollbackTaskId(sourceTask: DeployTask, commandId: string, agentId: string) {
  return `task-auto-rollback-${sourceTask.id}-${commandId}-${agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-');
}

function createRuntimeRollbackContext(sourceTask: DeployTask, commandId: string, agentId: string): MutationContext {
  const identity = `${sourceTask.id}:${commandId}:${agentId}`;

  return {
    actor: 'system:runtime-rollback',
    sourceIp: '127.0.0.1',
    userAgent: 'ou-ui-next-runtime-rollback',
    requestId: `req-runtime-rollback-${identity}`,
    idempotencyKey: `runtime-rollback:${identity}`
  };
}

function createAuditForTask(
  task: DeployTask,
  status: 'created' | DeployTaskStatus,
  sequence: number,
  context?: MutationContext,
  beforeStatus?: DeployTaskStatus
): AuditLog {
  const action = status === 'created' ? 'task.created' : (`task.${status}` as const);
  const result =
    status === 'created' ? 'accepted' : status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'accepted';
  const quotaResetBefore =
    status === 'created' && task.operation === 'quota.reset' && task.metadata?.quotaResetAuditBefore && typeof task.metadata.quotaResetAuditBefore === 'object'
      ? task.metadata.quotaResetAuditBefore
      : undefined;
  const quotaResetAfter =
    status === 'created' && task.operation === 'quota.reset' && task.metadata?.quotaResetAuditAfter && typeof task.metadata.quotaResetAuditAfter === 'object'
      ? task.metadata.quotaResetAuditAfter
      : undefined;

  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
    action,
    actor: context?.actor ?? task.actor,
    scope: `control-plane:${task.resourceType}`,
    resourceType: task.resourceType,
    operation: task.operation,
    result,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    taskId: task.id,
    severity: task.status === 'failed' ? 'warning' : 'info',
    message: `${task.summary} -> ${action}`,
    createdAt: nextTimestamp(sequence),
    sourceIp: context?.sourceIp ?? task.sourceIp,
    requestId: context?.requestId ?? task.requestId,
    before: status === 'created' ? quotaResetBefore : { status: beforeStatus },
    after:
      status === 'created' && quotaResetAfter
        ? {
            status,
            resourceId: task.resourceId,
            ...(quotaResetAfter as Record<string, unknown>)
          }
        : { status, resourceId: task.resourceId }
  };
}

function createDeniedAudit(
  input: CreateTaskInput,
  resourceType: DeployTask['resourceType'],
  sequence: number,
  context: MutationContext,
  denialCode: string,
  denialReason: string,
  requestBodyHash: string,
  before?: unknown,
  after?: unknown
): AuditLog {
  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
    action: 'audit.denied',
    actor: context.actor,
    operatorGroupId: context.operatorGroupId,
    resourceGroupId: context.resourceGroupId,
    scope: `control-plane:${resourceType}`,
    resourceType,
    operation: input.operation,
    result: 'denied',
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    taskId: '',
    severity: 'critical',
    message: `${input.summary} -> ${denialCode}`,
    createdAt: nextTimestamp(sequence),
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    requestId: context.requestId,
    requestBodyHash,
    denialCode,
    denialReason,
    before,
    after
  };
}

function createAgentInstallCommandDeniedAudit(
  sequence: number,
  context: MutationContext,
  denialCode: string,
  denialReason: string,
  requestBodyHash: string,
  before?: unknown,
  after?: unknown
): AuditLog {
  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
    action: 'audit.denied',
    actor: context.actor,
    operatorGroupId: context.operatorGroupId,
    resourceGroupId: context.resourceGroupId,
    scope: 'control-plane:agent',
    resourceType: 'agent',
    operation: 'agent.credential.issue',
    result: 'denied',
    targetId: 'agent-enrollment',
    targetLabel: 'Agent enrollment',
    taskId: '',
    severity: 'critical',
    message: `Agent install credential issue -> ${denialCode}`,
    createdAt: nextTimestamp(sequence),
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    requestId: context.requestId,
    requestBodyHash,
    denialCode,
    denialReason,
    before,
    after
  };
}

function createAgentRegistrationDeniedAudit(
  input: AgentRegistrationRequest,
  installCredential: AgentCredentialSummary | undefined,
  sequence: number,
  context: Pick<MutationContext, 'sourceIp' | 'userAgent'> | undefined,
  denialCode: string,
  denialReason: string,
  requestBodyHash: string,
  installTokenPresented: boolean
): AuditLog {
  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
    action: 'audit.denied',
    actor: `agent:${input.agentId}`,
    scope: 'control-plane:agent',
    resourceType: 'agent',
    operation: 'agent.credential.issue',
    result: 'denied',
    targetId: input.agentId,
    targetLabel: input.agentId,
    taskId: '',
    severity: 'critical',
    message: `Agent runtime credential registration -> ${denialCode}`,
    createdAt: nextTimestamp(sequence),
    sourceIp: context?.sourceIp ?? installCredential?.sourceIp ?? '127.0.0.1',
    userAgent: context?.userAgent,
    requestId: input.requestId,
    requestBodyHash,
    denialCode,
    denialReason,
    before: installCredential ? { installCredential } : undefined,
    after: {
      registration: {
        agentId: input.agentId,
        sessionId: input.sessionId,
        version: input.version,
        platform: input.platform,
        capabilities: input.capabilities
      },
      installTokenPresented
    }
  };
}

function uniqueAuditValues(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function createAgentRequestDeniedAudit(
  input: AgentRequestDeniedAuditInput,
  sequence: number
): AuditLog {
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
  const operation =
    input.endpoint === 'poll'
      ? 'agent.poll'
      : input.endpoint === 'events'
        ? 'agent.events'
        : 'agent.credential.rotate';
  const endpointLabel = input.endpoint === 'credential_rotate' ? 'credential rotate' : input.endpoint;
  const after = {
    endpoint: input.endpoint,
    agentIds,
    sessionIds,
    tokenPresented: input.tokenPresented
  };

  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
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
    message: `Agent ${endpointLabel} request denied -> ${input.denialCode}`,
    createdAt: nextTimestamp(sequence),
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

function createOperatorRequestDeniedAudit(input: OperatorRequestDeniedAuditInput, sequence: number): AuditLog {
  const targetId = `${input.method.toUpperCase()} ${input.path}`;

  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
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
    createdAt: nextTimestamp(sequence),
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

function createAgentCredentialIssuedAudit(
  credential: AgentCredentialSummary,
  input: AgentInstallCommandRequest,
  sequence: number,
  context: MutationContext,
  requestBodyHash: string
): AuditLog {
  return {
    id: `audit-${String(sequence).padStart(4, '0')}`,
    action: 'agent.credential.issued',
    actor: context.actor,
    operatorGroupId: context.operatorGroupId,
    resourceGroupId: context.resourceGroupId,
    scope: 'control-plane:agent',
    resourceType: 'agent',
    operation: 'agent.credential.issue',
    result: 'succeeded',
    targetId: credential.agentId,
    targetLabel: credential.agentId,
    taskId: '',
    severity: 'info',
    message: `Agent install credential ${credential.id} issued`,
    createdAt: credential.issuedAt,
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    requestId: context.requestId,
    requestBodyHash,
    after: {
      credential,
      installProfile: [...input.installProfile]
    }
  };
}

export function createMockApi(options: CreateMockApiOptions = {}): ControlPlaneApi {
  const readModelNow = options.readModelNow ?? (() => new Date().toISOString());
  const seedInventory = options.seedInventory ?? false;
  const seedRuntimeEvidence = seedInventory && options.seedRuntimeEvidence ? createSeedRuntimeEvidence() : undefined;
  const initialNow = readModelNow();
  const state: MockApiState = {
    agents: clone(options.inventory?.agents ?? (seedInventory ? seedAgents : [])),
    nodes: clone(seedInventory ? seedNodes : []),
    inbounds: clone(seedInventory ? seedInbounds : []),
    subscriptionSources: clone(seedInventory ? seedSubscriptionSources : []),
    subscriptionInventoryNodes: [],
    subscriptionBundles: clone(seedInventory ? seedSubscriptionBundles : []),
    subscriptionClients: clone(seedInventory ? seedSubscriptionClients : []),
    subscriptionExportProfiles: [],
    forwardRules: clone(options.inventory?.forwardRules ?? (seedInventory ? seedForwardRules : [])),
    quotaPolicies: clone(options.inventory?.quotaPolicies ?? (seedInventory ? seedQuotaPolicies : [])),
    rateLimitPolicies: clone(seedInventory ? seedRateLimitPolicies : []),
    permissionGrants: clone(seedPermissionGrants),
    configRevisions: clone(seedRuntimeEvidence?.configRevisions ?? []),
    preflightPlans: clone(seedRuntimeEvidence?.preflightPlans ?? []),
    runtimeSnapshots: clone(seedRuntimeEvidence?.runtimeSnapshots ?? []),
    trafficRollups: [],
    trafficRollupCompactions: [],
    agentLogArchives: clone(seedRuntimeEvidence?.agentLogArchives ?? []),
    routingPolicies: clone(seedInventory ? seedRoutingPolicies : []),
    tuningProfiles: clone(seedInventory ? seedTuningProfiles : []),
    tasks: clone(seedRuntimeEvidence?.tasks ?? seedTasks),
    commandOutbox: [],
    agentEvents: clone(seedRuntimeEvidence?.agentEvents ?? []),
    agentSessions: [],
    agentCredentials: [],
    operatorSessions: clone(seedInventory ? seedOperatorSessions : []),
    telegramBotSettings: createDefaultTelegramBotSettings(initialNow),
    telegramChatBindings: [],
    telegramCustomerBindings: [],
    telegramBindingChallenges: [],
    telegramBindingChallengeSecrets: [],
    telegramNotificationPolicies: [createDefaultTelegramNotificationPolicy(initialNow)],
    telegramNotificationDeliveries: [],
    auditLogs: clone(seedRuntimeEvidence?.auditLogs ?? seedAuditLogs),
    taskIdempotencyIndex: {},
    agentLogRetentionPolicy: {
      maxAgeMs: MOCK_AGENT_LOG_RETENTION_MAX_AGE_MS,
      maxAgeDays: MOCK_AGENT_LOG_RETENTION_MAX_AGE_MS / 24 / 60 / 60 / 1000,
      maxEventsPerAgent: MOCK_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT,
      source: 'runtime-config'
    },
    trafficRollupRetentionPolicy: {
      ...MOCK_TRAFFIC_ROLLUP_RETENTION_RUNTIME_DEFAULT,
      source: 'runtime-config',
      runtimeDefault: clone(MOCK_TRAFFIC_ROLLUP_RETENTION_RUNTIME_DEFAULT)
    },
    sequence: 1
  };

  function appendAudit(
    task: DeployTask,
    status: 'created' | DeployTaskStatus,
    context?: MutationContext,
    beforeStatus?: DeployTaskStatus
  ) {
    appendAuditLog(createAuditForTask(task, status, state.sequence++, context, beforeStatus));
  }

  function appendAuditLog(audit: AuditLog) {
    const auditWithPrevHash = {
      ...audit,
      prevHash: state.auditLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    state.auditLogs.unshift({
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    });
  }

  function appendDeniedAudit(
    input: CreateTaskInput,
    resourceType: DeployTask['resourceType'],
    context: MutationContext,
    denialCode: string,
    denialReason: string,
    requestBodyHash: string,
    before?: unknown,
    after?: unknown
  ) {
    appendAuditLog(
      createDeniedAudit(
        input,
        resourceType,
        state.sequence++,
        context,
        denialCode,
        denialReason,
        requestBodyHash,
        before,
        after
      )
    );
  }

  function enqueueRuntimeHealthRollbackTask(
    sourceTask: DeployTask,
    failedOutboxItem: CommandOutboxItem,
    agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
  ) {
    const command = failedOutboxItem.command;

    if (!shouldCreateHealthFailureRollback(sourceTask, command, agentEvent) || command.type !== 'apply') {
      return undefined;
    }

    const rollbackTaskId = createRuntimeRollbackTaskId(sourceTask, failedOutboxItem.commandId, failedOutboxItem.agentId);
    const existingRollbackTask = state.tasks.find((task) => task.id === rollbackTaskId);

    if (existingRollbackTask) {
      return existingRollbackTask;
    }

    const context = createRuntimeRollbackContext(sourceTask, failedOutboxItem.commandId, failedOutboxItem.agentId);
    const rollbackConfigRevision = `cfg-rollback-${sourceTask.id}-${failedOutboxItem.agentId}`.replace(/[^a-zA-Z0-9_.@-]/g, '-');
    const rollbackReason = agentEvent.payload.failureReason ?? 'runtime health check failed after apply';
    const rollbackTask: DeployTask = {
      id: rollbackTaskId,
      operation: 'agent.rollback',
      resourceType: sourceTask.resourceType,
      resourceId: sourceTask.resourceId,
      status: 'queued',
      targetId: sourceTask.targetId,
      targetLabel: sourceTask.targetLabel,
      summary: `Auto rollback after failed runtime health check: ${sourceTask.targetLabel}`,
      createdAt: agentEvent.observedAt,
      updatedAt: agentEvent.observedAt,
      actor: context.actor,
      requestedBy: context.actor,
      requestId: context.requestId,
      idempotencyKey: context.idempotencyKey,
      sourceIp: context.sourceIp,
      rollbackAvailable: false,
      attempts: 0,
      progressPercent: 0,
      steps: createTaskSteps(`Auto rollback ${sourceTask.targetLabel}`),
      metadata: {
        runtimeRollbackAutomatic: true,
        runtimeRollbackSourceTaskId: sourceTask.id,
        runtimeRollbackSourceCommandId: failedOutboxItem.commandId,
        runtimeRollbackSourceConfigRevision: command.payload.configRevision,
        runtimeRollbackReason: rollbackReason,
        agentId: failedOutboxItem.agentId,
        snapshotId: command.payload.snapshotBeforeId ?? `snapshot-before-${sourceTask.targetId}`,
        targetConfigRevision: rollbackConfigRevision,
        rollbackReason,
        rollbackMode: command.payload.applyMode ?? 'graceful_restart'
      }
    };
    const [rollbackOutboxItem] = createCommandOutboxItems(rollbackTask, state.sequence, [failedOutboxItem.agentId]);
    state.sequence += 1;

    state.tasks.unshift(rollbackTask);
    state.commandOutbox.unshift(rollbackOutboxItem);
    appendAudit(rollbackTask, 'created', context);

    return rollbackTask;
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

  function listLiveQuotaPolicies() {
    const now = readModelNow();
    const liveInbounds = applyXrayTrafficWindowToReadModel(state.inbounds, now);
    const quotaResetReplayState = createQuotaResetReplayState(state.tasks);
    const liveSubscriptionClients = projectSubscriptionClientReadModels(
      state.subscriptionClients,
      liveInbounds,
      state.subscriptionInventoryNodes,
      quotaResetReplayState,
      now
    );

    return createQuotaPoliciesFromReadModels({
      agents: applyAgentLivenessToReadModel(state.agents, now),
      inbounds: liveInbounds,
      forwardRules: applyForwardingBillingWindowToReadModel(state.forwardRules, now),
      subscriptionClients: liveSubscriptionClients,
      quotaPolicies: applyQuotaResetTasksToExplicitPolicies(state.quotaPolicies, state.tasks)
    });
  }

  function listLiveForwardRulesForQuotaEnforcement() {
    return applyForwardingBillingWindowToReadModel(state.forwardRules, readModelNow());
  }

  function listLiveInboundsForGuardrailEnforcement() {
    return applyXrayTrafficWindowToReadModel(state.inbounds, readModelNow());
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
    const intents = deriveForwardQuotaEnforcementTaskIntents(
      state.tasks,
      beforeRules,
      listLiveForwardRulesForQuotaEnforcement(),
      listLiveQuotaPolicies(),
      trigger
    );

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  async function enqueueDerivedXrayGuardrailTasks(trigger: { kind: 'agent-event' | 'task'; id: string; observedAt: string }) {
    const intents = deriveXrayGuardrailTaskIntents(state.tasks, listLiveInboundsForGuardrailEnforcement(), trigger);

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  function applyTaskTransition(
    task: DeployTask,
    status: DeployTaskStatus,
    context?: MutationContext,
    observedAt?: string,
    failureReason?: string
  ) {
    const previousStatus = task.status;
    assertValidTaskTransition(previousStatus, status);

    task.status = status;
    task.updatedAt = observedAt ?? nextTimestamp(state.sequence++);
    task.rollbackAvailable = status === 'succeeded';
    task.failureReason = failureReason;
    task.progressPercent = status === 'queued' ? 0 : status === 'running' ? 45 : status === 'succeeded' ? 100 : 0;
    task.steps = task.steps.map((step, index) => ({
      ...step,
      status:
        status === 'running'
          ? index === 0
            ? 'succeeded'
            : index === 1
              ? 'running'
              : 'pending'
          : status === 'succeeded'
            ? 'succeeded'
            : status === 'failed'
              ? index === 0
                ? 'failed'
                : 'pending'
              : step.status
    }));

    if (status === 'running' || status === 'retrying') {
      task.attempts += 1;
    }

    appendAudit(task, status, context, previousStatus);
  }

  function applyPermissionGrant(input: CreateTaskInput, context: MutationContext, timestamp: string) {
    if (input.operation !== 'permission.grant' || !input.permissionChange) {
      return;
    }

    const grant: PermissionGrant = {
      id: input.targetId,
      subjectType: input.permissionChange.subjectType,
      subjectId: input.permissionChange.subjectId,
      resourceType: input.permissionChange.resourceType,
      resourceId: input.permissionChange.resourceId,
      permissions: input.permissionChange.permissions,
      expiresAt: input.permissionChange.expiresAt,
      grantedBy: context.actor,
      reason: input.permissionChange.reason,
      resourceVersion: `permv-${String(state.sequence).padStart(4, '0')}`,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    state.permissionGrants = [grant, ...state.permissionGrants.filter((item) => item.id !== grant.id)];
  }

  function applyPermissionRevoke(input: CreateTaskInput, context: MutationContext, timestamp: string) {
    if (input.operation !== 'permission.revoke' || !input.permissionChange) {
      return;
    }

    const grant = state.permissionGrants.find((item) => item.id === input.targetId);

    if (!grant || grant.revokedAt) {
      return;
    }

    const revokedGrant: PermissionGrant = {
      ...grant,
      revokedAt: timestamp,
      revokedBy: context.actor,
      revokedReason: input.permissionChange.reason,
      resourceVersion: `permv-${String(state.sequence).padStart(4, '0')}`,
      updatedAt: timestamp
    };

    state.permissionGrants = [revokedGrant, ...state.permissionGrants.filter((item) => item.id !== revokedGrant.id)];
  }

  function appendTelegramAuditLog(input: {
    action: AuditLog['action'];
    operation: AuditLog['operation'];
    targetId: string;
    targetLabel: string;
    message: string;
    context: MutationContext;
    before?: unknown;
    after?: unknown;
  }) {
    const createdAt = nextTimestamp(state.sequence);

    appendAuditLog({
      id: `audit-telegram-${String(state.sequence++).padStart(4, '0')}`,
      action: input.action,
      actor: input.context.actor,
      operatorGroupId: input.context.operatorGroupId,
      resourceGroupId: input.context.resourceGroupId,
      scope: 'control-plane:telegram-bot',
      resourceType: 'integration',
      operation: input.operation,
      result: 'succeeded',
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      taskId: '',
      severity: 'info',
      message: input.message,
      createdAt,
      sourceIp: input.context.sourceIp,
      userAgent: input.context.userAgent,
      requestId: input.context.requestId,
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {})
    });
  }

  function listTelegramBindingReadModels() {
    return state.telegramCustomerBindings
      .map((binding) =>
        createTelegramBindingModels({
          binding,
          chats: state.telegramChatBindings,
          policies: state.telegramNotificationPolicies,
          deliveries: state.telegramNotificationDeliveries
        })
      )
      .filter((binding): binding is TelegramBindingReadModel => Boolean(binding))
      .sort((left, right) => right.customerBinding.createdAt.localeCompare(left.customerBinding.createdAt));
  }

  const api: ControlPlaneApi = {
    async getSnapshot() {
      const [
        apiBoundary,
        agents,
        customers,
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionInventoryNodes,
        subscriptionBundles,
        subscriptionClients,
        subscriptionExportProfiles,
        proxyProviders,
        subscriptionExportFiles,
        forwardRules,
        quotaPolicies,
        rateLimitPolicies,
        permissionGrants,
        routingPolicies,
        tuningProfiles,
        tasks,
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        trafficRollupCompactions,
        systemAlerts,
        agentLogRetentionPolicy,
        trafficRollupRetentionPolicy,
        agentCredentials,
        agentSessions,
        agentLogChunks,
        agentLogArchives,
        telegramBotSettings,
        telegramBindings,
        telegramNotificationPolicies,
        telegramNotificationDeliveries,
        auditLogs
      ] = await Promise.all([
        api.getApiBoundary(),
        api.listAgents(),
        api.listCustomers(),
        api.listNodes(),
        api.listInbounds(),
        api.listSubscriptionSources(),
        api.listSubscriptionInventoryNodes(),
        api.listSubscriptionBundles(),
        api.listSubscriptionClients(),
        api.listSubscriptionExportProfiles(),
        api.listProxyProviders(),
        api.listSubscriptionExportFiles(),
        api.listForwardRules(),
        api.listQuotaPolicies(),
        api.listRateLimitPolicies(),
        api.listPermissionGrants(),
        api.listRoutingPolicies(),
        api.listTuningProfiles(),
        api.listTasks(),
        api.listConfigRevisions(),
        api.listPreflightPlans(),
        api.listRuntimeSnapshots(),
        api.listTrafficRollups(),
        api.listTrafficRollupCompactions(),
        api.listSystemAlerts(),
        api.getAgentLogRetentionPolicy(),
        api.getTrafficRollupRetentionPolicy(),
        api.listAgentCredentials(),
        api.listAgentSessions(),
        api.listAgentLogChunks({ limit: 200 }),
        api.listAgentLogArchives({ limit: 200 }),
        api.getTelegramBotSettings(),
        api.listTelegramBindings(),
        api.listTelegramNotificationPolicies(),
        api.listTelegramNotificationDeliveries(),
        api.listAuditLogs()
      ]);

      return {
        apiBoundary,
        agents,
        customers,
        nodes,
        inbounds,
        subscriptionSources,
        subscriptionInventoryNodes,
        subscriptionBundles,
        subscriptionClients,
        subscriptionExportProfiles,
        proxyProviders,
        subscriptionExportFiles,
        forwardRules,
        quotaPolicies,
        rateLimitPolicies,
        permissionGrants,
        routingPolicies,
        tuningProfiles,
        tasks,
        commandOutbox: state.commandOutbox.map(summarizeCommandOutboxItem),
        configRevisions,
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        trafficRollupCompactions,
        systemAlerts,
        agentLogRetentionPolicy,
        trafficRollupRetentionPolicy,
        agentCredentials,
        agentSessions,
        agentLogChunks,
        agentLogArchives,
        telegramBotSettings,
        telegramBindings,
        telegramNotificationPolicies,
        telegramNotificationDeliveries,
        auditLogs
      };
    },

    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async getAgentLogRetentionPolicy() {
      return clone(state.agentLogRetentionPolicy);
    },

    async updateAgentLogRetentionPolicy(input: AgentLogRetentionPolicyUpdateInput, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const before = clone(state.agentLogRetentionPolicy);
      state.agentLogRetentionPolicy = {
        maxAgeMs: Math.round(input.maxAgeDays * 24 * 60 * 60 * 1000),
        maxAgeDays: input.maxAgeDays,
        maxEventsPerAgent: input.maxEventsPerAgent,
        source: 'control-plane'
      };

      appendAuditLog({
        id: `audit-agent-log-retention-${state.sequence}`,
        action: 'agent.log_retention.updated',
        actor: resolvedContext.actor,
        operatorGroupId: resolvedContext.operatorGroupId,
        resourceGroupId: resolvedContext.resourceGroupId,
        scope: 'control-plane:agent-log-retention',
        resourceType: 'agent',
        operation: 'agent.log_retention.update',
        result: 'succeeded',
        targetId: 'agent-log-retention-policy',
        targetLabel: 'Agent log retention policy',
        taskId: '',
        severity: 'warning',
        message: 'Agent log retention policy updated',
        createdAt: nextTimestamp(state.sequence),
        sourceIp: resolvedContext.sourceIp,
        userAgent: resolvedContext.userAgent,
        requestId: resolvedContext.requestId,
        before,
        after: {
          ...state.agentLogRetentionPolicy,
          reason: input.reason
        }
      });
      state.sequence += 1;

      return clone(state.agentLogRetentionPolicy);
    },

    async getTrafficRollupRetentionPolicy() {
      return clone(state.trafficRollupRetentionPolicy);
    },

    async updateTrafficRollupRetentionPolicy(input: TrafficRollupRetentionPolicyUpdateInput, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const before = clone(state.trafficRollupRetentionPolicy);
      const controlPlaneOverride = {
        maxAgeMs: Math.round(input.maxAgeDays * 24 * 60 * 60 * 1000),
        maxAgeDays: input.maxAgeDays,
        maxRecordsPerScope: input.maxRecordsPerScope
      };
      state.trafficRollupRetentionPolicy = {
        ...controlPlaneOverride,
        source: 'control-plane',
        runtimeDefault: clone(before.runtimeDefault),
        controlPlaneOverride
      };

      appendAuditLog({
        id: `audit-traffic-rollup-retention-${state.sequence}`,
        action: 'traffic.rollup_retention.updated',
        actor: resolvedContext.actor,
        operatorGroupId: resolvedContext.operatorGroupId,
        resourceGroupId: resolvedContext.resourceGroupId,
        scope: 'control-plane:traffic-rollup-retention',
        resourceType: 'quota',
        operation: 'traffic.rollup_retention.update',
        result: 'succeeded',
        targetId: 'traffic-rollup-retention-policy',
        targetLabel: 'Traffic rollup retention policy',
        taskId: '',
        severity: 'warning',
        message: 'Traffic rollup retention policy updated',
        createdAt: nextTimestamp(state.sequence),
        sourceIp: resolvedContext.sourceIp,
        userAgent: resolvedContext.userAgent,
        requestId: resolvedContext.requestId,
        before,
        after: {
          ...state.trafficRollupRetentionPolicy,
          reason: input.reason
        }
      });
      state.sequence += 1;

      return clone(state.trafficRollupRetentionPolicy);
    },

    async getObservabilityMetrics(
      externalAlerts = [],
      runtimeMetrics: ControlPlaneRuntimeObservabilityMetricsArgument = 0
    ) {
      const now = readModelNow();
      const liveAgents = applyAgentLivenessToReadModel(state.agents, now);
      const quotaPolicies = listLiveQuotaPolicies();
      const systemAlerts = [
        ...createSystemAlertsFromAgents(liveAgents, now),
        ...createSystemAlertsFromCommandOutbox(state.commandOutbox, now),
        ...createSystemAlertsFromRuntimeTasks(state.tasks, now),
        ...createSystemAlertsFromQuotaPolicies(quotaPolicies, now),
        ...createSystemAlertsFromSubscriptionSources(state.subscriptionSources, now),
        ...externalAlerts
      ];

      return createObservabilityMetrics({
        generatedAt: now,
        tasks: state.tasks,
        commandOutbox: state.commandOutbox,
        agents: liveAgents,
        systemAlerts,
        systemAlertNotificationDeliveries: [],
        telegramNotificationDeliveries: state.telegramNotificationDeliveries,
        quotaPolicies,
        agentEvents: state.agentEvents,
        agentLogArchives: state.agentLogArchives,
        trafficRollups: state.trafficRollups,
        trafficRollupCompactions: state.trafficRollupCompactions,
        audit: verifyAuditLogs(clone(state.auditLogs)),
        auditLogs: state.auditLogs,
        runtimeMetrics
      });
    },

    async listAgents() {
      return clone(applyAgentLivenessToReadModel(state.agents, readModelNow()));
    },

    async listCustomers() {
      const now = readModelNow();
      const liveInbounds = applyXrayTrafficWindowToReadModel(state.inbounds, now);
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        state.subscriptionClients,
        liveInbounds,
        state.subscriptionInventoryNodes,
        createQuotaResetReplayState(state.tasks),
        now
      );

      return clone(
        createCustomersFromReadModels({
          inbounds: liveInbounds,
          subscriptionClients: liveSubscriptionClients,
          forwardRules: applyForwardingBillingWindowToReadModel(state.forwardRules, now),
          nowIso: now
        })
      );
    },

    async listSystemAlerts(_query, externalAlerts = []) {
      const now = readModelNow();
      const quotaPolicies = listLiveQuotaPolicies();
      return clone([
        ...createSystemAlertsFromAgents(applyAgentLivenessToReadModel(state.agents, now), now),
        ...createSystemAlertsFromCommandOutbox(state.commandOutbox, now),
        ...createSystemAlertsFromRuntimeTasks(state.tasks, now),
        ...createSystemAlertsFromQuotaPolicies(quotaPolicies, now),
        ...createSystemAlertsFromSubscriptionSources(state.subscriptionSources, now),
        ...externalAlerts
      ]);
    },

    async listNodes() {
      return clone(state.nodes);
    },

    async listInbounds() {
      return clone(applyXrayTrafficWindowToReadModel(state.inbounds, readModelNow()));
    },

    async listSubscriptionSources() {
      return clone(state.subscriptionSources);
    },

    async listSubscriptionInventoryNodes() {
      return clone(state.subscriptionInventoryNodes);
    },

    async listSubscriptionBundles() {
      return clone(
        createSubscriptionBundlesFromInventory(
          state.subscriptionSources,
          state.subscriptionInventoryNodes,
          state.subscriptionExportProfiles,
          state.subscriptionBundles
        )
      );
    },

    async listSubscriptionClients() {
      const now = readModelNow();
      return clone(
        projectSubscriptionClientReadModels(
          state.subscriptionClients,
          applyXrayTrafficWindowToReadModel(state.inbounds, now),
          state.subscriptionInventoryNodes,
          createQuotaResetReplayState(state.tasks),
          now
        )
      );
    },

    async listSubscriptionExportProfiles() {
      return clone(state.subscriptionExportProfiles);
    },

    async listProxyProviders() {
      return clone(createProxyProvidersFromSources(state.subscriptionSources));
    },

    async listSubscriptionExportFiles() {
      const now = readModelNow();
      const providers = createProxyProvidersFromSources(state.subscriptionSources);
      return clone(
        createSubscriptionExportFilesFromClients(
          projectSubscriptionClientReadModels(
            state.subscriptionClients,
            applyXrayTrafficWindowToReadModel(state.inbounds, now),
            state.subscriptionInventoryNodes,
            createQuotaResetReplayState(state.tasks),
            now
          ),
          providers,
          state.subscriptionExportProfiles
        )
      );
    },

    async listForwardRules() {
      return clone(applyForwardingBillingWindowToReadModel(state.forwardRules, readModelNow()));
    },

    async listQuotaPolicies() {
      return clone(listLiveQuotaPolicies());
    },

    async listRateLimitPolicies() {
      return clone(state.rateLimitPolicies);
    },

    async listPermissionGrants() {
      return clone(state.permissionGrants);
    },

    async listRoutingPolicies() {
      return clone(state.routingPolicies);
    },

    async listTuningProfiles() {
      return clone(state.tuningProfiles);
    },

    async listTasks() {
      return clone(state.tasks);
    },

    async listCommandOutbox() {
      return clone(state.commandOutbox);
    },

    async listAgentSessions() {
      return clone(
        state.agentSessions.map((session) => ({
          ...session,
          capabilities:
            session.capabilities ??
            readMockCredentialSessionCapabilities(
              findMockRuntimeCredentialForSession(state, session.agentId, session.sessionId)
            )
        }))
      );
    },

    async listAgentCredentials() {
      return clone(state.agentCredentials.map(sanitizeAgentCredential));
    },

    async listOperatorSessions() {
      return clone(state.operatorSessions);
    },

    async listConfigRevisions() {
      return clone(state.configRevisions);
    },

    async listPreflightPlans() {
      return clone(state.preflightPlans);
    },

    async listRuntimeSnapshots() {
      return clone(state.runtimeSnapshots);
    },

    async listTrafficRollups(query) {
      return clone(selectTrafficRollups(state.trafficRollups, query));
    },

    async listTrafficRollupCompactions(query) {
      return clone(selectTrafficRollupCompactions(state.trafficRollupCompactions, query));
    },

    async listAgentLogChunks(query) {
      return selectAgentLogChunks(state.agentEvents, query);
    },

    async listAgentLogArchives(query) {
      return clone(selectAgentLogArchives(state.agentLogArchives, query));
    },

    async exportAgentLogChunks(query) {
      return createAgentLogExport(state.agentEvents, query, readModelNow());
    },

    async exportAgentLogArchives(query) {
      return clone(createAgentLogArchiveExport(state.agentLogArchives, query, readModelNow()));
    },

    async exportTrafficRollups(query) {
      return clone(createTrafficRollupExport(state.trafficRollups, query, readModelNow()));
    },

    async exportTrafficRollupCompactions(query) {
      return clone(createTrafficRollupCompactionExport(state.trafficRollupCompactions, query, readModelNow()));
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? state.auditLogs));
    },

    async getTelegramBotSettings() {
      return clone(state.telegramBotSettings);
    },

    async updateTelegramBotSettings(input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const before = clone(state.telegramBotSettings);
      state.telegramBotSettings = applyTelegramBotSettingsUpdate(
        state.telegramBotSettings,
        input,
        nextTimestamp(state.sequence),
        resolvedContext.actor
      );

      appendTelegramAuditLog({
        action: 'telegram_bot.settings.updated',
        operation: 'telegram_bot.settings.update',
        targetId: 'telegram-bot',
        targetLabel: 'Telegram Bot',
        message: 'Telegram Bot settings updated',
        context: resolvedContext,
        before: redactTelegramBotSettingsAudit(before),
        after: redactTelegramBotSettingsAudit(state.telegramBotSettings, input.reason)
      });

      return clone(state.telegramBotSettings);
    },

    async testTelegramBotNotification(input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const now = nextTimestamp(state.sequence);
      const delivery = createTelegramTestDelivery({
        request: input,
        settings: state.telegramBotSettings,
        now,
        sequence: state.sequence
      });
      state.telegramNotificationDeliveries = [delivery, ...state.telegramNotificationDeliveries].slice(
        0,
        state.telegramBotSettings.deliveryHistoryLimit
      );
      state.telegramBotSettings = {
        ...state.telegramBotSettings,
        lastTestAt: now,
        lastDeliveryAt: delivery.status === 'pending' ? now : state.telegramBotSettings.lastDeliveryAt,
        lastDeliveryError: delivery.status === 'suppressed' ? 'telegram bot is not enabled or token is not configured' : undefined,
        updatedAt: now,
        updatedBy: resolvedContext.actor
      };

      appendTelegramAuditLog({
        action: 'telegram_bot.test_sent',
        operation: 'telegram_bot.test',
        targetId: delivery.id,
        targetLabel: delivery.templateId,
        message: 'Telegram Bot test notification queued',
        context: resolvedContext,
        after: {
          ...delivery,
          adminChatId: delivery.adminChatId ? '[redacted-chat-id]' : undefined
        }
      });

      return clone(delivery);
    },

    async listTelegramBindings() {
      return clone(listTelegramBindingReadModels());
    },

    async createTelegramBinding(input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const now = nextTimestamp(state.sequence);
      const { chat, binding } = createTelegramBindingRecord({
        request: input,
        customers: await api.listCustomers(),
        now,
        actor: resolvedContext.actor,
        sequence: state.sequence
      });
      state.telegramChatBindings = [chat, ...state.telegramChatBindings.filter((item) => item.id !== chat.id)];
      state.telegramCustomerBindings = [
        binding,
        ...state.telegramCustomerBindings.filter((item) => item.id !== binding.id)
      ];

      appendTelegramAuditLog({
        action: 'telegram_binding.created',
        operation: 'telegram_binding.create',
        targetId: binding.id,
        targetLabel: binding.customerNameSnapshot,
        message: 'Telegram customer binding created',
        context: resolvedContext,
        after: {
          ...binding,
          telegramChatId: '[redacted-chat-id]',
          telegramUserId: chat.telegramUserId ? '[redacted-user-id]' : undefined
        }
      });

      const readModel = listTelegramBindingReadModels().find((item) => item.id === binding.id);

      if (!readModel) {
        throw new Error(`Telegram binding read model was not created: ${binding.id}`);
      }

      return clone(readModel);
    },

    async revokeTelegramBinding(bindingId, input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const before = state.telegramCustomerBindings.find((binding) => binding.id === bindingId);

      if (!before) {
        throw new Error(`Telegram binding not found: ${bindingId}`);
      }

      const revoked: TelegramCustomerBinding = {
        ...before,
        status: 'revoked',
        revokedAt: nextTimestamp(state.sequence),
        revokedBy: resolvedContext.actor,
        revokeReason: input.reason
      };
      state.telegramCustomerBindings = state.telegramCustomerBindings.map((binding) =>
        binding.id === bindingId ? revoked : binding
      );

      appendTelegramAuditLog({
        action: 'telegram_binding.revoked',
        operation: 'telegram_binding.revoke',
        targetId: revoked.id,
        targetLabel: revoked.customerNameSnapshot,
        message: 'Telegram customer binding revoked',
        context: resolvedContext,
        before,
        after: revoked
      });

      const readModel = listTelegramBindingReadModels().find((item) => item.id === bindingId);

      if (!readModel) {
        throw new Error(`Telegram binding read model not found after revoke: ${bindingId}`);
      }

      return clone(readModel);
    },

    async createTelegramBindingChallenge(input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const result = createTelegramBindingChallengeRecord({
        request: input,
        customers: await api.listCustomers(),
        now: nextTimestamp(state.sequence),
        actor: resolvedContext.actor,
        sequence: state.sequence
      });
      state.telegramBindingChallenges = [result.challenge, ...state.telegramBindingChallenges];
      state.telegramBindingChallengeSecrets = [
        {
          challengeId: result.challenge.id,
          codeHash: createStableTelegramHash(result.code.trim().toUpperCase()),
          createdAt: result.challenge.createdAt,
          expiresAt: result.challenge.expiresAt
        },
        ...state.telegramBindingChallengeSecrets.filter((secret) => secret.challengeId !== result.challenge.id)
      ];

      appendTelegramAuditLog({
        action: 'telegram_binding_challenge.created',
        operation: 'telegram_binding_challenge.create',
        targetId: result.challenge.id,
        targetLabel: result.challenge.customerNameSnapshot,
        message: 'Telegram binding challenge created',
        context: resolvedContext,
        after: result.challenge
      });

      return clone(result);
    },

    async listTelegramBindingChallenges() {
      return clone(state.telegramBindingChallenges);
    },

    async listTelegramNotificationPolicies() {
      return clone(state.telegramNotificationPolicies);
    },

    async updateTelegramNotificationPolicy(policyId, input, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const current =
        state.telegramNotificationPolicies.find((policy) => policy.id === policyId)
        ?? (policyId === TELEGRAM_DEFAULT_POLICY_ID
          ? createDefaultTelegramNotificationPolicy(nextTimestamp(state.sequence), resolvedContext.actor)
          : undefined);

      if (!current) {
        throw new Error(`Telegram notification policy not found: ${policyId}`);
      }

      const updated = applyTelegramNotificationPolicyUpdate(
        current,
        input,
        nextTimestamp(state.sequence),
        resolvedContext.actor
      );
      state.telegramNotificationPolicies = [
        updated,
        ...state.telegramNotificationPolicies.filter((policy) => policy.id !== updated.id)
      ];

      appendTelegramAuditLog({
        action: 'telegram_notification_policy.updated',
        operation: 'telegram_notification_policy.update',
        targetId: updated.id,
        targetLabel: updated.ownerId,
        message: 'Telegram notification policy updated',
        context: resolvedContext,
        before: current,
        after: {
          ...updated,
          reason: input.reason
        }
      });

      return clone(updated);
    },

    async listTelegramNotificationDeliveries() {
      return clone(state.telegramNotificationDeliveries);
    },

    async retryTelegramNotificationDelivery(deliveryId, context) {
      const resolvedContext = resolveMutationContext(context, state.sequence);
      const current = state.telegramNotificationDeliveries.find((delivery) => delivery.id === deliveryId);

      if (!current) {
        throw new Error(`Telegram notification delivery not found: ${deliveryId}`);
      }

      const updated: TelegramNotificationDelivery = {
        ...current,
        status: 'pending',
        updatedAt: nextTimestamp(state.sequence),
        nextAttemptAt: nextTimestamp(state.sequence),
        deadLetteredAt: undefined,
        lastErrorMessage: undefined
      };
      state.telegramNotificationDeliveries = state.telegramNotificationDeliveries.map((delivery) =>
        delivery.id === deliveryId ? updated : delivery
      );

      appendTelegramAuditLog({
        action: 'telegram_notification.delivery_retried',
        operation: 'telegram_notification.delivery_retry',
        targetId: deliveryId,
        targetLabel: current.templateId,
        message: 'Telegram notification delivery retry requested',
        context: resolvedContext,
        before: current,
        after: updated
      });

      return clone(updated);
    },

    async handleTelegramWebhookUpdate(_secretPath, update) {
      if (!state.telegramBotSettings.enabled) {
        return {
          accepted: true,
          action: 'settings_disabled'
        };
      }

      const message = update.message;
      const text = message?.text?.trim();
      const chatId = message?.chat?.id !== undefined ? String(message.chat.id) : undefined;
      const fromId = message?.from?.id !== undefined ? String(message.from.id) : undefined;
      const [, code = ''] = text?.match(/^\/start(?:@\w+)?\s+(.+)$/i) ?? [];

      if (!message || !text?.toLowerCase().startsWith('/start') || !chatId) {
        return {
          accepted: true,
          action: 'ignored'
        };
      }

      if (!code.trim()) {
        return {
          accepted: true,
          action: 'binding_prompted'
        };
      }

      const challengeSecret = state.telegramBindingChallengeSecrets.find(
        (secret) => !secret.consumedAt && secret.codeHash === createStableTelegramHash(code.trim().toUpperCase())
      );
      const challenge = challengeSecret
        ? state.telegramBindingChallenges.find((candidate) => candidate.id === challengeSecret.challengeId)
        : undefined;

      if (!challenge || challenge.status !== 'pending') {
        return {
          accepted: true,
          action: 'binding_code_invalid'
        };
      }

      const now = nextTimestamp(state.sequence);

      if (Date.parse(challenge.expiresAt) <= Date.parse(now)) {
        state.telegramBindingChallenges = state.telegramBindingChallenges.map((candidate) =>
          candidate.id === challenge.id
            ? { ...candidate, status: 'expired', attemptCount: candidate.attemptCount + 1 }
            : candidate
        );

        return {
          accepted: true,
          action: 'binding_code_expired'
        };
      }

      const { chat, binding } = createTelegramBindingRecord({
        request: {
          telegramChatId: chatId,
          telegramUserId: fromId,
          chatType: message.chat.type,
          username: message.from?.username ?? message.chat.username,
          displayName: message.from?.first_name ?? message.chat.title,
          customerId: challenge.customerId,
          customerName: challenge.customerNameSnapshot,
          scopeType: challenge.scopeType,
          scopeId: challenge.scopeId,
          scopeLabel: challenge.scopeLabelSnapshot
        },
        customers: await api.listCustomers(),
        now,
        actor: `telegram:${fromId ?? chatId}`,
        sequence: state.telegramCustomerBindings.length + 1
      });
      const activeChat: TelegramChatBinding = {
        ...chat,
        status: 'active',
        source: 'bot_start',
        lastSeenAt: now,
        lastStartAt: now,
        updatedAt: now
      };
      const consumedChallenge: TelegramBindingChallenge = {
        ...challenge,
        attemptCount: challenge.attemptCount + 1,
        status: 'consumed',
        consumedAt: now,
        consumedByChatBindingId: activeChat.id
      };

      state.telegramChatBindings = [activeChat, ...state.telegramChatBindings.filter((item) => item.id !== activeChat.id)];
      state.telegramCustomerBindings = [
        binding,
        ...state.telegramCustomerBindings.filter((item) => item.id !== binding.id)
      ];
      state.telegramBindingChallenges = state.telegramBindingChallenges.map((candidate) =>
        candidate.id === consumedChallenge.id ? consumedChallenge : candidate
      );
      state.telegramBindingChallengeSecrets = state.telegramBindingChallengeSecrets.map((secret) =>
        secret.challengeId === consumedChallenge.id ? { ...secret, consumedAt: now } : secret
      );
      appendTelegramAuditLog({
        action: 'telegram_binding.created',
        operation: 'telegram_binding.create',
        targetId: binding.id,
        targetLabel: binding.customerNameSnapshot,
        message: 'Telegram customer binding created from webhook challenge',
        context: {
          actor: `telegram:${fromId ?? chatId}`,
          sourceIp: 'telegram-webhook',
          requestId: `telegram-webhook-${update.update_id}`
        },
        after: binding
      });

      const readModel = listTelegramBindingReadModels().find((item) => item.id === binding.id);

      return {
        accepted: true,
        action: 'binding_consumed',
        ...(readModel ? { binding: clone(readModel) } : {})
      };
    },

    async pollTelegramBotUpdates() {
      return {
        enabled: state.telegramBotSettings.enabled && state.telegramBotSettings.mode === 'long_polling',
        fetchedCount: 0,
        handledCount: 0,
        errors: []
      };
    },

    async recordAgentRequestDenied(input: AgentRequestDeniedAuditInput) {
      const auditLog = createAgentRequestDeniedAudit(input, state.sequence++);
      appendAuditLog(auditLog);
      return clone(state.auditLogs[0]);
    },

    async recordOperatorRequestDenied(input: OperatorRequestDeniedAuditInput) {
      const auditLog = createOperatorRequestDeniedAudit(input, state.sequence++);
      appendAuditLog(auditLog);
      return clone(state.auditLogs[0]);
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext) {
      const mutationContext = parseMutationContext(resolveMutationContext(context, state.sequence));
      const requestBodyHash = createStableSha256LikeHash(input);
      const idempotencyRecordKey = createAgentInstallCommandIdempotencyRecordKey(mutationContext);
      const existingIdempotencyRecord = state.taskIdempotencyIndex[idempotencyRecordKey];

      if (existingIdempotencyRecord) {
        if (existingIdempotencyRecord.requestBodyHash !== requestBodyHash) {
          appendAuditLog(
            createAgentInstallCommandDeniedAudit(
              state.sequence++,
              mutationContext,
              'idempotency.conflict',
              'A replayed Agent install credential mutation used the same idempotency identity with a different request body.',
              requestBodyHash,
              {
                requestBodyHash: existingIdempotencyRecord.requestBodyHash
              },
              {
                requestBodyHash
              }
            )
          );

          throw new MockControlPlaneMutationError('idempotency.conflict');
        }

        throw new MockControlPlaneMutationError('idempotency.replay_unavailable', {
          credentialId: existingIdempotencyRecord.taskId,
          requestId: existingIdempotencyRecord.requestId,
          reason:
            'Agent install commands contain a one-time secret. The original raw install token is not stored and cannot be replayed safely.'
        });
      }

      const authorizationObservedAt = new Date().toISOString();
      const permissionDenial = resolveAgentInstallCommandPermissionDenial(
        mutationContext,
        state.permissionGrants,
        authorizationObservedAt
      );

      if (permissionDenial) {
        appendAuditLog(
          createAgentInstallCommandDeniedAudit(
            state.sequence++,
            mutationContext,
            permissionDenial.denialCode,
            permissionDenial.denialReason,
            requestBodyHash,
            permissionDenial.before,
            permissionDenial.after
          )
        );

        throw new MockControlPlaneMutationError(permissionDenial.denialCode, {
          denialReason: permissionDenial.denialReason,
          before: permissionDenial.before,
          after: permissionDenial.after
        });
      }

      const issuedAt = authorizationObservedAt;
      const command = composeAgentInstallCommand(input, { issuedAt });
      const credential: MockAgentCredentialRecord = {
        id: `agent-credential-${command.agentId}-${createTokenPrefix(command.installToken).replace(/[^a-zA-Z0-9_.@-]/g, '-')}`,
        agentId: command.agentId,
        tokenHash: createMockAgentCredentialTokenHash(command.installToken),
        tokenPrefix: createTokenPrefix(command.installToken),
        status: 'active',
        purpose: 'install',
        issuedAt,
        expiresAt: command.expiresAt,
        issuedBy: mutationContext.actor,
        sourceIp: mutationContext.sourceIp,
        requestId: mutationContext.requestId,
        metadata: {
          installProfile: [...input.installProfile]
        }
      };

      state.agentCredentials = [credential, ...state.agentCredentials.filter((item) => item.id !== credential.id)];
      state.taskIdempotencyIndex[idempotencyRecordKey] = {
        taskId: credential.id,
        actor: mutationContext.actor,
        method: 'POST',
        path: '/api/v1/agents/install-command',
        requestId: mutationContext.requestId,
        idempotencyKey: mutationContext.idempotencyKey ?? mutationContext.requestId,
        requestBodyHash
      };
      appendAuditLog(
        createAgentCredentialIssuedAudit(
          sanitizeAgentCredential(credential),
          input,
          state.sequence++,
          mutationContext,
          requestBodyHash
        )
      );

      return command;
    },

    async createAgentUpgradeCommand(input: AgentUpgradeCommandRequest, context?: MutationContext) {
      const mutationContext = parseMutationContext(resolveMutationContext(context, state.sequence));
      const normalizedInput: AgentUpgradeCommandRequest = {
        agentId: input.agentId.trim(),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
      };
      const requestBodyHash = createStableSha256LikeHash(normalizedInput);
      const issuedAt = new Date().toISOString();
      const permissionDenial = resolveAgentInstallCommandPermissionDenial(
        mutationContext,
        state.permissionGrants,
        issuedAt
      );

      if (permissionDenial) {
        appendAuditLog({
          id: `audit-mock-agent-upgrade-denied-${state.sequence++}`,
          action: 'audit.denied',
          actor: mutationContext.actor,
          operatorGroupId: mutationContext.operatorGroupId,
          resourceGroupId: mutationContext.resourceGroupId,
          scope: 'control-plane:agent',
          resourceType: 'agent',
          operation: 'agent.upgrade',
          result: 'denied',
          targetId: normalizedInput.agentId,
          targetLabel: normalizedInput.agentId,
          taskId: '',
          severity: 'critical',
          message: `Agent runtime upgrade command issue -> ${permissionDenial.denialCode}`,
          createdAt: issuedAt,
          sourceIp: mutationContext.sourceIp,
          userAgent: mutationContext.userAgent,
          requestId: mutationContext.requestId,
          requestBodyHash,
          denialCode: permissionDenial.denialCode,
          denialReason: permissionDenial.denialReason,
          before: permissionDenial.before,
          after: permissionDenial.after
        });

        throw new MockControlPlaneMutationError(permissionDenial.denialCode, {
          denialReason: permissionDenial.denialReason,
          before: permissionDenial.before,
          after: permissionDenial.after
        });
      }

      const activeRuntimeCredential = state.agentCredentials.find(
        (credential) =>
          credential.agentId === normalizedInput.agentId &&
          credential.purpose === 'runtime' &&
          credential.status === 'active' &&
          Date.parse(credential.expiresAt) > Date.parse(issuedAt)
      );

      if (!activeRuntimeCredential) {
        appendAuditLog({
          id: `audit-mock-agent-upgrade-runtime-credential-required-${state.sequence++}`,
          action: 'audit.denied',
          actor: mutationContext.actor,
          operatorGroupId: mutationContext.operatorGroupId,
          resourceGroupId: mutationContext.resourceGroupId,
          scope: 'control-plane:agent',
          resourceType: 'agent',
          operation: 'agent.upgrade',
          result: 'denied',
          targetId: normalizedInput.agentId,
          targetLabel: normalizedInput.agentId,
          taskId: '',
          severity: 'critical',
          message: 'Agent runtime upgrade command issue -> agent_upgrade.runtime_credential_required',
          createdAt: issuedAt,
          sourceIp: mutationContext.sourceIp,
          userAgent: mutationContext.userAgent,
          requestId: mutationContext.requestId,
          requestBodyHash,
          denialCode: 'agent_upgrade.runtime_credential_required',
          denialReason: 'Agent runtime upgrade command requires an active runtime credential for the target Agent.',
          after: {
            agentId: normalizedInput.agentId
          }
        });

        throw new MockControlPlaneMutationError('agent_upgrade.runtime_credential_required', {
          agentId: normalizedInput.agentId
        });
      }

      const command = composeAgentUpgradeCommand(normalizedInput, { issuedAt });
      appendAuditLog({
        id: `audit-mock-agent-upgrade-issued-${state.sequence++}`,
        action: 'agent.upgrade_command.issued',
        actor: mutationContext.actor,
        operatorGroupId: mutationContext.operatorGroupId,
        resourceGroupId: mutationContext.resourceGroupId,
        scope: 'control-plane:agent',
        resourceType: 'agent',
        operation: 'agent.upgrade',
        result: 'succeeded',
        targetId: normalizedInput.agentId,
        targetLabel: normalizedInput.agentId,
        taskId: '',
        severity: 'info',
        message: `Agent runtime upgrade command issued for ${normalizedInput.agentId}`,
        createdAt: issuedAt,
        sourceIp: mutationContext.sourceIp,
        userAgent: mutationContext.userAgent,
        requestId: mutationContext.requestId,
        requestBodyHash,
        after: {
          command,
          runtimeCredential: sanitizeAgentCredential(activeRuntimeCredential),
          reason: normalizedInput.reason
        }
      });

      return command;
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60_000).toISOString();
      const requestBodyHash = createStableSha256LikeHash(input);
      const installTokenPresented = installToken.trim().length > 0;
      const installCredential = installTokenPresented
        ? state.agentCredentials.find((item) => item.tokenHash === createMockAgentCredentialTokenHash(installToken))
        : undefined;
      const createDeniedRegistrationError = (
        denialCode: string,
        denialReason: string,
        deniedInstallCredential?: MockAgentCredentialRecord
      ) => {
        appendAuditLog(
          createAgentRegistrationDeniedAudit(
            input,
            deniedInstallCredential ? sanitizeAgentCredential(deniedInstallCredential) : undefined,
            state.sequence++,
            context,
            denialCode,
            denialReason,
            requestBodyHash,
            installTokenPresented
          )
        );
        return new MockControlPlaneMutationError(denialCode, {
          denialReason
        });
      };

      if (!installTokenPresented) {
        throw createDeniedRegistrationError(
          'agent_registration.install_token_required',
          'Agent registration requires a bearer install token.'
        );
      }

      if (!installCredential) {
        throw createDeniedRegistrationError(
          'agent_registration.install_token_invalid',
          'Agent registration install token was not found or is not an install credential.'
        );
      }

      if (installCredential.purpose !== 'install') {
        throw createDeniedRegistrationError(
          'agent_registration.install_token_invalid',
          'Agent registration install token was not found or is not an install credential.',
          installCredential
        );
      }

      const matchedInstallCredential = installCredential;

      if (matchedInstallCredential.agentId !== input.agentId) {
        throw createDeniedRegistrationError(
          'agent_registration.agent_mismatch',
          'Agent registration install token is bound to a different Agent identity.',
          matchedInstallCredential
        );
      }

      if (
        matchedInstallCredential.status !== 'active' ||
        Date.parse(matchedInstallCredential.expiresAt) <= Date.parse(issuedAt)
      ) {
        let deniedInstallCredential = matchedInstallCredential;

        if (matchedInstallCredential.status === 'active') {
          deniedInstallCredential = {
            ...matchedInstallCredential,
            status: 'expired',
            lastUsedAt: issuedAt
          };
          state.agentCredentials = state.agentCredentials.map((item) =>
            item.id === matchedInstallCredential.id ? deniedInstallCredential : item
          );
        }

        throw createDeniedRegistrationError(
          'agent_registration.install_token_expired',
          'Agent registration install token is expired or no longer active.',
          deniedInstallCredential
        );
      }

      const agentToken = createRuntimeAgentToken();
      const credentialId = `mock-agent-credential-${input.agentId}`;
      const sourceIp = '127.0.0.1';
      const credential: MockAgentCredentialRecord = {
        id: credentialId,
        agentId: input.agentId,
        tokenHash: createMockAgentCredentialTokenHash(agentToken),
        tokenPrefix: createTokenPrefix(agentToken),
        status: 'active',
        purpose: 'runtime',
        issuedAt,
        expiresAt,
        issuedBy: `agent:${input.agentId}`,
        sourceIp,
        requestId: input.requestId,
        sessionId: input.sessionId,
        metadata: {
          installProfile: [...matchedInstallCredential.metadata.installProfile],
          ...(input.version ? { registrationVersion: input.version } : {}),
          ...(input.platform ? { registrationPlatform: input.platform } : {}),
          ...(input.capabilities ? { registrationCapabilities: [...input.capabilities] } : {})
        }
      };

      state.agentCredentials = [
        credential,
        ...state.agentCredentials
          .filter((item) => item.id !== credential.id)
          .map((item) =>
            item.id === matchedInstallCredential.id
              ? {
                  ...item,
                  status: 'revoked' as const,
                  lastUsedAt: issuedAt,
                  sessionId: input.sessionId,
                  revokedAt: issuedAt,
                  revokedBy: `agent:${input.agentId}`,
                  revokedReason: 'agent.install_token_redeemed',
                  replacedByCredentialId: credential.id
                }
              : item
          )
      ];
      if (!state.agents.some((agent) => agent.id === input.agentId)) {
        state.agents = [createProvisioningAgentFromRegistration(input, sourceIp, issuedAt), ...state.agents];
      }

      return {
        agentId: input.agentId,
        agentToken,
        tokenPrefix: credential.tokenPrefix,
        credentialId,
        issuedAt,
        expiresAt,
        sessionId: input.sessionId
      };
    },

    async revokeAgentCredential(credentialId, input, context?: MutationContext) {
      const credential = state.agentCredentials.find((item) => item.id === credentialId);

      if (!credential) {
        throw new Error(`agent credential not found: ${credentialId}`);
      }

      const revokedCredential: MockAgentCredentialRecord = {
        ...credential,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: context?.actor ?? 'admin',
        revokedReason: input.reason
      };

      state.agentCredentials = [
        revokedCredential,
        ...state.agentCredentials.filter((item) => item.id !== credentialId)
      ];
      return clone(sanitizeAgentCredential(revokedCredential));
    },

    async revokeOperatorSession(sessionId: string, input: OperatorSessionRevokeRequest, context?: MutationContext) {
      const session = state.operatorSessions.find((item) => item.id === sessionId);

      if (!session) {
        throw new Error(`operator session not found: ${sessionId}`);
      }

      const revokedSession: OperatorSessionSummary =
        session.status === 'active'
          ? {
              ...session,
              status: 'revoked',
              revokedAt: new Date().toISOString(),
              revokedBy: context?.actor ?? 'admin',
              revokedReason: input.reason
            }
          : session;

      state.operatorSessions = [
        revokedSession,
        ...state.operatorSessions.filter((item) => item.id !== revokedSession.id)
      ];

      return clone(revokedSession);
    },

    async rotateAgentCredential(credentialId, input, context?: MutationContext) {
      const credential = state.agentCredentials.find((item) => item.id === credentialId);

      if (!credential) {
        throw new Error(`agent credential not found: ${credentialId}`);
      }

      if (credential.purpose !== 'runtime') {
        throw new Error('agent_credential.rotate_runtime_required');
      }

      if (credential.status !== 'active' || Date.parse(credential.expiresAt) <= Date.now()) {
        throw new Error('agent_credential.rotate_inactive');
      }

      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60_000).toISOString();
      const agentToken = createRuntimeAgentToken();
      const nextCredentialId = `mock-agent-credential-${credential.agentId}-${state.sequence++}`;
      const revokedCredential: MockAgentCredentialRecord = {
        ...credential,
        status: 'revoked',
        revokedAt: issuedAt,
        revokedBy: context?.actor ?? 'admin',
        revokedReason: input.reason,
        replacedByCredentialId: nextCredentialId
      };
      const issuedCredential: MockAgentCredentialRecord = {
        ...credential,
        id: nextCredentialId,
        tokenHash: createMockAgentCredentialTokenHash(agentToken),
        tokenPrefix: createTokenPrefix(agentToken),
        status: 'active',
        issuedAt,
        expiresAt,
        issuedBy: context?.actor ?? 'admin',
        sourceIp: context?.sourceIp ?? credential.sourceIp,
        requestId: context?.requestId ?? `req-mock-agent-credential-rotate-${state.sequence}`,
        revokedAt: undefined,
        revokedBy: undefined,
        revokedReason: undefined,
        replacedByCredentialId: undefined
      };

      state.agentCredentials = [
        issuedCredential,
        revokedCredential,
        ...state.agentCredentials.filter((item) => item.id !== credentialId)
      ];

      return {
        agentId: issuedCredential.agentId,
        agentToken,
        tokenPrefix: issuedCredential.tokenPrefix,
        credentialId: issuedCredential.id,
        issuedAt,
        expiresAt,
        sessionId: issuedCredential.sessionId
      };
    },

    async resetQuotaPolicy(policyId: string, context?: MutationContext) {
      const policy = listLiveQuotaPolicies().find((item) => item.id === policyId);

      if (!policy) {
        throw new Error(`Quota policy not found: ${policyId}`);
      }

      return api.createTask(createQuotaResetTaskInput(policy), context);
    },

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      const beforeForwardRules = listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = listLiveInboundsForGuardrailEnforcement();
      const nowIso = readModelNow();
      const liveInbounds = applyXrayTrafficWindowToReadModel(state.inbounds, nowIso);
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        state.subscriptionClients,
        liveInbounds,
        state.subscriptionInventoryNodes,
        createQuotaResetReplayState(state.tasks),
        nowIso
      );
      const taskInput = parseCreateTaskRequest(
        input.operation === 'quota.reset'
          ? prepareQuotaResetTaskInput({
              input,
              nowIso,
              agents: applyAgentLivenessToReadModel(state.agents, nowIso),
              inbounds: liveInbounds,
              forwardRules: applyForwardingBillingWindowToReadModel(state.forwardRules, nowIso),
              subscriptionClients: liveSubscriptionClients,
              quotaPolicies: listLiveQuotaPolicies()
            })
          : input
      );
      const mutationContext = parseMutationContext(resolveMutationContext(context, state.sequence));
      const requestBodyHash = createTaskRequestHash(taskInput);
      const idempotencyRecordKey = createIdempotencyRecordKey(mutationContext);
      const existingIdempotencyRecord = state.taskIdempotencyIndex[idempotencyRecordKey];
      const existingTask = existingIdempotencyRecord
        ? state.tasks.find((item) => item.id === existingIdempotencyRecord.taskId)
        : undefined;
      const resourceType = taskInput.resourceType ?? inferResourceType(taskInput.operation);

      if (existingTask) {
        if (existingIdempotencyRecord.requestBodyHash !== requestBodyHash) {
          appendDeniedAudit(
            taskInput,
            taskInput.resourceType ?? inferResourceType(taskInput.operation),
            mutationContext,
            'idempotency.conflict',
            'A replayed mutation used the same idempotency identity with a different request body.',
            requestBodyHash,
            {
              existingTaskId: existingTask.id,
              requestBodyHash: existingIdempotencyRecord.requestBodyHash
            },
            {
              requestBodyHash
            }
          );

          throw new Error('idempotency.conflict');
        }

        return clone(existingTask);
      }

      const resourceVersionDenial = resolveResourceVersionDenial(taskInput, mutationContext, state);

      if (resourceVersionDenial) {
        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          resourceVersionDenial.denialCode,
          resourceVersionDenial.denialReason,
          requestBodyHash,
          resourceVersionDenial.before,
          resourceVersionDenial.after
        );

        throw new Error(resourceVersionDenial.denialCode);
      }

      const authorizationObservedAt = nextTimestamp(state.sequence);
      const permissionDenial =
        resolveOperationPermissionDenial(taskInput, mutationContext, state.permissionGrants, authorizationObservedAt) ??
        resolvePermissionGrantDenial(taskInput, mutationContext, state.permissionGrants, authorizationObservedAt) ??
        resolvePermissionRevokeDenial(taskInput, state.permissionGrants, authorizationObservedAt);

      if (permissionDenial) {
        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          permissionDenial.denialCode,
          permissionDenial.denialReason,
          requestBodyHash,
          permissionDenial.before,
          permissionDenial.after
        );

        throw new MockControlPlaneMutationError(permissionDenial.denialCode, {
          denialReason: permissionDenial.denialReason,
          before: permissionDenial.before,
          after: permissionDenial.after
        });
      }

      const highRiskConfirmationDenial = resolveHighRiskConfirmationDenial(taskInput);

      if (highRiskConfirmationDenial) {
        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          highRiskConfirmationDenial.denialCode,
          highRiskConfirmationDenial.denialReason,
          requestBodyHash,
          highRiskConfirmationDenial.before,
          highRiskConfirmationDenial.after
        );

        throw new MockControlPlaneMutationError(highRiskConfirmationDenial.denialCode, {
          denialReason: highRiskConfirmationDenial.denialReason,
          before: highRiskConfirmationDenial.before,
          after: highRiskConfirmationDenial.after
        });
      }

      const now = nextTimestamp(state.sequence++);
      const task: DeployTask = {
        id: `task-${String(state.sequence).padStart(4, '0')}`,
        operation: taskInput.operation,
        resourceType,
        resourceId: taskInput.targetId,
        status: 'queued',
        targetId: taskInput.targetId,
        targetLabel: taskInput.targetLabel,
        summary: taskInput.summary,
        createdAt: now,
        updatedAt: now,
        actor: mutationContext.actor,
        requestedBy: mutationContext.actor,
        requestId: mutationContext.requestId,
        idempotencyKey: mutationContext.idempotencyKey,
        sourceIp: mutationContext.sourceIp,
        rollbackAvailable: false,
        attempts: 0,
        progressPercent: 0,
        steps: createTaskSteps(taskInput.summary),
        metadata: taskInput.metadata
      };
      const targetAgentIds = shouldCreateAgentCommand(task.operation) ? resolveAgentIdsForTaskInState(task, state) : [];

      if (shouldCreateAgentCommand(task.operation) && targetAgentIds.length === 0) {
        const denialReason = 'This runtime operation requires at least one target Agent before it can be dispatched.';

        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          'agent_target.required',
          denialReason,
          requestBodyHash,
          {
            operation: taskInput.operation,
            targetId: taskInput.targetId,
            metadata: taskInput.metadata ?? {}
          }
        );

        throw new MockControlPlaneMutationError('agent_target.required', {
          denialReason,
          operation: taskInput.operation,
          targetId: taskInput.targetId
        });
      }

      const xrayCapabilityDenial = findXrayCapabilityDenialForTask(task, state.agents);

      if (xrayCapabilityDenial) {
        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          'agent_runtime_capability.unsupported',
          xrayCapabilityDenial.denialReason,
          requestBodyHash,
          {
            operation: taskInput.operation,
            targetId: taskInput.targetId,
            metadata: taskInput.metadata ?? {},
            unsupportedAgentIds: xrayCapabilityDenial.unsupportedAgentIds,
            requiredCapability: xrayCapabilityDenial.requiredCapability
          }
        );

        throw new MockControlPlaneMutationError('agent_runtime_capability.unsupported', xrayCapabilityDenial);
      }

      const xrayPortConflictDenial = findXrayInboundPortConflictDenial(task, {
        inbounds: state.inbounds,
        tasks: state.tasks,
        nodes: state.nodes
      });

      if (xrayPortConflictDenial) {
        appendDeniedAudit(
          taskInput,
          resourceType,
          mutationContext,
          xrayPortConflictDenial.code,
          xrayPortConflictDenial.denialReason,
          requestBodyHash,
          {
            operation: taskInput.operation,
            targetId: taskInput.targetId,
            metadata: taskInput.metadata ?? {},
            agentId: xrayPortConflictDenial.agentId,
            listenAddress: xrayPortConflictDenial.listenAddress,
            listenPort: xrayPortConflictDenial.listenPort,
            requestedProtocol: xrayPortConflictDenial.requestedProtocol,
            conflictingProtocol: xrayPortConflictDenial.conflictingProtocol,
            conflictingInboundId: xrayPortConflictDenial.conflictingInboundId,
            conflictingTaskId: xrayPortConflictDenial.conflictingTaskId
          }
        );

        throw new MockControlPlaneMutationError(xrayPortConflictDenial.code, xrayPortConflictDenial);
      }

      state.tasks.unshift(task);
      applyPermissionGrant(taskInput, mutationContext, now);
      applyPermissionRevoke(taskInput, mutationContext, now);
      const deletedSourceId = readSubscriptionSourceDeleteId(task);

      if (deletedSourceId) {
        state.subscriptionInventoryNodes = state.subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
      }

      state.subscriptionSources = applySubscriptionSourceTask(state.subscriptionSources, task);
      state.inbounds = applyXrayInboundTask(state.inbounds, task);
      state.inbounds = applyQuotaResetTaskToInbounds(state.inbounds, task);
      state.forwardRules = applyForwardRuleTask(state.forwardRules, task);
      state.forwardRules = applyQuotaResetTaskToForwardRules(state.forwardRules, task);
      state.agents = applyAgentTask(state.agents, task);
      state.agents = applyQuotaResetTaskToAgents(state.agents, task);
      state.subscriptionClients = applyQuotaResetTaskToSubscriptionClients(
        applySubscriptionClientTask(state.subscriptionClients, task),
        task
      ).map((client) =>
        projectSubscriptionClientReadModel(
          client,
          applyXrayTrafficWindowToReadModel(state.inbounds, readModelNow()),
          state.subscriptionInventoryNodes,
          createQuotaResetReplayState(state.tasks),
          readModelNow()
        )
      );
      state.subscriptionExportProfiles = applySubscriptionExportProfileTask(state.subscriptionExportProfiles, task);

      if (shouldCreateAgentCommand(task.operation)) {
        const outboxItems = createCommandOutboxItems(task, state.sequence, targetAgentIds);
        state.sequence += outboxItems.length;

        for (const outboxItem of outboxItems) {
          const releaseArtifacts = createMockRuntimeReleaseArtifacts(task, outboxItem.command);

          if (releaseArtifacts) {
            state.configRevisions.unshift(releaseArtifacts.configRevision);
            state.preflightPlans.unshift(releaseArtifacts.preflightPlan);
            state.runtimeSnapshots.unshift(releaseArtifacts.runtimeSnapshot);
          }

          state.commandOutbox.unshift(outboxItem);
        }
      }
      state.taskIdempotencyIndex[idempotencyRecordKey] = {
        taskId: task.id,
        actor: mutationContext.actor,
        method: 'POST',
        path: '/api/v1/tasks',
        requestId: mutationContext.requestId,
        idempotencyKey: mutationContext.idempotencyKey ?? mutationContext.requestId,
        requestBodyHash
      };
      appendAudit(task, 'created', mutationContext);

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
        const afterInbounds = listLiveInboundsForGuardrailEnforcement();
        if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
          await enqueueDerivedXrayGuardrailTasks({
            kind: 'task',
            id: task.id,
            observedAt: task.createdAt
          });
        }
      }

      return clone(task);
    },

    async syncSubscriptionSource(sourceId: string, context?: MutationContext): Promise<SubscriptionSourceSyncResult> {
      const source = state.subscriptionSources.find((item) => item.id === sourceId);

      if (!source) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      const mutationContext = resolveMutationContext(context, state.sequence);
      const before = {
        id: source.id,
        status: source.status,
        nodeCount: source.nodeCount,
        lastSyncAt: source.lastSyncAt,
        syncWarnings: source.syncWarnings ?? []
      };
      const syncedAt = nextTimestamp(state.sequence++);
      const nodes = state.subscriptionInventoryNodes.filter((node) => node.sourceId === sourceId);
      const crossSourceDuplicateCount = countCrossSourceSubscriptionInventoryDuplicates(
        nodes,
        state.subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId),
        source.dedupeKey
      );
      const status = nodes.length > 0 && crossSourceDuplicateCount === 0 ? 'synced' : 'warning';
      const warnings =
        nodes.length > 0
          ? crossSourceDuplicateCount > 0
            ? [`subscription_source.cross_source_duplicates:${crossSourceDuplicateCount}`]
            : []
          : ['subscription_source.mock_sync_has_no_remote_fetch'];

      state.subscriptionSources = state.subscriptionSources.map((item) =>
        item.id === sourceId
          ? {
              ...item,
              status,
              nodeCount: nodes.length,
              lastSyncAt: syncedAt,
              syncWarnings: warnings
            }
          : item
      );
      appendAuditLog({
        id: `audit-${String(state.sequence++).padStart(4, '0')}`,
        action: 'subscription.source.synced',
        actor: mutationContext.actor,
        operatorGroupId: mutationContext.operatorGroupId,
        resourceGroupId: mutationContext.resourceGroupId,
        scope: 'control-plane:subscription',
        resourceType: 'subscription',
        operation: 'subscription.sync',
        result: 'succeeded',
        targetId: source.id,
        targetLabel: source.name,
        taskId: '',
        severity: status === 'warning' ? 'warning' : 'info',
        message: `Subscription source synced: ${source.name}`,
        createdAt: syncedAt,
        sourceIp: mutationContext.sourceIp,
        userAgent: mutationContext.userAgent,
        requestId: mutationContext.requestId,
        requestBodyHash: createStableSha256LikeHash({
          operation: 'subscription.sync',
          sourceId
        }),
        before,
        after: {
          status,
          nodeCount: nodes.length,
          syncedAt,
          warnings
        }
      });

      return {
        sourceId,
        status,
        nodeCount: nodes.length,
        syncedAt,
        nodes: clone(nodes),
        warnings
      };
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext) {
      const task = state.tasks.find((item) => item.id === taskId);

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (status === 'succeeded' && requiresAgentResultForRuntimeSuccess(task.operation)) {
        throw new MockControlPlaneMutationError('agent_result.required', {
          operation: task.operation,
          taskId: task.id,
          targetId: task.targetId,
          denialReason: 'Runtime command success must be recorded from Agent result events.'
        });
      }

      applyTaskTransition(task, status, resolveMutationContext(context, state.sequence));
      state.forwardRules = applyForwardRuleTask(state.forwardRules, task);

      return clone(task);
    },

    async issueAgentCommand(agentId, command, context?: MutationContext) {
      const mutationContext = parseMutationContext(resolveMutationContext(context, state.sequence));
      const agentCommand = agentCommandEnvelopeSchema.parse(command);

      if (agentCommand.agentId !== agentId) {
        throw new Error('Invalid agent command: agentId does not match target agent');
      }

      const now = nextTimestamp(state.sequence++);
      const outboxItem: CommandOutboxItem = {
        id: `outbox-${String(state.sequence).padStart(4, '0')}`,
        taskId: agentCommand.taskId,
        commandId: agentCommand.commandId,
        agentId,
        seq: agentCommand.seq,
        status: 'pending',
        transport: 'http-pull',
        command: agentCommand,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        deadlineAt: agentCommand.deadlineAt
      };

      state.commandOutbox.unshift(outboxItem);
      appendAuditLog({
        id: `audit-${String(state.sequence++).padStart(4, '0')}`,
        action: 'task.created',
        actor: mutationContext.actor,
        operatorGroupId: mutationContext.operatorGroupId,
        resourceGroupId: mutationContext.resourceGroupId,
        scope: 'control-plane:agent',
        resourceType: 'agent',
        operation: 'agent.deploy',
        result: 'accepted',
        targetId: agentId,
        targetLabel: agentId,
        taskId: agentCommand.taskId,
        severity: 'info',
        message: `Agent command queued: ${agentCommand.commandId}`,
        createdAt: now,
        sourceIp: mutationContext.sourceIp,
        userAgent: mutationContext.userAgent,
        requestId: mutationContext.requestId,
        after: {
          commandId: agentCommand.commandId,
          type: agentCommand.type,
          status: outboxItem.status
        }
      });

      return clone(outboxItem);
    },

    async leaseAgentCommands(agentId, options) {
      return clone(leaseMockCommandOutbox(state, agentId, options));
    },

    async sweepCommandTimeouts(options) {
      return clone(sweepMockCommandTimeouts(state, options));
    },

    async receiveAgentEvent(event) {
      const agentEvent = parseAgentEventEnvelope(event);
      recordMockAgentEventSession(state, agentEvent);
      const beforeForwardRules = listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = listLiveInboundsForGuardrailEnforcement();
      const quotaResetReplayState = createQuotaResetReplayState(state.tasks);
      const resetAwareAgentEvent = applyQuotaResetStateToForwardingEvent(
        applyQuotaResetStateToXrayEvent(
          applyQuotaResetStateToAgentEvent(agentEvent, quotaResetReplayState),
          quotaResetReplayState
        ),
        quotaResetReplayState
      );

      if (agentEvent.type === 'heartbeat' || agentEvent.type === 'telemetry_sample') {
        const duplicate = state.agentEvents.some((item) => item.eventId === agentEvent.eventId);
        state.agentEvents = [clone(agentEvent), ...state.agentEvents.filter((item) => item.eventId !== agentEvent.eventId)];
        if (!duplicate && agentEvent.type === 'telemetry_sample') {
          state.trafficRollups = [
            ...createTrafficRollupsFromAgentTelemetry(agentEvent),
            ...state.trafficRollups
          ];
          const prunedTrafficRollups = pruneTrafficRollups(
            state.trafficRollups,
            state.trafficRollupRetentionPolicy,
            agentEvent.observedAt
          );
          state.trafficRollups = prunedTrafficRollups.rollups;
          state.trafficRollupCompactions = mergeTrafficRollupCompactions(
            state.trafficRollupCompactions,
            prunedTrafficRollups.compactions
          );
        }
        state.agents = applyAgentEventToReadModel(state.agents, resetAwareAgentEvent);
        state.inbounds = applyXrayTelemetryToReadModel(state.inbounds, resetAwareAgentEvent);
        state.forwardRules = applyForwardingTelemetryToReadModel(state.forwardRules, resetAwareAgentEvent);
        await enqueueDerivedForwardQuotaEnforcementTasks(beforeForwardRules, {
          kind: 'agent-event',
          id: agentEvent.eventId,
          observedAt: agentEvent.observedAt
        });
        const afterInbounds = listLiveInboundsForGuardrailEnforcement();
        if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
          await enqueueDerivedXrayGuardrailTasks({
            kind: 'agent-event',
            id: agentEvent.eventId,
            observedAt: agentEvent.observedAt
          });
        }
        return undefined;
      }

      const outboxItem = state.commandOutbox.find(
        (item) => item.commandId === agentEvent.commandId && item.agentId === agentEvent.agentId
      );

      if (!outboxItem) {
        throw new Error(`Command outbox item not found: ${agentEvent.commandId}`);
      }

      const task = state.tasks.find((item) => item.id === agentEvent.taskId);

      if (!task) {
        throw new Error(`Task not found: ${agentEvent.taskId}`);
      }

      assertAgentEventMatchesCommandTask(agentEvent, outboxItem);

      const context = resolveMutationContext(
        {
          actor: task.actor,
          sourceIp: task.sourceIp,
          requestId: task.requestId,
          idempotencyKey: task.idempotencyKey
        },
        state.sequence
      );

      const effectiveAgentEvent =
        agentEvent.type === 'result' ? normalizeResultEventForCommand(outboxItem.command, agentEvent) : agentEvent;
      if (
        effectiveAgentEvent.type === 'log_chunk' &&
        state.agentEvents.some(
          (item): item is Extract<AgentEventEnvelope, { type: 'log_chunk' }> =>
            item.type === 'log_chunk' && isSameLogicalLogChunk(item, effectiveAgentEvent)
        )
      ) {
        outboxItem.updatedAt = effectiveAgentEvent.observedAt;
        return clone(task);
      }

      state.agentEvents = [
        clone(effectiveAgentEvent),
        ...state.agentEvents.filter((item) => item.eventId !== effectiveAgentEvent.eventId)
      ];

      if (effectiveAgentEvent.type === 'ack') {
        outboxItem.status = 'acknowledged';
        outboxItem.ackedAt = effectiveAgentEvent.observedAt;
        outboxItem.updatedAt = effectiveAgentEvent.observedAt;
        outboxItem.attempts += 1;

        if (task.status === 'queued') {
          applyTaskTransition(task, 'running', context, effectiveAgentEvent.observedAt);
        }

        return clone(task);
      }

      if (effectiveAgentEvent.type === 'result') {
        outboxItem.status = effectiveAgentEvent.payload.status === 'failed' ? 'failed' : 'completed';
        outboxItem.resultAt = effectiveAgentEvent.observedAt;
        outboxItem.updatedAt = effectiveAgentEvent.observedAt;
        outboxItem.lastError = effectiveAgentEvent.payload.failureReason;
        updateMockRuntimeReleaseFromResult(state, task, outboxItem.command, effectiveAgentEvent);

        const relatedOutboxItems = state.commandOutbox.filter((item) => item.taskId === task.id);
        const allRelatedCommandsCompleted = relatedOutboxItems.every((item) => item.status === 'completed');
        const nextStatus =
          effectiveAgentEvent.payload.status === 'failed'
            ? 'failed'
            : allRelatedCommandsCompleted
              ? 'succeeded'
              : undefined;

        if (!nextStatus) {
          return clone(task);
        }

        if (nextStatus === 'succeeded') {
          task.metadata = markTaskVerifiedByAgentResults(task, relatedOutboxItems, effectiveAgentEvent.observedAt).metadata;
        }

        applyTaskTransition(
          task,
          nextStatus,
          context,
          effectiveAgentEvent.observedAt,
          effectiveAgentEvent.payload.failureReason
        );
        if (nextStatus === 'failed') {
          const rollbackTask = enqueueRuntimeHealthRollbackTask(task, outboxItem, effectiveAgentEvent);

          if (rollbackTask) {
            task.rollbackTaskId = rollbackTask.id;
          }
        }
        state.inbounds = applyXrayInboundTask(state.inbounds, task);
        state.forwardRules = applyForwardRuleTask(state.forwardRules, task);
        state.subscriptionClients = applySubscriptionClientTask(state.subscriptionClients, task).map((client) =>
          projectSubscriptionClientReadModel(
            client,
            applyXrayTrafficWindowToReadModel(state.inbounds, readModelNow()),
            state.subscriptionInventoryNodes,
            createQuotaResetReplayState(state.tasks),
            readModelNow()
          )
        );
        await enqueueDerivedForwardQuotaEnforcementTasks(beforeForwardRules, {
          kind: 'agent-event',
          id: effectiveAgentEvent.eventId,
          observedAt: effectiveAgentEvent.observedAt
        });

        return clone(task);
      }

      outboxItem.updatedAt = effectiveAgentEvent.observedAt;
      return clone(task);
    }
  };

  return api;
}
