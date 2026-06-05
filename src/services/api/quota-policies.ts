import type { Agent } from '../../domain/agent';
import { calculateForwardingBilledBytes, type ForwardRule } from '../../domain/forwarding';
import type { XrayClient, XrayInbound } from '../../domain/protocol';
import type { BillingDirection, QuotaEnforcementState, QuotaPolicy, QuotaResetWindow } from '../../domain/quota';

type CreateQuotaPoliciesFromReadModelsInput = {
  agents: Agent[];
  inbounds: XrayInbound[];
  forwardRules: ForwardRule[];
  quotaPolicies?: QuotaPolicy[];
};

const quotaPolicyScopeOrder = ['managed-host', 'customer-node', 'forwarding-account', 'forward-rule', 'user'] as const;

function clampBytes(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function createSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createQuotaUsageRatio(policy: Pick<QuotaPolicy, 'limitBytes' | 'usedBytes'>) {
  return policy.limitBytes > 0 ? Math.min(policy.usedBytes / policy.limitBytes, 1) : 0;
}

function resolveQuotaEnforcementState(
  quotaExceeded: boolean,
  runtimeDisabledByPolicy: boolean,
  fallback?: QuotaEnforcementState
): QuotaEnforcementState {
  if (runtimeDisabledByPolicy && quotaExceeded) {
    return 'disabled_by_quota';
  }

  if (quotaExceeded) {
    return 'exceeded';
  }

  return fallback === 'reset_pending' ? fallback : 'active';
}

function readForwardingAccountPolicyId(rule: ForwardRule) {
  return rule.quotaPolicyId?.trim() ? rule.quotaPolicyId : `forwarding-account:${createSlug(rule.ownerName, rule.id)}`;
}

function readCustomerNodeResetWindow(client: XrayClient): QuotaResetWindow {
  switch (client.resetPolicy) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return 'weekly';
    case 'monthly':
      return 'monthly';
    case 'never':
    default:
      return 'manual';
  }
}

function readManagedHostPolicy(agent: Agent): QuotaPolicy {
  const limitBytes = clampBytes(agent.monthlyTrafficLimitBytes || agent.telemetry.monthlyTrafficLimitBytes);
  const usedBytes = clampBytes(agent.telemetry.monthlyTrafficUsedBytes || agent.trafficPolicy.manualUsedTrafficBytes);
  const quotaExceeded = agent.telemetry.quotaExceeded ?? (limitBytes > 0 && usedBytes >= limitBytes);
  const runtimeDisabledByPolicy = Boolean(agent.telemetry.runtimeDisabledByPolicy) && quotaExceeded;

  return {
    id: `managed-host:${agent.id}`,
    name: agent.name,
    scope: 'managed-host',
    limitBytes,
    usedBytes,
    resetWindow: 'monthly',
    billingDirection: agent.trafficPolicy.accountingMode,
    enforcementState: resolveQuotaEnforcementState(quotaExceeded, runtimeDisabledByPolicy),
    resourceId: agent.id,
    detail: agent.publicAddress,
    resetDay: agent.trafficPolicy.monthlyResetDay,
    reportedAt: agent.telemetry.reportedAt,
    runtimeDisabledByPolicy,
    guardrailReason: quotaExceeded ? agent.telemetry.guardrailReason : undefined
  };
}

function readCustomerNodePolicy(inbound: XrayInbound, client: XrayClient): QuotaPolicy {
  const limitBytes = clampBytes(client.trafficLimitBytes);
  const usedBytes = clampBytes(client.usedTrafficBytes || client.manualUsedTrafficBytes);
  const quotaExceeded = client.quotaExceeded ?? (limitBytes > 0 && usedBytes >= limitBytes);
  const runtimeDisabledByPolicy = Boolean(client.runtimeDisabledByPolicy) && quotaExceeded;
  const detailParts = [inbound.customerName, client.email].filter((value) => typeof value === 'string' && value.trim() !== '');

  return {
    id: `customer-node:${inbound.id}:${client.id}`,
    name: inbound.label,
    scope: 'customer-node',
    limitBytes,
    usedBytes,
    resetWindow: readCustomerNodeResetWindow(client),
    billingDirection: 'both',
    enforcementState: resolveQuotaEnforcementState(quotaExceeded, runtimeDisabledByPolicy),
    resourceId: `${inbound.id}:${client.id}`,
    detail: detailParts.join(' · ') || client.id,
    resetDay: client.monthlyResetDay,
    reportedAt: client.lastTrafficSampleAt,
    runtimeDisabledByPolicy,
    guardrailReason: quotaExceeded ? client.guardrailReason : undefined
  };
}

function readForwardRulePolicy(rule: ForwardRule): QuotaPolicy {
  const limitBytes = clampBytes(rule.quotaBytes);
  const usedBytes = clampBytes(calculateForwardingBilledBytes(rule));
  const quotaExceeded = rule.quotaExceeded ?? (limitBytes > 0 && usedBytes >= limitBytes);
  const runtimeDisabledByPolicy = Boolean(rule.runtimeDisabledByPolicy) && quotaExceeded;
  const primaryPort = rule.ports[0];
  const detail = primaryPort
    ? `${primaryPort.listenAddress}:${primaryPort.listenPort} -> ${primaryPort.targetAddress}:${primaryPort.targetPort}`
    : rule.ownerName;

  return {
    id: `forward-rule:${rule.id}`,
    name: rule.name,
    scope: 'forward-rule',
    limitBytes,
    usedBytes,
    resetWindow: 'monthly',
    billingDirection: rule.billingDirection,
    enforcementState: resolveQuotaEnforcementState(quotaExceeded, runtimeDisabledByPolicy),
    resourceId: rule.id,
    detail,
    resetDay: rule.monthlyResetDay,
    reportedAt: primaryPort?.lastCounterSampleAt,
    runtimeDisabledByPolicy,
    guardrailReason: quotaExceeded ? rule.guardrailReason : undefined,
    sourceCount: rule.ports.length
  };
}

function readForwardingAccountPolicy(
  policyId: string,
  rules: ForwardRule[],
  existingPolicy?: QuotaPolicy
): QuotaPolicy {
  const usedBytes = rules.reduce((sum, rule) => sum + clampBytes(calculateForwardingBilledBytes(rule)), 0);
  const limitBytes =
    existingPolicy && existingPolicy.limitBytes > 0
      ? clampBytes(existingPolicy.limitBytes)
      : rules.reduce((sum, rule) => sum + clampBytes(rule.quotaBytes), 0);
  const quotaExceeded =
    (limitBytes > 0 && usedBytes >= limitBytes)
    || rules.some(
      (rule) =>
        rule.quotaExceeded
        ?? (clampBytes(rule.quotaBytes) > 0 && clampBytes(calculateForwardingBilledBytes(rule)) >= clampBytes(rule.quotaBytes))
    );
  const runtimeDisabledByPolicy = rules.some((rule) => Boolean(rule.runtimeDisabledByPolicy) && (rule.quotaExceeded ?? false));
  const billingDirections = [...new Set(rules.map((rule) => rule.billingDirection))];
  const resetDays = [...new Set(rules.map((rule) => rule.monthlyResetDay).filter((day) => Number.isFinite(day)))];
  const ownerName = rules[0]?.ownerName ?? existingPolicy?.name ?? policyId;

  return {
    id: policyId,
    name: existingPolicy?.name ?? ownerName,
    scope: 'forwarding-account',
    limitBytes,
    usedBytes,
    resetWindow: 'monthly',
    billingDirection: billingDirections.length === 1 ? billingDirections[0] : ('both' satisfies BillingDirection),
    enforcementState: resolveQuotaEnforcementState(quotaExceeded, runtimeDisabledByPolicy, existingPolicy?.enforcementState),
    resourceId: ownerName,
    detail: `${rules.length} rule${rules.length === 1 ? '' : 's'} · ${ownerName}`,
    resetDay: resetDays.length === 1 ? resetDays[0] : undefined,
    reportedAt:
      rules
        .flatMap((rule) => rule.ports.map((port) => port.lastCounterSampleAt).filter((sampledAt): sampledAt is string => Boolean(sampledAt)))
        .sort((left, right) => right.localeCompare(left))[0] ?? existingPolicy?.reportedAt,
    runtimeDisabledByPolicy,
    guardrailReason:
      rules.find((rule) => rule.quotaExceeded && rule.guardrailReason)?.guardrailReason
      ?? existingPolicy?.guardrailReason
      ?? (quotaExceeded ? 'forwarding_account_monthly_quota_exceeded' : undefined),
    sourceCount: rules.length
  };
}

function compareQuotaPolicies(left: QuotaPolicy, right: QuotaPolicy) {
  const leftStateWeight =
    left.enforcementState === 'disabled_by_quota'
      ? 3
      : left.enforcementState === 'exceeded'
        ? 2
        : left.enforcementState === 'reset_pending'
          ? 1
          : 0;
  const rightStateWeight =
    right.enforcementState === 'disabled_by_quota'
      ? 3
      : right.enforcementState === 'exceeded'
        ? 2
        : right.enforcementState === 'reset_pending'
          ? 1
          : 0;

  if (rightStateWeight !== leftStateWeight) {
    return rightStateWeight - leftStateWeight;
  }

  const leftRatio = createQuotaUsageRatio(left);
  const rightRatio = createQuotaUsageRatio(right);

  if (rightRatio !== leftRatio) {
    return rightRatio - leftRatio;
  }

  if (right.usedBytes !== left.usedBytes) {
    return right.usedBytes - left.usedBytes;
  }

  const leftScopeIndex = quotaPolicyScopeOrder.indexOf(left.scope);
  const rightScopeIndex = quotaPolicyScopeOrder.indexOf(right.scope);

  if (leftScopeIndex !== rightScopeIndex) {
    return leftScopeIndex - rightScopeIndex;
  }

  return left.name.localeCompare(right.name);
}

export function calculateQuotaPolicyUsageRatio(policy: Pick<QuotaPolicy, 'limitBytes' | 'usedBytes'>) {
  return createQuotaUsageRatio(policy);
}

export function createQuotaPoliciesFromReadModels({
  agents,
  inbounds,
  forwardRules,
  quotaPolicies = []
}: CreateQuotaPoliciesFromReadModelsInput) {
  const existingPoliciesById = new Map(quotaPolicies.map((policy) => [policy.id, policy] as const));
  const result = new Map<string, QuotaPolicy>();

  for (const agent of agents) {
    result.set(`managed-host:${agent.id}`, readManagedHostPolicy(agent));
  }

  for (const inbound of inbounds) {
    for (const client of inbound.clients) {
      result.set(`customer-node:${inbound.id}:${client.id}`, readCustomerNodePolicy(inbound, client));
    }
  }

  const forwardRulesByAccountPolicyId = new Map<string, ForwardRule[]>();

  for (const rule of forwardRules) {
    result.set(`forward-rule:${rule.id}`, readForwardRulePolicy(rule));
    const accountPolicyId = readForwardingAccountPolicyId(rule);
    const existingRules = forwardRulesByAccountPolicyId.get(accountPolicyId) ?? [];
    forwardRulesByAccountPolicyId.set(accountPolicyId, [...existingRules, rule]);
  }

  for (const [policyId, rules] of forwardRulesByAccountPolicyId.entries()) {
    result.set(policyId, readForwardingAccountPolicy(policyId, rules, existingPoliciesById.get(policyId)));
  }

  for (const existingPolicy of quotaPolicies) {
    if (!result.has(existingPolicy.id)) {
      result.set(existingPolicy.id, existingPolicy);
    }
  }

  return [...result.values()].sort(compareQuotaPolicies);
}
