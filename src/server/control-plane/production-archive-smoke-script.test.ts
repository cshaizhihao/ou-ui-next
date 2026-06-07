// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlPlaneArchiveSink } from './archive-sink';
import type {
  RuntimeControlPlaneArchiveSinkConfig,
  RuntimeControlPlaneArchiveSinkFactoryOptions
} from './archive-sink';
import type { ControlPlaneAuditAnchorSink } from './audit-anchor-sink';
import type {
  RuntimeControlPlaneAuditAnchorSinkConfig,
  RuntimeControlPlaneAuditAnchorSinkFactoryOptions
} from './audit-anchor-sink';

const createdAt = '2026-06-07T00:00:00.000Z';

type ArchiveSmokeReport = {
  requestId: string;
  [key: string]: unknown;
};

type ProductionArchiveSmokeScript = {
  createArchiveSmokeHelp(): string;
  parseArgs(argv: string[]): Record<string, unknown>;
  parseEnvFile(content: string): Record<string, string>;
  runArchiveSmoke(options?: Record<string, unknown>): Promise<
    | {
        help: true;
        text: string;
      }
    | {
        help: false;
        report: ArchiveSmokeReport;
      }
  >;
};

const archiveSmokeScript = (await import(
  new URL('../../../scripts/production-archive-smoke.ts', import.meta.url).href
)) as ProductionArchiveSmokeScript;
const { createArchiveSmokeHelp, parseArgs, parseEnvFile, runArchiveSmoke } = archiveSmokeScript;

function expectSmokeReport(result: Awaited<ReturnType<ProductionArchiveSmokeScript['runArchiveSmoke']>>) {
  expect(result.help).toBe(false);

  if (result.help) {
    throw new Error('Expected archive smoke report');
  }

  return result.report;
}

describe('production archive smoke script helpers', () => {
  it('writes sanitized smoke records through the configured local JSONL archive sink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-archive-smoke-'));
    const archiveDirectory = join(directory, 'external-archives');
    const envFile = join(directory, 'master.env');
    const reportPath = join(directory, 'reports', 'archive-smoke.json');

    try {
      await writeFile(envFile, `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY=${archiveDirectory}\n`);

      const report = expectSmokeReport(
        await runArchiveSmoke({
          argv: ['--env-file', envFile],
          env: {
            OU_UI_ARCHIVE_SMOKE_REPORT_PATH: reportPath
          },
          now: () => new Date(createdAt)
        })
      );

      expect(report).toMatchObject({
        schemaVersion: 'ou-ui-next.production-archive-smoke.v1',
        status: 'passed',
        createdAt,
        externalArchiveSink: {
          type: 'file',
          directoryConfigured: true,
          webhookTargets: []
        },
        checks: [
          { name: 'audit anchor archive smoke', status: 'passed' },
          { name: 'agent log archive smoke', status: 'passed' },
          { name: 'traffic rollup compaction archive smoke', status: 'passed' }
        ],
        deliveries: []
      });
      expect(report.requestId).toMatch(/^archive-smoke-/);

      const auditAnchor = JSON.parse(await readFile(join(archiveDirectory, 'audit-anchors.jsonl'), 'utf8'));
      const agentLogArchive = JSON.parse(await readFile(join(archiveDirectory, 'agent-log-archives.jsonl'), 'utf8'));
      const trafficCompaction = JSON.parse(
        await readFile(join(archiveDirectory, 'traffic-rollup-compactions.jsonl'), 'utf8')
      );

      expect(auditAnchor).toMatchObject({
        schemaVersion: 'ou-ui-next.audit-anchor.v1',
        anchoredAt: createdAt,
        audit: {
          action: 'audit.denied',
          resourceType: 'integration',
          hash: `sha256:${'1'.repeat(64)}`,
          prevHash: `sha256:${'0'.repeat(64)}`
        }
      });
      expect(agentLogArchive).toMatchObject({
        schemaVersion: 'ou-ui-next.external-archive.v1',
        kind: 'agent-log-archive',
        exportedAt: createdAt,
        record: {
          agentId: 'agent-archive-smoke',
          contentSha256: '0'.repeat(64)
        }
      });
      expect(trafficCompaction).toMatchObject({
        schemaVersion: 'ou-ui-next.external-archive.v1',
        kind: 'traffic-rollup-compaction',
        exportedAt: createdAt,
        record: {
          dimension: 'agent',
          subjectId: 'agent-archive-smoke'
        }
      });

      const savedReport = await readFile(reportPath, 'utf8');
      expect(JSON.parse(savedReport)).toEqual(report);
      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when no external archive sink is configured', async () => {
    await expect(
      runArchiveSmoke({
        argv: [],
        env: {},
        now: () => new Date(createdAt)
      })
    ).rejects.toThrow('未配置外部归档 sink');

    expect(() => parseArgs(['--report'])).toThrow('参数 --report 需要值');
    expect(parseEnvFile('export OU_UI_EXTERNAL_ARCHIVE_DIRECTORY="/var/lib/ou/archive"\n')).toEqual({
      OU_UI_EXTERNAL_ARCHIVE_DIRECTORY: '/var/lib/ou/archive'
    });
  });

  it('redacts configured remote archive targets and records sanitized delivery events', async () => {
    const createArchiveSink = vi.fn(
      (
        _: RuntimeControlPlaneArchiveSinkConfig | undefined,
        options: RuntimeControlPlaneArchiveSinkFactoryOptions = {}
      ): ControlPlaneArchiveSink => {
        return {
          async writeAgentLogArchives(archives) {
            options.onWebhookDelivery?.({
              event: 'external_archive.webhook.delivered',
              channelId: 'default-webhook',
              channelLabel: 'Default webhook',
              url: 'https://hooks.example.test',
              kind: 'agent-log-archive',
              recordCount: archives.length,
              statusCode: 202
            });
          },
          async writeTrafficRollupCompactions(compactions) {
            options.onObjectStorageDelivery?.({
              event: 'external_archive.object_storage.delivered',
              endpoint: 'https://objects.example.test',
              bucket: 'archive-bucket',
              key: 'prod/archive/traffic-rollup-compaction/2026/06/07/test.json',
              kind: 'traffic-rollup-compaction',
              recordCount: compactions.length,
              statusCode: 200
            });
          }
        };
      }
    );
    const createAuditAnchorSink = vi.fn(
      (
        _: RuntimeControlPlaneAuditAnchorSinkConfig | undefined,
        options: RuntimeControlPlaneAuditAnchorSinkFactoryOptions = {}
      ): ControlPlaneAuditAnchorSink => {
        return {
          async writeAuditAnchors(auditLogs) {
            options.onWebhookDelivery?.({
              event: 'audit_anchor.webhook.delivered',
              channelId: 'default-webhook',
              channelLabel: 'Default webhook',
              url: 'https://hooks.example.test',
              recordCount: auditLogs.length,
              statusCode: 202
            });
            options.onObjectStorageDelivery?.({
              event: 'audit_anchor.object_storage.delivered',
              endpoint: 'https://objects.example.test',
              bucket: 'archive-bucket',
              key: 'prod/archive/audit-anchor/2026/06/07/test.json',
              recordCount: auditLogs.length,
              statusCode: 200
            });
          }
        };
      }
    );

    const report = expectSmokeReport(
      await runArchiveSmoke({
        argv: [],
        env: {
          OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL:
            'https://hooks.example.test/ou-ui/archive/secret-path?token=secret-url-token',
          OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN: 'secret-webhook-bearer',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test/private-base',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET: 'archive-bucket',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION: 'us-east-1',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID: 'secret-access-key',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-access-secret',
          OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX: 'prod/archive'
        },
        now: () => new Date(createdAt),
        createArchiveSink,
        createAuditAnchorSink
      })
    ) as ArchiveSmokeReport;

    expect(report).toMatchObject({
      status: 'passed',
      externalArchiveSink: {
        type: 'composite',
        directoryConfigured: false,
        webhookTargets: [
          {
            id: 'default-webhook',
            label: 'Default webhook',
            url: 'https://hooks.example.test/[redacted-path]?[redacted]'
          }
        ],
        objectStorage: {
          endpoint: 'https://objects.example.test',
          bucket: 'archive-bucket',
          prefix: 'prod/archive',
          forcePathStyle: true
        }
      },
      deliveries: [
        expect.objectContaining({ event: 'audit_anchor.webhook.delivered', channelId: 'default-webhook' }),
        expect.objectContaining({
          event: 'audit_anchor.object_storage.delivered',
          endpoint: 'https://objects.example.test'
        }),
        expect.objectContaining({ event: 'external_archive.webhook.delivered', kind: 'agent-log-archive' }),
        expect.objectContaining({
          event: 'external_archive.object_storage.delivered',
          kind: 'traffic-rollup-compaction'
        })
      ]
    });
    expect(createArchiveSink).toHaveBeenCalledTimes(1);
    expect(createAuditAnchorSink).toHaveBeenCalledTimes(1);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('secret-webhook-bearer');
    expect(serialized).not.toContain('secret-access-key');
    expect(serialized).not.toContain('secret-access-secret');
    expect(serialized).not.toContain('secret-url-token');
    expect(serialized).not.toContain('/ou-ui/archive/secret-path');
    expect(serialized).not.toContain('/private-base');
  });

  it('prints help that warns about real external writes', () => {
    expect(createArchiveSmokeHelp()).toContain('该命令会真实写入本地归档目录、外部归档 webhook 和 S3 兼容对象存储');
  });
});
