import type { BillingDirection, RateLimitDirection, RateLimitMode } from './quota';

export type ForwardProtocol = 'tcp' | 'udp' | 'tcp+udp';

export type PortAllocationStatus = 'deploying' | 'allocated' | 'paused' | 'conflict' | 'releasing' | 'failed';

export type ForwardStrategy = 'fifo' | 'round-robin' | 'least-latency' | 'weighted';

export type TunnelMode = 'direct';

export type TunnelType = 'port-forward' | 'relay-chain';

export const FORWARDING_RUNTIME_SUPPORTED_CONTROLS = [
  'listenAddress',
  'listenPort',
  'targetAddress',
  'targetPort',
  'protocol',
  'rateLimitMbps',
  'rateLimitMode',
  'rateLimitDirection',
  'quotaGb',
  'monthlyResetDay',
  'nftablesTrafficCounters'
] as const;

export const FORWARDING_RUNTIME_BLOCKED_CONTROLS = [
  'ipRateLimitMbps',
  'maxConnections',
  'maxConnectionsPerIp',
  'proxyProtocol'
] as const;

export type ForwardingRuntimeSupportedControl = (typeof FORWARDING_RUNTIME_SUPPORTED_CONTROLS)[number];
export type ForwardingRuntimeBlockedControl = (typeof FORWARDING_RUNTIME_BLOCKED_CONTROLS)[number];

export type ForwardingRuntimeControlMetadata = {
  ipRateLimitMbps?: number;
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  proxyProtocol?: boolean;
  blockedRuntimeControls?: ForwardingRuntimeBlockedControl[];
  blockedRuntimeControlValues?: Partial<
    Record<'ipRateLimitMbps' | 'maxConnections' | 'maxConnectionsPerIp', number> & {
      proxyProtocol: boolean;
    }
  >;
};

export type ForwardingRuntimeDiagnosisState = 'ready' | 'waiting' | 'degraded' | 'blocked' | 'failed';

export type ForwardingRuntimeDiagnosisReason =
  | 'rule-disabled'
  | 'no-entry-binding'
  | 'no-runtime-service'
  | 'deploying'
  | 'paused'
  | 'releasing'
  | 'port-conflict'
  | 'runtime-apply-failed'
  | 'quota-exceeded'
  | 'runtime-disabled-by-policy'
  | 'guardrail'
  | 'blocked-runtime-controls'
  | 'missing-traffic-counters';

export type ForwardingRuntimeDiagnosisAction =
  | 'apply'
  | 'resume'
  | 'pause'
  | 'repair'
  | 'inspect-agent'
  | 'resolve-conflict'
  | 'reset-quota'
  | 'enable-rule';

export type ForwardingRuntimeDiagnosis = {
  state: ForwardingRuntimeDiagnosisState;
  reasons: ForwardingRuntimeDiagnosisReason[];
  blockedControls: ForwardingRuntimeBlockedControl[];
  nextActions: ForwardingRuntimeDiagnosisAction[];
  hasRuntimeEvidence: boolean;
  impactedBindingCount: number;
};

type ForwardingRuntimeDiagnosticRule = Pick<
  ForwardRule,
  | 'enabled'
  | 'ports'
  | 'portStatus'
  | 'ipRateLimitMbps'
  | 'maxConnections'
  | 'maxConnectionsPerIp'
  | 'proxyProtocol'
  | 'quotaExceeded'
  | 'runtimeDisabledByPolicy'
  | 'guardrailReason'
>;

export type TunnelChainHop = {
  agentId: string;
  region: string;
  protocol: ForwardProtocol;
  address: string;
  latencyMs: number;
};

export type Tunnel = {
  id: string;
  name: string;
  accountId: string;
  type: TunnelType;
  status: 'active' | 'paused' | 'degraded' | 'deploying';
  resourceVersion?: string;
  entryAgentIds: string[];
  exitAgentIds: string[];
  chain: TunnelChainHop[];
  trafficRatio: number;
  protocol: ForwardProtocol;
  inAddress: string;
  ipPreference: 'ipv4' | 'ipv6' | 'auto';
  probeTargetHost: string;
  probeTargetPort: number;
  quotaPolicyId: string;
  rateLimitPolicyId: string;
};

export type ForwardPortBinding = {
  agentId: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  protocol: ForwardProtocol;
  status: PortAllocationStatus;
  runtimeServiceNames?: string[];
  inboundBytes?: number;
  outboundBytes?: number;
  lastCounterSampleAt?: string;
  counterSource?: 'agent' | 'nftables' | 'gost';
  trafficBillingPeriod?: string;
};

export type ForwardRule = {
  id: string;
  tunnelId: string;
  name: string;
  ownerName: string;
  strategy: ForwardStrategy;
  resourceVersion?: string;
  enabled: boolean;
  ports: ForwardPortBinding[];
  portStatus: PortAllocationStatus;
  billingDirection: BillingDirection;
  trafficMultiplier: number;
  monthlyResetDay: number;
  manualUsedBytes: number;
  quotaBytes?: number;
  rateLimitMbps?: number;
  rateLimitMode: RateLimitMode;
  rateLimitDirection: RateLimitDirection;
  ipRateLimitMbps?: number;
  quotaPolicyId: string;
  rateLimitPolicyId: string;
  ipRateLimitPolicyId?: string;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
  tunnelMode: TunnelMode;
  pricePerGb: number;
  inboundBytes: number;
  outboundBytes: number;
  billedTrafficBytes?: number;
  trafficBillingPeriod?: string;
  quotaExceeded?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
};

export function collectBlockedForwardingRuntimeControls(
  rule: ForwardingRuntimeControlMetadata
): ForwardingRuntimeBlockedControl[] {
  const blockedControls: ForwardingRuntimeBlockedControl[] = [];

  if ((rule.ipRateLimitMbps ?? 0) > 0) {
    blockedControls.push('ipRateLimitMbps');
  }

  if ((rule.maxConnections ?? 0) > 0) {
    blockedControls.push('maxConnections');
  }

  if ((rule.maxConnectionsPerIp ?? 0) > 0) {
    blockedControls.push('maxConnectionsPerIp');
  }

  if (rule.proxyProtocol) {
    blockedControls.push('proxyProtocol');
  }

  return blockedControls;
}

export function normalizeBlockedForwardingRuntimeControls<T extends ForwardingRuntimeControlMetadata>(
  metadata: T
): T & {
  ipRateLimitMbps: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
} {
  const blockedRuntimeControls = metadata.blockedRuntimeControls ?? collectBlockedForwardingRuntimeControls(metadata);
  const blockedRuntimeControlValues =
    metadata.blockedRuntimeControlValues ??
    (blockedRuntimeControls.length > 0
      ? {
          ipRateLimitMbps: metadata.ipRateLimitMbps,
          maxConnections: metadata.maxConnections,
          maxConnectionsPerIp: metadata.maxConnectionsPerIp,
          proxyProtocol: metadata.proxyProtocol
        }
      : undefined);

  return {
    ...metadata,
    ipRateLimitMbps: 0,
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    ...(blockedRuntimeControls.length > 0
      ? {
          blockedRuntimeControls,
          blockedRuntimeControlValues
        }
      : {})
  };
}

function uniqueForwardingDiagnosisReasons(reasons: ForwardingRuntimeDiagnosisReason[]) {
  return Array.from(new Set(reasons));
}

function uniqueForwardingDiagnosisActions(actions: ForwardingRuntimeDiagnosisAction[]) {
  return Array.from(new Set(actions));
}

export function diagnoseForwardingRuntime(rule: ForwardingRuntimeDiagnosticRule): ForwardingRuntimeDiagnosis {
  const reasons: ForwardingRuntimeDiagnosisReason[] = [];
  const actions: ForwardingRuntimeDiagnosisAction[] = [];
  const blockedControls = collectBlockedForwardingRuntimeControls(rule);
  const hasRuntimeEvidence = rule.ports.some((binding) => (binding.runtimeServiceNames ?? []).length > 0);
  const impactedBindingCount = rule.ports.filter((binding) => binding.status !== 'allocated').length;
  const hasBindingConflict = rule.ports.some((binding) => binding.status === 'conflict');
  const hasBindingFailure = rule.ports.some((binding) => binding.status === 'failed');
  const hasBindingDeploying = rule.ports.some((binding) => binding.status === 'deploying');
  const hasBindingPaused = rule.ports.some((binding) => binding.status === 'paused');
  const hasBindingReleasing = rule.ports.some((binding) => binding.status === 'releasing');

  if (!rule.enabled) {
    reasons.push('rule-disabled');
    actions.push('enable-rule');
  }

  if (rule.ports.length === 0) {
    reasons.push('no-entry-binding');
    actions.push('apply');
  }

  if (!hasRuntimeEvidence) {
    reasons.push('no-runtime-service');
    actions.push('apply');
  }

  if (blockedControls.length > 0) {
    reasons.push('blocked-runtime-controls');
    actions.push('inspect-agent');
  }

  if (rule.quotaExceeded) {
    reasons.push('quota-exceeded');
    actions.push('reset-quota');
  }

  if (rule.runtimeDisabledByPolicy) {
    reasons.push('runtime-disabled-by-policy');
    actions.push('resume');
  }

  if (rule.guardrailReason) {
    reasons.push('guardrail');
    actions.push('inspect-agent');
  }

  if (rule.portStatus === 'conflict' || hasBindingConflict) {
    reasons.push('port-conflict');
    actions.push('resolve-conflict');
  }

  if (rule.portStatus === 'failed' || hasBindingFailure) {
    reasons.push('runtime-apply-failed');
    actions.push('repair', 'inspect-agent');
  }

  if (rule.portStatus === 'deploying' || hasBindingDeploying) {
    reasons.push('deploying');
    actions.push('inspect-agent');
  }

  if (rule.portStatus === 'paused' || hasBindingPaused) {
    reasons.push('paused');
    actions.push('resume');
  }

  if (rule.portStatus === 'releasing' || hasBindingReleasing) {
    reasons.push('releasing');
    actions.push('inspect-agent');
  }

  const bindingsWithCounters = rule.ports.filter(
    (binding) => (binding.inboundBytes ?? 0) > 0 || (binding.outboundBytes ?? 0) > 0 || Boolean(binding.lastCounterSampleAt)
  );

  if (hasRuntimeEvidence && rule.enabled && rule.portStatus === 'allocated' && bindingsWithCounters.length === 0) {
    reasons.push('missing-traffic-counters');
    actions.push('inspect-agent');
  }

  const state: ForwardingRuntimeDiagnosisState =
    rule.portStatus === 'failed' || hasBindingFailure
      ? 'failed'
      : rule.portStatus === 'conflict' ||
          hasBindingConflict ||
          rule.runtimeDisabledByPolicy ||
          rule.quotaExceeded ||
          Boolean(rule.guardrailReason)
        ? 'blocked'
        : blockedControls.length > 0 || reasons.includes('missing-traffic-counters')
          ? 'degraded'
          : !rule.enabled ||
              rule.ports.length === 0 ||
              !hasRuntimeEvidence ||
              ['deploying', 'paused', 'releasing'].includes(rule.portStatus) ||
              hasBindingDeploying ||
              hasBindingPaused ||
              hasBindingReleasing
            ? 'waiting'
            : 'ready';

  if (state === 'ready' && actions.length === 0) {
    actions.push('pause');
  }

  return {
    state,
    reasons: uniqueForwardingDiagnosisReasons(reasons),
    blockedControls,
    nextActions: uniqueForwardingDiagnosisActions(actions),
    hasRuntimeEvidence,
    impactedBindingCount
  };
}

export function calculateForwardingMeteredBytes(rule: Pick<ForwardRule, 'billingDirection' | 'inboundBytes' | 'outboundBytes'>) {
  switch (rule.billingDirection) {
    case 'single':
      return Math.max(rule.inboundBytes, rule.outboundBytes);
    case 'ingress':
      return rule.inboundBytes;
    case 'egress':
      return rule.outboundBytes;
    case 'both':
    default:
      return rule.inboundBytes + rule.outboundBytes;
  }
}

export function calculateForwardingBilledBytes(
  rule: Pick<
    ForwardRule,
    'billingDirection' | 'inboundBytes' | 'outboundBytes' | 'manualUsedBytes' | 'trafficMultiplier'
  >,
  fallbackBytes = 0
) {
  const manualUsedBytes = Number.isFinite(rule.manualUsedBytes) ? Math.max(rule.manualUsedBytes, 0) : 0;
  const multiplier = Number.isFinite(rule.trafficMultiplier) ? Math.max(rule.trafficMultiplier, 0) : 1;
  const meteredBytes = calculateForwardingMeteredBytes(rule) * multiplier;
  const calculatedBytes = Math.round(manualUsedBytes + meteredBytes);

  return calculatedBytes > 0 ? calculatedBytes : Math.max(fallbackBytes, 0);
}

export function isForwardingQuotaExceeded(rule: Pick<ForwardRule, 'quotaBytes' | 'billingDirection' | 'inboundBytes' | 'outboundBytes' | 'manualUsedBytes' | 'trafficMultiplier'>) {
  const quotaBytes = Number.isFinite(rule.quotaBytes) ? rule.quotaBytes ?? 0 : 0;

  return quotaBytes > 0 && calculateForwardingBilledBytes(rule) >= quotaBytes;
}
