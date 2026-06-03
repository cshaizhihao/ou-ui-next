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

export type SubscriptionClientFormat = 'plain' | 'json' | 'clash';

export type SubscriptionClientIdentity = {
  id: string;
  subId: string;
  email: string;
  enabled: boolean;
  protocol: string;
  group: string;
  trafficLimitBytes: number;
  usedTrafficBytes: number;
  expiresAt: string;
  ipLimit: number;
  selectedTags: string[];
  routingRule: string;
  formats: SubscriptionClientFormat[];
  lastOnlineAt?: string;
};

export type SubscriptionInventoryNode = {
  id: string;
  sourceId: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
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
