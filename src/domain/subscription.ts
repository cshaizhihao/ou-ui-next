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
