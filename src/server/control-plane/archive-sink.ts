import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentLogArchive, TrafficRollupCompaction } from '../../domain';
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

export type ExternalArchiveKind = 'agent-log-archive' | 'traffic-rollup-compaction';

export type ExternalArchiveEnvelope =
  | {
      schemaVersion: 'ou-ui-next.external-archive.v1';
      kind: 'agent-log-archive';
      exportedAt: string;
      recordId: string;
      record: AgentLogArchive;
    }
  | {
      schemaVersion: 'ou-ui-next.external-archive.v1';
      kind: 'traffic-rollup-compaction';
      exportedAt: string;
      recordId: string;
      record: TrafficRollupCompaction;
    };

export type ExternalArchiveSinkContext = {
  exportedAt: string;
};

export type ControlPlaneArchiveSink = {
  writeAgentLogArchives(archives: AgentLogArchive[], context: ExternalArchiveSinkContext): Promise<void>;
  writeTrafficRollupCompactions(
    compactions: TrafficRollupCompaction[],
    context: ExternalArchiveSinkContext
  ): Promise<void>;
};

export type FileControlPlaneArchiveSinkOptions = {
  directory: string;
};

export type ExternalArchiveWebhookBatch =
  | {
      schemaVersion: 'ou-ui-next.external-archive.batch.v1';
      kind: 'agent-log-archive';
      exportedAt: string;
      recordCount: number;
      records: Array<{
        recordId: string;
        record: AgentLogArchive;
      }>;
    }
  | {
      schemaVersion: 'ou-ui-next.external-archive.batch.v1';
      kind: 'traffic-rollup-compaction';
      exportedAt: string;
      recordCount: number;
      records: Array<{
        recordId: string;
        record: TrafficRollupCompaction;
      }>;
    };

export type ExternalArchiveWebhookDeliveryEvent = {
  event: 'external_archive.webhook.delivered' | 'external_archive.webhook.failed';
  url: string;
  kind: ExternalArchiveKind;
  recordCount: number;
  statusCode?: number;
  errorMessage?: string;
};

export type WebhookControlPlaneArchiveSinkOptions = {
  url: string;
  timeoutMs?: number;
  bearerToken?: string;
  egressPolicy?: Partial<RemoteEgressPolicy>;
  hostResolver?: RemoteHostResolver;
  fetcher?: typeof fetch;
  onDelivery?: (event: ExternalArchiveWebhookDeliveryEvent) => void;
};

export type RuntimeControlPlaneArchiveSinkConfig = {
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
};

export type RuntimeControlPlaneArchiveSinkDeliveryEvent = ExternalArchiveWebhookDeliveryEvent & {
  channelId: string;
  channelLabel: string;
};

export type RuntimeControlPlaneArchiveSinkFactoryOptions = {
  createWebhookSink?: (options: WebhookControlPlaneArchiveSinkOptions) => ControlPlaneArchiveSink;
  onWebhookDelivery?: (event: RuntimeControlPlaneArchiveSinkDeliveryEvent) => void;
};

function createJsonlContent(envelopes: ExternalArchiveEnvelope[]) {
  if (envelopes.length === 0) {
    return '';
  }

  return `${envelopes.map((envelope) => JSON.stringify(envelope)).join('\n')}\n`;
}

async function appendJsonl(directory: string, filename: string, envelopes: ExternalArchiveEnvelope[]) {
  if (envelopes.length === 0) {
    return;
  }

  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, filename), createJsonlContent(envelopes), 'utf8');
}

export function createFileControlPlaneArchiveSink(
  options: FileControlPlaneArchiveSinkOptions
): ControlPlaneArchiveSink {
  const directory = options.directory.trim();

  if (!directory) {
    throw new Error('External archive sink directory must not be empty.');
  }

  return {
    async writeAgentLogArchives(archives, context) {
      await appendJsonl(
        directory,
        'agent-log-archives.jsonl',
        archives.map((archive) => ({
          schemaVersion: 'ou-ui-next.external-archive.v1',
          kind: 'agent-log-archive',
          exportedAt: context.exportedAt,
          recordId: archive.id,
          record: archive
        }))
      );
    },

    async writeTrafficRollupCompactions(compactions, context) {
      await appendJsonl(
        directory,
        'traffic-rollup-compactions.jsonl',
        compactions.map((compaction) => ({
          schemaVersion: 'ou-ui-next.external-archive.v1',
          kind: 'traffic-rollup-compaction',
          exportedAt: context.exportedAt,
          recordId: compaction.id,
          record: compaction
        }))
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

type ExternalArchiveWebhookRemoteTarget = {
  url: URL;
  resolvedAddress: RemoteResolvedAddress;
  resolvedAddresses: RemoteResolvedAddress[];
};

async function resolveExternalArchiveWebhookRemoteTarget(
  url: URL,
  hostResolver: RemoteHostResolver,
  egressPolicy: RemoteEgressPolicy
): Promise<ExternalArchiveWebhookRemoteTarget> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('external archive webhook url protocol must be http or https');
  }

  if (isBlockedRemoteHost(url.hostname)) {
    throw new Error('external archive webhook host is not allowed for remote delivery');
  }

  if (!isRemoteHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('external archive webhook host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveAllowedRemoteAddresses(url.hostname, hostResolver, {
    unresolved: 'external archive webhook host could not be resolved for remote delivery',
    blockedResolvedHost: 'external archive webhook resolved host is not allowed for remote delivery'
  });

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function createExternalArchiveWebhookHeaders(target: URL, body: Buffer, bearerToken: string | undefined) {
  return {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    Host: target.host,
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
  };
}

function postPinnedExternalArchiveWebhook({
  target,
  body,
  bearerToken,
  timeoutMs,
  signal
}: {
  target: ExternalArchiveWebhookRemoteTarget;
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
        headers: createExternalArchiveWebhookHeaders(target.url, body, bearerToken),
        servername: target.url.hostname,
        signal,
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`External archive webhook responded with HTTP ${statusCode}`)));
          return;
        }

        response.on('end', () => finish(() => resolve(statusCode)));
        response.on('error', (error) => finish(() => reject(error)));
        response.resume();
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`External archive webhook timed out after ${timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end(body);
  });
}

function createAgentLogArchiveWebhookBatch(
  archives: AgentLogArchive[],
  context: ExternalArchiveSinkContext
): ExternalArchiveWebhookBatch {
  return {
    schemaVersion: 'ou-ui-next.external-archive.batch.v1',
    kind: 'agent-log-archive',
    exportedAt: context.exportedAt,
    recordCount: archives.length,
    records: archives.map((archive) => ({
      recordId: archive.id,
      record: archive
    }))
  };
}

function createTrafficRollupCompactionWebhookBatch(
  compactions: TrafficRollupCompaction[],
  context: ExternalArchiveSinkContext
): ExternalArchiveWebhookBatch {
  return {
    schemaVersion: 'ou-ui-next.external-archive.batch.v1',
    kind: 'traffic-rollup-compaction',
    exportedAt: context.exportedAt,
    recordCount: compactions.length,
    records: compactions.map((compaction) => ({
      recordId: compaction.id,
      record: compaction
    }))
  };
}

export function createWebhookControlPlaneArchiveSink({
  url,
  timeoutMs = 5000,
  bearerToken,
  egressPolicy,
  hostResolver = defaultRemoteHostResolver,
  fetcher,
  onDelivery
}: WebhookControlPlaneArchiveSinkOptions): ControlPlaneArchiveSink {
  const targetUrl = new URL(url);
  const logUrl = sanitizeWebhookUrlForLog(url);
  const normalizedEgressPolicy = normalizeRemoteEgressPolicy(egressPolicy);

  async function postBatch(batch: ExternalArchiveWebhookBatch) {
    if (batch.recordCount === 0) {
      return;
    }

    const controller = new AbortController();
    const normalizedTimeoutMs = Math.max(1, Math.round(timeoutMs));
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const target = await resolveExternalArchiveWebhookRemoteTarget(targetUrl, hostResolver, normalizedEgressPolicy);
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
              throw new Error(`External archive webhook responded with HTTP ${response.status}`);
            }

            return response.status;
          })
        : await postPinnedExternalArchiveWebhook({
            target,
            body,
            bearerToken,
            timeoutMs: normalizedTimeoutMs,
            signal: controller.signal
          });

      onDelivery?.({
        event: 'external_archive.webhook.delivered',
        url: logUrl,
        kind: batch.kind,
        recordCount: batch.recordCount,
        statusCode
      });
    } catch (error) {
      onDelivery?.({
        event: 'external_archive.webhook.failed',
        url: logUrl,
        kind: batch.kind,
        recordCount: batch.recordCount,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async writeAgentLogArchives(archives, context) {
      await postBatch(createAgentLogArchiveWebhookBatch(archives, context));
    },

    async writeTrafficRollupCompactions(compactions, context) {
      await postBatch(createTrafficRollupCompactionWebhookBatch(compactions, context));
    }
  };
}

async function writeToAllArchiveSinks(
  sinks: ControlPlaneArchiveSink[],
  write: (sink: ControlPlaneArchiveSink) => Promise<void>
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
      `${errors.length} external archive sink writes failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`
    );
  }
}

export function createCompositeControlPlaneArchiveSink(sinks: ControlPlaneArchiveSink[]): ControlPlaneArchiveSink {
  const activeSinks = sinks.slice();

  if (activeSinks.length === 0) {
    throw new Error('Composite external archive sink requires at least one sink.');
  }

  return {
    async writeAgentLogArchives(archives, context) {
      await writeToAllArchiveSinks(activeSinks, (sink) => sink.writeAgentLogArchives(archives, context));
    },

    async writeTrafficRollupCompactions(compactions, context) {
      await writeToAllArchiveSinks(activeSinks, (sink) =>
        sink.writeTrafficRollupCompactions(compactions, context)
      );
    }
  };
}

export function createRuntimeControlPlaneArchiveSink(
  config: RuntimeControlPlaneArchiveSinkConfig | undefined,
  options: RuntimeControlPlaneArchiveSinkFactoryOptions = {}
) {
  const createWebhookSink = options.createWebhookSink ?? createWebhookControlPlaneArchiveSink;
  const sinks = [
    ...(config?.directory
      ? [
          createFileControlPlaneArchiveSink({
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
      : [])
  ];

  if (sinks.length === 0) {
    return undefined;
  }

  return sinks.length === 1 ? sinks[0] : createCompositeControlPlaneArchiveSink(sinks);
}
