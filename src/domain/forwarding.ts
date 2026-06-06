import type { BillingDirection, RateLimitDirection, RateLimitMode } from './quota';

export type ForwardProtocol = 'tcp' | 'udp' | 'tcp+udp';

export type PortAllocationStatus = 'deploying' | 'allocated' | 'paused' | 'conflict' | 'releasing' | 'failed';

export type ForwardStrategy = 'fifo' | 'round-robin' | 'least-latency' | 'weighted';

export type TunnelMode = 'direct';

export type TunnelType = 'port-forward' | 'relay-chain';

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
