import type {
  AgentRuntimeDeploymentProof,
  DeployTask,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot
} from '../../domain';
import type { CommandOutboxSummary } from '../../services/api/control-plane-api';

export type CustomerNodeRuntimeEvidenceState = 'verified' | 'failed' | 'waiting';
export type CustomerNodeRuntimeEvidenceStepState = 'confirmed' | 'failed' | 'waiting';
export type CustomerNodeRuntimeEvidenceStepId =
  | 'command'
  | 'agentResult'
  | 'configRevision'
  | 'preflight'
  | 'snapshot';

export type CustomerNodeRuntimeEvidenceNode = {
  id: string;
  configVersion: string;
  runtimeDeployment?: AgentRuntimeDeploymentProof;
};

export type CustomerNodeRuntimeEvidenceStep = {
  id: CustomerNodeRuntimeEvidenceStepId;
  state: CustomerNodeRuntimeEvidenceStepState;
  value?: string;
  detail?: string;
};

export type CustomerNodeRuntimeEvidenceNextActionCode =
  | 'none'
  | 'wait-command-result'
  | 'inspect-command-failure'
  | 'wait-agent-result'
  | 'inspect-agent-result'
  | 'wait-config-apply'
  | 'inspect-config-revision'
  | 'wait-preflight'
  | 'fix-preflight'
  | 'wait-snapshot'
  | 'inspect-snapshot';

export type CustomerNodeRuntimeEvidenceNextAction = {
  code: CustomerNodeRuntimeEvidenceNextActionCode;
  severity: 'info' | 'warning' | 'critical';
  stepId?: CustomerNodeRuntimeEvidenceStepId;
  stepState?: CustomerNodeRuntimeEvidenceStepState;
  detail?: string;
};

export type CustomerNodeRuntimeEvidenceBundle = {
  state: CustomerNodeRuntimeEvidenceState;
  task?: DeployTask;
  taskId?: string;
  proof?: AgentRuntimeDeploymentProof;
  commandOutboxItems: CommandOutboxSummary[];
  configRevision?: RuntimeConfigRevision;
  preflightPlan?: RuntimePreflightPlan;
  runtimeSnapshot?: RuntimeSnapshot;
  rollbackRecovery?: CustomerNodeRuntimeRollbackRecoveryEvidence;
  evidenceStage: string;
  nextAction: CustomerNodeRuntimeEvidenceNextAction;
  steps: CustomerNodeRuntimeEvidenceStep[];
};

export type CustomerNodeRuntimeRollbackRecoveryState = 'restored' | 'failed' | 'waiting';

export type CustomerNodeRuntimeRollbackRecoveryEvidence = {
  state: CustomerNodeRuntimeRollbackRecoveryState;
  taskId: string;
  task?: DeployTask;
  commandOutboxItems: CommandOutboxSummary[];
  restoredSnapshot?: RuntimeSnapshot;
};

export type CustomerNodeRuntimeEvidencePackageNode = CustomerNodeRuntimeEvidenceNode & {
  agentId?: string;
  customerName?: string;
  nodeName?: string;
  listenPort?: number;
  protocol?: string;
};

export type CustomerNodeRuntimeEvidencePackage = {
  node: {
    id: string;
    agentId?: string;
    customerName?: string;
    nodeName?: string;
    listenPort?: number;
    protocol?: string;
    configVersion: string;
  };
  evidence: {
    state: CustomerNodeRuntimeEvidenceState;
    stage: string;
    nextAction: CustomerNodeRuntimeEvidenceNextAction;
    steps: CustomerNodeRuntimeEvidenceStep[];
    proof?: AgentRuntimeDeploymentProof;
  };
  task?: {
    id: string;
    requestId: string;
    operation: DeployTask['operation'];
    status: DeployTask['status'];
    targetId: string;
    targetLabel: string;
    rollbackAvailable: boolean;
    rollbackTaskId?: string;
    createdAt: string;
    updatedAt: string;
  };
  commands: Array<{
    commandId: string;
    agentId: string;
    commandType: CommandOutboxSummary['commandType'];
    status: CommandOutboxSummary['status'];
    attempts: number;
    createdAt: string;
    updatedAt: string;
    ackedAt?: string;
    resultAt?: string;
    deadlineAt: string;
    lastError?: string;
  }>;
  configRevision?: {
    id: string;
    taskId: string;
    agentId: string;
    moduleKind: RuntimeConfigRevision['moduleKind'];
    status: RuntimeConfigRevision['status'];
    preflightPlanId: string;
    snapshotBeforeId: string;
    diffSummary: RuntimeConfigRevision['diffSummary'];
    failureReason?: string;
    runtimeDiagnosis?: Record<string, unknown>;
  };
  preflightPlan?: {
    id: string;
    status: RuntimePreflightPlan['status'];
    failureReason?: string;
    checks: Array<{
      id: string;
      label: string;
      status: RuntimePreflightPlan['status'];
      severity: RuntimePreflightPlan['checks'][number]['severity'];
    }>;
  };
  runtimeSnapshot?: {
    id: string;
    status: RuntimeSnapshot['status'];
    reason: RuntimeSnapshot['reason'];
    checksum: string;
    capturedAt: string;
    verifiedAt?: string;
    restoredAt?: string;
    restoredByTaskId?: string;
  };
  rollbackRecovery?: {
    state: CustomerNodeRuntimeRollbackRecoveryState;
    taskId: string;
    task?: {
      id: string;
      requestId: string;
      operation: DeployTask['operation'];
      status: DeployTask['status'];
      targetId: string;
      targetLabel: string;
      createdAt: string;
      updatedAt: string;
      failureReason?: string;
    };
    commands: Array<{
      commandId: string;
      agentId: string;
      commandType: CommandOutboxSummary['commandType'];
      status: CommandOutboxSummary['status'];
      attempts: number;
      createdAt: string;
      updatedAt: string;
      ackedAt?: string;
      resultAt?: string;
      deadlineAt: string;
      lastError?: string;
    }>;
    restoredSnapshot?: {
      id: string;
      status: RuntimeSnapshot['status'];
      reason: RuntimeSnapshot['reason'];
      checksum: string;
      capturedAt: string;
      verifiedAt?: string;
      restoredAt?: string;
      restoredByTaskId?: string;
    };
  };
};

type ResolveCustomerNodeRuntimeEvidenceInput = {
  node: CustomerNodeRuntimeEvidenceNode;
  tasks: DeployTask[];
  commandOutbox: CommandOutboxSummary[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
};

const failedCommandStatuses = new Set(['failed', 'expired', 'dead_letter']);

function byNewestTimestamp<T>(items: T[], readTimestamp: (item: T) => string | undefined) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(readTimestamp(left) ?? '');
    const rightTime = Date.parse(readTimestamp(right) ?? '');

    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function taskIdFromConfigVersion(configVersion: string) {
  const match = /^cfg-(task-[A-Za-z0-9_-]+)$/u.exec(configVersion.trim());

  return match?.[1];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRuntimeEvidenceStage(configRevision: RuntimeConfigRevision | undefined) {
  const diagnosis = isObjectRecord(configRevision?.artifact.runtimeDiagnosis)
    ? configRevision.artifact.runtimeDiagnosis
    : undefined;
  const stage = diagnosis?.evidenceStage;

  return typeof stage === 'string' && stage.trim() ? stage.trim() : '';
}

function readRuntimeDiagnosisSummary(configRevision: RuntimeConfigRevision | undefined) {
  const diagnosis = isObjectRecord(configRevision?.artifact.runtimeDiagnosis)
    ? configRevision.artifact.runtimeDiagnosis
    : undefined;

  if (!diagnosis) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(diagnosis).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (['string', 'number', 'boolean'].includes(typeof value)) {
        return true;
      }

      if (Array.isArray(value)) {
        return value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
      }

      return false;
    })
  );
}

function createCommandSummary(item: CommandOutboxSummary) {
  return {
    commandId: item.commandId,
    agentId: item.agentId,
    commandType: item.commandType,
    status: item.status,
    attempts: item.attempts,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ackedAt: item.ackedAt,
    resultAt: item.resultAt,
    deadlineAt: item.deadlineAt,
    lastError: item.lastError
  };
}

function createSnapshotSummary(snapshot: RuntimeSnapshot) {
  return {
    id: snapshot.id,
    status: snapshot.status,
    reason: snapshot.reason,
    checksum: snapshot.checksum,
    capturedAt: snapshot.capturedAt,
    verifiedAt: snapshot.verifiedAt,
    restoredAt: snapshot.restoredAt,
    restoredByTaskId: snapshot.restoredByTaskId
  };
}

function resolveConfigRevision({
  node,
  proof,
  taskId,
  configRevisions
}: {
  node: CustomerNodeRuntimeEvidenceNode;
  proof: AgentRuntimeDeploymentProof | undefined;
  taskId?: string;
  configRevisions: RuntimeConfigRevision[];
}) {
  const proofRevision = proof?.appliedConfigRevisions
    .map((revisionId) => configRevisions.find((revision) => revision.id === revisionId))
    .find((revision): revision is RuntimeConfigRevision => Boolean(revision));

  if (proofRevision) {
    return proofRevision;
  }

  const nodeRevision = configRevisions.find((revision) => revision.id === node.configVersion);

  if (nodeRevision) {
    return nodeRevision;
  }

  if (taskId) {
    const taskRevision = byNewestTimestamp(
      configRevisions.filter((revision) => revision.taskId === taskId),
      (revision) => revision.appliedAt ?? revision.failedAt ?? revision.createdAt
    )[0];

    if (taskRevision) {
      return taskRevision;
    }
  }

  return byNewestTimestamp(
    configRevisions.filter((revision) => revision.targetId === node.id),
    (revision) => revision.appliedAt ?? revision.failedAt ?? revision.createdAt
  )[0];
}

function resolveRollbackRecoveryEvidence({
  task,
  tasks,
  commandOutbox,
  runtimeSnapshot,
  runtimeSnapshots
}: {
  task: DeployTask | undefined;
  tasks: DeployTask[];
  commandOutbox: CommandOutboxSummary[];
  runtimeSnapshot: RuntimeSnapshot | undefined;
  runtimeSnapshots: RuntimeSnapshot[];
}): CustomerNodeRuntimeRollbackRecoveryEvidence | undefined {
  const rollbackTaskId = task?.rollbackTaskId;

  if (!rollbackTaskId) {
    return undefined;
  }

  const rollbackTask = tasks.find((item) => item.id === rollbackTaskId);
  const rollbackCommandOutboxItems = commandOutbox.filter((item) => item.taskId === rollbackTaskId);
  const restoredSnapshot =
    (runtimeSnapshot?.restoredByTaskId === rollbackTaskId ? runtimeSnapshot : undefined) ??
    byNewestTimestamp(
      runtimeSnapshots.filter((snapshot) => snapshot.restoredByTaskId === rollbackTaskId),
      (snapshot) => snapshot.restoredAt ?? snapshot.verifiedAt ?? snapshot.capturedAt
    )[0] ??
    (runtimeSnapshot?.status === 'restored' && !runtimeSnapshot.restoredByTaskId ? runtimeSnapshot : undefined);
  const failedCommand = rollbackCommandOutboxItems.find((item) => failedCommandStatuses.has(item.status));
  const state: CustomerNodeRuntimeRollbackRecoveryState =
    failedCommand || rollbackTask?.status === 'failed' || rollbackTask?.status === 'canceled'
      ? 'failed'
      : restoredSnapshot?.status === 'restored'
        ? 'restored'
        : 'waiting';

  return {
    state,
    taskId: rollbackTaskId,
    task: rollbackTask,
    commandOutboxItems: rollbackCommandOutboxItems,
    restoredSnapshot
  };
}

function createRuntimeEvidenceNextAction({
  state,
  steps
}: {
  state: CustomerNodeRuntimeEvidenceState;
  steps: CustomerNodeRuntimeEvidenceStep[];
}): CustomerNodeRuntimeEvidenceNextAction {
  if (state === 'verified') {
    return {
      code: 'none',
      severity: 'info'
    };
  }

  const step =
    state === 'failed'
      ? steps.find((item) => item.state === 'failed')
      : steps.find((item) => item.state === 'waiting');

  if (!step) {
    return {
      code: 'none',
      severity: 'info'
    };
  }

  const waitingCode = {
    command: 'wait-command-result',
    agentResult: 'wait-agent-result',
    configRevision: 'wait-config-apply',
    preflight: 'wait-preflight',
    snapshot: 'wait-snapshot'
  } satisfies Record<CustomerNodeRuntimeEvidenceStepId, CustomerNodeRuntimeEvidenceNextActionCode>;
  const failedCode = {
    command: 'inspect-command-failure',
    agentResult: 'inspect-agent-result',
    configRevision: 'inspect-config-revision',
    preflight: 'fix-preflight',
    snapshot: 'inspect-snapshot'
  } satisfies Record<CustomerNodeRuntimeEvidenceStepId, CustomerNodeRuntimeEvidenceNextActionCode>;

  return {
    code: step.state === 'failed' ? failedCode[step.id] : waitingCode[step.id],
    severity: step.state === 'failed' ? 'critical' : 'warning',
    stepId: step.id,
    stepState: step.state,
    detail: step.detail ?? step.value
  };
}

export function resolveCustomerNodeRuntimeEvidence({
  node,
  tasks,
  commandOutbox,
  configRevisions,
  preflightPlans,
  runtimeSnapshots
}: ResolveCustomerNodeRuntimeEvidenceInput): CustomerNodeRuntimeEvidenceBundle {
  const proof = node.runtimeDeployment;
  const proofCommandItems = proof?.commandIds
    .map((commandId) => commandOutbox.find((item) => item.commandId === commandId))
    .filter((item): item is CommandOutboxSummary => Boolean(item)) ?? [];
  const derivedTaskId = taskIdFromConfigVersion(node.configVersion);
  const commandTaskId = proofCommandItems[0]?.taskId;
  const configRevision = resolveConfigRevision({
    node,
    proof,
    taskId: commandTaskId ?? derivedTaskId,
    configRevisions
  });
  const taskId = configRevision?.taskId ?? commandTaskId ?? derivedTaskId;
  const task =
    (taskId ? tasks.find((item) => item.id === taskId) : undefined) ??
    byNewestTimestamp(
      tasks.filter(
        (item) =>
          item.targetId === node.id &&
          (item.operation === 'inbound.create' || item.operation === 'inbound.update' || item.operation === 'inbound.delete')
      ),
      (item) => item.updatedAt ?? item.createdAt
    )[0];
  const resolvedTaskId = task?.id ?? taskId;
  const taskCommandItems =
    proofCommandItems.length > 0
      ? proofCommandItems
      : resolvedTaskId
        ? commandOutbox.filter((item) => item.taskId === resolvedTaskId)
        : [];
  const preflightPlan =
    (configRevision?.preflightPlanId
      ? preflightPlans.find((plan) => plan.id === configRevision.preflightPlanId)
      : undefined) ??
    (configRevision
      ? preflightPlans.find((plan) => plan.configRevisionId === configRevision.id)
      : undefined) ??
    (resolvedTaskId ? preflightPlans.find((plan) => plan.taskId === resolvedTaskId) : undefined);
  const runtimeSnapshot =
    (configRevision?.snapshotBeforeId
      ? runtimeSnapshots.find((snapshot) => snapshot.id === configRevision.snapshotBeforeId)
      : undefined) ??
    byNewestTimestamp(
      runtimeSnapshots.filter((snapshot) => snapshot.taskId === resolvedTaskId || snapshot.targetId === node.id),
      (snapshot) => snapshot.verifiedAt ?? snapshot.restoredAt ?? snapshot.capturedAt
    )[0];
  const rollbackRecovery = resolveRollbackRecoveryEvidence({
    task,
    tasks,
    commandOutbox,
    runtimeSnapshot,
    runtimeSnapshots
  });
  const evidenceStage = readRuntimeEvidenceStage(configRevision);
  const failedCommand = taskCommandItems.find((item) => failedCommandStatuses.has(item.status));
  const commandStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'command',
    state:
      failedCommand
        ? 'failed'
        : taskCommandItems.length > 0 && taskCommandItems.every((item) => item.status === 'completed')
          ? 'confirmed'
          : 'waiting',
    value:
      taskCommandItems.length > 0
        ? `${taskCommandItems.filter((item) => item.status === 'completed').length}/${taskCommandItems.length}`
        : undefined,
    detail: failedCommand?.lastError ?? taskCommandItems[0]?.commandId
  };
  const agentResultStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'agentResult',
    state: evidenceStage === 'agent-result-failed' ? 'failed' : proof ? 'confirmed' : 'waiting',
    value: proof ? proof.source : evidenceStage || undefined,
    detail: proof?.verifiedAt ?? configRevision?.failureReason
  };
  const configRevisionStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'configRevision',
    state:
      configRevision?.status === 'failed' || configRevision?.status === 'rolled_back'
        ? 'failed'
        : configRevision?.status === 'applied'
          ? 'confirmed'
          : 'waiting',
    value: configRevision?.id ?? node.configVersion,
    detail: configRevision?.failureReason ?? configRevision?.status
  };
  const failedPreflightCheck = preflightPlan?.checks.find((check) => check.status === 'failed');
  const preflightStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'preflight',
    state:
      preflightPlan?.status === 'failed' ? 'failed' : preflightPlan?.status === 'passed' ? 'confirmed' : 'waiting',
    value: preflightPlan?.id,
    detail:
      preflightPlan?.failureReason ??
      (failedPreflightCheck ? `${failedPreflightCheck.label}: ${failedPreflightCheck.status}` : undefined) ??
      preflightPlan?.status
  };
  const snapshotStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'snapshot',
    state:
      runtimeSnapshot?.status === 'expired'
        ? 'failed'
        : runtimeSnapshot?.status === 'verified' || runtimeSnapshot?.status === 'restored'
          ? 'confirmed'
          : 'waiting',
    value: runtimeSnapshot?.id,
    detail: runtimeSnapshot?.status
  };
  const steps = [commandStep, agentResultStep, configRevisionStep, preflightStep, snapshotStep];
  const state = steps.some((step) => step.state === 'failed')
    ? 'failed'
    : steps.every((step) => step.state === 'confirmed')
      ? 'verified'
      : 'waiting';
  const nextAction = createRuntimeEvidenceNextAction({
    state,
    steps
  });

  return {
    state,
    task,
    taskId: resolvedTaskId,
    proof,
    commandOutboxItems: taskCommandItems,
    configRevision,
    preflightPlan,
    runtimeSnapshot,
    rollbackRecovery,
    evidenceStage: proof ? 'agent-result-verified' : evidenceStage || 'waiting',
    nextAction,
    steps
  };
}

export function createCustomerNodeRuntimeEvidencePackage({
  node,
  evidence
}: {
  node: CustomerNodeRuntimeEvidencePackageNode;
  evidence: CustomerNodeRuntimeEvidenceBundle;
}): CustomerNodeRuntimeEvidencePackage {
  const { task, configRevision, preflightPlan, runtimeSnapshot } = evidence;

  return {
    node: {
      id: node.id,
      agentId: node.agentId,
      customerName: node.customerName,
      nodeName: node.nodeName,
      listenPort: node.listenPort,
      protocol: node.protocol,
      configVersion: node.configVersion
    },
    evidence: {
      state: evidence.state,
      stage: evidence.evidenceStage,
      nextAction: evidence.nextAction,
      steps: evidence.steps,
      ...(evidence.proof ? { proof: evidence.proof } : {})
    },
    ...(task
      ? {
          task: {
            id: task.id,
            requestId: task.requestId,
            operation: task.operation,
            status: task.status,
            targetId: task.targetId,
            targetLabel: task.targetLabel,
            rollbackAvailable: task.rollbackAvailable,
            rollbackTaskId: task.rollbackTaskId,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          }
        }
      : {}),
    commands: evidence.commandOutboxItems.map(createCommandSummary),
    ...(configRevision
      ? {
          configRevision: {
            id: configRevision.id,
            taskId: configRevision.taskId,
            agentId: configRevision.agentId,
            moduleKind: configRevision.moduleKind,
            status: configRevision.status,
            preflightPlanId: configRevision.preflightPlanId,
            snapshotBeforeId: configRevision.snapshotBeforeId,
            diffSummary: configRevision.diffSummary,
            failureReason: configRevision.failureReason,
            runtimeDiagnosis: readRuntimeDiagnosisSummary(configRevision)
          }
        }
      : {}),
    ...(preflightPlan
      ? {
          preflightPlan: {
            id: preflightPlan.id,
            status: preflightPlan.status,
            failureReason: preflightPlan.failureReason,
            checks: preflightPlan.checks.map((check) => ({
              id: check.id,
              label: check.label,
              status: check.status,
              severity: check.severity
            }))
          }
        }
      : {}),
    ...(runtimeSnapshot
      ? {
          runtimeSnapshot: {
            ...createSnapshotSummary(runtimeSnapshot)
          }
        }
      : {}),
    ...(evidence.rollbackRecovery
      ? {
          rollbackRecovery: {
            state: evidence.rollbackRecovery.state,
            taskId: evidence.rollbackRecovery.taskId,
            task: evidence.rollbackRecovery.task
              ? {
                  id: evidence.rollbackRecovery.task.id,
                  requestId: evidence.rollbackRecovery.task.requestId,
                  operation: evidence.rollbackRecovery.task.operation,
                  status: evidence.rollbackRecovery.task.status,
                  targetId: evidence.rollbackRecovery.task.targetId,
                  targetLabel: evidence.rollbackRecovery.task.targetLabel,
                  createdAt: evidence.rollbackRecovery.task.createdAt,
                  updatedAt: evidence.rollbackRecovery.task.updatedAt,
                  failureReason: evidence.rollbackRecovery.task.failureReason
                }
              : undefined,
            commands: evidence.rollbackRecovery.commandOutboxItems.map(createCommandSummary),
            restoredSnapshot: evidence.rollbackRecovery.restoredSnapshot
              ? createSnapshotSummary(evidence.rollbackRecovery.restoredSnapshot)
              : undefined
          }
        }
      : {})
  };
}
