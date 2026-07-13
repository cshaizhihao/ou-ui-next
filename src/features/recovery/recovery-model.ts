import type { PageId } from '../../app/navigation';
import type { Agent, RuntimeConvergenceReadModel, SystemAlert } from '../../domain';
import type { DeployTask } from '../../domain/task';

export type RecoveryQueueId = 'fleet' | 'runtime' | 'compensation' | 'alerts';

export type RecoveryQueueItem = {
  id: string;
  title: string;
  detail: string;
  evidence: string;
  observedAt: string;
  pageId: PageId;
  severity: 'warning' | 'critical';
};

export type RecoveryQueue = {
  id: RecoveryQueueId;
  items: RecoveryQueueItem[];
};

function newestFirst(left: RecoveryQueueItem, right: RecoveryQueueItem) {
  return Date.parse(right.observedAt) - Date.parse(left.observedAt) || right.id.localeCompare(left.id);
}

function alertPageId(alert: SystemAlert): PageId {
  if (alert.resourceType === 'subscription_source') return 'subscriptions';
  if (alert.resourceType === 'agent') return 'nodes';
  if (alert.resourceType === 'quota_policy') return 'customerNodes';
  return 'tasks';
}

export function createRecoveryQueues(input: {
  agents: Agent[];
  tasks: DeployTask[];
  runtimeConvergence: RuntimeConvergenceReadModel[];
  systemAlerts: SystemAlert[];
}): RecoveryQueue[] {
  const convergenceTaskIds = new Set(input.runtimeConvergence.map((item) => item.taskId));
  const compensationTaskIds = new Set(
    input.tasks.filter((task) => task.operationStage === 'compensation').map((task) => task.id)
  );

  const fleet = input.agents
    .filter((agent) => agent.status !== 'online')
    .map<RecoveryQueueItem>((agent) => ({
      id: `agent:${agent.id}`,
      title: agent.name,
      detail: agent.status === 'offline' ? 'Agent is offline' : `Agent state: ${agent.status}`,
      evidence: `${agent.publicAddress} · heartbeat ${agent.lastHeartbeatAt}`,
      observedAt: agent.lastHeartbeatAt,
      pageId: 'nodes',
      severity: agent.status === 'offline' ? 'critical' : 'warning'
    }));

  const runtimeFromConvergence = input.runtimeConvergence
    .filter((item) => item.verification.state === 'failed' || item.verification.state === 'drifted')
    .map<RecoveryQueueItem>((item) => ({
      id: item.id,
      title: item.targetLabel,
      detail:
        item.verification.state === 'drifted'
          ? 'Runtime result is missing Agent verification'
          : 'Runtime apply failed verification',
      evidence: `${item.operation} · ${item.verification.reasons.join(', ') || item.observed.state}`,
      observedAt: item.observed.observedAt,
      pageId: 'tasks',
      severity: item.verification.state === 'failed' ? 'critical' : 'warning'
    }));
  const failedWithoutConvergence = input.tasks
    .filter(
      (task) =>
        task.status === 'failed' &&
        !convergenceTaskIds.has(task.id) &&
        !compensationTaskIds.has(task.id)
    )
    .map<RecoveryQueueItem>((task) => ({
      id: `task:${task.id}`,
      title: task.targetLabel,
      detail: task.failureReason || task.operationFailure?.message || 'Task failed without a recorded reason',
      evidence: `${task.operation} · ${task.id}`,
      observedAt: task.updatedAt,
      pageId: task.operation.startsWith('subscription.') ? 'subscriptions' : 'tasks',
      severity: 'critical'
    }));

  const compensation = input.tasks
    .filter(
      (task) =>
        task.operationStage === 'compensation' &&
        ['queued', 'running', 'retrying', 'failed'].includes(task.status)
    )
    .map<RecoveryQueueItem>((task) => ({
      id: `compensation:${task.id}`,
      title: task.targetLabel,
      detail: task.status === 'failed' ? 'Compensation failed and requires operator review' : 'Compensation is pending runtime evidence',
      evidence: `${task.operation} · ${task.operationId || task.id}`,
      observedAt: task.updatedAt,
      pageId: 'tasks',
      severity: task.status === 'failed' ? 'critical' : 'warning'
    }));

  const alerts = input.systemAlerts.map<RecoveryQueueItem>((alert) => ({
    id: `alert:${alert.id}`,
    title: alert.title,
    detail: alert.message,
    evidence: `${alert.kind} · ${alert.resourceLabel}`,
    observedAt: alert.observedAt,
    pageId: alertPageId(alert),
    severity: alert.severity
  }));

  return [
    { id: 'fleet', items: fleet.sort(newestFirst).slice(0, 20) },
    { id: 'runtime', items: [...runtimeFromConvergence, ...failedWithoutConvergence].sort(newestFirst).slice(0, 30) },
    { id: 'compensation', items: compensation.sort(newestFirst).slice(0, 20) },
    { id: 'alerts', items: alerts.sort(newestFirst).slice(0, 30) }
  ];
}
