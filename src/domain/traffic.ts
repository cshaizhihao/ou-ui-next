export type TrafficRollupDimension = 'agent' | 'forward-rule' | 'xray-client';

export type TrafficRollupSource = 'agent-telemetry';

export type TrafficRollupAccountingMode = 'both' | 'single' | 'ingress' | 'egress';

export type TrafficRollup = {
  id: string;
  dimension: TrafficRollupDimension;
  subjectId: string;
  subjectLabel: string;
  agentId: string;
  observedAt: string;
  sampledAt: string;
  periodKey: string;
  monthlyResetDay: number;
  accountingMode: TrafficRollupAccountingMode;
  ingressBytes: number;
  egressBytes: number;
  meteredBytes: number;
  source: TrafficRollupSource;
  metadata?: Record<string, string | number | boolean>;
};

export function calculateTrafficRollupMeteredBytes(
  accountingMode: TrafficRollupAccountingMode,
  ingressBytes: number,
  egressBytes: number
) {
  switch (accountingMode) {
    case 'single':
      return Math.max(ingressBytes, egressBytes);
    case 'ingress':
      return ingressBytes;
    case 'egress':
      return egressBytes;
    case 'both':
    default:
      return ingressBytes + egressBytes;
  }
}
