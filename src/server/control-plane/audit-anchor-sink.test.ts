// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditLog } from '../../domain';
import {
  createCompositeControlPlaneAuditAnchorSink,
  createFileControlPlaneAuditAnchorSink,
  createObjectStorageControlPlaneAuditAnchorSink,
  createRuntimeControlPlaneAuditAnchorSink,
  createWebhookControlPlaneAuditAnchorSink,
  type ControlPlaneAuditAnchorSink,
  withAuditAnchorSink
} from './audit-anchor-sink';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

const anchoredAt = '2026-06-06T00:00:01.000Z';

function createAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'audit-anchor-test',
    action: 'task.created',
    actor: 'operator:anchor-test',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    scope: 'control-plane:task',
    resourceType: 'agent',
    operation: 'agent.deploy',
    result: 'accepted',
    targetId: 'agent-anchor-test',
    targetLabel: 'Agent Anchor Test',
    taskId: 'task-anchor-test',
    severity: 'info',
    message: 'Task created',
    createdAt: '2026-06-06T00:00:00.000Z',
    sourceIp: '127.0.0.1',
    requestId: 'req-audit-anchor-test',
    prevHash: `sha256:${'0'.repeat(64)}`,
    hash: `sha256:${'1'.repeat(64)}`,
    before: {
      shouldNotBeAnchored: true
    },
    after: {
      shouldNotBeAnchored: true
    },
    ...overrides
  };
}

async function allowPublicAuditAnchorHostResolver(hostname: string) {
  if (hostname !== 'anchors.example.com') {
    throw new Error(`Unexpected audit anchor webhook hostname: ${hostname}`);
  }

  return [{ address: '93.184.216.34', family: 4 as const }];
}

async function allowPublicAuditObjectStorageHostResolver(hostname: string) {
  if (hostname !== 'objects.example.com') {
    throw new Error(`Unexpected audit object storage hostname: ${hostname}`);
  }

  return [{ address: '93.184.216.34', family: 4 as const }];
}

describe('audit anchor sink', () => {
  it('appends sanitized audit hash anchors as JSONL envelopes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-audit-anchor-'));
    const sink = createFileControlPlaneAuditAnchorSink({ directory });
    const auditLog = createAuditLog();

    try {
      await sink.writeAuditAnchors([auditLog], { anchoredAt: '2026-06-06T00:00:01.000Z' });

      const [line] = (await readFile(join(directory, 'audit-anchors.jsonl'), 'utf8')).trim().split('\n');
      const envelope = JSON.parse(line) as {
        schemaVersion: string;
        anchoredAt: string;
        audit: Record<string, unknown>;
      };

      expect(envelope).toEqual({
        schemaVersion: 'ou-ui-next.audit-anchor.v1',
        anchoredAt: '2026-06-06T00:00:01.000Z',
        audit: {
          auditLogId: auditLog.id,
          action: auditLog.action,
          operation: auditLog.operation,
          result: auditLog.result,
          severity: auditLog.severity,
          actor: auditLog.actor,
          scope: auditLog.scope,
          resourceType: auditLog.resourceType,
          targetId: auditLog.targetId,
          taskId: auditLog.taskId,
          requestId: auditLog.requestId,
          createdAt: auditLog.createdAt,
          hash: auditLog.hash,
          prevHash: auditLog.prevHash
        }
      });
      expect(JSON.stringify(envelope)).not.toContain('shouldNotBeAnchored');
      expect(JSON.stringify(envelope)).not.toContain('127.0.0.1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not reject committed repository transactions when the anchor sink fails', async () => {
    const sink = {
      writeAuditAnchors: vi.fn(async () => {
        throw new Error('anchor sink unavailable');
      })
    };
    const onError = vi.fn();
    const repository = withAuditAnchorSink(createInMemoryControlPlaneRepository({}), {
      sink,
      onError,
      now: () => '2026-06-06T00:00:02.000Z'
    });
    const auditLog = createAuditLog({ id: 'audit-anchor-failure-test' });

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.insertAuditLog(auditLog);
      })
    ).resolves.toBeUndefined();

    await expect(repository.listAuditLogs()).resolves.toEqual([auditLog]);
    expect(sink.writeAuditAnchors).toHaveBeenCalledWith([auditLog], {
      anchoredAt: '2026-06-06T00:00:02.000Z'
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      auditLogs: [auditLog],
      anchoredAt: '2026-06-06T00:00:02.000Z'
    });
  });
});

describe('createWebhookControlPlaneAuditAnchorSink', () => {
  it('posts sanitized audit anchor batches with optional bearer auth', async () => {
    const auditLog = createAuditLog();
    const deliveries: unknown[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const sink = createWebhookControlPlaneAuditAnchorSink({
      url: 'https://anchors.example.com/ou-ui?token=request-url-secret',
      bearerToken: 'audit-anchor-webhook-token',
      egressPolicy: {
        allowedHosts: ['anchors.example.com']
      },
      hostResolver: allowPublicAuditAnchorHostResolver,
      fetcher,
      onDelivery: (event) => deliveries.push(event)
    });

    await sink.writeAuditAnchors([auditLog], { anchoredAt });

    expect(fetcher).toHaveBeenCalledWith(
      'https://anchors.example.com/ou-ui?token=request-url-secret',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer audit-anchor-webhook-token'
        },
        signal: expect.any(AbortSignal)
      })
    );
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body).toEqual({
      schemaVersion: 'ou-ui-next.audit-anchor.batch.v1',
      anchoredAt,
      recordCount: 1,
      anchors: [
        {
          schemaVersion: 'ou-ui-next.audit-anchor.v1',
          anchoredAt,
          audit: {
            auditLogId: auditLog.id,
            action: auditLog.action,
            operation: auditLog.operation,
            result: auditLog.result,
            severity: auditLog.severity,
            actor: auditLog.actor,
            scope: auditLog.scope,
            resourceType: auditLog.resourceType,
            targetId: auditLog.targetId,
            taskId: auditLog.taskId,
            requestId: auditLog.requestId,
            createdAt: auditLog.createdAt,
            hash: auditLog.hash,
            prevHash: auditLog.prevHash
          }
        }
      ]
    });
    expect(JSON.stringify(body)).not.toContain('shouldNotBeAnchored');
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(deliveries).toEqual([
      {
        event: 'audit_anchor.webhook.delivered',
        url: 'https://anchors.example.com',
        recordCount: 1,
        statusCode: 202
      }
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('audit-anchor-webhook-token');
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
  });

  it('rejects local audit anchor webhook targets before resolving or posting', async () => {
    const deliveries: unknown[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(allowPublicAuditAnchorHostResolver);
    const sink = createWebhookControlPlaneAuditAnchorSink({
      url: 'https://127.0.0.1/ou-ui?token=request-url-secret',
      hostResolver,
      fetcher,
      onDelivery: (event) => deliveries.push(event)
    });

    await expect(sink.writeAuditAnchors([createAuditLog()], { anchoredAt })).rejects.toThrow(
      'audit anchor webhook host is not allowed for remote delivery'
    );
    expect(hostResolver).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(deliveries)).not.toContain('request-url-secret');
    expect(deliveries).toEqual([
      expect.objectContaining({
        event: 'audit_anchor.webhook.failed',
        url: 'https://127.0.0.1',
        recordCount: 1,
        errorMessage: 'audit anchor webhook host is not allowed for remote delivery'
      })
    ]);
  });

  it('rejects audit anchor webhook targets that resolve to private addresses before posting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '10.2.3.4', family: 4 as const }
    ]);
    const sink = createWebhookControlPlaneAuditAnchorSink({
      url: 'https://anchors.example.com/ou-ui',
      hostResolver,
      fetcher
    });

    await expect(sink.writeAuditAnchors([createAuditLog()], { anchoredAt })).rejects.toThrow(
      'audit anchor webhook resolved host is not allowed for remote delivery'
    );
    expect(hostResolver).toHaveBeenCalledWith('anchors.example.com');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('createObjectStorageControlPlaneAuditAnchorSink', () => {
  it('puts sanitized audit anchor envelopes to S3-compatible object storage', async () => {
    const auditLog = createAuditLog();
    const deliveries: unknown[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const sink = createObjectStorageControlPlaneAuditAnchorSink({
      endpoint: 'https://objects.example.com',
      bucket: 'ou-ui-anchors',
      region: 'auto',
      accessKeyId: 'audit-access-key',
      secretAccessKey: 'audit-secret-key',
      prefix: 'prod/hkg',
      egressPolicy: {
        allowedHosts: ['objects.example.com']
      },
      hostResolver: allowPublicAuditObjectStorageHostResolver,
      fetcher,
      now: () => new Date('2026-06-06T00:00:00.000Z'),
      onDelivery: (event) => deliveries.push(event)
    });

    await sink.writeAuditAnchors([auditLog], { anchoredAt });

    const expectedKey = 'prod/hkg/audit-anchor/2026/06/06/20260606T000001000Z-audit-anchor-test.json';
    expect(fetcher).toHaveBeenCalledWith(
      `https://objects.example.com/ou-ui-anchors/${expectedKey}`,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Amz-Date': '20260606T000000Z',
          Authorization: expect.stringContaining('AWS4-HMAC-SHA256 Credential=audit-access-key/20260606/auto/s3/aws4_request')
        }),
        signal: expect.any(AbortSignal)
      })
    );
    const body = JSON.parse(Buffer.from(fetcher.mock.calls[0][1].body as Buffer).toString('utf8'));
    expect(body).toEqual({
      schemaVersion: 'ou-ui-next.audit-anchor.v1',
      anchoredAt,
      audit: {
        auditLogId: auditLog.id,
        action: auditLog.action,
        operation: auditLog.operation,
        result: auditLog.result,
        severity: auditLog.severity,
        actor: auditLog.actor,
        scope: auditLog.scope,
        resourceType: auditLog.resourceType,
        targetId: auditLog.targetId,
        taskId: auditLog.taskId,
        requestId: auditLog.requestId,
        createdAt: auditLog.createdAt,
        hash: auditLog.hash,
        prevHash: auditLog.prevHash
      }
    });
    expect(JSON.stringify(body)).not.toContain('shouldNotBeAnchored');
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(deliveries).toEqual([
      {
        event: 'audit_anchor.object_storage.delivered',
        endpoint: 'https://objects.example.com',
        bucket: 'ou-ui-anchors',
        key: expectedKey,
        recordCount: 1,
        statusCode: 200
      }
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('audit-secret-key');
  });

  it('rejects object storage endpoints that resolve to private addresses before putting anchors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const hostResolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '10.2.3.4', family: 4 as const }
    ]);
    const sink = createObjectStorageControlPlaneAuditAnchorSink({
      endpoint: 'https://objects.example.com',
      bucket: 'ou-ui-anchors',
      region: 'auto',
      accessKeyId: 'audit-access-key',
      secretAccessKey: 'audit-secret-key',
      hostResolver,
      fetcher
    });

    await expect(sink.writeAuditAnchors([createAuditLog()], { anchoredAt })).rejects.toThrow(
      'object storage endpoint resolved host is not allowed for remote delivery'
    );
    expect(hostResolver).toHaveBeenCalledWith('objects.example.com');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('createCompositeControlPlaneAuditAnchorSink', () => {
  it('attempts every configured sink before reporting audit anchor write failures', async () => {
    const auditLog = createAuditLog();
    const firstSink: ControlPlaneAuditAnchorSink = {
      writeAuditAnchors: vi.fn(async () => {
        throw new Error('primary audit anchor sink unavailable');
      })
    };
    const secondSink: ControlPlaneAuditAnchorSink = {
      writeAuditAnchors: vi.fn()
    };
    const composite = createCompositeControlPlaneAuditAnchorSink([firstSink, secondSink]);

    await expect(composite.writeAuditAnchors([auditLog], { anchoredAt })).rejects.toThrow(
      'primary audit anchor sink unavailable'
    );

    expect(firstSink.writeAuditAnchors).toHaveBeenCalledWith([auditLog], { anchoredAt });
    expect(secondSink.writeAuditAnchors).toHaveBeenCalledWith([auditLog], { anchoredAt });
  });
});

describe('createRuntimeControlPlaneAuditAnchorSink', () => {
  it('builds a composite runtime sink from a file directory and all webhook targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-runtime-audit-anchor-'));
    const webhookSinkCalls: unknown[] = [];
    const webhookAuditLogs: AuditLog[][] = [];
    const deliveries: unknown[] = [];
    const auditLog = createAuditLog();
    const sink = createRuntimeControlPlaneAuditAnchorSink(
      {
        directory,
        webhook: {
          targets: [
            {
              id: 'default-webhook',
              label: 'Default webhook',
              url: 'https://anchors.example.com/ou-ui'
            },
            {
              id: 'webhook-2',
              label: 'Webhook 2',
              url: 'https://siem.example.com/ou-ui'
            }
          ],
          timeoutMs: 2500,
          egress: {
            allowedHosts: ['anchors.example.com', 'siem.example.com']
          },
          bearerToken: 'audit-anchor-webhook-token'
        }
      },
      {
        createWebhookSink: (options) => {
          webhookSinkCalls.push(options);

          return {
            async writeAuditAnchors(auditLogs) {
              webhookAuditLogs.push(auditLogs);
              options.onDelivery?.({
                event: 'audit_anchor.webhook.delivered',
                url: new URL(options.url).origin,
                recordCount: auditLogs.length,
                statusCode: 204
              });
            }
          };
        },
        onWebhookDelivery: (event) => deliveries.push(event)
      }
    );

    try {
      expect(sink).toBeDefined();
      await sink?.writeAuditAnchors([auditLog], { anchoredAt });

      const fileLines = (await readFile(join(directory, 'audit-anchors.jsonl'), 'utf8')).trim().split('\n');

      expect(JSON.parse(fileLines[0])).toMatchObject({
        schemaVersion: 'ou-ui-next.audit-anchor.v1',
        audit: {
          auditLogId: auditLog.id
        }
      });
      expect(webhookSinkCalls).toEqual([
        expect.objectContaining({
          url: 'https://anchors.example.com/ou-ui',
          timeoutMs: 2500,
          bearerToken: 'audit-anchor-webhook-token',
          egressPolicy: {
            allowedHosts: ['anchors.example.com', 'siem.example.com']
          }
        }),
        expect.objectContaining({
          url: 'https://siem.example.com/ou-ui',
          timeoutMs: 2500,
          bearerToken: 'audit-anchor-webhook-token',
          egressPolicy: {
            allowedHosts: ['anchors.example.com', 'siem.example.com']
          }
        })
      ]);
      expect(webhookAuditLogs).toEqual([[auditLog], [auditLog]]);
      expect(deliveries).toEqual([
        expect.objectContaining({
          channelId: 'default-webhook',
          channelLabel: 'Default webhook',
          url: 'https://anchors.example.com'
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

  it('builds a runtime audit anchor sink from S3-compatible object storage config', async () => {
    const objectStorageSinkCalls: unknown[] = [];
    const objectStorageAuditLogs: AuditLog[][] = [];
    const deliveries: unknown[] = [];
    const auditLog = createAuditLog();
    const sink = createRuntimeControlPlaneAuditAnchorSink(
      {
        objectStorage: {
          endpoint: 'https://objects.example.com',
          bucket: 'ou-ui-anchors',
          region: 'auto',
          accessKeyId: 'audit-access-key',
          secretAccessKey: 'audit-secret-key',
          prefix: 'prod/hkg',
          objectLock: {
            retentionMode: 'COMPLIANCE',
            retentionDays: 90
          },
          timeoutMs: 2500,
          forcePathStyle: true,
          egress: {
            allowedHosts: ['objects.example.com']
          }
        }
      },
      {
        createObjectStorageSink: (options) => {
          objectStorageSinkCalls.push(options);

          return {
            async writeAuditAnchors(auditLogs) {
              objectStorageAuditLogs.push(auditLogs);
              options.onDelivery?.({
                event: 'audit_anchor.object_storage.delivered',
                endpoint: new URL(options.endpoint).origin,
                bucket: options.bucket,
                key: 'prod/hkg/audit-anchor/2026/06/06/audit.json',
                recordCount: auditLogs.length,
                statusCode: 200
              });
            }
          };
        },
        onObjectStorageDelivery: (event) => deliveries.push(event)
      }
    );

    expect(sink).toBeDefined();
    await sink?.writeAuditAnchors([auditLog], { anchoredAt });

    expect(objectStorageSinkCalls).toEqual([
      expect.objectContaining({
        endpoint: 'https://objects.example.com',
        bucket: 'ou-ui-anchors',
        region: 'auto',
        accessKeyId: 'audit-access-key',
        secretAccessKey: 'audit-secret-key',
        prefix: 'prod/hkg',
        objectLock: {
          retentionMode: 'COMPLIANCE',
          retentionDays: 90
        },
        timeoutMs: 2500,
        forcePathStyle: true,
        egressPolicy: {
          allowedHosts: ['objects.example.com']
        }
      })
    ]);
    expect(objectStorageAuditLogs).toEqual([[auditLog]]);
    expect(deliveries).toEqual([
      expect.objectContaining({
        event: 'audit_anchor.object_storage.delivered',
        endpoint: 'https://objects.example.com',
        bucket: 'ou-ui-anchors'
      })
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('audit-secret-key');
  });
});
