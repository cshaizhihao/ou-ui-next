import type { TrafficRollup, TrafficRollupCompaction } from '../../domain';

export const DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS = 62 * 24 * 60 * 60 * 1000;
export const DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE = 200_000;

export type TrafficRollupRetentionPolicy = {
  maxAgeMs: number;
  maxRecordsPerScope: number;
};

export type TrafficRollupRetentionPruneResult = {
  removed: number;
  retained: number;
  compacted: number;
  cutoffObservedAt: string;
};

function normalizeFiniteInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.trunc(value);
}

export function normalizeTrafficRollupRetentionPolicy(
  policy: Partial<TrafficRollupRetentionPolicy> = {}
): TrafficRollupRetentionPolicy {
  return {
    maxAgeMs: Math.max(1, normalizeFiniteInteger(policy.maxAgeMs, DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS)),
    maxRecordsPerScope: Math.max(
      0,
      normalizeFiniteInteger(policy.maxRecordsPerScope, DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE)
    )
  };
}

function readTrafficRollupScope(rollup: TrafficRollup) {
  return `${rollup.dimension}:${rollup.agentId}:${rollup.subjectId}`;
}

function compareNewestTrafficRollups(left: TrafficRollup, right: TrafficRollup) {
  const observedDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
  return observedDelta || left.id.localeCompare(right.id);
}

function readNonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function readTimestampMs(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const timestampMs = Date.parse(value);
  return Number.isNaN(timestampMs) ? undefined : timestampMs;
}

function minTimestampIso(left: string, right: string) {
  const leftMs = readTimestampMs(left);
  const rightMs = readTimestampMs(right);

  if (leftMs === undefined) {
    return right;
  }

  if (rightMs === undefined) {
    return left;
  }

  return new Date(Math.min(leftMs, rightMs)).toISOString();
}

function maxTimestampIso(left: string, right: string) {
  const leftMs = readTimestampMs(left);
  const rightMs = readTimestampMs(right);

  if (leftMs === undefined) {
    return right;
  }

  if (rightMs === undefined) {
    return left;
  }

  return new Date(Math.max(leftMs, rightMs)).toISOString();
}

function createDailyBucketStartAt(rollup: TrafficRollup) {
  const sampledAtMs = readTimestampMs(rollup.sampledAt) ?? readTimestampMs(rollup.observedAt);

  if (sampledAtMs === undefined) {
    return undefined;
  }

  const date = new Date(sampledAtMs);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function createDailyBucketEndAt(bucketStartAt: string) {
  const bucketStartAtMs = Date.parse(bucketStartAt);
  return Number.isNaN(bucketStartAtMs)
    ? bucketStartAt
    : new Date(bucketStartAtMs + 24 * 60 * 60 * 1000).toISOString();
}

function createCompactionId(input: Pick<TrafficRollupCompaction, 'dimension' | 'agentId' | 'subjectId' | 'periodKey' | 'bucketStartAt'>) {
  return [
    'traffic-compaction',
    input.dimension,
    input.agentId,
    input.subjectId,
    input.periodKey,
    input.bucketStartAt.slice(0, 10)
  ].map(encodeURIComponent).join(':');
}

function compareNewestTrafficRollupCompactions(left: TrafficRollupCompaction, right: TrafficRollupCompaction) {
  const bucketDelta = Date.parse(right.bucketStartAt) - Date.parse(left.bucketStartAt);
  return bucketDelta || right.id.localeCompare(left.id);
}

export function compactTrafficRollups(rollups: TrafficRollup[], compactedAt: string): TrafficRollupCompaction[] {
  const compactions = new Map<string, TrafficRollupCompaction>();

  for (const rollup of rollups) {
    const bucketStartAt = createDailyBucketStartAt(rollup);

    if (!bucketStartAt) {
      continue;
    }

    const observedAt = new Date(readTimestampMs(rollup.observedAt) ?? Date.parse(bucketStartAt)).toISOString();
    const sampledAt = new Date(readTimestampMs(rollup.sampledAt) ?? Date.parse(observedAt)).toISOString();
    const base = {
      dimension: rollup.dimension,
      agentId: rollup.agentId,
      subjectId: rollup.subjectId,
      periodKey: rollup.periodKey,
      bucketStartAt
    };
    const id = createCompactionId(base);
    const current = compactions.get(id);

    if (!current) {
      compactions.set(id, {
        id,
        granularity: 'day',
        ...base,
        subjectLabel: rollup.subjectLabel,
        bucketEndAt: createDailyBucketEndAt(bucketStartAt),
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        firstSampledAt: sampledAt,
        lastSampledAt: sampledAt,
        sampleCount: 1,
        ingressBytesTotal: readNonNegativeInteger(rollup.ingressBytes),
        egressBytesTotal: readNonNegativeInteger(rollup.egressBytes),
        meteredBytesTotal: readNonNegativeInteger(rollup.meteredBytes),
        compactedAt,
        source: 'retention-prune'
      });
      continue;
    }

    compactions.set(id, {
      ...current,
      subjectLabel: rollup.subjectLabel || current.subjectLabel,
      firstObservedAt: minTimestampIso(current.firstObservedAt, observedAt),
      lastObservedAt: maxTimestampIso(current.lastObservedAt, observedAt),
      firstSampledAt: minTimestampIso(current.firstSampledAt, sampledAt),
      lastSampledAt: maxTimestampIso(current.lastSampledAt, sampledAt),
      sampleCount: current.sampleCount + 1,
      ingressBytesTotal: current.ingressBytesTotal + readNonNegativeInteger(rollup.ingressBytes),
      egressBytesTotal: current.egressBytesTotal + readNonNegativeInteger(rollup.egressBytes),
      meteredBytesTotal: current.meteredBytesTotal + readNonNegativeInteger(rollup.meteredBytes),
      compactedAt: maxTimestampIso(current.compactedAt, compactedAt)
    });
  }

  return [...compactions.values()].sort(compareNewestTrafficRollupCompactions);
}

export function mergeTrafficRollupCompactions(
  existingCompactions: TrafficRollupCompaction[],
  nextCompactions: TrafficRollupCompaction[]
) {
  const merged = new Map<string, TrafficRollupCompaction>();

  for (const compaction of existingCompactions) {
    merged.set(compaction.id, { ...compaction });
  }

  for (const compaction of nextCompactions) {
    const current = merged.get(compaction.id);

    if (!current) {
      merged.set(compaction.id, { ...compaction });
      continue;
    }

    merged.set(compaction.id, {
      ...current,
      subjectLabel: compaction.subjectLabel || current.subjectLabel,
      firstObservedAt: minTimestampIso(current.firstObservedAt, compaction.firstObservedAt),
      lastObservedAt: maxTimestampIso(current.lastObservedAt, compaction.lastObservedAt),
      firstSampledAt: minTimestampIso(current.firstSampledAt, compaction.firstSampledAt),
      lastSampledAt: maxTimestampIso(current.lastSampledAt, compaction.lastSampledAt),
      sampleCount: current.sampleCount + compaction.sampleCount,
      ingressBytesTotal: current.ingressBytesTotal + compaction.ingressBytesTotal,
      egressBytesTotal: current.egressBytesTotal + compaction.egressBytesTotal,
      meteredBytesTotal: current.meteredBytesTotal + compaction.meteredBytesTotal,
      compactedAt: maxTimestampIso(current.compactedAt, compaction.compactedAt)
    });
  }

  return [...merged.values()].sort(compareNewestTrafficRollupCompactions);
}

export function pruneTrafficRollups(
  rollups: TrafficRollup[],
  policyInput: Partial<TrafficRollupRetentionPolicy>,
  now: string
) {
  const policy = normalizeTrafficRollupRetentionPolicy(policyInput);
  const nowMs = Date.parse(now);
  const cutoffMs = Number.isNaN(nowMs) ? Number.NEGATIVE_INFINITY : nowMs - policy.maxAgeMs;
  const rollupsByScope = new Map<string, TrafficRollup[]>();

  for (const rollup of rollups) {
    const observedMs = Date.parse(rollup.observedAt);

    if (!Number.isNaN(observedMs) && observedMs < cutoffMs) {
      continue;
    }

    const scope = readTrafficRollupScope(rollup);
    const existing = rollupsByScope.get(scope) ?? [];
    existing.push(rollup);
    rollupsByScope.set(scope, existing);
  }

  const retainedRollupIds = new Set<string>();

  for (const scopeRollups of rollupsByScope.values()) {
    scopeRollups.sort(compareNewestTrafficRollups);

    for (const rollup of scopeRollups.slice(0, policy.maxRecordsPerScope)) {
      retainedRollupIds.add(rollup.id);
    }
  }

  const nextRollups = rollups.filter((rollup) => retainedRollupIds.has(rollup.id));
  const removedRollups = rollups.filter((rollup) => !retainedRollupIds.has(rollup.id));
  const compactions = compactTrafficRollups(removedRollups, now);

  return {
    rollups: nextRollups,
    removedRollups,
    compactions,
    result: {
      removed: rollups.length - nextRollups.length,
      retained: retainedRollupIds.size,
      compacted: compactions.reduce((total, compaction) => total + compaction.sampleCount, 0),
      cutoffObservedAt: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : ''
    }
  };
}
