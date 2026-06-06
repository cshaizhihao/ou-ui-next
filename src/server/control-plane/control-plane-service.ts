import { createHash, randomUUID } from 'node:crypto';
import type {
  AgentCredentialRevokeRequest,
  AgentCredentialRotateRequest,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentRuntimeCredential,
  AgentLogArchive,
  AuditLog,
  CreateTaskInput,
  DeployResourceType,
  DeployTaskStatus,
  DeployTask,
  ForwardRule,
  PermissionGrant,
  ResourcePermission,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  TrafficRollupCompaction
} from '../../domain';
import {
  buildRuntimeArtifact,
  composeAgentInstallCommand,
  createRuntimeAgentToken,
  markTaskAgentRuntimeDeploymentVerified
} from '../../domain';
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
import { createTrafficRollupsFromAgentTelemetry } from '../../services/api/traffic-rollups';
import type { AgentCredentialRecord, ControlPlaneRepository, ControlPlaneTransaction } from './control-plane-repository';
import type { ControlPlaneArchiveSink } from './archive-sink';
import {
  createAgentCredentialTokenHash,
  createAgentCredentialTokenPrefix,
  isAgentCredentialActive
} from './agent-credentials';
import {
  normalizeAgentLogRetentionPolicy,
  type AgentLogRetentionPolicy
} from './agent-log-retention';
import {
  normalizeTrafficRollupRetentionPolicy,
  type TrafficRollupRetentionPolicy
} from './traffic-rollup-retention';

export type ArchiveSinkBatch =
  | {
      kind: 'agent-log-archive';
      records: AgentLogArchive[];
      exportedAt: string;
    }
  | {
      kind: 'traffic-rollup-compaction';
      records: TrafficRollupCompaction[];
      exportedAt: string;
    };

export type ControlPlaneArchiveSinkErrorHandler = (error: unknown, batch: ArchiveSinkBatch) => void;

type CreateControlPlaneServiceInput = {
  repository: ControlPlaneRepository;
  agentLogRetention?: Partial<AgentLogRetentionPolicy>;
  trafficRollupRetention?: Partial<TrafficRollupRetentionPolicy>;
  archiveSink?: ControlPlaneArchiveSink;
  onArchiveSinkError?: ControlPlaneArchiveSinkErrorHandler;
  now?: () => string;
};

type AgentRegistrationContext = {
  sourceIp?: string;
  userAgent?: string;
};

const AGENT_CREDENTIAL_REVOKE_OPERATION = 'agent.credential.revoke' as const;
const AGENT_CREDENTIAL_ROTATE_OPERATION = 'agent.credential.rotate' as const;
const AGENT_CREDENTIAL_ISSUE_OPERATION = 'agent.credential.issue' as const;

type CreateTaskTransactionResult =
  | DeployTask
  | {
      type: 'error';
      code: string;
      details?: unknown;
    };

type AgentInstallCommandTransactionResult =
  | ReturnType<typeof composeAgentInstallCommand>
  | {
      type: 'error';
      code: string;
      details?: unknown;
    };

type AgentRegistrationTransactionResult =
  | AgentRuntimeCredential
  | {
      type: 'error';
      code: string;
      details?: unknown;
    };

function isCreateTaskError(result: CreateTaskTransactionResult): result is Extract<CreateTaskTransactionResult, { type: 'error' }> {
  return 'type' in result && result.type === 'error';
}

function isAgentInstallCommandError(
  result: AgentInstallCommandTransactionResult
): result is Extract<AgentInstallCommandTransactionResult, { type: 'error' }> {
  return 'type' in result && result.type === 'error';
}

function isAgentRegistrationError(
  result: AgentRegistrationTransactionResult
): result is Extract<AgentRegistrationTransactionResult, { type: 'error' }> {
  return 'type' in result && result.type === 'error';
}

class ControlPlaneMutationError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, details?: unknown) {
    super(code);
    this.name = 'ControlPlaneMutationError';
    this.code = code;
    this.details = details;
  }
}

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const DEFAULT_RUNTIME_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60_000;
const BYTES_PER_GB = 1024 * 1024 * 1024;

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
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
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

function createAgentInstallCommandRequestHash(input: AgentInstallCommandRequest) {
  return createStableSha256LikeHash(input);
}

function createAgentRegistrationRequestHash(input: AgentRegistrationRequest) {
  return createStableSha256LikeHash(input);
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
      installProfile: [...installCredential.metadata.installProfile],
      ...(input.version ? { registrationVersion: input.version } : {}),
      ...(input.platform ? { registrationPlatform: input.platform } : {}),
      ...(input.capabilities ? { registrationCapabilities: [...input.capabilities] } : {})
    }
  };
}

function createRotatedAgentRuntimeCredentialRecord(
  currentCredential: AgentCredentialRecord,
  token: string,
  issuedAt: string,
  expiresAt: string,
  context: MutationContext
): AgentCredentialRecord {
  return {
    id: `agent-credential-${currentCredential.agentId}-${createAgentCredentialTokenHash(token).slice(-12)}`,
    agentId: currentCredential.agentId,
    tokenHash: createAgentCredentialTokenHash(token),
    tokenPrefix: createAgentCredentialTokenPrefix(token),
    status: 'active',
    purpose: 'runtime',
    issuedAt,
    expiresAt,
    issuedBy: context.actor,
    sourceIp: context.sourceIp,
    requestId: context.requestId,
    sessionId: currentCredential.sessionId,
    metadata: {
      ...currentCredential.metadata,
      installProfile: [...currentCredential.metadata.installProfile],
      ...(currentCredential.metadata.registrationCapabilities
        ? { registrationCapabilities: [...currentCredential.metadata.registrationCapabilities] }
        : {})
    }
  };
}

function createAgentCredentialSummary(record: AgentCredentialRecord): AgentCredentialSummary {
  return {
    id: record.id,
    agentId: record.agentId,
    tokenPrefix: record.tokenPrefix,
    status: record.status,
    purpose: record.purpose,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    issuedBy: record.issuedBy,
    sourceIp: record.sourceIp,
    requestId: record.requestId,
    lastUsedAt: record.lastUsedAt,
    sessionId: record.sessionId,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy,
    revokedReason: record.revokedReason,
    replacedByCredentialId: record.replacedByCredentialId,
    metadata: {
      ...record.metadata,
      installProfile: [...record.metadata.installProfile],
      ...(record.metadata.registrationCapabilities
        ? { registrationCapabilities: [...record.metadata.registrationCapabilities] }
        : {})
    }
  };
}

function createArtifactChecksum(artifact: Record<string, unknown>) {
  return createStableSha256LikeHash(artifact);
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

function createAgentInstallCommandIdempotencyRecordKey(context: MutationContext) {
  return `${context.actor}:POST:/api/v1/agents/install-command:${context.idempotencyKey ?? context.requestId}`;
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
  return shouldCreateAgentCommand(operation);
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

function readForwardRuleAgentIds(rule: Awaited<ReturnType<ControlPlaneTransaction['findForwardRule']>>) {
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

function gbFromBytes(bytes: number | undefined) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return 0;
  }

  return Math.round((bytes / BYTES_PER_GB) * 1000) / 1000;
}

function createForwardRuntimeMetadataFromRule(
  rule: ForwardRule,
  enabled: boolean = rule.enabled
): CreateTaskInput['metadata'] | undefined {
  const primaryPort = rule.ports[0];

  if (!primaryPort) {
    return undefined;
  }

  return {
    name: rule.name,
    ownerName: rule.ownerName,
    tunnelId: rule.tunnelId,
    listenAddress: primaryPort.listenAddress,
    listenPort: primaryPort.listenPort,
    targetAddress: primaryPort.targetAddress,
    targetPort: primaryPort.targetPort,
    protocol: primaryPort.protocol,
    entryNodeIds: readForwardRuleAgentIds(rule),
    strategy: rule.strategy,
    billingDirection: rule.billingDirection,
    trafficMultiplier: rule.trafficMultiplier,
    monthlyResetDay: rule.monthlyResetDay,
    currentUsedTrafficGb: gbFromBytes(rule.manualUsedBytes),
    quotaGb: gbFromBytes(rule.quotaBytes),
    rateLimitMbps: rule.rateLimitMbps ?? 0,
    ipRateLimitMbps: rule.ipRateLimitMbps ?? 0,
    maxConnections: rule.maxConnections,
    maxConnectionsPerIp: rule.maxConnectionsPerIp,
    enabled,
    proxyProtocol: rule.proxyProtocol,
    pricePerGb: rule.pricePerGb
  };
}

async function hydrateForwardRuntimeTaskInput(taskInput: CreateTaskInput, transaction: ControlPlaneTransaction) {
  if (!['forward.apply', 'forward.pause', 'forward.resume'].includes(taskInput.operation) || taskInput.metadata) {
    return taskInput;
  }

  const rule = await transaction.findForwardRule(taskInput.targetId);
  const enabled = taskInput.operation === 'forward.pause' ? false : taskInput.operation === 'forward.resume' ? true : rule?.enabled;
  const metadata = rule ? createForwardRuntimeMetadataFromRule(rule, enabled) : undefined;

  return metadata
    ? {
        ...taskInput,
        metadata
      }
    : taskInput;
}

async function resolveAgentIdsForTaskInTransaction(task: DeployTask, transaction: ControlPlaneTransaction) {
  const directAgentIds = resolveAgentIdsForTask(task);

  if (directAgentIds.length > 0) {
    return directAgentIds;
  }

  if (task.operation.startsWith('forward.')) {
    return readForwardRuleAgentIds(await transaction.findForwardRule(task.targetId));
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
              moduleKind,
              artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}${artifactSuffix}.json`,
              checksum: artifactChecksum,
              signature: createSignature(artifactChecksum),
              artifact: applyArtifact,
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

function createCommandOutboxItems(task: DeployTask, firstSequence: number, agentIds: string[]) {
  return agentIds.map((agentId, index) => createCommandOutboxItem(task, firstSequence + index, agentId));
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

function isTerminalCommandOutboxStatus(status: CommandOutboxItem['status']) {
  return status === 'completed' || status === 'failed' || status === 'expired' || status === 'dead_letter';
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

  throw new ControlPlaneMutationError('agent_event.command_task_mismatch', {
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
        healthSummary: agentEvent.payload.healthSummary ?? configRevision.healthSummary
      });
    }

    if (preflightPlan) {
      await transaction.updatePreflightPlan({
        ...preflightPlan,
        status: agentEvent.payload.status === 'succeeded' ? 'passed' : 'failed',
        completedAt: agentEvent.observedAt,
        failureReason: agentEvent.payload.status === 'failed' ? agentEvent.payload.failureReason : preflightPlan.failureReason,
        checks: updatePreflightChecksFromResult(preflightPlan.checks, agentEvent)
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
  resourceId: string,
  observedAt: string,
  resourceType?: PermissionGrant['resourceType']
): Set<ResourcePermission> {
  const permissions = new Set<ResourcePermission>();

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
      grant.permissions.forEach((permission) => permissions.add(permission));
    });

  return permissions;
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
  return context.actor === 'admin' || context.actor === 'operator:admin' || context.actor.startsWith('system:');
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

export function createControlPlaneService({
  repository,
  agentLogRetention: agentLogRetentionInput,
  trafficRollupRetention: trafficRollupRetentionInput,
  archiveSink,
  onArchiveSinkError,
  now: readClock = () => new Date().toISOString()
}: CreateControlPlaneServiceInput) {
  let sequence = 1;
  const agentLogRetention = normalizeAgentLogRetentionPolicy(agentLogRetentionInput);
  const trafficRollupRetention = normalizeTrafficRollupRetentionPolicy(trafficRollupRetentionInput);
  const readNow = () => readClock();
  const nextObservedAt = () => {
    sequence += 1;
    return readNow();
  };

  async function flushArchiveSinkBatches(batches: ArchiveSinkBatch[]) {
    if (!archiveSink) {
      return;
    }

    for (const batch of batches) {
      if (batch.records.length === 0) {
        continue;
      }

      try {
        if (batch.kind === 'agent-log-archive') {
          await archiveSink.writeAgentLogArchives(batch.records, { exportedAt: batch.exportedAt });
        } else {
          await archiveSink.writeTrafficRollupCompactions(batch.records, { exportedAt: batch.exportedAt });
        }
      } catch (error) {
        if (onArchiveSinkError) {
          try {
            onArchiveSinkError(error, batch);
          } catch (handlerError) {
            console.error('OU-UI Next external archive sink error handler failed:', handlerError);
          }
        } else {
          console.error('OU-UI Next external archive sink write failed:', error);
        }
      }
    }
  }

  async function appendLedgerAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
    const existingLogs = await transaction.listAuditLogs();
    const auditWithPrevHash = {
      ...auditLog,
      prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    await transaction.insertAuditLog({
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    });
  }

  function createAuditId() {
    return `audit-${String(sequence++).padStart(4, '0')}-${randomUUID()}`;
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
      id: createAuditId(),
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
      createdAt: nextObservedAt(),
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
    context: MutationContext,
    denialCode: string,
    denialReason: string,
    requestBodyHash: string,
    before?: unknown,
    after?: unknown
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'audit.denied',
      actor: context.actor,
      operatorGroupId: context.operatorGroupId,
      resourceGroupId: context.resourceGroupId,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_ISSUE_OPERATION,
      result: 'denied',
      targetId: 'agent-enrollment',
      targetLabel: 'Agent enrollment',
      taskId: '',
      severity: 'critical',
      message: `Agent install credential issue -> ${denialCode}`,
      createdAt: nextObservedAt(),
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
    const quotaResetBefore =
      task.operation === 'quota.reset' && task.metadata?.quotaResetAuditBefore && typeof task.metadata.quotaResetAuditBefore === 'object'
        ? task.metadata.quotaResetAuditBefore
        : undefined;
    const quotaResetAfter =
      task.operation === 'quota.reset' && task.metadata?.quotaResetAuditAfter && typeof task.metadata.quotaResetAuditAfter === 'object'
        ? task.metadata.quotaResetAuditAfter
        : undefined;

    return {
      id: createAuditId(),
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
      createdAt: task.createdAt,
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      requestId: context.requestId,
      before: quotaResetBefore,
      after: quotaResetAfter
        ? {
            status: 'created',
            resourceId: task.resourceId,
            ...(quotaResetAfter as Record<string, unknown>)
          }
        : {
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
      id: createAuditId(),
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

  function createAgentCredentialRevokedAudit(
    before: AgentCredentialSummary,
    after: AgentCredentialSummary,
    context: MutationContext,
    observedAt: string,
    reason: string
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'agent.credential.revoked',
      actor: context.actor,
      operatorGroupId: context.operatorGroupId,
      resourceGroupId: context.resourceGroupId,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_REVOKE_OPERATION,
      result: 'succeeded',
      targetId: after.agentId,
      targetLabel: after.agentId,
      taskId: '',
      severity: 'warning',
      message: `Agent credential ${after.id} revoked: ${reason}`,
      createdAt: observedAt,
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      requestId: context.requestId,
      before,
      after
    };
  }

  async function revokeActiveRuntimeCredentialsForDeletedAgent(
    transaction: ControlPlaneTransaction,
    task: DeployTask,
    context: MutationContext,
    observedAt: string
  ) {
    if (task.operation !== 'agent.delete') {
      return;
    }

    const agentId = resolveAgentIdForTask(task);

    if (!agentId) {
      return;
    }

    const reason = 'agent.deleted';
    const activeRuntimeCredentials = (await transaction.listAgentCredentials()).filter(
      (credential) =>
        credential.agentId === agentId &&
        credential.purpose === 'runtime' &&
        credential.status === 'active'
    );

    for (const credential of activeRuntimeCredentials) {
      const revokedCredential: AgentCredentialRecord = {
        ...credential,
        status: 'revoked',
        revokedAt: observedAt,
        revokedBy: context.actor,
        revokedReason: reason
      };

      await transaction.upsertAgentCredential(revokedCredential);
      await appendLedgerAuditLog(
        transaction,
        createAgentCredentialRevokedAudit(
          createAgentCredentialSummary(credential),
          createAgentCredentialSummary(revokedCredential),
          context,
          observedAt,
          reason
        )
      );
    }
  }

  function createAgentCredentialIssuedAudit(
    credential: AgentCredentialSummary,
    input: AgentInstallCommandRequest,
    context: MutationContext,
    observedAt: string,
    requestBodyHash: string
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'agent.credential.issued',
      actor: context.actor,
      operatorGroupId: context.operatorGroupId,
      resourceGroupId: context.resourceGroupId,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_ISSUE_OPERATION,
      result: 'succeeded',
      targetId: credential.agentId,
      targetLabel: credential.agentId,
      taskId: '',
      severity: 'info',
      message: `Agent install credential ${credential.id} issued`,
      createdAt: observedAt,
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

  function createAgentRuntimeCredentialIssuedAudit(
    installCredential: AgentCredentialSummary,
    runtimeCredential: AgentCredentialSummary,
    input: AgentRegistrationRequest,
    context: AgentRegistrationContext | undefined,
    observedAt: string,
    requestBodyHash: string
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'agent.credential.issued',
      actor: `agent:${input.agentId}`,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_ISSUE_OPERATION,
      result: 'succeeded',
      targetId: runtimeCredential.agentId,
      targetLabel: runtimeCredential.agentId,
      taskId: '',
      severity: 'info',
      message: `Agent runtime credential ${runtimeCredential.id} issued from install credential ${installCredential.id}`,
      createdAt: observedAt,
      sourceIp: context?.sourceIp ?? runtimeCredential.sourceIp,
      userAgent: context?.userAgent,
      requestId: input.requestId,
      requestBodyHash,
      after: {
        credential: runtimeCredential,
        installCredential,
        registration: {
          agentId: input.agentId,
          sessionId: input.sessionId,
          version: input.version,
          platform: input.platform,
          capabilities: input.capabilities
        }
      }
    };
  }

  function createAgentRegistrationDeniedAudit(
    input: AgentRegistrationRequest,
    installCredential: AgentCredentialSummary | undefined,
    context: AgentRegistrationContext | undefined,
    denialCode: string,
    denialReason: string,
    requestBodyHash: string,
    observedAt: string,
    installTokenPresented: boolean
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'audit.denied',
      actor: `agent:${input.agentId}`,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_ISSUE_OPERATION,
      result: 'denied',
      targetId: input.agentId,
      targetLabel: input.agentId,
      taskId: '',
      severity: 'critical',
      message: `Agent runtime credential registration -> ${denialCode}`,
      createdAt: observedAt,
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

  function createAgentCredentialRotatedAudit(
    before: AgentCredentialSummary,
    revokedCredential: AgentCredentialSummary,
    issuedCredential: AgentCredentialSummary,
    context: MutationContext,
    observedAt: string,
    reason: string
  ): AuditLog {
    return {
      id: createAuditId(),
      action: 'agent.credential.rotated',
      actor: context.actor,
      operatorGroupId: context.operatorGroupId,
      resourceGroupId: context.resourceGroupId,
      scope: 'control-plane:agent',
      resourceType: 'agent',
      operation: AGENT_CREDENTIAL_ROTATE_OPERATION,
      result: 'succeeded',
      targetId: issuedCredential.agentId,
      targetLabel: issuedCredential.agentId,
      taskId: '',
      severity: 'warning',
      message: `Agent credential ${before.id} rotated into ${issuedCredential.id}: ${reason}`,
      createdAt: observedAt,
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      requestId: context.requestId,
      before,
      after: {
        revokedCredential,
        issuedCredential
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

  async function recordAgentEventSession(
    transaction: ControlPlaneTransaction,
    agentEvent: AgentEventEnvelope,
    archiveSinkBatches: ArchiveSinkBatch[]
  ) {
    const existingEvent = await transaction.findAgentEvent(agentEvent.eventId);

    if (existingEvent) {
      return {
        duplicate: true
      };
    }

    if (agentEvent.type === 'log_chunk') {
      const existingLogicalChunk = (await transaction.listAgentEvents()).some(
        (event): event is Extract<AgentEventEnvelope, { type: 'log_chunk' }> =>
          event.type === 'log_chunk' && isSameLogicalLogChunk(event, agentEvent)
      );

      if (existingLogicalChunk) {
        return {
          duplicate: true
        };
      }
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

    if (agentEvent.type === 'log_chunk') {
      const persistedAgentLogRetention = await transaction.getAgentLogRetentionPolicy();
      const pruneResult = await transaction.pruneAgentLogEvents(
        persistedAgentLogRetention ?? agentLogRetention,
        agentEvent.observedAt
      );

      if (pruneResult.archives.length > 0) {
        archiveSinkBatches.push({
          kind: 'agent-log-archive',
          records: pruneResult.archives,
          exportedAt: agentEvent.observedAt
        });
      }
    }

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
    async listAgentCredentials() {
      return (await repository.listAgentCredentials()).map(createAgentCredentialSummary);
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context: MutationContext) {
      const mutationContext = parseMutationContext(context);
      const requestBodyHash = createAgentInstallCommandRequestHash(input);
      const idempotencyKey = createAgentInstallCommandIdempotencyRecordKey(mutationContext);
      const issuedAt = readNow();
      const command = composeAgentInstallCommand(input, {
        issuedAt
      });
      const credential = createAgentCredentialRecord(command, input, mutationContext, issuedAt);

      const result = await repository.transaction<AgentInstallCommandTransactionResult>(async (transaction) => {
        const existingRecord = await transaction.findIdempotencyRecord(idempotencyKey);

        if (existingRecord) {
          if (existingRecord.requestBodyHash !== requestBodyHash) {
            await appendLedgerAuditLog(
              transaction,
              createAgentInstallCommandDeniedAudit(
                mutationContext,
                'idempotency.conflict',
                'A replayed Agent install credential mutation used the same idempotency identity with a different request body.',
                requestBodyHash,
                {
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

          return {
            type: 'error' as const,
            code: 'idempotency.replay_unavailable',
            details: {
              credentialId: existingRecord.taskId,
              requestId: existingRecord.requestId,
              reason:
                'Agent install commands contain a one-time secret. The original raw install token is not stored and cannot be replayed safely.'
            }
          };
        }

        const permissionGrants = await transaction.listPermissionGrants();
        const permissionDenial = resolveAgentInstallCommandPermissionDenial(mutationContext, permissionGrants, issuedAt);

        if (permissionDenial) {
          await appendLedgerAuditLog(
            transaction,
            createAgentInstallCommandDeniedAudit(
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
            code: permissionDenial.denialCode,
            details: {
              denialReason: permissionDenial.denialReason,
              before: permissionDenial.before,
              after: permissionDenial.after
            }
          };
        }

        await transaction.upsertAgentCredential(credential);
        await transaction.insertIdempotencyRecord({
          key: idempotencyKey,
          taskId: credential.id,
          actor: mutationContext.actor,
          method: 'POST',
          path: '/api/v1/agents/install-command',
          requestId: mutationContext.requestId,
          idempotencyKey: mutationContext.idempotencyKey ?? mutationContext.requestId,
          requestBodyHash
        });
        await appendLedgerAuditLog(
          transaction,
          createAgentCredentialIssuedAudit(
            createAgentCredentialSummary(credential),
            input,
            mutationContext,
            issuedAt,
            requestBodyHash
          )
        );

        return command;
      });

      if (isAgentInstallCommandError(result)) {
        throw new ControlPlaneMutationError(result.code, result.details);
      }

      return result;
    },

    async registerAgent(
      input: AgentRegistrationRequest,
      installToken: string,
      context?: AgentRegistrationContext
    ): Promise<AgentRuntimeCredential> {
      const issuedAt = readNow();
      const expiresAt = new Date(Date.parse(issuedAt) + DEFAULT_RUNTIME_CREDENTIAL_TTL_MS).toISOString();
      const installTokenPresented = installToken.trim().length > 0;
      const installTokenHash = installTokenPresented ? createAgentCredentialTokenHash(installToken) : undefined;
      const requestBodyHash = createAgentRegistrationRequestHash(input);

      const result = await repository.transaction<AgentRegistrationTransactionResult>(async (transaction) => {
        const createDeniedResult = async (
          denialCode: string,
          denialReason: string,
          installCredential?: AgentCredentialRecord
        ): Promise<Extract<AgentRegistrationTransactionResult, { type: 'error' }>> => {
          await appendLedgerAuditLog(
            transaction,
            createAgentRegistrationDeniedAudit(
              input,
              installCredential ? createAgentCredentialSummary(installCredential) : undefined,
              context,
              denialCode,
              denialReason,
              requestBodyHash,
              issuedAt,
              installTokenPresented
            )
          );
          return {
            type: 'error',
            code: denialCode,
            details: {
              denialReason
            }
          };
        };

        if (!installTokenHash) {
          return createDeniedResult(
            'agent_registration.install_token_required',
            'Agent registration requires a bearer install token.'
          );
        }

        const installCredential = await transaction.findAgentCredentialByTokenHash(installTokenHash);

        if (!installCredential || installCredential.purpose !== 'install') {
          return createDeniedResult(
            'agent_registration.install_token_invalid',
            'Agent registration install token was not found or is not an install credential.'
          );
        }

        if (installCredential.agentId !== input.agentId) {
          return createDeniedResult(
            'agent_registration.agent_mismatch',
            'Agent registration install token is bound to a different Agent identity.',
            installCredential
          );
        }

        if (!isAgentCredentialActive(installCredential, issuedAt)) {
          let expiredInstallCredential = installCredential;

          if (installCredential.status === 'active') {
            expiredInstallCredential = {
              ...installCredential,
              status: 'expired',
              lastUsedAt: issuedAt
            };
            await transaction.upsertAgentCredential(expiredInstallCredential);
          }

          return createDeniedResult(
            'agent_registration.install_token_expired',
            'Agent registration install token is expired or no longer active.',
            expiredInstallCredential
          );
        }

        const runtimeToken = createRuntimeAgentToken();
        const runtimeCredential = createAgentRuntimeCredentialRecord(
          installCredential,
          input,
          runtimeToken,
          issuedAt,
          expiresAt,
          context
        );
        const revokedInstallCredential: AgentCredentialRecord = {
          ...installCredential,
          status: 'revoked',
          lastUsedAt: issuedAt,
          sessionId: input.sessionId,
          revokedAt: issuedAt,
          revokedBy: `agent:${input.agentId}`,
          revokedReason: 'agent.install_token_redeemed',
          replacedByCredentialId: runtimeCredential.id
        };

        await transaction.upsertAgentCredential(revokedInstallCredential);
        await transaction.upsertAgentCredential(runtimeCredential);
        await appendLedgerAuditLog(
          transaction,
          createAgentRuntimeCredentialIssuedAudit(
            createAgentCredentialSummary(revokedInstallCredential),
            createAgentCredentialSummary(runtimeCredential),
            input,
            context,
            issuedAt,
            requestBodyHash
          )
        );

        return {
          agentId: input.agentId,
          agentToken: runtimeToken,
          tokenPrefix: runtimeCredential.tokenPrefix,
          credentialId: runtimeCredential.id,
          issuedAt,
          expiresAt,
          sessionId: input.sessionId
        };
      });

      if (isAgentRegistrationError(result)) {
        throw new ControlPlaneMutationError(result.code, result.details);
      }

      return result;
    },

    async revokeAgentCredential(
      credentialId: string,
      input: AgentCredentialRevokeRequest,
      context: MutationContext
    ): Promise<AgentCredentialSummary> {
      const mutationContext = parseMutationContext(context);
      const reason = input.reason.trim();

      if (!reason) {
        throw new Error('agent_credential.revoke_reason_required');
      }

      const observedAt = readNow();
      let revokedCredential: AgentCredentialRecord | undefined;

      await repository.transaction(async (transaction) => {
        const current = await transaction.findAgentCredentialById(credentialId);

        if (!current) {
          throw new Error(`agent credential not found: ${credentialId}`);
        }

        const before = createAgentCredentialSummary(current);
        const next: AgentCredentialRecord =
          current.status === 'revoked'
            ? current
            : {
                ...current,
                status: 'revoked',
                revokedAt: observedAt,
                revokedBy: mutationContext.actor,
                revokedReason: reason
              };

        if (current.status !== 'revoked') {
          await transaction.upsertAgentCredential(next);
          await appendLedgerAuditLog(
            transaction,
            createAgentCredentialRevokedAudit(
              before,
              createAgentCredentialSummary(next),
              mutationContext,
              observedAt,
              reason
            )
          );
        }

        revokedCredential = next;
      });

      if (!revokedCredential) {
        throw new Error(`agent credential not found: ${credentialId}`);
      }

      return createAgentCredentialSummary(revokedCredential);
    },

    async rotateAgentCredential(
      credentialId: string,
      input: AgentCredentialRotateRequest,
      context: MutationContext
    ): Promise<AgentRuntimeCredential> {
      const mutationContext = parseMutationContext(context);
      const reason = input.reason.trim();

      if (!reason) {
        throw new Error('agent_credential.rotate_reason_required');
      }

      const issuedAt = readNow();
      const expiresAt = new Date(Date.parse(issuedAt) + DEFAULT_RUNTIME_CREDENTIAL_TTL_MS).toISOString();
      const runtimeToken = createRuntimeAgentToken();
      let issuedCredential: AgentCredentialRecord | undefined;

      await repository.transaction(async (transaction) => {
        const current = await transaction.findAgentCredentialById(credentialId);

        if (!current) {
          throw new Error(`agent credential not found: ${credentialId}`);
        }

        if (current.purpose !== 'runtime') {
          throw new Error('agent_credential.rotate_runtime_required');
        }

        if (!isAgentCredentialActive(current, issuedAt)) {
          if (current.status === 'active') {
            await transaction.upsertAgentCredential({
              ...current,
              status: 'expired',
              lastUsedAt: issuedAt
            });
          }

          throw new Error('agent_credential.rotate_inactive');
        }

        const before = createAgentCredentialSummary(current);
        const nextCredential = createRotatedAgentRuntimeCredentialRecord(
          current,
          runtimeToken,
          issuedAt,
          expiresAt,
          mutationContext
        );
        const revokedCredential: AgentCredentialRecord = {
          ...current,
          status: 'revoked',
          revokedAt: issuedAt,
          revokedBy: mutationContext.actor,
          revokedReason: reason,
          replacedByCredentialId: nextCredential.id
        };

        await transaction.upsertAgentCredential(revokedCredential);
        await transaction.upsertAgentCredential(nextCredential);
        await appendLedgerAuditLog(
          transaction,
          createAgentCredentialRotatedAudit(
            before,
            createAgentCredentialSummary(revokedCredential),
            createAgentCredentialSummary(nextCredential),
            mutationContext,
            issuedAt,
            reason
          )
        );

        issuedCredential = nextCredential;
      });

      if (!issuedCredential) {
        throw new Error(`agent credential not found: ${credentialId}`);
      }

      return {
        agentId: issuedCredential.agentId,
        agentToken: runtimeToken,
        tokenPrefix: issuedCredential.tokenPrefix,
        credentialId: issuedCredential.id,
        issuedAt,
        expiresAt,
        sessionId: issuedCredential.sessionId
      };
    },

    async resolveAgentToken(token: string, observedAt = readNow()) {
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
        agentId: credential.agentId,
        credentialId: credential.id,
        sessionId: credential.sessionId
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

        const authorizationObservedAt = readNow();
        const permissionGrants = await transaction.listPermissionGrants();
        const operationPermissionDenial = resolveOperationPermissionDenial(
          taskInput,
          mutationContext,
          permissionGrants,
          authorizationObservedAt
        );
        const permissionDenial =
          operationPermissionDenial ??
          resolvePermissionGrantDenial(taskInput, mutationContext, permissionGrants, authorizationObservedAt) ??
          resolvePermissionRevokeDenial(taskInput, permissionGrants, authorizationObservedAt);

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
            code: permissionDenial.denialCode,
            details: {
              denialReason: permissionDenial.denialReason,
              before: permissionDenial.before,
              after: permissionDenial.after
            }
          };
        }

        const highRiskConfirmationDenial = resolveHighRiskConfirmationDenial(taskInput);

        if (highRiskConfirmationDenial) {
          await appendLedgerAuditLog(
            transaction,
            createDeniedAudit(
              taskInput,
              resourceType,
              mutationContext,
              highRiskConfirmationDenial.denialCode,
              highRiskConfirmationDenial.denialReason,
              requestBodyHash,
              highRiskConfirmationDenial.before,
              highRiskConfirmationDenial.after
            )
          );

          return {
            type: 'error' as const,
            code: highRiskConfirmationDenial.denialCode,
            details: {
              denialReason: highRiskConfirmationDenial.denialReason,
              before: highRiskConfirmationDenial.before,
              after: highRiskConfirmationDenial.after
            }
          };
        }

        const executableTaskInput = await hydrateForwardRuntimeTaskInput(taskInput, transaction);
        const now = nextObservedAt();
        const task: DeployTask = {
          id: `task-${String(sequence).padStart(4, '0')}`,
          operation: executableTaskInput.operation,
          resourceType,
          resourceId: executableTaskInput.targetId,
          status: 'queued',
          targetId: executableTaskInput.targetId,
          targetLabel: executableTaskInput.targetLabel,
          summary: executableTaskInput.summary,
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
          steps: createTaskSteps(executableTaskInput.summary),
          metadata: executableTaskInput.metadata
        };
        const targetAgentIds = shouldCreateAgentCommand(task.operation)
          ? await resolveAgentIdsForTaskInTransaction(task, transaction)
          : [];

        if (shouldCreateAgentCommand(task.operation) && targetAgentIds.length === 0) {
          const denialReason = 'This runtime operation requires at least one target Agent before it can be dispatched.';

          await appendLedgerAuditLog(
            transaction,
            createDeniedAudit(
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
            )
          );

          return {
            type: 'error' as const,
            code: 'agent_target.required',
            details: {
              denialReason,
              operation: taskInput.operation,
              targetId: taskInput.targetId
            }
          };
        }

        await transaction.insertTask(task);

        const permissionGrant = createPermissionGrant(executableTaskInput, mutationContext, now, sequence);
        const revokedPermissionGrant = createRevokedPermissionGrant(
          executableTaskInput,
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
          const outboxItems = createCommandOutboxItems(task, sequence, targetAgentIds);
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
        throw new ControlPlaneMutationError(result.code, result.details);
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

        if (status === 'succeeded' && requiresAgentResultForRuntimeSuccess(task.operation)) {
          throw new ControlPlaneMutationError('agent_result.required', {
            operation: task.operation,
            taskId: task.id,
            targetId: task.targetId,
            denialReason: 'Runtime command success must be recorded from Agent result events.'
          });
        }

        const previousStatus = applyTaskTransition(task, status, nextObservedAt());
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
        const now = nextObservedAt();
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
          id: createAuditId(),
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
      const now = options.now ?? nextObservedAt();
      const nowMs = Date.parse(now);
      const leaseDurationMs = options.leaseDurationMs ?? 30_000;
      const maxCommands = options.maxCommands ?? 50;
      const leaseOwnerId = options.leaseOwnerId ?? agentId;

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
          const shouldReplayUnseenCommand =
            options.sessionId !== undefined &&
            options.lastSeenCommandSeq !== undefined &&
            item.status === 'dispatched' &&
            item.leaseSessionId === options.sessionId &&
            item.ackedAt === undefined &&
            item.seq > options.lastSeenCommandSeq;

          if (isDeadlineExpired && (item.status === 'pending' || item.status === 'dispatched')) {
            await expireCommandDeadline(transaction, item, now);
            continue;
          }

          if (!isPending && !isExpiredLease && !shouldReplayUnseenCommand) {
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
            leaseOwnerId,
            leaseSessionId: options.sessionId,
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
      const now = options.now ?? nextObservedAt();
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
      const archiveSinkBatches: ArchiveSinkBatch[] = [];

      const result = await repository.transaction<
        | DeployTask
        | undefined
        | {
            errorCode: string;
          }
      >(async (transaction) => {
        if (agentEvent.type === 'heartbeat' || agentEvent.type === 'telemetry_sample') {
          const recorded = await recordAgentEventSession(transaction, agentEvent, archiveSinkBatches);

          if (!recorded.duplicate && agentEvent.type === 'telemetry_sample') {
            for (const trafficRollup of createTrafficRollupsFromAgentTelemetry(agentEvent)) {
              await transaction.insertTrafficRollup(trafficRollup);
            }
            const persistedTrafficRollupRetention = await transaction.getTrafficRollupRetentionPolicy();
            const pruneResult = await transaction.pruneTrafficRollups(
              persistedTrafficRollupRetention ?? trafficRollupRetention,
              agentEvent.observedAt
            );

            if (pruneResult.compactions.length > 0) {
              archiveSinkBatches.push({
                kind: 'traffic-rollup-compaction',
                records: pruneResult.compactions,
                exportedAt: agentEvent.observedAt
              });
            }
          }

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

        assertAgentEventMatchesCommandTask(agentEvent, outboxItem);

        if (isTerminalCommandOutboxStatus(outboxItem.status)) {
          await recordAgentEventSession(transaction, agentEvent, archiveSinkBatches);
          return clone(task);
        }

        if (Date.parse(agentEvent.observedAt) >= Date.parse(outboxItem.deadlineAt)) {
          await expireCommandDeadline(transaction, outboxItem, agentEvent.observedAt);
          return {
            errorCode: 'agent_event.command_deadline_expired'
          };
        }

        const effectiveAgentEvent =
          agentEvent.type === 'result' ? normalizeResultEventForCommand(outboxItem.command, agentEvent) : agentEvent;

        await recordAgentEventSession(transaction, effectiveAgentEvent, archiveSinkBatches);

        if (effectiveAgentEvent.type === 'ack') {
          outboxItem.status = 'acknowledged';
          outboxItem.ackedAt = effectiveAgentEvent.observedAt;
          outboxItem.updatedAt = effectiveAgentEvent.observedAt;
          outboxItem.attempts += 1;
          await transaction.updateCommandOutboxItem(outboxItem);

          if (task.status === 'queued') {
            const previousStatus = applyTaskTransition(task, 'running', effectiveAgentEvent.observedAt);
            await transaction.updateTask(task);
            await appendLedgerAuditLog(
              transaction,
              createTaskStatusAudit(task, 'running', previousStatus, effectiveAgentEvent.observedAt)
            );
          }

          return clone(task);
        }

        if (effectiveAgentEvent.type === 'result') {
          outboxItem.status = effectiveAgentEvent.payload.status === 'failed' ? 'failed' : 'completed';
          outboxItem.resultAt = effectiveAgentEvent.observedAt;
          outboxItem.updatedAt = effectiveAgentEvent.observedAt;
          outboxItem.lastError = effectiveAgentEvent.payload.failureReason;
          await transaction.updateCommandOutboxItem(outboxItem);
          await updateRuntimeReleaseFromResult(transaction, task, outboxItem.command, effectiveAgentEvent);

          const relatedOutboxItems = (await transaction.listCommandOutbox()).filter((item) => item.taskId === task.id);
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
            task.metadata = markTaskVerifiedByAgentResults(
              task,
              relatedOutboxItems,
              effectiveAgentEvent.observedAt
            ).metadata;
          }

          const previousStatus = applyTaskTransition(
            task,
            nextStatus,
            effectiveAgentEvent.observedAt,
            effectiveAgentEvent.payload.failureReason
          );
          await transaction.updateTask(task);
          await appendLedgerAuditLog(
            transaction,
            createTaskStatusAudit(task, nextStatus, previousStatus, effectiveAgentEvent.observedAt)
          );
          if (nextStatus === 'succeeded') {
            await revokeActiveRuntimeCredentialsForDeletedAgent(
              transaction,
              task,
              {
                actor: task.actor,
                sourceIp: task.sourceIp,
                requestId: task.requestId
              },
              effectiveAgentEvent.observedAt
            );
          }

          return clone(task);
        }

        outboxItem.updatedAt = effectiveAgentEvent.observedAt;
        await transaction.updateCommandOutboxItem(outboxItem);
        return clone(task);
      });

      if (result && 'errorCode' in result) {
        throw new Error(result.errorCode);
      }

      await flushArchiveSinkBatches(archiveSinkBatches);
      return result;
    }
  };
}
