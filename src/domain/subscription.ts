import type { DeployTask } from './task';

export type SubscriptionSourceKind = 'clash' | 'mihomo-provider' | 'v2ray-uri' | 'sing-box' | 'manual';

export type SubscriptionSourceStatus = 'synced' | 'syncing' | 'warning' | 'failed' | 'paused';

export type SubscriptionSource = {
  id: string;
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  status: SubscriptionSourceStatus;
  nodeCount: number;
  dedupeKey: 'server-port' | 'uuid' | 'name-region';
  lastSyncAt: string;
  rateLimitPerMinute: number;
  userAgent?: string;
  refreshIntervalMinutes?: number;
  includeFilter?: string;
  excludeFilter?: string;
};

export type SubscriptionNode = {
  id: string;
  sourceId: string;
  name: string;
  protocol: string;
  region: string;
  latencyMs: number;
  tags: string[];
};

export type ProxyGroupTemplate = {
  id: string;
  name: string;
  strategy: 'select' | 'url-test' | 'fallback' | 'load-balance';
  filterTags: string[];
};

export type SubscriptionExportProfile = {
  id: string;
  name: string;
  client: 'clash' | 'mihomo' | 'surge' | 'sing-box';
  proxyGroups: ProxyGroupTemplate[];
  includeTrafficHeaders: boolean;
};

export type SubscriptionAccessToken = {
  id: string;
  profileId: string;
  tokenPreview: string;
  expiresAt: string;
  requestLimitPerHour: number;
};

export type SubscriptionClientFormat = 'plain' | 'json' | 'clash' | 'mihomo' | 'sing-box';

export type SubscriptionClientOutputFormat = 'clash' | 'mihomo' | 'v2ray' | 'sing-box' | 'uri';

export type SubscriptionClientSortStrategy = 'latency' | 'name' | 'region' | 'manual';

export type SubscriptionClientIdentity = {
  id: string;
  customerName?: string;
  ruleName?: string;
  displayName: string;
  subId: string;
  email: string;
  enabled: boolean;
  protocol: string;
  group: string;
  trafficLimitBytes: number;
  usedTrafficBytes: number;
  expiresAt: string;
  ipLimit: number;
  sourceIds: string[];
  selectedTags: string[];
  includeFilter: string;
  excludeFilter: string;
  regionFilter: string[];
  routingRule: string;
  maxLatencyMs: number;
  sortStrategy: SubscriptionClientSortStrategy;
  formats: SubscriptionClientFormat[];
  outputFormats?: SubscriptionClientOutputFormat[];
  templateName: string;
  accessTokenPreview: string;
  securePathPreview?: string;
  generatedNodeCount: number;
  lastOnlineAt?: string;
  lastGeneratedAt?: string;
};

export type SubscriptionInventoryNode = {
  id: string;
  sourceId: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
  latencyMs: number;
  tags: string[];
  rawUrl?: string;
  clashConfig?: Record<string, unknown>;
  inboundTag?: string;
  probeAgentId?: string;
};

export type ProxyProviderConfig = {
  id: string;
  name: string;
  externalSubscriptionId: string;
  filter: string;
  excludeFilter: string;
  geoIpFilter: string;
  processMode: 'client' | 'server';
  overrideRule: string;
};

export type SubscriptionExportFile = {
  id: string;
  name: string;
  templateName: string;
  selectedTags: string[];
  selectedProviderIds: string[];
  formats: SubscriptionClientFormat[];
  trafficLimitBytes: number;
  expiresAt: string;
  accessTokenPreview: string;
};

export type SubscriptionTrafficSnapshot = {
  sourceId: string;
  uploadBytes: number;
  downloadBytes: number;
  totalBytes: number;
  expiresAt?: string;
};

export type SubscriptionSourceSyncResult = {
  sourceId: string;
  status: SubscriptionSourceStatus;
  nodeCount: number;
  syncedAt: string;
  nodes: SubscriptionInventoryNode[];
  traffic?: SubscriptionTrafficSnapshot;
  warnings: string[];
};

export type SubscriptionBundle = {
  id: string;
  name: string;
  enabled: boolean;
  strategy: 'latency' | 'region' | 'cost' | 'balanced' | 'manual';
  sources: Array<{
    id: string;
    name: string;
    url: string;
    nodeCount: number;
    lastSyncAt: string;
    status: 'ok' | 'warning' | 'failed';
  }>;
  exportTargets: Array<'Clash' | 'Surge' | 'Sing-box'>;
  dedupe: boolean;
  healthScore: number;
  generatedNodeCount: number;
};

const subscriptionSourceKinds: SubscriptionSourceKind[] = ['clash', 'mihomo-provider', 'v2ray-uri', 'sing-box', 'manual'];
const subscriptionDedupeKeys: SubscriptionSource['dedupeKey'][] = ['server-port', 'uuid', 'name-region'];
const subscriptionClientFormats: SubscriptionClientFormat[] = ['plain', 'json', 'clash', 'mihomo', 'sing-box'];
const subscriptionClientOutputFormats: SubscriptionClientOutputFormat[] = ['clash', 'mihomo', 'v2ray', 'sing-box', 'uri'];
const subscriptionClientSortStrategies: SubscriptionClientSortStrategy[] = ['latency', 'name', 'region', 'manual'];

function readString(metadata: Record<string, unknown> | undefined, key: string, fallback: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function readNumber(metadata: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = metadata?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function readBoolean(metadata: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(metadata: Record<string, unknown> | undefined, key: string, fallback: string[] = []) {
  const value = metadata?.[key];

  if (Array.isArray(value)) {
    const next = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    return next.length > 0 ? next.map((item) => item.trim()) : fallback;
  }

  if (typeof value === 'string') {
    const next = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return next.length > 0 ? next : fallback;
  }

  return fallback;
}

function bytesFromGb(gb: number) {
  return Math.max(Number.isFinite(gb) ? gb : 0, 0) * 1024 * 1024 * 1024;
}

function readSourceKind(metadata: Record<string, unknown> | undefined): SubscriptionSourceKind {
  const kind = readString(metadata, 'kind', 'clash');
  return subscriptionSourceKinds.includes(kind as SubscriptionSourceKind) ? (kind as SubscriptionSourceKind) : 'clash';
}

function readDedupeKey(metadata: Record<string, unknown> | undefined): SubscriptionSource['dedupeKey'] {
  const dedupeKey = readString(metadata, 'dedupeKey', 'server-port');
  return subscriptionDedupeKeys.includes(dedupeKey as SubscriptionSource['dedupeKey'])
    ? (dedupeKey as SubscriptionSource['dedupeKey'])
    : 'server-port';
}

function readClientFormats(metadata: Record<string, unknown> | undefined): SubscriptionClientFormat[] {
  const formats = readStringArray(metadata, 'formats', ['plain', 'clash']).filter((format): format is SubscriptionClientFormat =>
    subscriptionClientFormats.includes(format as SubscriptionClientFormat)
  );

  return formats.length > 0 ? formats : ['plain', 'clash'];
}

function readClientOutputFormats(metadata: Record<string, unknown> | undefined): SubscriptionClientOutputFormat[] {
  const formats = readStringArray(metadata, 'outputFormats').filter((format): format is SubscriptionClientOutputFormat =>
    subscriptionClientOutputFormats.includes(format as SubscriptionClientOutputFormat)
  );

  return formats.length > 0 ? formats : [];
}

function readClientSortStrategy(metadata: Record<string, unknown> | undefined): SubscriptionClientSortStrategy {
  const sortStrategy = readString(metadata, 'sortStrategy', 'latency');
  return subscriptionClientSortStrategies.includes(sortStrategy as SubscriptionClientSortStrategy)
    ? (sortStrategy as SubscriptionClientSortStrategy)
    : 'latency';
}

function expiresAtFromTask(task: DeployTask, remainingDays: number) {
  const baseMs = Date.parse(task.createdAt);
  return new Date((Number.isNaN(baseMs) ? Date.now() : baseMs) + Math.max(remainingDays, 0) * 24 * 60 * 60 * 1000).toISOString();
}

function createAccessTokenPreview(subId: string) {
  const normalized = subId.replace(/[^a-zA-Z0-9]/g, '').padEnd(10, '0');
  return `sub_${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function createStableSecret(seed: string, length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let hash = 2166136261;
  let output = '';

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  for (let index = 0; index < length; index += 1) {
    hash = Math.imul(hash ^ (index + 31), 1103515245) + 12345;
    output += alphabet[Math.abs(hash) % alphabet.length];
  }

  return output;
}

function readSecurePathPreview(metadata: Record<string, unknown> | undefined, task: DeployTask, subId: string) {
  const value = readString(metadata, 'securePathPreview', '');

  if (/^\/[A-Za-z0-9]{16,64}$/.test(value)) {
    return value;
  }

  return `/${createStableSecret(`${task.id}:${task.requestId}:${subId}:secure-path`, 24)}`;
}

export function createSubscriptionSourceFromTask(task: DeployTask): SubscriptionSource | undefined {
  if (task.operation !== 'subscription.import') {
    return undefined;
  }

  const metadata = task.metadata;
  const refreshIntervalMinutes = Math.max(Math.round(readNumber(metadata, 'refreshIntervalMinutes', 60)), 1);

  return {
    id: readString(metadata, 'sourceId', task.targetId),
    kind: readSourceKind(metadata),
    name: readString(metadata, 'name', task.targetLabel),
    url: readString(metadata, 'url', ''),
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: readDedupeKey(metadata),
    lastSyncAt: task.createdAt,
    rateLimitPerMinute: refreshIntervalMinutes,
    userAgent: readString(metadata, 'userAgent', 'OU-UI-Next/1.0'),
    refreshIntervalMinutes,
    includeFilter: readString(metadata, 'includeFilter', ''),
    excludeFilter: readString(metadata, 'excludeFilter', '')
  };
}

export function createSubscriptionClientFromTask(task: DeployTask): SubscriptionClientIdentity | undefined {
  if (task.operation !== 'subscription.generate' && task.operation !== 'subscription.export') {
    return undefined;
  }

  const metadata = task.metadata;

  if (!metadata || (!metadata.subscriptionClientId && !metadata.subId && !metadata.displayName)) {
    return undefined;
  }

  const subId = readString(metadata, 'subId', task.targetId);
  const remainingDays = readNumber(metadata, 'remainingDays', 30);
  const selectedTags = readStringArray(metadata, 'selectedTags');
  const regionFilter = readStringArray(metadata, 'regionFilter');

  return {
    id: readString(metadata, 'subscriptionClientId', task.targetId),
    customerName: readString(metadata, 'customerName', ''),
    ruleName: readString(metadata, 'ruleName', readString(metadata, 'displayName', task.targetLabel)),
    displayName: readString(metadata, 'displayName', task.targetLabel),
    subId,
    email: readString(metadata, 'email', ''),
    enabled: readBoolean(metadata, 'enabled', true),
    protocol: readString(metadata, 'protocol', readString(metadata, 'xrayProtocol', 'vless')),
    group: readString(metadata, 'group', 'default'),
    trafficLimitBytes: bytesFromGb(readNumber(metadata, 'trafficLimitGb', 0)),
    usedTrafficBytes: bytesFromGb(readNumber(metadata, 'usedTrafficGb', 0)),
    expiresAt: expiresAtFromTask(task, remainingDays),
    ipLimit: Math.max(Math.round(readNumber(metadata, 'ipLimit', 0)), 0),
    sourceIds: readStringArray(metadata, 'sourceIds'),
    selectedTags,
    includeFilter: readString(metadata, 'includeFilter', ''),
    excludeFilter: readString(metadata, 'excludeFilter', ''),
    regionFilter,
    routingRule: readString(metadata, 'routingRule', ''),
    maxLatencyMs: Math.max(Math.round(readNumber(metadata, 'maxLatencyMs', 0)), 0),
    sortStrategy: readClientSortStrategy(metadata),
    formats: readClientFormats(metadata),
    outputFormats: readClientOutputFormats(metadata),
    templateName: readString(metadata, 'templateName', 'mihomo-compatible.yaml'),
    accessTokenPreview: readString(metadata, 'accessTokenPreview', createAccessTokenPreview(subId)),
    securePathPreview: readSecurePathPreview(metadata, task, subId),
    generatedNodeCount: Math.max(Math.round(readNumber(metadata, 'generatedNodeCount', 0)), 0),
    lastOnlineAt: readString(metadata, 'lastOnlineAt', ''),
    lastGeneratedAt: task.createdAt
  };
}

export function applySubscriptionClientTask(clients: SubscriptionClientIdentity[], task: DeployTask) {
  if (task.operation === 'subscription.delete') {
    return clients.filter((client) => client.id !== task.targetId);
  }

  const nextClient = createSubscriptionClientFromTask(task);

  if (!nextClient) {
    return clients;
  }

  return [nextClient, ...clients.filter((client) => client.id !== nextClient.id)];
}
