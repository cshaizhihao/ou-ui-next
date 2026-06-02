import type { BillingDirection } from './quota';

export type ForwardProtocol = 'tcp' | 'udp' | 'tcp+udp';

export type PortAllocationStatus = 'allocated' | 'conflict' | 'releasing' | 'failed';

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
  status: 'active' | 'paused' | 'degraded' | 'deploying';
  chain: TunnelChainHop[];
  quotaPolicyId: string;
  rateLimitPolicyId: string;
};

export type ForwardPortBinding = {
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  protocol: ForwardProtocol;
  status: PortAllocationStatus;
};

export type ForwardRule = {
  id: string;
  tunnelId: string;
  name: string;
  resourceVersion?: string;
  enabled: boolean;
  ports: ForwardPortBinding[];
  portStatus: PortAllocationStatus;
  billingDirection: BillingDirection;
  trafficMultiplier: number;
  quotaPolicyId: string;
  rateLimitPolicyId: string;
  tunnelMode: 'direct' | 'relay' | 'encrypted';
  pricePerGb: number;
};
