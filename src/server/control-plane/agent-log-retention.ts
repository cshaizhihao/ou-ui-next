import type { AgentEventEnvelope } from '../../services/api/api-contract';

export const DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT = 5000;

export type AgentLogRetentionPolicy = {
  maxAgeMs: number;
  maxEventsPerAgent: number;
};

export type AgentLogRetentionPruneResult = {
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

export function normalizeAgentLogRetentionPolicy(
  policy: Partial<AgentLogRetentionPolicy> = {}
): AgentLogRetentionPolicy {
  return {
    maxAgeMs: Math.max(1, normalizeFiniteInteger(policy.maxAgeMs, DEFAULT_AGENT_LOG_RETENTION_MAX_AGE_MS)),
    maxEventsPerAgent: Math.max(
      0,
      normalizeFiniteInteger(policy.maxEventsPerAgent, DEFAULT_AGENT_LOG_RETENTION_MAX_EVENTS_PER_AGENT)
    )
  };
}

function compareNewestLogChunks(
  left: Extract<AgentEventEnvelope, { type: 'log_chunk' }>,
  right: Extract<AgentEventEnvelope, { type: 'log_chunk' }>
) {
  const observedDelta = Date.parse(right.observedAt) - Date.parse(left.observedAt);
  return observedDelta || right.seq - left.seq || right.payload.chunkSeq - left.payload.chunkSeq;
}

export function pruneAgentLogEvents(
  events: AgentEventEnvelope[],
  policyInput: Partial<AgentLogRetentionPolicy>,
  now: string
) {
  const policy = normalizeAgentLogRetentionPolicy(policyInput);
  const nowMs = Date.parse(now);
  const cutoffMs = Number.isNaN(nowMs) ? Number.NEGATIVE_INFINITY : nowMs - policy.maxAgeMs;
  const logChunksByAgent = new Map<string, Array<Extract<AgentEventEnvelope, { type: 'log_chunk' }>>>();

  for (const event of events) {
    if (event.type !== 'log_chunk') {
      continue;
    }

    const observedMs = Date.parse(event.observedAt);

    if (!Number.isNaN(observedMs) && observedMs < cutoffMs) {
      continue;
    }

    const existing = logChunksByAgent.get(event.agentId) ?? [];
    existing.push(event);
    logChunksByAgent.set(event.agentId, existing);
  }

  const retainedLogEventIds = new Set<string>();

  for (const agentLogChunks of logChunksByAgent.values()) {
    agentLogChunks.sort(compareNewestLogChunks);

    for (const event of agentLogChunks.slice(0, policy.maxEventsPerAgent)) {
      retainedLogEventIds.add(event.eventId);
    }
  }

  const nextEvents = events.filter((event) => event.type !== 'log_chunk' || retainedLogEventIds.has(event.eventId));

  return {
    events: nextEvents,
    result: {
      removed: events.length - nextEvents.length,
      retained: retainedLogEventIds.size,
      cutoffObservedAt: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : ''
    }
  };
}
