import type { TrafficRollup } from '../../domain';

export const DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_AGE_MS = 62 * 24 * 60 * 60 * 1000;
export const DEFAULT_TRAFFIC_ROLLUP_RETENTION_MAX_RECORDS_PER_SCOPE = 200_000;

export type TrafficRollupRetentionPolicy = {
  maxAgeMs: number;
  maxRecordsPerScope: number;
};

export type TrafficRollupRetentionPruneResult = {
  removed: number;
  retained: number;
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

  return {
    rollups: nextRollups,
    result: {
      removed: rollups.length - nextRollups.length,
      retained: retainedRollupIds.size,
      cutoffObservedAt: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : ''
    }
  };
}
