import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from './runtime-release';
import { hasAgentRuntimeDeploymentProof, readAgentRuntimeDeploymentProof, type DeployTask } from './task';

export type RuntimeDesiredState = 'applied' | 'absent' | 'paused' | 'restored';
export type RuntimeObservedState = 'waiting' | 'dispatched' | 'acknowledged' | 'applied' | 'failed';
export type RuntimeVerificationState = 'pending' | 'verified' | 'failed' | 'drifted' | 'rolled_back';

export type RuntimeConvergenceReadModel = {
  id: string;
  taskId: string;
  operationId?: string;
  operationStage?: DeployTask['operationStage'];
  operation: DeployTask['operation'];
  resourceType: DeployTask['resourceType'];
  targetId: string;
  targetLabel: string;
  desired: {
    state: RuntimeDesiredState;
    requestedAt: string;
    configRevisionIds: string[];
  };
  observed: {
    state: RuntimeObservedState;
    commandStatuses: string[];
    agentIds: string[];
    configRevisionStatuses: RuntimeConfigRevision['status'][];
    preflightStatuses: RuntimePreflightPlan['status'][];
    snapshotStatuses: RuntimeSnapshot['status'][];
    observedAt: string;
  };
  verification: {
    state: RuntimeVerificationState;
    source: 'agent-result' | 'control-plane';
    verifiedAt?: string;
    reasons: string[];
    nextAction: 'wait' | 'inspect_failure' | 'verify_agent_result' | 'none';
  };
};

type RuntimeCommandEvidence = {
  taskId: string;
  agentId: string;
  status: string;
  updatedAt: string;
};

const runtimeOperations = new Set<DeployTask['operation']>([
  'agent.deploy',
  'agent.upgrade',
  'agent.update',
  'agent.delete',
  'agent.rollback',
  'module.install',
  'inbound.create',
  'inbound.update',
  'inbound.delete',
  'config.compile',
  'config.apply',
  'runtime.reload',
  'forward.create',
  'forward.update',
  'forward.apply',
  'forward.delete',
  'forward.pause',
  'forward.resume',
  'tunnel.create',
  'tunnel.update',
  'tunnel.redeploy',
  'system.tune'
]);

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resolveDesiredState(task: DeployTask): RuntimeDesiredState {
  if (['agent.delete', 'inbound.delete', 'forward.delete'].includes(task.operation)) return 'absent';
  if (task.operation === 'forward.pause') return 'paused';
  if (task.operation === 'agent.rollback') return 'restored';
  return 'applied';
}

function resolveObservedState(task: DeployTask, commands: RuntimeCommandEvidence[]): RuntimeObservedState {
  if (task.status === 'failed' || commands.some((command) => ['failed', 'expired', 'dead_letter'].includes(command.status))) {
    return 'failed';
  }
  if (commands.length > 0 && commands.every((command) => command.status === 'completed')) return 'applied';
  if (commands.some((command) => command.status === 'acknowledged')) return 'acknowledged';
  if (commands.some((command) => ['pending', 'dispatched'].includes(command.status))) return 'dispatched';
  return 'waiting';
}

function resolveVerification(task: DeployTask, observedState: RuntimeObservedState) {
  const proof = readAgentRuntimeDeploymentProof(task);

  if (task.status === 'rolled_back') {
    return {
      state: 'rolled_back' as const,
      source: 'control-plane' as const,
      reasons: ['runtime_rolled_back'],
      nextAction: 'none' as const
    };
  }
  if (task.status === 'failed' || task.status === 'canceled' || observedState === 'failed') {
    return {
      state: 'failed' as const,
      source: 'control-plane' as const,
      reasons: [task.failureReason ? 'task_failure_recorded' : 'runtime_stage_failed'],
      nextAction: 'inspect_failure' as const
    };
  }
  if (hasAgentRuntimeDeploymentProof(task) && proof) {
    return {
      state: 'verified' as const,
      source: 'agent-result' as const,
      verifiedAt: proof.verifiedAt,
      reasons: [] as string[],
      nextAction: 'none' as const
    };
  }
  if (task.status === 'succeeded' || observedState === 'applied') {
    return {
      state: 'drifted' as const,
      source: 'control-plane' as const,
      reasons: ['agent_verification_missing'],
      nextAction: 'verify_agent_result' as const
    };
  }
  return {
    state: 'pending' as const,
    source: 'control-plane' as const,
    reasons: ['runtime_evidence_pending'],
    nextAction: 'wait' as const
  };
}

export function createRuntimeConvergenceReadModels(input: {
  tasks: DeployTask[];
  commandOutbox: RuntimeCommandEvidence[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  limit?: number;
}): RuntimeConvergenceReadModel[] {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));

  return input.tasks
    .filter((task) => runtimeOperations.has(task.operation))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map((task) => {
      const commands = input.commandOutbox.filter((command) => command.taskId === task.id);
      const configRevisions = input.configRevisions.filter((revision) => revision.taskId === task.id);
      const preflightPlans = input.preflightPlans.filter((plan) => plan.taskId === task.id);
      const runtimeSnapshots = input.runtimeSnapshots.filter((snapshot) => snapshot.taskId === task.id);
      const observedState = resolveObservedState(task, commands);
      const observedAt = [
        task.updatedAt,
        ...commands.map((command) => command.updatedAt),
        ...configRevisions.map((revision) => revision.appliedAt ?? revision.failedAt ?? revision.createdAt),
        ...preflightPlans.map((plan) => plan.completedAt ?? plan.createdAt),
        ...runtimeSnapshots.map((snapshot) => snapshot.verifiedAt ?? snapshot.restoredAt ?? snapshot.capturedAt)
      ].sort().at(-1) ?? task.updatedAt;

      return {
        id: `runtime-convergence:${task.id}`,
        taskId: task.id,
        operationId: task.operationId,
        operationStage: task.operationStage,
        operation: task.operation,
        resourceType: task.resourceType,
        targetId: task.targetId,
        targetLabel: task.targetLabel,
        desired: {
          state: resolveDesiredState(task),
          requestedAt: task.createdAt,
          configRevisionIds: uniqueSorted(configRevisions.map((revision) => revision.id))
        },
        observed: {
          state: observedState,
          commandStatuses: uniqueSorted(commands.map((command) => command.status)),
          agentIds: uniqueSorted(commands.map((command) => command.agentId)),
          configRevisionStatuses: uniqueSorted(configRevisions.map((revision) => revision.status)) as RuntimeConfigRevision['status'][],
          preflightStatuses: uniqueSorted(preflightPlans.map((plan) => plan.status)) as RuntimePreflightPlan['status'][],
          snapshotStatuses: uniqueSorted(runtimeSnapshots.map((snapshot) => snapshot.status)) as RuntimeSnapshot['status'][],
          observedAt
        },
        verification: resolveVerification(task, observedState)
      };
    });
}
