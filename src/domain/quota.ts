export type BillingDirection = 'both' | 'single' | 'ingress' | 'egress';

export type QuotaEnforcementState = 'active' | 'exceeded' | 'disabled_by_quota' | 'reset_pending';

export type QuotaPolicy = {
  id: string;
  name: string;
  scope: 'user' | 'tunnel' | 'tunnel-account' | 'forward-rule';
  limitBytes: number;
  usedBytes: number;
  resetWindow: 'daily' | 'monthly' | 'manual';
  billingDirection: BillingDirection;
  enforcementState: QuotaEnforcementState;
};

export type RateLimitPolicy = {
  id: string;
  name: string;
  inboundMbps: number;
  outboundMbps: number;
  mode: 'one-way' | 'bi-directional';
};

export type TrafficCounter = {
  resourceId: string;
  ingressBytes: number;
  egressBytes: number;
  sampledAt: string;
};
