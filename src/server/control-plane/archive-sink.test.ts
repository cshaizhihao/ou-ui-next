// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLogArchive, TrafficRollupCompaction } from '../../domain';
import { createFileControlPlaneArchiveSink } from './archive-sink';

describe('createFileControlPlaneArchiveSink', () => {
  it('appends Agent log archives and traffic rollup compactions as JSONL envelopes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-archive-sink-'));
    const sink = createFileControlPlaneArchiveSink({ directory });
    const exportedAt = '2026-06-06T00:00:00.000Z';
    const agentLogArchive: AgentLogArchive = {
      id: 'agent-log-archive-test',
      agentId: 'agent-hkg-01',
      sessionIds: ['sess-hkg-01'],
      taskId: 'task-agent-log-archive',
      commandId: 'cmd-agent-log-archive',
      stream: 'stderr',
      bucketStartAt: '2026-06-05T00:00:00.000Z',
      bucketEndAt: '2026-06-06T00:00:00.000Z',
      firstObservedAt: '2026-06-05T01:00:00.000Z',
      lastObservedAt: '2026-06-05T01:01:00.000Z',
      firstSeq: 1,
      lastSeq: 2,
      firstChunkSeq: 1,
      lastChunkSeq: 2,
      chunkCount: 2,
      contentBytes: 128,
      contentSha256: 'a'.repeat(64),
      archivedAt: exportedAt,
      source: 'retention-prune'
    };
    const trafficCompaction: TrafficRollupCompaction = {
      id: 'traffic-compaction-test',
      granularity: 'day',
      dimension: 'agent',
      subjectId: 'agent-hkg-01',
      subjectLabel: 'Agent HKG 01',
      agentId: 'agent-hkg-01',
      periodKey: '2026-06-reset-01',
      bucketStartAt: '2026-06-05T00:00:00.000Z',
      bucketEndAt: '2026-06-06T00:00:00.000Z',
      firstObservedAt: '2026-06-05T01:00:00.000Z',
      lastObservedAt: '2026-06-05T01:01:00.000Z',
      firstSampledAt: '2026-06-05T01:00:00.000Z',
      lastSampledAt: '2026-06-05T01:01:00.000Z',
      sampleCount: 2,
      ingressBytesTotal: 256,
      egressBytesTotal: 512,
      meteredBytesTotal: 768,
      compactedAt: exportedAt,
      source: 'retention-prune'
    };

    try {
      await sink.writeAgentLogArchives([agentLogArchive], { exportedAt });
      await sink.writeTrafficRollupCompactions([trafficCompaction], { exportedAt });

      const agentLogLines = (await readFile(join(directory, 'agent-log-archives.jsonl'), 'utf8')).trim().split('\n');
      const trafficLines = (await readFile(join(directory, 'traffic-rollup-compactions.jsonl'), 'utf8'))
        .trim()
        .split('\n');

      expect(agentLogLines).toHaveLength(1);
      expect(trafficLines).toHaveLength(1);
      expect(JSON.parse(agentLogLines[0])).toEqual({
        schemaVersion: 'ou-ui-next.external-archive.v1',
        kind: 'agent-log-archive',
        exportedAt,
        recordId: agentLogArchive.id,
        record: agentLogArchive
      });
      expect(JSON.parse(trafficLines[0])).toEqual({
        schemaVersion: 'ou-ui-next.external-archive.v1',
        kind: 'traffic-rollup-compaction',
        exportedAt,
        recordId: trafficCompaction.id,
        record: trafficCompaction
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
