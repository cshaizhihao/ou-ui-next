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

export type CustomerNodeRuntimeEvidenceBundle = {
  state: CustomerNodeRuntimeEvidenceState;
  task?: DeployTask;
  taskId?: string;
  proof?: AgentRuntimeDeploymentProof;
  commandOutboxItems: CommandOutboxSummary[];
  configRevision?: RuntimeConfigRevision;
  preflightPlan?: RuntimePreflightPlan;
  runtimeSnapshot?: RuntimeSnapshot;
  evidenceStage: string;
  steps: CustomerNodeRuntimeEvidenceStep[];
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
    detail: proof?.verifiedAt
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
    detail: configRevision?.status
  };
  const preflightStep: CustomerNodeRuntimeEvidenceStep = {
    id: 'preflight',
    state:
      preflightPlan?.status === 'failed' ? 'failed' : preflightPlan?.status === 'passed' ? 'confirmed' : 'waiting',
    value: preflightPlan?.id,
    detail: preflightPlan?.status
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

  return {
    state,
    task,
    taskId: resolvedTaskId,
    proof,
    commandOutboxItems: taskCommandItems,
    configRevision,
    preflightPlan,
    runtimeSnapshot,
    evidenceStage: proof ? 'agent-result-verified' : evidenceStage || 'waiting',
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
    commands: evidence.commandOutboxItems.map((item) => ({
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
    })),
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
            id: runtimeSnapshot.id,
            status: runtimeSnapshot.status,
            reason: runtimeSnapshot.reason,
            checksum: runtimeSnapshot.checksum,
            capturedAt: runtimeSnapshot.capturedAt,
            verifiedAt: runtimeSnapshot.verifiedAt,
            restoredAt: runtimeSnapshot.restoredAt,
            restoredByTaskId: runtimeSnapshot.restoredByTaskId
          }
        }
      : {})
  };
}
