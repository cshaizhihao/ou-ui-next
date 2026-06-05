import type { Agent } from '../../domain/agent';
import { resolveMonthlyBillingPeriod } from '../../domain/billing-period';
import { calculateForwardingBilledBytes, type ForwardPortBinding, type ForwardRule } from '../../domain/forwarding';
import type { CreateTaskInput, DeployTask } from '../../domain/task';
import type { QuotaPolicy } from '../../domain/quota';
import type { XrayInbound } from '../../domain/protocol';
import type { AgentEventEnvelope } from './api-contract';

type QuotaResetAuditSnapshot = {
  id: string;
  name: string;
  scope: QuotaPolicy['scope'];
  resourceId?: string;
  usedBytes: number;
  limitBytes: number;
  enforcementState: QuotaPolicy['enforcementState'];
  reportedAt?: string;
};

type QuotaResetAgentDescriptor = {
  quotaPolicyId: string;
  quotaPolicyName: string;
  resetAt: string;
  agentId: string;
  resetDay: number;
  billingPeriod?: string;
  accountingMode: Agent['trafficPolicy']['accountingMode'];
  quotaBytes: number;
  baselineManualUsedTrafficBytes: number;
  baselineMonthlyIngressBytes: number;
  baselineMonthlyEgressBytes: number;
  baselineMonthlyTrafficUsedBytes: number;
};

type QuotaResetClientDescriptor = {
  quotaPolicyId: string;
  quotaPolicyName: string;
  resetAt: string;
  inboundId: string;
  clientId: string;
  clientEmail: string;
  resetDay: number;
  billingPeriod?: string;
  trafficLimitBytes: number;
  baselineManualUsedTrafficBytes: number;
  baselineUsedTrafficBytes: number;
  baselineUplinkBytes: number;
  baselineDownlinkBytes: number;
};

type QuotaResetBindingDescriptor = {
  agentId: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  protocol: ForwardPortBinding['protocol'];
  runtimeServiceNames?: string[];
  baselineInboundBytes: number;
  baselineOutboundBytes: number;
};

type QuotaResetForwardRuleDescriptor = {
  quotaPolicyId: string;
  quotaPolicyName: string;
  resetAt: string;
  ruleId: string;
  resetDay: number;
  billingPeriod?: string;
  billingDirection: ForwardRule['billingDirection'];
  trafficMultiplier: number;
  quotaBytes: number;
  baselineManualUsedBytes: number;
  baselineInboundBytes: number;
  baselineOutboundBytes: number;
  baselineBilledTrafficBytes: number;
  bindings: QuotaResetBindingDescriptor[];
};

type QuotaResetExplicitPolicyDescriptor = {
  quotaPolicyId: string;
  quotaPolicyName: string;
  resetAt: string;
  usedBytes: number;
};

type QuotaResetPreparedInput = {
  agents: Agent[];
  inbounds: XrayInbound[];
  forwardRules: ForwardRule[];
  quotaPolicies: QuotaPolicy[];
  nowIso: string;
  input: CreateTaskInput;
};

type QuotaResetReplayState = {
  agentsById: Map<string, QuotaResetAgentDescriptor[]>;
  clientsByInboundId: Map<string, QuotaResetClientDescriptor[]>;
  forwardRulesById: Map<string, QuotaResetForwardRuleDescriptor[]>;
  forwardRulesByServiceName: Map<string, QuotaResetForwardRuleDescriptor[]>;
};

function clampBytes(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(Math.round(value ?? 0), 0) : 0;
}

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function resolveForwardingAccountPolicyId(rule: ForwardRule) {
  return rule.quotaPolicyId?.trim() ? rule.quotaPolicyId : `forwarding-account:${createStableSlug(rule.ownerName, rule.id)}`;
}

function readBillingPeriod(resetDay: number, observedAt: string) {
  return resolveMonthlyBillingPeriod(resetDay, observedAt)?.key;
}

function subtractBaseline(value: number | undefined, baseline: number) {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(clampBytes(value) - clampBytes(baseline), 0);
}

function isSameBillingPeriod(resetDay: number, billingPeriod: string | undefined, observedAt: string, samplePeriod?: string) {
  if (billingPeriod && samplePeriod) {
    return billingPeriod === samplePeriod;
  }

  if (!billingPeriod) {
    return false;
  }

  return readBillingPeriod(resetDay, observedAt) === billingPeriod;
}

function readQuotaResetAgentDescriptors(task: DeployTask) {
  return Array.isArray(task.metadata?.quotaResetAgentDescriptors)
    ? (task.metadata?.quotaResetAgentDescriptors as QuotaResetAgentDescriptor[])
    : [];
}

function readQuotaResetClientDescriptors(task: DeployTask) {
  return Array.isArray(task.metadata?.quotaResetClientDescriptors)
    ? (task.metadata?.quotaResetClientDescriptors as QuotaResetClientDescriptor[])
    : [];
}

function readQuotaResetForwardRuleDescriptors(task: DeployTask) {
  return Array.isArray(task.metadata?.quotaResetForwardRuleDescriptors)
    ? (task.metadata?.quotaResetForwardRuleDescriptors as QuotaResetForwardRuleDescriptor[])
    : [];
}

function readQuotaResetExplicitPolicyDescriptors(task: DeployTask) {
  return Array.isArray(task.metadata?.quotaResetExplicitPolicyDescriptors)
    ? (task.metadata?.quotaResetExplicitPolicyDescriptors as QuotaResetExplicitPolicyDescriptor[])
    : [];
}

function findClientTarget(inbounds: XrayInbound[], policy: QuotaPolicy) {
  const resourceId = policy.resourceId ?? policy.id.replace(/^customer-node:/, '');
  const [inboundId, clientId] = resourceId.split(':');

  if (!inboundId || !clientId) {
    return undefined;
  }

  const inbound = inbounds.find((item) => item.id === inboundId);
  const client = inbound?.clients.find((item) => item.id === clientId);

  return inbound && client ? { inbound, client } : undefined;
}

function createForwardRuleResetDescriptor(
  policy: QuotaPolicy,
  rule: ForwardRule,
  resetAt: string
): QuotaResetForwardRuleDescriptor {
  return {
    quotaPolicyId: policy.id,
    quotaPolicyName: policy.name,
    resetAt,
    ruleId: rule.id,
    resetDay: rule.monthlyResetDay,
    billingPeriod: rule.trafficBillingPeriod ?? readBillingPeriod(rule.monthlyResetDay, resetAt),
    billingDirection: rule.billingDirection,
    trafficMultiplier: rule.trafficMultiplier,
    quotaBytes: clampBytes(rule.quotaBytes),
    baselineManualUsedBytes: clampBytes(rule.manualUsedBytes),
    baselineInboundBytes: clampBytes(rule.inboundBytes),
    baselineOutboundBytes: clampBytes(rule.outboundBytes),
    baselineBilledTrafficBytes: clampBytes(rule.billedTrafficBytes ?? calculateForwardingBilledBytes(rule)),
    bindings: rule.ports.map((binding) => ({
      agentId: binding.agentId,
      listenAddress: binding.listenAddress,
      listenPort: binding.listenPort,
      targetAddress: binding.targetAddress,
      targetPort: binding.targetPort,
      protocol: binding.protocol,
      runtimeServiceNames: binding.runtimeServiceNames,
      baselineInboundBytes: clampBytes(binding.inboundBytes),
      baselineOutboundBytes: clampBytes(binding.outboundBytes)
    }))
  };
}

export function createQuotaResetTaskInput(policy: QuotaPolicy): CreateTaskInput {
  return {
    operation: 'quota.reset',
    resourceType: 'quota',
    targetId: policy.id,
    targetLabel: policy.name,
    summary: `Reset ${policy.name} quota`,
    metadata: {
      quotaPolicyScope: policy.scope
    },
    riskConfirmation: {
      operation: 'quota.reset',
      targetId: policy.id
    }
  };
}

export function prepareQuotaResetTaskInput({
  agents,
  inbounds,
  forwardRules,
  quotaPolicies,
  nowIso,
  input
}: QuotaResetPreparedInput): CreateTaskInput {
  const policy = quotaPolicies.find((item) => item.id === input.targetId);

  if (!policy) {
    throw new Error(`Quota policy not found: ${input.targetId}`);
  }

  const quotaResetAgentDescriptors: QuotaResetAgentDescriptor[] = [];
  const quotaResetClientDescriptors: QuotaResetClientDescriptor[] = [];
  const quotaResetForwardRuleDescriptors: QuotaResetForwardRuleDescriptor[] = [];
  const quotaResetExplicitPolicyDescriptors: QuotaResetExplicitPolicyDescriptor[] = [];

  if (policy.scope === 'managed-host') {
    const agentId = policy.resourceId ?? policy.id.replace(/^managed-host:/, '');
    const agent = agents.find((item) => item.id === agentId);

    if (!agent) {
      throw new Error(`Managed host quota target not found: ${policy.id}`);
    }

    quotaResetAgentDescriptors.push({
      quotaPolicyId: policy.id,
      quotaPolicyName: policy.name,
      resetAt: nowIso,
      agentId: agent.id,
      resetDay: agent.trafficPolicy.monthlyResetDay,
      billingPeriod: agent.telemetry.trafficBillingPeriod ?? readBillingPeriod(agent.trafficPolicy.monthlyResetDay, nowIso),
      accountingMode: agent.trafficPolicy.accountingMode,
      quotaBytes: clampBytes(agent.telemetry.monthlyTrafficLimitBytes ?? agent.monthlyTrafficLimitBytes),
      baselineManualUsedTrafficBytes: clampBytes(agent.trafficPolicy.manualUsedTrafficBytes),
      baselineMonthlyIngressBytes: clampBytes(agent.telemetry.monthlyIngressBytes),
      baselineMonthlyEgressBytes: clampBytes(agent.telemetry.monthlyEgressBytes),
      baselineMonthlyTrafficUsedBytes: clampBytes(agent.telemetry.monthlyTrafficUsedBytes)
    });
  }

  if (policy.scope === 'customer-node') {
    const target = findClientTarget(inbounds, policy);

    if (!target) {
      throw new Error(`Customer-node quota target not found: ${policy.id}`);
    }

    quotaResetClientDescriptors.push({
      quotaPolicyId: policy.id,
      quotaPolicyName: policy.name,
      resetAt: nowIso,
      inboundId: target.inbound.id,
      clientId: target.client.id,
      clientEmail: target.client.email,
      resetDay: target.client.monthlyResetDay ?? 1,
      billingPeriod: target.client.trafficBillingPeriod ?? readBillingPeriod(target.client.monthlyResetDay ?? 1, nowIso),
      trafficLimitBytes: clampBytes(target.client.trafficLimitBytes),
      baselineManualUsedTrafficBytes: clampBytes(target.client.manualUsedTrafficBytes ?? target.client.usedTrafficBytes),
      baselineUsedTrafficBytes: clampBytes(target.client.usedTrafficBytes),
      baselineUplinkBytes: clampBytes(target.client.uplinkBytes),
      baselineDownlinkBytes: clampBytes(target.client.downlinkBytes)
    });
  }

  if (policy.scope === 'forward-rule') {
    const ruleId = policy.resourceId ?? policy.id.replace(/^forward-rule:/, '');
    const rule = forwardRules.find((item) => item.id === ruleId);

    if (!rule) {
      throw new Error(`Forward-rule quota target not found: ${policy.id}`);
    }

    quotaResetForwardRuleDescriptors.push(createForwardRuleResetDescriptor(policy, rule, nowIso));
  }

  if (policy.scope === 'forwarding-account') {
    const matchingRules = forwardRules.filter((rule) => resolveForwardingAccountPolicyId(rule) === policy.id);

    if (matchingRules.length > 0) {
      quotaResetForwardRuleDescriptors.push(
        ...matchingRules.map((rule) => createForwardRuleResetDescriptor(policy, rule, nowIso))
      );
    }

    quotaResetExplicitPolicyDescriptors.push({
      quotaPolicyId: policy.id,
      quotaPolicyName: policy.name,
      resetAt: nowIso,
      usedBytes: clampBytes(policy.usedBytes)
    });
  }

  if (policy.scope === 'user') {
    quotaResetExplicitPolicyDescriptors.push({
      quotaPolicyId: policy.id,
      quotaPolicyName: policy.name,
      resetAt: nowIso,
      usedBytes: clampBytes(policy.usedBytes)
    });
  }

  return {
    ...input,
    resourceType: 'quota',
    targetId: policy.id,
    targetLabel: policy.name,
    metadata: {
      ...(input.metadata ?? {}),
      quotaPolicyScope: policy.scope,
      quotaPolicyName: policy.name,
      quotaResetAuditBefore: {
        id: policy.id,
        name: policy.name,
        scope: policy.scope,
        resourceId: policy.resourceId,
        usedBytes: clampBytes(policy.usedBytes),
        limitBytes: clampBytes(policy.limitBytes),
        enforcementState: policy.enforcementState,
        reportedAt: policy.reportedAt
      } satisfies QuotaResetAuditSnapshot,
      quotaResetAuditAfter: {
        id: policy.id,
        name: policy.name,
        scope: policy.scope,
        resourceId: policy.resourceId,
        usedBytes: 0,
        limitBytes: clampBytes(policy.limitBytes),
        enforcementState: 'active',
        reportedAt: nowIso
      } satisfies QuotaResetAuditSnapshot,
      quotaResetAgentDescriptors,
      quotaResetClientDescriptors,
      quotaResetForwardRuleDescriptors,
      quotaResetExplicitPolicyDescriptors
    }
  };
}

export function applyQuotaResetTaskToAgents(agents: Agent[], task: DeployTask): Agent[] {
  const descriptors = readQuotaResetAgentDescriptors(task);

  if (descriptors.length === 0) {
    return agents;
  }

  return agents.map((agent) => {
    const descriptor = descriptors.find((item) => item.agentId === agent.id);

    if (!descriptor) {
      return agent;
    }

    const hostExpired = agent.telemetry.hostExpired ?? false;

    return {
      ...agent,
      trafficPolicy: {
        ...agent.trafficPolicy,
        manualUsedTrafficBytes: 0
      },
      telemetry: {
        ...agent.telemetry,
        monthlyIngressBytes: 0,
        monthlyEgressBytes: 0,
        monthlyTrafficUsedBytes: 0,
        trafficBillingPeriod: descriptor.billingPeriod ?? agent.telemetry.trafficBillingPeriod,
        quotaExceeded: false,
        runtimeDisabledByPolicy: hostExpired,
        guardrailReason: hostExpired ? agent.telemetry.guardrailReason ?? 'host_expired' : 'ok',
        reportedAt: task.createdAt
      }
    };
  });
}

export function applyQuotaResetTaskToInbounds(inbounds: XrayInbound[], task: DeployTask): XrayInbound[] {
  const descriptors = readQuotaResetClientDescriptors(task);

  if (descriptors.length === 0) {
    return inbounds;
  }

  return inbounds.map((inbound) => ({
    ...inbound,
    clients: inbound.clients.map((client) => {
      const descriptor = descriptors.find((item) => item.inboundId === inbound.id && item.clientId === client.id);

      if (!descriptor) {
        return client;
      }

      const clientExpired = client.clientExpired ?? false;
      return {
        ...client,
        enabled: clientExpired ? false : true,
        usedTrafficBytes: 0,
        manualUsedTrafficBytes: 0,
        uplinkBytes: 0,
        downlinkBytes: 0,
        lastTrafficSampleAt: task.createdAt,
        trafficBillingPeriod: descriptor.billingPeriod ?? client.trafficBillingPeriod,
        quotaExceeded: false,
        clientExpired,
        runtimeDisabledByPolicy: clientExpired,
        guardrailReason: clientExpired ? client.guardrailReason ?? 'xray_client_expired' : 'ok'
      };
    })
  }));
}

function resetForwardBinding(
  binding: ForwardPortBinding,
  descriptor: QuotaResetForwardRuleDescriptor
): ForwardPortBinding {
  return {
    ...binding,
    inboundBytes: 0,
    outboundBytes: 0,
    lastCounterSampleAt: descriptor.resetAt,
    trafficBillingPeriod: descriptor.billingPeriod ?? binding.trafficBillingPeriod
  };
}

export function applyQuotaResetTaskToForwardRules(forwardRules: ForwardRule[], task: DeployTask): ForwardRule[] {
  const descriptors = readQuotaResetForwardRuleDescriptors(task);

  if (descriptors.length === 0) {
    return forwardRules;
  }

  return forwardRules.map((rule) => {
    const descriptor = descriptors.find((item) => item.ruleId === rule.id);

    if (!descriptor) {
      return rule;
    }

    return {
      ...rule,
      ports: rule.ports.map((binding) => resetForwardBinding(binding, descriptor)),
      manualUsedBytes: 0,
      inboundBytes: 0,
      outboundBytes: 0,
      billedTrafficBytes: 0,
      trafficBillingPeriod: descriptor.billingPeriod ?? rule.trafficBillingPeriod,
      quotaExceeded: false,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok'
    };
  });
}

export function applyQuotaResetTaskToExplicitPolicies(quotaPolicies: QuotaPolicy[], task: DeployTask): QuotaPolicy[] {
  const descriptors = readQuotaResetExplicitPolicyDescriptors(task);

  if (descriptors.length === 0) {
    return quotaPolicies;
  }

  return quotaPolicies.map((policy) => {
    const descriptor = descriptors.find((item) => item.quotaPolicyId === policy.id);

    if (!descriptor) {
      return policy;
    }

    return {
      ...policy,
      usedBytes: 0,
      enforcementState: 'active',
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok',
      reportedAt: descriptor.resetAt
    };
  });
}

export function applyQuotaResetTasksToExplicitPolicies(quotaPolicies: QuotaPolicy[], tasks: DeployTask[]) {
  return tasks.reduce((current, task) => {
    if (task.operation !== 'quota.reset') {
      return current;
    }

    return applyQuotaResetTaskToExplicitPolicies(current, task);
  }, quotaPolicies);
}

export function createQuotaResetReplayState(tasks: DeployTask[]): QuotaResetReplayState {
  const agentsById = new Map<string, QuotaResetAgentDescriptor[]>();
  const clientsByInboundId = new Map<string, QuotaResetClientDescriptor[]>();
  const forwardRulesById = new Map<string, QuotaResetForwardRuleDescriptor[]>();
  const forwardRulesByServiceName = new Map<string, QuotaResetForwardRuleDescriptor[]>();

  for (const task of tasks) {
    if (task.operation !== 'quota.reset') {
      continue;
    }

    for (const descriptor of readQuotaResetAgentDescriptors(task)) {
      const existing = agentsById.get(descriptor.agentId) ?? [];
      agentsById.set(descriptor.agentId, [...existing, descriptor].sort((left, right) => right.resetAt.localeCompare(left.resetAt)));
    }

    for (const descriptor of readQuotaResetClientDescriptors(task)) {
      const existing = clientsByInboundId.get(descriptor.inboundId) ?? [];
      clientsByInboundId.set(
        descriptor.inboundId,
        [...existing, descriptor].sort((left, right) => right.resetAt.localeCompare(left.resetAt))
      );
    }

    for (const descriptor of readQuotaResetForwardRuleDescriptors(task)) {
      const existingByRule = forwardRulesById.get(descriptor.ruleId) ?? [];
      forwardRulesById.set(
        descriptor.ruleId,
        [...existingByRule, descriptor].sort((left, right) => right.resetAt.localeCompare(left.resetAt))
      );

      for (const binding of descriptor.bindings) {
        for (const serviceName of binding.runtimeServiceNames ?? []) {
          const existingByService = forwardRulesByServiceName.get(serviceName) ?? [];
          forwardRulesByServiceName.set(
            serviceName,
            [...existingByService, descriptor].sort((left, right) => right.resetAt.localeCompare(left.resetAt))
          );
        }
      }
    }
  }

  return {
    agentsById,
    clientsByInboundId,
    forwardRulesById,
    forwardRulesByServiceName
  };
}

function readTelemetryPayload(event: AgentEventEnvelope) {
  return event.type === 'telemetry_sample' && event.payload && typeof event.payload === 'object'
    ? ({ ...event.payload } as Record<string, unknown>)
    : undefined;
}

function deriveAgentUsedBytes(
  accountingMode: Agent['trafficPolicy']['accountingMode'],
  manualUsedTrafficBytes: number | undefined,
  monthlyIngressBytes: number | undefined,
  monthlyEgressBytes: number | undefined,
  explicitMonthlyUsedBytes: number | undefined
) {
  if (explicitMonthlyUsedBytes !== undefined) {
    return explicitMonthlyUsedBytes;
  }

  const ingressBytes = clampBytes(monthlyIngressBytes);
  const egressBytes = clampBytes(monthlyEgressBytes);
  const manualBytes = clampBytes(manualUsedTrafficBytes);

  switch (accountingMode) {
    case 'single':
      return Math.max(manualBytes, ingressBytes, egressBytes);
    case 'ingress':
      return Math.max(manualBytes, ingressBytes);
    case 'egress':
      return Math.max(manualBytes, egressBytes);
    case 'both':
    default:
      return Math.max(manualBytes, ingressBytes + egressBytes);
  }
}

function findRelevantAgentReset(state: QuotaResetReplayState, event: AgentEventEnvelope) {
  const descriptors = state.agentsById.get(event.agentId) ?? [];
  const payload = readTelemetryPayload(event);
  const samplePeriod =
    typeof payload?.trafficBillingPeriod === 'string'
      ? payload.trafficBillingPeriod
      : typeof payload?.reportedAt === 'string'
        ? readBillingPeriod(
            typeof payload.monthlyResetDay === 'number' ? Math.max(1, Math.min(31, payload.monthlyResetDay)) : descriptors[0]?.resetDay ?? 1,
            payload.reportedAt
          )
        : undefined;

  return descriptors.find((descriptor) => isSameBillingPeriod(descriptor.resetDay, descriptor.billingPeriod, event.observedAt, samplePeriod));
}

function findRelevantClientReset(
  state: QuotaResetReplayState,
  inboundId: string | undefined,
  clientId: string | undefined,
  clientEmail: string | undefined,
  observedAt: string,
  samplePeriod: string | undefined
) {
  if (!inboundId) {
    return undefined;
  }

  const descriptors = state.clientsByInboundId.get(inboundId) ?? [];

  return descriptors.find(
    (descriptor) =>
      (descriptor.clientId === clientId || (clientEmail && descriptor.clientEmail === clientEmail))
      && isSameBillingPeriod(descriptor.resetDay, descriptor.billingPeriod, observedAt, samplePeriod)
  );
}

function matchesResetBinding(
  descriptor: QuotaResetForwardRuleDescriptor,
  counter: Record<string, unknown>
): QuotaResetBindingDescriptor | undefined {
  const serviceName = typeof counter.serviceName === 'string' ? counter.serviceName : undefined;

  return descriptor.bindings.find((binding) => {
    if (serviceName && binding.runtimeServiceNames?.includes(serviceName)) {
      return true;
    }

    return (
      binding.agentId === counter.agentId
      && binding.listenAddress === counter.listenAddress
      && binding.listenPort === counter.listenPort
      && binding.targetAddress === counter.targetAddress
      && binding.targetPort === counter.targetPort
      && (binding.protocol === 'tcp+udp' || binding.protocol === counter.protocol)
    );
  });
}

function findRelevantForwardRuleReset(
  state: QuotaResetReplayState,
  counter: Record<string, unknown>,
  observedAt: string,
  samplePeriod: string | undefined
) {
  const ruleId = typeof counter.ruleId === 'string' ? counter.ruleId : undefined;
  const serviceName = typeof counter.serviceName === 'string' ? counter.serviceName : undefined;
  const candidates = [
    ...(ruleId ? state.forwardRulesById.get(ruleId) ?? [] : []),
    ...(serviceName ? state.forwardRulesByServiceName.get(serviceName) ?? [] : [])
  ];

  return candidates.find((descriptor) => isSameBillingPeriod(descriptor.resetDay, descriptor.billingPeriod, observedAt, samplePeriod));
}

export function applyQuotaResetStateToAgentEvent(event: AgentEventEnvelope, state: QuotaResetReplayState): AgentEventEnvelope {
  if (event.type !== 'telemetry_sample') {
    return event;
  }

  const payload = readTelemetryPayload(event);
  const descriptor = payload ? findRelevantAgentReset(state, event) : undefined;

  if (!payload || !descriptor) {
    return event;
  }

  const beforeReset = Date.parse(event.observedAt) < Date.parse(descriptor.resetAt);
  const monthlyIngressBytes = beforeReset ? 0 : subtractBaseline(payload.monthlyIngressBytes as number | undefined, descriptor.baselineMonthlyIngressBytes);
  const monthlyEgressBytes = beforeReset ? 0 : subtractBaseline(payload.monthlyEgressBytes as number | undefined, descriptor.baselineMonthlyEgressBytes);
  const manualUsedTrafficBytes = beforeReset
    ? 0
    : subtractBaseline(payload.manualUsedTrafficBytes as number | undefined, descriptor.baselineManualUsedTrafficBytes);
  const explicitMonthlyTrafficUsedBytes = beforeReset
    ? 0
    : subtractBaseline(payload.monthlyTrafficUsedBytes as number | undefined, descriptor.baselineMonthlyTrafficUsedBytes);
  const accountingMode =
    payload.trafficAccountingMode === 'single' || payload.trafficAccountingMode === 'ingress' || payload.trafficAccountingMode === 'egress'
      ? payload.trafficAccountingMode
      : descriptor.accountingMode;
  const hostExpired = payload.hostExpired === true;
  const usedBytes = deriveAgentUsedBytes(
    accountingMode,
    manualUsedTrafficBytes,
    monthlyIngressBytes,
    monthlyEgressBytes,
    explicitMonthlyTrafficUsedBytes
  );
  const quotaExceeded = descriptor.quotaBytes > 0 && usedBytes >= descriptor.quotaBytes;

  return {
    ...event,
    payload: {
      ...payload,
      monthlyIngressBytes,
      monthlyEgressBytes,
      manualUsedTrafficBytes,
      monthlyTrafficUsedBytes: explicitMonthlyTrafficUsedBytes,
      trafficBillingPeriod:
        descriptor.billingPeriod ?? (typeof payload.trafficBillingPeriod === 'string' ? payload.trafficBillingPeriod : undefined),
      quotaExceeded,
      runtimeDisabledByPolicy: hostExpired || quotaExceeded,
      guardrailReason:
        quotaExceeded
          ? 'monthly_traffic_quota_exceeded'
          : hostExpired
            ? typeof payload.guardrailReason === 'string'
              ? payload.guardrailReason
              : 'host_expired'
            : 'ok'
    }
  };
}

export function applyQuotaResetStateToXrayEvent(event: AgentEventEnvelope, state: QuotaResetReplayState): AgentEventEnvelope {
  if (event.type !== 'telemetry_sample') {
    return event;
  }

  const payload = readTelemetryPayload(event);
  const counters = Array.isArray(payload?.xrayClientCounters) ? payload.xrayClientCounters : undefined;

  if (!payload || !counters) {
    return event;
  }

  const nextCounters = counters.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const counter = { ...(item as Record<string, unknown>) };
    const descriptor = findRelevantClientReset(
      state,
      typeof counter.inboundId === 'string' ? counter.inboundId : undefined,
      typeof counter.clientId === 'string' ? counter.clientId : undefined,
      typeof counter.clientEmail === 'string' ? counter.clientEmail : undefined,
      event.observedAt,
      typeof counter.trafficBillingPeriod === 'string' ? counter.trafficBillingPeriod : undefined
    );

    if (!descriptor) {
      return [counter];
    }

    const beforeReset = Date.parse(event.observedAt) < Date.parse(descriptor.resetAt);
    const clientExpired = counter.clientExpired === true;
    const usedTrafficBytes = beforeReset ? 0 : subtractBaseline(counter.usedTrafficBytes as number | undefined, descriptor.baselineUsedTrafficBytes);
    const uplinkBytes = beforeReset ? 0 : subtractBaseline(counter.uplinkBytes as number | undefined, descriptor.baselineUplinkBytes) ?? 0;
    const downlinkBytes = beforeReset ? 0 : subtractBaseline(counter.downlinkBytes as number | undefined, descriptor.baselineDownlinkBytes) ?? 0;
    const adjustedUsedBytes = usedTrafficBytes ?? uplinkBytes + downlinkBytes;
    const quotaExceeded = descriptor.trafficLimitBytes > 0 && adjustedUsedBytes >= descriptor.trafficLimitBytes;

    return [
      {
        ...counter,
        usedTrafficBytes: adjustedUsedBytes,
        uplinkBytes,
        downlinkBytes,
        trafficBillingPeriod: descriptor.billingPeriod ?? counter.trafficBillingPeriod,
        quotaExceeded,
        runtimeDisabledByPolicy: clientExpired || quotaExceeded,
        guardrailReason: quotaExceeded ? 'xray_client_monthly_quota_exceeded' : clientExpired ? 'xray_client_expired' : 'ok'
      }
    ];
  });

  return {
    ...event,
    payload: {
      ...payload,
      xrayClientCounters: nextCounters
    }
  };
}

export function applyQuotaResetStateToForwardingEvent(
  event: AgentEventEnvelope,
  state: QuotaResetReplayState
): AgentEventEnvelope {
  if (event.type !== 'telemetry_sample') {
    return event;
  }

  const payload = readTelemetryPayload(event);
  const counters = Array.isArray(payload?.forwardingCounters) ? payload.forwardingCounters : undefined;
  const guardrails = Array.isArray(payload?.forwardingGuardrails) ? payload.forwardingGuardrails : undefined;

  if (!payload || (!counters && !guardrails)) {
    return event;
  }

  const nextCounters = counters?.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const counter = { ...(item as Record<string, unknown>) };
    const descriptor = findRelevantForwardRuleReset(
      state,
      counter,
      event.observedAt,
      typeof counter.trafficBillingPeriod === 'string' ? counter.trafficBillingPeriod : undefined
    );

    if (!descriptor) {
      return counter;
    }

    const beforeReset = Date.parse(event.observedAt) < Date.parse(descriptor.resetAt);
    const binding = matchesResetBinding(descriptor, counter);

    return {
      ...counter,
      inboundBytes: beforeReset ? 0 : subtractBaseline(counter.inboundBytes as number | undefined, binding?.baselineInboundBytes ?? descriptor.baselineInboundBytes) ?? 0,
      outboundBytes: beforeReset ? 0 : subtractBaseline(counter.outboundBytes as number | undefined, binding?.baselineOutboundBytes ?? descriptor.baselineOutboundBytes) ?? 0,
      trafficBillingPeriod: descriptor.billingPeriod ?? counter.trafficBillingPeriod
    };
  });

  const nextGuardrails = guardrails?.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const guardrail = { ...(item as Record<string, unknown>) };
    const descriptor = findRelevantForwardRuleReset(
      state,
      guardrail,
      event.observedAt,
      typeof guardrail.trafficBillingPeriod === 'string' ? guardrail.trafficBillingPeriod : undefined
    );

    if (!descriptor) {
      return guardrail;
    }

    const beforeReset = Date.parse(event.observedAt) < Date.parse(descriptor.resetAt);
    const billedTrafficBytes = beforeReset
      ? 0
      : subtractBaseline(guardrail.billedTrafficBytes as number | undefined, descriptor.baselineBilledTrafficBytes) ?? 0;
    const quotaBytes = clampBytes((guardrail.quotaBytes as number | undefined) ?? descriptor.quotaBytes);
    const quotaExceeded = quotaBytes > 0 && billedTrafficBytes >= quotaBytes;

    return {
      ...guardrail,
      billedTrafficBytes,
      quotaExceeded,
      runtimeDisabledByPolicy: quotaExceeded,
      guardrailReason: quotaExceeded ? 'rule_monthly_quota_exceeded' : 'ok',
      trafficBillingPeriod: descriptor.billingPeriod ?? guardrail.trafficBillingPeriod
    };
  });

  return {
    ...event,
    payload: {
      ...payload,
      forwardingCounters: nextCounters,
      forwardingGuardrails: nextGuardrails
    }
  };
}
