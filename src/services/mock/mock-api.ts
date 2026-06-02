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
  PermissionGrant,
  QuotaPolicy,
  RateLimitPolicy,
  ResourcePermission,
  RoutingPolicy,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  SubscriptionBundle,
  SubscriptionSource,
  Tunnel,
  TuningProfile,
  XrayInbound
} from '../../domain';
import { composeAgentInstallCommand, createRuntimeAgentToken } from '../../domain';
import type {
  AgentCommandLeaseOptions,
  AuditChainVerification,
  CommandTimeoutSweepOptions,
  CommandOutboxItem,
  ControlPlaneApi,
  MutationContext
} from '../api/control-plane-api';
import {
  agentCommandEnvelopeSchema,
  type AgentEventEnvelope,
  parseAgentEventEnvelope,
  parseCreateTaskRequest,
  parseMutationContext
} from '../api/api-contract';
import { v1ApiBoundary } from '../api/control-plane-api';
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
  seedSubscriptionSources,
  seedTasks,
  seedTuningProfiles,
  seedTunnels
} from './mock-data';

type MockApiState = {
  agents: Agent[];
  nodes: ManagedNode[];
  inbounds: XrayInbound[];
  subscriptionSources: SubscriptionSource[];
  subscriptionBundles: SubscriptionBundle[];
  tunnels: Tunnel[];
  forwardRules: ForwardRule[];
  quotaPolicies: QuotaPolicy[];
  rateLimitPolicies: RateLimitPolicy[];
  permissionGrants: PermissionGrant[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  routingPolicies: RoutingPolicy[];
  tuningProfiles: TuningProfile[];
  tasks: DeployTask[];
  commandOutbox: CommandOutboxItem[];
  agentCredentials: AgentCredentialSummary[];
  auditLogs: AuditLog[];
  taskIdempotencyIndex: Record<string, IdempotencyRecord>;
  sequence: number;
};

type IdempotencyRecord = {
  taskId: string;
  actor: string;
  method: 'POST';
  path: '/api/v1/tasks';
  requestId: string;
  idempotencyKey: string;
  requestBodyHash: string;
};

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

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

function createChecksum(sequence: number) {
  return `sha256:${String(sequence).padStart(64, '0').slice(-64)}`;
}

function createSignature(checksum: string) {
  return `sig-v1:${checksum.replace('sha256:', '').slice(0, 32)}`;
}

function shouldCreateAgentCommand(operation: CreateTaskInput['operation']) {
  return [
    'agent.deploy',
    'agent.rollback',
    'config.apply',
    'runtime.reload',
    'forward.create',
    'forward.apply',
    'system.tune'
  ].includes(operation);
}

function resolveAgentIdForTask(task: DeployTask) {
  return task.resourceType === 'agent' ? task.targetId : 'agent-hkg-01';
}

function readForwardingTargetAgentIds(task: DeployTask) {
  const agentIds = task.metadata?.entryNodeIds ?? task.metadata?.agentIds;

  if (!Array.isArray(agentIds)) {
    return [];
  }

  return [...new Set(agentIds.filter((agentId): agentId is string => typeof agentId === 'string' && agentId.trim() !== ''))];
}

function resolveAgentIdsForTask(task: DeployTask) {
  const targetAgentIds = task.operation === 'forward.create' ? readForwardingTargetAgentIds(task) : [];
  return targetAgentIds.length > 0 ? targetAgentIds : [resolveAgentIdForTask(task)];
}

function shouldNamespaceCommandArtifacts(task: DeployTask) {
  return task.operation === 'forward.create' && readForwardingTargetAgentIds(task).length > 0;
}

function resolveModuleKindForTask(operation: CreateTaskInput['operation']): 'flvx' | 'bbr' | 'system' {
  if (operation.startsWith('forward.')) return 'flvx';
  if (operation.startsWith('system.')) return 'bbr';
  return 'system';
}

function createCommandOutboxItem(task: DeployTask, sequence: number, agentId = resolveAgentIdForTask(task)): CommandOutboxItem {
  const artifactSuffix = shouldNamespaceCommandArtifacts(task) ? `-${agentId}` : '';
  const commandId = `cmd-${task.id}${artifactSuffix}`;
  const deadlineAt = addMinutes(task.createdAt, 5);
  const checksum = createChecksum(sequence);
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
              moduleKind: resolveModuleKindForTask(task.operation),
              artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}${artifactSuffix}.json`,
              checksum,
              signature: createSignature(checksum),
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

function createCommandOutboxItems(task: DeployTask, firstSequence: number) {
  return resolveAgentIdsForTask(task).map((agentId, index) => createCommandOutboxItem(task, firstSequence + index, agentId));
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

function getActorPermissions(
  permissionGrants: PermissionGrant[],
  context: MutationContext,
  resourceId: string
): Set<ResourcePermission> {
  const actorPermissions = new Set<ResourcePermission>();

  permissionGrants
    .filter((grant) => grant.resourceId === resourceId)
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

function resolvePermissionGrantDenial(
  input: CreateTaskInput,
  context: MutationContext,
  permissionGrants: PermissionGrant[]
) {
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

  return undefined;
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

function leaseMockCommandOutbox(
  state: MockApiState,
  agentId: string,
  options: AgentCommandLeaseOptions
): CommandOutboxItem[] {
  const now = options.now ?? nextTimestamp(state.sequence++);
  const nowMs = Date.parse(now);
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const maxCommands = options.maxCommands ?? 50;
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
    item.attempts += 1;
    item.updatedAt = now;
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
        operation: task.operation,
        targetId: task.targetId,
        targetLabel: task.targetLabel,
        moduleKind,
        generatedBy: 'ou-ui-next-control-plane'
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
      checks: [
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
          id: 'rollback-snapshot',
          label: 'Confirm rollback snapshot availability before apply',
          status: 'pending',
          severity: 'warning'
        }
      ]
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
      configRevision.healthSummary =
        agentEvent.payload.status === 'succeeded' ? agentEvent.payload.healthSummary : configRevision.healthSummary;
    }

    if (preflightPlan) {
      preflightPlan.status = agentEvent.payload.status === 'succeeded' ? 'passed' : 'failed';
      preflightPlan.completedAt = agentEvent.observedAt;
      preflightPlan.failureReason =
        agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : preflightPlan.failureReason;
      preflightPlan.checks = preflightPlan.checks.map((check) => ({
        ...check,
        status: agentEvent.payload.status === 'succeeded' ? 'passed' : check.severity === 'critical' ? 'failed' : check.status
      }));
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
    before: status === 'created' ? undefined : { status: beforeStatus },
    after: { status, resourceId: task.resourceId }
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

export function createMockApi(): ControlPlaneApi {
  const state: MockApiState = {
    agents: clone(seedAgents),
    nodes: clone(seedNodes),
    inbounds: clone(seedInbounds),
    subscriptionSources: clone(seedSubscriptionSources),
    subscriptionBundles: clone(seedSubscriptionBundles),
    tunnels: clone(seedTunnels),
    forwardRules: clone(seedForwardRules),
    quotaPolicies: clone(seedQuotaPolicies),
    rateLimitPolicies: clone(seedRateLimitPolicies),
    permissionGrants: clone(seedPermissionGrants),
    configRevisions: [],
    preflightPlans: [],
    runtimeSnapshots: [],
    routingPolicies: clone(seedRoutingPolicies),
    tuningProfiles: clone(seedTuningProfiles),
    tasks: clone(seedTasks),
    commandOutbox: [],
    agentCredentials: [],
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

  return {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async listAgents() {
      return clone(state.agents);
    },

    async listNodes() {
      return clone(state.nodes);
    },

    async listInbounds() {
      return clone(state.inbounds);
    },

    async listSubscriptionSources() {
      return clone(state.subscriptionSources);
    },

    async listSubscriptionBundles() {
      return clone(state.subscriptionBundles);
    },

    async listTunnels() {
      return clone(state.tunnels);
    },

    async listForwardRules() {
      return clone(state.forwardRules);
    },

    async listQuotaPolicies() {
      return clone(state.quotaPolicies);
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

    async listConfigRevisions() {
      return clone(state.configRevisions);
    },

    async listPreflightPlans() {
      return clone(state.preflightPlans);
    },

    async listRuntimeSnapshots() {
      return clone(state.runtimeSnapshots);
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? state.auditLogs));
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest) {
      return composeAgentInstallCommand(input);
    },

    async registerAgent(input: AgentRegistrationRequest) {
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60_000).toISOString();
      const agentToken = createRuntimeAgentToken();
      const credentialId = `mock-agent-credential-${input.agentId}`;
      const credential: AgentCredentialSummary = {
        id: credentialId,
        agentId: input.agentId,
        tokenPrefix: createTokenPrefix(agentToken),
        status: 'active',
        purpose: 'runtime',
        issuedAt,
        expiresAt,
        issuedBy: `agent:${input.agentId}`,
        sourceIp: '127.0.0.1',
        requestId: input.requestId,
        sessionId: input.sessionId,
        metadata: {
          hostName: input.agentId.replace(/^agent-/, ''),
          installProfile: input.capabilities ?? []
        }
      };

      state.agentCredentials = [credential, ...state.agentCredentials.filter((item) => item.id !== credential.id)];

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

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      const taskInput = parseCreateTaskRequest(input);
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

        throw new Error(permissionDenial.denialCode);
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

      state.tasks.unshift(task);
      applyPermissionGrant(taskInput, mutationContext, now);
      applyPermissionRevoke(taskInput, mutationContext, now);
      if (shouldCreateAgentCommand(task.operation)) {
        const outboxItems = createCommandOutboxItems(task, state.sequence);
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
      return clone(task);
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext) {
      const task = state.tasks.find((item) => item.id === taskId);

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      applyTaskTransition(task, status, resolveMutationContext(context, state.sequence));

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

      if (agentEvent.type === 'heartbeat' || agentEvent.type === 'telemetry_sample') {
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

      if (agentEvent.type === 'ack') {
        outboxItem.status = 'acknowledged';
        outboxItem.ackedAt = agentEvent.observedAt;
        outboxItem.updatedAt = agentEvent.observedAt;
        outboxItem.attempts += 1;

        if (task.status === 'queued') {
          applyTaskTransition(task, 'running', context, agentEvent.observedAt);
        }

        return clone(task);
      }

      if (agentEvent.type === 'result') {
        outboxItem.status = agentEvent.payload.status === 'succeeded' ? 'completed' : 'failed';
        outboxItem.resultAt = agentEvent.observedAt;
        outboxItem.updatedAt = agentEvent.observedAt;
        outboxItem.lastError = agentEvent.payload.failureReason;
        updateMockRuntimeReleaseFromResult(state, task, outboxItem.command, agentEvent);

        const relatedOutboxItems = state.commandOutbox.filter((item) => item.taskId === task.id);
        const allRelatedCommandsCompleted = relatedOutboxItems.every((item) => item.status === 'completed');
        const nextStatus =
          agentEvent.payload.status === 'failed'
            ? 'failed'
            : allRelatedCommandsCompleted
              ? 'succeeded'
              : undefined;

        if (!nextStatus) {
          return clone(task);
        }

        applyTaskTransition(task, nextStatus, context, agentEvent.observedAt, agentEvent.payload.failureReason);

        return clone(task);
      }

      outboxItem.updatedAt = agentEvent.observedAt;
      return clone(task);
    }
  };
}
