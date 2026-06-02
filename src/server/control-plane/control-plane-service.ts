import type {
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentRuntimeCredential,
  AuditLog,
  CreateTaskInput,
  DeployResourceType,
  DeployTaskStatus,
  DeployTask,
  PermissionGrant,
  ResourcePermission,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot
} from '../../domain';
import { composeAgentInstallCommand, createRuntimeAgentToken } from '../../domain';
import {
  agentCommandEnvelopeSchema,
  parseAgentEventEnvelope,
  parseCreateTaskRequest,
  parseMutationContext,
  type AgentCommandEnvelope,
  type AgentEventEnvelope
} from '../../services/api/api-contract';
import type {
  AgentCommandLeaseOptions,
  CommandTimeoutSweepOptions,
  CommandOutboxItem,
  MutationContext
} from '../../services/api/control-plane-api';
import type { AgentCredentialRecord, ControlPlaneRepository, ControlPlaneTransaction } from './control-plane-repository';
import {
  createAgentCredentialTokenHash,
  createAgentCredentialTokenPrefix,
  isAgentCredentialActive
} from './agent-credentials';

type CreateControlPlaneServiceInput = {
  repository: ControlPlaneRepository;
};

type AgentRegistrationContext = {
  sourceIp?: string;
  userAgent?: string;
};

type CreateTaskTransactionResult =
  | DeployTask
  | {
      type: 'error';
      code: string;
    };

function isCreateTaskError(result: CreateTaskTransactionResult): result is Extract<CreateTaskTransactionResult, { type: 'error' }> {
  return 'type' in result && result.type === 'error';
}

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const DEFAULT_RUNTIME_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function createAuditIntegrityHash(log: AuditLog) {
  const hashableLog = { ...log };
  delete hashableLog.hash;
  return createStableSha256LikeHash(hashableLog);
}

const allowedTaskTransitions: Record<DeployTaskStatus, DeployTaskStatus[]> = {
  queued: ['running', 'failed', 'canceled'],
  running: ['succeeded', 'failed', 'retrying', 'canceled'],
  retrying: ['running', 'failed', 'canceled'],
  succeeded: ['rolled_back'],
  failed: ['retrying', 'rolled_back'],
  rolled_back: [],
  canceled: []
};

function assertValidTaskTransition(from: DeployTaskStatus, to: DeployTaskStatus) {
  if (!allowedTaskTransitions[from].includes(to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}

function createRequestHash(input: CreateTaskInput) {
  return createStableSha256LikeHash(input);
}

function nextTimestamp(sequence: number) {
  return new Date(Date.UTC(2026, 5, 2, 0, 0, sequence)).toISOString();
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}

function addMilliseconds(timestamp: string, milliseconds: number) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function createAgentCredentialRecord(
  command: ReturnType<typeof composeAgentInstallCommand>,
  input: AgentInstallCommandRequest,
  context: MutationContext,
  issuedAt: string
): AgentCredentialRecord {
  return {
    id: `agent-credential-${command.agentId}-${createAgentCredentialTokenHash(command.installToken).slice(-12)}`,
    agentId: command.agentId,
    tokenHash: createAgentCredentialTokenHash(command.installToken),
    tokenPrefix: createAgentCredentialTokenPrefix(command.installToken),
    status: 'active',
    purpose: 'install',
    issuedAt,
    expiresAt: command.expiresAt,
    issuedBy: context.actor,
    sourceIp: context.sourceIp,
    requestId: context.requestId,
    metadata: {
      hostName: input.hostName,
      maxTrafficGb: input.maxTrafficGb,
      customerNodeName: input.customerNodeName,
      customerName: input.customerName,
      remainingDays: input.remainingDays,
      installProfile: [...input.installProfile]
    }
  };
}

function createAgentRuntimeCredentialRecord(
  installCredential: AgentCredentialRecord,
  input: AgentRegistrationRequest,
  token: string,
  issuedAt: string,
  expiresAt: string,
  context: AgentRegistrationContext | undefined
): AgentCredentialRecord {
  return {
    id: `agent-credential-${installCredential.agentId}-${createAgentCredentialTokenHash(token).slice(-12)}`,
    agentId: installCredential.agentId,
    tokenHash: createAgentCredentialTokenHash(token),
    tokenPrefix: createAgentCredentialTokenPrefix(token),
    status: 'active',
    purpose: 'runtime',
    issuedAt,
    expiresAt,
    issuedBy: `agent:${input.agentId}`,
    sourceIp: context?.sourceIp ?? installCredential.sourceIp,
    requestId: input.requestId,
    sessionId: input.sessionId,
    metadata: {
      ...installCredential.metadata,
      installProfile: [...installCredential.metadata.installProfile]
    }
  };
}

function createChecksum(sequence: number) {
  return `sha256:${String(sequence).padStart(64, '0').slice(-64)}`;
}

function createSignature(checksum: string) {
  return `sig-v1:${checksum.replace('sha256:', '').slice(0, 32)}`;
}

function inferResourceType(operation: CreateTaskInput['operation']): DeployResourceType {
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
    { id: 'step-validate', label: `Validate request: ${summary}`, status: 'pending' as const },
    { id: 'step-apply', label: 'Apply runtime configuration change', status: 'pending' as const },
    { id: 'step-audit', label: 'Record audit event', status: 'pending' as const }
  ];
}

function createIdempotencyRecordKey(context: MutationContext) {
  return `${context.actor}:POST:/api/v1/tasks:${context.idempotencyKey ?? context.requestId}`;
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
  const agentIds = task.metadata?.agentIds;

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
  const command: AgentCommandEnvelope =
    task.operation === 'agent.rollback'
      ? {
          ...baseCommand,
          type: 'rollback',
          payload: {
            snapshotId: `snapshot-before-${task.targetId}`,
            targetConfigRevision: `cfg-rollback-${task.id}`,
            rollbackReason: task.summary,
            rollbackMode: 'graceful_restart'
          }
        }
      : task.operation === 'runtime.reload'
        ? {
            ...baseCommand,
            type: 'reload',
            payload: {
              moduleKind: 'system',
              moduleId: task.targetId,
              configRevision: `cfg-${task.id}`,
              reloadMode: 'graceful_restart'
            }
          }
        : {
            ...baseCommand,
            type: 'apply',
            payload: {
              configRevision: `cfg-${task.id}${artifactSuffix}`,
              moduleKind: resolveModuleKindForTask(task.operation),
              artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}${artifactSuffix}.json`,
              checksum,
              signature: createSignature(checksum),
              preflightPlanId: `preflight-${task.id}${artifactSuffix}`,
              snapshotBeforeId: `snapshot-before-${task.targetId}${artifactSuffix}`,
              applyMode: 'graceful_restart',
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
    transport: 'http-pull',
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

function createRuntimeReleaseArtifacts(
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

async function updateRuntimeReleaseFromResult(
  transaction: ControlPlaneTransaction,
  task: DeployTask,
  command: CommandOutboxItem['command'],
  agentEvent: Extract<AgentEventEnvelope, { type: 'result' }>
) {
  if (command.type === 'apply') {
    const configRevisionId = command.payload.configRevision;
    const preflightPlanId = command.payload.preflightPlanId ?? `preflight-${task.id}`;
    const snapshotBeforeId = command.payload.snapshotBeforeId ?? `snapshot-before-${task.targetId}`;
    const configRevision = (await transaction.listConfigRevisions()).find((item) => item.id === configRevisionId);
    const preflightPlan = (await transaction.listPreflightPlans()).find((item) => item.id === preflightPlanId);
    const runtimeSnapshot = (await transaction.listRuntimeSnapshots()).find((item) => item.id === snapshotBeforeId);

    if (configRevision) {
      await transaction.updateConfigRevision({
        ...configRevision,
        status: agentEvent.payload.status === 'succeeded' ? 'applied' : 'failed',
        appliedAt: agentEvent.payload.status === 'succeeded' ? agentEvent.observedAt : configRevision.appliedAt,
        failedAt: agentEvent.payload.status === 'failed' ? agentEvent.observedAt : configRevision.failedAt,
        failureReason: agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : configRevision.failureReason,
        healthSummary:
          agentEvent.payload.status === 'succeeded' ? agentEvent.payload.healthSummary : configRevision.healthSummary
      });
    }

    if (preflightPlan) {
      await transaction.updatePreflightPlan({
        ...preflightPlan,
        status: agentEvent.payload.status === 'succeeded' ? 'passed' : 'failed',
        completedAt: agentEvent.observedAt,
        failureReason: agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : preflightPlan.failureReason,
        checks: preflightPlan.checks.map((check) => ({
          ...check,
          status: agentEvent.payload.status === 'succeeded' ? 'passed' : check.severity === 'critical' ? 'failed' : check.status
        }))
      });
    }

    if (runtimeSnapshot && agentEvent.payload.status === 'succeeded') {
      await transaction.updateRuntimeSnapshot({
        ...runtimeSnapshot,
        status: 'verified',
        verifiedAt: agentEvent.observedAt
      });
    }
  }

  if (command.type === 'rollback' && agentEvent.payload.status === 'rolled_back') {
    const runtimeSnapshot = (await transaction.listRuntimeSnapshots()).find((item) => item.id === command.payload.snapshotId);

    if (runtimeSnapshot) {
      await transaction.updateRuntimeSnapshot({
        ...runtimeSnapshot,
        status: 'restored',
        restoredAt: agentEvent.observedAt,
        restoredByTaskId: task.id
      });
    }
  }
}

function getActorPermissions(
  permissionGrants: PermissionGrant[],
  context: MutationContext,
  resourceId: string
): Set<ResourcePermission> {
  const permissions = new Set<ResourcePermission>();

  permissionGrants
    .filter((grant) => grant.resourceId === resourceId)
    .filter((grant) => !grant.revokedAt)
    .filter(
      (grant) =>
        (grant.subjectType === 'user' && grant.subjectId === context.actor) ||
        (grant.subjectType === 'group' && grant.subjectId === context.operatorGroupId)
    )
    .forEach((grant) => {
      grant.permissions.forEach((permission) => permissions.add(permission));
    });

  return permissions;
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

async function resolveCurrentResourceVersion(input: CreateTaskInput, transaction: ControlPlaneTransaction) {
  if (input.operation.startsWith('forward.')) {
    return (await transaction.findForwardRule(input.targetId))?.resourceVersion;
  }

  return undefined;
}

function createPermissionGrant(input: CreateTaskInput, context: MutationContext, timestamp: string, sequence: number) {
  if (input.operation !== 'permission.grant' || !input.permissionChange) {
    return undefined;
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
    resourceVersion: `permv-${String(sequence).padStart(4, '0')}`,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return grant;
}

function createRevokedPermissionGrant(
  input: CreateTaskInput,
  context: MutationContext,
  timestamp: string,
  sequence: number,
  permissionGrants: PermissionGrant[]
) {
  if (input.operation !== 'permission.revoke' || !input.permissionChange) {
    return undefined;
  }

  const grant = permissionGrants.find((item) => item.id === input.targetId);

  if (!grant || grant.revokedAt) {
    return undefined;
  }

  return {
    ...grant,
    revokedAt: timestamp,
    revokedBy: context.actor,
    revokedReason: input.permissionChange.reason,
    resourceVersion: `permv-${String(sequence).padStart(4, '0')}`,
    updatedAt: timestamp
  };
}

export function createControlPlaneService({ repository }: CreateControlPlaneServiceInput) {
  let sequence = 1;

  async function appendLedgerAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
    const existingLogs = await repository.listAuditLogs();
    const auditWithPrevHash = {
      ...auditLog,
      prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    await transaction.insertAuditLog({
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    });
  }

  function createDeniedAudit(
    input: CreateTaskInput,
    resourceType: DeployResourceType,
    context: MutationContext,
    denialCode: string,
    denialReason: string,
    requestBodyHash: string,
    before?: unknown,
    after?: unknown
  ): AuditLog {
    return {
      id: `audit-${String(sequence++).padStart(4, '0')}`,
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
      createdAt: nextTimestamp(sequence++),
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

  function createCreatedAudit(task: DeployTask, context: MutationContext): AuditLog {
    return {
      id: `audit-${String(sequence++).padStart(4, '0')}`,
      action: 'task.created',
      actor: context.actor,
      operatorGroupId: context.operatorGroupId,
      resourceGroupId: context.resourceGroupId,
      scope: `control-plane:${task.resourceType}`,
      resourceType: task.resourceType,
      operation: task.operation,
      result: 'accepted',
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      taskId: task.id,
      severity: 'info',
      message: `${task.summary} -> task.created`,
      createdAt: nextTimestamp(sequence++),
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      requestId: context.requestId,
      after: {
        status: 'created',
        resourceId: task.resourceId
      }
    };
  }

  function createTaskStatusAudit(
    task: DeployTask,
    status: DeployTaskStatus,
    beforeStatus: DeployTaskStatus,
    observedAt: string
  ): AuditLog {
    return {
      id: `audit-${String(sequence++).padStart(4, '0')}`,
      action: `task.${status}`,
      actor: task.actor,
      scope: `control-plane:${task.resourceType}`,
      resourceType: task.resourceType,
      operation: task.operation,
      result: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'accepted',
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      taskId: task.id,
      severity: status === 'failed' ? 'warning' : 'info',
      message: `${task.summary} -> task.${status}`,
      createdAt: observedAt,
      sourceIp: task.sourceIp,
      requestId: task.requestId,
      before: {
        status: beforeStatus
      },
      after: {
        status,
        resourceId: task.resourceId,
        failureReason: status === 'failed' ? task.failureReason : undefined
      }
    };
  }

  function applyTaskTransition(
    task: DeployTask,
    status: DeployTaskStatus,
    observedAt: string,
    failureReason?: string
  ) {
    const previousStatus = task.status;
    assertValidTaskTransition(previousStatus, status);

    task.status = status;
    task.updatedAt = observedAt;
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

    return previousStatus;
  }

  async function recordAgentEventSession(transaction: ControlPlaneTransaction, agentEvent: AgentEventEnvelope) {
    const existingEvent = await transaction.findAgentEvent(agentEvent.eventId);

    if (existingEvent) {
      return {
        duplicate: true
      };
    }

    const existingSession = await transaction.findAgentSession(agentEvent.agentId, agentEvent.sessionId);

    if (existingSession && agentEvent.seq <= existingSession.lastSeq) {
      throw new Error('agent_event.sequence_replay');
    }

    await transaction.insertAgentEvent(agentEvent);
    await transaction.upsertAgentSession({
      agentId: agentEvent.agentId,
      sessionId: agentEvent.sessionId,
      status: 'online',
      lastSeq: agentEvent.seq,
      lastSeenCommandSeq:
        agentEvent.type === 'heartbeat'
          ? agentEvent.payload.lastSeenCommandSeq
          : existingSession?.lastSeenCommandSeq,
      version: agentEvent.type === 'heartbeat' ? agentEvent.payload.version : existingSession?.version,
      capabilities:
        agentEvent.type === 'heartbeat'
          ? agentEvent.payload.capabilities
          : existingSession?.capabilities,
      lastHeartbeatAt: agentEvent.type === 'heartbeat' ? agentEvent.observedAt : existingSession?.lastHeartbeatAt,
      updatedAt: agentEvent.observedAt
    });

    return {
      duplicate: false
    };
  }

  async function expireCommandDeadline(
    transaction: ControlPlaneTransaction,
    outboxItem: CommandOutboxItem,
    observedAt: string
  ) {
    await transaction.updateCommandOutboxItem({
      ...outboxItem,
      status: 'expired',
      updatedAt: observedAt,
      lastError: 'command.deadline.expired'
    });

    const task = await transaction.findTask(outboxItem.taskId);

    if (!task || !['queued', 'running', 'retrying'].includes(task.status)) {
      return {
        task,
        taskFailed: false
      };
    }

    const previousStatus = applyTaskTransition(task, 'failed', observedAt, 'command.deadline.expired');
    await transaction.updateTask(task);
    await appendLedgerAuditLog(transaction, createTaskStatusAudit(task, 'failed', previousStatus, observedAt));
    return {
      task,
      taskFailed: true
    };
  }

  async function deadLetterCommand(
    transaction: ControlPlaneTransaction,
    outboxItem: CommandOutboxItem,
    observedAt: string,
    reason: 'command.ack.timeout' | 'command.result.timeout'
  ) {
    await transaction.updateCommandOutboxItem({
      ...outboxItem,
      status: 'dead_letter',
      updatedAt: observedAt,
      lastError: reason
    });

    const task = await transaction.findTask(outboxItem.taskId);

    if (!task || !['queued', 'running', 'retrying'].includes(task.status)) {
      return {
        task,
        taskFailed: false
      };
    }

    const previousStatus = applyTaskTransition(task, 'failed', observedAt, reason);
    await transaction.updateTask(task);
    await appendLedgerAuditLog(transaction, createTaskStatusAudit(task, 'failed', previousStatus, observedAt));
    return {
      task,
      taskFailed: true
    };
  }

  return {
    async createAgentInstallCommand(input: AgentInstallCommandRequest, context: MutationContext) {
      const mutationContext = parseMutationContext(context);
      const issuedAt = new Date().toISOString();
      const command = composeAgentInstallCommand(input, {
        issuedAt
      });
      const credential = createAgentCredentialRecord(command, input, mutationContext, issuedAt);

      await repository.transaction(async (transaction) => {
        await transaction.upsertAgentCredential(credential);
      });

      return command;
    },

    async registerAgent(
      input: AgentRegistrationRequest,
      installToken: string,
      context?: AgentRegistrationContext
    ): Promise<AgentRuntimeCredential> {
      if (!installToken.trim()) {
        throw new Error('agent_registration.install_token_required');
      }

      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + DEFAULT_RUNTIME_CREDENTIAL_TTL_MS).toISOString();
      const installTokenHash = createAgentCredentialTokenHash(installToken);
      const runtimeToken = createRuntimeAgentToken();
      let registration: AgentRuntimeCredential | undefined;

      await repository.transaction(async (transaction) => {
        const installCredential = await transaction.findAgentCredentialByTokenHash(installTokenHash);

        if (!installCredential || installCredential.purpose !== 'install') {
          throw new Error('agent_registration.install_token_invalid');
        }

        if (installCredential.agentId !== input.agentId) {
          throw new Error('agent_registration.agent_mismatch');
        }

        if (!isAgentCredentialActive(installCredential, issuedAt)) {
          if (installCredential.status === 'active') {
            await transaction.upsertAgentCredential({
              ...installCredential,
              status: 'expired',
              lastUsedAt: issuedAt
            });
          }

          throw new Error('agent_registration.install_token_expired');
        }

        const runtimeCredential = createAgentRuntimeCredentialRecord(
          installCredential,
          input,
          runtimeToken,
          issuedAt,
          expiresAt,
          context
        );

        await transaction.upsertAgentCredential({
          ...installCredential,
          status: 'revoked',
          lastUsedAt: issuedAt,
          sessionId: input.sessionId,
          revokedAt: issuedAt,
          revokedBy: `agent:${input.agentId}`,
          revokedReason: 'agent.install_token_redeemed',
          replacedByCredentialId: runtimeCredential.id
        });
        await transaction.upsertAgentCredential(runtimeCredential);

        registration = {
          agentId: input.agentId,
          agentToken: runtimeToken,
          tokenPrefix: runtimeCredential.tokenPrefix,
          credentialId: runtimeCredential.id,
          issuedAt,
          expiresAt,
          sessionId: input.sessionId
        };
      });

      if (!registration) {
        throw new Error('agent_registration.failed');
      }

      return registration;
    },

    async resolveAgentToken(token: string, observedAt = new Date().toISOString()) {
      const tokenHash = createAgentCredentialTokenHash(token);
      const credential = await repository.findAgentCredentialByTokenHash(tokenHash);

      if (!credential || credential.purpose !== 'runtime') {
        return undefined;
      }

      if (!isAgentCredentialActive(credential, observedAt)) {
        if (credential.status === 'active') {
          await repository.transaction(async (transaction) => {
            const current = await transaction.findAgentCredentialByTokenHash(tokenHash);

            if (current && !isAgentCredentialActive(current, observedAt)) {
              await transaction.upsertAgentCredential({
                ...current,
                status: 'expired',
                lastUsedAt: observedAt
              });
            }
          });
        }

        return undefined;
      }

      await repository.transaction(async (transaction) => {
        const current = await transaction.findAgentCredentialByTokenHash(tokenHash);

        if (current && isAgentCredentialActive(current, observedAt)) {
          await transaction.upsertAgentCredential({
            ...current,
            lastUsedAt: observedAt
          });
        }
      });

      return {
        agentId: credential.agentId
      };
    },

    async createTask(input: CreateTaskInput, context: MutationContext) {
      const taskInput = parseCreateTaskRequest(input);
      const mutationContext = parseMutationContext(context);
      const requestBodyHash = createRequestHash(taskInput);
      const idempotencyKey = createIdempotencyRecordKey(mutationContext);
      const resourceType = taskInput.resourceType ?? inferResourceType(taskInput.operation);

      const result = await repository.transaction<CreateTaskTransactionResult>(async (transaction) => {
        const existingRecord = await transaction.findIdempotencyRecord(idempotencyKey);

        if (existingRecord) {
          const existingTask = await transaction.findTask(existingRecord.taskId);

          if (existingRecord.requestBodyHash !== requestBodyHash) {
            await appendLedgerAuditLog(
              transaction,
              createDeniedAudit(
                taskInput,
                resourceType,
                mutationContext,
                'idempotency.conflict',
                'A replayed mutation used the same idempotency identity with a different request body.',
                requestBodyHash,
                {
                  existingTaskId: existingRecord.taskId,
                  requestBodyHash: existingRecord.requestBodyHash
                },
                {
                  requestBodyHash
                }
              )
            );

            return {
              type: 'error' as const,
              code: 'idempotency.conflict'
            };
          }

          if (!existingTask) {
            throw new Error(`Idempotency record points to missing task: ${existingRecord.taskId}`);
          }

          return clone(existingTask);
        }

        const currentResourceVersion = await resolveCurrentResourceVersion(taskInput, transaction);

        if (mutationContext.ifMatch && currentResourceVersion && mutationContext.ifMatch !== currentResourceVersion) {
          await appendLedgerAuditLog(
            transaction,
            createDeniedAudit(
              taskInput,
              resourceType,
              mutationContext,
              'resource_version.conflict',
              'If-Match resource version does not match the current resource version.',
              requestBodyHash,
              {
                expectedResourceVersion: mutationContext.ifMatch
              },
              {
                currentResourceVersion
              }
            )
          );

          return {
            type: 'error' as const,
            code: 'resource_version.conflict'
          };
        }

        const permissionGrants = await transaction.listPermissionGrants();
        const operationPermissionDenial = resolveOperationPermissionDenial(taskInput, mutationContext, permissionGrants);
        const permissionDenial =
          operationPermissionDenial ??
          resolvePermissionGrantDenial(taskInput, mutationContext, permissionGrants) ??
          resolvePermissionRevokeDenial(taskInput, permissionGrants);

        if (permissionDenial) {
          await appendLedgerAuditLog(
            transaction,
            createDeniedAudit(
              taskInput,
              resourceType,
              mutationContext,
              permissionDenial.denialCode,
              permissionDenial.denialReason,
              requestBodyHash,
              permissionDenial.before,
              permissionDenial.after
            )
          );

          return {
            type: 'error' as const,
            code: permissionDenial.denialCode
          };
        }

        const now = nextTimestamp(sequence++);
        const task: DeployTask = {
          id: `task-${String(sequence).padStart(4, '0')}`,
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

        await transaction.insertTask(task);

        const permissionGrant = createPermissionGrant(taskInput, mutationContext, now, sequence);
        const revokedPermissionGrant = createRevokedPermissionGrant(
          taskInput,
          mutationContext,
          now,
          sequence,
          permissionGrants
        );

        if (permissionGrant) {
          await transaction.upsertPermissionGrant(permissionGrant);
        }

        if (revokedPermissionGrant) {
          await transaction.upsertPermissionGrant(revokedPermissionGrant);
        }

        if (shouldCreateAgentCommand(task.operation)) {
          const outboxItems = createCommandOutboxItems(task, sequence);
          sequence += outboxItems.length;

          for (const outboxItem of outboxItems) {
            const releaseArtifacts = createRuntimeReleaseArtifacts(task, outboxItem.command);

            if (releaseArtifacts) {
              await transaction.insertConfigRevision(releaseArtifacts.configRevision);
              await transaction.insertPreflightPlan(releaseArtifacts.preflightPlan);
              await transaction.insertRuntimeSnapshot(releaseArtifacts.runtimeSnapshot);
            }

            await transaction.insertCommandOutbox(outboxItem);
          }
        }

        await transaction.insertIdempotencyRecord({
          key: idempotencyKey,
          taskId: task.id,
          actor: mutationContext.actor,
          method: 'POST',
          path: '/api/v1/tasks',
          requestId: mutationContext.requestId,
          idempotencyKey: mutationContext.idempotencyKey ?? mutationContext.requestId,
          requestBodyHash
        });

        await appendLedgerAuditLog(transaction, createCreatedAudit(task, mutationContext));

        return clone(task);
      });

      if (isCreateTaskError(result)) {
        throw new Error(result.code);
      }

      return result;
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context: MutationContext) {
      const mutationContext = parseMutationContext(context);

      return repository.transaction(async (transaction) => {
        const task = await transaction.findTask(taskId);

        if (!task) {
          throw new Error(`Task not found: ${taskId}`);
        }

        const previousStatus = applyTaskTransition(task, status, nextTimestamp(sequence++));
        await transaction.updateTask(task);
        await appendLedgerAuditLog(transaction, {
          ...createTaskStatusAudit(task, status, previousStatus, task.updatedAt),
          actor: mutationContext.actor,
          operatorGroupId: mutationContext.operatorGroupId,
          resourceGroupId: mutationContext.resourceGroupId,
          sourceIp: mutationContext.sourceIp,
          userAgent: mutationContext.userAgent,
          requestId: mutationContext.requestId
        });

        return clone(task);
      });
    },

    async issueAgentCommand(agentId: string, command: AgentCommandEnvelope, context: MutationContext) {
      const mutationContext = parseMutationContext(context);
      const agentCommand = agentCommandEnvelopeSchema.parse(command);

      if (agentCommand.agentId !== agentId) {
        throw new Error('Invalid agent command: agentId does not match target agent');
      }

      return repository.transaction(async (transaction) => {
        const now = nextTimestamp(sequence++);
        const outboxItem: CommandOutboxItem = {
          id: `outbox-${String(sequence++).padStart(4, '0')}`,
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

        await transaction.insertCommandOutbox(outboxItem);
        await appendLedgerAuditLog(transaction, {
          id: `audit-${String(sequence++).padStart(4, '0')}`,
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
      });
    },

    async leaseAgentCommands(agentId: string, options: AgentCommandLeaseOptions) {
      const now = options.now ?? nextTimestamp(sequence++);
      const nowMs = Date.parse(now);
      const leaseDurationMs = options.leaseDurationMs ?? 30_000;
      const maxCommands = options.maxCommands ?? 50;

      return repository.transaction(async (transaction) => {
        const outbox = await transaction.listCommandOutbox();
        const leased: CommandOutboxItem[] = [];

        if (options.sessionId) {
          const existingSession = await transaction.findAgentSession(agentId, options.sessionId);
          await transaction.upsertAgentSession({
            agentId,
            sessionId: options.sessionId,
            status: 'online',
            lastSeq: existingSession?.lastSeq ?? 0,
            lastSeenCommandSeq: options.lastSeenCommandSeq ?? existingSession?.lastSeenCommandSeq,
            version: existingSession?.version,
            capabilities: existingSession?.capabilities,
            lastHeartbeatAt: existingSession?.lastHeartbeatAt,
            updatedAt: now
          });
        }

        for (const item of outbox) {
          if (item.agentId !== agentId || leased.length >= maxCommands) {
            continue;
          }

          const deadlineMs = Date.parse(item.deadlineAt);
          const leaseExpiresMs = item.leaseExpiresAt ? Date.parse(item.leaseExpiresAt) : undefined;
          const isDeadlineExpired = deadlineMs <= nowMs;
          const isPending = item.status === 'pending';
          const isExpiredLease = item.status === 'dispatched' && leaseExpiresMs !== undefined && leaseExpiresMs <= nowMs;

          if (isDeadlineExpired && (item.status === 'pending' || item.status === 'dispatched')) {
            await expireCommandDeadline(transaction, item, now);
            continue;
          }

          if (!isPending && !isExpiredLease) {
            continue;
          }

          const leasedItem: CommandOutboxItem = {
            ...item,
            status: 'dispatched',
            command: options.sessionId
              ? {
                  ...item.command,
                  sessionId: options.sessionId
                }
              : item.command,
            attempts: item.attempts + 1,
            updatedAt: now,
            leasedAt: now,
            leaseExpiresAt: addMilliseconds(now, leaseDurationMs),
            lastError: undefined
          };

          await transaction.updateCommandOutboxItem(leasedItem);
          leased.push(leasedItem);
        }

        return clone(leased);
      });
    },

    async sweepCommandTimeouts(options: CommandTimeoutSweepOptions) {
      const now = options.now ?? nextTimestamp(sequence++);
      const nowMs = Date.parse(now);
      const ackTimeoutMs = options.ackTimeoutMs ?? 15_000;
      const resultTimeoutMs = options.resultTimeoutMs ?? 120_000;
      const maxCommands = options.maxCommands ?? 500;

      return repository.transaction(async (transaction) => {
        const outbox = await transaction.listCommandOutbox();
        const result = {
          scanned: 0,
          expired: 0,
          deadLettered: 0,
          taskFailures: 0
        };

        for (const item of outbox) {
          if (result.scanned >= maxCommands) {
            break;
          }

          if (!['pending', 'dispatched', 'acknowledged'].includes(item.status)) {
            continue;
          }

          result.scanned += 1;

          if (Date.parse(item.deadlineAt) <= nowMs) {
            const expired = await expireCommandDeadline(transaction, item, now);
            result.expired += 1;
            result.taskFailures += expired.taskFailed ? 1 : 0;
            continue;
          }

          if (item.status === 'dispatched' && !item.ackedAt && item.leasedAt) {
            const ackDeadlineMs = Date.parse(item.leasedAt) + ackTimeoutMs;

            if (ackDeadlineMs <= nowMs) {
              const deadLettered = await deadLetterCommand(transaction, item, now, 'command.ack.timeout');
              result.deadLettered += 1;
              result.taskFailures += deadLettered.taskFailed ? 1 : 0;
            }
          }

          if (item.status === 'acknowledged' && item.ackedAt) {
            const resultDeadlineMs = Date.parse(item.ackedAt) + resultTimeoutMs;

            if (resultDeadlineMs <= nowMs) {
              const deadLettered = await deadLetterCommand(transaction, item, now, 'command.result.timeout');
              result.deadLettered += 1;
              result.taskFailures += deadLettered.taskFailed ? 1 : 0;
            }
          }
        }

        return result;
      });
    },

    async receiveAgentEvent(event: AgentEventEnvelope) {
      const agentEvent = parseAgentEventEnvelope(event);

      const result = await repository.transaction<
        | DeployTask
        | undefined
        | {
            errorCode: string;
          }
      >(async (transaction) => {
        if (agentEvent.type === 'heartbeat' || agentEvent.type === 'telemetry_sample') {
          await recordAgentEventSession(transaction, agentEvent);
          return undefined;
        }

        const task = await transaction.findTask(agentEvent.taskId);

        if (!task) {
          throw new Error(`Task not found: ${agentEvent.taskId}`);
        }

        const existingEvent = await transaction.findAgentEvent(agentEvent.eventId);

        if (existingEvent) {
          return clone(task);
        }

        const outboxItem = await transaction.findCommandOutboxItem(agentEvent.commandId, agentEvent.agentId);

        if (!outboxItem) {
          throw new Error(`Command outbox item not found: ${agentEvent.commandId}`);
        }

        if (Date.parse(agentEvent.observedAt) >= Date.parse(outboxItem.deadlineAt)) {
          await expireCommandDeadline(transaction, outboxItem, agentEvent.observedAt);
          return {
            errorCode: 'agent_event.command_deadline_expired'
          };
        }

        await recordAgentEventSession(transaction, agentEvent);

        if (agentEvent.type === 'ack') {
          outboxItem.status = 'acknowledged';
          outboxItem.ackedAt = agentEvent.observedAt;
          outboxItem.updatedAt = agentEvent.observedAt;
          outboxItem.attempts += 1;
          await transaction.updateCommandOutboxItem(outboxItem);

          if (task.status === 'queued') {
            const previousStatus = applyTaskTransition(task, 'running', agentEvent.observedAt);
            await transaction.updateTask(task);
            await appendLedgerAuditLog(
              transaction,
              createTaskStatusAudit(task, 'running', previousStatus, agentEvent.observedAt)
            );
          }

          return clone(task);
        }

        if (agentEvent.type === 'result') {
          outboxItem.status = agentEvent.payload.status === 'succeeded' ? 'completed' : 'failed';
          outboxItem.resultAt = agentEvent.observedAt;
          outboxItem.updatedAt = agentEvent.observedAt;
          outboxItem.lastError = agentEvent.payload.failureReason;
          await transaction.updateCommandOutboxItem(outboxItem);
          await updateRuntimeReleaseFromResult(transaction, task, outboxItem.command, agentEvent);

          const relatedOutboxItems = (await transaction.listCommandOutbox()).filter((item) => item.taskId === task.id);
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

          const previousStatus = applyTaskTransition(
            task,
            nextStatus,
            agentEvent.observedAt,
            agentEvent.payload.failureReason
          );
          await transaction.updateTask(task);
          await appendLedgerAuditLog(
            transaction,
            createTaskStatusAudit(task, nextStatus, previousStatus, agentEvent.observedAt)
          );

          return clone(task);
        }

        outboxItem.updatedAt = agentEvent.observedAt;
        await transaction.updateCommandOutboxItem(outboxItem);
        return clone(task);
      });

      if (result && 'errorCode' in result) {
        throw new Error(result.errorCode);
      }

      return result;
    }
  };
}
