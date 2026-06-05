import { createHash } from 'node:crypto';
import type { AgentEventEnvelope } from '../../services/api/api-contract';
import type { AgentLogArchive } from '../../domain';

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
  archived: number;
  archiveBuckets: number;
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

function readTimestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
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

function createDailyBucketStartAt(event: Extract<AgentEventEnvelope, { type: 'log_chunk' }>) {
  const observedMs = readTimestampMs(event.observedAt);

  if (observedMs === undefined) {
    return undefined;
  }

  const observedAt = new Date(observedMs);
  return new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate())).toISOString();
}

function createDailyBucketEndAt(bucketStartAt: string) {
  const bucketStartMs = readTimestampMs(bucketStartAt) ?? 0;
  return new Date(bucketStartMs + 24 * 60 * 60 * 1000).toISOString();
}

function createArchiveId(input: Pick<AgentLogArchive, 'agentId' | 'taskId' | 'commandId' | 'stream' | 'bucketStartAt'>) {
  const hash = createHash('sha256')
    .update([input.agentId, input.taskId, input.commandId, input.stream, input.bucketStartAt].join('\0'))
    .digest('hex')
    .slice(0, 24);

  return `agent-log-archive-${hash}`;
}

function hashLogChunkContent(event: Extract<AgentEventEnvelope, { type: 'log_chunk' }>) {
  return createHash('sha256')
    .update(event.eventId)
    .update('\0')
    .update(event.payload.content)
    .digest('hex');
}

function combineContentHashes(left: string, right: string) {
  return createHash('sha256').update(left).update('\0').update(right).digest('hex');
}

function compareNewestAgentLogArchives(left: AgentLogArchive, right: AgentLogArchive) {
  const bucketDelta = Date.parse(right.bucketStartAt) - Date.parse(left.bucketStartAt);
  return bucketDelta || right.lastSeq - left.lastSeq || right.id.localeCompare(left.id);
}

function mergeSessionIds(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter((value) => value.trim() !== ''))).sort();
}

export function compactAgentLogEvents(
  events: Array<Extract<AgentEventEnvelope, { type: 'log_chunk' }>>,
  archivedAt: string
): AgentLogArchive[] {
  const archives = new Map<string, AgentLogArchive>();

  for (const event of events) {
    const bucketStartAt = createDailyBucketStartAt(event);

    if (!bucketStartAt) {
      continue;
    }

    const observedAt = new Date(readTimestampMs(event.observedAt) ?? Date.parse(bucketStartAt)).toISOString();
    const base = {
      agentId: event.agentId,
      taskId: event.taskId,
      commandId: event.commandId,
      stream: event.payload.stream,
      bucketStartAt
    };
    const id = createArchiveId(base);
    const current = archives.get(id);
    const contentBytes = Buffer.byteLength(event.payload.content, 'utf8');
    const contentHash = hashLogChunkContent(event);

    if (!current) {
      archives.set(id, {
        id,
        ...base,
        sessionIds: [event.sessionId],
        bucketEndAt: createDailyBucketEndAt(bucketStartAt),
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        firstSeq: event.seq,
        lastSeq: event.seq,
        firstChunkSeq: event.payload.chunkSeq,
        lastChunkSeq: event.payload.chunkSeq,
        chunkCount: 1,
        contentBytes,
        contentSha256: contentHash,
        archivedAt,
        source: 'retention-prune'
      });
      continue;
    }

    archives.set(id, {
      ...current,
      sessionIds: mergeSessionIds(current.sessionIds, [event.sessionId]),
      firstObservedAt: minTimestampIso(current.firstObservedAt, observedAt),
      lastObservedAt: maxTimestampIso(current.lastObservedAt, observedAt),
      firstSeq: Math.min(current.firstSeq, event.seq),
      lastSeq: Math.max(current.lastSeq, event.seq),
      firstChunkSeq: Math.min(current.firstChunkSeq, event.payload.chunkSeq),
      lastChunkSeq: Math.max(current.lastChunkSeq, event.payload.chunkSeq),
      chunkCount: current.chunkCount + 1,
      contentBytes: current.contentBytes + contentBytes,
      contentSha256: combineContentHashes(current.contentSha256, contentHash),
      archivedAt: maxTimestampIso(current.archivedAt, archivedAt)
    });
  }

  return [...archives.values()].sort(compareNewestAgentLogArchives);
}

export function mergeAgentLogArchives(existingArchives: AgentLogArchive[], nextArchives: AgentLogArchive[]) {
  const merged = new Map<string, AgentLogArchive>();

  for (const archive of existingArchives) {
    merged.set(archive.id, { ...archive, sessionIds: [...archive.sessionIds] });
  }

  for (const archive of nextArchives) {
    const current = merged.get(archive.id);

    if (!current) {
      merged.set(archive.id, { ...archive, sessionIds: [...archive.sessionIds] });
      continue;
    }

    merged.set(archive.id, {
      ...current,
      sessionIds: mergeSessionIds(current.sessionIds, archive.sessionIds),
      firstObservedAt: minTimestampIso(current.firstObservedAt, archive.firstObservedAt),
      lastObservedAt: maxTimestampIso(current.lastObservedAt, archive.lastObservedAt),
      firstSeq: Math.min(current.firstSeq, archive.firstSeq),
      lastSeq: Math.max(current.lastSeq, archive.lastSeq),
      firstChunkSeq: Math.min(current.firstChunkSeq, archive.firstChunkSeq),
      lastChunkSeq: Math.max(current.lastChunkSeq, archive.lastChunkSeq),
      chunkCount: current.chunkCount + archive.chunkCount,
      contentBytes: current.contentBytes + archive.contentBytes,
      contentSha256: combineContentHashes(current.contentSha256, archive.contentSha256),
      archivedAt: maxTimestampIso(current.archivedAt, archive.archivedAt)
    });
  }

  return [...merged.values()].sort(compareNewestAgentLogArchives);
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

  const prunedLogChunks = events.filter(
    (event): event is Extract<AgentEventEnvelope, { type: 'log_chunk' }> =>
      event.type === 'log_chunk' && !retainedLogEventIds.has(event.eventId)
  );
  const archives = compactAgentLogEvents(prunedLogChunks, now);
  const nextEvents = events.filter((event) => event.type !== 'log_chunk' || retainedLogEventIds.has(event.eventId));

  return {
    events: nextEvents,
    archives,
    result: {
      removed: events.length - nextEvents.length,
      retained: retainedLogEventIds.size,
      cutoffObservedAt: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : '',
      archived: prunedLogChunks.length,
      archiveBuckets: archives.length
    }
  };
}
