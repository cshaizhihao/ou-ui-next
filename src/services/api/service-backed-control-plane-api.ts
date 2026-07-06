import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type {
  Agent,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AgentUpgradeCommandRequest,
  AgentSessionSummary,
  AuditLog,
  CreateTaskInput,
  CustomerReadModel,
  DeployTask,
  DeployTaskStatus,
  ForwardRule,
  ManagedNode,
  OperatorSessionRevokeRequest,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionClientOutputFormat,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceSyncBudget,
  SubscriptionSourceSyncResult,
  SystemAlert,
  TelegramBindingChallenge,
  TelegramBindingReadModel,
  TelegramBotSettings,
  TelegramChatBinding,
  TelegramCustomerBinding,
  TelegramLongPollingResult,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy,
  TelegramNotificationType,
  TelegramSubscriptionFormat,
  TelegramWebhookHandleResult,
  TelegramWebhookUpdate,
  TuningProfile,
  XrayInbound
} from '../../domain';
import {
  applyAgentTask,
  applyForwardRuleTask,
  applySubscriptionClientTask,
  applySubscriptionExportProfileTask,
  applySubscriptionSourceTask,
  applyXrayInboundTask,
  createCustomersFromReadModels,
  createSubscriptionClientFromTask,
  createSubscriptionBundlesFromInventory,
  countCrossSourceSubscriptionInventoryDuplicates,
  createProxyProvidersFromSources,
  createSubscriptionExportFilesFromClients,
  createSubscriptionExportProfileFromTask,
  readSubscriptionExportProfileDeleteId,
  createSubscriptionSourceFromTask,
  DEFAULT_AGENT_TELEMETRY_SAMPLE_INTERVAL_SECONDS,
  readSubscriptionSourceDeleteId,
  resolveMonthlyBillingPeriodKey,
  telegramSubscriptionFormats
} from '../../domain';
import { calculateForwardingBilledBytes } from '../../domain/forwarding';
import type {
  AgentCredentialRecord,
  AgentSessionState,
  ControlPlaneRepository,
  ControlPlaneRepositoryState,
  ControlPlaneTransaction,
  PersistedSystemAlertRecord,
  TelegramBotSecretState
} from '../../server/control-plane/control-plane-repository';
import {
  normalizeAgentLogRetentionPolicy,
  type AgentLogRetentionPolicy
} from '../../server/control-plane/agent-log-retention';
import {
  normalizeTrafficRollupRetentionPolicy,
  type TrafficRollupRetentionPolicy
} from '../../server/control-plane/traffic-rollup-retention';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import type { OperatorSessionStore } from '../../server/control-plane/operator-session-store';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import { applyAgentEventToReadModel, applyAgentLivenessToReadModel } from './agent-telemetry-read-model';
import {
  applyForwardingBillingWindowToReadModel,
  applyForwardingTelemetryToReadModel
} from './forwarding-telemetry-read-model';
import { applyXrayTelemetryToReadModel, applyXrayTrafficWindowToReadModel } from './xray-telemetry-read-model';
import type {
  AgentRequestDeniedAuditInput,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput,
  AuditChainVerification,
  CommandOutboxItem,
  ControlPlaneApi,
  ControlPlaneRuntimeObservabilityMetricsArgument,
  MutationContext,
  OperatorRequestDeniedAuditInput,
  TelegramNotificationDeliveryRetryOptions,
  TelegramNotificationDeliveryRetryResult,
  TelegramNotificationScheduleScanResult,
  TelegramNotificationScheduleScanSkipReason,
  TrafficRollupRetentionPolicyReadModel,
  TrafficRollupRetentionPolicyValues,
  TrafficRollupRetentionPolicyUpdateInput
} from './control-plane-api';
import {
  createAgentLogExport,
  createAgentLogArchiveExport,
  createObservabilityMetrics,
  createTrafficRollupCompactionExport,
  createTrafficRollupExport,
  selectAgentLogChunks,
  selectAgentLogArchives,
  selectTrafficRollupCompactions,
  selectTrafficRollups,
  summarizeRuntimeConfigRevisionForSnapshot,
  summarizeCommandOutboxItem,
  v1ApiBoundary
} from './control-plane-api';
import { createQuotaPoliciesFromReadModels } from './quota-policies';
import { deriveForwardQuotaEnforcementTaskIntents } from './forward-quota-enforcement-tasks';
import { deriveXrayGuardrailTaskIntents } from './xray-guardrail-enforcement-tasks';
import { createXrayClientActionTaskPlan } from './xray-client-action-tasks';
import { findXrayInboundPortConflictDenial } from './xray-inbound-port-conflicts';
import {
  applyQuotaResetStateToAgentEvent,
  applyQuotaResetStateToForwardingEvent,
  applyQuotaResetStateToXrayEvent,
  createQuotaResetTaskInput,
  applyQuotaResetTaskToAgents,
  applyQuotaResetTaskToForwardRules,
  applyQuotaResetTaskToInbounds,
  applyQuotaResetTaskToSubscriptionClients,
  applyQuotaResetTasksToExplicitPolicies,
  createQuotaResetReplayState,
  prepareQuotaResetTaskInput,
  readLatestSubscriptionClientResetDescriptor
} from './quota-reset-tasks';
import { projectSubscriptionClientRuntimeState, type PublicSubscriptionFormat } from './subscription-output';
import { parseSubscriptionSourceContent } from './subscription-source-parser';
import {
  applyTelegramBotSettingsUpdate,
  applyTelegramNotificationPolicyUpdate,
  createDefaultTelegramBotSettings,
  createDefaultTelegramNotificationPolicy,
  createStableTelegramHash,
  createTelegramBinding as createTelegramBindingRecord,
  createTelegramBindingChallenge as createTelegramBindingChallengeRecord,
  createTelegramBindingModels,
  createTelegramTestDelivery,
  fetchTelegramBotUpdates,
  redactTelegramBotSettingsAudit,
  sanitizeTelegramBotErrorMessage,
  sendTelegramBotMessage,
  TELEGRAM_DEFAULT_POLICY_ID
} from './telegram-bot';
import {
  defaultRemoteHostResolver,
  isBlockedRemoteHost,
  isRemoteHostAllowedByEgressPolicy,
  normalizeRemoteEgressPolicy,
  normalizeRemoteHostname,
  resolveAllowedRemoteAddresses,
  type RemoteEgressPolicy,
  type RemoteHostResolver,
  type RemoteResolvedAddress
} from './remote-egress-policy';
import {
  createSystemAlertsFromAgents,
  createSystemAlertsFromCommandOutbox,
  createSystemAlertsFromQuotaPolicies,
  createSystemAlertsFromRuntimeTasks,
  createSystemAlertsFromSubscriptionSources,
  createSystemAlertsFromSystemAlertNotifications
} from './system-alerts';
import type {
  SystemAlertNotification,
  SystemAlertNotificationBatch,
  SystemAlertNotificationChannel,
  SystemAlertNotificationDeliveryRecord,
  SystemAlertNotifier,
  SystemAlertNotificationRetryOptions,
  SystemAlertNotificationRetryResult,
  SystemAlertNotificationType
} from './system-alert-notifications';

type ControlPlaneService = ReturnType<typeof createControlPlaneService>;

type ServiceBackedControlPlaneApiInput = {
  repository: ControlPlaneRepository;
  service: ControlPlaneService;
  operatorSessionStore?: OperatorSessionStore;
  inventory?: Partial<{
    agents: Agent[];
    nodes: ManagedNode[];
    inbounds: XrayInbound[];
    subscriptionSources: SubscriptionSource[];
    subscriptionInventoryNodes: SubscriptionInventoryNode[];
    subscriptionBundles: SubscriptionBundle[];
    subscriptionClients: SubscriptionClientIdentity[];
    subscriptionExportProfiles: SubscriptionExportProfile[];
    quotaPolicies: QuotaPolicy[];
    rateLimitPolicies: RateLimitPolicy[];
    routingPolicies: RoutingPolicy[];
    tuningProfiles: TuningProfile[];
  }>;
  fetcher?: typeof fetch;
  telegramBotHostResolver?: RemoteHostResolver;
  telegramBotEgressEnforcement?: boolean;
  subscriptionSourceRemoteFetcher?: SubscriptionSourceRemoteFetcher;
  subscriptionSourceHostResolver?: SubscriptionSourceHostResolver;
  subscriptionSourceFetch?: Partial<SubscriptionSourceFetchPolicy>;
  subscriptionSourceEgress?: Partial<SubscriptionSourceEgressPolicy>;
  subscriptionSourceProviderBudget?: Partial<SubscriptionSourceProviderBudgetPolicy>;
  subscriptionSourceSyncBudget?: Partial<SubscriptionSourceSyncBudgetPolicy>;
  agentLogRetention?: Partial<AgentLogRetentionPolicy>;
  trafficRollupRetention?: Partial<TrafficRollupRetentionPolicy>;
  systemAlertNotifier?: SystemAlertNotifier;
  systemAlertNotificationChannels?: SystemAlertNotificationChannel[];
  systemAlertNotificationRetry?: Partial<SystemAlertNotificationRetryPolicy>;
  readModelNow?: () => string;
};

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const SUBSCRIPTION_SOURCE_FETCH_TIMEOUT_MS = 20_000;
const SUBSCRIPTION_SOURCE_MAX_BODY_BYTES = 5 * 1024 * 1024;
const SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const TELEGRAM_BOT_API_ALLOWED_PROTOCOLS = new Set(['https:']);
const TELEGRAM_BOT_PROXY_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);
const SUBSCRIPTION_SOURCE_SYNC_LEASE_MIN_MS = 60_000;
const SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST = 2;

const AGENT_LOG_RETENTION_DAY_MS = 24 * 60 * 60 * 1000;
const TRAFFIC_ROLLUP_RETENTION_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AGENT_PROFILE_EXPIRY_DAY_MS = 90 * 24 * 60 * 60 * 1000;
const SYSTEM_ALERT_NOTIFICATION_DELIVERY_HISTORY_LIMIT = 500;
const SYSTEM_ALERT_NOTIFICATION_RETRY_DELAY_MS = 60_000;
const SYSTEM_ALERT_NOTIFICATION_MAX_ATTEMPTS = 3;
const SYSTEM_ALERT_NOTIFICATION_MAX_DELIVERIES_PER_SWEEP = 25;
const DEFAULT_SYSTEM_ALERT_NOTIFICATION_CHANNEL_ID = 'default-webhook';
const RECENT_HIGH_FREQUENCY_AGENT_EVENT_REPLAY_LIMIT = 500;
const SNAPSHOT_TRAFFIC_ROLLUP_LIMIT = 500;

type SubscriptionSourceFetchPolicy = {
  timeoutMs: number;
  maxBodyBytes: number;
};

type SubscriptionSourceEgressPolicy = RemoteEgressPolicy;

type SubscriptionSourceProviderBudgetPolicy = {
  maxConcurrentFetchesPerHost: number;
};

type SubscriptionSourceSyncBudgetPolicy = {
  maxFetchesPerDay?: number;
  maxBytesPerDay?: number;
};

type SystemAlertNotificationRetryPolicy = {
  retryDelayMs: number;
  maxAttempts: number;
  maxDeliveriesPerSweep: number;
};

type SubscriptionSourceResolvedAddress = RemoteResolvedAddress;

type SubscriptionSourceHostResolver = RemoteHostResolver;

type SubscriptionSourceRemoteTarget = {
  url: URL;
  resolvedAddress: SubscriptionSourceResolvedAddress;
  resolvedAddresses: SubscriptionSourceResolvedAddress[];
};

type SubscriptionSourceRemoteFetcherInput = {
  source: SubscriptionSource;
  target: SubscriptionSourceRemoteTarget;
  headers: Record<string, string>;
  policy: SubscriptionSourceFetchPolicy;
  signal: AbortSignal;
};

type SubscriptionSourceRemoteFetcher = (
  input: SubscriptionSourceRemoteFetcherInput
) => Promise<FetchedSubscriptionSourceContent>;

type FetchedSubscriptionSourceContent = {
  body: string;
  bodyBytes?: number;
  trafficHeader?: string | null;
};

const defaultSubscriptionSourceHostResolver = defaultRemoteHostResolver;
const defaultTelegramBotHostResolver = defaultRemoteHostResolver;

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }

  return value;
}

function createStableSha256LikeHash(value: unknown) {
  const normalized = JSON.stringify(normalizeForHash(value));
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function parseTimestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toIsoAfter(value: string, delayMs: number) {
  return new Date(parseTimestampMs(value) + Math.max(1, Math.round(delayMs))).toISOString();
}

function readTelegramProxyPort(url: URL) {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }

  return url.protocol === 'https:' ? 443 : url.protocol === 'socks5:' ? 1080 : 80;
}

function createTelegramProxyAuthorizationHeader(proxyUrl: URL) {
  if (!proxyUrl.username && !proxyUrl.password) {
    return undefined;
  }

  return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`;
}

function connectSocket(input: {
  host: string;
  port: number;
  secure?: boolean;
  servername?: string;
  signal?: AbortSignal;
}) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = input.secure
      ? tlsConnect({
          host: input.host,
          port: input.port,
          servername: input.servername ?? input.host
        })
      : netConnect({
          host: input.host,
          port: input.port
        });
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('secureConnect', onConnect);
      socket.off('error', onError);
      input.signal?.removeEventListener('abort', onAbort);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error('telegram bot proxy request aborted'));
    };

    socket.once(input.secure ? 'secureConnect' : 'connect', onConnect);
    socket.once('error', onError);

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
      } else {
        input.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

function readSocketUntilHeader(socket: Socket, signal?: AbortSignal) {
  return new Promise<{ header: string; rest: Buffer }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      signal?.removeEventListener('abort', onAbort);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const buffered = Buffer.concat(chunks);
      const headerEnd = buffered.indexOf('\r\n\r\n');

      if (headerEnd >= 0) {
        cleanup();
        resolve({
          header: buffered.subarray(0, headerEnd).toString('utf8'),
          rest: buffered.subarray(headerEnd + 4)
        });
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('telegram bot proxy connection ended before response headers'));
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error('telegram bot proxy request aborted'));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

function encodeSocks5String(value: string, label: string) {
  const buffer = Buffer.from(value);

  if (buffer.length > 255) {
    throw new Error(`telegram bot proxy ${label} is too long`);
  }

  return buffer;
}

async function createTelegramHttpProxyTunnel(proxyUrl: URL, targetUrl: URL, signal?: AbortSignal) {
  const proxySocket = await connectSocket({
    host: proxyUrl.hostname,
    port: readTelegramProxyPort(proxyUrl),
    secure: proxyUrl.protocol === 'https:',
    servername: proxyUrl.hostname,
    signal
  });
  const targetPort = targetUrl.port ? Number.parseInt(targetUrl.port, 10) : targetUrl.protocol === 'https:' ? 443 : 80;
  const proxyAuthorization = createTelegramProxyAuthorizationHeader(proxyUrl);

  proxySocket.write(
    [
      `CONNECT ${targetUrl.hostname}:${targetPort} HTTP/1.1`,
      `Host: ${targetUrl.hostname}:${targetPort}`,
      ...(proxyAuthorization ? [`Proxy-Authorization: ${proxyAuthorization}`] : []),
      'Proxy-Connection: Keep-Alive',
      'Connection: keep-alive',
      '',
      ''
    ].join('\r\n')
  );

  const { header, rest } = await readSocketUntilHeader(proxySocket, signal);
  const statusCode = Number.parseInt(header.split(/\s+/)[1] ?? '', 10);

  if (rest.length > 0) {
    proxySocket.unshift(rest);
  }

  if (statusCode !== 200) {
    proxySocket.destroy();
    throw new Error(`telegram bot proxy CONNECT failed with status ${Number.isFinite(statusCode) ? statusCode : 'unknown'}`);
  }

  return proxySocket;
}

function readSocks5Frame(socket: Socket, signal?: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error('telegram bot proxy request aborted'));
    };

    socket.once('data', onData);
    socket.once('error', onError);

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

async function createTelegramSocks5Tunnel(proxyUrl: URL, targetUrl: URL, signal?: AbortSignal) {
  const socket = await connectSocket({
    host: proxyUrl.hostname,
    port: readTelegramProxyPort(proxyUrl),
    signal
  });
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  const authRequired = Boolean(username || password);

  socket.write(Buffer.from(authRequired ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
  const greeting = await readSocks5Frame(socket, signal);

  if (greeting[0] !== 0x05 || greeting[1] === 0xff) {
    socket.destroy();
    throw new Error('telegram bot socks5 proxy authentication method was rejected');
  }

  if (greeting[1] === 0x02) {
    const usernameBuffer = encodeSocks5String(username, 'username');
    const passwordBuffer = encodeSocks5String(password, 'password');
    socket.write(
      Buffer.concat([
        Buffer.from([0x01, usernameBuffer.length]),
        usernameBuffer,
        Buffer.from([passwordBuffer.length]),
        passwordBuffer
      ])
    );
    const auth = await readSocks5Frame(socket, signal);

    if (auth[0] !== 0x01 || auth[1] !== 0x00) {
      socket.destroy();
      throw new Error('telegram bot socks5 proxy username/password authentication failed');
    }
  }

  const targetHost = encodeSocks5String(targetUrl.hostname, 'target host');
  const targetPort = targetUrl.port ? Number.parseInt(targetUrl.port, 10) : targetUrl.protocol === 'https:' ? 443 : 80;
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(targetPort, 0);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, targetHost.length]), targetHost, portBuffer]));
  const response = await readSocks5Frame(socket, signal);

  if (response[0] !== 0x05 || response[1] !== 0x00) {
    socket.destroy();
    throw new Error(`telegram bot socks5 proxy CONNECT failed with code ${response[1] ?? 'unknown'}`);
  }

  return socket;
}

async function createTelegramProxyTargetSocket(proxyUrl: URL, targetUrl: URL, signal?: AbortSignal) {
  const tunneledSocket =
    proxyUrl.protocol === 'socks5:'
      ? await createTelegramSocks5Tunnel(proxyUrl, targetUrl, signal)
      : await createTelegramHttpProxyTunnel(proxyUrl, targetUrl, signal);

  if (targetUrl.protocol !== 'https:') {
    return tunneledSocket;
  }

  return tlsConnect({
    socket: tunneledSocket,
    servername: targetUrl.hostname
  });
}

function createHeadersInitFromIncoming(headers: Record<string, string | string[] | number | undefined>) {
  const next = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        next.append(key, item);
      }
    } else if (value !== undefined) {
      next.set(key, String(value));
    }
  }

  return next;
}

function createTelegramBotProxyFetch(proxyUrlRaw: string): typeof fetch {
  const proxyUrl = new URL(proxyUrlRaw);

  return (async (input, init) => {
    const targetUrl = new URL(String(input));
    const requestBody =
      typeof init?.body === 'string'
        ? Buffer.from(init.body)
        : init?.body instanceof Uint8Array
          ? Buffer.from(init.body)
          : Buffer.alloc(0);
    const headers = new Headers(init?.headers);
    headers.set('Content-Length', String(requestBody.length));
    headers.set('Host', targetUrl.host);
    const socket = await createTelegramProxyTargetSocket(proxyUrl, targetUrl, init?.signal ?? undefined);
    const request = (targetUrl.protocol === 'https:' ? httpsRequest : httpRequest)({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      method: init?.method ?? 'GET',
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: Object.fromEntries(headers.entries()),
      createConnection: () => socket
    });

    return new Promise<Response>((resolve, reject) => {
      request.once('response', (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage,
              headers: createHeadersInitFromIncoming(response.headers)
            })
          );
        });
      });
      request.once('error', reject);
      init?.signal?.addEventListener(
        'abort',
        () => {
          request.destroy(new Error('telegram bot proxy request aborted'));
        },
        { once: true }
      );
      request.end(requestBody);
    });
  }) as typeof fetch;
}

function normalizeSystemAlertNotificationRetryPolicy(
  input: Partial<SystemAlertNotificationRetryPolicy> | undefined
): SystemAlertNotificationRetryPolicy {
  return {
    retryDelayMs: Math.max(1, Math.round(input?.retryDelayMs ?? SYSTEM_ALERT_NOTIFICATION_RETRY_DELAY_MS)),
    maxAttempts: Math.max(1, Math.round(input?.maxAttempts ?? SYSTEM_ALERT_NOTIFICATION_MAX_ATTEMPTS)),
    maxDeliveriesPerSweep: Math.max(
      1,
      Math.round(input?.maxDeliveriesPerSweep ?? SYSTEM_ALERT_NOTIFICATION_MAX_DELIVERIES_PER_SWEEP)
    )
  };
}

function sanitizeSystemAlertNotificationError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function normalizeSystemAlertNotificationChannelId(value: string | undefined, fallback: string) {
  return (value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function normalizeSystemAlertNotificationChannels(input: {
  systemAlertNotifier?: SystemAlertNotifier;
  systemAlertNotificationChannels?: SystemAlertNotificationChannel[];
}): SystemAlertNotificationChannel[] {
  const channels: SystemAlertNotificationChannel[] = [
    ...(input.systemAlertNotifier
      ? [
          {
            id: DEFAULT_SYSTEM_ALERT_NOTIFICATION_CHANNEL_ID,
            label: 'Default webhook',
            notifier: input.systemAlertNotifier
          }
        ]
      : []),
    ...(input.systemAlertNotificationChannels ?? [])
  ];
  const usedIds = new Set<string>();

  return channels.map((channel, index) => {
    const baseId = normalizeSystemAlertNotificationChannelId(channel.id, `webhook-${index + 1}`);
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);

    return {
      id,
      label: channel.label.trim() || id,
      notifier: channel.notifier
    };
  });
}

function createAuditIntegrityHash(log: AuditLog) {
  const hashableLog = { ...log };
  delete hashableLog.hash;
  return createStableSha256LikeHash(hashableLog);
}

function verifyAuditLogs(logs: AuditLog[]): AuditChainVerification {
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    const expectedPrevHash = index < logs.length - 1 ? logs[index + 1].hash : AUDIT_GENESIS_HASH;

    if (log.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'prev_hash.mismatch'
      };
    }

    if (log.hash !== createAuditIntegrityHash(log)) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'hash.mismatch'
      };
    }
  }

  return {
    valid: true,
    checked: logs.length
  };
}

function resolveMutationContext(context: MutationContext | undefined): MutationContext {
  return {
    actor: context?.actor ?? 'admin',
    operatorGroupId: context?.operatorGroupId,
    resourceGroupId: context?.resourceGroupId,
    sourceIp: context?.sourceIp ?? '127.0.0.1',
    userAgent: context?.userAgent,
    requestId: context?.requestId ?? `req-service-api-${Date.now()}`,
    idempotencyKey: context?.idempotencyKey,
    ifMatch: context?.ifMatch
  };
}

function normalizeAgentCapabilities(capabilities: string[] | undefined): Agent['capabilities'] {
  const normalized = (capabilities ?? [])
    .map((capability) => {
      if (capability === 'flvx') return 'port-forwarding';
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'port-forwarding' ||
        capability === 'bbr' ||
        capability === 'telemetry' ||
        capability === 'command-channel' ||
        capability === 'self-update'
      ) {
        return capability;
      }

      return undefined;
    })
    .filter((capability): capability is Agent['capabilities'][number] => Boolean(capability));

  const fallback: Agent['capabilities'] = ['host-agent'];
  return [...new Set<Agent['capabilities'][number]>(normalized.length > 0 ? normalized : fallback)];
}

function createAgentFromCredential(credential: AgentCredentialSummary, session?: AgentSessionState): Agent {
  const observedAt = session?.lastHeartbeatAt ?? session?.updatedAt ?? credential.lastUsedAt ?? credential.issuedAt;
  const samplingExpectedSince = Number.isFinite(Date.parse(credential.issuedAt)) ? credential.issuedAt : observedAt;
  const capabilities = normalizeAgentCapabilities(
    session?.capabilities ?? credential.metadata.registrationCapabilities ?? credential.metadata.installProfile
  );
  const expiresAt = Number.isFinite(Date.parse(credential.expiresAt))
    ? credential.expiresAt
    : new Date(Date.parse(observedAt) + DEFAULT_AGENT_PROFILE_EXPIRY_DAY_MS).toISOString();

  return {
    id: credential.agentId,
    name: credential.agentId,
    status: session?.status ?? 'provisioning',
    region: 'custom',
    publicAddress: credential.sourceIp || 'pending',
    connectionMode: 'pull',
    version: session?.version ?? credential.metadata.registrationVersion ?? 'unknown',
    platform: credential.metadata.registrationPlatform ?? 'linux/unknown',
    capabilities,
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt,
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: observedAt,
    telemetry: {
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 0,
      latencySamplesMs: [],
      packetLossPercent: 0,
      packetLossSamplesPercent: [],
      onlineDays: 0,
      samplingExpectedSince,
      sampleIntervalSeconds: DEFAULT_AGENT_TELEMETRY_SAMPLE_INTERVAL_SECONDS
    }
  };
}

function earlierIsoTimestamp(left: string | undefined, right: string | undefined) {
  const leftMs = Date.parse(left ?? '');
  const rightMs = Date.parse(right ?? '');

  if (Number.isNaN(leftMs)) {
    return Number.isNaN(rightMs) ? left : right;
  }

  if (Number.isNaN(rightMs)) {
    return left;
  }

  return leftMs <= rightMs ? left : right;
}

function mergeAgentCredentialProjection(agent: Agent, projectedAgent: Agent): Agent {
  return {
    ...agent,
    publicAddress: agent.publicAddress === 'pending' ? projectedAgent.publicAddress : agent.publicAddress,
    version: agent.version === 'unknown' ? projectedAgent.version : agent.version,
    platform: agent.platform === 'linux/unknown' ? projectedAgent.platform : agent.platform,
    capabilities: normalizeAgentCapabilities([...agent.capabilities, ...projectedAgent.capabilities]),
    expiresAt: Number.isFinite(Date.parse(agent.expiresAt)) ? agent.expiresAt : projectedAgent.expiresAt,
    lastHeartbeatAt: agent.lastHeartbeatAt || projectedAgent.lastHeartbeatAt,
    telemetry: {
      ...agent.telemetry,
      samplingExpectedSince: earlierIsoTimestamp(
        agent.telemetry.samplingExpectedSince,
        projectedAgent.telemetry.samplingExpectedSince
      )
    }
  };
}

function normalizeAgentSessionCapabilities(capabilities: readonly string[] | undefined): AgentSessionSummary['capabilities'] {
  if (!capabilities) {
    return undefined;
  }

  const normalized = capabilities
    .map((capability) => {
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'port-forwarding' ||
        capability === 'bbr' ||
        capability === 'system' ||
        capability === 'telemetry' ||
        capability === 'command-channel' ||
        capability === 'self-update'
      ) {
        return capability;
      }

      return undefined;
    })
    .filter((capability): capability is NonNullable<AgentSessionSummary['capabilities']>[number] =>
      Boolean(capability)
    );

  return [...new Set<NonNullable<AgentSessionSummary['capabilities']>[number]>(normalized)];
}

function readCredentialSessionCapabilities(
  credential: AgentCredentialSummary | undefined
): AgentSessionSummary['capabilities'] {
  return normalizeAgentSessionCapabilities(
    credential?.metadata.registrationCapabilities ?? credential?.metadata.installProfile
  );
}

function findRuntimeCredentialForSession(
  credentials: AgentCredentialSummary[],
  session: AgentSessionState
): AgentCredentialSummary | undefined {
  const runtimeCredentials = credentials
    .filter((credential) => credential.agentId === session.agentId && credential.purpose === 'runtime')
    .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt));

  return runtimeCredentials.find(
    (credential) =>
      credential.status === 'active' &&
      (!credential.sessionId || credential.sessionId === session.sessionId)
  );
}

function createAgentSessionSummary(
  session: AgentSessionState,
  credential?: AgentCredentialSummary
): AgentSessionSummary {
  return {
    agentId: session.agentId,
    sessionId: session.sessionId,
    status: session.status,
    lastSeq: session.lastSeq,
    lastSeenCommandSeq: session.lastSeenCommandSeq,
    version: session.version,
    capabilities: session.capabilities ?? readCredentialSessionCapabilities(credential),
    lastHeartbeatAt: session.lastHeartbeatAt,
    updatedAt: session.updatedAt
  };
}

function createAgentCredentialSummaryFromRecord(record: AgentCredentialRecord): AgentCredentialSummary {
  return {
    id: record.id,
    agentId: record.agentId,
    tokenPrefix: record.tokenPrefix,
    status: record.status,
    purpose: record.purpose,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    issuedBy: record.issuedBy,
    sourceIp: record.sourceIp,
    requestId: record.requestId,
    lastUsedAt: record.lastUsedAt,
    sessionId: record.sessionId,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy,
    revokedReason: record.revokedReason,
    replacedByCredentialId: record.replacedByCredentialId,
    metadata: {
      ...record.metadata,
      installProfile: [...record.metadata.installProfile],
      ...(record.metadata.registrationCapabilities
        ? { registrationCapabilities: [...record.metadata.registrationCapabilities] }
        : {})
    }
  };
}

function sortTasksForReadModelReplay(tasks: DeployTask[]) {
  return clone(tasks).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta === 0 ? left.id.localeCompare(right.id) : timeDelta;
  });
}

function sortAgentEventsForReadModelReplay(events: AgentEventEnvelope[]) {
  return clone(events).sort((left, right) => {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta || left.agentId.localeCompare(right.agentId) || left.seq - right.seq || left.eventId.localeCompare(right.eventId);
  });
}

function isHighFrequencyAgentEvent(event: AgentEventEnvelope) {
  return event.type === 'heartbeat' || event.type === 'telemetry_sample';
}

function readTaskMetadataString(task: DeployTask, key: string, fallback: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readAgentIdFromTask(task: DeployTask) {
  return readTaskMetadataString(task, 'agentId', task.targetId);
}

function readTaskInputMetadataString(input: CreateTaskInput, key: string) {
  const value = input.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveXrayInboundTaskAgentId(input: CreateTaskInput) {
  if (!input.operation.startsWith('inbound.')) {
    return undefined;
  }

  if (input.metadata?.xrayGuardrailAutomatic === true) {
    return undefined;
  }

  return readTaskInputMetadataString(input, 'agentId') ?? input.targetId;
}

function findXrayCapabilityDenial(input: CreateTaskInput, liveAgents: Agent[]) {
  const agentId = resolveXrayInboundTaskAgentId(input);

  if (!agentId) {
    return undefined;
  }

  const agent = liveAgents.find((item) => item.id === agentId);

  if (!agent || agent.capabilities.includes('xray')) {
    return undefined;
  }

  return {
    code: 'agent_runtime_capability.unsupported',
    denialReason: 'Xray inbound operations require the target Agent to advertise the xray runtime capability.',
    agentId,
    requiredCapability: 'xray'
  };
}

function updateSubscriptionSourceSyncState(
  sources: SubscriptionSource[],
  sourceId: string,
  patch: Partial<
    Pick<
      SubscriptionSource,
      | 'status'
      | 'nodeCount'
      | 'lastSyncAt'
      | 'traffic'
      | 'syncBudget'
      | 'syncWarnings'
      | 'syncLeaseOwnerId'
      | 'syncLeaseExpiresAt'
    >
  >
) {
  return sources.map((source) =>
    source.id === sourceId
      ? {
          ...source,
          ...patch
        }
      : source
  );
}

function createSubscriptionSyncAuditLog(input: {
  source: SubscriptionSource;
  result: SubscriptionSourceSyncResult;
  context: MutationContext;
  before: unknown;
  after: unknown;
}): AuditLog {
  const failed = input.result.status === 'failed';
  const warning = input.result.status === 'warning';

  return {
    id: `audit-subscription-sync-${input.source.id}-${input.context.requestId}-${randomUUID()}`,
    action: failed ? 'subscription.source.sync_failed' : 'subscription.source.synced',
    actor: input.context.actor,
    operatorGroupId: input.context.operatorGroupId,
    resourceGroupId: input.context.resourceGroupId,
    scope: 'control-plane:subscription',
    resourceType: 'subscription',
    operation: 'subscription.sync',
    result: failed ? 'failed' : 'succeeded',
    targetId: input.source.id,
    targetLabel: input.source.name,
    taskId: '',
    severity: failed || warning ? 'warning' : 'info',
    message: failed
      ? `Subscription source sync failed: ${input.source.name}`
      : `Subscription source synced: ${input.source.name}`,
    createdAt: input.result.syncedAt,
    sourceIp: input.context.sourceIp,
    userAgent: input.context.userAgent,
    requestId: input.context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'subscription.sync',
      sourceId: input.source.id
    }),
    before: input.before,
    after: input.after
  };
}

function uniqueAuditValues(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function createAgentRequestDeniedAuditLog(input: AgentRequestDeniedAuditInput, createdAt: string): AuditLog {
  const agentIds = uniqueAuditValues(input.agentIds);
  const sessionIds = uniqueAuditValues(input.sessionIds);
  const targetId = agentIds.length === 1 ? agentIds[0] : agentIds.length > 1 ? 'multiple-agents' : 'agent-authentication';
  const targetLabel = agentIds.length > 1 ? `${agentIds.length} Agent identities` : targetId;
  const authenticatedAgent =
    input.authenticatedAgentId || input.authenticatedSessionId || input.credentialId
      ? {
          agentId: input.authenticatedAgentId,
          sessionId: input.authenticatedSessionId,
          credentialId: input.credentialId
        }
      : undefined;
  const operation =
    input.endpoint === 'poll'
      ? 'agent.poll'
      : input.endpoint === 'events'
        ? 'agent.events'
        : 'agent.credential.rotate';
  const endpointLabel = input.endpoint === 'credential_rotate' ? 'credential rotate' : input.endpoint;
  const after = {
    endpoint: input.endpoint,
    agentIds,
    sessionIds,
    tokenPresented: input.tokenPresented
  };

  return {
    id: `audit-agent-request-denied-${input.endpoint}-${input.requestId}-${randomUUID()}`,
    action: 'audit.denied',
    actor: input.authenticatedAgentId ? `agent:${input.authenticatedAgentId}` : 'agent:unauthenticated',
    scope: 'control-plane:agent',
    resourceType: 'agent',
    operation,
    result: 'denied',
    targetId,
    targetLabel,
    taskId: '',
    severity: 'critical',
    message: `Agent ${endpointLabel} request denied -> ${input.denialCode}`,
    createdAt,
    sourceIp: input.sourceIp,
    userAgent: input.userAgent,
    requestId: input.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation,
      denialCode: input.denialCode,
      agentIds,
      sessionIds,
      tokenPresented: input.tokenPresented
    }),
    denialCode: input.denialCode,
    denialReason: input.denialReason,
    before: authenticatedAgent ? { authenticatedAgent } : undefined,
    after
  };
}

function createOperatorRequestDeniedAuditLog(input: OperatorRequestDeniedAuditInput, createdAt: string): AuditLog {
  const targetId = `${input.method.toUpperCase()} ${input.path}`;

  return {
    id: `audit-operator-request-denied-${input.requestId}-${randomUUID()}`,
    action: 'audit.denied',
    actor: 'operator:unauthenticated',
    scope: 'control-plane:operator',
    resourceType: 'permission',
    operation: 'operator.auth',
    result: 'denied',
    targetId,
    targetLabel: targetId,
    taskId: '',
    severity: 'critical',
    message: `Operator request denied -> ${input.denialCode}`,
    createdAt,
    sourceIp: input.sourceIp,
    userAgent: input.userAgent,
    requestId: input.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'operator.auth',
      method: input.method.toUpperCase(),
      path: input.path,
      denialCode: input.denialCode,
      tokenPresented: input.tokenPresented
    }),
    denialCode: input.denialCode,
    denialReason: input.denialReason,
    after: {
      method: input.method.toUpperCase(),
      path: input.path,
      tokenPresented: input.tokenPresented
    }
  };
}

function createAgentLogRetentionPolicyUpdatedAuditLog(input: {
  context: MutationContext;
  before: AgentLogRetentionPolicyReadModel;
  after: AgentLogRetentionPolicyReadModel;
  reason?: string;
  createdAt: string;
}): AuditLog {
  return {
    id: `audit-agent-log-retention-${input.context.requestId}-${randomUUID()}`,
    action: 'agent.log_retention.updated',
    actor: input.context.actor,
    operatorGroupId: input.context.operatorGroupId,
    resourceGroupId: input.context.resourceGroupId,
    scope: 'control-plane:agent-log-retention',
    resourceType: 'agent',
    operation: 'agent.log_retention.update',
    result: 'succeeded',
    targetId: 'agent-log-retention-policy',
    targetLabel: 'Agent log retention policy',
    taskId: '',
    severity: 'warning',
    message: 'Agent log retention policy updated',
    createdAt: input.createdAt,
    sourceIp: input.context.sourceIp,
    userAgent: input.context.userAgent,
    requestId: input.context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'agent.log_retention.update',
      maxAgeDays: input.after.maxAgeDays,
      maxEventsPerAgent: input.after.maxEventsPerAgent,
      reason: input.reason
    }),
    before: input.before,
    after: {
      ...input.after,
      reason: input.reason
    }
  };
}

function createTrafficRollupRetentionPolicyUpdatedAuditLog(input: {
  context: MutationContext;
  before: TrafficRollupRetentionPolicyReadModel;
  after: TrafficRollupRetentionPolicyReadModel;
  reason?: string;
  createdAt: string;
}): AuditLog {
  return {
    id: `audit-traffic-rollup-retention-${input.context.requestId}-${randomUUID()}`,
    action: 'traffic.rollup_retention.updated',
    actor: input.context.actor,
    operatorGroupId: input.context.operatorGroupId,
    resourceGroupId: input.context.resourceGroupId,
    scope: 'control-plane:traffic-rollup-retention',
    resourceType: 'quota',
    operation: 'traffic.rollup_retention.update',
    result: 'succeeded',
    targetId: 'traffic-rollup-retention-policy',
    targetLabel: 'Traffic rollup retention policy',
    taskId: '',
    severity: 'warning',
    message: 'Traffic rollup retention policy updated',
    createdAt: input.createdAt,
    sourceIp: input.context.sourceIp,
    userAgent: input.context.userAgent,
    requestId: input.context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'traffic.rollup_retention.update',
      maxAgeDays: input.after.maxAgeDays,
      maxRecordsPerScope: input.after.maxRecordsPerScope,
      reason: input.reason
    }),
    before: input.before,
    after: {
      ...input.after,
      reason: input.reason
    }
  };
}

function createSubscriptionSourceRateLimitError(source: SubscriptionSource, now: string, nextAllowedAt: string) {
  return Object.assign(new Error(`subscription_source.rate_limited:${source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: source.id,
      refreshIntervalMinutes: source.refreshIntervalMinutes ?? source.rateLimitPerMinute,
      lastSyncAt: source.lastSyncAt,
      attemptedAt: now,
      nextAllowedAt
    }
  });
}

function createSubscriptionSourceProviderBudgetError(
  source: SubscriptionSource,
  providerHost: string,
  activeSources: SubscriptionSource[],
  now: string,
  maxConcurrentFetchesPerHost: number
) {
  const activeLeaseExpiries = activeSources
    .map((item) => Date.parse(item.syncLeaseExpiresAt ?? ''))
    .filter((timestamp) => !Number.isNaN(timestamp))
    .sort((left, right) => left - right);
  const nextAllowedAt = activeLeaseExpiries[0] ? new Date(activeLeaseExpiries[0]).toISOString() : now;

  return Object.assign(new Error(`subscription_source.provider_budget_exceeded:${source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: source.id,
      providerHost,
      attemptedAt: now,
      nextAllowedAt,
      maxConcurrentFetchesPerHost,
      activeSyncCount: activeSources.length,
      activeSourceIds: activeSources.map((item) => item.id)
    }
  });
}

function createSubscriptionSourceSyncBudgetError(input: {
  source: SubscriptionSource;
  providerAccountId: string;
  now: string;
  windowEndsAt: string;
  maxFetchesPerDay?: number;
  usedFetches: number;
  maxBytesPerDay?: number;
  usedBytes: number;
  exceededLimit: 'fetches' | 'bytes';
}) {
  return Object.assign(new Error(`subscription_source.sync_budget_exceeded:${input.source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: input.source.id,
      providerAccountId: input.providerAccountId,
      attemptedAt: input.now,
      nextAllowedAt: input.windowEndsAt,
      denialReason: 'sync_budget_exceeded',
      exceededLimit: input.exceededLimit,
      maxFetchesPerDay: input.maxFetchesPerDay,
      usedFetches: input.usedFetches,
      maxBytesPerDay: input.maxBytesPerDay,
      usedBytes: input.usedBytes
    }
  });
}

function createAgentLogRetentionPolicyReadModel(
  policyInput: Partial<AgentLogRetentionPolicy> | undefined,
  source: AgentLogRetentionPolicyReadModel['source']
): AgentLogRetentionPolicyReadModel {
  const policy = normalizeAgentLogRetentionPolicy(policyInput);

  return {
    maxAgeMs: policy.maxAgeMs,
    maxAgeDays: policy.maxAgeMs / AGENT_LOG_RETENTION_DAY_MS,
    maxEventsPerAgent: policy.maxEventsPerAgent,
    source
  };
}

function toAgentLogRetentionPolicy(input: AgentLogRetentionPolicyUpdateInput): AgentLogRetentionPolicy {
  return normalizeAgentLogRetentionPolicy({
    maxAgeMs: Math.round(input.maxAgeDays * AGENT_LOG_RETENTION_DAY_MS),
    maxEventsPerAgent: input.maxEventsPerAgent
  });
}

function createTrafficRollupRetentionPolicyValues(
  policyInput: Partial<TrafficRollupRetentionPolicy> | undefined
): TrafficRollupRetentionPolicyValues {
  const policy = normalizeTrafficRollupRetentionPolicy(policyInput);

  return {
    maxAgeMs: policy.maxAgeMs,
    maxAgeDays: policy.maxAgeMs / TRAFFIC_ROLLUP_RETENTION_DAY_MS,
    maxRecordsPerScope: policy.maxRecordsPerScope
  };
}

function createTrafficRollupRetentionPolicyReadModel(input: {
  effective: Partial<TrafficRollupRetentionPolicy> | undefined;
  source: TrafficRollupRetentionPolicyReadModel['source'];
  runtimeDefault: TrafficRollupRetentionPolicyValues;
  controlPlaneOverride?: Partial<TrafficRollupRetentionPolicy>;
}): TrafficRollupRetentionPolicyReadModel {
  const effective = createTrafficRollupRetentionPolicyValues(input.effective);
  const controlPlaneOverride = input.controlPlaneOverride
    ? createTrafficRollupRetentionPolicyValues(input.controlPlaneOverride)
    : undefined;

  return {
    ...effective,
    source: input.source,
    runtimeDefault: clone(input.runtimeDefault),
    ...(controlPlaneOverride ? { controlPlaneOverride } : {})
  };
}

function toTrafficRollupRetentionPolicy(
  input: TrafficRollupRetentionPolicyUpdateInput
): TrafficRollupRetentionPolicy {
  return normalizeTrafficRollupRetentionPolicy({
    maxAgeMs: Math.round(input.maxAgeDays * TRAFFIC_ROLLUP_RETENTION_DAY_MS),
    maxRecordsPerScope: input.maxRecordsPerScope
  });
}

function createPersistedSystemAlertRecord(
  alert: SystemAlert,
  now: string,
  existing?: PersistedSystemAlertRecord
): PersistedSystemAlertRecord {
  const reactivated = existing?.status === 'resolved';
  const nextRecord: PersistedSystemAlertRecord = {
    ...alert,
    status: 'active',
    firstObservedAt: !existing || reactivated ? alert.observedAt : existing.firstObservedAt,
    lastChangedAt:
      !existing
      || reactivated
      || existing.severity !== alert.severity
      || existing.message !== alert.message
      || existing.title !== alert.title
      || existing.observedAt !== alert.observedAt
      || existing.resourceLabel !== alert.resourceLabel
      || createStableSha256LikeHash(existing.metadata ?? {}) !== createStableSha256LikeHash(alert.metadata ?? {})
        ? now
        : existing.lastChangedAt,
    resolvedAt: undefined
  };

  return nextRecord;
}

function comparePersistedSystemAlertRecords(left: PersistedSystemAlertRecord, right: PersistedSystemAlertRecord) {
  if (left.status !== right.status) {
    return left.status === 'active' ? -1 : 1;
  }

  const leftMs = Date.parse(left.lastChangedAt || left.observedAt || left.firstObservedAt);
  const rightMs = Date.parse(right.lastChangedAt || right.observedAt || right.firstObservedAt);

  if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs !== rightMs) {
    return rightMs - leftMs;
  }

  return left.id.localeCompare(right.id);
}

function toPublicSystemAlert(record: PersistedSystemAlertRecord): SystemAlert {
  return {
    id: record.id,
    kind: record.kind,
    severity: record.severity,
    status: 'active',
    title: record.title,
    message: record.message,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    resourceLabel: record.resourceLabel,
    observedAt: record.observedAt,
    dedupeKey: record.dedupeKey,
    metadata: clone(record.metadata)
  };
}

function createSystemAlertNotification(
  type: SystemAlertNotificationType,
  record: PersistedSystemAlertRecord
): SystemAlertNotification {
  return {
    type,
    notificationKey: `${type}:${record.dedupeKey}:${record.lastChangedAt}`,
    alert: {
      id: record.id,
      kind: record.kind,
      severity: record.severity,
      status: record.status,
      title: record.title,
      message: record.message,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      resourceLabel: record.resourceLabel,
      observedAt: record.observedAt,
      dedupeKey: record.dedupeKey,
      metadata: clone(record.metadata)
    },
    firstObservedAt: record.firstObservedAt,
    lastChangedAt: record.lastChangedAt,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {})
  };
}

function createSystemAlertNotificationBatch(
  notifications: SystemAlertNotification[],
  generatedAt: string
): SystemAlertNotificationBatch {
  return {
    schemaVersion: 'ou-ui-next.system-alerts.v1',
    generatedAt,
    events: clone(notifications)
  };
}

function createSystemAlertNotificationDeliveryId(
  batch: SystemAlertNotificationBatch,
  channel: SystemAlertNotificationChannel
) {
  return `system-alert-notification:${createStableSha256LikeHash({
    channelId: channel.id,
    notificationKeys: batch.events.map((event) => event.notificationKey)
  })}`;
}

function createSystemAlertNotificationDelivery(
  batch: SystemAlertNotificationBatch,
  now: string,
  policy: SystemAlertNotificationRetryPolicy,
  channel: SystemAlertNotificationChannel
): SystemAlertNotificationDeliveryRecord {
  return {
    id: createSystemAlertNotificationDeliveryId(batch, channel),
    channelId: channel.id,
    channelLabel: channel.label,
    status: 'pending',
    batch: clone(batch),
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    attemptCount: 0,
    maxAttempts: policy.maxAttempts
  };
}

function compareSystemAlertNotificationDeliveries(
  left: SystemAlertNotificationDeliveryRecord,
  right: SystemAlertNotificationDeliveryRecord
) {
  return parseTimestampMs(right.updatedAt) - parseTimestampMs(left.updatedAt) || right.id.localeCompare(left.id);
}

function compactSystemAlertNotificationDeliveries(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  return clone(
    [...deliveries]
      .sort(compareSystemAlertNotificationDeliveries)
      .slice(0, SYSTEM_ALERT_NOTIFICATION_DELIVERY_HISTORY_LIMIT)
  );
}

function upsertSystemAlertNotificationDeliveries(
  existing: SystemAlertNotificationDeliveryRecord[],
  nextDeliveries: SystemAlertNotificationDeliveryRecord[]
) {
  const byId = new Map(existing.map((delivery) => [delivery.id, delivery] as const));

  for (const delivery of nextDeliveries) {
    if (!byId.has(delivery.id)) {
      byId.set(delivery.id, delivery);
    }
  }

  return compactSystemAlertNotificationDeliveries([...byId.values()]);
}

function isRetryableSystemAlertNotificationDelivery(delivery: SystemAlertNotificationDeliveryRecord) {
  return delivery.status === 'pending' || delivery.status === 'failed';
}

function isDueSystemAlertNotificationDelivery(delivery: SystemAlertNotificationDeliveryRecord, now: string) {
  return isRetryableSystemAlertNotificationDelivery(delivery) && Date.parse(delivery.nextAttemptAt) <= parseTimestampMs(now);
}

function readSystemAlertNotificationDeliveryChannelId(delivery: SystemAlertNotificationDeliveryRecord) {
  return delivery.channelId ?? DEFAULT_SYSTEM_ALERT_NOTIFICATION_CHANNEL_ID;
}

const volatileSystemAlertNotificationMetadataKeys = new Set([
  'lastTelemetryAt',
  'lastHeartbeatAt',
  'serviceCheckedAt',
  'sampleGapSeconds',
  'latencyMs',
  'latestUpdatedAt',
  'overdueDeliveryCount',
  'deadLetterDeliveryCount',
  'oldestNextAttemptAt',
  'sampleAttemptCount',
  'usedBytes',
  'usageRatioPercent',
  'quotaReportedAt'
]);

function createSystemAlertNotificationMetadataFingerprint(
  metadata: PersistedSystemAlertRecord['metadata']
) {
  const stableMetadata: NonNullable<PersistedSystemAlertRecord['metadata']> = {};

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!volatileSystemAlertNotificationMetadataKeys.has(key)) {
      stableMetadata[key] = value;
    }
  }

  return createStableSha256LikeHash(stableMetadata);
}

function shouldNotifyActiveSystemAlertUpdate(
  existing: PersistedSystemAlertRecord | undefined,
  nextRecord: PersistedSystemAlertRecord
) {
  if (!existing || existing.status === 'resolved') {
    return true;
  }

  return (
    existing.severity !== nextRecord.severity
    || existing.message !== nextRecord.message
    || existing.title !== nextRecord.title
    || existing.resourceLabel !== nextRecord.resourceLabel
    || createSystemAlertNotificationMetadataFingerprint(existing.metadata)
      !== createSystemAlertNotificationMetadataFingerprint(nextRecord.metadata)
  );
}

function reconcileSystemAlertRecords(
  persisted: PersistedSystemAlertRecord[],
  derivedActiveAlerts: SystemAlert[],
  now: string
) {
  const persistedByDedupeKey = new Map(persisted.map((record) => [record.dedupeKey, record] as const));
  const nextRecords: PersistedSystemAlertRecord[] = [];
  const seenDedupeKeys = new Set<string>();
  const notifications: SystemAlertNotification[] = [];
  let changed = false;

  for (const alert of derivedActiveAlerts) {
    const existing = persistedByDedupeKey.get(alert.dedupeKey);
    const nextRecord = createPersistedSystemAlertRecord(alert, now, existing);

    if (!existing || createStableSha256LikeHash(existing) !== createStableSha256LikeHash(nextRecord)) {
      changed = true;
    }

    if (shouldNotifyActiveSystemAlertUpdate(existing, nextRecord)) {
      notifications.push(
        createSystemAlertNotification(!existing || existing.status === 'resolved' ? 'activated' : 'updated', nextRecord)
      );
    }

    nextRecords.push(nextRecord);
    seenDedupeKeys.add(alert.dedupeKey);
  }

  for (const existing of persisted) {
    if (seenDedupeKeys.has(existing.dedupeKey)) {
      continue;
    }

    if (existing.status === 'active') {
      const resolvedRecord: PersistedSystemAlertRecord = {
        ...existing,
        status: 'resolved',
        lastChangedAt: now,
        resolvedAt: now
      };

      nextRecords.push(resolvedRecord);
      notifications.push(createSystemAlertNotification('resolved', resolvedRecord));
      changed = true;
      continue;
    }

    nextRecords.push(existing);
  }

  const records = nextRecords.sort(comparePersistedSystemAlertRecords);
  return {
    records,
    activeAlerts: records.filter((record) => record.status === 'active').map(toPublicSystemAlert),
    changed,
    notifications
  };
}

function assertSubscriptionSourceSyncAllowed(source: SubscriptionSource, now: string) {
  const lastSyncMs = Date.parse(source.lastSyncAt);
  const nowMs = Date.parse(now);
  const leaseExpiresMs = Date.parse(source.syncLeaseExpiresAt ?? '');

  if (
    source.syncLeaseOwnerId &&
    !Number.isNaN(leaseExpiresMs) &&
    !Number.isNaN(nowMs) &&
    nowMs < leaseExpiresMs
  ) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(leaseExpiresMs).toISOString());
  }

  if (source.status === 'syncing') {
    return;
  }

  const intervalMinutes = Math.max(Math.round(source.refreshIntervalMinutes ?? source.rateLimitPerMinute ?? 60), 1);

  if (Number.isNaN(lastSyncMs) || Number.isNaN(nowMs)) {
    return;
  }

  const nextAllowedMs = lastSyncMs + intervalMinutes * 60 * 1000;

  if (nowMs < nextAllowedMs) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(nextAllowedMs).toISOString());
  }
}

function readSubscriptionSourceProviderHost(source: SubscriptionSource) {
  try {
    const url = new URL(source.url);

    if (!SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }

    return normalizeRemoteHostname(url.hostname);
  } catch {
    return undefined;
  }
}

function assertSubscriptionSourceProviderBudgetAllowed(
  source: SubscriptionSource,
  sources: SubscriptionSource[],
  now: string,
  providerBudgetPolicy: SubscriptionSourceProviderBudgetPolicy
) {
  const providerHost = readSubscriptionSourceProviderHost(source);
  const nowMs = Date.parse(now);

  if (!providerHost || Number.isNaN(nowMs)) {
    return;
  }

  const activeSources = sources.filter((item) => {
    if (item.id === source.id) {
      return false;
    }

    if (readSubscriptionSourceProviderHost(item) !== providerHost) {
      return false;
    }

    const leaseExpiresMs = Date.parse(item.syncLeaseExpiresAt ?? '');

    return Boolean(item.syncLeaseOwnerId) && !Number.isNaN(leaseExpiresMs) && nowMs < leaseExpiresMs;
  });

  if (activeSources.length >= providerBudgetPolicy.maxConcurrentFetchesPerHost) {
    throw createSubscriptionSourceProviderBudgetError(
      source,
      providerHost,
      activeSources,
      now,
      providerBudgetPolicy.maxConcurrentFetchesPerHost
    );
  }
}

function createSubscriptionSourceUtcDayBudgetWindow(now: string) {
  const nowMs = Date.parse(now);
  const date = new Date(Number.isNaN(nowMs) ? Date.now() : nowMs);
  const windowStartedAtMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  return {
    windowStartedAt: new Date(windowStartedAtMs).toISOString(),
    windowEndsAt: new Date(windowStartedAtMs + 24 * 60 * 60 * 1000).toISOString()
  };
}

function normalizeSubscriptionSourceProviderAccountId(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function readSubscriptionSourceBudgetAccountKey(source: SubscriptionSource) {
  return normalizeSubscriptionSourceProviderAccountId(source.providerAccountId) ?? readSubscriptionSourceProviderHost(source) ?? source.id;
}

function readPositiveBudgetInteger(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function resolveSubscriptionSourceSyncBudgetConfig(
  source: SubscriptionSource,
  defaultPolicy: SubscriptionSourceSyncBudgetPolicy
) {
  const maxFetchesPerDay =
    readPositiveBudgetInteger(source.syncBudget?.maxFetchesPerDay) ?? defaultPolicy.maxFetchesPerDay;
  const maxBytesPerDay = readPositiveBudgetInteger(source.syncBudget?.maxBytesPerDay) ?? defaultPolicy.maxBytesPerDay;

  if (!maxFetchesPerDay && !maxBytesPerDay) {
    return undefined;
  }

  return {
    providerAccountId: readSubscriptionSourceBudgetAccountKey(source),
    maxFetchesPerDay,
    maxBytesPerDay
  };
}

function normalizeSubscriptionSourceSyncBudgetWindow(
  budget: SubscriptionSourceSyncBudget | undefined,
  now: string,
  config: NonNullable<ReturnType<typeof resolveSubscriptionSourceSyncBudgetConfig>>
): SubscriptionSourceSyncBudget {
  const window = createSubscriptionSourceUtcDayBudgetWindow(now);
  const isCurrentWindow =
    budget?.windowStartedAt === window.windowStartedAt && budget?.windowEndsAt === window.windowEndsAt;

  return {
    ...(config.maxFetchesPerDay ? { maxFetchesPerDay: config.maxFetchesPerDay } : {}),
    ...(config.maxBytesPerDay ? { maxBytesPerDay: config.maxBytesPerDay } : {}),
    ...window,
    usedFetches: isCurrentWindow ? Math.max(Math.round(budget?.usedFetches ?? 0), 0) : 0,
    usedBytes: isCurrentWindow ? Math.max(Math.round(budget?.usedBytes ?? 0), 0) : 0,
    ...(isCurrentWindow && readPositiveBudgetInteger(budget?.lastFetchBytes)
      ? { lastFetchBytes: readPositiveBudgetInteger(budget?.lastFetchBytes) }
      : {}),
    ...(isCurrentWindow && budget?.lastRecordedAt ? { lastRecordedAt: budget.lastRecordedAt } : {})
  };
}

function replaceSubscriptionSourceForBudget(
  sources: SubscriptionSource[],
  source: SubscriptionSource
) {
  const replaced = sources.map((item) => (item.id === source.id ? source : item));

  return replaced.some((item) => item.id === source.id) ? replaced : [source, ...replaced];
}

function readSubscriptionSourceSyncBudgetUsage(
  sources: SubscriptionSource[],
  providerAccountId: string,
  now: string,
  defaultPolicy: SubscriptionSourceSyncBudgetPolicy
) {
  return sources.reduce(
    (usage, source) => {
      const config = resolveSubscriptionSourceSyncBudgetConfig(source, defaultPolicy);

      if (!config || config.providerAccountId !== providerAccountId) {
        return usage;
      }

      const budget = normalizeSubscriptionSourceSyncBudgetWindow(source.syncBudget, now, config);

      return {
        usedFetches: usage.usedFetches + budget.usedFetches,
        usedBytes: usage.usedBytes + budget.usedBytes,
        windowEndsAt: budget.windowEndsAt
      };
    },
    {
      usedFetches: 0,
      usedBytes: 0,
      windowEndsAt: createSubscriptionSourceUtcDayBudgetWindow(now).windowEndsAt
    }
  );
}

function reserveSubscriptionSourceSyncBudget(input: {
  source: SubscriptionSource;
  sources: SubscriptionSource[];
  now: string;
  defaultPolicy: SubscriptionSourceSyncBudgetPolicy;
  fetchPolicy: SubscriptionSourceFetchPolicy;
}) {
  const config = resolveSubscriptionSourceSyncBudgetConfig(input.source, input.defaultPolicy);

  if (!config) {
    return {
      source: input.source,
      fetchPolicy: input.fetchPolicy
    };
  }

  const sourceBudget = normalizeSubscriptionSourceSyncBudgetWindow(input.source.syncBudget, input.now, config);
  const sourceWithCurrentBudget = {
    ...input.source,
    syncBudget: sourceBudget
  };
  const budgetSources = replaceSubscriptionSourceForBudget(input.sources, sourceWithCurrentBudget);
  const usage = readSubscriptionSourceSyncBudgetUsage(
    budgetSources,
    config.providerAccountId,
    input.now,
    input.defaultPolicy
  );

  if (config.maxFetchesPerDay && usage.usedFetches >= config.maxFetchesPerDay) {
    throw createSubscriptionSourceSyncBudgetError({
      source: input.source,
      providerAccountId: config.providerAccountId,
      now: input.now,
      windowEndsAt: usage.windowEndsAt,
      maxFetchesPerDay: config.maxFetchesPerDay,
      usedFetches: usage.usedFetches,
      maxBytesPerDay: config.maxBytesPerDay,
      usedBytes: usage.usedBytes,
      exceededLimit: 'fetches'
    });
  }

  if (config.maxBytesPerDay && usage.usedBytes >= config.maxBytesPerDay) {
    throw createSubscriptionSourceSyncBudgetError({
      source: input.source,
      providerAccountId: config.providerAccountId,
      now: input.now,
      windowEndsAt: usage.windowEndsAt,
      maxFetchesPerDay: config.maxFetchesPerDay,
      usedFetches: usage.usedFetches,
      maxBytesPerDay: config.maxBytesPerDay,
      usedBytes: usage.usedBytes,
      exceededLimit: 'bytes'
    });
  }

  const remainingBytes = config.maxBytesPerDay ? Math.max(config.maxBytesPerDay - usage.usedBytes, 1) : undefined;

  return {
    source: {
      ...input.source,
      syncBudget: {
        ...sourceBudget,
        usedFetches: sourceBudget.usedFetches + 1,
        lastRecordedAt: input.now
      }
    },
    fetchPolicy: {
      ...input.fetchPolicy,
      ...(remainingBytes ? { maxBodyBytes: Math.min(input.fetchPolicy.maxBodyBytes, remainingBytes) } : {})
    }
  };
}

function recordSubscriptionSourceSyncBudgetBytes(
  source: SubscriptionSource,
  bodyBytes: number,
  now: string,
  defaultPolicy: SubscriptionSourceSyncBudgetPolicy
) {
  const config = resolveSubscriptionSourceSyncBudgetConfig(source, defaultPolicy);

  if (!config) {
    return undefined;
  }

  const budget = normalizeSubscriptionSourceSyncBudgetWindow(source.syncBudget, now, config);
  const recordedBodyBytes = Math.max(Math.round(bodyBytes), 0);

  return {
    ...budget,
    usedBytes: budget.usedBytes + recordedBodyBytes,
    lastFetchBytes: recordedBodyBytes,
    lastRecordedAt: now
  };
}

function readFetchedSubscriptionSourceBodyBytes(response: FetchedSubscriptionSourceContent) {
  return typeof response.bodyBytes === 'number' && Number.isFinite(response.bodyBytes) && response.bodyBytes >= 0
    ? Math.round(response.bodyBytes)
    : Buffer.byteLength(response.body, 'utf8');
}

function createFailedSubscriptionSyncResult(sourceId: string, syncedAt: string, error: unknown): SubscriptionSourceSyncResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    sourceId,
    status: 'failed',
    nodeCount: 0,
    syncedAt,
    nodes: [],
    warnings: [`subscription_source.sync_failed:${message}`]
  };
}

function normalizeSubscriptionSourceFetchPolicy(
  policy: Partial<SubscriptionSourceFetchPolicy> | undefined
): SubscriptionSourceFetchPolicy {
  return {
    timeoutMs:
      typeof policy?.timeoutMs === 'number' && Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0
        ? Math.round(policy.timeoutMs)
        : SUBSCRIPTION_SOURCE_FETCH_TIMEOUT_MS,
    maxBodyBytes:
      typeof policy?.maxBodyBytes === 'number' && Number.isFinite(policy.maxBodyBytes) && policy.maxBodyBytes > 0
        ? Math.round(policy.maxBodyBytes)
        : SUBSCRIPTION_SOURCE_MAX_BODY_BYTES
  };
}

function normalizeSubscriptionSourceEgressPolicy(
  policy: Partial<SubscriptionSourceEgressPolicy> | undefined
): SubscriptionSourceEgressPolicy {
  return normalizeRemoteEgressPolicy(policy);
}

function normalizeSubscriptionSourceProviderBudgetPolicy(
  policy: Partial<SubscriptionSourceProviderBudgetPolicy> | undefined
): SubscriptionSourceProviderBudgetPolicy {
  return {
    maxConcurrentFetchesPerHost:
      typeof policy?.maxConcurrentFetchesPerHost === 'number' &&
      Number.isFinite(policy.maxConcurrentFetchesPerHost) &&
      policy.maxConcurrentFetchesPerHost > 0
        ? Math.round(policy.maxConcurrentFetchesPerHost)
        : SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST
  };
}

function normalizeSubscriptionSourceSyncBudgetPolicy(
  policy: Partial<SubscriptionSourceSyncBudgetPolicy> | undefined
): SubscriptionSourceSyncBudgetPolicy {
  const maxFetchesPerDay =
    typeof policy?.maxFetchesPerDay === 'number' &&
    Number.isFinite(policy.maxFetchesPerDay) &&
    policy.maxFetchesPerDay > 0
      ? Math.round(policy.maxFetchesPerDay)
      : undefined;
  const maxBytesPerDay =
    typeof policy?.maxBytesPerDay === 'number' &&
    Number.isFinite(policy.maxBytesPerDay) &&
    policy.maxBytesPerDay > 0
      ? Math.round(policy.maxBytesPerDay)
      : undefined;

  return {
    ...(maxFetchesPerDay ? { maxFetchesPerDay } : {}),
    ...(maxBytesPerDay ? { maxBytesPerDay } : {})
  };
}

function resolveSubscriptionSourceFetchPolicy(
  source: SubscriptionSource,
  defaultPolicy: SubscriptionSourceFetchPolicy
): SubscriptionSourceFetchPolicy {
  return {
    timeoutMs:
      typeof source.fetchTimeoutSeconds === 'number' &&
      Number.isFinite(source.fetchTimeoutSeconds) &&
      source.fetchTimeoutSeconds > 0
        ? Math.round(source.fetchTimeoutSeconds * 1000)
        : defaultPolicy.timeoutMs,
    maxBodyBytes:
      typeof source.maxBodyBytes === 'number' && Number.isFinite(source.maxBodyBytes) && source.maxBodyBytes > 0
        ? Math.round(source.maxBodyBytes)
        : defaultPolicy.maxBodyBytes
  };
}

async function normalizeSubscriptionSourceUrl(
  source: SubscriptionSource,
  hostResolver: SubscriptionSourceHostResolver,
  egressPolicy: SubscriptionSourceEgressPolicy
) {
  let url: URL;

  try {
    url = new URL(source.url);
  } catch {
    throw new Error('subscription source url is invalid');
  }

  if (!SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error('subscription source url protocol must be http or https');
  }

  if (isBlockedRemoteHost(url.hostname)) {
    throw new Error('subscription source host is not allowed for remote fetch');
  }

  if (!isRemoteHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('subscription source host is not in the egress allowlist');
  }

  const resolvedAddresses = await resolveAllowedRemoteAddresses(url.hostname, hostResolver, {
    unresolved: 'subscription source host could not be resolved for remote fetch',
    blockedResolvedHost: 'subscription source resolved host is not allowed for remote fetch'
  });

  return {
    url,
    resolvedAddress: resolvedAddresses[0],
    resolvedAddresses
  };
}

function readContentLengthBytes(response: Response) {
  const contentLength = response.headers.get('content-length');

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readHeaderContentLengthBytes(value: string | string[] | undefined) {
  const contentLength = Array.isArray(value) ? value[0] : value;

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function createSubscriptionSourceBodyLimitError(maxBodyBytes: number) {
  return new Error(`remote response exceeds ${maxBodyBytes} bytes`);
}

function createSubscriptionSourceRequestHeaders(source: SubscriptionSource) {
  return {
    Accept:
      source.kind === 'v2ray-uri'
        ? 'text/plain,*/*'
        : source.kind === 'sing-box'
          ? 'application/json,text/json,text/plain,*/*'
          : 'text/yaml,application/yaml,text/plain,*/*',
    'User-Agent': source.userAgent || 'OU-UI-Next/1.0'
  };
}

function fetchPinnedSubscriptionSourceContent({
  target,
  headers,
  policy,
  signal
}: SubscriptionSourceRemoteFetcherInput): Promise<FetchedSubscriptionSourceContent> {
  const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const port =
    target.url.port ||
    (target.url.protocol === 'https:' ? '443' : target.url.protocol === 'http:' ? '80' : undefined);
  const hostHeader = target.url.host;

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
        method: 'GET',
        headers: {
          ...headers,
          Host: hostHeader
        },
        servername: target.url.hostname,
        signal,
        timeout: policy.timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const statusMessage = response.statusMessage || '';

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(() => reject(new Error(`remote responded ${statusCode} ${statusMessage}`.trim())));
          return;
        }

        const contentLengthBytes = readHeaderContentLengthBytes(response.headers['content-length']);

        if (contentLengthBytes !== undefined && contentLengthBytes > policy.maxBodyBytes) {
          response.resume();
          finish(() => reject(createSubscriptionSourceBodyLimitError(policy.maxBodyBytes)));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on('data', (chunk: Buffer | string) => {
          if (settled) {
            return;
          }

          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;

          if (totalBytes > policy.maxBodyBytes) {
            finish(() => reject(createSubscriptionSourceBodyLimitError(policy.maxBodyBytes)));
            request.destroy();
            return;
          }

          chunks.push(buffer);
        });

        response.on('end', () => {
          const body = Buffer.concat(chunks);
          finish(() =>
            resolve({
              body: body.toString('utf8'),
              bodyBytes: totalBytes,
              trafficHeader: Array.isArray(response.headers['subscription-userinfo'])
                ? response.headers['subscription-userinfo'][0]
                : response.headers['subscription-userinfo']
            })
          );
        });

        response.on('error', (error) => {
          finish(() => reject(error));
        });
      }
    );

    request.on('timeout', () => {
      finish(() => reject(new Error(`remote fetch timed out after ${policy.timeoutMs}ms`)));
      request.destroy();
    });

    request.on('error', (error) => {
      finish(() => reject(error));
    });

    request.end();
  });
}

async function withSubscriptionSourceFetchTimeout<T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`remote fetch timed out after ${timeoutMs}ms`));
          controller.abort();
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function fetchSubscriptionSourceContent(
  source: SubscriptionSource,
  fetcher: typeof fetch,
  remoteFetcher: SubscriptionSourceRemoteFetcher | undefined,
  hostResolver: SubscriptionSourceHostResolver,
  egressPolicy: SubscriptionSourceEgressPolicy,
  policy: SubscriptionSourceFetchPolicy
): Promise<FetchedSubscriptionSourceContent> {
  const controller = new AbortController();
  const remoteTarget = await withSubscriptionSourceFetchTimeout(
    normalizeSubscriptionSourceUrl(source, hostResolver, egressPolicy),
    controller,
    policy.timeoutMs
  );
  const headers = createSubscriptionSourceRequestHeaders(source);

  if (remoteFetcher || fetcher === fetch) {
    return withSubscriptionSourceFetchTimeout(
      (remoteFetcher ?? fetchPinnedSubscriptionSourceContent)({
        source,
        target: remoteTarget,
        headers,
        policy,
        signal: controller.signal
      }),
      controller,
      policy.timeoutMs
    );
  }

  const response = await withSubscriptionSourceFetchTimeout(
    fetcher(remoteTarget.url.toString(), {
      headers,
      signal: controller.signal
    }),
    controller,
    policy.timeoutMs
  );

  if (!response.ok) {
    throw new Error(`remote responded ${response.status} ${response.statusText}`);
  }

  const contentLengthBytes = readContentLengthBytes(response);

  if (contentLengthBytes !== undefined && contentLengthBytes > policy.maxBodyBytes) {
    throw createSubscriptionSourceBodyLimitError(policy.maxBodyBytes);
  }

  const body = await withSubscriptionSourceFetchTimeout(response.text(), controller, policy.timeoutMs);

  if (Buffer.byteLength(body, 'utf8') > policy.maxBodyBytes) {
    throw createSubscriptionSourceBodyLimitError(policy.maxBodyBytes);
  }

  return {
    body,
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    trafficHeader: response.headers.get('subscription-userinfo')
  };
}

function readSubscriptionClientDeleteId(task: DeployTask): string | undefined {
  if (task.operation !== 'subscription.delete' || readSubscriptionSourceDeleteId(task)) {
    return undefined;
  }

  const clientId = task.metadata?.subscriptionClientId;
  return typeof clientId === 'string' && clientId.trim() ? clientId.trim() : task.targetId;
}

function projectSubscriptionClientReadModel(
  client: SubscriptionClientIdentity,
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[],
  quotaResetReplayState?: ReturnType<typeof createQuotaResetReplayState>,
  nowIso?: string
): SubscriptionClientIdentity {
  const quotaResetBaseline = quotaResetReplayState
    ? readLatestSubscriptionClientResetDescriptor(quotaResetReplayState, client.id)
    : undefined;

  return projectSubscriptionClientRuntimeState({
    client,
    inbounds,
    externalNodes,
    nowIso,
    quotaResetBaseline
  }).client;
}

function projectSubscriptionClientReadModels(
  clients: SubscriptionClientIdentity[],
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[],
  quotaResetReplayState?: ReturnType<typeof createQuotaResetReplayState>,
  nowIso?: string
) {
  return clients.map((client) =>
    projectSubscriptionClientReadModel(client, inbounds, externalNodes, quotaResetReplayState, nowIso)
  );
}

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  operatorSessionStore,
  inventory = {},
  fetcher = fetch,
  telegramBotHostResolver = defaultTelegramBotHostResolver,
  telegramBotEgressEnforcement,
  subscriptionSourceRemoteFetcher,
  subscriptionSourceHostResolver = defaultSubscriptionSourceHostResolver,
  subscriptionSourceFetch,
  subscriptionSourceEgress,
  subscriptionSourceProviderBudget,
  subscriptionSourceSyncBudget,
  agentLogRetention,
  trafficRollupRetention,
  systemAlertNotifier,
  systemAlertNotificationChannels,
  systemAlertNotificationRetry,
  readModelNow = () => new Date().toISOString()
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  const enforceTelegramBotEgress = telegramBotEgressEnforcement ?? fetcher === fetch;
  const subscriptionSourceFetchPolicy = normalizeSubscriptionSourceFetchPolicy(subscriptionSourceFetch);
  const subscriptionSourceEgressPolicy = normalizeSubscriptionSourceEgressPolicy(subscriptionSourceEgress);
  const subscriptionSourceProviderBudgetPolicy = normalizeSubscriptionSourceProviderBudgetPolicy(
    subscriptionSourceProviderBudget
  );
  const subscriptionSourceSyncBudgetPolicy = normalizeSubscriptionSourceSyncBudgetPolicy(subscriptionSourceSyncBudget);
  const systemAlertNotificationRetryPolicy = normalizeSystemAlertNotificationRetryPolicy(systemAlertNotificationRetry);
  const systemAlertChannels = normalizeSystemAlertNotificationChannels({
    systemAlertNotifier,
    systemAlertNotificationChannels
  });
  const systemAlertChannelsById = new Map(systemAlertChannels.map((channel) => [channel.id, channel] as const));
  const runtimeAgentLogRetentionPolicy = createAgentLogRetentionPolicyReadModel(agentLogRetention, 'runtime-config');
  const runtimeTrafficRollupRetentionPolicyValues = createTrafficRollupRetentionPolicyValues(trafficRollupRetention);
  const runtimeTrafficRollupRetentionPolicy = createTrafficRollupRetentionPolicyReadModel({
    effective: trafficRollupRetention,
    source: 'runtime-config',
    runtimeDefault: runtimeTrafficRollupRetentionPolicyValues
  });
  const seedSubscriptionSources = clone(inventory.subscriptionSources ?? []);
  const seedSubscriptionInventoryNodes = clone(inventory.subscriptionInventoryNodes ?? []);
  const seedSubscriptionClients = clone(inventory.subscriptionClients ?? []);
  const seedSubscriptionExportProfiles = clone(inventory.subscriptionExportProfiles ?? []);
  const seedAgents = clone(inventory.agents ?? []);
  const seedInbounds = clone(inventory.inbounds ?? []);
  let subscriptionSources = clone(seedSubscriptionSources);
  let subscriptionInventoryNodes = clone(seedSubscriptionInventoryNodes);
  let subscriptionClients = clone(seedSubscriptionClients);
  let subscriptionExportProfiles = clone(seedSubscriptionExportProfiles);
  let agents = clone(seedAgents);
  let inbounds = clone(seedInbounds);
  let forwardRulesReadModel: Awaited<ReturnType<ControlPlaneRepository['listForwardRules']>> | undefined;
  let deletedAgentIds = new Set<string>();
  const recentHighFrequencyAgentEvents = new Map<string, AgentEventEnvelope>();
  const lastHighFrequencyAgentEventSeqBySession = new Map<string, number>();
  let readModelsHydrated = false;
  let readModelTasks: DeployTask[] = [];

  function updateReadModelTasks(tasks: DeployTask[]) {
    readModelTasks = sortTasksForReadModelReplay(clone(tasks));
  }

  function upsertReadModelTask(task: DeployTask) {
    updateReadModelTasks([task, ...readModelTasks.filter((item) => item.id !== task.id)]);
  }

  function createHighFrequencyAgentSessionKey(event: AgentEventEnvelope) {
    return `${event.agentId}:${event.sessionId}`;
  }

  function syncHighFrequencyAgentEventSeqsFromSessions(sessions: AgentSessionState[]) {
    for (const session of sessions) {
      const sessionKey = `${session.agentId}:${session.sessionId}`;
      const currentSeq = lastHighFrequencyAgentEventSeqBySession.get(sessionKey);

      if (currentSeq === undefined || session.lastSeq > currentSeq) {
        lastHighFrequencyAgentEventSeqBySession.set(sessionKey, session.lastSeq);
      }
    }
  }

  function rememberRecentHighFrequencyAgentEvent(event: AgentEventEnvelope) {
    if (!isHighFrequencyAgentEvent(event)) {
      return;
    }

    const sessionKey = createHighFrequencyAgentSessionKey(event);
    const currentSeq = lastHighFrequencyAgentEventSeqBySession.get(sessionKey);

    if (currentSeq !== undefined && event.seq < currentSeq) {
      return;
    }

    if (currentSeq !== undefined && event.seq === currentSeq && !recentHighFrequencyAgentEvents.has(event.eventId)) {
      return;
    }

    lastHighFrequencyAgentEventSeqBySession.set(sessionKey, event.seq);
    recentHighFrequencyAgentEvents.set(event.eventId, clone(event));

    while (recentHighFrequencyAgentEvents.size > RECENT_HIGH_FREQUENCY_AGENT_EVENT_REPLAY_LIMIT) {
      const oldestEventId = recentHighFrequencyAgentEvents.keys().next().value;

      if (!oldestEventId) {
        break;
      }

      recentHighFrequencyAgentEvents.delete(oldestEventId);
    }
  }

  function mergePersistedAndRecentAgentEvents(events: AgentEventEnvelope[]) {
    const byEventId = new Map(events.map((event) => [event.eventId, event] as const));

    for (const event of recentHighFrequencyAgentEvents.values()) {
      byEventId.set(event.eventId, event);
    }

    return sortAgentEventsForReadModelReplay([...byEventId.values()]);
  }

  async function readEffectiveAgentLogRetentionPolicy() {
    const persistedPolicy = await repository.getAgentLogRetentionPolicy();
    return persistedPolicy
      ? createAgentLogRetentionPolicyReadModel(persistedPolicy, 'control-plane')
      : runtimeAgentLogRetentionPolicy;
  }

  async function readEffectiveTrafficRollupRetentionPolicy() {
    const persistedPolicy = await repository.getTrafficRollupRetentionPolicy();
    return persistedPolicy
      ? createTrafficRollupRetentionPolicyReadModel({
          effective: persistedPolicy,
          source: 'control-plane',
          runtimeDefault: runtimeTrafficRollupRetentionPolicyValues,
          controlPlaneOverride: persistedPolicy
        })
      : runtimeTrafficRollupRetentionPolicy;
  }

  async function appendStandaloneAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
    const existingLogs = await transaction.listAuditLogs();
    const auditWithPrevHash = {
      ...auditLog,
      prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    const insertedAuditLog = {
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    };

    await transaction.insertAuditLog(insertedAuditLog);
    return insertedAuditLog;
  }

  function createTelegramAuditLog(input: {
    action: AuditLog['action'];
    operation: AuditLog['operation'];
    targetId: string;
    targetLabel: string;
    message: string;
    context: MutationContext;
    before?: unknown;
    after?: unknown;
  }): AuditLog {
    return {
      id: `audit-telegram-${randomUUID()}`,
      action: input.action,
      actor: input.context.actor,
      operatorGroupId: input.context.operatorGroupId,
      resourceGroupId: input.context.resourceGroupId,
      scope: 'control-plane:telegram-bot',
      resourceType: 'integration',
      operation: input.operation,
      result: 'succeeded',
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      taskId: '',
      severity: 'info',
      message: input.message,
      createdAt: readModelNow(),
      sourceIp: input.context.sourceIp,
      userAgent: input.context.userAgent,
      requestId: input.context.requestId,
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {})
    };
  }

  async function appendTelegramAuditLog(
    transaction: ControlPlaneTransaction,
    input: Parameters<typeof createTelegramAuditLog>[0]
  ) {
    await appendStandaloneAuditLog(transaction, createTelegramAuditLog(input));
  }

  function applyTelegramBotSecretUpdate(
    current: TelegramBotSecretState | undefined,
    input: Parameters<ControlPlaneApi['updateTelegramBotSettings']>[0]
  ): TelegramBotSecretState {
    return {
      ...(current ?? {}),
      ...(input.clearBotToken ? { botToken: undefined } : input.botToken ? { botToken: input.botToken.trim() } : {}),
      ...(input.clearWebhookSecretPath
        ? { webhookSecretPath: undefined }
        : input.webhookSecretPath
          ? { webhookSecretPath: input.webhookSecretPath.trim() }
          : {}),
      ...(input.proxy?.clearUrl ? { proxyUrl: undefined } : input.proxy?.url ? { proxyUrl: input.proxy.url.trim() } : {})
    };
  }

  function redactTelegramDeliveryAudit(delivery: TelegramNotificationDelivery) {
    return {
      ...delivery,
      ...(delivery.adminChatId ? { adminChatId: '[redacted-chat-id]' } : {})
    };
  }

  async function readTelegramBotSettingsFrom(store: {
    getTelegramBotSettings(): Promise<TelegramBotSettings | undefined>;
  }) {
    return (await store.getTelegramBotSettings()) ?? createDefaultTelegramBotSettings(readModelNow());
  }

  async function readTelegramBotSecretsFrom(store: {
    getTelegramBotSecrets(): Promise<TelegramBotSecretState | undefined>;
  }) {
    return (await store.getTelegramBotSecrets()) ?? {};
  }

  function createDefaultTelegramPolicies() {
    return [createDefaultTelegramNotificationPolicy(readModelNow())];
  }

  async function listTelegramNotificationPoliciesFrom(store: {
    listTelegramNotificationPolicies(): Promise<TelegramNotificationPolicy[]>;
  }) {
    const policies = await store.listTelegramNotificationPolicies();
    return policies.length > 0 ? policies : createDefaultTelegramPolicies();
  }

  function createTelegramBindingReadModels(input: {
    customerBindings: TelegramCustomerBinding[];
    chatBindings: TelegramChatBinding[];
    policies: TelegramNotificationPolicy[];
    deliveries: TelegramNotificationDelivery[];
  }) {
    return input.customerBindings
      .map((binding) =>
        createTelegramBindingModels({
          binding,
          chats: input.chatBindings,
          policies: input.policies,
          deliveries: input.deliveries
        })
      )
      .filter((binding): binding is TelegramBindingReadModel => Boolean(binding))
      .sort((left, right) => right.customerBinding.createdAt.localeCompare(left.customerBinding.createdAt));
  }

  async function listTelegramBindingReadModelsFrom(store: {
    listTelegramCustomerBindings(): Promise<TelegramCustomerBinding[]>;
    listTelegramChatBindings(): Promise<TelegramChatBinding[]>;
    listTelegramNotificationPolicies(): Promise<TelegramNotificationPolicy[]>;
    listTelegramNotificationDeliveries(): Promise<TelegramNotificationDelivery[]>;
  }) {
    const [customerBindings, chatBindings, policies, deliveries] = await Promise.all([
      store.listTelegramCustomerBindings(),
      store.listTelegramChatBindings(),
      listTelegramNotificationPoliciesFrom(store),
      store.listTelegramNotificationDeliveries()
    ]);

    return createTelegramBindingReadModels({
      customerBindings,
      chatBindings,
      policies,
      deliveries
    });
  }

  function createTelegramTestMessageText(language: TelegramBotSettings['language']) {
    return language === 'zh-CN'
      ? '测试通知：Telegram Bot 已连接到 OU-UI Next。'
      : 'Test notification: Telegram Bot is connected to OU-UI Next.';
  }

  function normalizeTelegramBotApiBaseUrl(value: string | undefined) {
    return (value?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
  }

  function readTelegramBotRemoteUrl(value: string, invalidMessage: string) {
    try {
      return new URL(value);
    } catch {
      throw new Error(invalidMessage);
    }
  }

  async function assertTelegramRemoteUrlAllowed(input: {
    url: URL;
    allowedProtocols: Set<string>;
    egressPolicy: RemoteEgressPolicy;
    protocolMessage: string;
    blockedHostMessage: string;
    allowlistMessage: string;
    unresolvedMessage: string;
    blockedResolvedHostMessage: string;
  }) {
    if (!input.allowedProtocols.has(input.url.protocol)) {
      throw new Error(input.protocolMessage);
    }

    if (isBlockedRemoteHost(input.url.hostname)) {
      throw new Error(input.blockedHostMessage);
    }

    if (!isRemoteHostAllowedByEgressPolicy(input.url.hostname, input.egressPolicy)) {
      throw new Error(input.allowlistMessage);
    }

    await resolveAllowedRemoteAddresses(input.url.hostname, telegramBotHostResolver, {
      unresolved: input.unresolvedMessage,
      blockedResolvedHost: input.blockedResolvedHostMessage
    });
  }

  async function assertTelegramBotTransportEgress(settings: TelegramBotSettings, secrets: TelegramBotSecretState) {
    if (!enforceTelegramBotEgress) {
      return;
    }

    const egressPolicy = normalizeRemoteEgressPolicy({ allowedHosts: settings.egressAllowlist });
    const apiUrl = readTelegramBotRemoteUrl(
      normalizeTelegramBotApiBaseUrl(settings.customApiBaseUrl),
      'telegram bot api base url is invalid'
    );

    await assertTelegramRemoteUrlAllowed({
      url: apiUrl,
      allowedProtocols: TELEGRAM_BOT_API_ALLOWED_PROTOCOLS,
      egressPolicy,
      protocolMessage: 'telegram bot api base url protocol must be https',
      blockedHostMessage: 'telegram bot api host is not allowed for remote delivery',
      allowlistMessage: 'telegram bot api host is not in the egress allowlist',
      unresolvedMessage: 'telegram bot api host could not be resolved for remote delivery',
      blockedResolvedHostMessage: 'telegram bot api resolved host is not allowed for remote delivery'
    });

    if (!secrets.proxyUrl) {
      return;
    }

    const proxyUrl = readTelegramBotRemoteUrl(secrets.proxyUrl, 'telegram bot proxy url is invalid');
    await assertTelegramRemoteUrlAllowed({
      url: proxyUrl,
      allowedProtocols: TELEGRAM_BOT_PROXY_ALLOWED_PROTOCOLS,
      egressPolicy,
      protocolMessage: 'telegram bot proxy url protocol must be http, https, or socks5',
      blockedHostMessage: 'telegram bot proxy host is not allowed for remote delivery',
      allowlistMessage: 'telegram bot proxy host is not in the egress allowlist',
      unresolvedMessage: 'telegram bot proxy host could not be resolved for remote delivery',
      blockedResolvedHostMessage: 'telegram bot proxy resolved host is not allowed for remote delivery'
    });
  }

  async function sendTelegramBotMessageWithEgress(input: {
    settings: TelegramBotSettings;
    secrets: TelegramBotSecretState;
    request: Parameters<typeof sendTelegramBotMessage>[0]['request'];
  }) {
    try {
      await assertTelegramBotTransportEgress(input.settings, input.secrets);
    } catch (error) {
      return {
        ok: false as const,
        errorMessage: sanitizeTelegramBotErrorMessage(error, [
          input.secrets.botToken,
          input.secrets.proxyUrl,
          input.settings.customApiBaseUrl
        ])
      };
    }

    if (!input.secrets.botToken) {
      return {
        ok: false as const,
        errorMessage: 'telegram bot token is not available'
      };
    }

    let transportFetch = fetcher;

    if (input.secrets.proxyUrl) {
      try {
        transportFetch = createTelegramBotProxyFetch(input.secrets.proxyUrl);
      } catch (error) {
        return {
          ok: false as const,
          errorMessage: sanitizeTelegramBotErrorMessage(error, [
            input.secrets.botToken,
            input.secrets.proxyUrl,
            input.settings.customApiBaseUrl
          ])
        };
      }
    }

    return sendTelegramBotMessage({
      botToken: input.secrets.botToken,
      customApiBaseUrl: input.settings.customApiBaseUrl,
      requestTimeoutMs: input.settings.requestTimeoutMs,
      fetcher: transportFetch,
      request: input.request
    });
  }

  async function fetchTelegramBotUpdatesWithEgress(input: {
    settings: TelegramBotSettings;
    secrets: TelegramBotSecretState;
    offset?: number;
  }) {
    try {
      await assertTelegramBotTransportEgress(input.settings, input.secrets);
    } catch (error) {
      return {
        ok: false as const,
        errorMessage: sanitizeTelegramBotErrorMessage(error, [
          input.secrets.botToken,
          input.secrets.proxyUrl,
          input.settings.customApiBaseUrl
        ])
      };
    }

    if (!input.secrets.botToken) {
      return {
        ok: false as const,
        errorMessage: 'telegram bot token is not available'
      };
    }

    let transportFetch = fetcher;

    if (input.secrets.proxyUrl) {
      try {
        transportFetch = createTelegramBotProxyFetch(input.secrets.proxyUrl);
      } catch (error) {
        return {
          ok: false as const,
          errorMessage: sanitizeTelegramBotErrorMessage(error, [
            input.secrets.botToken,
            input.secrets.proxyUrl,
            input.settings.customApiBaseUrl
          ])
        };
      }
    }

    return fetchTelegramBotUpdates({
      botToken: input.secrets.botToken,
      customApiBaseUrl: input.settings.customApiBaseUrl,
      requestTimeoutMs: input.settings.requestTimeoutMs,
      fetcher: transportFetch,
      offset: input.offset,
      timeoutSeconds: 0,
      allowedUpdates: input.settings.allowedUpdates
    });
  }

  function applyTelegramDeliveryAttemptResult(input: {
    delivery: TelegramNotificationDelivery;
    now: string;
    retryInitialDelayMs: number;
    attemptCount?: number;
    result:
      | Awaited<ReturnType<typeof sendTelegramBotMessage>>
      | {
          ok: false;
          errorMessage: string;
        };
  }): TelegramNotificationDelivery {
    const attemptCount = input.attemptCount ?? input.delivery.attemptCount + 1;

    if (input.result.ok) {
      return {
        ...input.delivery,
        status: 'delivered',
        attemptCount,
        lastAttemptAt: input.now,
        deliveredAt: input.now,
        updatedAt: input.now,
        lastErrorMessage: undefined
      };
    }

    const retryAfterSeconds = 'retryAfterSeconds' in input.result ? input.result.retryAfterSeconds : undefined;
    const retryDelayMs =
      retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : Math.max(input.retryInitialDelayMs, 1000);
    const exhausted = attemptCount >= input.delivery.maxAttempts;

    return {
      ...input.delivery,
      status: exhausted ? 'dead_letter' : 'failed',
      attemptCount,
      lastAttemptAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: new Date(Date.parse(input.now) + retryDelayMs).toISOString(),
      ...(exhausted ? { deadLetteredAt: input.now } : {}),
      lastErrorMessage: sanitizeTelegramBotErrorMessage(input.result.errorMessage)
    };
  }

  function compareTelegramNotificationDeliveries(
    left: TelegramNotificationDelivery,
    right: TelegramNotificationDelivery
  ) {
    return parseTimestampMs(right.updatedAt) - parseTimestampMs(left.updatedAt) || right.id.localeCompare(left.id);
  }

  function compactTelegramNotificationDeliveries(
    deliveries: TelegramNotificationDelivery[],
    historyLimit: number
  ) {
    return clone(
      [...deliveries]
        .sort(compareTelegramNotificationDeliveries)
        .slice(0, Math.max(1, Math.round(historyLimit)))
    );
  }

  function isRetryableTelegramNotificationDelivery(delivery: TelegramNotificationDelivery) {
    return delivery.status === 'pending' || delivery.status === 'failed';
  }

  function isDueTelegramNotificationDelivery(delivery: TelegramNotificationDelivery, now: string) {
    return isRetryableTelegramNotificationDelivery(delivery) && Date.parse(delivery.nextAttemptAt) <= parseTimestampMs(now);
  }

  function readTelegramDeliveryRetryChatId(
    delivery: TelegramNotificationDelivery,
    bindings: TelegramBindingReadModel[]
  ) {
    if (delivery.adminChatId) {
      return delivery.adminChatId;
    }

    const binding = bindings.find(
      (item) => item.id === delivery.customerBindingId || item.chat.id === delivery.chatBindingId
    );

    if (
      !binding
      || binding.customerBinding.status !== 'active'
      || binding.chat.status === 'blocked'
      || binding.chat.status === 'revoked'
    ) {
      return undefined;
    }

    return binding.chat.telegramChatId;
  }

  function readTelegramDeliveryRetryText(
    delivery: TelegramNotificationDelivery,
    settings: TelegramBotSettings
  ) {
    return (
      delivery.renderedPreviewRedacted
      ?? (settings.language === 'zh-CN'
        ? 'Telegram 通知内容不可恢复，请在控制面板中查看详情。'
        : 'Telegram notification content is not recoverable. Check the control panel for details.')
    );
  }

  function createTelegramReplyDelivery(input: {
    chatId: string;
    notificationType: TelegramNotificationDelivery['notificationType'];
    language: TelegramNotificationDelivery['language'];
    now: string;
    sequence: number;
    status: TelegramNotificationDelivery['status'];
    text: string;
    renderedPreviewRedacted?: string;
    result?: Awaited<ReturnType<typeof sendTelegramBotMessage>>;
    chatBindingId?: string;
    customerBindingId?: string;
  }): TelegramNotificationDelivery {
    const renderedPreviewRedacted = input.renderedPreviewRedacted ?? input.text;

    return {
      id: `telegram-delivery-${String(input.sequence).padStart(4, '0')}`,
      dedupeKey: `telegram-command-reply:${input.chatId}:${input.now}`,
      notificationType: input.notificationType,
      recipientKind: input.customerBindingId ? 'customer-binding' : 'admin-chat',
      adminChatId: input.customerBindingId ? undefined : input.chatId,
      chatBindingId: input.chatBindingId,
      customerBindingId: input.customerBindingId,
      policyId: TELEGRAM_DEFAULT_POLICY_ID,
      templateId: `telegram.command.${input.notificationType}.${input.language}`,
      language: input.language,
      status: input.status,
      createdAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      attemptCount: input.result ? 1 : 0,
      maxAttempts: 1,
      lastAttemptAt: input.result ? input.now : undefined,
      deliveredAt: input.result?.ok ? input.now : undefined,
      lastErrorMessage: input.result && !input.result.ok ? input.result.errorMessage : undefined,
      renderedPreviewRedacted,
      payloadHash: createStableTelegramHash({
        chatId: input.chatId,
        notificationType: input.notificationType,
        text: renderedPreviewRedacted
      }),
      target: {}
    };
  }

  type TelegramParsedCommand = {
    name: string;
    args: string[];
    rawArgs: string;
  };

  type TelegramCommandDataContext = {
    customers: CustomerReadModel[];
    subscriptionClients: SubscriptionClientIdentity[];
    inbounds: XrayInbound[];
    subscriptionInventoryNodes: SubscriptionInventoryNode[];
    forwardRules: ForwardRule[];
    policies: TelegramNotificationPolicy[];
  };

  type TelegramCommandReply = {
    action: TelegramWebhookHandleResult['action'];
    notificationType: TelegramNotificationDelivery['notificationType'];
    text: string;
    renderedPreviewRedacted?: string;
    binding?: TelegramBindingReadModel;
    chatBindingId?: string;
    customerBindingId?: string;
  };

  function readTelegramCommand(update: TelegramWebhookUpdate): TelegramParsedCommand | undefined {
    const text = update.message?.text?.trim();

    if (!text?.startsWith('/')) {
      return undefined;
    }

    const [rawCommand, ...args] = text.split(/\s+/);
    const name = rawCommand.slice(1).split('@')[0]?.toLowerCase();

    if (!name) {
      return undefined;
    }

    return {
      name,
      args,
      rawArgs: args.join(' ').trim()
    };
  }

  function normalizeTelegramBindingCode(value: string) {
    return value.trim().toUpperCase();
  }

  function hashTelegramBindingCode(value: string) {
    return `sha256:${createHash('sha256').update(normalizeTelegramBindingCode(value)).digest('hex')}`;
  }

  function readTelegramStartCode(update: TelegramWebhookUpdate) {
    const command = readTelegramCommand(update);

    if (command?.name !== 'start') {
      return undefined;
    }

    return normalizeTelegramBindingCode(command.rawArgs);
  }

  function readTelegramChatType(value: string | undefined): TelegramChatBinding['chatType'] {
    return value === 'group' || value === 'supergroup' || value === 'channel' ? value : 'private';
  }

  function readTelegramDisplayName(update: TelegramWebhookUpdate) {
    const from = update.message?.from;
    const chat = update.message?.chat;
    const fromName = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
    const chatName = [chat?.first_name, chat?.last_name].filter(Boolean).join(' ').trim();
    return fromName || chatName || chat?.title || chat?.username || from?.username;
  }

  function escapeTelegramHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeTelegramHtmlAttribute(value: string) {
    return escapeTelegramHtml(value).replace(/"/g, '&quot;');
  }

  function limitTelegramMessageText(value: string) {
    if (value.length <= 3500) {
      return value;
    }

    return `${value.slice(0, 3450)}\n...`;
  }

  function normalizeTelegramIdentity(value: string | undefined) {
    return value?.trim().toLowerCase() || '';
  }

  function identityMatches(left: string | undefined, right: string | undefined) {
    const normalizedLeft = normalizeTelegramIdentity(left);
    const normalizedRight = normalizeTelegramIdentity(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }

  function formatTelegramBytes(value: number | undefined) {
    const bytes = Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unitIndex = 0;

    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }

    const precision = amount >= 10 || unitIndex === 0 ? 0 : 1;
    return `${amount.toFixed(precision)} ${units[unitIndex]}`;
  }

  function formatTelegramTrafficRatio(usedBytes: number, limitBytes: number, language: TelegramBotSettings['language']) {
    if (limitBytes <= 0) {
      return language === 'zh-CN' ? '不限' : 'unlimited';
    }

    return `${Math.round((usedBytes / limitBytes) * 100)}%`;
  }

  function formatTelegramDate(value: string | undefined, language: TelegramBotSettings['language'], now: string) {
    if (!value) {
      return language === 'zh-CN' ? '未设置' : 'not set';
    }

    const expiresAtMs = Date.parse(value);
    const nowMs = Date.parse(now);

    if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
      return value.slice(0, 10);
    }

    const remainingDays = Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000));
    const date = value.slice(0, 10);

    if (remainingDays < 0) {
      return language === 'zh-CN' ? `${date}（已过期 ${Math.abs(remainingDays)} 天）` : `${date} (${Math.abs(remainingDays)} days expired)`;
    }

    return language === 'zh-CN' ? `${date}（剩余 ${remainingDays} 天）` : `${date} (${remainingDays} days left)`;
  }

  function formatTelegramTimestamp(value: string | undefined, language: TelegramBotSettings['language']) {
    if (!value) {
      return language === 'zh-CN' ? '未记录' : 'not recorded';
    }

    const timestampMs = Date.parse(value);

    if (!Number.isFinite(timestampMs)) {
      return value.slice(0, 19).replace('T', ' ');
    }

    return new Date(timestampMs).toISOString().slice(0, 19).replace('T', ' ');
  }

  function formatTelegramCustomerStatus(status: CustomerReadModel['status'] | undefined, language: TelegramBotSettings['language']) {
    if (language === 'zh-CN') {
      return status === 'expired' ? '已过期' : status === 'limited' ? '受限' : '正常';
    }

    return status === 'expired' ? 'expired' : status === 'limited' ? 'limited' : 'active';
  }

  function formatTelegramBindingLabel(binding: TelegramBindingReadModel) {
    return escapeTelegramHtml(
      binding.customerBinding.scopeLabelSnapshot
        ?? binding.customerBinding.customerNameSnapshot
        ?? binding.customerBinding.customerId
    );
  }

  function findTelegramCustomerForBinding(data: TelegramCommandDataContext, binding: TelegramBindingReadModel) {
    return (
      data.customers.find((customer) => customer.id === binding.customerBinding.customerId)
      ?? data.customers.find((customer) => identityMatches(customer.name, binding.customerBinding.customerNameSnapshot))
    );
  }

  function telegramBindingMatchesChat(input: {
    binding: TelegramBindingReadModel;
    chatId: string;
    fromId?: string;
    chatType: TelegramChatBinding['chatType'];
    settings: TelegramBotSettings;
  }) {
    if (
      input.binding.customerBinding.status !== 'active'
      || input.binding.chat.status === 'blocked'
      || input.binding.chat.status === 'revoked'
    ) {
      return false;
    }

    if (input.binding.chat.telegramChatId !== input.chatId) {
      return false;
    }

    if (input.chatType !== 'private' || input.binding.chat.chatType !== 'private') {
      return input.settings.groupChatPolicy === 'allow_customer_notifications_explicit';
    }

    return !input.fromId || !input.binding.chat.telegramUserId || input.binding.chat.telegramUserId === input.fromId;
  }

  async function listTelegramBindingsForCommand(input: {
    chatId: string;
    fromId?: string;
    chatType: TelegramChatBinding['chatType'];
    settings: TelegramBotSettings;
  }) {
    const bindings = await listTelegramBindingReadModelsFrom(repository);

    return bindings.filter((binding) =>
      telegramBindingMatchesChat({
        binding,
        chatId: input.chatId,
        fromId: input.fromId,
        chatType: input.chatType,
        settings: input.settings
      })
    );
  }

  async function readTelegramCommandDataContext(): Promise<TelegramCommandDataContext> {
    const [customers, subscriptionClients, inbounds, subscriptionInventoryNodes, forwardRules, policies] = await Promise.all([
      api.listCustomers(),
      api.listSubscriptionClients(),
      api.listInbounds(),
      api.listSubscriptionInventoryNodes(),
      api.listForwardRules(),
      listTelegramNotificationPoliciesFrom(repository)
    ]);

    return {
      customers,
      subscriptionClients,
      inbounds,
      subscriptionInventoryNodes,
      forwardRules,
      policies
    };
  }

  function selectTelegramSubscriptionClientsForBinding(
    data: TelegramCommandDataContext,
    binding: TelegramBindingReadModel
  ) {
    const customer = findTelegramCustomerForBinding(data, binding);
    const scopeId = binding.customerBinding.scopeId;

    if (binding.customerBinding.scopeType === 'subscription-user') {
      return data.subscriptionClients.filter(
        (client) =>
          identityMatches(client.id, scopeId)
          || identityMatches(client.subId, scopeId)
          || identityMatches(client.email, scopeId)
          || identityMatches(client.displayName, scopeId)
      );
    }

    if (binding.customerBinding.scopeType !== 'customer') {
      return [];
    }

    return data.subscriptionClients.filter(
      (client) =>
        customer?.subscriptionClientIds.includes(client.id)
        || identityMatches(client.customerName, binding.customerBinding.customerNameSnapshot)
        || identityMatches(client.customerName, customer?.name)
    );
  }

  function selectTelegramInboundsForBinding(data: TelegramCommandDataContext, binding: TelegramBindingReadModel) {
    const customer = findTelegramCustomerForBinding(data, binding);
    const scopeId = binding.customerBinding.scopeId;

    if (binding.customerBinding.scopeType === 'xray-client') {
      return data.inbounds.filter(
        (inbound) =>
          identityMatches(inbound.id, scopeId)
          || inbound.clients.some(
            (client) =>
              identityMatches(client.id, scopeId)
              || identityMatches(client.email, scopeId)
              || identityMatches(client.subId, scopeId)
          )
      );
    }

    if (binding.customerBinding.scopeType !== 'customer') {
      return [];
    }

    return data.inbounds.filter(
      (inbound) =>
        customer?.customerNodeIds.includes(inbound.id)
        || identityMatches(inbound.customerName, binding.customerBinding.customerNameSnapshot)
        || identityMatches(inbound.customerName, customer?.name)
    );
  }

  function selectTelegramForwardRulesForBinding(data: TelegramCommandDataContext, binding: TelegramBindingReadModel) {
    const customer = findTelegramCustomerForBinding(data, binding);
    const scopeId = binding.customerBinding.scopeId;

    if (binding.customerBinding.scopeType === 'forwarding-rule') {
      return data.forwardRules.filter((rule) => identityMatches(rule.id, scopeId));
    }

    if (binding.customerBinding.scopeType === 'forwarding-owner') {
      return data.forwardRules.filter(
        (rule) =>
          identityMatches(rule.ownerName, scopeId)
          || identityMatches(rule.ownerName, binding.customerBinding.scopeLabelSnapshot)
          || identityMatches(rule.ownerName, binding.customerBinding.customerNameSnapshot)
      );
    }

    if (binding.customerBinding.scopeType !== 'customer') {
      return [];
    }

    return data.forwardRules.filter(
      (rule) =>
        customer?.forwardRuleIds.includes(rule.id)
        || identityMatches(rule.ownerName, binding.customerBinding.customerNameSnapshot)
        || identityMatches(rule.ownerName, customer?.name)
    );
  }

  function readTelegramBindingTrafficTotals(data: TelegramCommandDataContext, binding: TelegramBindingReadModel) {
    const customer = findTelegramCustomerForBinding(data, binding);

    if (binding.customerBinding.scopeType === 'customer' && customer) {
      return {
        usedBytes: customer.usedTrafficBytes,
        limitBytes: customer.trafficLimitBytes
      };
    }

    const subscriptionClients = selectTelegramSubscriptionClientsForBinding(data, binding);
    const inbounds = selectTelegramInboundsForBinding(data, binding);
    const forwardRules = selectTelegramForwardRulesForBinding(data, binding);
    const inboundUsedBytes = inbounds.flatMap((inbound) => inbound.clients).reduce((sum, client) => sum + client.usedTrafficBytes, 0);
    const inboundLimitBytes = inbounds
      .flatMap((inbound) => inbound.clients)
      .reduce((sum, client) => sum + client.trafficLimitBytes, 0);
    const subscriptionUsedBytes = subscriptionClients.reduce((sum, client) => sum + client.usedTrafficBytes, 0);
    const subscriptionLimitBytes = subscriptionClients.reduce((sum, client) => sum + client.trafficLimitBytes, 0);
    const forwardingUsedBytes = forwardRules.reduce((sum, rule) => sum + calculateForwardingBilledBytes(rule), 0);
    const forwardingLimitBytes = forwardRules.reduce((sum, rule) => sum + Math.max(rule.quotaBytes ?? 0, 0), 0);

    return {
      usedBytes: Math.max(inboundUsedBytes, subscriptionUsedBytes) + forwardingUsedBytes,
      limitBytes: Math.max(inboundLimitBytes, subscriptionLimitBytes) + forwardingLimitBytes
    };
  }

  function readTelegramBindingExpiry(data: TelegramCommandDataContext, binding: TelegramBindingReadModel) {
    const customer = findTelegramCustomerForBinding(data, binding);

    if (binding.customerBinding.scopeType === 'customer' && customer?.expiresAt) {
      return customer.expiresAt;
    }

    return [
      ...selectTelegramSubscriptionClientsForBinding(data, binding).map((client) => client.expiresAt),
      ...selectTelegramInboundsForBinding(data, binding).flatMap((inbound) => inbound.clients.map((client) => client.expiresAt)),
      ...selectTelegramForwardRulesForBinding(data, binding).map((rule) => rule.trafficBillingPeriod)
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))[0];
  }

  function readTelegramEffectivePolicy(
    data: TelegramCommandDataContext,
    binding: TelegramBindingReadModel,
    settings: TelegramBotSettings
  ) {
    return (
      binding.policy
      ?? (binding.customerBinding.policyId
        ? data.policies.find((policy) => policy.id === binding.customerBinding.policyId)
        : undefined)
      ?? data.policies.find((policy) => policy.id === settings.defaultPolicyId)
      ?? data.policies.find((policy) => policy.id === TELEGRAM_DEFAULT_POLICY_ID)
      ?? createDefaultTelegramNotificationPolicy(readModelNow())
    );
  }

  function addTelegramScheduleSkip(
    result: Pick<TelegramNotificationScheduleScanResult, 'skipped'>,
    reason: TelegramNotificationScheduleScanSkipReason
  ) {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  }

  function telegramPolicyAllowsNotification(policy: TelegramNotificationPolicy, notificationType: TelegramNotificationType) {
    return policy.forcedNotificationTypes.includes(notificationType) || policy.notificationTypes.includes(notificationType);
  }

  function isTelegramBindingInactive(binding: TelegramBindingReadModel) {
    return (
      binding.customerBinding.status !== 'active'
      || binding.chat.status === 'blocked'
      || binding.chat.status === 'revoked'
    );
  }

  function readTelegramBindingTrafficPeriod(
    data: TelegramCommandDataContext,
    binding: TelegramBindingReadModel,
    now: string
  ) {
    const periodKeys = new Set<string>();

    for (const inbound of selectTelegramInboundsForBinding(data, binding)) {
      for (const client of inbound.clients) {
        const key = client.trafficBillingPeriod ?? resolveMonthlyBillingPeriodKey(client.monthlyResetDay ?? 1, now);

        if (key) {
          periodKeys.add(key);
        }
      }
    }

    for (const rule of selectTelegramForwardRulesForBinding(data, binding)) {
      const key = rule.trafficBillingPeriod ?? resolveMonthlyBillingPeriodKey(rule.monthlyResetDay, now);

      if (key) {
        periodKeys.add(key);
      }
    }

    for (const client of selectTelegramSubscriptionClientsForBinding(data, binding)) {
      periodKeys.add(client.quotaResetAt ? `subscription-reset-${client.quotaResetAt.slice(0, 10)}` : 'subscription-reset-default');
    }

    return [...periodKeys].sort().join('+') || resolveMonthlyBillingPeriodKey(1, now) || now.slice(0, 10);
  }

  function readTelegramDeliveryCountWithinHour(
    deliveries: TelegramNotificationDelivery[],
    bindingId: string,
    now: string
  ) {
    const nowMs = parseTimestampMs(now);
    const windowStartedAt = nowMs - 60 * 60 * 1000;

    return deliveries.filter((delivery) => {
      if (delivery.customerBindingId !== bindingId || delivery.status === 'suppressed') {
        return false;
      }

      const createdAtMs = Date.parse(delivery.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= windowStartedAt && createdAtMs <= nowMs;
    }).length;
  }

  function readTelegramAdminDeliveryCountWithinHour(
    deliveries: TelegramNotificationDelivery[],
    adminChatId: string,
    now: string
  ) {
    const nowMs = parseTimestampMs(now);
    const windowStartedAt = nowMs - 60 * 60 * 1000;

    return deliveries.filter((delivery) => {
      if (delivery.adminChatId !== adminChatId || delivery.status === 'suppressed') {
        return false;
      }

      const createdAtMs = Date.parse(delivery.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= windowStartedAt && createdAtMs <= nowMs;
    }).length;
  }

  function readTelegramDefaultPolicy(data: TelegramCommandDataContext, settings: TelegramBotSettings) {
    return (
      data.policies.find((policy) => policy.id === settings.defaultPolicyId)
      ?? data.policies.find((policy) => policy.id === TELEGRAM_DEFAULT_POLICY_ID)
      ?? createDefaultTelegramNotificationPolicy(readModelNow())
    );
  }

  function createTelegramDeliveryTarget(binding: TelegramBindingReadModel): TelegramNotificationDelivery['target'] {
    return {
      customerId: binding.customerBinding.customerId,
      scopeType: binding.customerBinding.scopeType,
      ...(binding.customerBinding.scopeId
        ? { scopeIdHash: createStableTelegramHash(binding.customerBinding.scopeId) }
        : {})
    };
  }

  function createTelegramSystemAlertDedupeKey(adminChatId: string, alert: SystemAlert) {
    return `telegram-schedule:system-alert:${createStableTelegramHash(adminChatId).slice(7, 19)}:${createStableTelegramHash({
      dedupeKey: alert.dedupeKey,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      resourceType: alert.resourceType,
      resourceId: alert.resourceId,
      resourceLabel: alert.resourceLabel
    }).slice(7, 31)}`;
  }

  function createTelegramSystemAlertText(input: {
    alert: SystemAlert;
    language: TelegramBotSettings['language'];
  }) {
    const severity = escapeTelegramHtml(input.alert.severity);
    const kind = escapeTelegramHtml(input.alert.kind);
    const title = escapeTelegramHtml(input.alert.title);
    const message = escapeTelegramHtml(input.alert.message);
    const resource = escapeTelegramHtml(`${input.alert.resourceLabel || input.alert.resourceId}`);

    return input.language === 'zh-CN'
      ? limitTelegramMessageText(
          [
            '<b>系统告警</b>',
            `级别：${severity}`,
            `类型：${kind}`,
            `标题：${title}`,
            `资源：${resource}`,
            `详情：${message}`
          ].join('\n')
        )
      : limitTelegramMessageText(
          [
            '<b>System alert</b>',
            `Severity: ${severity}`,
            `Kind: ${kind}`,
            `Title: ${title}`,
            `Resource: ${resource}`,
            `Details: ${message}`
          ].join('\n')
        );
  }

  function createTelegramSystemAlertDelivery(input: {
    adminChatId: string;
    alert: SystemAlert;
    policy: TelegramNotificationPolicy;
    settings: TelegramBotSettings;
    now: string;
    sequence: number;
  }): TelegramNotificationDelivery {
    const text = createTelegramSystemAlertText({
      alert: input.alert,
      language: input.policy.language
    });

    return {
      id: `telegram-delivery-${String(input.sequence).padStart(4, '0')}`,
      dedupeKey: createTelegramSystemAlertDedupeKey(input.adminChatId, input.alert),
      notificationType: 'system.alert',
      recipientKind: 'admin-chat',
      adminChatId: input.adminChatId,
      policyId: input.policy.id,
      templateId: `telegram.schedule.system_alert.${input.policy.language}`,
      language: input.policy.language,
      status: 'pending',
      createdAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      attemptCount: 0,
      maxAttempts: input.settings.retry.maxAttempts,
      renderedPreviewRedacted: text,
      payloadHash: createStableTelegramHash({
        adminChatIdHash: createStableTelegramHash(input.adminChatId),
        alert: {
          dedupeKey: input.alert.dedupeKey,
          kind: input.alert.kind,
          severity: input.alert.severity,
          title: input.alert.title,
          message: input.alert.message,
          resourceType: input.alert.resourceType,
          resourceId: input.alert.resourceId,
          resourceLabel: input.alert.resourceLabel
        }
      }),
      target: {
        alertId: input.alert.id
      }
    };
  }

  function readTelegramProviderSyncNotificationType(alert: SystemAlert): TelegramNotificationType | undefined {
    if (alert.kind === 'subscription_source.sync_failed') {
      return 'provider.sync_failed';
    }

    if (alert.kind === 'subscription_source.sync_warning') {
      return 'provider.sync_warning';
    }

    return undefined;
  }

  function isTelegramProviderSyncAlert(alert: SystemAlert) {
    return readTelegramProviderSyncNotificationType(alert) !== undefined;
  }

  function readTelegramSystemAlertMetadataString(alert: SystemAlert, key: string) {
    const value = alert.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  function readTelegramSystemAlertMetadataValue(alert: SystemAlert, key: string) {
    const value = alert.metadata?.[key];
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined;
  }

  function createTelegramProviderSyncAlertDedupeKey(
    adminChatId: string,
    alert: SystemAlert,
    notificationType: TelegramNotificationType
  ) {
    return `telegram-schedule:provider-sync:${notificationType}:${createStableTelegramHash(adminChatId).slice(7, 19)}:${createStableTelegramHash({
      dedupeKey: alert.dedupeKey,
      kind: alert.kind,
      severity: alert.severity,
      resourceId: alert.resourceId,
      resourceLabel: alert.resourceLabel,
      warningSummary: readTelegramSystemAlertMetadataString(alert, 'warningSummary')
    }).slice(7, 31)}`;
  }

  function createTelegramProviderSyncAlertText(input: {
    alert: SystemAlert;
    notificationType: TelegramNotificationType;
    language: TelegramBotSettings['language'];
  }) {
    const failed = input.notificationType === 'provider.sync_failed';
    const source = escapeTelegramHtml(input.alert.resourceLabel || input.alert.resourceId);
    const sourceStatus = escapeTelegramHtml(
      readTelegramSystemAlertMetadataValue(input.alert, 'sourceStatus') ?? input.alert.severity
    );
    const nodeCount = readTelegramSystemAlertMetadataValue(input.alert, 'nodeCount');
    const lastSyncAt = readTelegramSystemAlertMetadataString(input.alert, 'lastSyncAt') ?? input.alert.observedAt;
    const detail = escapeTelegramHtml(
      readTelegramSystemAlertMetadataString(input.alert, 'warningSummary') ?? input.alert.message
    );

    return input.language === 'zh-CN'
      ? limitTelegramMessageText(
          [
            failed ? '<b>订阅源同步失败</b>' : '<b>订阅源同步告警</b>',
            `订阅源：${source}`,
            `状态：${sourceStatus}`,
            nodeCount ? `节点数：${escapeTelegramHtml(nodeCount)}` : '',
            `最近同步：${formatTelegramTimestamp(lastSyncAt, input.language)}`,
            `详情：${detail}`
          ].filter(Boolean).join('\n')
        )
      : limitTelegramMessageText(
          [
            failed ? '<b>Provider sync failed</b>' : '<b>Provider sync warning</b>',
            `Provider: ${source}`,
            `Status: ${sourceStatus}`,
            nodeCount ? `Nodes: ${escapeTelegramHtml(nodeCount)}` : '',
            `Last sync: ${formatTelegramTimestamp(lastSyncAt, input.language)}`,
            `Details: ${detail}`
          ].filter(Boolean).join('\n')
        );
  }

  function createTelegramProviderSyncAlertDelivery(input: {
    adminChatId: string;
    alert: SystemAlert;
    notificationType: TelegramNotificationType;
    policy: TelegramNotificationPolicy;
    settings: TelegramBotSettings;
    now: string;
    sequence: number;
  }): TelegramNotificationDelivery {
    const text = createTelegramProviderSyncAlertText({
      alert: input.alert,
      notificationType: input.notificationType,
      language: input.policy.language
    });

    return {
      id: `telegram-delivery-${String(input.sequence).padStart(4, '0')}`,
      dedupeKey: createTelegramProviderSyncAlertDedupeKey(input.adminChatId, input.alert, input.notificationType),
      notificationType: input.notificationType,
      recipientKind: 'admin-chat',
      adminChatId: input.adminChatId,
      policyId: input.policy.id,
      templateId: `telegram.schedule.${input.notificationType.replace(/\./g, '_')}.${input.policy.language}`,
      language: input.policy.language,
      status: 'pending',
      createdAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      attemptCount: 0,
      maxAttempts: input.settings.retry.maxAttempts,
      renderedPreviewRedacted: text,
      payloadHash: createStableTelegramHash({
        adminChatIdHash: createStableTelegramHash(input.adminChatId),
        notificationType: input.notificationType,
        alert: {
          dedupeKey: input.alert.dedupeKey,
          kind: input.alert.kind,
          severity: input.alert.severity,
          resourceType: input.alert.resourceType,
          resourceId: input.alert.resourceId,
          resourceLabel: input.alert.resourceLabel,
          warningSummary: readTelegramSystemAlertMetadataString(input.alert, 'warningSummary')
        }
      }),
      target: {
        alertId: input.alert.id
      }
    };
  }

  type TelegramScheduledReportKind = 'daily' | 'weekly';

  type TelegramScheduledReportData = {
    agents: Agent[];
    alerts: SystemAlert[];
    quotaPolicies: QuotaPolicy[];
    commandOutbox: CommandOutboxItem[];
    telegramDeliveries: TelegramNotificationDelivery[];
    subscriptionSources: SubscriptionSource[];
    customers: CustomerReadModel[];
    subscriptionClients: SubscriptionClientIdentity[];
  };

  function createTelegramScheduledReportPeriodKey(kind: TelegramScheduledReportKind, now: string) {
    if (kind === 'daily') {
      return now.slice(0, 10);
    }

    const date = new Date(parseTimestampMs(now));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return `week-${date.toISOString().slice(0, 10)}`;
  }

  function readTelegramScheduledReportNotificationType(kind: TelegramScheduledReportKind): TelegramNotificationType {
    return kind === 'daily' ? 'daily.report' : 'weekly.report';
  }

  function createTelegramScheduledReportDedupeKey(
    adminChatId: string,
    notificationType: TelegramNotificationType,
    periodKey: string
  ) {
    return `telegram-schedule:${notificationType}:${createStableTelegramHash(adminChatId).slice(7, 19)}:${periodKey}`;
  }

  async function readTelegramScheduledReportData(
    data: TelegramCommandDataContext,
    alerts: SystemAlert[]
  ): Promise<TelegramScheduledReportData> {
    const [agents, quotaPolicies, commandOutbox, telegramDeliveries, subscriptionSources] = await Promise.all([
      api.listAgents(),
      api.listQuotaPolicies(),
      api.listCommandOutbox(),
      api.listTelegramNotificationDeliveries(),
      api.listSubscriptionSources()
    ]);

    return {
      agents,
      alerts,
      quotaPolicies,
      commandOutbox,
      telegramDeliveries,
      subscriptionSources,
      customers: data.customers,
      subscriptionClients: data.subscriptionClients
    };
  }

  function createTelegramScheduledReportText(input: {
    kind: TelegramScheduledReportKind;
    periodKey: string;
    data: TelegramScheduledReportData;
    language: TelegramBotSettings['language'];
  }) {
    const onlineAgents = input.data.agents.filter((agent) => agent.status === 'online').length;
    const degradedAgents = input.data.agents.filter((agent) => agent.status === 'degraded').length;
    const offlineAgents = input.data.agents.filter((agent) => agent.status === 'offline').length;
    const activeCustomers = input.data.customers.filter((customer) => customer.status === 'active').length;
    const limitedCustomers = input.data.customers.filter((customer) => customer.status === 'limited').length;
    const expiredCustomers = input.data.customers.filter((customer) => customer.status === 'expired').length;
    const criticalAlerts = input.data.alerts.filter((alert) => alert.severity === 'critical').length;
    const warningAlerts = input.data.alerts.filter((alert) => alert.severity === 'warning').length;
    const quotaRisk = input.data.quotaPolicies.filter(
      (policy) => policy.enforcementState === 'exceeded' || policy.enforcementState === 'disabled_by_quota'
    ).length;
    const commandFailures = input.data.commandOutbox.filter(
      (item) => item.status === 'dead_letter' || item.status === 'expired' || item.status === 'failed'
    ).length;
    const telegramFailures = input.data.telegramDeliveries.filter(
      (delivery) => delivery.status === 'failed' || delivery.status === 'dead_letter'
    ).length;
    const providerWarnings = input.data.subscriptionSources.filter((source) => source.status === 'warning').length;
    const providerFailures = input.data.subscriptionSources.filter((source) => source.status === 'failed').length;
    const usedTrafficBytes = input.data.customers.reduce((sum, customer) => sum + customer.usedTrafficBytes, 0);
    const limitTrafficBytes = input.data.customers.reduce((sum, customer) => sum + customer.trafficLimitBytes, 0);

    return input.language === 'zh-CN'
      ? limitTelegramMessageText(
          [
            input.kind === 'daily' ? '<b>每日运营报告</b>' : '<b>每周运营报告</b>',
            `周期：${escapeTelegramHtml(input.periodKey)}`,
            `主机：在线 ${onlineAgents} / 降级 ${degradedAgents} / 离线 ${offlineAgents}`,
            `客户：正常 ${activeCustomers} / 受限 ${limitedCustomers} / 过期 ${expiredCustomers}`,
            `订阅：用户 ${input.data.subscriptionClients.length} / 订阅源告警 ${providerWarnings} / 失败 ${providerFailures}`,
            `流量：${formatTelegramBytes(usedTrafficBytes)} / ${formatTelegramBytes(limitTrafficBytes)}`,
            `告警：严重 ${criticalAlerts} / 警告 ${warningAlerts}`,
            `风险：配额 ${quotaRisk} / 命令失败 ${commandFailures} / Telegram 投递失败 ${telegramFailures}`
          ].join('\n')
        )
      : limitTelegramMessageText(
          [
            input.kind === 'daily' ? '<b>Daily operations report</b>' : '<b>Weekly operations report</b>',
            `Period: ${escapeTelegramHtml(input.periodKey)}`,
            `Agents: online ${onlineAgents} / degraded ${degradedAgents} / offline ${offlineAgents}`,
            `Customers: active ${activeCustomers} / limited ${limitedCustomers} / expired ${expiredCustomers}`,
            `Subscriptions: users ${input.data.subscriptionClients.length} / provider warnings ${providerWarnings} / failed ${providerFailures}`,
            `Traffic: ${formatTelegramBytes(usedTrafficBytes)} / ${formatTelegramBytes(limitTrafficBytes)}`,
            `Alerts: critical ${criticalAlerts} / warning ${warningAlerts}`,
            `Risk: quota ${quotaRisk} / command failures ${commandFailures} / Telegram delivery failures ${telegramFailures}`
          ].join('\n')
        );
  }

  function createTelegramScheduledReportDelivery(input: {
    adminChatId: string;
    kind: TelegramScheduledReportKind;
    periodKey: string;
    data: TelegramScheduledReportData;
    policy: TelegramNotificationPolicy;
    settings: TelegramBotSettings;
    now: string;
    sequence: number;
  }): TelegramNotificationDelivery {
    const notificationType = readTelegramScheduledReportNotificationType(input.kind);
    const text = createTelegramScheduledReportText({
      kind: input.kind,
      periodKey: input.periodKey,
      data: input.data,
      language: input.policy.language
    });

    return {
      id: `telegram-delivery-${String(input.sequence).padStart(4, '0')}`,
      dedupeKey: createTelegramScheduledReportDedupeKey(input.adminChatId, notificationType, input.periodKey),
      notificationType,
      recipientKind: 'admin-chat',
      adminChatId: input.adminChatId,
      policyId: input.policy.id,
      templateId: `telegram.schedule.${notificationType.replace(/\./g, '_')}.${input.policy.language}`,
      language: input.policy.language,
      status: 'pending',
      createdAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      attemptCount: 0,
      maxAttempts: input.settings.retry.maxAttempts,
      renderedPreviewRedacted: text,
      payloadHash: createStableTelegramHash({
        adminChatIdHash: createStableTelegramHash(input.adminChatId),
        notificationType,
        periodKey: input.periodKey,
        reportPreview: text
      }),
      target: {}
    };
  }

  type TelegramScheduleDeliveryCandidate = {
    kind: 'traffic' | 'expiry' | 'subscription-update';
    dedupeKey: string;
    notificationType: TelegramNotificationType;
    binding: TelegramBindingReadModel;
    policy: TelegramNotificationPolicy;
    templateId: string;
    language: TelegramBotSettings['language'];
    text: string;
    payload: Record<string, unknown>;
  };

  function createTelegramScheduleDelivery(input: {
    candidate: TelegramScheduleDeliveryCandidate;
    settings: TelegramBotSettings;
    now: string;
    sequence: number;
  }): TelegramNotificationDelivery {
    return {
      id: `telegram-delivery-${String(input.sequence).padStart(4, '0')}`,
      dedupeKey: input.candidate.dedupeKey,
      notificationType: input.candidate.notificationType,
      recipientKind: 'customer-binding',
      chatBindingId: input.candidate.binding.chat.id,
      customerBindingId: input.candidate.binding.id,
      policyId: input.candidate.policy.id,
      templateId: input.candidate.templateId,
      language: input.candidate.language,
      status: 'pending',
      createdAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      attemptCount: 0,
      maxAttempts: input.settings.retry.maxAttempts,
      renderedPreviewRedacted: input.candidate.text,
      payloadHash: createStableTelegramHash(input.candidate.payload),
      target: createTelegramDeliveryTarget(input.candidate.binding)
    };
  }

  function readTelegramSubscriptionOutputFormats(client: SubscriptionClientIdentity) {
    const formats = client.outputFormats?.length ? client.outputFormats : client.formats;
    return [...new Set(formats.map((format) => String(format)).filter(Boolean))].sort();
  }

  function createTelegramSubscriptionOutputSignature(client: SubscriptionClientIdentity) {
    return {
      id: client.id,
      subId: client.subId,
      enabled: client.enabled,
      sourceIds: [...client.sourceIds].sort(),
      selectedTags: [...client.selectedTags].sort(),
      includeFilter: client.includeFilter,
      excludeFilter: client.excludeFilter,
      regionFilter: [...client.regionFilter].sort(),
      routingRule: client.routingRule,
      maxLatencyMs: client.maxLatencyMs,
      sortStrategy: client.sortStrategy,
      outputFormats: readTelegramSubscriptionOutputFormats(client),
      templateName: client.templateName,
      generatedNodeCount: client.generatedNodeCount,
      lastGeneratedAt: client.lastGeneratedAt ?? ''
    };
  }

  function readLatestTelegramSubscriptionGeneratedAt(clients: SubscriptionClientIdentity[]) {
    const generatedAtValues = clients
      .map((client) => client.lastGeneratedAt)
      .filter((value): value is string => Boolean(value))
      .sort();

    return generatedAtValues[generatedAtValues.length - 1];
  }

  function formatTelegramSubscriptionClientLine(
    clients: SubscriptionClientIdentity[],
    language: TelegramBotSettings['language']
  ) {
    const names = clients
      .map((client) => client.displayName || client.email || client.subId || client.id)
      .filter(Boolean)
      .slice(0, 3)
      .map(escapeTelegramHtml);
    const separator = language === 'zh-CN' ? '、' : ', ';
    const preview = names.join(separator);
    const remainingCount = Math.max(clients.length - names.length, 0);

    if (clients.length === 1) {
      return language === 'zh-CN' ? `订阅：${preview}` : `Subscription: ${preview}`;
    }

    if (language === 'zh-CN') {
      return `订阅：${clients.length} 个${preview ? `（${preview}${remainingCount > 0 ? ` 等 ${remainingCount} 个` : ''}）` : ''}`;
    }

    return `Subscriptions: ${clients.length}${preview ? ` (${preview}${remainingCount > 0 ? ` and ${remainingCount} more` : ''})` : ''}`;
  }

  function createTelegramTrafficThresholdCandidate(input: {
    data: TelegramCommandDataContext;
    binding: TelegramBindingReadModel;
    policy: TelegramNotificationPolicy;
    now: string;
    existingDedupeKeys: Set<string>;
    result: TelegramNotificationScheduleScanResult;
  }): TelegramScheduleDeliveryCandidate | undefined {
    const totals = readTelegramBindingTrafficTotals(input.data, input.binding);

    if (totals.limitBytes <= 0) {
      addTelegramScheduleSkip(input.result, 'no_traffic_limit');
      return undefined;
    }

    const ratioPercent = (totals.usedBytes / totals.limitBytes) * 100;
    const threshold = [...input.policy.trafficThresholdPercents]
      .filter((value) => ratioPercent >= value)
      .sort((left, right) => right - left)[0];

    if (threshold === undefined) {
      addTelegramScheduleSkip(input.result, 'threshold_not_crossed');
      return undefined;
    }

    const period = readTelegramBindingTrafficPeriod(input.data, input.binding, input.now);
    const dedupeKey = `telegram-schedule:traffic-threshold:${input.binding.id}:${period}:${threshold}`;

    if (input.existingDedupeKeys.has(dedupeKey)) {
      addTelegramScheduleSkip(input.result, 'duplicate_delivery');
      return undefined;
    }

    const label = formatTelegramBindingLabel(input.binding);
    const text =
      input.policy.language === 'zh-CN'
        ? limitTelegramMessageText(
            [
              '<b>流量阈值提醒</b>',
              label,
              `已用：${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)}（${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.policy.language)}）`,
              `已达到 ${threshold}% 阈值。`
            ].join('\n')
          )
        : limitTelegramMessageText(
            [
              '<b>Traffic threshold alert</b>',
              label,
              `Used: ${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)} (${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.policy.language)})`,
              `Reached the ${threshold}% threshold.`
            ].join('\n')
          );

    return {
      kind: 'traffic',
      dedupeKey,
      notificationType: 'traffic.threshold',
      binding: input.binding,
      policy: input.policy,
      templateId: `telegram.schedule.traffic_threshold.${input.policy.language}`,
      language: input.policy.language,
      text,
      payload: {
        bindingId: input.binding.id,
        notificationType: 'traffic.threshold',
        threshold,
        period,
        usedBytes: totals.usedBytes,
        limitBytes: totals.limitBytes
      }
    };
  }

  function createTelegramExpiryReminderCandidate(input: {
    data: TelegramCommandDataContext;
    binding: TelegramBindingReadModel;
    policy: TelegramNotificationPolicy;
    now: string;
    existingDedupeKeys: Set<string>;
    result: TelegramNotificationScheduleScanResult;
  }): TelegramScheduleDeliveryCandidate | undefined {
    const expiresAt = readTelegramBindingExpiry(input.data, input.binding);

    if (!expiresAt) {
      addTelegramScheduleSkip(input.result, 'no_expiry');
      return undefined;
    }

    const expiresAtMs = Date.parse(expiresAt);
    const nowMs = Date.parse(input.now);

    if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
      addTelegramScheduleSkip(input.result, 'no_expiry');
      return undefined;
    }

    const remainingDays = Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000));
    const reminderDay = [...input.policy.expiryReminderDays]
      .filter((day) => remainingDays >= 0 && remainingDays <= day)
      .sort((left, right) => left - right)[0];

    if (reminderDay === undefined) {
      addTelegramScheduleSkip(input.result, 'outside_expiry_window');
      return undefined;
    }

    const dedupeKey = `telegram-schedule:subscription-expiring:${input.binding.id}:${expiresAt.slice(0, 10)}:${reminderDay}`;

    if (input.existingDedupeKeys.has(dedupeKey)) {
      addTelegramScheduleSkip(input.result, 'duplicate_delivery');
      return undefined;
    }

    const label = formatTelegramBindingLabel(input.binding);
    const text =
      input.policy.language === 'zh-CN'
        ? limitTelegramMessageText(
            [
              '<b>到期提醒</b>',
              label,
              `到期时间：${formatTelegramDate(expiresAt, input.policy.language, input.now)}`,
              `已进入 ${reminderDay} 天提醒窗口。`
            ].join('\n')
          )
        : limitTelegramMessageText(
            [
              '<b>Expiry reminder</b>',
              label,
              `Expires: ${formatTelegramDate(expiresAt, input.policy.language, input.now)}`,
              `Entered the ${reminderDay}-day reminder window.`
            ].join('\n')
          );

    return {
      kind: 'expiry',
      dedupeKey,
      notificationType: 'subscription.expiring',
      binding: input.binding,
      policy: input.policy,
      templateId: `telegram.schedule.subscription_expiring.${input.policy.language}`,
      language: input.policy.language,
      text,
      payload: {
        bindingId: input.binding.id,
        notificationType: 'subscription.expiring',
        expiresAt,
        reminderDay,
        remainingDays
      }
    };
  }

  function createTelegramSubscriptionUpdatedCandidate(input: {
    data: TelegramCommandDataContext;
    binding: TelegramBindingReadModel;
    policy: TelegramNotificationPolicy;
    existingDedupeKeys: Set<string>;
    result: TelegramNotificationScheduleScanResult;
  }): TelegramScheduleDeliveryCandidate | undefined {
    const subscriptionClients = selectTelegramSubscriptionClientsForBinding(input.data, input.binding);

    if (
      subscriptionClients.length === 0
      || !subscriptionClients.some((client) => Boolean(client.lastGeneratedAt) || client.generatedNodeCount > 0)
    ) {
      addTelegramScheduleSkip(input.result, 'no_subscription_output');
      return undefined;
    }

    const signatures = subscriptionClients
      .map(createTelegramSubscriptionOutputSignature)
      .sort((left, right) => left.id.localeCompare(right.id));
    const signatureHash = createStableTelegramHash(signatures).slice(7, 31);
    const dedupeKey = `telegram-schedule:subscription-updated:${input.binding.id}:${signatureHash}`;

    if (input.existingDedupeKeys.has(dedupeKey)) {
      addTelegramScheduleSkip(input.result, 'duplicate_delivery');
      return undefined;
    }

    const label = formatTelegramBindingLabel(input.binding);
    const clientLine = formatTelegramSubscriptionClientLine(subscriptionClients, input.policy.language);
    const totalNodeCount = subscriptionClients.reduce((sum, client) => sum + Math.max(client.generatedNodeCount, 0), 0);
    const latestGeneratedAt = readLatestTelegramSubscriptionGeneratedAt(subscriptionClients);
    const outputFormats = [
      ...new Set(subscriptionClients.flatMap((client) => readTelegramSubscriptionOutputFormats(client)))
    ].sort();
    const outputFormatText = outputFormats.length > 0
      ? escapeTelegramHtml(outputFormats.join(', '))
      : input.policy.language === 'zh-CN' ? '默认' : 'default';
    const text =
      input.policy.language === 'zh-CN'
        ? limitTelegramMessageText(
            [
              '<b>订阅已更新</b>',
              label,
              clientLine,
              `生成节点：${totalNodeCount}`,
              `最近生成：${formatTelegramTimestamp(latestGeneratedAt, input.policy.language)}`,
              `输出格式：${outputFormatText}`
            ].join('\n')
          )
        : limitTelegramMessageText(
            [
              '<b>Subscription updated</b>',
              label,
              clientLine,
              `Generated nodes: ${totalNodeCount}`,
              `Last generated: ${formatTelegramTimestamp(latestGeneratedAt, input.policy.language)}`,
              `Output formats: ${outputFormatText}`
            ].join('\n')
          );

    return {
      kind: 'subscription-update',
      dedupeKey,
      notificationType: 'subscription.updated',
      binding: input.binding,
      policy: input.policy,
      templateId: `telegram.schedule.subscription_updated.${input.policy.language}`,
      language: input.policy.language,
      text,
      payload: {
        bindingId: input.binding.id,
        notificationType: 'subscription.updated',
        subscriptionClientCount: subscriptionClients.length,
        totalNodeCount,
        latestGeneratedAt,
        outputFormats,
        signatureHash
      }
    };
  }

  function createTelegramHelpReply(language: TelegramBotSettings['language'], bound: boolean): TelegramCommandReply {
    const text =
      language === 'zh-CN'
        ? [
            '<b>Telegram 自助菜单</b>',
            '/status 查看账户概览',
            '/traffic 查看流量',
            '/expiry 查看到期',
            '/nodes 查看节点',
            '/subscription [clash|mihomo|sing-box|uri|json] 获取订阅链接',
            '/notify status|on|off 管理通知开关',
            bound ? '' : '',
            bound ? '' : '请先发送 /start OU-XXXXXX 完成绑定。'
          ]
        : [
            '<b>Telegram self-service menu</b>',
            '/status account summary',
            '/traffic traffic usage',
            '/expiry expiry date',
            '/nodes node summary',
            '/subscription [clash|mihomo|sing-box|uri|json] subscription links',
            '/notify status|on|off notification switch',
            bound ? '' : '',
            bound ? '' : 'Send /start OU-XXXXXX to bind this chat first.'
          ];

    return {
      action: bound ? 'command_replied' : 'command_unbound',
      notificationType: bound ? 'command.reply' : 'command.dead_letter',
      text: limitTelegramMessageText(text.filter(Boolean).join('\n'))
    };
  }

  function createTelegramUnboundReply(language: TelegramBotSettings['language']): TelegramCommandReply {
    return {
      action: 'command_unbound',
      notificationType: 'command.dead_letter',
      text:
        language === 'zh-CN'
          ? '当前聊天尚未绑定客户。请发送 /start OU-XXXXXX 完成绑定。'
          : 'This chat is not bound to a customer. Send /start OU-XXXXXX to bind it.'
    };
  }

  function createTelegramPermissionDeniedReply(language: TelegramBotSettings['language'], message?: string): TelegramCommandReply {
    return {
      action: 'command_permission_denied',
      notificationType: 'command.dead_letter',
      text:
        message
        ?? (language === 'zh-CN'
          ? '当前绑定没有权限执行这个 Telegram 命令。'
          : 'This binding is not allowed to run that Telegram command.')
    };
  }

  function filterTelegramBindingsByPermission<K extends keyof TelegramCustomerBinding['permissions']>(
    bindings: TelegramBindingReadModel[],
    permission: K
  ) {
    return bindings.filter((binding) => binding.customerBinding.permissions[permission]);
  }

  function createTelegramTrafficReply(input: {
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
  }): TelegramCommandReply {
    const title = input.language === 'zh-CN' ? '<b>流量概览</b>' : '<b>Traffic summary</b>';
    const lines = [title];

    for (const binding of input.bindings.slice(0, 8)) {
      const customer = findTelegramCustomerForBinding(input.data, binding);
      const totals = readTelegramBindingTrafficTotals(input.data, binding);
      lines.push(
        [
          '',
          `<b>${formatTelegramBindingLabel(binding)}</b>`,
          input.language === 'zh-CN'
            ? `已用：${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)}（${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.language)}）`
            : `Used: ${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)} (${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.language)})`,
          input.language === 'zh-CN'
            ? `状态：${formatTelegramCustomerStatus(customer?.status, input.language)}`
            : `Status: ${formatTelegramCustomerStatus(customer?.status, input.language)}`
        ].join('\n')
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  function createTelegramExpiryReply(input: {
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
    now: string;
  }): TelegramCommandReply {
    const lines = [input.language === 'zh-CN' ? '<b>到期信息</b>' : '<b>Expiry summary</b>'];

    for (const binding of input.bindings.slice(0, 8)) {
      lines.push(
        [
          '',
          `<b>${formatTelegramBindingLabel(binding)}</b>`,
          input.language === 'zh-CN'
            ? `到期：${formatTelegramDate(readTelegramBindingExpiry(input.data, binding), input.language, input.now)}`
            : `Expires: ${formatTelegramDate(readTelegramBindingExpiry(input.data, binding), input.language, input.now)}`
        ].join('\n')
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  function createTelegramNodesReply(input: {
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
  }): TelegramCommandReply {
    const lines = [input.language === 'zh-CN' ? '<b>节点概览</b>' : '<b>Node summary</b>'];

    for (const binding of input.bindings.slice(0, 6)) {
      const inbounds = selectTelegramInboundsForBinding(input.data, binding);
      const subscriptionClients = selectTelegramSubscriptionClientsForBinding(input.data, binding);
      const forwardRules = selectTelegramForwardRulesForBinding(input.data, binding);
      const generatedNodeCount = subscriptionClients.reduce((sum, client) => sum + client.generatedNodeCount, 0);
      const samples = [
        ...inbounds.map((inbound) => inbound.label),
        ...subscriptionClients.map((client) => `${client.displayName} (${client.generatedNodeCount})`),
        ...forwardRules.map((rule) => rule.name)
      ].slice(0, 5);

      lines.push(
        [
          '',
          `<b>${formatTelegramBindingLabel(binding)}</b>`,
          input.language === 'zh-CN'
            ? `客户节点：${inbounds.length}，订阅节点：${generatedNodeCount}，转发规则：${forwardRules.length}`
            : `Customer nodes: ${inbounds.length}, subscription nodes: ${generatedNodeCount}, forwarding rules: ${forwardRules.length}`,
          ...samples.map((sample) => `- ${escapeTelegramHtml(sample)}`)
        ].join('\n')
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  function mapTelegramFormatToPublicFormat(format: TelegramSubscriptionFormat): PublicSubscriptionFormat {
    return format === 'json' ? 'v2ray' : format;
  }

  function mapPublicFormatToTelegramFormat(format: SubscriptionClientOutputFormat | PublicSubscriptionFormat) {
    return format === 'v2ray' ? 'json' : format;
  }

  function mapClientFormatToTelegramFormat(format: string): TelegramSubscriptionFormat | undefined {
    if (format === 'plain') return 'uri';
    if (format === 'json') return 'json';
    if (format === 'clash' || format === 'mihomo' || format === 'sing-box' || format === 'uri') return format;
    return undefined;
  }

  function listTelegramSubscriptionFormatsForClient(client: SubscriptionClientIdentity) {
    const formats = client.outputFormats?.length
      ? client.outputFormats.map(mapPublicFormatToTelegramFormat)
      : client.formats.map(mapClientFormatToTelegramFormat);

    return [...new Set(formats.filter((format): format is TelegramSubscriptionFormat => Boolean(format)))];
  }

  function readRequestedTelegramSubscriptionFormat(value: string | undefined) {
    const normalized = value?.trim().toLowerCase();

    if (!normalized) {
      return undefined;
    }

    const aliases: Record<string, TelegramSubscriptionFormat> = {
      plain: 'uri',
      url: 'uri',
      link: 'uri',
      v2ray: 'json',
      yaml: 'clash'
    };
    const candidate = aliases[normalized] ?? normalized;
    return telegramSubscriptionFormats.includes(candidate as TelegramSubscriptionFormat)
      ? (candidate as TelegramSubscriptionFormat)
      : undefined;
  }

  function createTelegramSubscriptionUrl(
    settings: TelegramBotSettings,
    client: SubscriptionClientIdentity,
    format: TelegramSubscriptionFormat
  ) {
    const securePath = client.securePathPreview?.replace(/^\/+/, '');

    if (!securePath) {
      return undefined;
    }

    const path = `/sub/${encodeURIComponent(securePath)}/${encodeURIComponent(mapTelegramFormatToPublicFormat(format))}/${encodeURIComponent(client.subId)}`;
    const baseUrl = settings.webhookPublicBaseUrl?.trim().replace(/\/+$/, '');
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  function createTelegramSubscriptionReply(input: {
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
    settings: TelegramBotSettings;
    chatType: TelegramChatBinding['chatType'];
    requestedFormat?: TelegramSubscriptionFormat;
  }): TelegramCommandReply {
    const lines = [input.language === 'zh-CN' ? '<b>订阅链接</b>' : '<b>Subscription links</b>'];
    const redactedLines = [...lines];
    let linkCount = 0;

    for (const binding of input.bindings.slice(0, 6)) {
      const policy = readTelegramEffectivePolicy(input.data, binding, input.settings);

      if (!policy.allowSubscriptionLinks) {
        continue;
      }

      if (policy.subscriptionLinkPrivateChatOnly && input.chatType !== 'private') {
        return createTelegramPermissionDeniedReply(
          input.language,
          input.language === 'zh-CN' ? '订阅链接只能发送到私聊。' : 'Subscription links can only be sent in private chats.'
        );
      }

      const allowedFormats = policy.allowedSubscriptionFormats.length
        ? policy.allowedSubscriptionFormats
        : input.settings.language === 'zh-CN'
          ? ['uri' as TelegramSubscriptionFormat]
          : ['uri' as TelegramSubscriptionFormat];
      const clients = selectTelegramSubscriptionClientsForBinding(input.data, binding);
      const bindingLines: string[] = [];
      const bindingRedactedLines: string[] = [];

      for (const client of clients) {
        const clientFormats = listTelegramSubscriptionFormatsForClient(client);
        const supportedFormats = allowedFormats.filter((format) => clientFormats.includes(format));
        const selectedFormat =
          input.requestedFormat && supportedFormats.includes(input.requestedFormat)
            ? input.requestedFormat
            : input.requestedFormat
              ? undefined
              : supportedFormats[0];

        if (!selectedFormat) {
          continue;
        }

        const url = createTelegramSubscriptionUrl(input.settings, client, selectedFormat);

        if (!url) {
          continue;
        }

        const label = `${client.displayName} ${selectedFormat}`;
        bindingLines.push(`- <a href="${escapeTelegramHtmlAttribute(url)}">${escapeTelegramHtml(label)}</a>`);
        bindingRedactedLines.push(`- ${escapeTelegramHtml(label)} [subscription-link-redacted]`);
        linkCount += 1;
      }

      if (bindingLines.length > 0) {
        lines.push('', `<b>${formatTelegramBindingLabel(binding)}</b>`, ...bindingLines);
        redactedLines.push('', `<b>${formatTelegramBindingLabel(binding)}</b>`, ...bindingRedactedLines);
      }
    }

    if (linkCount === 0) {
      return createTelegramPermissionDeniedReply(
        input.language,
        input.language === 'zh-CN'
          ? '当前绑定没有可发送的订阅链接，或请求的格式未启用。'
          : 'No subscription link is available for this binding, or the requested format is not enabled.'
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      renderedPreviewRedacted: limitTelegramMessageText(redactedLines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  async function updateTelegramNotificationPoliciesFromCommand(input: {
    bindings: TelegramBindingReadModel[];
    enabled: boolean;
    actor: string;
    requestId: string;
  }) {
    return repository.transaction(async (transaction) => {
      const policies = await listTelegramNotificationPoliciesFrom(transaction);
      const customerBindings = await transaction.listTelegramCustomerBindings();
      const defaultPolicy =
        policies.find((policy) => policy.id === TELEGRAM_DEFAULT_POLICY_ID)
        ?? createDefaultTelegramNotificationPolicy(readModelNow(), input.actor);
      const updatedPolicies: TelegramNotificationPolicy[] = [];

      for (const binding of input.bindings) {
        const existing = binding.customerBinding.policyId
          ? policies.find((policy) => policy.id === binding.customerBinding.policyId)
          : undefined;
        const policyId = existing?.id ?? `telegram-policy-${binding.id}`;
        const now = readModelNow();
        const current: TelegramNotificationPolicy =
          existing
          ?? {
            ...defaultPolicy,
            id: policyId,
            ownerType: 'customer-binding',
            ownerId: binding.id,
            createdAt: now,
            updatedAt: now,
            updatedBy: input.actor,
            notificationTypes: [...defaultPolicy.notificationTypes],
            forcedNotificationTypes: [...defaultPolicy.forcedNotificationTypes],
            trafficThresholdPercents: [...defaultPolicy.trafficThresholdPercents],
            expiryReminderDays: [...defaultPolicy.expiryReminderDays],
            allowedSubscriptionFormats: [...defaultPolicy.allowedSubscriptionFormats]
          };
        const nextPolicy = applyTelegramNotificationPolicyUpdate(current, { enabled: input.enabled }, now, input.actor);
        const currentBinding = customerBindings.find((candidate) => candidate.id === binding.id);

        if (currentBinding && currentBinding.policyId !== nextPolicy.id) {
          await transaction.upsertTelegramCustomerBinding({
            ...currentBinding,
            policyId: nextPolicy.id
          });
        }

        await transaction.upsertTelegramNotificationPolicy(nextPolicy);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_notification_policy.updated',
          operation: 'telegram_notification_policy.update',
          targetId: nextPolicy.id,
          targetLabel: binding.customerBinding.customerNameSnapshot,
          message: 'Telegram notification policy updated from bot command',
          context: {
            actor: input.actor,
            sourceIp: 'telegram-update',
            requestId: input.requestId
          },
          before: existing,
          after: nextPolicy
        });
        updatedPolicies.push(nextPolicy);
      }

      return updatedPolicies;
    });
  }

  async function createTelegramNotifyReply(input: {
    command: TelegramParsedCommand;
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
    settings: TelegramBotSettings;
    actor: string;
    requestId: string;
  }): Promise<TelegramCommandReply> {
    const value = input.command.args[0]?.toLowerCase();

    if (value === 'on' || value === 'enable' || value === 'enabled' || value === '开') {
      const policies = await updateTelegramNotificationPoliciesFromCommand({
        bindings: input.bindings,
        enabled: true,
        actor: input.actor,
        requestId: input.requestId
      });

      return {
        action: 'command_policy_updated',
        notificationType: 'command.reply',
        text:
          input.language === 'zh-CN'
            ? `已开启 ${policies.length} 个 Telegram 绑定的通知。`
            : `Notifications enabled for ${policies.length} Telegram binding(s).`,
        binding: input.bindings[0],
        chatBindingId: input.bindings[0]?.chat.id,
        customerBindingId: input.bindings[0]?.id
      };
    }

    if (value === 'off' || value === 'disable' || value === 'disabled' || value === '关') {
      const policies = await updateTelegramNotificationPoliciesFromCommand({
        bindings: input.bindings,
        enabled: false,
        actor: input.actor,
        requestId: input.requestId
      });

      return {
        action: 'command_policy_updated',
        notificationType: 'command.reply',
        text:
          input.language === 'zh-CN'
            ? `已关闭 ${policies.length} 个 Telegram 绑定的通知。`
            : `Notifications disabled for ${policies.length} Telegram binding(s).`,
        binding: input.bindings[0],
        chatBindingId: input.bindings[0]?.chat.id,
        customerBindingId: input.bindings[0]?.id
      };
    }

    const lines = [input.language === 'zh-CN' ? '<b>通知偏好</b>' : '<b>Notification preferences</b>'];

    for (const binding of input.bindings.slice(0, 8)) {
      const policy = readTelegramEffectivePolicy(input.data, binding, input.settings);
      lines.push(
        input.language === 'zh-CN'
          ? `${formatTelegramBindingLabel(binding)}：${policy.enabled ? '开启' : '关闭'}`
          : `${formatTelegramBindingLabel(binding)}: ${policy.enabled ? 'on' : 'off'}`
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  function createTelegramStatusReply(input: {
    bindings: TelegramBindingReadModel[];
    data: TelegramCommandDataContext;
    language: TelegramBotSettings['language'];
    now: string;
  }): TelegramCommandReply {
    const lines = [input.language === 'zh-CN' ? '<b>账户概览</b>' : '<b>Account summary</b>'];

    for (const binding of input.bindings.slice(0, 6)) {
      const customer = findTelegramCustomerForBinding(input.data, binding);
      const totals = readTelegramBindingTrafficTotals(input.data, binding);
      const inbounds = selectTelegramInboundsForBinding(input.data, binding);
      const subscriptionClients = selectTelegramSubscriptionClientsForBinding(input.data, binding);
      const forwardRules = selectTelegramForwardRulesForBinding(input.data, binding);
      lines.push(
        [
          '',
          `<b>${formatTelegramBindingLabel(binding)}</b>`,
          input.language === 'zh-CN'
            ? `状态：${formatTelegramCustomerStatus(customer?.status, input.language)}`
            : `Status: ${formatTelegramCustomerStatus(customer?.status, input.language)}`,
          input.language === 'zh-CN'
            ? `流量：${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)}（${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.language)}）`
            : `Traffic: ${formatTelegramBytes(totals.usedBytes)} / ${formatTelegramBytes(totals.limitBytes)} (${formatTelegramTrafficRatio(totals.usedBytes, totals.limitBytes, input.language)})`,
          input.language === 'zh-CN'
            ? `到期：${formatTelegramDate(readTelegramBindingExpiry(input.data, binding), input.language, input.now)}`
            : `Expires: ${formatTelegramDate(readTelegramBindingExpiry(input.data, binding), input.language, input.now)}`,
          input.language === 'zh-CN'
            ? `资源：客户节点 ${inbounds.length} / 订阅 ${subscriptionClients.length} / 转发 ${forwardRules.length}`
            : `Resources: nodes ${inbounds.length} / subscriptions ${subscriptionClients.length} / forwarding ${forwardRules.length}`
        ].join('\n')
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n')),
      binding: input.bindings[0],
      chatBindingId: input.bindings[0]?.chat.id,
      customerBindingId: input.bindings[0]?.id
    };
  }

  async function createTelegramCustomerCommandReply(input: {
    settings: TelegramBotSettings;
    command: TelegramParsedCommand;
    chatId: string;
    fromId?: string;
    chatType: TelegramChatBinding['chatType'];
    language: TelegramBotSettings['language'];
    now: string;
    updateId: number;
  }): Promise<TelegramCommandReply> {
    const bindings = await listTelegramBindingsForCommand({
      chatId: input.chatId,
      fromId: input.fromId,
      chatType: input.chatType,
      settings: input.settings
    });

    if (input.command.name === 'help' || input.command.name === 'menu') {
      return createTelegramHelpReply(input.language, bindings.length > 0);
    }

    if (bindings.length === 0) {
      return createTelegramUnboundReply(input.language);
    }

    const data = await readTelegramCommandDataContext();

    if (input.command.name === 'status') {
      const permittedBindings = bindings.filter((binding) =>
        binding.customerBinding.permissions.queryTraffic
        || binding.customerBinding.permissions.queryExpiry
        || binding.customerBinding.permissions.queryNodes
      );

      return permittedBindings.length > 0
        ? createTelegramStatusReply({ bindings: permittedBindings, data, language: input.language, now: input.now })
        : createTelegramPermissionDeniedReply(input.language);
    }

    if (input.command.name === 'traffic') {
      const permittedBindings = filterTelegramBindingsByPermission(bindings, 'queryTraffic');
      return permittedBindings.length > 0
        ? createTelegramTrafficReply({ bindings: permittedBindings, data, language: input.language })
        : createTelegramPermissionDeniedReply(input.language);
    }

    if (input.command.name === 'expiry' || input.command.name === 'expire' || input.command.name === 'expires') {
      const permittedBindings = filterTelegramBindingsByPermission(bindings, 'queryExpiry');
      return permittedBindings.length > 0
        ? createTelegramExpiryReply({ bindings: permittedBindings, data, language: input.language, now: input.now })
        : createTelegramPermissionDeniedReply(input.language);
    }

    if (input.command.name === 'nodes' || input.command.name === 'node') {
      const permittedBindings = filterTelegramBindingsByPermission(bindings, 'queryNodes');
      return permittedBindings.length > 0
        ? createTelegramNodesReply({ bindings: permittedBindings, data, language: input.language })
        : createTelegramPermissionDeniedReply(input.language);
    }

    if (input.command.name === 'subscription' || input.command.name === 'sub' || input.command.name === 'link') {
      const permittedBindings = filterTelegramBindingsByPermission(bindings, 'receiveSubscriptionLinks');
      const requestedFormat = readRequestedTelegramSubscriptionFormat(input.command.args[0]);

      if (input.command.args[0] && !requestedFormat) {
        return {
          action: 'command_unknown',
          notificationType: 'command.dead_letter',
          text:
            input.language === 'zh-CN'
              ? '订阅格式无效。可用格式：clash、mihomo、sing-box、uri、json。'
              : 'Invalid subscription format. Available formats: clash, mihomo, sing-box, uri, json.'
        };
      }

      return permittedBindings.length > 0
        ? createTelegramSubscriptionReply({
            bindings: permittedBindings,
            data,
            language: input.language,
            settings: input.settings,
            chatType: input.chatType,
            requestedFormat
          })
        : createTelegramPermissionDeniedReply(input.language);
    }

    if (input.command.name === 'notify' || input.command.name === 'notifications' || input.command.name === 'policy') {
      const permittedBindings = filterTelegramBindingsByPermission(bindings, 'manageNotificationPolicy');
      return permittedBindings.length > 0
        ? createTelegramNotifyReply({
            command: input.command,
            bindings: permittedBindings,
            data,
            language: input.language,
            settings: input.settings,
            actor: `telegram:${input.fromId ?? input.chatId}`,
            requestId: `telegram-update-${input.updateId}`
          })
        : createTelegramPermissionDeniedReply(input.language);
    }

    return {
      action: 'command_unknown',
      notificationType: 'command.dead_letter',
      text:
        input.language === 'zh-CN'
          ? '未知命令。发送 /help 查看可用命令。'
          : 'Unknown command. Send /help to see available commands.'
    };
  }

  const telegramAdminCommandNames = new Set([
    'alerts',
    'bindings',
    'expiring',
    'quota',
    'search',
    'status',
    'test'
  ]);

  function telegramSenderIsAdmin(settings: TelegramBotSettings, chatId: string, fromId?: string) {
    return settings.adminChatIds.includes(chatId) || Boolean(fromId && settings.adminTelegramUserIds.includes(fromId));
  }

  function isTelegramAdminCommand(settings: TelegramBotSettings, command: TelegramParsedCommand, chatId: string, fromId?: string) {
    if (!telegramSenderIsAdmin(settings, chatId, fromId)) {
      return false;
    }

    return command.name === 'admin' || telegramAdminCommandNames.has(command.name);
  }

  function readTelegramAdminCommand(input: TelegramParsedCommand) {
    if (input.name !== 'admin') {
      return {
        name: input.name,
        args: input.args
      };
    }

    return {
      name: input.args[0]?.toLowerCase() || 'menu',
      args: input.args.slice(1)
    };
  }

  function createTelegramAdminMenuReply(language: TelegramBotSettings['language']): TelegramCommandReply {
    const text =
      language === 'zh-CN'
        ? [
            '<b>Telegram 管理菜单</b>',
            '/admin status 系统状态',
            '/admin alerts 活跃告警',
            '/admin quota 配额风险',
            '/admin expiring 即将到期',
            '/admin search <关键词> 搜索客户',
            '/admin bindings 绑定概览',
            '/admin test 发送测试通知'
          ]
        : [
            '<b>Telegram admin menu</b>',
            '/admin status system status',
            '/admin alerts active alerts',
            '/admin quota quota risk',
            '/admin expiring expiring customers',
            '/admin search <query> customer search',
            '/admin bindings binding summary',
            '/admin test send test notification'
          ];

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: text.join('\n')
    };
  }

  function createTelegramAdminStatusReply(input: {
    language: TelegramBotSettings['language'];
    agents: Agent[];
    alerts: SystemAlert[];
    quotaPolicies: QuotaPolicy[];
    commandOutbox: CommandOutboxItem[];
    telegramDeliveries: TelegramNotificationDelivery[];
  }): TelegramCommandReply {
    const onlineAgents = input.agents.filter((agent) => agent.status === 'online').length;
    const degradedAgents = input.agents.filter((agent) => agent.status === 'degraded').length;
    const offlineAgents = input.agents.filter((agent) => agent.status === 'offline').length;
    const criticalAlerts = input.alerts.filter((alert) => alert.severity === 'critical').length;
    const warningAlerts = input.alerts.filter((alert) => alert.severity === 'warning').length;
    const quotaRisk = input.quotaPolicies.filter(
      (policy) => policy.enforcementState === 'exceeded' || policy.enforcementState === 'disabled_by_quota'
    ).length;
    const commandFailures = input.commandOutbox.filter(
      (item) => item.status === 'dead_letter' || item.status === 'expired' || item.status === 'failed'
    ).length;
    const telegramFailures = input.telegramDeliveries.filter(
      (delivery) => delivery.status === 'failed' || delivery.status === 'dead_letter'
    ).length;

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: [
        input.language === 'zh-CN' ? '<b>系统状态</b>' : '<b>System status</b>',
        input.language === 'zh-CN'
          ? `主机：在线 ${onlineAgents} / 降级 ${degradedAgents} / 离线 ${offlineAgents}`
          : `Agents: online ${onlineAgents} / degraded ${degradedAgents} / offline ${offlineAgents}`,
        input.language === 'zh-CN'
          ? `告警：严重 ${criticalAlerts} / 警告 ${warningAlerts}`
          : `Alerts: critical ${criticalAlerts} / warning ${warningAlerts}`,
        input.language === 'zh-CN' ? `配额风险：${quotaRisk}` : `Quota risk: ${quotaRisk}`,
        input.language === 'zh-CN' ? `命令失败：${commandFailures}` : `Command failures: ${commandFailures}`,
        input.language === 'zh-CN' ? `Telegram 投递失败：${telegramFailures}` : `Telegram delivery failures: ${telegramFailures}`
      ].join('\n')
    };
  }

  function createTelegramAdminAlertsReply(alerts: SystemAlert[], language: TelegramBotSettings['language']): TelegramCommandReply {
    const lines = [language === 'zh-CN' ? '<b>活跃告警</b>' : '<b>Active alerts</b>'];

    if (alerts.length === 0) {
      lines.push(language === 'zh-CN' ? '当前没有活跃告警。' : 'No active alerts.');
    }

    for (const alert of alerts.slice(0, 8)) {
      lines.push(
        `- ${escapeTelegramHtml(alert.severity)} / ${escapeTelegramHtml(alert.kind)}: ${escapeTelegramHtml(alert.title)}`
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n'))
    };
  }

  function createTelegramAdminQuotaReply(policies: QuotaPolicy[], language: TelegramBotSettings['language']): TelegramCommandReply {
    const riskPolicies = policies
      .filter((policy) => {
        const limitBytes = Math.max(policy.limitBytes, 0);
        const usedBytes = Math.max(policy.usedBytes, 0);
        return (
          policy.enforcementState !== 'active'
          || (limitBytes > 0 && usedBytes / limitBytes >= 0.8)
        );
      })
      .sort((left, right) => {
        const leftRatio = left.limitBytes > 0 ? left.usedBytes / left.limitBytes : 0;
        const rightRatio = right.limitBytes > 0 ? right.usedBytes / right.limitBytes : 0;
        return rightRatio - leftRatio || left.name.localeCompare(right.name);
      });
    const lines = [language === 'zh-CN' ? '<b>配额风险</b>' : '<b>Quota risk</b>'];

    if (riskPolicies.length === 0) {
      lines.push(language === 'zh-CN' ? '当前没有 80% 以上或已超限的配额。' : 'No quota is above 80% or exceeded.');
    }

    for (const policy of riskPolicies.slice(0, 8)) {
      const ratio = policy.limitBytes > 0 ? `${Math.round((policy.usedBytes / policy.limitBytes) * 100)}%` : 'n/a';
      lines.push(
        `- ${escapeTelegramHtml(policy.name)}: ${formatTelegramBytes(policy.usedBytes)} / ${formatTelegramBytes(policy.limitBytes)} (${ratio}, ${escapeTelegramHtml(policy.enforcementState)})`
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n'))
    };
  }

  function createTelegramAdminExpiringReply(input: {
    customers: CustomerReadModel[];
    subscriptionClients: SubscriptionClientIdentity[];
    language: TelegramBotSettings['language'];
    now: string;
  }): TelegramCommandReply {
    const nowMs = Date.parse(input.now);
    const maxMs = nowMs + 14 * 24 * 60 * 60 * 1000;
    const candidates = [
      ...input.customers.map((customer) => ({
        label: customer.name,
        expiresAt: customer.expiresAt,
        kind: input.language === 'zh-CN' ? '客户' : 'customer'
      })),
      ...input.subscriptionClients.map((client) => ({
        label: client.displayName,
        expiresAt: client.expiresAt,
        kind: input.language === 'zh-CN' ? '订阅' : 'subscription'
      }))
    ]
      .filter((item): item is { label: string; expiresAt: string; kind: string } => Boolean(item.expiresAt))
      .filter((item) => {
        const expiresAtMs = Date.parse(item.expiresAt);
        return Number.isFinite(expiresAtMs) && expiresAtMs >= nowMs && expiresAtMs <= maxMs;
      })
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));
    const lines = [input.language === 'zh-CN' ? '<b>即将到期</b>' : '<b>Expiring soon</b>'];

    if (candidates.length === 0) {
      lines.push(input.language === 'zh-CN' ? '未来 14 天没有即将到期的客户或订阅。' : 'No customers or subscriptions expire in the next 14 days.');
    }

    for (const item of candidates.slice(0, 8)) {
      lines.push(`- ${escapeTelegramHtml(item.kind)} ${escapeTelegramHtml(item.label)}: ${formatTelegramDate(item.expiresAt, input.language, input.now)}`);
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n'))
    };
  }

  function createTelegramAdminSearchReply(input: {
    query: string;
    customers: CustomerReadModel[];
    subscriptionClients: SubscriptionClientIdentity[];
    language: TelegramBotSettings['language'];
  }): TelegramCommandReply {
    const query = normalizeTelegramIdentity(input.query);

    if (!query) {
      return {
        action: 'command_unknown',
        notificationType: 'command.dead_letter',
        text: input.language === 'zh-CN' ? '请提供搜索关键词。' : 'Provide a search query.'
      };
    }

    const customers = input.customers.filter((customer) => normalizeTelegramIdentity(customer.name).includes(query));
    const subscriptionMatches = input.subscriptionClients.filter((client) =>
      [client.customerName, client.displayName, client.email].some((value) => normalizeTelegramIdentity(value).includes(query))
    );
    const lines = [input.language === 'zh-CN' ? '<b>客户搜索</b>' : '<b>Customer search</b>'];

    if (customers.length === 0 && subscriptionMatches.length === 0) {
      lines.push(input.language === 'zh-CN' ? '没有匹配结果。' : 'No matches.');
    }

    for (const customer of customers.slice(0, 6)) {
      lines.push(
        input.language === 'zh-CN'
          ? `- 客户 ${escapeTelegramHtml(customer.name)}：${escapeTelegramHtml(customer.status)}，来源 ${customer.sourceKinds.length}`
          : `- Customer ${escapeTelegramHtml(customer.name)}: ${escapeTelegramHtml(customer.status)}, sources ${customer.sourceKinds.length}`
      );
    }

    for (const client of subscriptionMatches.slice(0, Math.max(0, 6 - customers.length))) {
      lines.push(
        input.language === 'zh-CN'
          ? `- 订阅 ${escapeTelegramHtml(client.displayName)}：${formatTelegramBytes(client.usedTrafficBytes)} / ${formatTelegramBytes(client.trafficLimitBytes)}`
          : `- Subscription ${escapeTelegramHtml(client.displayName)}: ${formatTelegramBytes(client.usedTrafficBytes)} / ${formatTelegramBytes(client.trafficLimitBytes)}`
      );
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n'))
    };
  }

  async function createTelegramAdminBindingsReply(language: TelegramBotSettings['language']): Promise<TelegramCommandReply> {
    const [bindings, challenges] = await Promise.all([
      listTelegramBindingReadModelsFrom(repository),
      repository.listTelegramBindingChallenges()
    ]);
    const activeBindings = bindings.filter((binding) => binding.customerBinding.status === 'active');
    const pendingChats = bindings.filter((binding) => binding.chat.status === 'pending_start').length;
    const pendingChallenges = challenges.filter((challenge) => challenge.status === 'pending').length;
    const lines = [
      language === 'zh-CN' ? '<b>Telegram 绑定概览</b>' : '<b>Telegram binding summary</b>',
      language === 'zh-CN'
        ? `活跃绑定：${activeBindings.length}，待启动聊天：${pendingChats}，待消费验证码：${pendingChallenges}`
        : `Active bindings: ${activeBindings.length}, pending chats: ${pendingChats}, pending challenges: ${pendingChallenges}`
    ];

    for (const binding of activeBindings.slice(0, 6)) {
      lines.push(`- ${formatTelegramBindingLabel(binding)} (${escapeTelegramHtml(binding.customerBinding.scopeType)})`);
    }

    return {
      action: 'command_replied',
      notificationType: 'command.reply',
      text: limitTelegramMessageText(lines.join('\n'))
    };
  }

  async function createTelegramAdminCommandReply(input: {
    settings: TelegramBotSettings;
    command: TelegramParsedCommand;
    chatId: string;
    fromId?: string;
    language: TelegramBotSettings['language'];
    now: string;
    updateId: number;
  }): Promise<TelegramCommandReply> {
    if (!telegramSenderIsAdmin(input.settings, input.chatId, input.fromId)) {
      return createTelegramPermissionDeniedReply(input.language);
    }

    const adminCommand = readTelegramAdminCommand(input.command);

    if (adminCommand.name === 'menu' || adminCommand.name === 'help') {
      return createTelegramAdminMenuReply(input.language);
    }

    if (adminCommand.name === 'status') {
      const [agents, alerts, quotaPolicies, commandOutbox, telegramDeliveries] = await Promise.all([
        api.listAgents(),
        api.listSystemAlerts(),
        api.listQuotaPolicies(),
        api.listCommandOutbox(),
        api.listTelegramNotificationDeliveries()
      ]);
      return createTelegramAdminStatusReply({
        language: input.language,
        agents,
        alerts,
        quotaPolicies,
        commandOutbox,
        telegramDeliveries
      });
    }

    if (adminCommand.name === 'alerts') {
      return createTelegramAdminAlertsReply(await api.listSystemAlerts(), input.language);
    }

    if (adminCommand.name === 'quota') {
      return createTelegramAdminQuotaReply(await api.listQuotaPolicies(), input.language);
    }

    if (adminCommand.name === 'expiring') {
      const [customers, subscriptionClients] = await Promise.all([api.listCustomers(), api.listSubscriptionClients()]);
      return createTelegramAdminExpiringReply({
        customers,
        subscriptionClients,
        language: input.language,
        now: input.now
      });
    }

    if (adminCommand.name === 'search') {
      const [customers, subscriptionClients] = await Promise.all([api.listCustomers(), api.listSubscriptionClients()]);
      return createTelegramAdminSearchReply({
        query: adminCommand.args.join(' '),
        customers,
        subscriptionClients,
        language: input.language
      });
    }

    if (adminCommand.name === 'bindings') {
      return createTelegramAdminBindingsReply(input.language);
    }

    if (adminCommand.name === 'test') {
      const delivery = await api.testTelegramBotNotification(
        {
          target: {
            kind: 'admin-chat',
            chatId: input.chatId
          },
          language: input.language
        },
        {
          actor: `telegram-admin:${input.fromId ?? input.chatId}`,
          sourceIp: 'telegram-update',
          requestId: `telegram-admin-test-${input.updateId}`
        }
      );

      return {
        action: 'command_replied',
        notificationType: 'command.reply',
        text:
          input.language === 'zh-CN'
            ? `测试通知已提交，状态：${delivery.status}。`
            : `Test notification submitted with status: ${delivery.status}.`
      };
    }

    return createTelegramAdminMenuReply(input.language);
  }

  async function listForwardRuleReadModel() {
    if (!forwardRulesReadModel) {
      forwardRulesReadModel = clone(await repository.listForwardRules());
    }

    return clone(forwardRulesReadModel);
  }

  async function acquireSubscriptionSourceSyncLease(
    sourceId: string,
    syncedAt: string,
    fetchPolicy: SubscriptionSourceFetchPolicy
  ) {
    const leaseOwnerId = `subscription-sync-${sourceId}-${randomUUID()}`;
    const syncedAtMs = Date.parse(syncedAt);
    const leaseStartedAtMs = Number.isNaN(syncedAtMs) ? Date.now() : syncedAtMs;
    const leaseExpiresAt = new Date(
      leaseStartedAtMs + Math.max(fetchPolicy.timeoutMs * 2, SUBSCRIPTION_SOURCE_SYNC_LEASE_MIN_MS)
    ).toISOString();

    return repository.transaction(async (transaction) => {
      const persistedSources = await transaction.listSubscriptionSources();
      const currentSource =
        persistedSources.find((item) => item.id === sourceId) ?? subscriptionSources.find((item) => item.id === sourceId);

      if (!currentSource) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      const budgetSources = persistedSources.length > 0 ? persistedSources : subscriptionSources;
      assertSubscriptionSourceSyncAllowed(currentSource, syncedAt);
      assertSubscriptionSourceProviderBudgetAllowed(
        currentSource,
        persistedSources,
        syncedAt,
        subscriptionSourceProviderBudgetPolicy
      );
      const budgetReservation = reserveSubscriptionSourceSyncBudget({
        source: currentSource,
        sources: budgetSources,
        now: syncedAt,
        defaultPolicy: subscriptionSourceSyncBudgetPolicy,
        fetchPolicy
      });

      const leasedSource: SubscriptionSource = {
        ...budgetReservation.source,
        status: 'syncing',
        syncLeaseOwnerId: leaseOwnerId,
        syncLeaseExpiresAt: leaseExpiresAt
      };

      await transaction.upsertSubscriptionSource(leasedSource);

      return {
        source: currentSource,
        leasedSource,
        fetchPolicy: budgetReservation.fetchPolicy
      };
    });
  }

  async function projectRuntimeCredentialAgents(
    baseAgents: Agent[],
    deletedAgentIdsForProjection: Set<string>,
    knownSessions?: AgentSessionState[],
    knownCredentials?: AgentCredentialSummary[]
  ) {
    const credentials = knownCredentials ?? (await service.listAgentCredentials());
    const sessions = knownSessions ?? (await repository.listAgentSessions());
    let nextAgents = clone(baseAgents);

    for (const credential of credentials) {
      if (credential.purpose !== 'runtime' || credential.status !== 'active') {
        continue;
      }

      if (deletedAgentIdsForProjection.has(credential.agentId)) {
        continue;
      }

      const session = sessions.find(
        (item) => item.agentId === credential.agentId && (!credential.sessionId || item.sessionId === credential.sessionId)
      );
      const projectedAgent = createAgentFromCredential(credential, session);
      const existingAgentIndex = nextAgents.findIndex((agent) => agent.id === credential.agentId);

      if (existingAgentIndex >= 0) {
        nextAgents = nextAgents.map((agent, index) =>
          index === existingAgentIndex ? mergeAgentCredentialProjection(agent, projectedAgent) : agent
        );
        continue;
      }

      nextAgents = [projectedAgent, ...nextAgents];
    }

    return nextAgents;
  }

  async function hydrateReadModelsFromPersistedTasks() {
    return hydrateReadModelsFromRepositoryState(await repository.readStateSnapshot());
  }

  async function hydrateReadModelsFromRepositoryState(state: ControlPlaneRepositoryState) {
    const tasks = sortTasksForReadModelReplay(state.tasks);
    updateReadModelTasks(tasks);
    const persistedSubscriptionSources = clone(state.subscriptionSources);
    const persistedSubscriptionInventoryNodes = clone(state.subscriptionInventoryNodes);
    const persistedSubscriptionClients = clone(state.subscriptionClients);
    const persistedSubscriptionExportProfiles = clone(state.subscriptionExportProfiles);
    const hasPersistedSubscriptionSources = persistedSubscriptionSources.length > 0;
    const hasPersistedSubscriptionInventoryNodes = persistedSubscriptionInventoryNodes.length > 0;
    const hasPersistedSubscriptionClients = persistedSubscriptionClients.length > 0;
    const hasPersistedSubscriptionExportProfiles = persistedSubscriptionExportProfiles.length > 0;
    const nextDeletedAgentIds = new Set<string>();
    const persistedAgentSessions = clone(state.agentSessions);
    const credentialSummaries = state.agentCredentials.map(createAgentCredentialSummaryFromRecord);
    syncHighFrequencyAgentEventSeqsFromSessions(persistedAgentSessions);
    let nextAgents = await projectRuntimeCredentialAgents(
      seedAgents,
      nextDeletedAgentIds,
      persistedAgentSessions,
      credentialSummaries
    );
    let nextInbounds = clone(seedInbounds);
    let nextSubscriptionSources = hasPersistedSubscriptionSources ? persistedSubscriptionSources : clone(seedSubscriptionSources);
    let nextSubscriptionInventoryNodes = hasPersistedSubscriptionInventoryNodes
      ? persistedSubscriptionInventoryNodes
      : clone(seedSubscriptionInventoryNodes);
    let nextSubscriptionClients = hasPersistedSubscriptionClients ? persistedSubscriptionClients : clone(seedSubscriptionClients);
    let nextSubscriptionExportProfiles = hasPersistedSubscriptionExportProfiles
      ? persistedSubscriptionExportProfiles
      : clone(seedSubscriptionExportProfiles);
    let nextForwardRules = clone(state.forwardRules);

    for (const task of tasks) {
      if (task.operation === 'agent.delete') {
        nextDeletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        nextSubscriptionInventoryNodes = nextSubscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
      }

      nextAgents = applyAgentTask(nextAgents, task);
      nextAgents = applyQuotaResetTaskToAgents(nextAgents, task);
      nextInbounds = applyXrayInboundTask(nextInbounds, task);
      nextInbounds = applyQuotaResetTaskToInbounds(nextInbounds, task);
      if (!hasPersistedSubscriptionSources) {
        nextSubscriptionSources = applySubscriptionSourceTask(nextSubscriptionSources, task);
      }
      if (!hasPersistedSubscriptionClients) {
        nextSubscriptionClients = applySubscriptionClientTask(nextSubscriptionClients, task);
      }
      nextSubscriptionClients = applyQuotaResetTaskToSubscriptionClients(nextSubscriptionClients, task);
      if (!hasPersistedSubscriptionExportProfiles) {
        nextSubscriptionExportProfiles = applySubscriptionExportProfileTask(nextSubscriptionExportProfiles, task);
      }
      nextForwardRules = applyForwardRuleTask(nextForwardRules, task);
      nextForwardRules = applyQuotaResetTaskToForwardRules(nextForwardRules, task);
    }

    const quotaResetReplayState = createQuotaResetReplayState(tasks);

    for (const rawEvent of mergePersistedAndRecentAgentEvents(state.agentEvents)) {
      const event = applyQuotaResetStateToForwardingEvent(
        applyQuotaResetStateToXrayEvent(applyQuotaResetStateToAgentEvent(rawEvent, quotaResetReplayState), quotaResetReplayState),
        quotaResetReplayState
      );

      if (nextDeletedAgentIds.has(event.agentId)) {
        continue;
      }

      nextAgents = applyAgentEventToReadModel(nextAgents, event);
      nextInbounds = applyXrayTelemetryToReadModel(nextInbounds, event);
      nextForwardRules = applyForwardingTelemetryToReadModel(nextForwardRules, event);
    }

    nextAgents = await projectRuntimeCredentialAgents(
      nextAgents,
      nextDeletedAgentIds,
      persistedAgentSessions,
      credentialSummaries
    );

    agents = nextAgents;
    inbounds = nextInbounds;
    subscriptionSources = nextSubscriptionSources;
    subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
    subscriptionClients = nextSubscriptionClients;
    subscriptionExportProfiles = nextSubscriptionExportProfiles;
    forwardRulesReadModel = nextForwardRules;
    deletedAgentIds = nextDeletedAgentIds;
    readModelsHydrated = true;
    return tasks;
  }

  async function updateSystemAlertNotificationDelivery(
    deliveryId: string,
    update: (delivery: SystemAlertNotificationDeliveryRecord) => SystemAlertNotificationDeliveryRecord
  ) {
    await repository.transaction(async (transaction) => {
      const deliveries = await transaction.listSystemAlertNotificationDeliveries();
      const nextDeliveries = deliveries.map((delivery) =>
        delivery.id === deliveryId ? update(delivery) : delivery
      );
      await transaction.replaceSystemAlertNotificationDeliveries(compactSystemAlertNotificationDeliveries(nextDeliveries));
    });
  }

  async function retrySystemAlertNotifications(
    options: SystemAlertNotificationRetryOptions
  ): Promise<SystemAlertNotificationRetryResult> {
    const result: SystemAlertNotificationRetryResult = {
      attempted: 0,
      delivered: 0,
      failed: 0,
      deadLettered: 0
    };

    if (systemAlertChannels.length === 0) {
      return result;
    }

    const maxDeliveries = Math.max(
      1,
      Math.round(options.maxDeliveries ?? systemAlertNotificationRetryPolicy.maxDeliveriesPerSweep)
    );
    const dueDeliveries = await repository.transaction(async (transaction) => {
      const deliveries = await transaction.listSystemAlertNotificationDeliveries();
      const due = deliveries
        .filter((delivery) => isDueSystemAlertNotificationDelivery(delivery, options.now))
        .sort((left, right) =>
          parseTimestampMs(left.nextAttemptAt) - parseTimestampMs(right.nextAttemptAt) || left.id.localeCompare(right.id)
        )
        .slice(0, maxDeliveries)
        .map((delivery) => ({
          ...delivery,
          status: 'pending' as const,
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: options.now,
          updatedAt: options.now
        }));

      if (due.length === 0) {
        return [];
      }

      const dueById = new Map(due.map((delivery) => [delivery.id, delivery] as const));
      const nextDeliveries = deliveries.map((delivery) => dueById.get(delivery.id) ?? delivery);
      await transaction.replaceSystemAlertNotificationDeliveries(compactSystemAlertNotificationDeliveries(nextDeliveries));

      return due;
    });

    for (const delivery of dueDeliveries) {
      result.attempted += 1;

      try {
        const channelId = readSystemAlertNotificationDeliveryChannelId(delivery);
        const channel = systemAlertChannelsById.get(channelId);

        if (!channel) {
          throw new Error(`system alert notification channel is not configured: ${channelId}`);
        }

        await channel.notifier.notify(delivery.batch);
        result.delivered += 1;
        await updateSystemAlertNotificationDelivery(delivery.id, (current) => ({
          ...current,
          status: 'delivered',
          updatedAt: options.now,
          deliveredAt: options.now,
          attemptCount: delivery.attemptCount,
          lastAttemptAt: options.now,
          nextAttemptAt: options.now,
          lastErrorMessage: undefined,
          deadLetteredAt: undefined
        }));
      } catch (error) {
        const deadLettered = delivery.attemptCount >= delivery.maxAttempts;
        const lastErrorMessage = sanitizeSystemAlertNotificationError(error);

        if (deadLettered) {
          result.deadLettered += 1;
        } else {
          result.failed += 1;
        }

        await updateSystemAlertNotificationDelivery(delivery.id, (current) => ({
          ...current,
          status: deadLettered ? 'dead_letter' : 'failed',
          updatedAt: options.now,
          attemptCount: delivery.attemptCount,
          lastAttemptAt: options.now,
          nextAttemptAt: deadLettered ? options.now : toIsoAfter(options.now, systemAlertNotificationRetryPolicy.retryDelayMs),
          lastErrorMessage,
          ...(deadLettered ? { deadLetteredAt: options.now } : {})
        }));
      }
    }

    return result;
  }

  async function reconcileAndPersistSystemAlerts(
    liveAgents: Agent[],
    commandOutbox: CommandOutboxItem[],
    quotaPolicies: QuotaPolicy[],
    tasks: DeployTask[],
    systemAlertNotificationDeliveries: SystemAlertNotificationDeliveryRecord[],
    externalAlerts: SystemAlert[],
    now: string
  ) {
    const derivedActiveAlerts = [
      ...createSystemAlertsFromAgents(liveAgents, now),
      ...createSystemAlertsFromCommandOutbox(commandOutbox, now),
      ...createSystemAlertsFromRuntimeTasks(tasks, now),
      ...createSystemAlertsFromQuotaPolicies(quotaPolicies, now),
      ...createSystemAlertsFromSystemAlertNotifications(systemAlertNotificationDeliveries, now),
      ...createSystemAlertsFromSubscriptionSources(subscriptionSources, now),
      ...externalAlerts
    ];

    const reconciled = await repository.transaction(async (transaction) => {
      const persistedAlerts = await transaction.listSystemAlertRecords();
      const reconciled = reconcileSystemAlertRecords(persistedAlerts, derivedActiveAlerts, now);

      if (reconciled.changed) {
        await transaction.replaceSystemAlertRecords(reconciled.records);
      }

      if (systemAlertChannels.length > 0 && reconciled.notifications.length > 0) {
        const deliveries = await transaction.listSystemAlertNotificationDeliveries();
        const batch = createSystemAlertNotificationBatch(reconciled.notifications, now);
        await transaction.replaceSystemAlertNotificationDeliveries(
          upsertSystemAlertNotificationDeliveries(
            deliveries,
            systemAlertChannels.map((channel) =>
              createSystemAlertNotificationDelivery(batch, now, systemAlertNotificationRetryPolicy, channel)
            )
          )
        );
      }

      return reconciled;
    });

    if (systemAlertChannels.length > 0 && reconciled.notifications.length > 0) {
      await retrySystemAlertNotifications({
        now,
        maxDeliveries: systemAlertNotificationRetryPolicy.maxDeliveriesPerSweep
      });
    }

    return clone(reconciled.activeAlerts);
  }

  async function listLiveQuotaPolicies() {
    await hydrateReadModelsFromPersistedTasks();
    return listLiveQuotaPoliciesFromReadModel(readModelTasks);
  }

  async function listLiveQuotaPoliciesFromReadModel(tasks: DeployTask[] = readModelTasks) {
    const now = readModelNow();
    const liveAgents = applyAgentLivenessToReadModel(agents, now);
    const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
    const liveForwardRules = applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now);
    const quotaPolicyTasks = sortTasksForReadModelReplay(tasks);
    const quotaResetReplayState = createQuotaResetReplayState(quotaPolicyTasks);
    const liveQuotaPolicies = applyQuotaResetTasksToExplicitPolicies(inventory.quotaPolicies ?? [], quotaPolicyTasks);
    const liveSubscriptionClients = projectSubscriptionClientReadModels(
      subscriptionClients,
      liveInbounds,
      subscriptionInventoryNodes,
      quotaResetReplayState,
      now
    );

    return createQuotaPoliciesFromReadModels({
      agents: liveAgents,
      inbounds: liveInbounds,
      forwardRules: liveForwardRules,
      subscriptionClients: liveSubscriptionClients,
      quotaPolicies: liveQuotaPolicies
    });
  }

  async function listLiveForwardRulesForQuotaEnforcement() {
    await hydrateReadModelsFromPersistedTasks();
    return listLiveForwardRulesForQuotaEnforcementFromReadModel();
  }

  async function listLiveForwardRulesForQuotaEnforcementFromReadModel() {
    return applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), readModelNow());
  }

  async function listLiveInboundsForGuardrailEnforcement() {
    await hydrateReadModelsFromPersistedTasks();
    return listLiveInboundsForGuardrailEnforcementFromReadModel();
  }

  function listLiveInboundsForGuardrailEnforcementFromReadModel() {
    return applyXrayTrafficWindowToReadModel(inbounds, readModelNow());
  }

  function createSystemQuotaEnforcerContext(requestId: string, idempotencyKey: string): MutationContext {
    return {
      actor: 'system:quota-enforcer',
      sourceIp: '127.0.0.1',
      userAgent: 'ou-ui-next-quota-enforcer',
      requestId,
      idempotencyKey
    };
  }

  async function enqueueDerivedForwardQuotaEnforcementTasks(
    beforeRules: ForwardRule[],
    trigger: { kind: 'agent-event' | 'task'; id: string; observedAt: string },
    precomputed?: {
      afterRules: ForwardRule[];
      afterPolicies: QuotaPolicy[];
      tasks: DeployTask[];
    }
  ) {
    const afterRules = precomputed?.afterRules ?? (await listLiveForwardRulesForQuotaEnforcement());
    const afterPolicies = precomputed?.afterPolicies ?? (await listLiveQuotaPolicies());
    const intents = deriveForwardQuotaEnforcementTaskIntents(
      precomputed?.tasks ?? (await repository.listTasks()),
      beforeRules,
      afterRules,
      afterPolicies,
      trigger
    );

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  async function enqueueDerivedXrayGuardrailTasks(
    trigger: { kind: 'agent-event' | 'task'; id: string; observedAt: string },
    precomputed?: {
      afterInbounds: XrayInbound[];
      tasks: DeployTask[];
    }
  ) {
    const afterInbounds = precomputed?.afterInbounds ?? (await listLiveInboundsForGuardrailEnforcement());
    const intents = deriveXrayGuardrailTaskIntents(
      precomputed?.tasks ?? (await repository.listTasks()),
      afterInbounds,
      trigger
    );

    for (const intent of intents) {
      await api.createTask(intent.input, createSystemQuotaEnforcerContext(intent.requestId, intent.idempotencyKey));
    }
  }

  async function processTelegramUpdate(
    settings: TelegramBotSettings,
    secrets: TelegramBotSecretState,
    update: TelegramWebhookUpdate
  ) {
    if (!settings.enabled) {
      return {
        accepted: true,
        action: 'settings_disabled' as const
      };
    }

    const message = update.message;
    const chatId = message?.chat?.id !== undefined ? String(message.chat.id) : undefined;
    const fromId = message?.from?.id !== undefined ? String(message.from.id) : undefined;
    const command = readTelegramCommand(update);
    const chatType = readTelegramChatType(message?.chat.type);
    const startCode = command?.name === 'start' ? readTelegramStartCode(update) : undefined;

    if (!message || !chatId || !command) {
      return {
        accepted: true,
        action: 'ignored' as const
      };
    }

    const language = settings.language;
    const now = readModelNow();
    const reply = await (async () => {
      if (command.name !== 'start' && isTelegramAdminCommand(settings, command, chatId, fromId)) {
        return createTelegramAdminCommandReply({
          settings,
          command,
          chatId,
          fromId,
          language,
          now,
          updateId: update.update_id
        });
      }

      if (command.name !== 'start') {
        return createTelegramCustomerCommandReply({
          settings,
          command,
          chatId,
          fromId,
          chatType,
          language,
          now,
          updateId: update.update_id
        });
      }

      if (!startCode) {
        return {
          action: 'binding_prompted' as const,
          notificationType: 'command.dead_letter' as const,
          text:
            language === 'zh-CN'
              ? '请发送 /start OU-XXXXXX 绑定验证码。'
              : 'Send /start OU-XXXXXX with your binding code.'
        };
      }

      const customers = await api.listCustomers();

      return repository.transaction(async (transaction) => {
        const [challenges, challengeSecrets, customerBindings] = await Promise.all([
          transaction.listTelegramBindingChallenges(),
          transaction.listTelegramBindingChallengeSecrets(),
          transaction.listTelegramCustomerBindings()
        ]);
        const challengeSecret = challengeSecrets.find(
          (secret) => !secret.consumedAt && secret.codeHash === hashTelegramBindingCode(startCode)
        );
        const challenge = challengeSecret
          ? challenges.find((candidate) => candidate.id === challengeSecret.challengeId)
          : undefined;

        if (!challengeSecret || !challenge || challenge.status !== 'pending') {
          return {
            action: 'binding_code_invalid' as const,
            notificationType: 'command.dead_letter' as const,
            text:
              language === 'zh-CN'
                ? '绑定验证码无效或已使用。'
                : 'The binding code is invalid or already used.'
          };
        }

        const attemptCount = challenge.attemptCount + 1;

        if (Date.parse(challenge.expiresAt) <= Date.parse(now) || attemptCount > challenge.maxAttempts) {
          await transaction.upsertTelegramBindingChallenge({
            ...challenge,
            attemptCount,
            status: 'expired'
          });

          return {
            action: 'binding_code_expired' as const,
            notificationType: 'command.dead_letter' as const,
            text:
              language === 'zh-CN'
                ? '绑定验证码已过期。'
                : 'The binding code has expired.'
          };
        }

        const { chat, binding } = createTelegramBindingRecord({
          request: {
            telegramChatId: chatId,
            telegramUserId: fromId,
            chatType,
            username: message.from?.username ?? message.chat.username,
            displayName: readTelegramDisplayName(update),
            customerId: challenge.customerId,
            customerName: challenge.customerNameSnapshot,
            scopeType: challenge.scopeType,
            scopeId: challenge.scopeId,
            scopeLabel: challenge.scopeLabelSnapshot
          },
          customers,
          now,
          actor: `telegram:${fromId ?? chatId}`,
          sequence: customerBindings.length + 1
        });
        const activeChat: TelegramChatBinding = {
          ...chat,
          status: 'active',
          source: 'bot_start',
          lastSeenAt: now,
          lastStartAt: now,
          updatedAt: now
        };
        const consumedChallenge: TelegramBindingChallenge = {
          ...challenge,
          attemptCount,
          status: 'consumed',
          consumedAt: now,
          consumedByChatBindingId: activeChat.id
        };

        await transaction.upsertTelegramChatBinding(activeChat);
        await transaction.upsertTelegramCustomerBinding(binding);
        await transaction.upsertTelegramBindingChallenge(consumedChallenge);
        await transaction.upsertTelegramBindingChallengeSecret({
          ...challengeSecret,
          consumedAt: now
        });
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_binding.created',
          operation: 'telegram_binding.create',
          targetId: binding.id,
          targetLabel: binding.customerNameSnapshot,
          message: 'Telegram customer binding created from update challenge',
          context: {
            actor: `telegram:${fromId ?? chatId}`,
            sourceIp: 'telegram-update',
            requestId: `telegram-update-${update.update_id}`
          },
          after: binding
        });

        const readModels = await listTelegramBindingReadModelsFrom(transaction);
        const readModel = readModels.find((item) => item.id === binding.id);

        return {
          action: 'binding_consumed' as const,
          notificationType: 'binding.created' as const,
          text:
            language === 'zh-CN'
              ? `Telegram 已绑定到 ${escapeTelegramHtml(binding.customerNameSnapshot)}。`
              : `Telegram is now bound to ${escapeTelegramHtml(binding.customerNameSnapshot)}.`,
          binding: readModel,
          chatBindingId: activeChat.id,
          customerBindingId: binding.id
        };
      });
    })();

    const sendResult = secrets.botToken
      ? await sendTelegramBotMessageWithEgress({
          settings,
          secrets,
          request: {
            chatId,
            text: reply.text,
            parseMode: 'HTML',
            disableWebPagePreview: true
          }
        })
      : {
          ok: false as const,
          errorMessage: 'telegram bot token is not available'
        };
    const delivery = await repository.transaction(async (transaction) => {
      const deliveries = await transaction.listTelegramNotificationDeliveries();
      const nextDelivery = createTelegramReplyDelivery({
        chatId,
        notificationType: reply.notificationType,
        language,
        now: readModelNow(),
        sequence: deliveries.length + 1,
        status: sendResult.ok ? 'delivered' : 'failed',
        text: reply.text,
        renderedPreviewRedacted: 'renderedPreviewRedacted' in reply ? reply.renderedPreviewRedacted : undefined,
        result: sendResult,
        chatBindingId: 'chatBindingId' in reply ? reply.chatBindingId : undefined,
        customerBindingId: 'customerBindingId' in reply ? reply.customerBindingId : undefined
      });
      const currentSettings = await readTelegramBotSettingsFrom(transaction);
      if ('chatBindingId' in reply && reply.chatBindingId) {
        const chats = await transaction.listTelegramChatBindings();
        const currentChat = chats.find((chat) => chat.id === reply.chatBindingId);

        if (currentChat?.status === 'pending_start') {
          await transaction.upsertTelegramChatBinding({
            ...currentChat,
            status: 'active',
            lastSeenAt: nextDelivery.updatedAt,
            updatedAt: nextDelivery.updatedAt
          });
        }
      }
      await transaction.upsertTelegramNotificationDelivery(nextDelivery);
      await transaction.setTelegramBotSettings({
        ...currentSettings,
        lastDeliveryAt: nextDelivery.status === 'delivered' ? nextDelivery.deliveredAt : currentSettings.lastDeliveryAt,
        lastDeliveryError: nextDelivery.status === 'delivered' ? undefined : nextDelivery.lastErrorMessage,
        updatedAt: nextDelivery.updatedAt,
        updatedBy: `telegram:${fromId ?? chatId}`
      });
      return nextDelivery;
    });

    return {
      accepted: true,
      action: reply.action,
      ...('binding' in reply && reply.binding ? { binding: clone(reply.binding) } : {}),
      delivery: clone(delivery)
    };
  }

  const api: ControlPlaneApi = {
    async getSnapshot() {
      const repositoryState = await repository.readStateSnapshot();
      const tasks = await hydrateReadModelsFromRepositoryState(repositoryState);
      const now = readModelNow();
      const quotaResetReplayState = createQuotaResetReplayState(tasks);
      const liveAgents = applyAgentLivenessToReadModel(agents, now);
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
      const liveForwardRules = applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now);
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        subscriptionClients,
        liveInbounds,
        subscriptionInventoryNodes,
        quotaResetReplayState,
        now
      );
      const liveQuotaPolicies = createQuotaPoliciesFromReadModels({
        agents: liveAgents,
        inbounds: liveInbounds,
        forwardRules: liveForwardRules,
        subscriptionClients: liveSubscriptionClients,
        quotaPolicies: applyQuotaResetTasksToExplicitPolicies(inventory.quotaPolicies ?? [], tasks)
      });
      const proxyProviders = createProxyProvidersFromSources(subscriptionSources);
      const commandOutbox = clone(repositoryState.commandOutbox);
      const nodes = clone(inventory.nodes ?? []);
      const rateLimitPolicies = clone(inventory.rateLimitPolicies ?? []);
      const permissionGrants = clone(repositoryState.permissionGrants);
      const routingPolicies = clone(inventory.routingPolicies ?? []);
      const tuningProfiles = clone(inventory.tuningProfiles ?? []);
      const configRevisions = clone(repositoryState.configRevisions);
      const preflightPlans = clone(repositoryState.preflightPlans);
      const runtimeSnapshots = clone(repositoryState.runtimeSnapshots);
      const trafficRollups = selectTrafficRollups(repositoryState.trafficRollups, {
        limit: SNAPSHOT_TRAFFIC_ROLLUP_LIMIT
      });
      const trafficRollupCompactions = selectTrafficRollupCompactions(repositoryState.trafficRollupCompactions);
      const systemAlertNotificationDeliveries = clone(repositoryState.systemAlertNotificationDeliveries);
      const agentLogRetentionPolicy = repositoryState.agentLogRetentionPolicy
        ? createAgentLogRetentionPolicyReadModel(repositoryState.agentLogRetentionPolicy, 'control-plane')
        : clone(runtimeAgentLogRetentionPolicy);
      const trafficRollupRetentionPolicy = repositoryState.trafficRollupRetentionPolicy
        ? createTrafficRollupRetentionPolicyReadModel({
            effective: repositoryState.trafficRollupRetentionPolicy,
            source: 'control-plane',
            runtimeDefault: runtimeTrafficRollupRetentionPolicyValues,
            controlPlaneOverride: repositoryState.trafficRollupRetentionPolicy
          })
        : clone(runtimeTrafficRollupRetentionPolicy);
      const agentCredentials = repositoryState.agentCredentials.map(createAgentCredentialSummaryFromRecord);
      const rawAgentSessions = clone(repositoryState.agentSessions);
      const rawAgentEvents = clone(repositoryState.agentEvents);
      const agentLogArchives = selectAgentLogArchives(repositoryState.agentLogArchives, { limit: 200 });
      const telegramBotSettings = clone(
        repositoryState.telegramBotSettings ?? createDefaultTelegramBotSettings(readModelNow())
      );
      const telegramNotificationPolicies = clone(
        repositoryState.telegramNotificationPolicies.length > 0
          ? repositoryState.telegramNotificationPolicies
          : createDefaultTelegramPolicies()
      );
      const telegramNotificationDeliveries = clone(repositoryState.telegramNotificationDeliveries);
      const telegramBindings = createTelegramBindingReadModels({
        customerBindings: repositoryState.telegramCustomerBindings,
        chatBindings: repositoryState.telegramChatBindings,
        policies: telegramNotificationPolicies,
        deliveries: telegramNotificationDeliveries
      });
      const auditLogs = clone(repositoryState.auditLogs);
      const systemAlerts = await reconcileAndPersistSystemAlerts(
        liveAgents,
        commandOutbox,
        liveQuotaPolicies,
        tasks,
        systemAlertNotificationDeliveries,
        [],
        now
      );
      const customers = createCustomersFromReadModels({
        inbounds: liveInbounds,
        subscriptionClients: liveSubscriptionClients,
        forwardRules: liveForwardRules,
        nowIso: now
      });
      const subscriptionBundles = createSubscriptionBundlesFromInventory(
        subscriptionSources,
        subscriptionInventoryNodes,
        subscriptionExportProfiles,
        inventory.subscriptionBundles ?? []
      );
      const subscriptionExportFiles = createSubscriptionExportFilesFromClients(
        subscriptionClients,
        proxyProviders,
        subscriptionExportProfiles
      );
      const agentSessions = rawAgentSessions.map((session) =>
        createAgentSessionSummary(session, findRuntimeCredentialForSession(agentCredentials, session))
      );
      const agentLogChunks = selectAgentLogChunks(rawAgentEvents, { limit: 200 });

      return {
        apiBoundary: clone(v1ApiBoundary),
        agents: clone(liveAgents),
        customers,
        nodes,
        inbounds: clone(liveInbounds),
        subscriptionSources: clone(subscriptionSources),
        subscriptionInventoryNodes: clone(subscriptionInventoryNodes),
        subscriptionBundles,
        subscriptionClients: clone(liveSubscriptionClients),
        subscriptionExportProfiles: clone(subscriptionExportProfiles),
        proxyProviders,
        subscriptionExportFiles,
        forwardRules: clone(liveForwardRules),
        quotaPolicies: clone(liveQuotaPolicies),
        rateLimitPolicies,
        permissionGrants,
        routingPolicies,
        tuningProfiles,
        tasks: clone(tasks),
        commandOutbox: commandOutbox.map(summarizeCommandOutboxItem),
        configRevisions: configRevisions.map(summarizeRuntimeConfigRevisionForSnapshot),
        preflightPlans,
        runtimeSnapshots,
        trafficRollups,
        trafficRollupCompactions,
        systemAlerts,
        agentLogRetentionPolicy,
        trafficRollupRetentionPolicy,
        agentCredentials,
        agentSessions,
        agentLogChunks,
        agentLogArchives,
        telegramBotSettings,
        telegramBindings,
        telegramNotificationPolicies,
        telegramNotificationDeliveries,
        auditLogs
      };
    },

    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async getAgentLogRetentionPolicy() {
      return clone(await readEffectiveAgentLogRetentionPolicy());
    },

    async updateAgentLogRetentionPolicy(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const before = await readEffectiveAgentLogRetentionPolicy();
      const policy = toAgentLogRetentionPolicy(input);
      const after = createAgentLogRetentionPolicyReadModel(policy, 'control-plane');

      await repository.transaction(async (transaction) => {
        await transaction.setAgentLogRetentionPolicy(policy);
        await appendStandaloneAuditLog(
          transaction,
          createAgentLogRetentionPolicyUpdatedAuditLog({
            context: resolvedContext,
            before,
            after,
            reason: input.reason,
            createdAt: readModelNow()
          })
        );
      });

      return clone(after);
    },

    async getTrafficRollupRetentionPolicy() {
      return clone(await readEffectiveTrafficRollupRetentionPolicy());
    },

    async updateTrafficRollupRetentionPolicy(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const before = await readEffectiveTrafficRollupRetentionPolicy();
      const policy = toTrafficRollupRetentionPolicy(input);
      const after = createTrafficRollupRetentionPolicyReadModel({
        effective: policy,
        source: 'control-plane',
        runtimeDefault: runtimeTrafficRollupRetentionPolicyValues,
        controlPlaneOverride: policy
      });

      await repository.transaction(async (transaction) => {
        await transaction.setTrafficRollupRetentionPolicy(policy);
        await appendStandaloneAuditLog(
          transaction,
          createTrafficRollupRetentionPolicyUpdatedAuditLog({
            context: resolvedContext,
            before,
            after,
            reason: input.reason,
            createdAt: readModelNow()
          })
        );
      });

      return clone(after);
    },

    async getObservabilityMetrics(
      externalAlerts = [],
      runtimeMetrics: ControlPlaneRuntimeObservabilityMetricsArgument = 0
    ) {
      const [
        tasks,
        commandOutbox,
        auditLogs,
        agentEvents,
        agentLogArchives,
        trafficRollups,
        trafficRollupCompactions,
        telegramNotificationDeliveries
      ] = await Promise.all([
        repository.listTasks(),
        repository.listCommandOutbox(),
        repository.listAuditLogs(),
        repository.listAgentEvents(),
        repository.listAgentLogArchives(),
        repository.listTrafficRollups(),
        repository.listTrafficRollupCompactions(),
        repository.listTelegramNotificationDeliveries()
      ]);
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const liveAgents = applyAgentLivenessToReadModel(agents, now);
      const quotaPolicies = await listLiveQuotaPolicies();
      const systemAlertNotificationDeliveriesBeforeReconcile = await repository.listSystemAlertNotificationDeliveries();
      const systemAlerts = await reconcileAndPersistSystemAlerts(
        liveAgents,
        commandOutbox,
        quotaPolicies,
        tasks,
        systemAlertNotificationDeliveriesBeforeReconcile,
        externalAlerts,
        now
      );
      const systemAlertNotificationDeliveries = await repository.listSystemAlertNotificationDeliveries();

      return createObservabilityMetrics({
        generatedAt: now,
        tasks,
        commandOutbox,
        agents: liveAgents,
        systemAlerts,
        systemAlertNotificationDeliveries,
        telegramNotificationDeliveries,
        quotaPolicies,
        agentEvents,
        agentLogArchives,
        trafficRollups,
        trafficRollupCompactions,
        audit: verifyAuditLogs(clone(auditLogs)),
        auditLogs,
        runtimeMetrics
      });
    },

    async listAgents() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(applyAgentLivenessToReadModel(agents, readModelNow()));
    },

    async listCustomers() {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        subscriptionClients,
        liveInbounds,
        subscriptionInventoryNodes,
        quotaResetReplayState,
        now
      );
      const liveForwardRules = applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now);

      return clone(
        createCustomersFromReadModels({
          inbounds: liveInbounds,
          subscriptionClients: liveSubscriptionClients,
          forwardRules: liveForwardRules,
          nowIso: now
        })
      );
    },

    async listNodes() {
      return clone(inventory.nodes ?? []);
    },

    async listInbounds() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(applyXrayTrafficWindowToReadModel(inbounds, readModelNow()));
    },

    async listSubscriptionSources() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionSources);
    },

    async listSubscriptionInventoryNodes() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionInventoryNodes);
    },

    async listSubscriptionBundles() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(
        createSubscriptionBundlesFromInventory(
          subscriptionSources,
          subscriptionInventoryNodes,
          subscriptionExportProfiles,
          inventory.subscriptionBundles ?? []
        )
      );
    },

    async listSubscriptionClients() {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      const quotaResetReplayState = createQuotaResetReplayState(sortTasksForReadModelReplay(await repository.listTasks()));
      return clone(
        projectSubscriptionClientReadModels(
          subscriptionClients,
          applyXrayTrafficWindowToReadModel(inbounds, now),
          subscriptionInventoryNodes,
          quotaResetReplayState,
          now
        )
      );
    },

    async listSubscriptionExportProfiles() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionExportProfiles);
    },

    async listProxyProviders() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(createProxyProvidersFromSources(subscriptionSources));
    },

    async listSubscriptionExportFiles() {
      await hydrateReadModelsFromPersistedTasks();
      const providers = createProxyProvidersFromSources(subscriptionSources);
      return clone(createSubscriptionExportFilesFromClients(subscriptionClients, providers, subscriptionExportProfiles));
    },

    async listForwardRules() {
      await hydrateReadModelsFromPersistedTasks();
      return applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), readModelNow());
    },

    async listQuotaPolicies() {
      return clone(await listLiveQuotaPolicies());
    },

    async getTelegramBotSettings() {
      return clone(await readTelegramBotSettingsFrom(repository));
    },

    async updateTelegramBotSettings(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const updated = await repository.transaction(async (transaction) => {
        const before = await readTelegramBotSettingsFrom(transaction);
        const secrets = await readTelegramBotSecretsFrom(transaction);
        const nextSettings = applyTelegramBotSettingsUpdate(before, input, readModelNow(), resolvedContext.actor);
        await transaction.setTelegramBotSettings(nextSettings);
        await transaction.setTelegramBotSecrets(applyTelegramBotSecretUpdate(secrets, input));
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_bot.settings.updated',
          operation: 'telegram_bot.settings.update',
          targetId: 'telegram-bot',
          targetLabel: 'Telegram Bot',
          message: 'Telegram Bot settings updated',
          context: resolvedContext,
          before: redactTelegramBotSettingsAudit(before),
          after: redactTelegramBotSettingsAudit(nextSettings, input.reason)
        });

        return nextSettings;
      });

      return clone(updated);
    },

    async testTelegramBotNotification(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const now = readModelNow();
      const created = await repository.transaction(async (transaction) => {
        const settings = await readTelegramBotSettingsFrom(transaction);
        const secrets = await readTelegramBotSecretsFrom(transaction);
        const deliveries = await transaction.listTelegramNotificationDeliveries();
        const bindingTargetId = input.target.kind === 'binding' ? input.target.bindingId : undefined;
        const targetBinding =
          bindingTargetId !== undefined
            ? (await listTelegramBindingReadModelsFrom(transaction)).find((binding) => binding.id === bindingTargetId)
            : undefined;

        if (bindingTargetId !== undefined && !targetBinding) {
          throw new Error(`Telegram binding not found: ${bindingTargetId}`);
        }

        const targetChatId = input.target.kind === 'admin-chat' ? input.target.chatId : targetBinding?.chat.telegramChatId;
        const nextDelivery = createTelegramTestDelivery({
          request: input,
          settings,
          now,
          sequence: deliveries.length + 1,
          ...(targetBinding ? { binding: targetBinding } : {})
        });
        const nextDeliveries = [nextDelivery, ...deliveries].slice(0, settings.deliveryHistoryLimit);
        const nextSettings: TelegramBotSettings = {
          ...settings,
          lastTestAt: now,
          lastDeliveryAt: nextDelivery.status === 'pending' ? now : settings.lastDeliveryAt,
          lastDeliveryError:
            nextDelivery.status === 'suppressed' ? 'telegram bot is not enabled or token is not configured' : undefined,
          updatedAt: now,
          updatedBy: resolvedContext.actor
        };

        await transaction.replaceTelegramNotificationDeliveries(nextDeliveries);
        await transaction.setTelegramBotSettings(nextSettings);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_bot.test_sent',
          operation: 'telegram_bot.test',
          targetId: nextDelivery.id,
          targetLabel: nextDelivery.templateId,
          message: 'Telegram Bot test notification queued',
          context: resolvedContext,
          after: redactTelegramDeliveryAudit(nextDelivery)
        });

        return {
          delivery: nextDelivery,
          settings,
          secrets,
          targetChatId
        };
      });

      if (created.delivery.status !== 'pending') {
        return clone(created.delivery);
      }

      const sendResult =
        created.secrets.botToken && created.targetChatId
          ? await sendTelegramBotMessageWithEgress({
              settings: created.settings,
              secrets: created.secrets,
              request: {
                chatId: created.targetChatId,
                text: createTelegramTestMessageText(created.delivery.language),
                parseMode: 'HTML',
                disableWebPagePreview: true
              }
            })
          : {
              ok: false as const,
              errorMessage: created.secrets.botToken
                ? 'telegram target chat id is not available'
                : 'telegram bot token is not available'
            };

      const attempted = applyTelegramDeliveryAttemptResult({
        delivery: created.delivery,
        now: readModelNow(),
        retryInitialDelayMs: created.settings.retry.initialDelayMs,
        result: sendResult
      });

      const persisted = await repository.transaction(async (transaction) => {
        const settings = await readTelegramBotSettingsFrom(transaction);
        const nextSettings: TelegramBotSettings = {
          ...settings,
          lastDeliveryAt: attempted.status === 'delivered' ? attempted.deliveredAt : settings.lastDeliveryAt,
          lastDeliveryError: attempted.status === 'delivered' ? undefined : attempted.lastErrorMessage,
          updatedAt: attempted.updatedAt,
          updatedBy: resolvedContext.actor
        };

        await transaction.upsertTelegramNotificationDelivery(attempted);
        await transaction.setTelegramBotSettings(nextSettings);

        return attempted;
      });

      return clone(persisted);
    },

    async listTelegramBindings() {
      return clone(await listTelegramBindingReadModelsFrom(repository));
    },

    async createTelegramBinding(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const now = readModelNow();
      const customers = await api.listCustomers();
      const readModel = await repository.transaction(async (transaction) => {
        const customerBindings = await transaction.listTelegramCustomerBindings();
        const { chat, binding } = createTelegramBindingRecord({
          request: input,
          customers,
          now,
          actor: resolvedContext.actor,
          sequence: customerBindings.length + 1
        });

        await transaction.upsertTelegramChatBinding(chat);
        await transaction.upsertTelegramCustomerBinding(binding);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_binding.created',
          operation: 'telegram_binding.create',
          targetId: binding.id,
          targetLabel: binding.customerNameSnapshot,
          message: 'Telegram customer binding created',
          context: resolvedContext,
          after: binding
        });

        const readModels = await listTelegramBindingReadModelsFrom(transaction);
        return readModels.find((item) => item.id === binding.id);
      });

      if (!readModel) {
        throw new Error('Telegram binding read model was not created');
      }

      return clone(readModel);
    },

    async revokeTelegramBinding(bindingId, input, context) {
      const resolvedContext = resolveMutationContext(context);
      const readModel = await repository.transaction(async (transaction) => {
        const customerBindings = await transaction.listTelegramCustomerBindings();
        const current = customerBindings.find((binding) => binding.id === bindingId);

        if (!current) {
          throw new Error(`Telegram binding not found: ${bindingId}`);
        }

        const revoked: TelegramCustomerBinding = {
          ...current,
          status: 'revoked',
          revokedAt: readModelNow(),
          revokedBy: resolvedContext.actor,
          revokeReason: input.reason
        };
        await transaction.upsertTelegramCustomerBinding(revoked);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_binding.revoked',
          operation: 'telegram_binding.revoke',
          targetId: revoked.id,
          targetLabel: revoked.customerNameSnapshot,
          message: 'Telegram customer binding revoked',
          context: resolvedContext,
          before: current,
          after: revoked
        });

        const readModels = await listTelegramBindingReadModelsFrom(transaction);
        return readModels.find((item) => item.id === bindingId);
      });

      if (!readModel) {
        throw new Error(`Telegram binding read model not found after revoke: ${bindingId}`);
      }

      return clone(readModel);
    },

    async createTelegramBindingChallenge(input, context) {
      const resolvedContext = resolveMutationContext(context);
      const customers = await api.listCustomers();
      const result = await repository.transaction(async (transaction) => {
        const challenges = await transaction.listTelegramBindingChallenges();
        const nextResult = createTelegramBindingChallengeRecord({
          request: input,
          customers,
          now: readModelNow(),
          actor: resolvedContext.actor,
          sequence: challenges.length + 1
        });
        await transaction.upsertTelegramBindingChallenge(nextResult.challenge);
        await transaction.upsertTelegramBindingChallengeSecret({
          challengeId: nextResult.challenge.id,
          codeHash: hashTelegramBindingCode(nextResult.code),
          createdAt: nextResult.challenge.createdAt,
          expiresAt: nextResult.challenge.expiresAt
        });
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_binding_challenge.created',
          operation: 'telegram_binding_challenge.create',
          targetId: nextResult.challenge.id,
          targetLabel: nextResult.challenge.customerNameSnapshot,
          message: 'Telegram binding challenge created',
          context: resolvedContext,
          after: nextResult.challenge
        });

        return nextResult;
      });

      return clone(result);
    },

    async listTelegramBindingChallenges() {
      return clone(await repository.listTelegramBindingChallenges());
    },

    async listTelegramNotificationPolicies() {
      return clone(await listTelegramNotificationPoliciesFrom(repository));
    },

    async updateTelegramNotificationPolicy(policyId, input, context) {
      const resolvedContext = resolveMutationContext(context);
      const updated = await repository.transaction(async (transaction) => {
        const policies = await listTelegramNotificationPoliciesFrom(transaction);
        const current =
          policies.find((policy) => policy.id === policyId)
          ?? (policyId === TELEGRAM_DEFAULT_POLICY_ID
            ? createDefaultTelegramNotificationPolicy(readModelNow(), resolvedContext.actor)
            : undefined);

        if (!current) {
          throw new Error(`Telegram notification policy not found: ${policyId}`);
        }

        const nextPolicy = applyTelegramNotificationPolicyUpdate(current, input, readModelNow(), resolvedContext.actor);
        await transaction.upsertTelegramNotificationPolicy(nextPolicy);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_notification_policy.updated',
          operation: 'telegram_notification_policy.update',
          targetId: nextPolicy.id,
          targetLabel: nextPolicy.ownerId,
          message: 'Telegram notification policy updated',
          context: resolvedContext,
          before: current,
          after: {
            ...nextPolicy,
            reason: input.reason
          }
        });

        return nextPolicy;
      });

      return clone(updated);
    },

    async listTelegramNotificationDeliveries() {
      return clone(await repository.listTelegramNotificationDeliveries());
    },

    async retryTelegramNotificationDelivery(deliveryId, context) {
      const resolvedContext = resolveMutationContext(context);
      const updated = await repository.transaction(async (transaction) => {
        const deliveries = await transaction.listTelegramNotificationDeliveries();
        const current = deliveries.find((delivery) => delivery.id === deliveryId);

        if (!current) {
          throw new Error(`Telegram notification delivery not found: ${deliveryId}`);
        }

        const nowRetry = readModelNow();
        const nextDelivery: TelegramNotificationDelivery = {
          ...current,
          status: 'pending',
          updatedAt: nowRetry,
          nextAttemptAt: nowRetry,
          deadLetteredAt: undefined,
          lastErrorMessage: undefined
        };
        await transaction.upsertTelegramNotificationDelivery(nextDelivery);
        await appendTelegramAuditLog(transaction, {
          action: 'telegram_notification.delivery_retried',
          operation: 'telegram_notification.delivery_retry',
          targetId: deliveryId,
          targetLabel: current.templateId,
          message: 'Telegram notification delivery retry requested',
          context: resolvedContext,
          before: redactTelegramDeliveryAudit(current),
          after: redactTelegramDeliveryAudit(nextDelivery)
        });

        return nextDelivery;
      });

      return clone(updated);
    },

    async retryTelegramNotificationDeliveries(
      options: TelegramNotificationDeliveryRetryOptions = {}
    ): Promise<TelegramNotificationDeliveryRetryResult> {
      const now = options.now ?? readModelNow();
      const settings = await readTelegramBotSettingsFrom(repository);
      const secrets = await readTelegramBotSecretsFrom(repository);
      const result: TelegramNotificationDeliveryRetryResult = {
        attempted: 0,
        delivered: 0,
        failed: 0,
        deadLettered: 0
      };

      if (!settings.enabled) {
        return {
          ...result,
          skippedReason: 'settings_disabled'
        };
      }

      if (!secrets.botToken) {
        return {
          ...result,
          skippedReason: 'token_missing'
        };
      }

      const maxDeliveries = Math.max(
        1,
        Math.round(options.maxDeliveries ?? settings.retry.maxDeliveriesPerSweep)
      );
      const dueDeliveries = await repository.transaction(async (transaction) => {
        const deliveries = await transaction.listTelegramNotificationDeliveries();
        const due = deliveries
          .filter((delivery) => isDueTelegramNotificationDelivery(delivery, now))
          .sort(
            (left, right) =>
              parseTimestampMs(left.nextAttemptAt) - parseTimestampMs(right.nextAttemptAt)
              || left.id.localeCompare(right.id)
          )
          .slice(0, maxDeliveries)
          .map((delivery) => ({
            ...delivery,
            status: 'pending' as const,
            attemptCount: delivery.attemptCount + 1,
            lastAttemptAt: now,
            updatedAt: now
          }));

        if (due.length === 0) {
          return [];
        }

        const dueById = new Map(due.map((delivery) => [delivery.id, delivery] as const));
        const nextDeliveries = deliveries.map((delivery) => dueById.get(delivery.id) ?? delivery);
        await transaction.replaceTelegramNotificationDeliveries(
          compactTelegramNotificationDeliveries(nextDeliveries, settings.deliveryHistoryLimit)
        );

        return due;
      });

      if (dueDeliveries.length === 0) {
        return result;
      }

      const bindings = dueDeliveries.some((delivery) => !delivery.adminChatId)
        ? await listTelegramBindingReadModelsFrom(repository)
        : [];

      for (const delivery of dueDeliveries) {
        result.attempted += 1;
        const chatId = readTelegramDeliveryRetryChatId(delivery, bindings);
        const sendResult = chatId
          ? await sendTelegramBotMessageWithEgress({
              settings,
              secrets,
              request: {
                chatId,
                text: readTelegramDeliveryRetryText(delivery, settings),
                parseMode: 'HTML',
                disableWebPagePreview: true
              }
            })
          : {
              ok: false as const,
              errorMessage: 'telegram target chat id is not available'
            };
        const attempted = applyTelegramDeliveryAttemptResult({
          delivery,
          now,
          retryInitialDelayMs: settings.retry.initialDelayMs,
          attemptCount: delivery.attemptCount,
          result: sendResult
        });

        if (attempted.status === 'delivered') {
          result.delivered += 1;
        } else if (attempted.status === 'dead_letter') {
          result.deadLettered += 1;
        } else {
          result.failed += 1;
        }

        await repository.transaction(async (transaction) => {
          const currentSettings = await readTelegramBotSettingsFrom(transaction);
          const currentDeliveries = await transaction.listTelegramNotificationDeliveries();
          const nextDeliveries = currentDeliveries.map((current) =>
            current.id === attempted.id ? attempted : current
          );
          const nextSettings: TelegramBotSettings = {
            ...currentSettings,
            lastDeliveryAt: attempted.status === 'delivered' ? attempted.deliveredAt : currentSettings.lastDeliveryAt,
            lastDeliveryError: attempted.status === 'delivered' ? undefined : attempted.lastErrorMessage,
            updatedAt: attempted.updatedAt,
            updatedBy: 'system:telegram-delivery-retry'
          };

          await transaction.replaceTelegramNotificationDeliveries(
            compactTelegramNotificationDeliveries(nextDeliveries, currentSettings.deliveryHistoryLimit)
          );
          await transaction.setTelegramBotSettings(nextSettings);
        });
      }

      return result;
    },

    async scanTelegramNotificationSchedules(options = {}): Promise<TelegramNotificationScheduleScanResult> {
      const now = options.now ?? readModelNow();
      const settings = await readTelegramBotSettingsFrom(repository);
      const secrets = await readTelegramBotSecretsFrom(repository);
      const result: TelegramNotificationScheduleScanResult = {
        enabled: true,
        scannedBindings: 0,
        scannedSystemAlerts: 0,
        enqueuedDeliveries: 0,
        trafficThresholdDeliveries: 0,
        expiryReminderDeliveries: 0,
        subscriptionUpdatedDeliveries: 0,
        providerSyncWarningDeliveries: 0,
        providerSyncFailedDeliveries: 0,
        dailyReportDeliveries: 0,
        weeklyReportDeliveries: 0,
        systemAlertDeliveries: 0,
        skipped: {}
      };

      if (!settings.enabled) {
        return {
          ...result,
          enabled: false,
          skippedReason: 'settings_disabled'
        };
      }

      if (!secrets.botToken) {
        return {
          ...result,
          enabled: false,
          skippedReason: 'token_missing'
        };
      }

      const trafficScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'traffic_threshold_scan'
      );
      const expiryScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'expiry_scan'
      );
      const subscriptionUpdateScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'subscription_update_scan'
      );
      const providerSyncScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'provider_sync_scan'
      );
      const dailyReportScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'daily_report'
      );
      const weeklyReportScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'weekly_report'
      );
      const systemAlertScheduleEnabled = settings.schedules.some(
        (schedule) => schedule.enabled && schedule.kind === 'system_alert_scan'
      );

      if (
        !trafficScheduleEnabled
        && !expiryScheduleEnabled
        && !subscriptionUpdateScheduleEnabled
        && !providerSyncScheduleEnabled
        && !dailyReportScheduleEnabled
        && !weeklyReportScheduleEnabled
        && !systemAlertScheduleEnabled
      ) {
        return {
          ...result,
          enabled: false,
          skippedReason: 'no_schedules_enabled'
        };
      }

      const [data, bindings, systemAlerts] = await Promise.all([
        readTelegramCommandDataContext(),
        listTelegramBindingReadModelsFrom(repository),
        systemAlertScheduleEnabled || providerSyncScheduleEnabled || dailyReportScheduleEnabled || weeklyReportScheduleEnabled
          ? api.listSystemAlerts()
          : Promise.resolve([])
      ]);
      result.scannedBindings = bindings.length;
      result.scannedSystemAlerts = systemAlerts.length;
      const reportData = dailyReportScheduleEnabled || weeklyReportScheduleEnabled
        ? await readTelegramScheduledReportData(data, systemAlerts)
        : undefined;

      const maxDeliveries = Math.max(1, Math.round(options.maxDeliveries ?? settings.retry.maxDeliveriesPerSweep));

      await repository.transaction(async (transaction) => {
        const deliveries = await transaction.listTelegramNotificationDeliveries();
        const existingDedupeKeys = new Set(deliveries.map((delivery) => delivery.dedupeKey));
        const deliveryCountByBinding = new Map(
          bindings.map((binding) => [
            binding.id,
            readTelegramDeliveryCountWithinHour(deliveries, binding.id, now)
          ] as const)
        );
        const deliveryCountByAdminChat = new Map(
          settings.adminChatIds.map((adminChatId) => [
            adminChatId,
            readTelegramAdminDeliveryCountWithinHour(deliveries, adminChatId, now)
          ] as const)
        );
        const newDeliveries: TelegramNotificationDelivery[] = [];

        for (const binding of bindings) {
          if (isTelegramBindingInactive(binding)) {
            addTelegramScheduleSkip(result, 'binding_inactive');
            continue;
          }

          if (!binding.customerBinding.permissions.receiveNotifications) {
            addTelegramScheduleSkip(result, 'permission_disabled');
            continue;
          }

          const policy = readTelegramEffectivePolicy(data, binding, settings);

          if (!policy.enabled) {
            addTelegramScheduleSkip(result, 'policy_disabled');
            continue;
          }

          const candidates: TelegramScheduleDeliveryCandidate[] = [];

          if (trafficScheduleEnabled) {
            if (!telegramPolicyAllowsNotification(policy, 'traffic.threshold')) {
              addTelegramScheduleSkip(result, 'notification_type_disabled');
            } else {
              const candidate = createTelegramTrafficThresholdCandidate({
                data,
                binding,
                policy,
                now,
                existingDedupeKeys,
                result
              });

              if (candidate) {
                candidates.push(candidate);
              }
            }
          }

          if (expiryScheduleEnabled) {
            if (!telegramPolicyAllowsNotification(policy, 'subscription.expiring')) {
              addTelegramScheduleSkip(result, 'notification_type_disabled');
            } else {
              const candidate = createTelegramExpiryReminderCandidate({
                data,
                binding,
                policy,
                now,
                existingDedupeKeys,
                result
              });

              if (candidate) {
                candidates.push(candidate);
              }
            }
          }

          if (subscriptionUpdateScheduleEnabled) {
            if (!telegramPolicyAllowsNotification(policy, 'subscription.updated')) {
              addTelegramScheduleSkip(result, 'notification_type_disabled');
            } else {
              const candidate = createTelegramSubscriptionUpdatedCandidate({
                data,
                binding,
                policy,
                existingDedupeKeys,
                result
              });

              if (candidate) {
                candidates.push(candidate);
              }
            }
          }

          for (const candidate of candidates) {
            if (result.enqueuedDeliveries >= maxDeliveries) {
              addTelegramScheduleSkip(result, 'max_deliveries_reached');
              continue;
            }

            const currentHourlyCount = deliveryCountByBinding.get(binding.id) ?? 0;

            if (currentHourlyCount >= policy.maxMessagesPerHour) {
              addTelegramScheduleSkip(result, 'rate_limited');
              continue;
            }

            const delivery = createTelegramScheduleDelivery({
              candidate,
              settings,
              now,
              sequence: deliveries.length + newDeliveries.length + 1
            });
            newDeliveries.push(delivery);
            existingDedupeKeys.add(delivery.dedupeKey);
            deliveryCountByBinding.set(binding.id, currentHourlyCount + 1);
            result.enqueuedDeliveries += 1;

            if (candidate.kind === 'traffic') {
              result.trafficThresholdDeliveries += 1;
            } else if (candidate.kind === 'expiry') {
              result.expiryReminderDeliveries += 1;
            } else if (candidate.kind === 'subscription-update') {
              result.subscriptionUpdatedDeliveries += 1;
            }
          }
        }

        if (providerSyncScheduleEnabled && systemAlerts.length > 0) {
          const providerSyncAlerts = systemAlerts.filter(isTelegramProviderSyncAlert);
          const policy = readTelegramDefaultPolicy(data, settings);

          if (providerSyncAlerts.length > 0) {
            if (settings.adminChatIds.length === 0) {
              addTelegramScheduleSkip(result, 'no_admin_recipients');
            } else if (!policy.enabled) {
              addTelegramScheduleSkip(result, 'policy_disabled');
            } else {
              for (const alert of providerSyncAlerts) {
                const notificationType = readTelegramProviderSyncNotificationType(alert);

                if (!notificationType) {
                  continue;
                }

                if (!telegramPolicyAllowsNotification(policy, notificationType)) {
                  addTelegramScheduleSkip(result, 'notification_type_disabled');
                  continue;
                }

                for (const adminChatId of settings.adminChatIds) {
                  if (result.enqueuedDeliveries >= maxDeliveries) {
                    addTelegramScheduleSkip(result, 'max_deliveries_reached');
                    continue;
                  }

                  const dedupeKey = createTelegramProviderSyncAlertDedupeKey(adminChatId, alert, notificationType);

                  if (existingDedupeKeys.has(dedupeKey)) {
                    addTelegramScheduleSkip(result, 'duplicate_delivery');
                    continue;
                  }

                  const currentHourlyCount = deliveryCountByAdminChat.get(adminChatId) ?? 0;

                  if (currentHourlyCount >= policy.maxMessagesPerHour) {
                    addTelegramScheduleSkip(result, 'rate_limited');
                    continue;
                  }

                  const delivery = createTelegramProviderSyncAlertDelivery({
                    adminChatId,
                    alert,
                    notificationType,
                    policy,
                    settings,
                    now,
                    sequence: deliveries.length + newDeliveries.length + 1
                  });
                  newDeliveries.push(delivery);
                  existingDedupeKeys.add(delivery.dedupeKey);
                  deliveryCountByAdminChat.set(adminChatId, currentHourlyCount + 1);
                  result.enqueuedDeliveries += 1;

                  if (notificationType === 'provider.sync_failed') {
                    result.providerSyncFailedDeliveries += 1;
                  } else {
                    result.providerSyncWarningDeliveries += 1;
                  }
                }
              }
            }
          }
        }

        if ((dailyReportScheduleEnabled || weeklyReportScheduleEnabled) && reportData) {
          const policy = readTelegramDefaultPolicy(data, settings);
          const reportKinds: TelegramScheduledReportKind[] = [
            ...(dailyReportScheduleEnabled ? ['daily' as const] : []),
            ...(weeklyReportScheduleEnabled ? ['weekly' as const] : [])
          ];

          if (settings.adminChatIds.length === 0) {
            addTelegramScheduleSkip(result, 'no_admin_recipients');
          } else if (!policy.enabled) {
            addTelegramScheduleSkip(result, 'policy_disabled');
          } else {
            for (const kind of reportKinds) {
              const notificationType = readTelegramScheduledReportNotificationType(kind);

              if (!telegramPolicyAllowsNotification(policy, notificationType)) {
                addTelegramScheduleSkip(result, 'notification_type_disabled');
                continue;
              }

              const periodKey = createTelegramScheduledReportPeriodKey(kind, now);

              for (const adminChatId of settings.adminChatIds) {
                if (result.enqueuedDeliveries >= maxDeliveries) {
                  addTelegramScheduleSkip(result, 'max_deliveries_reached');
                  continue;
                }

                const dedupeKey = createTelegramScheduledReportDedupeKey(adminChatId, notificationType, periodKey);

                if (existingDedupeKeys.has(dedupeKey)) {
                  addTelegramScheduleSkip(result, 'duplicate_delivery');
                  continue;
                }

                const currentHourlyCount = deliveryCountByAdminChat.get(adminChatId) ?? 0;

                if (currentHourlyCount >= policy.maxMessagesPerHour) {
                  addTelegramScheduleSkip(result, 'rate_limited');
                  continue;
                }

                const delivery = createTelegramScheduledReportDelivery({
                  adminChatId,
                  kind,
                  periodKey,
                  data: reportData,
                  policy,
                  settings,
                  now,
                  sequence: deliveries.length + newDeliveries.length + 1
                });
                newDeliveries.push(delivery);
                existingDedupeKeys.add(delivery.dedupeKey);
                deliveryCountByAdminChat.set(adminChatId, currentHourlyCount + 1);
                result.enqueuedDeliveries += 1;

                if (kind === 'daily') {
                  result.dailyReportDeliveries += 1;
                } else {
                  result.weeklyReportDeliveries += 1;
                }
              }
            }
          }
        }

        const systemAlertFanOutAlerts = providerSyncScheduleEnabled
          ? systemAlerts.filter((alert) => !isTelegramProviderSyncAlert(alert))
          : systemAlerts;

        if (systemAlertScheduleEnabled && systemAlertFanOutAlerts.length > 0) {
          const policy = readTelegramDefaultPolicy(data, settings);

          if (settings.adminChatIds.length === 0) {
            addTelegramScheduleSkip(result, 'no_admin_recipients');
          } else if (!policy.enabled) {
            addTelegramScheduleSkip(result, 'policy_disabled');
          } else if (!telegramPolicyAllowsNotification(policy, 'system.alert')) {
            addTelegramScheduleSkip(result, 'notification_type_disabled');
          } else {
            for (const alert of systemAlertFanOutAlerts) {
              for (const adminChatId of settings.adminChatIds) {
                if (result.enqueuedDeliveries >= maxDeliveries) {
                  addTelegramScheduleSkip(result, 'max_deliveries_reached');
                  continue;
                }

                const dedupeKey = createTelegramSystemAlertDedupeKey(adminChatId, alert);

                if (existingDedupeKeys.has(dedupeKey)) {
                  addTelegramScheduleSkip(result, 'duplicate_delivery');
                  continue;
                }

                const currentHourlyCount = deliveryCountByAdminChat.get(adminChatId) ?? 0;

                if (currentHourlyCount >= policy.maxMessagesPerHour) {
                  addTelegramScheduleSkip(result, 'rate_limited');
                  continue;
                }

                const delivery = createTelegramSystemAlertDelivery({
                  adminChatId,
                  alert,
                  policy,
                  settings,
                  now,
                  sequence: deliveries.length + newDeliveries.length + 1
                });
                newDeliveries.push(delivery);
                existingDedupeKeys.add(delivery.dedupeKey);
                deliveryCountByAdminChat.set(adminChatId, currentHourlyCount + 1);
                result.enqueuedDeliveries += 1;
                result.systemAlertDeliveries += 1;
              }
            }
          }
        }

        if (newDeliveries.length > 0) {
          await transaction.replaceTelegramNotificationDeliveries(
            compactTelegramNotificationDeliveries([...newDeliveries, ...deliveries], settings.deliveryHistoryLimit)
          );
        }
      });

      return clone(result);
    },

    async handleTelegramWebhookUpdate(secretPath, update) {
      const settings = await readTelegramBotSettingsFrom(repository);
      const secrets = await readTelegramBotSecretsFrom(repository);

      if (!secrets.webhookSecretPath || secrets.webhookSecretPath !== secretPath) {
        throw new Error('Telegram webhook secret mismatch');
      }

      return processTelegramUpdate(settings, secrets, update);
    },

    async pollTelegramBotUpdates() {
      const settings = await readTelegramBotSettingsFrom(repository);
      const secrets = await readTelegramBotSecretsFrom(repository);

      if (!settings.enabled) {
        return {
          enabled: false,
          fetchedCount: 0,
          handledCount: 0,
          skippedReason: 'settings_disabled',
          errors: []
        };
      }

      if (settings.mode !== 'long_polling') {
        return {
          enabled: false,
          fetchedCount: 0,
          handledCount: 0,
          skippedReason: 'mode_not_long_polling',
          errors: []
        };
      }

      if (!secrets.botToken) {
        return {
          enabled: false,
          fetchedCount: 0,
          handledCount: 0,
          skippedReason: 'token_missing',
          errors: []
        };
      }

      const updatesResult = await fetchTelegramBotUpdatesWithEgress({
        settings,
        secrets,
        offset: secrets.longPollingOffset
      });

      if (!updatesResult.ok) {
        return {
          enabled: true,
          fetchedCount: 0,
          handledCount: 0,
          nextOffset: secrets.longPollingOffset,
          errors: [updatesResult.errorMessage]
        };
      }

      const errors: string[] = [];
      let handledCount = 0;

      for (const update of updatesResult.updates) {
        try {
          await processTelegramUpdate(settings, secrets, update);
          handledCount += 1;
        } catch (error) {
          errors.push(sanitizeTelegramBotErrorMessage(error, [secrets.botToken]));
        }
      }

      const nextOffset =
        updatesResult.updates.length > 0
          ? Math.max(...updatesResult.updates.map((update) => update.update_id)) + 1
          : secrets.longPollingOffset;

      await repository.transaction(async (transaction) => {
        const currentSecrets = await readTelegramBotSecretsFrom(transaction);
        await transaction.setTelegramBotSecrets({
          ...currentSecrets,
          longPollingOffset: nextOffset
        });
      });

      return {
        enabled: true,
        fetchedCount: updatesResult.updates.length,
        handledCount,
        nextOffset,
        errors
      } satisfies TelegramLongPollingResult;
    },

    async listRateLimitPolicies() {
      return clone(inventory.rateLimitPolicies ?? []);
    },

    async listPermissionGrants() {
      return repository.listPermissionGrants();
    },

    async listRoutingPolicies() {
      return clone(inventory.routingPolicies ?? []);
    },

    async listTuningProfiles() {
      return clone(inventory.tuningProfiles ?? []);
    },

    async listTasks() {
      return repository.listTasks();
    },

    async listCommandOutbox() {
      return repository.listCommandOutbox();
    },

    async listAgentSessions() {
      const sessions = await repository.listAgentSessions();
      const credentials = await service.listAgentCredentials();
      return clone(
        sessions.map((session) => createAgentSessionSummary(session, findRuntimeCredentialForSession(credentials, session)))
      );
    },

    async listAgentCredentials() {
      return service.listAgentCredentials();
    },

    async listOperatorSessions() {
      return operatorSessionStore?.list() ?? [];
    },

    async listConfigRevisions() {
      return repository.listConfigRevisions();
    },

    async listPreflightPlans() {
      return repository.listPreflightPlans();
    },

    async listRuntimeSnapshots() {
      return repository.listRuntimeSnapshots();
    },

    async listTrafficRollups(query) {
      return selectTrafficRollups(await repository.listTrafficRollups(), query);
    },

    async listTrafficRollupCompactions(query) {
      return selectTrafficRollupCompactions(await repository.listTrafficRollupCompactions(), query);
    },

    async listSystemAlerts(_query, externalAlerts = []) {
      await hydrateReadModelsFromPersistedTasks();
      const now = readModelNow();
      return reconcileAndPersistSystemAlerts(
        applyAgentLivenessToReadModel(agents, now),
        await repository.listCommandOutbox(),
        await listLiveQuotaPolicies(),
        await repository.listTasks(),
        await repository.listSystemAlertNotificationDeliveries(),
        externalAlerts,
        now
      );
    },

    async listAgentLogChunks(query) {
      return selectAgentLogChunks(await repository.listAgentEvents(), query);
    },

    async listAgentLogArchives(query) {
      return selectAgentLogArchives(await repository.listAgentLogArchives(), query);
    },

    async exportAgentLogChunks(query) {
      return createAgentLogExport(await repository.listAgentEvents(), query, readModelNow());
    },

    async exportAgentLogArchives(query) {
      return createAgentLogArchiveExport(await repository.listAgentLogArchives(), query, readModelNow());
    },

    async exportTrafficRollups(query) {
      return createTrafficRollupExport(await repository.listTrafficRollups(), query, readModelNow());
    },

    async exportTrafficRollupCompactions(query) {
      return createTrafficRollupCompactionExport(
        await repository.listTrafficRollupCompactions(),
        query,
        readModelNow()
      );
    },

    async listAuditLogs() {
      return repository.listAuditLogs();
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? (await repository.listAuditLogs())));
    },

    async recordAgentRequestDenied(input: AgentRequestDeniedAuditInput) {
      return repository.transaction((transaction) =>
        appendStandaloneAuditLog(transaction, createAgentRequestDeniedAuditLog(input, readModelNow()))
      );
    },

    async recordOperatorRequestDenied(input: OperatorRequestDeniedAuditInput) {
      return repository.transaction((transaction) =>
        appendStandaloneAuditLog(transaction, createOperatorRequestDeniedAuditLog(input, readModelNow()))
      );
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext) {
      return service.createAgentInstallCommand(input, resolveMutationContext(context));
    },

    async createAgentUpgradeCommand(input: AgentUpgradeCommandRequest, context?: MutationContext) {
      return service.createAgentUpgradeCommand(input, resolveMutationContext(context));
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const credential = await service.registerAgent(input, installToken, context);
      await hydrateReadModelsFromPersistedTasks();
      return credential;
    },

    async revokeAgentCredential(credentialId, input, context?: MutationContext) {
      return service.revokeAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async revokeOperatorSession(sessionId: string, input: OperatorSessionRevokeRequest, context?: MutationContext) {
      if (!operatorSessionStore) {
        throw new Error(`operator session not found: ${sessionId}`);
      }

      const session = await operatorSessionStore.revoke(sessionId, {
        ...resolveMutationContext(context),
        reason: input.reason
      });

      if (!session) {
        throw new Error(`operator session not found: ${sessionId}`);
      }

      return session;
    },

    async rotateAgentCredential(credentialId, input, context?: MutationContext) {
      return service.rotateAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async resetQuotaPolicy(policyId: string, context?: MutationContext) {
      const policy = (await listLiveQuotaPolicies()).find((item) => item.id === policyId);

      if (!policy) {
        throw new Error(`Quota policy not found: ${policyId}`);
      }

      return api.createTask(createQuotaResetTaskInput(policy), context);
    },

    async applyXrayClientAction(input, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();
      const observedAtMs = Date.parse(input.observedAt ?? '');
      const observedAt = Number.isNaN(observedAtMs) ? readModelNow() : new Date(observedAtMs).toISOString();
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, observedAt);
      const inbound = liveInbounds.find((item) => item.id === input.inboundId);

      if (!inbound) {
        throw new Error(`Xray inbound not found: ${input.inboundId}`);
      }

      const plan = createXrayClientActionTaskPlan({
        inbound,
        request: input,
        observedAt
      });
      const mutationContext = resolveMutationContext(context);

      return api.createTask(plan.input, {
        ...mutationContext,
        idempotencyKey: mutationContext.idempotencyKey ?? plan.idempotencyKey
      });
    },

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();
      const beforeForwardRules = await listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = await listLiveInboundsForGuardrailEnforcement();
      const now = readModelNow();
      const persistedTasks = sortTasksForReadModelReplay(await repository.listTasks());
      const quotaResetReplayState = createQuotaResetReplayState(persistedTasks);
      const liveInbounds = applyXrayTrafficWindowToReadModel(inbounds, now);
      const liveSubscriptionClients = projectSubscriptionClientReadModels(
        subscriptionClients,
        liveInbounds,
        subscriptionInventoryNodes,
        quotaResetReplayState,
        now
      );
      const resetAwareInput =
        input.operation === 'quota.reset'
          ? prepareQuotaResetTaskInput({
              input,
              nowIso: now,
              agents: applyAgentLivenessToReadModel(agents, now),
              inbounds: liveInbounds,
              forwardRules: applyForwardingBillingWindowToReadModel(await listForwardRuleReadModel(), now),
              subscriptionClients: liveSubscriptionClients,
              quotaPolicies: await listLiveQuotaPolicies()
            })
          : input;
      const xrayCapabilityDenial = findXrayCapabilityDenial(resetAwareInput, agents);

      if (xrayCapabilityDenial) {
        throw new Error(`${xrayCapabilityDenial.code}: ${xrayCapabilityDenial.denialReason}`);
      }

      const xrayPortConflictDenial = findXrayInboundPortConflictDenial(resetAwareInput, {
        inbounds: liveInbounds,
        tasks: persistedTasks,
        nodes: inventory.nodes ?? []
      });

      if (xrayPortConflictDenial) {
        throw new Error(`${xrayPortConflictDenial.code}: ${xrayPortConflictDenial.denialReason}`);
      }

      const task = await service.createTask(resetAwareInput, resolveMutationContext(context));
      upsertReadModelTask(task);

      if (task.operation === 'agent.delete') {
        deletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
        await repository.transaction(async (transaction) => {
          await transaction.deleteSubscriptionSource(deletedSourceId);
          await transaction.replaceSubscriptionInventoryNodesForSource(deletedSourceId, []);
        });
      }

      const importedSubscriptionSource = createSubscriptionSourceFromTask(task);
      const generatedSubscriptionExportProfile = createSubscriptionExportProfileFromTask(task);
      const generatedSubscriptionClientFromTask = createSubscriptionClientFromTask(task);
      if (generatedSubscriptionClientFromTask) {
        await hydrateReadModelsFromPersistedTasks();
      }
      const generatedSubscriptionClient = generatedSubscriptionClientFromTask
        ? projectSubscriptionClientReadModel(
            generatedSubscriptionClientFromTask,
            applyXrayTrafficWindowToReadModel(inbounds, readModelNow()),
            subscriptionInventoryNodes
          )
        : undefined;
      const deletedSubscriptionClientId = readSubscriptionClientDeleteId(task);
      const deletedSubscriptionExportProfileId = readSubscriptionExportProfileDeleteId(task);

      subscriptionSources = applySubscriptionSourceTask(subscriptionSources, task);
      inbounds = applyXrayInboundTask(inbounds, task);
      inbounds = applyQuotaResetTaskToInbounds(inbounds, task);
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      forwardRulesReadModel = applyQuotaResetTaskToForwardRules(forwardRulesReadModel, task);
      agents = applyAgentTask(agents, task);
      agents = applyQuotaResetTaskToAgents(agents, task);
      subscriptionClients = generatedSubscriptionClient
        ? [
            generatedSubscriptionClient,
            ...subscriptionClients.filter((client) => client.id !== generatedSubscriptionClient.id)
          ]
        : applySubscriptionClientTask(subscriptionClients, task);
      subscriptionClients = applyQuotaResetTaskToSubscriptionClients(subscriptionClients, task);
      subscriptionExportProfiles = applySubscriptionExportProfileTask(subscriptionExportProfiles, task);

      if (
        importedSubscriptionSource ||
        generatedSubscriptionClient ||
        deletedSubscriptionClientId ||
        generatedSubscriptionExportProfile ||
        deletedSubscriptionExportProfileId
      ) {
        await repository.transaction(async (transaction) => {
          if (importedSubscriptionSource) {
            await transaction.upsertSubscriptionSource(importedSubscriptionSource);
          }

          if (generatedSubscriptionExportProfile) {
            await transaction.upsertSubscriptionExportProfile(generatedSubscriptionExportProfile);
          }

          if (deletedSubscriptionExportProfileId) {
            await transaction.deleteSubscriptionExportProfile(deletedSubscriptionExportProfileId);
          }

          if (generatedSubscriptionClient) {
            await transaction.upsertSubscriptionClient(generatedSubscriptionClient);
          }

          if (deletedSubscriptionClientId) {
            await transaction.deleteSubscriptionClient(deletedSubscriptionClientId);
          }
        });
      }

      if (
        input.metadata?.quotaEnforcementAutomatic !== true &&
        ['quota.reset', 'forward.create', 'forward.update', 'forward.apply', 'forward.resume'].includes(task.operation)
      ) {
        await enqueueDerivedForwardQuotaEnforcementTasks(beforeForwardRules, {
          kind: 'task',
          id: task.id,
          observedAt: task.createdAt
        });
      }

      if (input.metadata?.xrayGuardrailAutomatic !== true && task.operation === 'quota.reset') {
        const afterInbounds = await listLiveInboundsForGuardrailEnforcement();
        if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
          await enqueueDerivedXrayGuardrailTasks({
            kind: 'task',
            id: task.id,
            observedAt: task.createdAt
          });
        }
      }

      return task;
    },

    async syncSubscriptionSource(sourceId: string, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();

      const source = subscriptionSources.find((item) => item.id === sourceId);
      const syncedAt = new Date().toISOString();
      const mutationContext = resolveMutationContext(context);

      if (!source) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      const fetchPolicy = resolveSubscriptionSourceFetchPolicy(source, subscriptionSourceFetchPolicy);
      const leased = await acquireSubscriptionSourceSyncLease(sourceId, syncedAt, fetchPolicy);
      const syncSource = {
        ...leased.source,
        syncBudget: leased.leasedSource.syncBudget
      };
      subscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
        status: 'syncing',
        syncBudget: leased.leasedSource.syncBudget,
        syncLeaseOwnerId: leased.leasedSource.syncLeaseOwnerId,
        syncLeaseExpiresAt: leased.leasedSource.syncLeaseExpiresAt
      });
      const auditBefore = {
        id: syncSource.id,
        status: syncSource.status,
        nodeCount: syncSource.nodeCount,
        lastSyncAt: syncSource.lastSyncAt,
        syncBudget: syncSource.syncBudget,
        syncWarnings: syncSource.syncWarnings ?? []
      };

      try {
        const response = await fetchSubscriptionSourceContent(
          syncSource,
          fetcher,
          subscriptionSourceRemoteFetcher,
          subscriptionSourceHostResolver,
          subscriptionSourceEgressPolicy,
          leased.fetchPolicy
        );
        const syncBudget = recordSubscriptionSourceSyncBudgetBytes(
          syncSource,
          readFetchedSubscriptionSourceBodyBytes(response),
          syncedAt,
          subscriptionSourceSyncBudgetPolicy
        );
        const result = parseSubscriptionSourceContent({
          source: syncSource,
          body: response.body,
          syncedAt,
          trafficHeader: response.trafficHeader
        });
        const crossSourceDuplicateCount = countCrossSourceSubscriptionInventoryDuplicates(
          result.nodes,
          subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId),
          syncSource.dedupeKey
        );
        const syncedResult: SubscriptionSourceSyncResult = {
          ...result,
          status: result.status === 'synced' && crossSourceDuplicateCount > 0 ? 'warning' : result.status,
          warnings:
            crossSourceDuplicateCount > 0
              ? [...result.warnings, `subscription_source.cross_source_duplicates:${crossSourceDuplicateCount}`]
              : result.warnings
        };

        const nextSubscriptionInventoryNodes = [
          ...syncedResult.nodes,
          ...subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId)
        ];
        const nextSubscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: syncedResult.status,
          nodeCount: syncedResult.nodeCount,
          lastSyncAt: syncedResult.syncedAt,
          traffic: syncedResult.traffic,
          syncBudget,
          syncWarnings: syncedResult.warnings,
          syncLeaseOwnerId: undefined,
          syncLeaseExpiresAt: undefined
        });
        const syncedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (syncedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source: syncSource,
            result: syncedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: syncedResult.status,
              nodeCount: syncedResult.nodeCount,
              syncedAt: syncedResult.syncedAt,
              syncBudget,
              warnings: syncedResult.warnings
            }
          });

          await repository.transaction(async (transaction) => {
            await transaction.replaceSubscriptionInventoryNodesForSource(sourceId, syncedResult.nodes);
            await transaction.upsertSubscriptionSource(syncedSource);
            await appendStandaloneAuditLog(transaction, auditLog);
          });
          subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
          subscriptionSources = nextSubscriptionSources;
        }

        return clone(syncedResult);
      } catch (error) {
        const failedResult = createFailedSubscriptionSyncResult(sourceId, syncedAt, error);
        const nextSubscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId);
        const nextSubscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: 'failed',
          nodeCount: 0,
          lastSyncAt: syncedAt,
          traffic: undefined,
          syncBudget: syncSource.syncBudget,
          syncWarnings: failedResult.warnings,
          syncLeaseOwnerId: undefined,
          syncLeaseExpiresAt: undefined
        });
        const failedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (failedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source: syncSource,
            result: failedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: failedResult.status,
              nodeCount: failedResult.nodeCount,
              syncedAt: failedResult.syncedAt,
              syncBudget: syncSource.syncBudget,
              warnings: failedResult.warnings
            }
          });

          await repository.transaction(async (transaction) => {
            await transaction.replaceSubscriptionInventoryNodesForSource(sourceId, []);
            await transaction.upsertSubscriptionSource(failedSource);
            await appendStandaloneAuditLog(transaction, auditLog);
          });
          subscriptionInventoryNodes = nextSubscriptionInventoryNodes;
          subscriptionSources = nextSubscriptionSources;
        }
        return clone(failedResult);
      }
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext) {
      const task = await service.transitionTask(taskId, status, resolveMutationContext(context));
      upsertReadModelTask(task);
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      return task;
    },

    async issueAgentCommand(agentId: string, command: AgentCommandEnvelope, context?: MutationContext) {
      return service.issueAgentCommand(agentId, command, resolveMutationContext(context));
    },

    async leaseAgentCommands(agentId, options) {
      return service.leaseAgentCommands(agentId, options);
    },

    async sweepCommandTimeouts(options) {
      return service.sweepCommandTimeouts(options);
    },

    async retrySystemAlertNotifications(options) {
      return retrySystemAlertNotifications(options);
    },

    async receiveAgentEvent(event: AgentEventEnvelope) {
      if (event.type === 'heartbeat') {
        if (!readModelsHydrated) {
          await hydrateReadModelsFromPersistedTasks();
        }

        const result = await service.receiveAgentEvent(event);
        rememberRecentHighFrequencyAgentEvent(event);

        if (!deletedAgentIds.has(event.agentId)) {
          agents = applyAgentEventToReadModel(agents, event);
        }

        return result;
      }

      if (event.type === 'telemetry_sample' && !readModelsHydrated) {
        await hydrateReadModelsFromPersistedTasks();
      }

      const useTelemetryFastPath = event.type === 'telemetry_sample' && readModelsHydrated;
      const beforeForwardRules = useTelemetryFastPath
        ? await listLiveForwardRulesForQuotaEnforcementFromReadModel()
        : await listLiveForwardRulesForQuotaEnforcement();
      const beforeInbounds = useTelemetryFastPath
        ? listLiveInboundsForGuardrailEnforcementFromReadModel()
        : await listLiveInboundsForGuardrailEnforcement();
      const result = await service.receiveAgentEvent(event);
      rememberRecentHighFrequencyAgentEvent(event);
      const replayTasks = useTelemetryFastPath ? readModelTasks : sortTasksForReadModelReplay(await repository.listTasks());
      const quotaResetReplayState = createQuotaResetReplayState(replayTasks);
      const resetAwareEvent = applyQuotaResetStateToForwardingEvent(
        applyQuotaResetStateToXrayEvent(applyQuotaResetStateToAgentEvent(event, quotaResetReplayState), quotaResetReplayState),
        quotaResetReplayState
      );
      if (!deletedAgentIds.has(event.agentId)) {
        agents = applyAgentEventToReadModel(agents, resetAwareEvent);
        inbounds = applyXrayTelemetryToReadModel(inbounds, resetAwareEvent);
        forwardRulesReadModel = applyForwardingTelemetryToReadModel(await listForwardRuleReadModel(), resetAwareEvent);
      }
      if (result) {
        upsertReadModelTask(result);
        forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), result);
      }

      const trigger = {
        kind: 'agent-event',
        id: event.eventId,
        observedAt: event.observedAt
      } as const;
      await enqueueDerivedForwardQuotaEnforcementTasks(
        beforeForwardRules,
        trigger,
        useTelemetryFastPath
          ? {
              afterRules: await listLiveForwardRulesForQuotaEnforcementFromReadModel(),
              afterPolicies: await listLiveQuotaPoliciesFromReadModel(readModelTasks),
              tasks: readModelTasks
            }
          : undefined
      );
      const afterInbounds = useTelemetryFastPath
        ? listLiveInboundsForGuardrailEnforcementFromReadModel()
        : await listLiveInboundsForGuardrailEnforcement();
      if (JSON.stringify(beforeInbounds) !== JSON.stringify(afterInbounds)) {
        await enqueueDerivedXrayGuardrailTasks(
          trigger,
          useTelemetryFastPath
            ? {
                afterInbounds,
                tasks: readModelTasks
              }
            : undefined
        );
      }
      return result;
    }
  };

  return api;
}
