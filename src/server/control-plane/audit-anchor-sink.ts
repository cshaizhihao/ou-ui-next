import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditLog } from '../../domain';
import {
  defaultRemoteHostResolver,
  isBlockedRemoteHost,
  isRemoteHostAllowedByEgressPolicy,
  normalizeRemoteEgressPolicy,
  resolveAllowedRemoteAddresses,
  type RemoteEgressPolicy,
  type RemoteHostResolver,
  type RemoteResolvedAddress
} from '../../services/api/remote-egress-policy';
import type { ControlPlaneRepository, ControlPlaneTransaction } from './control-plane-repository';
import {
  createObjectStorageJsonKey,
  createS3CompatibleObjectStorageWriter,
  sanitizeObjectStorageEndpointForLog,
  type RuntimeObjectStorageSinkConfig,
  type S3CompatibleObjectStorageWriter,
  type S3CompatibleObjectStorageWriterOptions
} from './object-storage-sink';

export type AuditAnchorRecord = {
  auditLogId: string;
  action: AuditLog['action'];
  operation: AuditLog['operation'];
  result: AuditLog['result'];
  severity: AuditLog['severity'];
  actor: string;
  scope: string;
  resourceType: AuditLog['resourceType'];
  targetId: string;
  taskId: string;
  requestId: string;
  createdAt: string;
  hash: string;
  prevHash: string;
};

export type AuditAnchorEnvelope = {
  schemaVersion: 'ou-ui-next.audit-anchor.v1';
  anchoredAt: string;
  audit: AuditAnchorRecord;
};

export type AuditAnchorSinkContext = {
  anchoredAt: string;
};

export type ControlPlaneAuditAnchorSink = {
  writeAuditAnchors(auditLogs: AuditLog[], context: AuditAnchorSinkContext): Promise<void>;
};

export type AuditAnchorSinkBatch = {
  auditLogs: AuditLog[];
  anchoredAt: string;
};

export type ControlPlaneAuditAnchorSinkErrorHandler = (error: unknown, batch: AuditAnchorSinkBatch) => void;

export type FileControlPlaneAuditAnchorSinkOptions = {
  directory: string;
};

export type AuditAnchorWebhookBatch = {
  schemaVersion: 'ou-ui-next.audit-anchor.batch.v1';
  anchoredAt: string;
  recordCount: number;
  anchors: AuditAnchorEnvelope[];
};

export type AuditAnchorWebhookDeliveryEvent = {
  event: 'audit_anchor.webhook.delivered' | 'audit_anchor.webhook.failed';
  url: string;
  recordCount: number;
  statusCode?: number;
  errorMessage?: string;
};

export type WebhookControlPlaneAuditAnchorSinkOptions = {
  url: string;
  timeoutMs?: number;
  bearerToken?: string;
  egressPolicy?: Partial<RemoteEgressPolicy>;
  hostResolver?: RemoteHostResolver;
  fetcher?: typeof fetch;
  onDelivery?: (event: AuditAnchorWebhookDeliveryEvent) => void;
};

export type AuditAnchorObjectStorageDeliveryEvent = {
  event: 'audit_anchor.object_storage.delivered' | 'audit_anchor.object_storage.failed';
  endpoint: string;
  bucket: string;
  key: string;
  recordCount: number;
  statusCode?: number;
  errorMessage?: string;
};

export type ObjectStorageControlPlaneAuditAnchorSinkOptions = S3CompatibleObjectStorageWriterOptions & {
  writer?: S3CompatibleObjectStorageWriter;
  onDelivery?: (event: AuditAnchorObjectStorageDeliveryEvent) => void;
};

export type RuntimeControlPlaneAuditAnchorSinkConfig = {
  directory?: string;
  webhook?: {
    targets: Array<{
      id: string;
      label: string;
      url: string;
    }>;
    timeoutMs?: number;
    egress?: Partial<RemoteEgressPolicy>;
    bearerToken?: string;
  };
  objectStorage?: RuntimeObjectStorageSinkConfig;
};

export type RuntimeControlPlaneAuditAnchorSinkDeliveryEvent = AuditAnchorWebhookDeliveryEvent & {
  channelId: string;
  channelLabel: string;
};

export type RuntimeControlPlaneAuditAnchorSinkObjectStorageDeliveryEvent = AuditAnchorObjectStorageDeliveryEvent;

export type RuntimeControlPlaneAuditAnchorSinkFactoryOptions = {
  createWebhookSink?: (options: WebhookControlPlaneAuditAnchorSinkOptions) => ControlPlaneAuditAnchorSink;
  createObjectStorageSink?: (options: ObjectStorageControlPlaneAuditAnchorSinkOptions) => ControlPlaneAuditAnchorSink;
  onWebhookDelivery?: (event: RuntimeControlPlaneAuditAnchorSinkDeliveryEvent) => void;
  onObjectStorageDelivery?: (event: RuntimeControlPlaneAuditAnchorSinkObjectStorageDeliveryEvent) => void;
};

export type AuditAnchorRepositoryOptions = {
  sink: ControlPlaneAuditAnchorSink;
  now?: () => string;
  onError?: ControlPlaneAuditAnchorSinkErrorHandler;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createAuditAnchorRecord(auditLog: AuditLog): AuditAnchorRecord {
  return {
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
    hash: auditLog.hash ?? '',
    prevHash: auditLog.prevHash ?? ''
  };
}

function createAuditAnchorEnvelopes(auditLogs: AuditLog[], anchoredAt: string): AuditAnchorEnvelope[] {
  return auditLogs.map((auditLog) => ({
    schemaVersion: 'ou-ui-next.audit-anchor.v1',
    anchoredAt,
    audit: createAuditAnchorRecord(auditLog)
  }));
}

function createJsonlContent(envelopes: AuditAnchorEnvelope[]) {
  if (envelopes.length === 0) {
    return '';
  }

  return `${envelopes.map((envelope) => JSON.stringify(envelope)).join('\n')}\n`;
}

export function createFileControlPlaneAuditAnchorSink(
  options: FileControlPlaneAuditAnchorSinkOptions
): ControlPlaneAuditAnchorSink {
  const directory = options.directory.trim();

  if (!directory) {
    throw new Error('Audit anchor sink directory must not be empty.');
  }

  return {
    async writeAuditAnchors(auditLogs, context) {
      if (auditLogs.length === 0) {
        return;
      }

      await mkdir(directory, { recursive: true });
      await appendFile(
        join(directory, 'audit-anchors.jsonl'),
        createJsonlContent(createAuditAnchorEnvelopes(auditLogs, context.anchoredAt)),
        'utf8'
      );
    }
  };
}

function sanitizeWebhookUrlForLog(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-url';
  }
}

type AuditAnchorWebhookRemoteTarget = {
  url: URL;
  resolvedAddress: RemoteResolvedAddress;
  resolvedAddresses: RemoteResolvedAddress[];
};

async function resolveAuditAnchorWebhookRemoteTarget(
  url: URL,
  hostResolver: RemoteHostResolver,
  egressPolicy: RemoteEgressPolicy
): Promise<AuditAnchorWebhookRemoteTarget> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('audit anchor webhook url protocol must be http or https');
  }

  if (isBlockedRemoteHost(url.hostname)) {
    throw new Error('audit anchor webhook host is not allowed for remote delivery');
  }

  if (!isRemoteHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('audit anchor webhook host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveAllowedRemoteAddresses(url.hostname, hostResolver, {
    unresolved: 'audit anchor webhook host could not be resolved for remote delivery',
    blockedResolvedHost: 'audit anchor webhook resolved host is not allowed for remote delivery'
  });

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function createAuditAnchorWebhookHeaders(target: URL, body: Buffer, bearerToken: string | undefined) {
  return {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    Host: target.host,
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
  };
}

function postPinnedAuditAnchorWebhook({
  target,
  body,
  bearerToken,
  timeoutMs,
  signal
}: {
  target: AuditAnchorWebhookRemoteTarget;
  body: Buffer;
  bearerToken?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<number> {
  const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const port =
    target.url.port || (target.url.protocol === 'https:' ? '443' : target.url.protocol === 'http:' ? '80' : undefined);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };
    const request = transport(
      {
        protocol: target.url.protocol,
        hostname: target.resolvedAddress.address,
        port,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        headers: createAuditAnchorWebhookHeaders(target.url, body, bearerToken),
        servername: target.url.hostname,
        signal,
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`Audit anchor webhook responded with HTTP ${statusCode}`)));
          return;
        }

        response.on('end', () => finish(() => resolve(statusCode)));
        response.on('error', (error) => finish(() => reject(error)));
        response.resume();
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`Audit anchor webhook timed out after ${timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end(body);
  });
}

function createAuditAnchorWebhookBatch(
  auditLogs: AuditLog[],
  context: AuditAnchorSinkContext
): AuditAnchorWebhookBatch {
  return {
    schemaVersion: 'ou-ui-next.audit-anchor.batch.v1',
    anchoredAt: context.anchoredAt,
    recordCount: auditLogs.length,
    anchors: createAuditAnchorEnvelopes(auditLogs, context.anchoredAt)
  };
}

export function createWebhookControlPlaneAuditAnchorSink({
  url,
  timeoutMs = 5000,
  bearerToken,
  egressPolicy,
  hostResolver = defaultRemoteHostResolver,
  fetcher,
  onDelivery
}: WebhookControlPlaneAuditAnchorSinkOptions): ControlPlaneAuditAnchorSink {
  const targetUrl = new URL(url);
  const logUrl = sanitizeWebhookUrlForLog(url);
  const normalizedEgressPolicy = normalizeRemoteEgressPolicy(egressPolicy);

  async function postBatch(batch: AuditAnchorWebhookBatch) {
    if (batch.recordCount === 0) {
      return;
    }

    const controller = new AbortController();
    const normalizedTimeoutMs = Math.max(1, Math.round(timeoutMs));
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const target = await resolveAuditAnchorWebhookRemoteTarget(targetUrl, hostResolver, normalizedEgressPolicy);
      const bodyText = JSON.stringify(batch);
      const body = Buffer.from(bodyText, 'utf8');
      const statusCode = fetcher
        ? await fetcher(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
            },
            body: bodyText,
            signal: controller.signal
          }).then((response) => {
            if (!response.ok) {
              throw new Error(`Audit anchor webhook responded with HTTP ${response.status}`);
            }

            return response.status;
          })
        : await postPinnedAuditAnchorWebhook({
            target,
            body,
            bearerToken,
            timeoutMs: normalizedTimeoutMs,
            signal: controller.signal
          });

      onDelivery?.({
        event: 'audit_anchor.webhook.delivered',
        url: logUrl,
        recordCount: batch.recordCount,
        statusCode
      });
    } catch (error) {
      onDelivery?.({
        event: 'audit_anchor.webhook.failed',
        url: logUrl,
        recordCount: batch.recordCount,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async writeAuditAnchors(auditLogs, context) {
      await postBatch(createAuditAnchorWebhookBatch(auditLogs, context));
    }
  };
}

async function writeAllObjectStorageAuditAnchors({
  envelopes,
  writer,
  prefix,
  endpoint,
  bucket,
  onDelivery
}: {
  envelopes: AuditAnchorEnvelope[];
  writer: S3CompatibleObjectStorageWriter;
  prefix?: string;
  endpoint: string;
  bucket: string;
  onDelivery?: (event: AuditAnchorObjectStorageDeliveryEvent) => void;
}) {
  const errors: unknown[] = [];

  for (const envelope of envelopes) {
    const key = createObjectStorageJsonKey({
      prefix,
      kind: 'audit-anchor',
      timestamp: envelope.anchoredAt,
      recordId: envelope.audit.auditLogId
    });

    try {
      const statusCode = await writer.putJsonObject(key, envelope);

      onDelivery?.({
        event: 'audit_anchor.object_storage.delivered',
        endpoint,
        bucket,
        key,
        recordCount: 1,
        statusCode
      });
    } catch (error) {
      onDelivery?.({
        event: 'audit_anchor.object_storage.failed',
        endpoint,
        bucket,
        key,
        recordCount: 1,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new Error(
      `${errors.length} audit anchor object storage writes failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`
    );
  }
}

export function createObjectStorageControlPlaneAuditAnchorSink({
  writer,
  onDelivery,
  ...options
}: ObjectStorageControlPlaneAuditAnchorSinkOptions): ControlPlaneAuditAnchorSink {
  const objectWriter = writer ?? createS3CompatibleObjectStorageWriter(options);
  const endpoint = sanitizeObjectStorageEndpointForLog(options.endpoint);
  const bucket = options.bucket.trim();

  return {
    async writeAuditAnchors(auditLogs, context) {
      await writeAllObjectStorageAuditAnchors({
        envelopes: createAuditAnchorEnvelopes(auditLogs, context.anchoredAt),
        writer: objectWriter,
        prefix: options.prefix,
        endpoint,
        bucket,
        onDelivery
      });
    }
  };
}

async function writeToAllAuditAnchorSinks(
  sinks: ControlPlaneAuditAnchorSink[],
  write: (sink: ControlPlaneAuditAnchorSink) => Promise<void>
) {
  const errors: unknown[] = [];

  for (const sink of sinks) {
    try {
      await write(sink);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new Error(
      `${errors.length} audit anchor sink writes failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`
    );
  }
}

export function createCompositeControlPlaneAuditAnchorSink(
  sinks: ControlPlaneAuditAnchorSink[]
): ControlPlaneAuditAnchorSink {
  const activeSinks = sinks.slice();

  if (activeSinks.length === 0) {
    throw new Error('Composite audit anchor sink requires at least one sink.');
  }

  return {
    async writeAuditAnchors(auditLogs, context) {
      await writeToAllAuditAnchorSinks(activeSinks, (sink) => sink.writeAuditAnchors(auditLogs, context));
    }
  };
}

export function createRuntimeControlPlaneAuditAnchorSink(
  config: RuntimeControlPlaneAuditAnchorSinkConfig | undefined,
  options: RuntimeControlPlaneAuditAnchorSinkFactoryOptions = {}
) {
  const createWebhookSink = options.createWebhookSink ?? createWebhookControlPlaneAuditAnchorSink;
  const createObjectStorageSink = options.createObjectStorageSink ?? createObjectStorageControlPlaneAuditAnchorSink;
  const sinks = [
    ...(config?.directory
      ? [
          createFileControlPlaneAuditAnchorSink({
            directory: config.directory
          })
        ]
      : []),
    ...(config?.webhook
      ? config.webhook.targets.map((target) =>
          createWebhookSink({
            url: target.url,
            timeoutMs: config.webhook?.timeoutMs,
            bearerToken: config.webhook?.bearerToken,
            egressPolicy: config.webhook?.egress,
            onDelivery: (event) =>
              options.onWebhookDelivery?.({
                ...event,
                channelId: target.id,
                channelLabel: target.label
              })
          })
        )
      : []),
    ...(config?.objectStorage
      ? [
          createObjectStorageSink({
            endpoint: config.objectStorage.endpoint,
            bucket: config.objectStorage.bucket,
            region: config.objectStorage.region,
            accessKeyId: config.objectStorage.accessKeyId,
            secretAccessKey: config.objectStorage.secretAccessKey,
            sessionToken: config.objectStorage.sessionToken,
            prefix: config.objectStorage.prefix,
            timeoutMs: config.objectStorage.timeoutMs,
            forcePathStyle: config.objectStorage.forcePathStyle,
            egressPolicy: config.objectStorage.egress,
            onDelivery: options.onObjectStorageDelivery
          })
        ]
      : [])
  ];

  if (sinks.length === 0) {
    return undefined;
  }

  return sinks.length === 1 ? sinks[0] : createCompositeControlPlaneAuditAnchorSink(sinks);
}

function createAnchoredTransaction(
  transaction: ControlPlaneTransaction,
  auditLogs: AuditLog[]
): ControlPlaneTransaction {
  return {
    ...transaction,
    async insertAuditLog(auditLog) {
      await transaction.insertAuditLog(auditLog);
      auditLogs.push(clone(auditLog));
    }
  };
}

async function writeAuditAnchorBatch(
  sink: ControlPlaneAuditAnchorSink,
  batch: AuditAnchorSinkBatch,
  onError: ControlPlaneAuditAnchorSinkErrorHandler | undefined
) {
  if (batch.auditLogs.length === 0) {
    return;
  }

  try {
    await sink.writeAuditAnchors(batch.auditLogs, { anchoredAt: batch.anchoredAt });
  } catch (error) {
    if (onError) {
      try {
        onError(error, batch);
      } catch (handlerError) {
        console.error('OU-UI Next audit anchor sink error handler failed:', handlerError);
      }
    } else {
      console.error('OU-UI Next audit anchor sink write failed:', error);
    }
  }
}

export function withAuditAnchorSink(
  repository: ControlPlaneRepository,
  options: AuditAnchorRepositoryOptions
): ControlPlaneRepository {
  return {
    ...repository,
    async transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>) {
      const auditLogs: AuditLog[] = [];
      const result = await repository.transaction((transaction) => run(createAnchoredTransaction(transaction, auditLogs)));

      await writeAuditAnchorBatch(
        options.sink,
        {
          auditLogs,
          anchoredAt: options.now?.() ?? new Date().toISOString()
        },
        options.onError
      );

      return result;
    }
  };
}
