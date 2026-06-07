#!/usr/bin/env tsx

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentLogArchive, AuditLog, TrafficRollupCompaction } from '../src/domain';
import {
  createRuntimeControlPlaneArchiveSink,
  type RuntimeControlPlaneArchiveSinkConfig,
  type RuntimeControlPlaneArchiveSinkDeliveryEvent,
  type RuntimeControlPlaneArchiveSinkObjectStorageDeliveryEvent
} from '../src/server/control-plane/archive-sink';
import {
  createRuntimeControlPlaneAuditAnchorSink,
  type RuntimeControlPlaneAuditAnchorSinkDeliveryEvent,
  type RuntimeControlPlaneAuditAnchorSinkObjectStorageDeliveryEvent
} from '../src/server/control-plane/audit-anchor-sink';
import { resolveHttpControlPlaneRuntimeConfig } from '../src/server/control-plane/http-control-plane-runtime-config';

export type ArchiveSmokeArgs = {
  envFile?: string;
  help?: boolean;
  reportPath?: string;
};

export type ArchiveSmokeCheck = {
  name: string;
  status: 'passed' | 'failed';
  errorMessage?: string;
};

export type ArchiveSmokeDelivery =
  | RuntimeControlPlaneArchiveSinkDeliveryEvent
  | RuntimeControlPlaneArchiveSinkObjectStorageDeliveryEvent
  | RuntimeControlPlaneAuditAnchorSinkDeliveryEvent
  | RuntimeControlPlaneAuditAnchorSinkObjectStorageDeliveryEvent;

export type ArchiveSmokeReport = {
  schemaVersion: 'ou-ui-next.production-archive-smoke.v1';
  status: 'passed' | 'failed';
  createdAt: string;
  requestId: string;
  externalArchiveSink: {
    type: string;
    directoryConfigured: boolean;
    webhookTargets: Array<{
      id: string;
      label: string;
      url: string;
    }>;
    objectStorage?: {
      endpoint: string;
      bucket: string;
      prefix?: string;
      forcePathStyle: boolean;
      objectLock?: {
        retentionMode?: 'GOVERNANCE' | 'COMPLIANCE';
        retentionDays?: number;
        legalHoldEnabled: boolean;
      };
    };
  };
  checks: ArchiveSmokeCheck[];
  deliveries: ArchiveSmokeDelivery[];
};

export type ArchiveSmokeRunOptions = {
  argv?: string[];
  env?: Record<string, string | undefined>;
  now?: () => Date;
  createArchiveSink?: typeof createRuntimeControlPlaneArchiveSink;
  createAuditAnchorSink?: typeof createRuntimeControlPlaneAuditAnchorSink;
};

export type ArchiveSmokeRunResult =
  | {
      help: true;
      text: string;
    }
  | {
      help: false;
      report: ArchiveSmokeReport;
    };

function splitEnvLine(line: string) {
  const separatorIndex = line.indexOf('=');

  if (separatorIndex <= 0) {
    return undefined;
  }

  return {
    key: line.slice(0, separatorIndex).trim(),
    value: unquoteEnvValue(line.slice(separatorIndex + 1).trim())
  };
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseEnvFile(content: string) {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const parsed = splitEnvLine(line);

    if (parsed) {
      values[parsed.key] = parsed.value;
    }
  }

  return values;
}

function readOptionalEnvFile(path: string | undefined) {
  if (!path || !existsSync(path)) {
    return {};
  }

  return parseEnvFile(readFileSync(path, 'utf8'));
}

function readFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`参数 ${flag} 需要值。`);
  }

  return value;
}

export function parseArgs(argv: string[]): ArchiveSmokeArgs {
  const args: ArchiveSmokeArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--env-file') {
      args.envFile = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--report') {
      args.reportPath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`未知参数：${arg}`);
  }

  return args;
}

function sanitizeUrlForReport(value: string) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.pathname = url.pathname && url.pathname !== '/' ? '/[redacted-path]' : '/';
  url.search = url.search ? '?[redacted]' : '';
  return url.toString();
}

function sanitizeEndpointForReport(value: string) {
  return new URL(value).origin;
}

export function createArchiveSinkSummary(config: RuntimeControlPlaneArchiveSinkConfig) {
  return {
    type: 'type' in config && config.type ? String(config.type) : 'composite',
    directoryConfigured: Boolean(config.directory),
    webhookTargets: (config.webhook?.targets ?? []).map((target) => ({
      id: target.id,
      label: target.label,
      url: sanitizeUrlForReport(target.url)
    })),
    ...(config.objectStorage
      ? {
          objectStorage: {
            endpoint: sanitizeEndpointForReport(config.objectStorage.endpoint),
            bucket: config.objectStorage.bucket,
            ...(config.objectStorage.prefix ? { prefix: config.objectStorage.prefix } : {}),
            forcePathStyle: config.objectStorage.forcePathStyle,
            ...(config.objectStorage.objectLock
              ? {
                  objectLock: {
                    ...(config.objectStorage.objectLock.retentionMode
                      ? { retentionMode: config.objectStorage.objectLock.retentionMode }
                      : {}),
                    ...(config.objectStorage.objectLock.retentionDays
                      ? { retentionDays: config.objectStorage.objectLock.retentionDays }
                      : {}),
                    legalHoldEnabled: config.objectStorage.objectLock.legalHold === true
                  }
                }
              : {})
          }
        }
      : {})
  };
}

function createSmokeAuditLog(input: { createdAt: string; requestId: string }): AuditLog {
  return {
    id: `audit-archive-smoke-${input.requestId}`,
    action: 'audit.denied',
    actor: 'operator:archive-smoke',
    operatorGroupId: 'owner',
    resourceGroupId: 'archive-smoke',
    scope: 'control-plane:archive-smoke',
    resourceType: 'integration',
    operation: 'operator.auth',
    result: 'denied',
    targetId: 'external-archive-smoke',
    targetLabel: 'External archive smoke',
    taskId: `task-archive-smoke-${input.requestId}`,
    severity: 'info',
    message: 'External archive smoke test audit anchor',
    createdAt: input.createdAt,
    sourceIp: '127.0.0.1',
    requestId: input.requestId,
    prevHash: `sha256:${'0'.repeat(64)}`,
    hash: `sha256:${'1'.repeat(64)}`
  };
}

function createSmokeAgentLogArchive(input: { createdAt: string; requestId: string }): AgentLogArchive {
  return {
    id: `agent-log-archive-smoke-${input.requestId}`,
    agentId: 'agent-archive-smoke',
    sessionIds: ['session-archive-smoke'],
    taskId: `task-archive-smoke-${input.requestId}`,
    commandId: `cmd-archive-smoke-${input.requestId}`,
    stream: 'runtime',
    bucketStartAt: input.createdAt,
    bucketEndAt: input.createdAt,
    firstObservedAt: input.createdAt,
    lastObservedAt: input.createdAt,
    firstSeq: 1,
    lastSeq: 1,
    firstChunkSeq: 1,
    lastChunkSeq: 1,
    chunkCount: 1,
    contentBytes: 0,
    contentSha256: '0'.repeat(64),
    archivedAt: input.createdAt,
    source: 'retention-prune'
  };
}

function createSmokeTrafficCompaction(input: { createdAt: string; requestId: string }): TrafficRollupCompaction {
  return {
    id: `traffic-compaction-smoke-${input.requestId}`,
    granularity: 'day',
    dimension: 'agent',
    subjectId: 'agent-archive-smoke',
    subjectLabel: 'Agent archive smoke',
    agentId: 'agent-archive-smoke',
    periodKey: 'archive-smoke',
    bucketStartAt: input.createdAt,
    bucketEndAt: input.createdAt,
    firstObservedAt: input.createdAt,
    lastObservedAt: input.createdAt,
    firstSampledAt: input.createdAt,
    lastSampledAt: input.createdAt,
    sampleCount: 1,
    ingressBytesTotal: 0,
    egressBytesTotal: 0,
    meteredBytesTotal: 0,
    compactedAt: input.createdAt,
    source: 'retention-prune'
  };
}

async function runCheck(checks: ArchiveSmokeCheck[], name: string, operation: () => Promise<void>) {
  try {
    await operation();
    checks.push({ name, status: 'passed' });
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

export function writeArchiveSmokeReport(path: string | undefined, report: ArchiveSmokeReport) {
  if (!path) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on non-POSIX filesystems.
  }
}

export function createArchiveSmokeHelp() {
  return `用法: production-archive-smoke [参数]

向当前配置的外部归档 sink 写入脱敏测试审计锚点、Agent 日志归档摘要和流量压缩归档桶。该命令会真实写入本地归档目录、外部归档 webhook 和 S3 兼容对象存储；报告不会写入 webhook token、对象存储密钥或完整 URL path/query。

参数:
  --env-file <path>  读取后端 env 文件，默认使用 OU_UI_ARCHIVE_SMOKE_ENV_FILE
  --report <path>    写入脱敏 JSON smoke 报告，默认使用 OU_UI_ARCHIVE_SMOKE_REPORT_PATH
  --help, -h         显示帮助
`;
}

export async function runArchiveSmoke(options: ArchiveSmokeRunOptions = {}): Promise<ArchiveSmokeRunResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true, text: createArchiveSmokeHelp() };
  }

  const envFile = args.envFile ?? env.OU_UI_ARCHIVE_SMOKE_ENV_FILE;
  const reportPath = args.reportPath ?? env.OU_UI_ARCHIVE_SMOKE_REPORT_PATH;
  const runtimeEnv = {
    ...readOptionalEnvFile(envFile),
    ...env
  };
  const config = resolveHttpControlPlaneRuntimeConfig(runtimeEnv).externalArchiveSink;

  if (!config) {
    throw new Error('未配置外部归档 sink。请配置 OU_UI_EXTERNAL_ARCHIVE_DIRECTORY、外部归档 webhook 或对象存储。');
  }

  const now = options.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const requestId = `archive-smoke-${randomUUID()}`;
  const deliveries: ArchiveSmokeDelivery[] = [];
  const createArchiveSink = options.createArchiveSink ?? createRuntimeControlPlaneArchiveSink;
  const createAuditAnchorSink = options.createAuditAnchorSink ?? createRuntimeControlPlaneAuditAnchorSink;
  const archiveSink = createArchiveSink(config, {
    onWebhookDelivery: (event) => deliveries.push(event),
    onObjectStorageDelivery: (event) => deliveries.push(event)
  });
  const auditAnchorSink = createAuditAnchorSink(config, {
    onWebhookDelivery: (event) => deliveries.push(event),
    onObjectStorageDelivery: (event) => deliveries.push(event)
  });

  if (!archiveSink || !auditAnchorSink) {
    throw new Error('外部归档 sink 初始化失败。');
  }

  const checks: ArchiveSmokeCheck[] = [];
  await runCheck(checks, 'audit anchor archive smoke', () =>
    auditAnchorSink.writeAuditAnchors([createSmokeAuditLog({ createdAt, requestId })], { anchoredAt: createdAt })
  );
  await runCheck(checks, 'agent log archive smoke', () =>
    archiveSink.writeAgentLogArchives([createSmokeAgentLogArchive({ createdAt, requestId })], { exportedAt: createdAt })
  );
  await runCheck(checks, 'traffic rollup compaction archive smoke', () =>
    archiveSink.writeTrafficRollupCompactions([createSmokeTrafficCompaction({ createdAt, requestId })], {
      exportedAt: createdAt
    })
  );

  const report: ArchiveSmokeReport = {
    schemaVersion: 'ou-ui-next.production-archive-smoke.v1',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    createdAt,
    requestId,
    externalArchiveSink: createArchiveSinkSummary(config),
    checks,
    deliveries
  };

  writeArchiveSmokeReport(reportPath, report);
  return { help: false, report };
}

async function main() {
  try {
    const result = await runArchiveSmoke();

    if (result.help) {
      process.stdout.write(result.text);
      return;
    }

    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);

    if (result.report.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`[OU-UI Next] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
