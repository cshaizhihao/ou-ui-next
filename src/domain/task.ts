import type { PermissionGrant, ResourcePermission } from './permission';

export type DeployTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'rolled_back' | 'canceled';

export type DeployResourceType =
  | 'agent'
  | 'node'
  | 'module'
  | 'inbound'
  | 'subscription'
  | 'tunnel'
  | 'forward'
  | 'quota'
  | 'permission'
  | 'integration';

export type DeployTaskOperation =
  | 'agent.deploy'
  | 'agent.upgrade'
  | 'agent.update'
  | 'agent.delete'
  | 'agent.rollback'
  | 'module.install'
  | 'inbound.create'
  | 'inbound.update'
  | 'inbound.delete'
  | 'config.compile'
  | 'config.apply'
  | 'runtime.reload'
  | 'forward.create'
  | 'forward.update'
  | 'forward.apply'
  | 'forward.delete'
  | 'forward.pause'
  | 'forward.resume'
  | 'tunnel.create'
  | 'tunnel.update'
  | 'tunnel.redeploy'
  | 'subscription.import'
  | 'subscription.sync'
  | 'subscription.export'
  | 'subscription.profile.upsert'
  | 'subscription.profile.delete'
  | 'subscription.generate'
  | 'subscription.delete'
  | 'quota.reset'
  | 'permission.grant'
  | 'permission.revoke'
  | 'system.tune';

export type DeployTaskStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
};

export type CreateTaskMetadata = Record<string, unknown>;

export type AgentRuntimeDeploymentProof = {
  source: 'agent-result';
  verifiedAt: string;
  agentIds: string[];
  commandIds: string[];
  appliedConfigRevisions: string[];
};

export type DeployTask = {
  id: string;
  operation: DeployTaskOperation;
  resourceType: DeployResourceType;
  resourceId: string;
  status: DeployTaskStatus;
  targetId: string;
  targetLabel: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  actor: string;
  requestedBy: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  requestId: string;
  idempotencyKey?: string;
  sourceIp: string;
  rollbackAvailable: boolean;
  attempts: number;
  progressPercent?: number;
  steps: DeployTaskStep[];
  metadata?: CreateTaskMetadata;
  failureReason?: string;
  rollbackTaskId?: string;
};

export type PermissionChangeInput = {
  subjectType: PermissionGrant['subjectType'];
  subjectId: string;
  resourceType: PermissionGrant['resourceType'];
  resourceId: string;
  permissions: ResourcePermission[];
  reason?: string;
  expiresAt?: string;
};

export type RiskConfirmationInput = {
  operation: DeployTaskOperation;
  targetId: string;
  reason?: string;
};

export type CreateTaskInput = {
  operation: DeployTaskOperation;
  resourceType?: DeployResourceType;
  targetId: string;
  targetLabel: string;
  summary: string;
  metadata?: CreateTaskMetadata;
  permissionChange?: PermissionChangeInput;
  riskConfirmation?: RiskConfirmationInput;
};

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter((value) => value.trim() !== '').map((value) => value.trim()))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function readAgentRuntimeDeploymentProof(
  task: Pick<DeployTask, 'metadata'>
): AgentRuntimeDeploymentProof | undefined {
  const value = task.metadata?.runtimeDeployment;

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const proof = value as Record<string, unknown>;
  const verifiedAt = typeof proof.verifiedAt === 'string' && proof.verifiedAt.trim() !== '' ? proof.verifiedAt.trim() : '';
  const agentIds = uniqueSorted(readStringArray(proof.agentIds));
  const commandIds = uniqueSorted(readStringArray(proof.commandIds));
  const appliedConfigRevisions = uniqueSorted(readStringArray(proof.appliedConfigRevisions));

  if (proof.source !== 'agent-result' || !verifiedAt || agentIds.length === 0 || commandIds.length === 0) {
    return undefined;
  }

  return {
    source: 'agent-result',
    verifiedAt,
    agentIds,
    commandIds,
    appliedConfigRevisions
  };
}

export function hasAgentRuntimeDeploymentProof(task: Pick<DeployTask, 'metadata'>) {
  return Boolean(readAgentRuntimeDeploymentProof(task));
}

export function markTaskAgentRuntimeDeploymentVerified(
  task: DeployTask,
  proof: Omit<AgentRuntimeDeploymentProof, 'source'>
): DeployTask {
  return {
    ...task,
    metadata: {
      ...(task.metadata ?? {}),
      runtimeDeployment: {
        source: 'agent-result',
        verifiedAt: proof.verifiedAt,
        agentIds: uniqueSorted(proof.agentIds),
        commandIds: uniqueSorted(proof.commandIds),
        appliedConfigRevisions: uniqueSorted(proof.appliedConfigRevisions)
      }
    }
  };
}
