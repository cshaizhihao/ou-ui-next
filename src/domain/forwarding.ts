import type { BillingDirection } from './quota';

export type ForwardProtocol = 'tcp' | 'udp' | 'tcp+udp';

export type PortAllocationStatus = 'allocated' | 'conflict' | 'releasing' | 'failed';

export type ForwardStrategy = 'fifo' | 'round-robin' | 'least-latency' | 'weighted';

export type TunnelMode = 'direct' | 'relay' | 'encrypted';

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
  quotaBytes?: number;
  rateLimitMbps?: number;
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
};
