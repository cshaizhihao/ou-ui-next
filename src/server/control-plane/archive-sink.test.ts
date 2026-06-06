// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLogArchive, TrafficRollupCompaction } from '../../domain';
import {
  createCompositeControlPlaneArchiveSink,
  createFileControlPlaneArchiveSink,
  createRuntimeControlPlaneArchiveSink,
  createWebhookControlPlaneArchiveSink,
  type ControlPlaneArchiveSink
} from './archive-sink';

const exportedAt = '2026-06-06T00:00:00.000Z';

function createAgentLogArchive(overrides: Partial<AgentLogArchive> = {}): AgentLogArchive {
  return {
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
    source: 'retention-prune',
    ...overrides
  };
}

function createTrafficCompaction(overrides: Partial<TrafficRollupCompaction> = {}): TrafficRollupCompaction {
  return {
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
    source: 'retention-prune',
    ...overrides
  };
}

async function allowPublicArchiveHostResolver(hostname: string) {
  if (hostname !== 'archives.example.com') {
    throw new Error(`Unexpected archive webhook hostname: ${hostname}`);
  }

  return [{ address: '93.184.216.34', family: 4 as const }];
}

describe('createFileControlPlaneArchiveSink', () => {
  it('appends Agent log archives and traffic rollup compactions as JSONL envelopes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-archive-sink-'));
    const sink = createFileControlPlaneArchiveSink({ directory });
    const agentLogArchive = createAgentLogArchive();
    const trafficCompaction = createTrafficCompaction();

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

describe('createWebhookControlPlaneArchiveSink', () => {
  it('posts archive batches with optional bearer auth and sanitized delivery logs', async () => {
    const deliveries: unknown[] = [];
    const agentLogArchive = createAgentLogArchive();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const sink = createWebhookControlPlaneArchiveSink({
      url: 'https://archives.example.com/ou-ui?token=request-url-secret',
      bearerToken: 'archive-webhook-token',
      egressPolicy: {
        allowedHosts: ['archives.example.com']
      },
      hostResolver: allowPublicArchiveHostResolver,
      fetcher,
      onDelivery: (event) => deliveries.push(event)
    });

    await sink.writeAgentLogArchives([agentLogArchive], { exportedAt });

    expect(fetcher).toHaveBeenCalledWith(
      'https://archives.example.com/ou-ui?token=request-url-secret',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer archive-webhook-token'
        },
        signal: expect.any(AbortSignal)
      })
    );
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body).toEqual({
      schemaVersion: 'ou-ui-next.external-archive.batch.v1',
      kind: 'agent-log-archive',
      exportedAt,
      recordCount: 1,
      records: [
        {
          recordId: agentLogArchive.id,
          record: agentLogArchive
        }
      ]
    });
    expect(deliveries).toEqual([
      {
        event: 'external_archive.webhook.delivered',
        url: 'https://archives.example.com',
        kind: 'agent-log-archive',
        recordCount: 1,
        statusCode: 202
      }
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('archive-webhook-token');
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
  });

  it('rejects local archive webhook targets before resolving or posting', async () => {
    const deliveries: unknown[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(allowPublicArchiveHostResolver);
    const sink = createWebhookControlPlaneArchiveSink({
      url: 'https://127.0.0.1/ou-ui?token=request-url-secret',
      hostResolver,
      fetcher,
      onDelivery: (event) => deliveries.push(event)
    });

    await expect(sink.writeAgentLogArchives([createAgentLogArchive()], { exportedAt })).rejects.toThrow(
      'external archive webhook host is not allowed for remote delivery'
    );
    expect(hostResolver).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
    expect(deliveries).toEqual([
      expect.objectContaining({
        event: 'external_archive.webhook.failed',
        url: 'https://127.0.0.1',
        kind: 'agent-log-archive',
        recordCount: 1,
        errorMessage: 'external archive webhook host is not allowed for remote delivery'
      })
    ]);
  });

  it('rejects archive webhook targets that resolve to private addresses before posting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '10.2.3.4', family: 4 as const }
    ]);
    const sink = createWebhookControlPlaneArchiveSink({
      url: 'https://archives.example.com/ou-ui',
      hostResolver,
      fetcher
    });

    await expect(sink.writeTrafficRollupCompactions([createTrafficCompaction()], { exportedAt })).rejects.toThrow(
      'external archive webhook resolved host is not allowed for remote delivery'
    );
    expect(hostResolver).toHaveBeenCalledWith('archives.example.com');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces the archive webhook egress allowlist before resolving or posting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(allowPublicArchiveHostResolver);
    const sink = createWebhookControlPlaneArchiveSink({
      url: 'https://archives.example.com/ou-ui',
      egressPolicy: {
        allowedHosts: ['*.trusted-archives.example.com']
      },
      hostResolver,
      fetcher
    });

    await expect(sink.writeAgentLogArchives([createAgentLogArchive()], { exportedAt })).rejects.toThrow(
      'external archive webhook host is not in the egress allowlist'
    );
    expect(hostResolver).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('createCompositeControlPlaneArchiveSink', () => {
  it('attempts every configured sink before reporting archive write failures', async () => {
    const firstSink: ControlPlaneArchiveSink = {
      writeAgentLogArchives: vi.fn(async () => {
        throw new Error('primary archive sink unavailable');
      }),
      writeTrafficRollupCompactions: vi.fn()
    };
    const secondSink: ControlPlaneArchiveSink = {
      writeAgentLogArchives: vi.fn(),
      writeTrafficRollupCompactions: vi.fn()
    };
    const composite = createCompositeControlPlaneArchiveSink([firstSink, secondSink]);
    const archive = createAgentLogArchive();

    await expect(composite.writeAgentLogArchives([archive], { exportedAt })).rejects.toThrow(
      'primary archive sink unavailable'
    );

    expect(firstSink.writeAgentLogArchives).toHaveBeenCalledWith([archive], { exportedAt });
    expect(secondSink.writeAgentLogArchives).toHaveBeenCalledWith([archive], { exportedAt });
  });
});

describe('createRuntimeControlPlaneArchiveSink', () => {
  it('builds a composite runtime sink from a file directory and all webhook targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-runtime-archive-sink-'));
    const webhookSinkCalls: unknown[] = [];
    const webhookArchives: AgentLogArchive[][] = [];
    const deliveries: unknown[] = [];
    const archive = createAgentLogArchive();
    const sink = createRuntimeControlPlaneArchiveSink(
      {
        directory,
        webhook: {
          targets: [
            {
              id: 'default-webhook',
              label: 'Default webhook',
              url: 'https://archives.example.com/ou-ui'
            },
            {
              id: 'webhook-2',
              label: 'Webhook 2',
              url: 'https://siem.example.com/ou-ui'
            }
          ],
          timeoutMs: 2500,
          egress: {
            allowedHosts: ['archives.example.com', 'siem.example.com']
          },
          bearerToken: 'archive-webhook-token'
        }
      },
      {
        createWebhookSink: (options) => {
          webhookSinkCalls.push(options);

          return {
            async writeAgentLogArchives(archives) {
              webhookArchives.push(archives);
              options.onDelivery?.({
                event: 'external_archive.webhook.delivered',
                url: new URL(options.url).origin,
                kind: 'agent-log-archive',
                recordCount: archives.length,
                statusCode: 204
              });
            },
            writeTrafficRollupCompactions: vi.fn()
          };
        },
        onWebhookDelivery: (event) => deliveries.push(event)
      }
    );

    try {
      expect(sink).toBeDefined();
      await sink?.writeAgentLogArchives([archive], { exportedAt });

      const fileLines = (await readFile(join(directory, 'agent-log-archives.jsonl'), 'utf8')).trim().split('\n');

      expect(JSON.parse(fileLines[0])).toMatchObject({
        kind: 'agent-log-archive',
        recordId: archive.id
      });
      expect(webhookSinkCalls).toEqual([
        expect.objectContaining({
          url: 'https://archives.example.com/ou-ui',
          timeoutMs: 2500,
          bearerToken: 'archive-webhook-token',
          egressPolicy: {
            allowedHosts: ['archives.example.com', 'siem.example.com']
          }
        }),
        expect.objectContaining({
          url: 'https://siem.example.com/ou-ui',
          timeoutMs: 2500,
          bearerToken: 'archive-webhook-token',
          egressPolicy: {
            allowedHosts: ['archives.example.com', 'siem.example.com']
          }
        })
      ]);
      expect(webhookArchives).toEqual([[archive], [archive]]);
      expect(deliveries).toEqual([
        expect.objectContaining({
          channelId: 'default-webhook',
          channelLabel: 'Default webhook',
          url: 'https://archives.example.com'
        }),
        expect.objectContaining({
          channelId: 'webhook-2',
          channelLabel: 'Webhook 2',
          url: 'https://siem.example.com'
        })
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
