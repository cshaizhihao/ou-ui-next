import type { DeployTask } from './task';
import {
  dedupeSubscriptionInventoryNodes,
  selectSubscriptionInventoryNodes
} from './subscription-rules';

export type SubscriptionSourceKind = 'clash' | 'mihomo-provider' | 'v2ray-uri' | 'sing-box' | 'manual';

export type SubscriptionSourceStatus = 'synced' | 'syncing' | 'warning' | 'failed' | 'paused';

export type SubscriptionSource = {
  id: string;
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  providerAccountId?: string;
  status: SubscriptionSourceStatus;
  nodeCount: number;
  dedupeKey: 'server-port' | 'uuid' | 'name-region';
  lastSyncAt: string;
  rateLimitPerMinute: number;
  userAgent?: string;
  refreshIntervalMinutes?: number;
  fetchTimeoutSeconds?: number;
  maxBodyBytes?: number;
  includeFilter?: string;
  excludeFilter?: string;
  traffic?: SubscriptionTrafficSnapshot;
  syncBudget?: SubscriptionSourceSyncBudget;
  syncWarnings?: string[];
  syncLeaseOwnerId?: string;
  syncLeaseExpiresAt?: string;
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
  nodeIds?: string[];
};

export type SubscriptionExportProfile = {
  id: string;
  name: string;
  client: 'clash' | 'mihomo' | 'surge' | 'sing-box';
  sourceIds: string[];
  includeFilter: string;
  excludeFilter: string;
  regionFilter: string[];
  outputFormats: SubscriptionClientOutputFormat[];
  templateName: string;
  proxyGroups: ProxyGroupTemplate[];
  includeTrafficHeaders: boolean;
  updatedAt: string;
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

export type SubscriptionInventoryNodeStatus =
  | 'online'
  | 'warning'
  | 'disabled'
  | 'expired'
  | 'quota-exceeded'
  | 'applying'
  | 'error'
  | 'unknown';

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
  requestLimitPerHour: number;
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
  quotaResetAt?: string;
  quotaResetBaselineUsedTrafficBytes?: number;
  quotaExceeded?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
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
  status?: SubscriptionInventoryNodeStatus;
  customerName?: string;
  hostId?: string;
  hostName?: string;
  usedTrafficBytes?: number;
  trafficLimitBytes?: number;
  expiresAt?: string;
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
  subscriptionClientId: string;
  exportProfileId?: string;
  exportProfileName?: string;
  subId: string;
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

export type SubscriptionSourceSyncBudget = {
  maxFetchesPerDay?: number;
  maxBytesPerDay?: number;
  windowStartedAt: string;
  windowEndsAt: string;
  usedFetches: number;
  usedBytes: number;
  lastFetchBytes?: number;
  lastRecordedAt?: string;
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
const subscriptionExportProfileClients: SubscriptionExportProfile['client'][] = ['clash', 'mihomo', 'surge', 'sing-box'];
const proxyGroupStrategies: ProxyGroupTemplate['strategy'][] = ['select', 'url-test', 'fallback', 'load-balance'];
const defaultSubscriptionBundleId = 'sub-global-premium';

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

function readExportProfileClient(metadata: Record<string, unknown> | undefined): SubscriptionExportProfile['client'] {
  const client = readString(metadata, 'client', 'mihomo');
  return subscriptionExportProfileClients.includes(client as SubscriptionExportProfile['client'])
    ? (client as SubscriptionExportProfile['client'])
    : 'mihomo';
}

function readExportProfileOutputFormats(metadata: Record<string, unknown> | undefined): SubscriptionClientOutputFormat[] {
  const outputFormats = readStringArray(metadata, 'outputFormats', ['mihomo', 'clash']).filter(
    (format): format is SubscriptionClientOutputFormat =>
      subscriptionClientOutputFormats.includes(format as SubscriptionClientOutputFormat)
  );

  return outputFormats.length > 0 ? outputFormats : ['mihomo', 'clash'];
}

function readProxyGroupStrategy(value: unknown): ProxyGroupTemplate['strategy'] {
  return typeof value === 'string' && proxyGroupStrategies.includes(value as ProxyGroupTemplate['strategy'])
    ? (value as ProxyGroupTemplate['strategy'])
    : 'select';
}

function readProxyGroups(metadata: Record<string, unknown> | undefined): ProxyGroupTemplate[] {
  const value = metadata?.proxyGroups;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): ProxyGroupTemplate | undefined => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const group = item as Record<string, unknown>;
      const name = typeof group.name === 'string' && group.name.trim() ? group.name.trim() : `Proxy Group ${index + 1}`;
      const id =
        typeof group.id === 'string' && group.id.trim()
          ? group.id.trim()
          : `proxy-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || index + 1}`;

      return {
        id,
        name,
        strategy: readProxyGroupStrategy(group.strategy),
        filterTags: Array.isArray(group.filterTags)
          ? group.filterTags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map((tag) => tag.trim())
          : [],
        nodeIds: Array.isArray(group.nodeIds)
          ? group.nodeIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim())
          : undefined
      };
    })
    .filter((group): group is ProxyGroupTemplate => Boolean(group));
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

function createUtcDayWindow(nowIso: string) {
  const nowMs = Date.parse(nowIso);
  const date = new Date(Number.isNaN(nowMs) ? Date.now() : nowMs);
  const windowStartedAtMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  return {
    windowStartedAt: new Date(windowStartedAtMs).toISOString(),
    windowEndsAt: new Date(windowStartedAtMs + 24 * 60 * 60 * 1000).toISOString()
  };
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
  const fetchTimeoutSeconds = Math.max(Math.round(readNumber(metadata, 'fetchTimeoutSeconds', 0)), 0);
  const maxBodyBytes = Math.max(Math.round(readNumber(metadata, 'maxBodyBytes', 0)), 0);
  const providerAccountId = readString(metadata, 'providerAccountId', '');
  const syncBudgetMaxFetchesPerDay = Math.max(Math.round(readNumber(metadata, 'syncBudgetMaxFetchesPerDay', 0)), 0);
  const syncBudgetMaxBytesPerDay = Math.max(Math.round(readNumber(metadata, 'syncBudgetMaxBytesPerDay', 0)), 0);
  const syncBudget =
    syncBudgetMaxFetchesPerDay > 0 || syncBudgetMaxBytesPerDay > 0
      ? {
          ...(syncBudgetMaxFetchesPerDay > 0 ? { maxFetchesPerDay: syncBudgetMaxFetchesPerDay } : {}),
          ...(syncBudgetMaxBytesPerDay > 0 ? { maxBytesPerDay: syncBudgetMaxBytesPerDay } : {}),
          ...createUtcDayWindow(task.createdAt),
          usedFetches: 0,
          usedBytes: 0
        }
      : undefined;

  return {
    id: readString(metadata, 'sourceId', task.targetId),
    kind: readSourceKind(metadata),
    name: readString(metadata, 'name', task.targetLabel),
    url: readString(metadata, 'url', ''),
    ...(providerAccountId ? { providerAccountId } : {}),
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: readDedupeKey(metadata),
    lastSyncAt: task.createdAt,
    rateLimitPerMinute: refreshIntervalMinutes,
    userAgent: readString(metadata, 'userAgent', 'OU-UI-Next/1.0'),
    refreshIntervalMinutes,
    ...(fetchTimeoutSeconds > 0 ? { fetchTimeoutSeconds } : {}),
    ...(maxBodyBytes > 0 ? { maxBodyBytes } : {}),
    includeFilter: readString(metadata, 'includeFilter', ''),
    excludeFilter: readString(metadata, 'excludeFilter', ''),
    ...(syncBudget ? { syncBudget } : {}),
    syncWarnings: []
  };
}

export function readSubscriptionSourceDeleteId(task: DeployTask): string | undefined {
  if (task.operation !== 'subscription.delete') {
    return undefined;
  }

  const sourceId = readString(task.metadata, 'sourceId', '');

  if (sourceId) {
    return sourceId;
  }

  if (!readString(task.metadata, 'subscriptionClientId', '') && task.targetId.startsWith('source-')) {
    return task.targetId;
  }

  return undefined;
}

export function applySubscriptionSourceTask(sources: SubscriptionSource[], task: DeployTask) {
  const deletedSourceId = readSubscriptionSourceDeleteId(task);

  if (deletedSourceId) {
    return sources.filter((source) => source.id !== deletedSourceId);
  }

  const importedSubscriptionSource = createSubscriptionSourceFromTask(task);

  if (!importedSubscriptionSource) {
    return sources;
  }

  return [
    importedSubscriptionSource,
    ...sources.filter((source) => source.id !== importedSubscriptionSource.id)
  ];
}

export function createProxyProvidersFromSources(sources: SubscriptionSource[]): ProxyProviderConfig[] {
  return sources.map((source) => ({
    id: `provider-${source.id}`,
    name: `${source.name} Provider`,
    externalSubscriptionId: source.id,
    filter: source.includeFilter || (source.kind === 'manual' ? 'manual|owned' : 'premium|streaming'),
    excludeFilter: source.excludeFilter ?? 'expired|test',
    geoIpFilter: 'CN,HK,SG,JP,US,EU',
    processMode: source.kind === 'manual' ? 'client' : 'server',
    overrideRule: `source:${source.id};dedupe:${source.dedupeKey}`
  }));
}

function mapSubscriptionSourceStatus(status: SubscriptionSourceStatus): SubscriptionBundle['sources'][number]['status'] {
  if (status === 'synced') return 'ok';
  if (status === 'failed') return 'failed';
  return 'warning';
}

function scoreSubscriptionSourceStatus(status: SubscriptionSourceStatus) {
  if (status === 'synced') return 100;
  if (status === 'syncing') return 80;
  if (status === 'warning') return 65;
  if (status === 'paused') return 50;
  return 15;
}

function calculateSubscriptionBundleHealthScore(sources: SubscriptionSource[]) {
  if (sources.length === 0) {
    return 0;
  }

  return Math.round(
    sources.reduce((total, source) => total + scoreSubscriptionSourceStatus(source.status), 0) / sources.length
  );
}

function mapSubscriptionOutputFormatToExportTarget(format: SubscriptionClientOutputFormat) {
  if (format === 'sing-box') return 'Sing-box';
  if (format === 'clash' || format === 'mihomo') return 'Clash';
  return undefined;
}

function mapSubscriptionProfileClientToExportTarget(client: SubscriptionExportProfile['client']) {
  if (client === 'sing-box') return 'Sing-box';
  if (client === 'surge') return 'Surge';
  return 'Clash';
}

function createSubscriptionBundleExportTargets(profiles: SubscriptionExportProfile[]) {
  const targets = new Set<SubscriptionBundle['exportTargets'][number]>();

  for (const profile of profiles) {
    targets.add(mapSubscriptionProfileClientToExportTarget(profile.client));

    for (const format of profile.outputFormats) {
      const target = mapSubscriptionOutputFormatToExportTarget(format);
      if (target) {
        targets.add(target);
      }
    }
  }

  return targets.size > 0 ? [...targets] : (['Clash', 'Sing-box'] as SubscriptionBundle['exportTargets']);
}

function selectBundleNodes(
  inventoryNodes: SubscriptionInventoryNode[],
  profile?: SubscriptionExportProfile
) {
  if (!profile) {
    return dedupeSubscriptionInventoryNodes(inventoryNodes, 'server-port');
  }

  return dedupeSubscriptionInventoryNodes(
    selectSubscriptionInventoryNodes(inventoryNodes, {
      sourceIds: profile.sourceIds,
      includeFilter: profile.includeFilter,
      excludeFilter: profile.excludeFilter,
      regionFilter: profile.regionFilter,
      sortStrategy: 'latency'
    }),
    'server-port'
  );
}

function createBundleSourceRows(sources: SubscriptionSource[], inventoryNodes: SubscriptionInventoryNode[]) {
  return sources.map((source) => {
    const inventoryNodeCount = inventoryNodes.filter((node) => node.sourceId === source.id).length;

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      nodeCount: inventoryNodeCount > 0 ? inventoryNodeCount : source.nodeCount,
      lastSyncAt: source.lastSyncAt,
      status: mapSubscriptionSourceStatus(source.status)
    };
  });
}

function selectBundleSources(sources: SubscriptionSource[], profile?: SubscriptionExportProfile) {
  if (!profile || profile.sourceIds.length === 0) {
    return sources;
  }

  const sourceIds = new Set(profile.sourceIds);
  return sources.filter((source) => sourceIds.has(source.id));
}

function createProfileBundleStrategy(profile: SubscriptionExportProfile): SubscriptionBundle['strategy'] {
  if (profile.proxyGroups.some((group) => group.strategy === 'url-test' || group.strategy === 'fallback')) {
    return 'latency';
  }

  if (profile.proxyGroups.some((group) => group.strategy === 'load-balance')) {
    return 'balanced';
  }

  return profile.sourceIds.length > 0 || profile.includeFilter || profile.regionFilter.length > 0 ? 'manual' : 'balanced';
}

export function createSubscriptionBundlesFromInventory(
  sources: SubscriptionSource[],
  inventoryNodes: SubscriptionInventoryNode[],
  exportProfiles: SubscriptionExportProfile[] = [],
  fallbackBundles: SubscriptionBundle[] = []
): SubscriptionBundle[] {
  if (sources.length === 0) {
    return fallbackBundles;
  }

  const createBundle = (
    id: string,
    name: string,
    bundleSources: SubscriptionSource[],
    profile?: SubscriptionExportProfile
  ): SubscriptionBundle | undefined => {
    if (bundleSources.length === 0) {
      return undefined;
    }

    const sourceIds = new Set(bundleSources.map((source) => source.id));
    const sourceNodes = inventoryNodes.filter((node) => sourceIds.has(node.sourceId));
    const nodes = selectBundleNodes(sourceNodes, profile);

    return {
      id,
      name,
      enabled: true,
      strategy: profile ? createProfileBundleStrategy(profile) : 'balanced',
      sources: createBundleSourceRows(bundleSources, sourceNodes),
      exportTargets: createSubscriptionBundleExportTargets(profile ? [profile] : exportProfiles),
      dedupe: true,
      healthScore: calculateSubscriptionBundleHealthScore(bundleSources),
      generatedNodeCount: nodes.length
    };
  };

  const globalBundle = createBundle(defaultSubscriptionBundleId, 'Global Premium Aggregation', sources);
  const profileBundles = exportProfiles
    .map((profile) =>
      createBundle(`sub-bundle-${profile.id}`, profile.name, selectBundleSources(sources, profile), profile)
    )
    .filter((bundle): bundle is SubscriptionBundle => Boolean(bundle));

  return [globalBundle, ...profileBundles].filter((bundle): bundle is SubscriptionBundle => Boolean(bundle));
}

export function createSubscriptionExportFilesFromClients(
  clients: SubscriptionClientIdentity[],
  providers: ProxyProviderConfig[],
  exportProfiles: SubscriptionExportProfile[] = []
): SubscriptionExportFile[] {
  return clients.flatMap((client) => {
    const profiles = exportProfiles.filter((profile) => profile.templateName === client.templateName);
    const fileProfiles = profiles.length > 0 ? profiles : [undefined];

    return fileProfiles.map((profile) => {
      const sourceIds = profile?.sourceIds.length ? profile.sourceIds : client.sourceIds;
      const selectedProviderIds =
        sourceIds.length > 0
          ? providers
              .filter((provider) => sourceIds.includes(provider.externalSubscriptionId))
              .map((provider) => provider.id)
          : providers.map((provider) => provider.id);

      return {
        id: profile ? `export-${client.id}-${profile.id}` : `export-${client.id}`,
        subscriptionClientId: client.id,
        exportProfileId: profile?.id,
        exportProfileName: profile?.name,
        subId: client.subId,
        name: profile ? `${client.displayName} - ${profile.name} Export` : `${client.displayName} Export`,
        templateName: profile?.templateName ?? client.templateName,
        selectedTags: client.selectedTags,
        selectedProviderIds,
        formats: client.formats,
        trafficLimitBytes: client.trafficLimitBytes,
        expiresAt: client.expiresAt,
        accessTokenPreview: client.accessTokenPreview
      };
    });
  });
}

function sameStringSet(left: string[], right: string[]) {
  const normalizeSet = (values: string[]) => values.map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  const normalizedLeft = normalizeSet(left);
  const normalizedRight = normalizeSet(right);

  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function selectSubscriptionExportProfileForClient(
  profiles: SubscriptionExportProfile[],
  client: SubscriptionClientIdentity,
  format?: SubscriptionClientOutputFormat
) {
  const candidates = profiles.filter(
    (profile) =>
      profile.templateName === client.templateName && (!format || profile.outputFormats.length === 0 || profile.outputFormats.includes(format))
  );

  if (candidates.length <= 1) {
    return candidates[0];
  }

  const exactSourceMatches = candidates.filter((profile) => sameStringSet(profile.sourceIds, client.sourceIds));

  return exactSourceMatches.length === 1 ? exactSourceMatches[0] : undefined;
}

export function createSubscriptionExportProfileFromTask(task: DeployTask): SubscriptionExportProfile | undefined {
  if (task.operation !== 'subscription.profile.upsert') {
    return undefined;
  }

  const metadata = task.metadata;
  const id = readString(metadata, 'profileId', task.targetId);
  const outputFormats = readExportProfileOutputFormats(metadata);

  return {
    id,
    name: readString(metadata, 'name', task.targetLabel),
    client: readExportProfileClient(metadata),
    sourceIds: readStringArray(metadata, 'sourceIds'),
    includeFilter: readString(metadata, 'includeFilter', ''),
    excludeFilter: readString(metadata, 'excludeFilter', ''),
    regionFilter: readStringArray(metadata, 'regionFilter'),
    outputFormats,
    templateName: readString(metadata, 'templateName', `${outputFormats[0] ?? 'mihomo'}-compatible.yaml`),
    proxyGroups: readProxyGroups(metadata),
    includeTrafficHeaders: readBoolean(metadata, 'includeTrafficHeaders', true),
    updatedAt: task.createdAt
  };
}

export function readSubscriptionExportProfileDeleteId(task: DeployTask): string | undefined {
  if (task.operation !== 'subscription.profile.delete') {
    return undefined;
  }

  return readString(task.metadata, 'profileId', task.targetId);
}

export function applySubscriptionExportProfileTask(profiles: SubscriptionExportProfile[], task: DeployTask) {
  const deletedProfileId = readSubscriptionExportProfileDeleteId(task);

  if (deletedProfileId) {
    return profiles.filter((profile) => profile.id !== deletedProfileId);
  }

  const profile = createSubscriptionExportProfileFromTask(task);

  if (!profile) {
    return profiles;
  }

  return [profile, ...profiles.filter((item) => item.id !== profile.id)];
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
  const guardrailReason = readString(metadata, 'guardrailReason', '');

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
    requestLimitPerHour: Math.max(Math.round(readNumber(metadata, 'requestLimitPerHour', 360)), 0),
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
    lastGeneratedAt: task.createdAt,
    quotaExceeded: readBoolean(metadata, 'quotaExceeded', false),
    runtimeDisabledByPolicy: readBoolean(metadata, 'runtimeDisabledByPolicy', false),
    guardrailReason: guardrailReason || undefined
  };
}

export function applySubscriptionClientTask(clients: SubscriptionClientIdentity[], task: DeployTask) {
  if (task.operation === 'subscription.delete') {
    const sourceId = readSubscriptionSourceDeleteId(task);

    if (sourceId) {
      return clients;
    }

    return clients.filter((client) => client.id !== readString(task.metadata, 'subscriptionClientId', task.targetId));
  }

  const nextClient = createSubscriptionClientFromTask(task);

  if (!nextClient) {
    return clients;
  }

  return [nextClient, ...clients.filter((client) => client.id !== nextClient.id)];
}
