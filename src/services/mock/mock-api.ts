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
  TrafficRollup,
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
  createCustomersFromReadModels,
  createSubscriptionBundlesFromInventory,
  countCrossSourceSubscriptionInventoryDuplicates,
  createProxyProvidersFromSources,
  createRuntimeAgentToken,
  createSubscriptionExportFilesFromClients,
  markTaskAgentRuntimeDeploymentVerified,
  readSubscriptionSourceDeleteId
} from '../../domain';
import type {
  AgentCommandLeaseOptions,
  AgentRequestDeniedAuditInput,
  AuditChainVerification,
  CommandTimeoutSweepOptions,
  CommandOutboxItem,
  ControlPlaneApi,
  MutationContext,
  OperatorRequestDeniedAuditInput
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
import { createSystemAlertsFromAgents } from '../api/system-alerts';
import { createObservabilityMetrics, selectAgentLogChunks, v1ApiBoundary } from '../api/control-plane-api';
import {
  applyForwardingBillingWindowToReadModel,
  applyForwardingTelemetryToReadModel
} from '../api/forwarding-telemetry-read-model';
import { deriveForwardQuotaEnforcementTaskIntents } from '../api/forward-quota-enforcement-tasks';
import { deriveXrayGuardrailTaskIntents } from '../api/xray-guardrail-enforcement-tasks';
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
  seedAgents,
  seedAuditLogs,
  seedForwardRules,
  seedInbounds,
  seedNodes,
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
  routingPolicies: RoutingPolicy[];
  tuningProfiles: TuningProfile[];
  tasks: DeployTask[];
  commandOutbox: CommandOutboxItem[];
  agentEvents: AgentEventEnvelope[];
  agentCredentials: AgentCredentialSummary[];
  operatorSessions: OperatorSessionSummary[];
  auditLogs: AuditLog[];
  taskIdempotencyIndex: Record<string, IdempotencyRecord>;
  sequence: number;
};

type CreateMockApiOptions = {
  seedInventory?: boolean;
  readModelNow?: () => string;
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
  return [
    'forward.create',
    'forward.update',
    'forward.apply',
    'forward.pause',
    'forward.resume',
    'forward.delete',
    'tunnel.create',
    'tunnel.update',
    'tunnel.redeploy'
  ].includes(operation);
}

function readStringMetadata(task: DeployTask, key: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
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
    task.operation === 'agent.rollback' || task.operation === 'runtime.reload'
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
            snapshotId: `snapshot-before-${task.targetId}`,
            targetConfigRevision: `cfg-rollback-${task.id}`,
            rollbackReason: task.summary,
            rollbackMode: 'graceful_restart' as const
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
  resourceType?: PermissionGrant['resourceType']
): Set<ResourcePermission> {
  const actorPermissions = new Set<ResourcePermission>();

  permissionGrants
    .filter((grant) => grant.resourceId === resourceId)
    .filter((grant) => !resourceType || grant.resourceType === resourceType)
    .filter((grant) => !grant.revokedAt)
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

function hasBootstrapPrivileges(context: MutationContext) {
  return context.actor === 'admin' || context.actor === 'operator:admin';
}

function resolvePermissionGrantDenial(
  input: CreateTaskInput,
  context: MutationContext,
  permissionGrants: PermissionGrant[]
) {
  if (hasBootstrapPrivileges(context)) {
    return undefined;
  }

  if (input.operation !== 'permission.grant' || !input.permissionChange) {
    return undefined;
  }

  const actorPermissions = getActorPermissions(permissionGrants, context, input.permissionChange.resourceId);
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

function resolveLastAdministrativeGrantDenial(grant: PermissionGrant, permissionGrants: PermissionGrant[]) {
  if (!grant.permissions.includes('grant')) {
    return undefined;
  }

  const remainingAdministrativeGrants = permissionGrants.filter(
    (item) =>
      item.id !== grant.id &&
      !item.revokedAt &&
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

function resolvePermissionRevokeDenial(input: CreateTaskInput, permissionGrants: PermissionGrant[]) {
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

  const lastAdministrativeGrantDenial = resolveLastAdministrativeGrantDenial(grant, permissionGrants);

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
  permissionGrants: PermissionGrant[]
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
  const actorPermissions = getActorPermissions(permissionGrants, context, resourceId);

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

function resolveAgentInstallCommandPermissionDenial(context: MutationContext, permissionGrants: PermissionGrant[]) {
  if (hasBootstrapPrivileges(context)) {
    return undefined;
  }

  const requiredPermission: ResourcePermission = 'configure';
  const resourceId = context.resourceGroupId ?? 'agent-enrollment';
  const actorPermissions = getActorPermissions(permissionGrants, context, resourceId, 'agent');

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
    if (capability === 'host-agent' || capability === 'xray' || capability === 'port-forwarding') {
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

  for (const item of state.commandOutbox) {
    if (item.agentId !== agentId || leased.length >= maxCommands) {
      continue;
    }

    const deadlineMs = Date.parse(item.deadlineAt);
    const leaseExpiresMs = item.leaseExpiresAt ? Date.parse(item.leaseExpiresAt) : undefined;
    const isDeadlineExpired = deadlineMs <= nowMs;
    const isPending = item.status === 'pending';
    const isExpiredLease = item.status === 'dispatched' && leaseExpiresMs !== undefined && leaseExpiresMs <= nowMs;

    if (isDeadlineExpired && (item.status === 'pending' || item.status === 'dispatched')) {
      item.status = 'expired';
      item.updatedAt = now;
      item.lastError = 'command.deadline.expired';
      continue;
    }

    if (!isPending && !isExpiredLease) {
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
  reason: 'command.deadline.expired' | 'command.ack.timeout' | 'command.result.timeout'
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
      result.expired += 1;
      result.taskFailures += failMockCommandTask(state, item, now, 'command.deadline.expired') ? 1 : 0;
      continue;
    }

    if (item.status === 'dispatched' && item.leasedAt && !item.ackedAt && Date.parse(item.leasedAt) + ackTimeoutMs <= nowMs) {
      item.status = 'dead_letter';
      item.updatedAt = now;
      item.lastError = 'command.ack.timeout';
      result.deadLettered += 1;
      result.taskFailures += failMockCommandTask(state, item, now, 'command.ack.timeout') ? 1 : 0;
      continue;
    }

    if (item.status === 'acknowledged' && item.ackedAt && Date.parse(item.ackedAt) + resultTimeoutMs <= nowMs) {
      item.status = 'dead_letter';
      item.updatedAt = now;
      item.lastError = 'command.result.timeout';
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

  const failedCheckIds = inferFailedPreflightCheckIds(agentEvent.payload.failureReason, checks);

  return checks.map((check) => ({
    ...check,
    status: failedCheckIds.has(check.id) ? ('failed' as const) : check.status
  }));
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
  const operation = input.endpoint === 'poll' ? 'agent.poll' : 'agent.events';
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
    message: `Agent ${input.endpoint} request denied -> ${input.denialCode}`,
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
  const state: MockApiState = {
    agents: clone(seedInventory ? seedAgents : []),
    nodes: clone(seedInventory ? seedNodes : []),
    inbounds: clone(seedInventory ? seedInbounds : []),
    subscriptionSources: clone(seedInventory ? seedSubscriptionSources : []),
    subscriptionInventoryNodes: [],
    subscriptionBundles: clone(seedInventory ? seedSubscriptionBundles : []),
    subscriptionClients: clone(seedInventory ? seedSubscriptionClients : []),
    subscriptionExportProfiles: [],
    forwardRules: clone(seedInventory ? seedForwardRules : []),
    quotaPolicies: clone(seedInventory ? seedQuotaPolicies : []),
    rateLimitPolicies: clone(seedInventory ? seedRateLimitPolicies : []),
    permissionGrants: clone(seedPermissionGrants),
    configRevisions: [],
    preflightPlans: [],
    runtimeSnapshots: [],
    trafficRollups: [],
    routingPolicies: clone(seedInventory ? seedRoutingPolicies : []),
    tuningProfiles: clone(seedInventory ? seedTuningProfiles : []),
    tasks: clone(seedTasks),
    commandOutbox: [],
    agentEvents: [],
    agentCredentials: [],
    operatorSessions: [],
    auditLogs: clone(seedAuditLogs),
    taskIdempotencyIndex: {},
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

  const api: ControlPlaneApi = {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async getAgentLogRetentionPolicy() {
      return {
        maxAgeMs: MOCK_AGENT_LOG_RETENTION_MAX_AGE_MS,
        maxAgeDays: MOCK_AGENT_LOG_RETENTION_MAX_AGE_MS / 24 / 60 / 60 / 1000,
        maxEventsPerAgent: MOCK_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT,
        source: 'runtime-config'
      };
    },

    async getObservabilityMetrics() {
      const liveAgents = applyAgentLivenessToReadModel(state.agents, readModelNow());
      const systemAlerts = createSystemAlertsFromAgents(liveAgents);

      return createObservabilityMetrics({
        generatedAt: readModelNow(),
        tasks: state.tasks,
        commandOutbox: state.commandOutbox,
        agents: liveAgents,
        systemAlerts,
        audit: verifyAuditLogs(clone(state.auditLogs)),
        auditLogs: state.auditLogs
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

    async listSystemAlerts() {
      return clone(createSystemAlertsFromAgents(applyAgentLivenessToReadModel(state.agents, readModelNow())));
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

    async listAgentCredentials() {
      return clone(state.agentCredentials);
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

    async listTrafficRollups() {
      return clone(state.trafficRollups);
    },

    async listAgentLogChunks(query) {
      return selectAgentLogChunks(state.agentEvents, query);
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? state.auditLogs));
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

      const permissionDenial = resolveAgentInstallCommandPermissionDenial(mutationContext, state.permissionGrants);

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

      const issuedAt = new Date().toISOString();
      const command = composeAgentInstallCommand(input, { issuedAt });
      const credential: AgentCredentialSummary = {
        id: `agent-credential-${command.agentId}-${createTokenPrefix(command.installToken).replace(/[^a-zA-Z0-9_.@-]/g, '-')}`,
        agentId: command.agentId,
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
      appendAuditLog(createAgentCredentialIssuedAudit(credential, input, state.sequence++, mutationContext, requestBodyHash));

      return command;
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60_000).toISOString();
      const requestBodyHash = createStableSha256LikeHash(input);
      const installTokenPresented = installToken.trim().length > 0;
      const installCredential = installTokenPresented
        ? state.agentCredentials.find((item) => item.tokenPrefix === createTokenPrefix(installToken))
        : undefined;
      const createDeniedRegistrationError = (
        denialCode: string,
        denialReason: string,
        deniedInstallCredential?: AgentCredentialSummary
      ) => {
        appendAuditLog(
          createAgentRegistrationDeniedAudit(
            input,
            deniedInstallCredential,
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
      const credential: AgentCredentialSummary = {
        id: credentialId,
        agentId: input.agentId,
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
          installProfile: input.capabilities ?? [],
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

      const revokedCredential: AgentCredentialSummary = {
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
      return clone(revokedCredential);
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
      const revokedCredential: AgentCredentialSummary = {
        ...credential,
        status: 'revoked',
        revokedAt: issuedAt,
        revokedBy: context?.actor ?? 'admin',
        revokedReason: input.reason,
        replacedByCredentialId: nextCredentialId
      };
      const issuedCredential: AgentCredentialSummary = {
        ...credential,
        id: nextCredentialId,
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

      const permissionDenial =
        resolveOperationPermissionDenial(taskInput, mutationContext, state.permissionGrants) ??
        resolvePermissionGrantDenial(taskInput, mutationContext, state.permissionGrants) ??
        resolvePermissionRevokeDenial(taskInput, state.permissionGrants);

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
          denialReason: 'Runtime forwarding success must be recorded from Agent result events.'
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
