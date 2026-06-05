import type { ForwardRule } from '../../domain/forwarding';
import type { CreateTaskInput, DeployTask } from '../../domain/task';

type ForwardQuotaEnforcementTrigger =
  | {
      kind: 'agent-event';
      id: string;
      observedAt: string;
    }
  | {
      kind: 'task';
      id: string;
      observedAt: string;
    };

export type ForwardQuotaEnforcementTaskIntent = {
  input: CreateTaskInput;
  idempotencyKey: string;
  requestId: string;
};

const activeForwardIntentOperations = new Set<CreateTaskInput['operation']>([
  'forward.create',
  'forward.update',
  'forward.apply',
  'forward.pause',
  'forward.resume'
]);

const inactiveTaskStatuses = new Set<DeployTask['status']>(['failed', 'canceled', 'rolled_back']);

function gbFromBytes(bytes: number | undefined) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return 0;
  }

  return Math.round((bytes / 1024 / 1024 / 1024) * 1000) / 1000;
}

function truncateKey(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function readForwardRuleAgentIds(rule: ForwardRule) {
  return [...new Set(rule.ports.map((binding) => binding.agentId).filter((agentId) => agentId.trim() !== ''))];
}

function readPrimaryBinding(rule: ForwardRule) {
  return rule.ports[0];
}

function isAutomaticQuotaEnforcementTask(task: Pick<DeployTask, 'operation' | 'metadata'>) {
  return (
    (task.operation === 'forward.pause' || task.operation === 'forward.resume')
    && task.metadata?.quotaEnforcementAutomatic === true
  );
}

function readLatestForwardIntentTask(tasks: DeployTask[], ruleId: string) {
  return [...tasks]
    .filter((task) => task.targetId === ruleId)
    .filter((task) => activeForwardIntentOperations.has(task.operation))
    .filter((task) => !inactiveTaskStatuses.has(task.status))
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      const timeDelta = (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);

      return timeDelta === 0 ? right.id.localeCompare(left.id) : timeDelta;
    })[0];
}

function createForwardQuotaMetadata(
  rule: ForwardRule,
  enabled: boolean,
  action: 'pause' | 'resume',
  trigger: ForwardQuotaEnforcementTrigger
) {
  const primaryBinding = readPrimaryBinding(rule);
  const tunnelId = rule.tunnelId.trim();

  return {
    name: rule.name,
    ownerName: rule.ownerName,
    ...(tunnelId ? { tunnelId } : {}),
    listenAddress: primaryBinding?.listenAddress ?? '0.0.0.0',
    listenPort: primaryBinding?.listenPort ?? 0,
    targetAddress: primaryBinding?.targetAddress ?? '127.0.0.1',
    targetPort: primaryBinding?.targetPort ?? 0,
    protocol: primaryBinding?.protocol ?? 'tcp',
    entryNodeIds: readForwardRuleAgentIds(rule),
    strategy: rule.strategy,
    quotaGb: gbFromBytes(rule.quotaBytes),
    monthlyResetDay: rule.monthlyResetDay,
    currentUsedTrafficGb: gbFromBytes(rule.manualUsedBytes),
    rateLimitMbps: rule.rateLimitMbps ?? 0,
    ipRateLimitMbps: rule.ipRateLimitMbps ?? 0,
    maxConnections: rule.maxConnections,
    maxConnectionsPerIp: rule.maxConnectionsPerIp,
    proxyProtocol: rule.proxyProtocol,
    billingDirection: rule.billingDirection,
    tunnelMode: rule.tunnelMode,
    trafficMultiplier: rule.trafficMultiplier,
    pricePerGb: rule.pricePerGb,
    enabled,
    quotaEnforcementAutomatic: true,
    quotaEnforcementAction: action,
    quotaEnforcementPolicyId: `forward-rule:${rule.id}`,
    quotaEnforcementObservedAt: trigger.observedAt,
    quotaEnforcementTriggerKind: trigger.kind,
    quotaEnforcementTriggerId: trigger.id,
    quotaEnforcementGuardrailReason: rule.guardrailReason ?? (action === 'pause' ? 'rule_monthly_quota_exceeded' : 'ok')
  };
}

function createPauseIntent(rule: ForwardRule, trigger: ForwardQuotaEnforcementTrigger): ForwardQuotaEnforcementTaskIntent {
  const idempotencyKey = truncateKey(
    ['system', 'quota-enforcer', 'forward.pause', rule.id, trigger.kind, trigger.id].join(':'),
    190
  );

  return {
    input: {
      operation: 'forward.pause',
      resourceType: 'forward',
      targetId: rule.id,
      targetLabel: rule.name,
      summary: `配额超限自动停用端口转发：${rule.name}`,
      metadata: createForwardQuotaMetadata(rule, false, 'pause', trigger)
    },
    idempotencyKey,
    requestId: truncateKey(idempotencyKey, 150)
  };
}

function createResumeIntent(rule: ForwardRule, trigger: ForwardQuotaEnforcementTrigger): ForwardQuotaEnforcementTaskIntent {
  const idempotencyKey = truncateKey(
    ['system', 'quota-enforcer', 'forward.resume', rule.id, trigger.kind, trigger.id].join(':'),
    190
  );

  return {
    input: {
      operation: 'forward.resume',
      resourceType: 'forward',
      targetId: rule.id,
      targetLabel: rule.name,
      summary: `配额恢复自动恢复端口转发：${rule.name}`,
      metadata: createForwardQuotaMetadata(rule, true, 'resume', trigger)
    },
    idempotencyKey,
    requestId: truncateKey(idempotencyKey, 150)
  };
}

export function deriveForwardQuotaEnforcementTaskIntents(
  tasks: DeployTask[],
  beforeRules: ForwardRule[],
  afterRules: ForwardRule[],
  trigger: ForwardQuotaEnforcementTrigger
) {
  const beforeById = new Map(beforeRules.map((rule) => [rule.id, rule] as const));

  return afterRules.flatMap((rule) => {
    const beforeRule = beforeById.get(rule.id);
    const latestForwardIntentTask = readLatestForwardIntentTask(tasks, rule.id);
    const latestIntentIsAutomaticPause =
      latestForwardIntentTask?.operation === 'forward.pause'
      && latestForwardIntentTask.status === 'succeeded'
      && isAutomaticQuotaEnforcementTask(latestForwardIntentTask);
    const latestIntentIsAutomaticResume =
      latestForwardIntentTask?.operation === 'forward.resume'
      && !inactiveTaskStatuses.has(latestForwardIntentTask.status)
      && isAutomaticQuotaEnforcementTask(latestForwardIntentTask);

    if (
      rule.enabled
      && rule.quotaExceeded
      && !latestIntentIsAutomaticResume
      && !(
        latestForwardIntentTask?.operation === 'forward.pause'
        && !inactiveTaskStatuses.has(latestForwardIntentTask.status)
        && isAutomaticQuotaEnforcementTask(latestForwardIntentTask)
      )
    ) {
      return [createPauseIntent(rule, trigger)];
    }

    if (!rule.enabled && !rule.quotaExceeded && latestIntentIsAutomaticPause) {
      return [createResumeIntent(rule, trigger)];
    }

    if (!beforeRule) {
      return [];
    }

    return [];
  });
}
