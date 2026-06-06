export type BillingDirection = 'both' | 'single' | 'ingress' | 'egress';
export type RateLimitMode = 'one-way' | 'bi-directional';
export type RateLimitDirection = 'both' | 'ingress' | 'egress';

export type QuotaEnforcementState = 'active' | 'exceeded' | 'disabled_by_quota' | 'reset_pending';

export type QuotaPolicyScope = 'user' | 'managed-host' | 'customer-node' | 'forwarding-account' | 'tunnel' | 'forward-rule';

export type QuotaResetWindow = 'daily' | 'weekly' | 'monthly' | 'manual';

export type QuotaPolicy = {
  id: string;
  name: string;
  scope: QuotaPolicyScope;
  limitBytes: number;
  usedBytes: number;
  resetWindow: QuotaResetWindow;
  billingDirection: BillingDirection;
  enforcementState: QuotaEnforcementState;
  resourceId?: string;
  detail?: string;
  resetDay?: number;
  reportedAt?: string;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
  sourceCount?: number;
};

export type RateLimitPolicy = {
  id: string;
  name: string;
  inboundMbps: number;
  outboundMbps: number;
  mode: RateLimitMode;
};

export type TrafficCounter = {
  resourceId: string;
  ingressBytes: number;
  egressBytes: number;
  sampledAt: string;
};
