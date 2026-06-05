export type TrafficRollupDimension = 'agent' | 'forward-rule' | 'xray-client';

export type TrafficRollupSource = 'agent-telemetry';

export type TrafficRollupAccountingMode = 'both' | 'single' | 'ingress' | 'egress';

export type TrafficRollupCompactionGranularity = 'day';

export type TrafficRollupCompactionSource = 'retention-prune';

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

export type TrafficRollupCompaction = {
  id: string;
  granularity: TrafficRollupCompactionGranularity;
  dimension: TrafficRollupDimension;
  subjectId: string;
  subjectLabel: string;
  agentId: string;
  periodKey: string;
  bucketStartAt: string;
  bucketEndAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  firstSampledAt: string;
  lastSampledAt: string;
  sampleCount: number;
  ingressBytesTotal: number;
  egressBytesTotal: number;
  meteredBytesTotal: number;
  compactedAt: string;
  source: TrafficRollupCompactionSource;
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
