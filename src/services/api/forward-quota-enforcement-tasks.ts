import type { ForwardRule } from '../../domain/forwarding';
import type { CreateTaskInput, DeployTask } from '../../domain/task';
import type { QuotaPolicy } from '../../domain/quota';

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
const exceededQuotaStates = new Set<QuotaPolicy['enforcementState']>(['exceeded', 'disabled_by_quota']);

function gbFromBytes(bytes: number | undefined) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return 0;
  }

  return Math.round((bytes / 1024 / 1024 / 1024) * 1000) / 1000;
}

function truncateKey(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function readForwardRuleAgentIds(rule: ForwardRule) {
  return [...new Set(rule.ports.map((binding) => binding.agentId).filter((agentId) => agentId.trim() !== ''))];
}

function readPrimaryBinding(rule: ForwardRule) {
  return rule.ports[0];
}

function readForwardingAccountPolicyId(rule: ForwardRule) {
  return rule.quotaPolicyId?.trim() ? rule.quotaPolicyId : `forwarding-account:${createStableSlug(rule.ownerName, rule.id)}`;
}

function readTunnelId(rule: ForwardRule) {
  return rule.tunnelId.trim();
}

function readTunnelPolicyResourceId(policy: QuotaPolicy) {
  if (policy.resourceId?.trim()) {
    return policy.resourceId.trim();
  }

  return policy.id.startsWith('tunnel:') ? policy.id.replace(/^tunnel:/, '') : '';
}

function findTunnelPolicyForRule(rule: ForwardRule, tunnelPolicies: QuotaPolicy[]) {
  const tunnelId = readTunnelId(rule);

  if (!tunnelId) {
    return undefined;
  }

  return (
    tunnelPolicies.find((policy) => readTunnelPolicyResourceId(policy) === tunnelId)
    ?? tunnelPolicies.find((policy) => policy.id === `tunnel:${tunnelId}`)
  );
}

function isAutomaticQuotaEnforcementTask(task: Pick<DeployTask, 'operation' | 'metadata'>, policyId?: string) {
  return (
    (task.operation === 'forward.pause' || task.operation === 'forward.resume')
    && task.metadata?.quotaEnforcementAutomatic === true
    && (!policyId || task.metadata?.quotaEnforcementPolicyId === policyId)
  );
}

function readLatestForwardIntentTask(tasks: DeployTask[], ruleId: string, policyId?: string) {
  return [...tasks]
    .filter((task) => task.targetId === ruleId)
    .filter((task) => activeForwardIntentOperations.has(task.operation))
    .filter((task) => !inactiveTaskStatuses.has(task.status))
    .filter((task) => (policyId ? isAutomaticQuotaEnforcementTask(task, policyId) : true))
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
  trigger: ForwardQuotaEnforcementTrigger,
  policy: Pick<QuotaPolicy, 'id' | 'name' | 'scope' | 'guardrailReason'>
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
    quotaEnforcementPolicyId: policy.id,
    quotaEnforcementPolicyName: policy.name,
    quotaEnforcementPolicyScope: policy.scope,
    quotaEnforcementObservedAt: trigger.observedAt,
    quotaEnforcementTriggerKind: trigger.kind,
    quotaEnforcementTriggerId: trigger.id,
    quotaEnforcementGuardrailReason: policy.guardrailReason ?? rule.guardrailReason ?? (action === 'pause' ? 'rule_monthly_quota_exceeded' : 'ok')
  };
}

function createPauseIntent(
  rule: ForwardRule,
  trigger: ForwardQuotaEnforcementTrigger,
  policy: Pick<QuotaPolicy, 'id' | 'name' | 'scope' | 'guardrailReason'>
): ForwardQuotaEnforcementTaskIntent {
  const idempotencyKey = truncateKey(
    ['system', 'quota-enforcer', 'forward.pause', rule.id, policy.id, trigger.kind, trigger.id].join(':'),
    190
  );
  const summaryPrefix =
    policy.scope === 'forwarding-account'
      ? '转发账号配额超限自动停用端口转发'
      : policy.scope === 'tunnel'
        ? '转发链路配额超限自动停用端口转发'
        : '配额超限自动停用端口转发';

  return {
    input: {
      operation: 'forward.pause',
      resourceType: 'forward',
      targetId: rule.id,
      targetLabel: rule.name,
      summary: `${summaryPrefix}：${rule.name}`,
      metadata: createForwardQuotaMetadata(rule, false, 'pause', trigger, policy)
    },
    idempotencyKey,
    requestId: truncateKey(idempotencyKey, 150)
  };
}

function createResumeIntent(
  rule: ForwardRule,
  trigger: ForwardQuotaEnforcementTrigger,
  policy: Pick<QuotaPolicy, 'id' | 'name' | 'scope' | 'guardrailReason'>
): ForwardQuotaEnforcementTaskIntent {
  const idempotencyKey = truncateKey(
    ['system', 'quota-enforcer', 'forward.resume', rule.id, policy.id, trigger.kind, trigger.id].join(':'),
    190
  );
  const summaryPrefix =
    policy.scope === 'forwarding-account'
      ? '转发账号配额恢复自动恢复端口转发'
      : policy.scope === 'tunnel'
        ? '转发链路配额恢复自动恢复端口转发'
        : '配额恢复自动恢复端口转发';

  return {
    input: {
      operation: 'forward.resume',
      resourceType: 'forward',
      targetId: rule.id,
      targetLabel: rule.name,
      summary: `${summaryPrefix}：${rule.name}`,
      metadata: createForwardQuotaMetadata(rule, true, 'resume', trigger, policy)
    },
    idempotencyKey,
    requestId: truncateKey(idempotencyKey, 150)
  };
}

export function deriveForwardQuotaEnforcementTaskIntents(
  tasks: DeployTask[],
  beforeRules: ForwardRule[],
  afterRules: ForwardRule[],
  afterPolicies: QuotaPolicy[],
  trigger: ForwardQuotaEnforcementTrigger
) {
  const beforeById = new Map(beforeRules.map((rule) => [rule.id, rule] as const));
  const accountPoliciesById = new Map(
    afterPolicies
      .filter((policy) => policy.scope === 'forwarding-account')
      .map((policy) => [policy.id, policy] as const)
  );
  const tunnelPolicies = afterPolicies.filter((policy) => policy.scope === 'tunnel');

  return afterRules.flatMap((rule) => {
    const beforeRule = beforeById.get(rule.id);
    const intents: ForwardQuotaEnforcementTaskIntent[] = [];
    const accountPolicy = accountPoliciesById.get(readForwardingAccountPolicyId(rule));
    const tunnelPolicy = findTunnelPolicyForRule(rule, tunnelPolicies);
    const accountPolicyExceeded = accountPolicy ? exceededQuotaStates.has(accountPolicy.enforcementState) : false;
    const tunnelPolicyExceeded = tunnelPolicy ? exceededQuotaStates.has(tunnelPolicy.enforcementState) : false;
    const hasAnyBlockingPolicy = Boolean(rule.quotaExceeded) || accountPolicyExceeded || tunnelPolicyExceeded;
    const rulePolicy: Pick<QuotaPolicy, 'id' | 'name' | 'scope' | 'guardrailReason'> = {
      id: `forward-rule:${rule.id}`,
      name: rule.name,
      scope: 'forward-rule',
      guardrailReason: rule.guardrailReason
    };
    const latestRulePolicyTask = readLatestForwardIntentTask(tasks, rule.id, rulePolicy.id);
    const hasActiveRulePolicyPause =
      latestRulePolicyTask?.operation === 'forward.pause' && isAutomaticQuotaEnforcementTask(latestRulePolicyTask, rulePolicy.id);
    const hasSucceededRulePolicyPause =
      latestRulePolicyTask?.operation === 'forward.pause'
      && latestRulePolicyTask.status === 'succeeded'
      && isAutomaticQuotaEnforcementTask(latestRulePolicyTask, rulePolicy.id);
    const hasActiveRulePolicyResume =
      latestRulePolicyTask?.operation === 'forward.resume' && isAutomaticQuotaEnforcementTask(latestRulePolicyTask, rulePolicy.id);

    if (rule.enabled && rule.quotaExceeded && !hasActiveRulePolicyPause) {
      intents.push(createPauseIntent(rule, trigger, rulePolicy));
    }

    if (!rule.enabled && !hasAnyBlockingPolicy && hasSucceededRulePolicyPause && !hasActiveRulePolicyResume) {
      intents.push(createResumeIntent(rule, trigger, rulePolicy));
    }

    if (accountPolicy && !rule.quotaExceeded) {
      const latestAccountPolicyTask = readLatestForwardIntentTask(tasks, rule.id, accountPolicy.id);
      const hasActiveAccountPause =
        latestAccountPolicyTask?.operation === 'forward.pause'
        && isAutomaticQuotaEnforcementTask(latestAccountPolicyTask, accountPolicy.id);
      const hasSucceededAccountPause =
        latestAccountPolicyTask?.operation === 'forward.pause'
        && latestAccountPolicyTask.status === 'succeeded'
        && isAutomaticQuotaEnforcementTask(latestAccountPolicyTask, accountPolicy.id);
      const hasActiveAccountResume =
        latestAccountPolicyTask?.operation === 'forward.resume'
        && isAutomaticQuotaEnforcementTask(latestAccountPolicyTask, accountPolicy.id);
      const hasQueuedPauseIntent = intents.some((intent) => intent.input.operation === 'forward.pause');
      const hasQueuedResumeIntent = intents.some((intent) => intent.input.operation === 'forward.resume');

      if (rule.enabled && accountPolicyExceeded && !hasActiveAccountPause && !hasQueuedPauseIntent) {
        intents.push(createPauseIntent(rule, trigger, accountPolicy));
      }

      if (!rule.enabled && !hasAnyBlockingPolicy && hasSucceededAccountPause && !hasActiveAccountResume && !hasQueuedResumeIntent) {
        intents.push(createResumeIntent(rule, trigger, accountPolicy));
      }
    }

    if (tunnelPolicy && !rule.quotaExceeded) {
      const latestTunnelPolicyTask = readLatestForwardIntentTask(tasks, rule.id, tunnelPolicy.id);
      const hasActiveTunnelPause =
        latestTunnelPolicyTask?.operation === 'forward.pause'
        && isAutomaticQuotaEnforcementTask(latestTunnelPolicyTask, tunnelPolicy.id);
      const hasSucceededTunnelPause =
        latestTunnelPolicyTask?.operation === 'forward.pause'
        && latestTunnelPolicyTask.status === 'succeeded'
        && isAutomaticQuotaEnforcementTask(latestTunnelPolicyTask, tunnelPolicy.id);
      const hasActiveTunnelResume =
        latestTunnelPolicyTask?.operation === 'forward.resume'
        && isAutomaticQuotaEnforcementTask(latestTunnelPolicyTask, tunnelPolicy.id);
      const hasQueuedPauseIntent = intents.some((intent) => intent.input.operation === 'forward.pause');
      const hasQueuedResumeIntent = intents.some((intent) => intent.input.operation === 'forward.resume');

      if (rule.enabled && tunnelPolicyExceeded && !hasActiveTunnelPause && !hasQueuedPauseIntent) {
        intents.push(createPauseIntent(rule, trigger, tunnelPolicy));
      }

      if (!rule.enabled && !hasAnyBlockingPolicy && hasSucceededTunnelPause && !hasActiveTunnelResume && !hasQueuedResumeIntent) {
        intents.push(createResumeIntent(rule, trigger, tunnelPolicy));
      }
    }

    if (!beforeRule) {
      return intents;
    }

    return intents;
  });
}
