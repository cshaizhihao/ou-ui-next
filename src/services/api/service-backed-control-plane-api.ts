import { createHash } from 'node:crypto';
import { lookup as lookupDns } from 'node:dns/promises';
import { isIP } from 'node:net';
import type {
  Agent,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AuditLog,
  CreateTaskInput,
  DeployTask,
  DeployTaskStatus,
  ManagedNode,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
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
  createSubscriptionClientFromTask,
  createSubscriptionBundlesFromInventory,
  countCrossSourceSubscriptionInventoryDuplicates,
  createProxyProvidersFromSources,
  createSubscriptionExportFilesFromClients,
  createSubscriptionExportProfileFromTask,
  readSubscriptionExportProfileDeleteId,
  createSubscriptionSourceFromTask,
  readSubscriptionSourceDeleteId
} from '../../domain';
import type {
  AgentSessionState,
  ControlPlaneRepository,
  ControlPlaneTransaction
} from '../../server/control-plane/control-plane-repository';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import { applyAgentEventToReadModel, applyAgentLivenessToReadModel } from './agent-telemetry-read-model';
import {
  applyForwardingBillingWindowToReadModel,
  applyForwardingTelemetryToReadModel
} from './forwarding-telemetry-read-model';
import { applyXrayTelemetryToReadModel, applyXrayTrafficWindowToReadModel } from './xray-telemetry-read-model';
import type {
  AuditChainVerification,
  ControlPlaneApi,
  MutationContext
} from './control-plane-api';
import { createObservabilityMetrics, selectAgentLogChunks, v1ApiBoundary } from './control-plane-api';
import { projectSubscriptionClientRuntimeState } from './subscription-output';
import { parseSubscriptionSourceContent } from './subscription-source-parser';
import { createSystemAlertsFromAgents } from './system-alerts';

type ControlPlaneService = ReturnType<typeof createControlPlaneService>;

type ServiceBackedControlPlaneApiInput = {
  repository: ControlPlaneRepository;
  service: ControlPlaneService;
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
  subscriptionSourceHostResolver?: SubscriptionSourceHostResolver;
  subscriptionSourceFetch?: Partial<SubscriptionSourceFetchPolicy>;
  subscriptionSourceEgress?: Partial<SubscriptionSourceEgressPolicy>;
  readModelNow?: () => string;
};

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;
const SUBSCRIPTION_SOURCE_FETCH_TIMEOUT_MS = 20_000;
const SUBSCRIPTION_SOURCE_MAX_BODY_BYTES = 5 * 1024 * 1024;
const SUBSCRIPTION_SOURCE_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

type SubscriptionSourceFetchPolicy = {
  timeoutMs: number;
  maxBodyBytes: number;
};

type SubscriptionSourceEgressPolicy = {
  allowedHosts: string[];
};

type SubscriptionSourceResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type SubscriptionSourceHostResolver = (hostname: string) => Promise<SubscriptionSourceResolvedAddress[]>;

type FetchedSubscriptionSourceContent = {
  body: string;
  trafficHeader?: string | null;
};

const defaultSubscriptionSourceHostResolver: SubscriptionSourceHostResolver = async (hostname) => {
  const records = await lookupDns(hostname, { all: true });

  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4
  }));
};

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
        capability === 'bbr'
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
  const capabilities = normalizeAgentCapabilities(
    session?.capabilities ?? credential.metadata.installProfile
  );

  return {
    id: credential.agentId,
    name: credential.agentId,
    status: session?.status ?? 'provisioning',
    region: 'custom',
    publicAddress: credential.sourceIp || 'pending',
    connectionMode: 'pull',
    version: session?.version ?? 'unknown',
    platform: 'linux/unknown',
    capabilities,
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt: '',
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
      samplingExpectedSince: observedAt
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

function readTaskMetadataString(task: DeployTask, key: string, fallback: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readAgentIdFromTask(task: DeployTask) {
  return readTaskMetadataString(task, 'agentId', task.targetId);
}

function updateSubscriptionSourceSyncState(
  sources: SubscriptionSource[],
  sourceId: string,
  patch: Partial<Pick<SubscriptionSource, 'status' | 'nodeCount' | 'lastSyncAt' | 'traffic' | 'syncWarnings'>>
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
    id: `audit-subscription-sync-${input.source.id}-${input.context.requestId}`,
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

function assertSubscriptionSourceSyncAllowed(source: SubscriptionSource, now: string) {
  if (source.status === 'syncing') {
    return;
  }

  const intervalMinutes = Math.max(Math.round(source.refreshIntervalMinutes ?? source.rateLimitPerMinute ?? 60), 1);
  const lastSyncMs = Date.parse(source.lastSyncAt);
  const nowMs = Date.parse(now);

  if (Number.isNaN(lastSyncMs) || Number.isNaN(nowMs)) {
    return;
  }

  const nextAllowedMs = lastSyncMs + intervalMinutes * 60 * 1000;

  if (nowMs < nextAllowedMs) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(nextAllowedMs).toISOString());
  }
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
  const allowedHosts = (policy?.allowedHosts ?? [])
    .map((entry) => normalizeSubscriptionSourceEgressAllowlistEntry(entry))
    .filter((entry): entry is string => Boolean(entry));

  return {
    allowedHosts: [...new Set(allowedHosts)]
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

  if (isBlockedSubscriptionSourceRemoteHost(url.hostname)) {
    throw new Error('subscription source host is not allowed for remote fetch');
  }

  if (!isSubscriptionSourceHostAllowedByEgressPolicy(url.hostname, egressPolicy)) {
    throw new Error('subscription source host is not in the egress allowlist');
  }

  await assertSubscriptionSourceResolvedHostAllowed(url, hostResolver);

  return url.toString();
}

function normalizeSubscriptionSourceEgressAllowlistEntry(entry: string) {
  const trimmed = entry.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes('://')) {
    try {
      return normalizeRemoteHostname(new URL(trimmed).hostname);
    } catch {
      return normalizeRemoteHostname(trimmed);
    }
  }

  return normalizeRemoteHostname(trimmed);
}

function isSubscriptionSourceHostAllowedByEgressPolicy(
  hostname: string,
  egressPolicy: SubscriptionSourceEgressPolicy
) {
  if (egressPolicy.allowedHosts.length === 0) {
    return true;
  }

  const normalized = normalizeRemoteHostname(hostname);

  return egressPolicy.allowedHosts.some((allowedHost) => {
    if (allowedHost.startsWith('*.')) {
      const suffix = allowedHost.slice(1);
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }

    if (allowedHost.startsWith('.')) {
      return normalized.endsWith(allowedHost) && normalized.length > allowedHost.length;
    }

    return normalized === allowedHost;
  });
}

async function assertSubscriptionSourceResolvedHostAllowed(
  url: URL,
  hostResolver: SubscriptionSourceHostResolver
) {
  const normalized = normalizeRemoteHostname(url.hostname);

  if (isIP(normalized) !== 0) {
    return;
  }

  let resolvedAddresses: SubscriptionSourceResolvedAddress[];

  try {
    resolvedAddresses = await hostResolver(normalized);
  } catch {
    throw new Error('subscription source host could not be resolved for remote fetch');
  }

  if (resolvedAddresses.length === 0) {
    throw new Error('subscription source host could not be resolved for remote fetch');
  }

  if (resolvedAddresses.some((record) => isBlockedSubscriptionSourceRemoteHost(record.address))) {
    throw new Error('subscription source resolved host is not allowed for remote fetch');
  }
}

function normalizeRemoteHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function parseIpv4Octets(hostname: string) {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)));

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}

function parseIpv6SideHextets(side: string) {
  if (side === '') {
    return [];
  }

  const hextets: number[] = [];

  for (const part of side.split(':')) {
    if (part === '') {
      return undefined;
    }

    if (part.includes('.')) {
      const octets = parseIpv4Octets(part);

      if (!octets) {
        return undefined;
      }

      hextets.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    hextets.push(Number.parseInt(part, 16));
  }

  return hextets;
}

function parseIpv6Hextets(hostname: string) {
  if (isIP(hostname) !== 6) {
    return undefined;
  }

  const compressedParts = hostname.split('::');

  if (compressedParts.length > 2) {
    return undefined;
  }

  const head = parseIpv6SideHextets(compressedParts[0] ?? '');
  const tail = compressedParts.length === 2 ? parseIpv6SideHextets(compressedParts[1] ?? '') : [];

  if (!head || !tail) {
    return undefined;
  }

  if (compressedParts.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const missingHextets = 8 - head.length - tail.length;

  if (missingHextets < 1) {
    return undefined;
  }

  return [...head, ...Array.from({ length: missingHextets }, () => 0), ...tail];
}

function isBlockedIpv4Host(hostname: string) {
  const octets = parseIpv4Octets(hostname);

  if (!octets) {
    return false;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function readIpv6EmbeddedIpv4Host(hextets: number[]) {
  const seventh = hextets[6] ?? 0;
  const eighth = hextets[7] ?? 0;

  return [
    (seventh >> 8) & 0xff,
    seventh & 0xff,
    (eighth >> 8) & 0xff,
    eighth & 0xff
  ].join('.');
}

function isBlockedIpv6Host(hostname: string) {
  const hextets = parseIpv6Hextets(hostname);

  if (!hextets) {
    return false;
  }

  const firstHextet = hextets[0] ?? 0;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  const isIpv4Compatible = hextets.slice(0, 6).every((hextet) => hextet === 0);

  if (isIpv4Mapped || isIpv4Compatible) {
    return isBlockedIpv4Host(readIpv6EmbeddedIpv4Host(hextets));
  }

  const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
  const isMulticast = (firstHextet & 0xff00) === 0xff00;

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast;
}

function isBlockedSubscriptionSourceRemoteHost(hostname: string) {
  const normalized = normalizeRemoteHostname(hostname);

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isBlockedIpv4Host(normalized) ||
    isBlockedIpv6Host(normalized)
  );
}

function readContentLengthBytes(response: Response) {
  const contentLength = response.headers.get('content-length');

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function createSubscriptionSourceBodyLimitError(maxBodyBytes: number) {
  return new Error(`remote response exceeds ${maxBodyBytes} bytes`);
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
  hostResolver: SubscriptionSourceHostResolver,
  egressPolicy: SubscriptionSourceEgressPolicy,
  policy: SubscriptionSourceFetchPolicy
): Promise<FetchedSubscriptionSourceContent> {
  const controller = new AbortController();
  const remoteUrl = await withSubscriptionSourceFetchTimeout(
    normalizeSubscriptionSourceUrl(source, hostResolver, egressPolicy),
    controller,
    policy.timeoutMs
  );
  const response = await withSubscriptionSourceFetchTimeout(
    fetcher(remoteUrl, {
      headers: {
        Accept:
          source.kind === 'v2ray-uri'
            ? 'text/plain,*/*'
            : source.kind === 'sing-box'
              ? 'application/json,text/json,text/plain,*/*'
              : 'text/yaml,application/yaml,text/plain,*/*',
        'User-Agent': source.userAgent || 'OU-UI-Next/1.0'
      },
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
  externalNodes: SubscriptionInventoryNode[]
): SubscriptionClientIdentity {
  return projectSubscriptionClientRuntimeState({
    client,
    inbounds,
    externalNodes
  }).client;
}

function projectSubscriptionClientReadModels(
  clients: SubscriptionClientIdentity[],
  inbounds: XrayInbound[],
  externalNodes: SubscriptionInventoryNode[]
) {
  return clients.map((client) => projectSubscriptionClientReadModel(client, inbounds, externalNodes));
}

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  inventory = {},
  fetcher = fetch,
  subscriptionSourceHostResolver = defaultSubscriptionSourceHostResolver,
  subscriptionSourceFetch,
  subscriptionSourceEgress,
  readModelNow = () => new Date().toISOString()
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  const subscriptionSourceFetchPolicy = normalizeSubscriptionSourceFetchPolicy(subscriptionSourceFetch);
  const subscriptionSourceEgressPolicy = normalizeSubscriptionSourceEgressPolicy(subscriptionSourceEgress);
  let subscriptionSources = clone(inventory.subscriptionSources ?? []);
  let subscriptionInventoryNodes = clone(inventory.subscriptionInventoryNodes ?? []);
  let subscriptionClients = clone(inventory.subscriptionClients ?? []);
  let subscriptionExportProfiles = clone(inventory.subscriptionExportProfiles ?? []);
  let agents = clone(inventory.agents ?? []);
  let inbounds = clone(inventory.inbounds ?? []);
  let forwardRulesReadModel: Awaited<ReturnType<ControlPlaneRepository['listForwardRules']>> | undefined;
  let persistedTaskReadModelsHydrated = false;
  let persistedSubscriptionInventoryHydrated = false;
  const deletedAgentIds = new Set<string>();

  async function appendStandaloneAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
    const existingLogs = await repository.listAuditLogs();
    const auditWithPrevHash = {
      ...auditLog,
      prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
    };

    await transaction.insertAuditLog({
      ...auditWithPrevHash,
      hash: createAuditIntegrityHash(auditWithPrevHash)
    });
  }

  async function listForwardRuleReadModel() {
    if (!forwardRulesReadModel) {
      forwardRulesReadModel = clone(await repository.listForwardRules());
    }

    return clone(forwardRulesReadModel);
  }

  async function hydrateAgentReadModelFromRuntimeCredentials() {
    const credentials = await service.listAgentCredentials();
    const sessions = await repository.listAgentSessions();
    let nextAgents = agents;

    for (const credential of credentials) {
      if (credential.purpose !== 'runtime' || credential.status !== 'active') {
        continue;
      }

      if (deletedAgentIds.has(credential.agentId)) {
        continue;
      }

      if (nextAgents.some((agent) => agent.id === credential.agentId)) {
        continue;
      }

      const session = sessions.find(
        (item) => item.agentId === credential.agentId && (!credential.sessionId || item.sessionId === credential.sessionId)
      );
      nextAgents = [createAgentFromCredential(credential, session), ...nextAgents];
    }

    agents = nextAgents;
  }

  async function hydrateSubscriptionInventoryNodes() {
    if (persistedSubscriptionInventoryHydrated) {
      return;
    }

    const persistedNodes = await repository.listSubscriptionInventoryNodes();
    if (persistedNodes.length > 0) {
      const deletedSourceIds = new Set(
        (await repository.listTasks())
          .map(readSubscriptionSourceDeleteId)
          .filter((sourceId): sourceId is string => Boolean(sourceId))
      );
      subscriptionInventoryNodes =
        deletedSourceIds.size > 0
          ? persistedNodes.filter((node) => !deletedSourceIds.has(node.sourceId))
          : persistedNodes;
    }
    persistedSubscriptionInventoryHydrated = true;
  }

  async function hydrateReadModelsFromPersistedTasks() {
    if (persistedTaskReadModelsHydrated) {
      return;
    }

    await hydrateAgentReadModelFromRuntimeCredentials();

    const tasks = sortTasksForReadModelReplay(await repository.listTasks());
    const persistedSubscriptionSources = await repository.listSubscriptionSources();
    const persistedSubscriptionClients = await repository.listSubscriptionClients();
    const persistedSubscriptionExportProfiles = await repository.listSubscriptionExportProfiles();
    const hasPersistedSubscriptionSources = persistedSubscriptionSources.length > 0;
    const hasPersistedSubscriptionClients = persistedSubscriptionClients.length > 0;
    const hasPersistedSubscriptionExportProfiles = persistedSubscriptionExportProfiles.length > 0;
    let nextAgents = agents;
    let nextInbounds = inbounds;
    let nextSubscriptionSources = hasPersistedSubscriptionSources ? persistedSubscriptionSources : subscriptionSources;
    let nextSubscriptionClients = hasPersistedSubscriptionClients ? persistedSubscriptionClients : subscriptionClients;
    let nextSubscriptionExportProfiles = hasPersistedSubscriptionExportProfiles
      ? persistedSubscriptionExportProfiles
      : subscriptionExportProfiles;
    let nextForwardRules = await listForwardRuleReadModel();

    for (const task of tasks) {
      if (task.operation === 'agent.delete') {
        deletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
      }

      nextAgents = applyAgentTask(nextAgents, task);
      nextInbounds = applyXrayInboundTask(nextInbounds, task);
      if (!hasPersistedSubscriptionSources) {
        nextSubscriptionSources = applySubscriptionSourceTask(nextSubscriptionSources, task);
      }
      if (!hasPersistedSubscriptionClients) {
        nextSubscriptionClients = applySubscriptionClientTask(nextSubscriptionClients, task);
      }
      if (!hasPersistedSubscriptionExportProfiles) {
        nextSubscriptionExportProfiles = applySubscriptionExportProfileTask(nextSubscriptionExportProfiles, task);
      }
      nextForwardRules = applyForwardRuleTask(nextForwardRules, task);
    }

    for (const event of sortAgentEventsForReadModelReplay(await repository.listAgentEvents())) {
      if (deletedAgentIds.has(event.agentId)) {
        continue;
      }

      nextAgents = applyAgentEventToReadModel(nextAgents, event);
      nextInbounds = applyXrayTelemetryToReadModel(nextInbounds, event);
      nextForwardRules = applyForwardingTelemetryToReadModel(nextForwardRules, event);
    }

    agents = nextAgents;
    inbounds = nextInbounds;
    subscriptionSources = nextSubscriptionSources;
    subscriptionClients = nextSubscriptionClients;
    subscriptionExportProfiles = nextSubscriptionExportProfiles;
    forwardRulesReadModel = nextForwardRules;
    persistedTaskReadModelsHydrated = true;
  }

  return {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async getObservabilityMetrics() {
      const [tasks, commandOutbox, auditLogs] = await Promise.all([
        repository.listTasks(),
        repository.listCommandOutbox(),
        repository.listAuditLogs()
      ]);
      await hydrateReadModelsFromPersistedTasks();
      await hydrateAgentReadModelFromRuntimeCredentials();
      const liveAgents = applyAgentLivenessToReadModel(agents, readModelNow());
      const systemAlerts = createSystemAlertsFromAgents(liveAgents);

      return createObservabilityMetrics({
        generatedAt: readModelNow(),
        tasks,
        commandOutbox,
        agents: liveAgents,
        systemAlerts,
        audit: verifyAuditLogs(clone(auditLogs))
      });
    },

    async listAgents() {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateAgentReadModelFromRuntimeCredentials();
      return clone(applyAgentLivenessToReadModel(agents, readModelNow()));
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
      await hydrateSubscriptionInventoryNodes();
      return clone(subscriptionInventoryNodes);
    },

    async listSubscriptionBundles() {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateSubscriptionInventoryNodes();
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
      await hydrateSubscriptionInventoryNodes();
      return clone(
        projectSubscriptionClientReadModels(
          subscriptionClients,
          applyXrayTrafficWindowToReadModel(inbounds, readModelNow()),
          subscriptionInventoryNodes
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
      return clone(inventory.quotaPolicies ?? []);
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

    async listAgentCredentials() {
      return service.listAgentCredentials();
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

    async listTrafficRollups() {
      return repository.listTrafficRollups();
    },

    async listSystemAlerts() {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateAgentReadModelFromRuntimeCredentials();
      return createSystemAlertsFromAgents(applyAgentLivenessToReadModel(agents, readModelNow()));
    },

    async listAgentLogChunks(query) {
      return selectAgentLogChunks(await repository.listAgentEvents(), query);
    },

    async listAuditLogs() {
      return repository.listAuditLogs();
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? (await repository.listAuditLogs())));
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext) {
      return service.createAgentInstallCommand(input, resolveMutationContext(context));
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const credential = await service.registerAgent(input, installToken, context);
      await hydrateAgentReadModelFromRuntimeCredentials();
      return credential;
    },

    async revokeAgentCredential(credentialId, input, context?: MutationContext) {
      return service.revokeAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async rotateAgentCredential(credentialId, input, context?: MutationContext) {
      return service.rotateAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();

      const task = await service.createTask(input, resolveMutationContext(context));

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
        await hydrateSubscriptionInventoryNodes();
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
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      agents = applyAgentTask(agents, task);
      subscriptionClients = generatedSubscriptionClient
        ? [
            generatedSubscriptionClient,
            ...subscriptionClients.filter((client) => client.id !== generatedSubscriptionClient.id)
          ]
        : applySubscriptionClientTask(subscriptionClients, task);
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

      return task;
    },

    async syncSubscriptionSource(sourceId: string, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateSubscriptionInventoryNodes();

      const source = subscriptionSources.find((item) => item.id === sourceId);
      const syncedAt = new Date().toISOString();
      const mutationContext = resolveMutationContext(context);

      if (!source) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      assertSubscriptionSourceSyncAllowed(source, syncedAt);
      const auditBefore = {
        id: source.id,
        status: source.status,
        nodeCount: source.nodeCount,
        lastSyncAt: source.lastSyncAt,
        syncWarnings: source.syncWarnings ?? []
      };

      try {
        const response = await fetchSubscriptionSourceContent(
          source,
          fetcher,
          subscriptionSourceHostResolver,
          subscriptionSourceEgressPolicy,
          resolveSubscriptionSourceFetchPolicy(source, subscriptionSourceFetchPolicy)
        );
        const result = parseSubscriptionSourceContent({
          source,
          body: response.body,
          syncedAt,
          trafficHeader: response.trafficHeader
        });
        const crossSourceDuplicateCount = countCrossSourceSubscriptionInventoryDuplicates(
          result.nodes,
          subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId),
          source.dedupeKey
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
          syncWarnings: syncedResult.warnings
        });
        const syncedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (syncedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source,
            result: syncedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: syncedResult.status,
              nodeCount: syncedResult.nodeCount,
              syncedAt: syncedResult.syncedAt,
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
          syncWarnings: failedResult.warnings
        });
        const failedSource = nextSubscriptionSources.find((item) => item.id === sourceId);

        if (failedSource) {
          const auditLog = createSubscriptionSyncAuditLog({
            source,
            result: failedResult,
            context: mutationContext,
            before: auditBefore,
            after: {
              status: failedResult.status,
              nodeCount: failedResult.nodeCount,
              syncedAt: failedResult.syncedAt,
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

    async receiveAgentEvent(event: AgentEventEnvelope) {
      const result = await service.receiveAgentEvent(event);
      if (!deletedAgentIds.has(event.agentId)) {
        agents = applyAgentEventToReadModel(agents, event);
        inbounds = applyXrayTelemetryToReadModel(inbounds, event);
        forwardRulesReadModel = applyForwardingTelemetryToReadModel(await listForwardRuleReadModel(), event);
      }
      if (result) {
        forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), result);
      }
      return result;
    }
  };
}
