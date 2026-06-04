import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Download, FileSliders, Layers3, Pencil, Plus, RefreshCcw, Shuffle, Trash2 } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import { applySubscriptionSourceRules, selectSubscriptionInventoryNodes } from '../../domain';
import type {
  ProxyGroupTemplate,
  ProxyProviderConfig,
  SubscriptionBundle,
  SubscriptionClientFormat,
  SubscriptionClientIdentity,
  SubscriptionClientSortStrategy,
  SubscriptionExportFile,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceKind,
  XrayProtocol
} from '../../domain';
import { formatBytes, formatDateTime, formatNumber } from '../shared/format';

export type { SubscriptionBundle };

type SubscriptionMixerPageProps = {
  subscriptions: SubscriptionBundle[];
  subscriptionSources: SubscriptionSource[];
  subscriptionInventoryNodes: SubscriptionInventoryNode[];
  subscriptionClients: SubscriptionClientIdentity[];
  subscriptionExportProfiles: SubscriptionExportProfile[];
  proxyProviders: ProxyProviderConfig[];
  subscriptionExportFiles: SubscriptionExportFile[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onImportSource: (metadata: SubscriptionSourceImportMetadata) => boolean | Promise<boolean>;
  onSyncSource: (source: SubscriptionSource) => boolean | Promise<boolean>;
  onDeleteSource: (source: SubscriptionSource) => boolean | Promise<boolean>;
  onSaveClient: (metadata: SubscriptionClientRuleMetadata, action: 'create' | 'update') => void;
  onDeleteClient: (metadata: SubscriptionClientRuleMetadata) => void;
  onSaveExportProfile: (metadata: SubscriptionExportProfileMetadata, action: 'create' | 'update') => void;
  onDeleteExportProfile: (metadata: SubscriptionExportProfileMetadata) => void;
  onGenerateExportFile: (file: SubscriptionExportFile) => void;
};

export type SubscriptionSourceImportMetadata = {
  sourceId: string;
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  userAgent: string;
  refreshIntervalMinutes: number;
  includeFilter: string;
  excludeFilter: string;
  dedupeKey: SubscriptionSource['dedupeKey'];
  syncPolicy: {
    userAgent: string;
    refreshIntervalMinutes: number;
  };
  sourceRule: {
    includeFilter: string;
    excludeFilter: string;
    dedupeKey: SubscriptionSource['dedupeKey'];
  };
};

export type SubscriptionClientOutputFormat = 'clash' | 'mihomo' | 'v2ray' | 'sing-box' | 'uri';

export type SubscriptionExportProfileMetadata = {
  profileId: string;
  name: string;
  client: SubscriptionExportProfile['client'];
  sourceIds: string[];
  includeFilter: string;
  excludeFilter: string;
  regionFilter: string[];
  outputFormats: SubscriptionClientOutputFormat[];
  templateName: string;
  proxyGroups: ProxyGroupTemplate[];
  includeTrafficHeaders: boolean;
};

export type SubscriptionClientRuleMetadata = {
  subscriptionClientId: string;
  customerName: string;
  ruleName: string;
  displayName: string;
  subId: string;
  email: string;
  protocol: XrayProtocol;
  group: string;
  trafficLimitGb: number;
  usedTrafficGb: number;
  remainingDays: number;
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
  outputFormats: SubscriptionClientOutputFormat[];
  templateName: string;
  enabled: boolean;
  generatedNodeCount: number;
  accessTokenPreview: string;
  securePathPreview: string;
  subscriptionUrlPreview: Record<SubscriptionClientOutputFormat, string>;
  clientRule: {
    protocolFilter: XrayProtocol;
    sourceIds: string[];
    tagFilter: string[];
    regionFilter: string[];
    includeFilter: string;
    excludeFilter: string;
    routingRule: string;
    maxLatencyMs: number;
    sortStrategy: SubscriptionClientSortStrategy;
    outputFormats: SubscriptionClientOutputFormat[];
    trafficConstraint: {
      limitGb: number;
      usedGb: number;
      remainingDays: number;
      ipLimit: number;
      requestLimitPerHour: number;
    };
    access: {
      subId: string;
      tokenPreview: string;
      securePathPreview: string;
    };
  };
};

type Workspace = 'clients' | 'sources' | 'inventory' | 'providers' | 'profiles' | 'exports';
type DrawerState = { type: 'closed' } | { type: 'client'; id?: string } | { type: 'source' } | { type: 'profile'; id?: string };

type ClientDraft = {
  subscriptionClientId: string;
  customerName: string;
  displayName: string;
  subId: string;
  securePathPreview: string;
  email: string;
  protocol: XrayProtocol;
  group: string;
  trafficLimitGb: string;
  usedTrafficGb: string;
  remainingDays: string;
  ipLimit: string;
  requestLimitPerHour: string;
  sourceIds: string[];
  selectedTags: string;
  includeFilter: string;
  excludeFilter: string;
  regionFilter: string;
  routingRule: string;
  maxLatencyMs: string;
  sortStrategy: SubscriptionClientSortStrategy;
  formats: SubscriptionClientFormat[];
  templateName: string;
  enabled: boolean;
};

type SourceDraft = {
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  userAgent: string;
  refreshInterval: string;
  includeFilter: string;
  excludeFilter: string;
  dedupeKey: SubscriptionSource['dedupeKey'];
};

type ExportProfileDraft = {
  profileId: string;
  name: string;
  client: SubscriptionExportProfile['client'];
  sourceIds: string[];
  includeFilter: string;
  excludeFilter: string;
  regionFilter: string;
  outputFormats: SubscriptionClientOutputFormat[];
  templateName: string;
  proxyGroupName: string;
  proxyGroupStrategy: ProxyGroupTemplate['strategy'];
  proxyGroupFilterTags: string;
  includeTrafficHeaders: boolean;
};

const copy = {
  zh: {
    title: '节点订阅',
    subtitle: '按 3X-UI 的客户订阅身份和 miaomiaowu 的订阅链路拆分：订阅身份、外部订阅源、节点库存、代理集合和导出文件独立维护。',
    clientsTab: '订阅身份',
    sourcesTab: '外部订阅源',
    inventoryTab: '节点库存',
    providersTab: '代理集合',
    exportsTab: '导出文件',
    addClient: '新增订阅身份',
    importSource: '导入订阅源',
    clientCount: '订阅身份',
    inventoryCount: '库存节点',
    exportCount: '导出文件',
    clientTitle: '客户订阅规则',
    clientHint: '订阅身份以 subId 为入口，聚合客户可见节点、协议、流量、到期、IP 限制和输出格式。',
    customerName: '客户名称',
    displayName: '规则名称',
    subId: 'Sub ID',
    email: '客户 Email',
    protocol: '协议',
    group: '分组',
    trafficLimit: '流量上限',
    usedTraffic: '已用流量',
    expires: '到期',
    ipLimit: 'IP 限制',
    requestLimit: '每小时请求上限',
    selectedTags: '节点标签',
    sourceScope: '可见订阅源',
    allSources: '全部订阅源',
    includeFilter: '包含关键字',
    regionFilter: '地区过滤',
    maxLatency: '最大延迟',
    sortStrategy: '排序策略',
    templateName: '导出模板',
    routingRule: '规则表达式',
    formats: '输出格式',
    enabled: '启用',
    disabled: '停用',
    actions: '操作',
    edit: '编辑',
    delete: '删除',
    syncNow: '立即同步',
    save: '保存',
    cancel: '取消',
    preview: '订阅地址预览',
    securePath: '安全路径',
    outputFormat: '输出格式',
    syncPolicy: '同步策略',
    dedupePolicy: '去重策略',
    protocolFilter: '协议过滤',
    noClients: '暂无订阅身份',
    sourceName: '订阅源',
    sourceUrl: '源地址',
    sourceStatus: '状态',
    sourceNodes: '节点数',
    sourceTraffic: '源流量',
    lastSync: '同步时间',
    noSources: '暂无外部订阅源',
    nodeName: '节点名称',
    server: '服务器',
    tags: '标签',
    origin: '来源',
    noInventory: '暂无节点库存',
    providerName: '代理集合',
    filter: '包含过滤',
    excludeFilter: '排除过滤',
    processMode: '处理模式',
    overrideRule: '覆盖规则',
    noProviders: '暂无代理集合',
    exportName: '导出文件',
    template: '模板',
    accessToken: '访问令牌',
    generate: '生成',
    noExports: '暂无导出文件',
    unitGb: 'GB',
    unitDays: '天',
    sourceDrawerTitle: '导入外部订阅源',
    sourceDrawerHint: '源会先登记为外部订阅，再同步进节点库存，之后由代理集合和导出文件引用。',
    sourceKind: '源类型',
    sourceDisplayName: '源名称',
    userAgent: 'User-Agent',
    refreshInterval: '刷新间隔',
    sourceDedupe: '去重策略',
    matchedNodes: '命中节点'
  },
  en: {
    title: 'Node Subscriptions',
    subtitle: 'Split subscriptions into 3X-UI-style client identities and miaomiaowu-style source, inventory, provider, and export-file layers.',
    clientsTab: 'Identities',
    sourcesTab: 'External Sources',
    inventoryTab: 'Node Inventory',
    providersTab: 'Proxy Providers',
    exportsTab: 'Export Files',
    addClient: 'Add Identity',
    importSource: 'Import Source',
    clientCount: 'Identities',
    inventoryCount: 'Inventory Nodes',
    exportCount: 'Export Files',
    clientTitle: 'Client Subscription Rules',
    clientHint: 'Each subId aggregates visible nodes, protocol, quota, expiry, IP limits, routing rules, and output formats.',
    customerName: 'Customer Name',
    displayName: 'Rule Name',
    subId: 'Sub ID',
    email: 'Client Email',
    protocol: 'Protocol',
    group: 'Group',
    trafficLimit: 'Traffic Limit',
    usedTraffic: 'Used Traffic',
    expires: 'Expires',
    ipLimit: 'IP Limit',
    requestLimit: 'Hourly Request Limit',
    selectedTags: 'Node Tags',
    sourceScope: 'Visible Sources',
    allSources: 'All Sources',
    includeFilter: 'Include Keywords',
    regionFilter: 'Region Filter',
    maxLatency: 'Max Latency',
    sortStrategy: 'Sort Strategy',
    templateName: 'Export Template',
    routingRule: 'Rule Expression',
    formats: 'Formats',
    enabled: 'Enabled',
    disabled: 'Disabled',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    syncNow: 'Sync Now',
    save: 'Save',
    cancel: 'Cancel',
    preview: 'Subscription URL Preview',
    securePath: 'Secure Path',
    outputFormat: 'Output Format',
    syncPolicy: 'Sync Policy',
    dedupePolicy: 'Dedupe Policy',
    protocolFilter: 'Protocol Filter',
    noClients: 'No subscription identities yet',
    sourceName: 'Source',
    sourceUrl: 'Source URL',
    sourceStatus: 'Status',
    sourceNodes: 'Nodes',
    sourceTraffic: 'Source Traffic',
    lastSync: 'Last Sync',
    noSources: 'No external sources yet',
    nodeName: 'Node Name',
    server: 'Server',
    tags: 'Tags',
    origin: 'Source',
    noInventory: 'No inventory nodes yet',
    providerName: 'Proxy Provider',
    filter: 'Include Filter',
    excludeFilter: 'Exclude Filter',
    processMode: 'Process Mode',
    overrideRule: 'Override Rule',
    noProviders: 'No proxy providers yet',
    exportName: 'Export File',
    template: 'Template',
    accessToken: 'Access Token',
    generate: 'Generate',
    noExports: 'No export files yet',
    unitGb: 'GB',
    unitDays: 'days',
    sourceDrawerTitle: 'Import External Source',
    sourceDrawerHint: 'Sources are registered first, synchronized into inventory, then referenced by proxy providers and export files.',
    sourceKind: 'Source Kind',
    sourceDisplayName: 'Source Name',
    userAgent: 'User-Agent',
    refreshInterval: 'Refresh Interval',
    sourceDedupe: 'Dedupe Strategy',
    matchedNodes: 'Matched Nodes'
  }
} as const;

const profileCopy = {
  zh: {
    tab: '导出配置',
    add: '新增导出配置',
    drawerTitle: '编辑导出配置',
    noProfiles: '暂无导出配置',
    profileName: '配置名称',
    profileClient: '客户端类型',
    outputFormats: '输出格式',
    proxyGroups: '代理组',
    includeTrafficHeaders: '流量头',
    proxyGroupName: '代理组名称',
    proxyGroupStrategy: '代理组策略',
    proxyGroupTags: '代理组标签',
    sourceScope: '可见订阅源',
    allSources: '全部订阅源'
  },
  en: {
    tab: 'Export Profiles',
    add: 'Add Profile',
    drawerTitle: 'Edit Export Profile',
    noProfiles: 'No export profiles yet',
    profileName: 'Profile Name',
    profileClient: 'Client Type',
    outputFormats: 'Output Formats',
    proxyGroups: 'Proxy Groups',
    includeTrafficHeaders: 'Traffic Headers',
    proxyGroupName: 'Proxy Group Name',
    proxyGroupStrategy: 'Proxy Group Strategy',
    proxyGroupTags: 'Proxy Group Tags',
    sourceScope: 'Visible Sources',
    allSources: 'All Sources'
  }
} as const;

function createDefaultClientDraft(): ClientDraft {
  return {
    subscriptionClientId: '',
    customerName: '香港 Premium 客户',
    displayName: '香港 Premium 订阅规则',
    subId: 'sub_hkg_premium_01',
    securePathPreview: createSecurePathPreview(),
    email: 'client@example.com',
    protocol: 'vless',
    group: 'premium',
    trafficLimitGb: '1024',
    usedTrafficGb: '128',
    remainingDays: '30',
    ipLimit: '3',
    requestLimitPerHour: '360',
    sourceIds: [],
    selectedTags: 'hk,premium,streaming',
    includeFilter: '香港|HK|Premium',
    excludeFilter: 'test|expired',
    regionFilter: 'hk',
    routingRule: 'tag:hk AND tag:premium',
    maxLatencyMs: '200',
    sortStrategy: 'latency',
    formats: ['clash', 'mihomo', 'json', 'sing-box', 'plain'],
    templateName: 'mihomo-compatible.yaml',
    enabled: true
  };
}

function createDefaultExportProfileDraft(): ExportProfileDraft {
  return {
    profileId: '',
    name: 'Mihomo Premium Profile',
    client: 'mihomo',
    sourceIds: [],
    includeFilter: 'premium|streaming',
    excludeFilter: 'expired|test',
    regionFilter: 'hk,sg,jp',
    outputFormats: ['mihomo', 'clash', 'uri'],
    templateName: 'mihomo-compatible.yaml',
    proxyGroupName: 'Premium Auto',
    proxyGroupStrategy: 'url-test',
    proxyGroupFilterTags: 'premium,streaming',
    includeTrafficHeaders: true
  };
}

function createDraftFromExportProfile(profile: SubscriptionExportProfile): ExportProfileDraft {
  const firstGroup = profile.proxyGroups[0];

  return {
    profileId: profile.id,
    name: profile.name,
    client: profile.client,
    sourceIds: profile.sourceIds,
    includeFilter: profile.includeFilter,
    excludeFilter: profile.excludeFilter,
    regionFilter: profile.regionFilter.join(','),
    outputFormats: profile.outputFormats.length > 0 ? profile.outputFormats : ['mihomo', 'clash'],
    templateName: profile.templateName,
    proxyGroupName: firstGroup?.name ?? 'Premium Auto',
    proxyGroupStrategy: firstGroup?.strategy ?? 'url-test',
    proxyGroupFilterTags: firstGroup?.filterTags.join(',') ?? '',
    includeTrafficHeaders: profile.includeTrafficHeaders
  };
}

function createExportProfileMetadataFromDraft(draft: ExportProfileDraft): SubscriptionExportProfileMetadata {
  const profileName = draft.name.trim() || 'Mihomo Premium Profile';
  const proxyGroupName = draft.proxyGroupName.trim() || profileName;

  return {
    profileId: draft.profileId,
    name: profileName,
    client: draft.client,
    sourceIds: draft.sourceIds,
    includeFilter: draft.includeFilter.trim(),
    excludeFilter: draft.excludeFilter.trim(),
    regionFilter: splitComma(draft.regionFilter),
    outputFormats: draft.outputFormats.length > 0 ? draft.outputFormats : ['mihomo', 'clash'],
    templateName: draft.templateName.trim() || `${draft.client}-compatible.yaml`,
    proxyGroups: [
      {
        id: `proxy-group-${proxyGroupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default'}`,
        name: proxyGroupName,
        strategy: draft.proxyGroupStrategy,
        filterTags: splitComma(draft.proxyGroupFilterTags)
      }
    ],
    includeTrafficHeaders: draft.includeTrafficHeaders
  };
}

function splitComma(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const clientFormatOptions = [
  { value: 'clash', outputFormat: 'clash', label: { zh: 'Clash', en: 'Clash' } },
  { value: 'mihomo', outputFormat: 'mihomo', label: { zh: 'Mihomo', en: 'Mihomo' } },
  { value: 'json', outputFormat: 'v2ray', label: { zh: 'V2Ray', en: 'V2Ray' } },
  { value: 'sing-box', outputFormat: 'sing-box', label: { zh: 'Sing-box', en: 'Sing-box' } },
  { value: 'plain', outputFormat: 'uri', label: { zh: 'URI', en: 'URI' } }
] as const satisfies Array<{
  value: SubscriptionClientFormat;
  outputFormat: SubscriptionClientOutputFormat;
  label: Record<AppLanguage, string>;
}>;

const legacyFormatLabels: Partial<Record<SubscriptionClientFormat, Record<AppLanguage, string>>> = {};

function createPreviewSecret(seed: string, length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  let value = Math.abs(hash);
  let output = '';

  for (let index = 0; index < length; index += 1) {
    value = Math.imul(value ^ (index + 17), 1103515245) + 12345;
    output += alphabet[Math.abs(value) % alphabet.length];
  }

  return output;
}

function createRandomSecret(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    let value = Date.now();

    for (let index = 0; index < length; index += 1) {
      value = Math.imul(value ^ (index + 29), 1103515245) + 12345;
      bytes[index] = Math.abs(value) % alphabet.length;
    }
  }

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function createAccessTokenPreview(subId: string) {
  const token = createPreviewSecret(`${subId}:token`, 18);
  return `ou_${token.slice(0, 6)}...${token.slice(-4)}`;
}

function createSecurePathPreview() {
  return `/${createRandomSecret(24)}`;
}

function mapClientFormatToOutputFormat(format: SubscriptionClientFormat): SubscriptionClientOutputFormat {
  return clientFormatOptions.find((option) => option.value === format)?.outputFormat ?? 'uri';
}

function getClientFormatLabel(format: SubscriptionClientFormat, language: AppLanguage) {
  return clientFormatOptions.find((option) => option.value === format)?.label[language] ?? legacyFormatLabels[format]?.[language] ?? format;
}

function createOutputFormats(formats: SubscriptionClientFormat[]) {
  const outputFormats = formats.map(mapClientFormatToOutputFormat);
  return Array.from(new Set(outputFormats));
}

function formatSourceSyncWarning(warning: string, language: AppLanguage) {
  const duplicateMatch = /^subscription_source\.cross_source_duplicates:(\d+)$/.exec(warning);

  if (duplicateMatch) {
    const count = Number(duplicateMatch[1]);
    return language === 'zh'
      ? `跨源重复节点 ${formatNumber(count, language)} 个`
      : `${formatNumber(count, language)} cross-source duplicates`;
  }

  if (warning.startsWith('subscription_source.sync_failed:')) {
    return language === 'zh' ? '同步失败，请检查订阅源' : 'Sync failed; check the source';
  }

  if (warning === 'subscription_source.empty_or_unsupported') {
    return language === 'zh' ? '未解析到可用节点' : 'No usable nodes parsed';
  }

  if (warning === 'subscription_source.mock_sync_has_no_remote_fetch') {
    return language === 'zh' ? '模拟模式未远程抓取' : 'Mock mode did not fetch remotely';
  }

  return language === 'zh' ? '同步告警' : 'Sync warning';
}

function createClientMetadataFromDraft(
  draft: ClientDraft,
  generatedNodeCount: number,
  existingId?: string
): SubscriptionClientRuleMetadata {
  const remainingDays = Math.max(Number.parseInt(draft.remainingDays, 10) || 0, 0);
  const trafficLimitGb = Math.max(Number.parseInt(draft.trafficLimitGb, 10) || 0, 0);
  const usedTrafficGb = Math.max(Number.parseInt(draft.usedTrafficGb, 10) || 0, 0);
  const subId = draft.subId.trim() || 'manual';
  const customerName = draft.customerName.trim() || draft.email.trim() || '默认客户';
  const displayName = draft.displayName.trim() || `${customerName} 订阅规则`;
  const selectedTags = splitComma(draft.selectedTags);
  const regionFilter = splitComma(draft.regionFilter);
  const maxLatencyMs = Math.max(Number.parseInt(draft.maxLatencyMs, 10) || 0, 0);
  const requestLimitPerHour = Math.max(Number.parseInt(draft.requestLimitPerHour, 10) || 0, 0);
  const outputFormats = createOutputFormats(draft.formats);
  const accessTokenPreview = createAccessTokenPreview(subId);
  const securePathPreview = draft.securePathPreview || createSecurePathPreview();
  const subscriptionUrls = buildSubscriptionUrls({ ...draft, securePathPreview });

  return {
    subscriptionClientId: existingId || draft.subscriptionClientId || `sub-client-${Date.now()}`,
    customerName,
    ruleName: displayName,
    displayName,
    subId,
    email: draft.email.trim() || 'client@example.com',
    protocol: draft.protocol,
    group: draft.group.trim() || 'default',
    trafficLimitGb,
    usedTrafficGb,
    remainingDays,
    ipLimit: Math.max(Number.parseInt(draft.ipLimit, 10) || 0, 0),
    requestLimitPerHour,
    sourceIds: draft.sourceIds,
    selectedTags,
    includeFilter: draft.includeFilter.trim(),
    excludeFilter: draft.excludeFilter.trim(),
    regionFilter,
    routingRule: draft.routingRule.trim(),
    maxLatencyMs,
    sortStrategy: draft.sortStrategy,
    formats: draft.formats,
    outputFormats,
    templateName: draft.templateName.trim() || 'mihomo-compatible.yaml',
    enabled: draft.enabled,
    generatedNodeCount,
    accessTokenPreview,
    securePathPreview,
    subscriptionUrlPreview: {
      clash: subscriptionUrls.clash,
      mihomo: subscriptionUrls.mihomo,
      v2ray: subscriptionUrls.json,
      'sing-box': subscriptionUrls['sing-box'],
      uri: subscriptionUrls.plain
    },
    clientRule: {
      protocolFilter: draft.protocol,
      sourceIds: draft.sourceIds,
      tagFilter: selectedTags,
      regionFilter,
      includeFilter: draft.includeFilter.trim(),
      excludeFilter: draft.excludeFilter.trim(),
      routingRule: draft.routingRule.trim(),
      maxLatencyMs,
      sortStrategy: draft.sortStrategy,
      outputFormats,
      trafficConstraint: {
        limitGb: trafficLimitGb,
        usedGb: usedTrafficGb,
        remainingDays,
        ipLimit: Math.max(Number.parseInt(draft.ipLimit, 10) || 0, 0),
        requestLimitPerHour
      },
      access: {
        subId,
        tokenPreview: accessTokenPreview,
        securePathPreview
      }
    }
  };
}

function createDraftFromClient(client: SubscriptionClientIdentity): ClientDraft {
  const remainingMs = Math.max(Date.parse(client.expiresAt) - Date.now(), 0);

  return {
    subscriptionClientId: client.id,
    customerName: client.customerName ?? client.displayName,
    displayName: client.displayName,
    subId: client.subId,
    securePathPreview: client.securePathPreview || createSecurePathPreview(),
    email: client.email,
    protocol: client.protocol as XrayProtocol,
    group: client.group,
    trafficLimitGb: String(Math.round(client.trafficLimitBytes / 1024 / 1024 / 1024)),
    usedTrafficGb: String(Math.round(client.usedTrafficBytes / 1024 / 1024 / 1024)),
    remainingDays: String(Math.ceil(remainingMs / 24 / 60 / 60 / 1000)),
    ipLimit: String(client.ipLimit),
    requestLimitPerHour: String(client.requestLimitPerHour ?? 360),
    sourceIds: client.sourceIds,
    selectedTags: client.selectedTags.join(','),
    includeFilter: client.includeFilter,
    excludeFilter: client.excludeFilter,
    regionFilter: client.regionFilter.join(','),
    routingRule: client.routingRule,
    maxLatencyMs: String(client.maxLatencyMs),
    sortStrategy: client.sortStrategy,
    formats: client.formats,
    templateName: client.templateName,
    enabled: client.enabled
  };
}

function mapBundleSources(subscriptions: SubscriptionBundle[]): SubscriptionSource[] {
  return subscriptions.flatMap((bundle) =>
    bundle.sources.map((source) => ({
      id: source.id,
      kind: 'clash' as const,
      name: source.name,
      url: source.url,
      status: source.status === 'ok' ? 'synced' : source.status,
      nodeCount: source.nodeCount,
      dedupeKey: 'server-port' as const,
      lastSyncAt: source.lastSyncAt,
      rateLimitPerMinute: 60
    }))
  );
}

function mergeSubscriptionSources(...sourceGroups: SubscriptionSource[][]) {
  const sourcesById = new Map<string, SubscriptionSource>();

  sourceGroups.flat().forEach((source) => {
    if (!sourcesById.has(source.id)) {
      sourcesById.set(source.id, source);
    }
  });

  return Array.from(sourcesById.values());
}

function createDefaultSourceDraft(): SourceDraft {
  return {
    kind: 'clash',
    name: '香港 Premium 外部订阅',
    url: 'https://provider.example.com/sub.yaml',
    userAgent: 'OU-UI-Next/1.0',
    refreshInterval: '60',
    includeFilter: 'premium|streaming',
    excludeFilter: 'expired|test',
    dedupeKey: 'server-port'
  };
}

function createSourceFromDraft(draft: SourceDraft): SubscriptionSource {
  const refreshIntervalMinutes = Math.max(Number.parseInt(draft.refreshInterval, 10) || 60, 1);

  return {
    id: `source-${Date.now()}`,
    kind: draft.kind,
    name: draft.name.trim() || 'Manual Source',
    url: draft.url.trim() || 'https://provider.example.com/sub.yaml',
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: draft.dedupeKey,
    lastSyncAt: new Date().toISOString(),
    rateLimitPerMinute: refreshIntervalMinutes,
    userAgent: draft.userAgent.trim() || 'OU-UI-Next/1.0',
    refreshIntervalMinutes,
    includeFilter: draft.includeFilter.trim(),
    excludeFilter: draft.excludeFilter.trim()
  };
}

function buildSubscriptionUrls(draft: ClientDraft) {
  const subId = encodeURIComponent(draft.subId.trim() || 'manual');
  const securePath = draft.securePathPreview || createSecurePathPreview();
  const query = new URLSearchParams();

  if (draft.selectedTags.trim()) {
    query.set('tags', draft.selectedTags.trim());
  }

  if (draft.routingRule.trim()) {
    query.set('rule', draft.routingRule.trim());
  }

  query.set('protocol', draft.protocol);
  query.set('template', draft.templateName.trim() || 'mihomo-compatible.yaml');
  const suffix = query.toString();
  const prefix = `/sub${securePath}`;

  return {
    plain: `${prefix}/uri/${subId}${suffix ? `?${suffix}` : ''}`,
    json: `${prefix}/v2ray/${subId}${suffix ? `?${suffix}` : ''}`,
    clash: `${prefix}/clash/${subId}${suffix ? `?${suffix}` : ''}`,
    mihomo: `${prefix}/mihomo/${subId}${suffix ? `?${suffix}` : ''}`,
    'sing-box': `${prefix}/sing-box/${subId}${suffix ? `?${suffix}` : ''}`
  } satisfies Record<SubscriptionClientFormat, string>;
}

function findMatchingInventoryNodes(nodes: SubscriptionInventoryNode[], draft: ClientDraft) {
  return selectSubscriptionInventoryNodes(nodes, {
    sourceIds: draft.sourceIds,
    selectedTags: splitComma(draft.selectedTags),
    includeFilter: draft.includeFilter,
    excludeFilter: draft.excludeFilter,
    regionFilter: splitComma(draft.regionFilter),
    routingRule: draft.routingRule,
    protocol: draft.protocol,
    maxLatencyMs: Math.max(Number.parseInt(draft.maxLatencyMs, 10) || 0, 0),
    sortStrategy: draft.sortStrategy
  });
}

export function SubscriptionMixerPage({
  subscriptions,
  subscriptionClients,
  subscriptionExportProfiles,
  subscriptionInventoryNodes,
  subscriptionSources,
  proxyProviders,
  subscriptionExportFiles,
  language,
  taskMutationBusy = false,
  onImportSource,
  onSyncSource,
  onDeleteSource,
  onSaveClient,
  onDeleteClient,
  onSaveExportProfile,
  onDeleteExportProfile,
  onGenerateExportFile
}: SubscriptionMixerPageProps) {
  const t = copy[language];
  const profileT = profileCopy[language];
  const clients = subscriptionClients;
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('clients');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [customSources, setCustomSources] = useState<SubscriptionSource[]>([]);
  const [clientDraft, setClientDraft] = useState<ClientDraft>(createDefaultClientDraft);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>(createDefaultSourceDraft);
  const [profileDraft, setProfileDraft] = useState<ExportProfileDraft>(createDefaultExportProfileDraft);
  const bundleSources = useMemo(() => mapBundleSources(subscriptions), [subscriptions]);
  const sources = useMemo(() => mergeSubscriptionSources(subscriptionSources, customSources, bundleSources), [
    bundleSources,
    customSources,
    subscriptionSources
  ]);
  const inventoryNodes = useMemo(
    () =>
      sources.flatMap((source) =>
        applySubscriptionSourceRules(subscriptionInventoryNodes.filter((node) => node.sourceId === source.id), {
          includeFilter: source.includeFilter,
          excludeFilter: source.excludeFilter,
          dedupeKey: source.dedupeKey
        })
      ),
    [sources, subscriptionInventoryNodes]
  );
  const providers = proxyProviders;
  const exportFiles = subscriptionExportFiles;
  const exportProfiles = subscriptionExportProfiles;
  const editingClient =
    drawer.type === 'client' && drawer.id ? subscriptionClients.find((client) => client.id === drawer.id) : undefined;
  const editingProfile =
    drawer.type === 'profile' && drawer.id ? subscriptionExportProfiles.find((profile) => profile.id === drawer.id) : undefined;
  const subscriptionUrls = buildSubscriptionUrls(clientDraft);
  const accessTokenPreview = createAccessTokenPreview(clientDraft.subId.trim() || 'manual');
  const securePathPreview = clientDraft.securePathPreview;
  const matchedInventoryNodes = useMemo(() => findMatchingInventoryNodes(inventoryNodes, clientDraft), [clientDraft, inventoryNodes]);

  function openClientDrawer(client?: SubscriptionClientIdentity) {
    setClientDraft(client ? createDraftFromClient(client) : createDefaultClientDraft());
    setDrawer({ type: 'client', id: client?.id });
  }

  function openProfileDrawer(profile?: SubscriptionExportProfile) {
    setProfileDraft(profile ? createDraftFromExportProfile(profile) : createDefaultExportProfileDraft());
    setDrawer({ type: 'profile', id: profile?.id });
  }

  function toggleFormat(format: SubscriptionClientFormat) {
    setClientDraft((current) => ({
      ...current,
      formats: current.formats.includes(format)
        ? current.formats.filter((item) => item !== format)
        : [...current.formats, format]
    }));
  }

  function toggleProfileOutputFormat(format: SubscriptionClientOutputFormat) {
    setProfileDraft((current) => ({
      ...current,
      outputFormats: current.outputFormats.includes(format)
        ? current.outputFormats.filter((item) => item !== format)
        : [...current.outputFormats, format]
    }));
  }

  function toggleClientSource(sourceId: string) {
    setClientDraft((current) => ({
      ...current,
      sourceIds: current.sourceIds.includes(sourceId)
        ? current.sourceIds.filter((item) => item !== sourceId)
        : [...current.sourceIds, sourceId]
    }));
  }

  function toggleProfileSource(sourceId: string) {
    setProfileDraft((current) => ({
      ...current,
      sourceIds: current.sourceIds.includes(sourceId)
        ? current.sourceIds.filter((item) => item !== sourceId)
        : [...current.sourceIds, sourceId]
    }));
  }

  function openSourceDrawer() {
    setSourceDraft(createDefaultSourceDraft());
    setDrawer({ type: 'source' });
  }

  function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSaveClient(createClientMetadataFromDraft(clientDraft, matchedInventoryNodes.length, editingClient?.id), editingClient ? 'update' : 'create');
    setDrawer({ type: 'closed' });
    setActiveWorkspace('clients');
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSaveExportProfile(createExportProfileMetadataFromDraft(profileDraft), editingProfile ? 'update' : 'create');
    setDrawer({ type: 'closed' });
    setActiveWorkspace('profiles');
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = createSourceFromDraft(sourceDraft);

    const accepted = await onImportSource({
      sourceId: nextSource.id,
      kind: sourceDraft.kind,
      name: nextSource.name,
      url: nextSource.url,
      userAgent: sourceDraft.userAgent.trim() || 'OU-UI-Next/1.0',
      refreshIntervalMinutes: nextSource.rateLimitPerMinute,
      includeFilter: sourceDraft.includeFilter.trim(),
      excludeFilter: sourceDraft.excludeFilter.trim(),
      dedupeKey: nextSource.dedupeKey,
      syncPolicy: {
        userAgent: sourceDraft.userAgent.trim() || 'OU-UI-Next/1.0',
        refreshIntervalMinutes: nextSource.rateLimitPerMinute
      },
      sourceRule: {
        includeFilter: sourceDraft.includeFilter.trim(),
        excludeFilter: sourceDraft.excludeFilter.trim(),
        dedupeKey: nextSource.dedupeKey
      }
    });

    if (!accepted) {
      return;
    }

    setCustomSources((current) => [nextSource, ...current]);
    setDrawer({ type: 'closed' });
    setActiveWorkspace('sources');
  }

  async function deleteSource(source: SubscriptionSource) {
    const accepted = await onDeleteSource(source);

    if (!accepted) {
      return;
    }

    setCustomSources((current) => current.filter((item) => item.id !== source.id));
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 island-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <WorkspaceButton active={activeWorkspace === 'clients'} label={t.clientsTab} onClick={() => setActiveWorkspace('clients')} />
            <WorkspaceButton active={activeWorkspace === 'sources'} label={t.sourcesTab} onClick={() => setActiveWorkspace('sources')} />
            <WorkspaceButton active={activeWorkspace === 'inventory'} label={t.inventoryTab} onClick={() => setActiveWorkspace('inventory')} />
            <WorkspaceButton active={activeWorkspace === 'providers'} label={t.providersTab} onClick={() => setActiveWorkspace('providers')} />
            <WorkspaceButton active={activeWorkspace === 'profiles'} label={profileT.tab} onClick={() => setActiveWorkspace('profiles')} />
            <WorkspaceButton active={activeWorkspace === 'exports'} label={t.exportsTab} onClick={() => setActiveWorkspace('exports')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={openSourceDrawer}>
              <Download className="h-3.5 w-3.5" />
              {t.importSource}
            </GlowButton>
            <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => openProfileDrawer()}>
              <FileSliders className="h-3.5 w-3.5" />
              {profileT.add}
            </GlowButton>
            <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => openClientDrawer()}>
              <Plus className="h-3.5 w-3.5" />
              {t.addClient}
            </GlowButton>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={Shuffle} label={t.clientCount} value={formatNumber(clients.length, language)} />
          <SummaryMetric icon={Layers3} label={t.inventoryCount} value={formatNumber(inventoryNodes.length, language)} />
          <SummaryMetric icon={FileSliders} label={profileT.tab} value={formatNumber(exportProfiles.length, language)} />
        </div>
      </section>

      {activeWorkspace === 'clients' ? (
        <DataSection title={t.clientTitle} hint={t.clientHint}>
          {clients.length === 0 ? (
            <EmptyState label={t.noClients} />
          ) : (
            <Table minWidth="980px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.subId}</th>
                  <th className="px-5 py-3">{t.email}</th>
                  <th className="px-5 py-3">{t.protocol}</th>
                  <th className="px-5 py-3">{t.trafficLimit}</th>
                  <th className="px-5 py-3">{t.selectedTags}</th>
                  <th className="px-5 py-3">{t.formats}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {clients.map((client) => (
                  <tr key={client.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{client.displayName}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-white/70">{client.customerName ?? client.email}</p>
                      <p className="mt-1 font-mono text-[11px] font-bold text-slate-500 dark:text-white/45">{client.subId}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                        {client.enabled ? t.enabled : t.disabled} / {client.group} / {formatNumber(client.generatedNodeCount, language)} {t.matchedNodes}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{client.email}</td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-bold uppercase text-slate-800 dark:text-white/80">{client.protocol}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">IP {client.ipLimit}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatNumber(client.requestLimitPerHour ?? 360, language)} req/h</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-semibold text-slate-700 dark:text-white/70">
                        {formatBytes(client.usedTrafficBytes)} / {formatBytes(client.trafficLimitBytes)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatDateTime(client.expiresAt, language)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <TagList tags={client.selectedTags} />
                    </td>
                    <td className="px-5 py-4">
                      <TagList tags={client.formats.map((format) => getClientFormatLabel(format, language))} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton label={t.edit} onClick={() => openClientDrawer(client)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          danger
                          label={t.delete}
                          onClick={() => onDeleteClient(createClientMetadataFromDraft(createDraftFromClient(client), client.generatedNodeCount, client.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'sources' ? (
        <DataSection title={t.sourcesTab}>
          {sources.length === 0 ? (
            <EmptyState label={t.noSources} />
          ) : (
            <Table minWidth="1120px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.sourceName}</th>
                  <th className="px-5 py-3">{t.sourceUrl}</th>
                  <th className="px-5 py-3">{t.syncPolicy}</th>
                  <th className="px-5 py-3">{t.dedupePolicy}</th>
                  <th className="px-5 py-3">{t.sourceNodes}</th>
                  <th className="px-5 py-3">{t.sourceTraffic}</th>
                  <th className="px-5 py-3">{t.lastSync}</th>
                  <th className="px-5 py-3">{t.sourceStatus}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {sources.map((source) => (
                  <tr key={source.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{source.name}</td>
                    <td className="px-5 py-4">
                      <p className="font-mono text-[11px] text-slate-500 dark:text-white/45">{source.url}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/35">{source.userAgent ?? 'OU-UI-Next/1.0'}</p>
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                      {formatNumber(source.refreshIntervalMinutes ?? source.rateLimitPerMinute, language)} min
                    </td>
                    <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{source.dedupeKey}</td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatNumber(source.nodeCount, language)}</td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                      {source.traffic ? (
                        <>
                          <p>
                            {formatBytes(source.traffic.uploadBytes + source.traffic.downloadBytes)}
                            {' / '}
                            {formatBytes(source.traffic.totalBytes)}
                          </p>
                          {source.traffic.expiresAt ? (
                            <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-white/40">
                              {t.expires}: {formatDateTime(source.traffic.expiresAt, language)}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatDateTime(source.lastSyncAt, language)}</td>
                    <td className="px-5 py-4 text-xs font-bold uppercase text-slate-500 dark:text-white/50">
                      <p>{source.status}</p>
                      {source.syncWarnings?.length ? (
                        <div className="mt-1 space-y-1 normal-case text-amber-600 dark:text-amber-300/80">
                          {source.syncWarnings.slice(0, 2).map((warning) => (
                            <p key={warning}>{formatSourceSyncWarning(warning, language)}</p>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton label={t.syncNow} onClick={() => void onSyncSource(source)}>
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton danger label={t.delete} onClick={() => void deleteSource(source)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'inventory' ? (
        <DataSection title={t.inventoryTab}>
          {inventoryNodes.length === 0 ? (
            <EmptyState label={t.noInventory} />
          ) : (
            <Table minWidth="860px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.nodeName}</th>
                  <th className="px-5 py-3">{t.protocol}</th>
                  <th className="px-5 py-3">{t.server}</th>
                  <th className="px-5 py-3">{t.tags}</th>
                  <th className="px-5 py-3">{t.origin}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {inventoryNodes.map((node) => (
                  <tr key={node.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{node.name}</td>
                    <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{node.protocol}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{node.server}:{node.port}</td>
                    <td className="px-5 py-4"><TagList tags={node.tags} /></td>
                    <td className="px-5 py-4 text-[11px] text-slate-500 dark:text-white/45">{node.sourceId}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'providers' ? (
        <DataSection title={t.providersTab}>
          {providers.length === 0 ? (
            <EmptyState label={t.noProviders} />
          ) : (
            <ProviderTable providers={providers} language={language} />
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'profiles' ? (
        <DataSection title={profileT.tab}>
          {exportProfiles.length === 0 ? (
            <EmptyState label={profileT.noProfiles} />
          ) : (
            <Table minWidth="980px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{profileT.profileName}</th>
                  <th className="px-5 py-3">{profileT.profileClient}</th>
                  <th className="px-5 py-3">{profileT.outputFormats}</th>
                  <th className="px-5 py-3">{profileT.proxyGroups}</th>
                  <th className="px-5 py-3">{t.filter}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {exportProfiles.map((profile) => (
                  <tr key={profile.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{profile.name}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{profile.templateName}</p>
                    </td>
                    <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{profile.client}</td>
                    <td className="px-5 py-4"><TagList tags={profile.outputFormats} /></td>
                    <td className="px-5 py-4">
                      <TagList tags={profile.proxyGroups.map((group) => `${group.name}:${group.strategy}`)} />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-[11px] text-slate-500 dark:text-white/45">{profile.includeFilter || '-'}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{profile.excludeFilter || '-'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton label={t.edit} onClick={() => openProfileDrawer(profile)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton danger label={t.delete} onClick={() => onDeleteExportProfile(createExportProfileMetadataFromDraft(createDraftFromExportProfile(profile)))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'exports' ? (
        <DataSection title={t.exportsTab}>
          {exportFiles.length === 0 ? (
            <EmptyState label={t.noExports} />
          ) : (
            <Table minWidth="900px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.exportName}</th>
                  <th className="px-5 py-3">{t.template}</th>
                  <th className="px-5 py-3">{t.tags}</th>
                  <th className="px-5 py-3">{t.trafficLimit}</th>
                  <th className="px-5 py-3">{t.accessToken}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {exportFiles.map((file) => (
                  <tr key={file.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{file.name}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{file.templateName}</td>
                    <td className="px-5 py-4"><TagList tags={file.selectedTags} /></td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatBytes(file.trafficLimitBytes)}</td>
                    <td className="px-5 py-4 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.accessTokenPreview}</td>
                    <td className="px-5 py-4 text-right">
                      <GlowButton
                        className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={taskMutationBusy}
                        onClick={() => onGenerateExportFile(file)}
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.generate}
                      </GlowButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      <ConfigDrawer
        open={drawer.type === 'client'}
        title={editingClient ? t.edit : t.addClient}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={saveClient}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.customerName} value={clientDraft.customerName} onChange={(value) => setClientDraft((current) => ({ ...current, customerName: value }))} />
            <InputField label={t.displayName} value={clientDraft.displayName} onChange={(value) => setClientDraft((current) => ({ ...current, displayName: value }))} />
            <InputField label={t.subId} value={clientDraft.subId} onChange={(value) => setClientDraft((current) => ({ ...current, subId: value }))} />
            <InputField label={t.email} value={clientDraft.email} onChange={(value) => setClientDraft((current) => ({ ...current, email: value }))} />
            <SelectField
              label={t.protocolFilter}
              value={clientDraft.protocol}
              onChange={(value) => setClientDraft((current) => ({ ...current, protocol: value as XrayProtocol }))}
              options={[
                { label: 'VLESS', value: 'vless' },
                { label: 'VMess', value: 'vmess' },
                { label: 'Trojan', value: 'trojan' },
                { label: 'Shadowsocks', value: 'shadowsocks' },
                { label: 'Hysteria', value: 'hysteria' }
              ]}
            />
            <InputField label={t.group} value={clientDraft.group} onChange={(value) => setClientDraft((current) => ({ ...current, group: value }))} />
            <InputField label={t.trafficLimit} suffix={t.unitGb} type="number" value={clientDraft.trafficLimitGb} onChange={(value) => setClientDraft((current) => ({ ...current, trafficLimitGb: value }))} />
            <InputField label={t.usedTraffic} suffix={t.unitGb} type="number" value={clientDraft.usedTrafficGb} onChange={(value) => setClientDraft((current) => ({ ...current, usedTrafficGb: value }))} />
            <InputField label={t.expires} suffix={t.unitDays} type="number" value={clientDraft.remainingDays} onChange={(value) => setClientDraft((current) => ({ ...current, remainingDays: value }))} />
            <InputField label={t.ipLimit} type="number" value={clientDraft.ipLimit} onChange={(value) => setClientDraft((current) => ({ ...current, ipLimit: value }))} />
            <InputField label={t.requestLimit} type="number" value={clientDraft.requestLimitPerHour} onChange={(value) => setClientDraft((current) => ({ ...current, requestLimitPerHour: value }))} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.sourceScope}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                <span className="text-xs font-bold text-slate-700 dark:text-white/70">{t.allSources}</span>
                <GlassToggle
                  aria-label={t.allSources}
                  checked={clientDraft.sourceIds.length === 0}
                  onChange={() => setClientDraft((current) => ({ ...current, sourceIds: [] }))}
                />
              </label>
              {sources.map((source) => (
                <label key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 truncate text-xs font-bold text-slate-700 dark:text-white/70">{source.name}</span>
                  <GlassToggle
                    aria-label={source.name}
                    checked={clientDraft.sourceIds.includes(source.id)}
                    onChange={() => toggleClientSource(source.id)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.selectedTags} value={clientDraft.selectedTags} onChange={(value) => setClientDraft((current) => ({ ...current, selectedTags: value }))} />
            <InputField label={t.regionFilter} value={clientDraft.regionFilter} onChange={(value) => setClientDraft((current) => ({ ...current, regionFilter: value }))} />
            <InputField label={t.includeFilter} value={clientDraft.includeFilter} onChange={(value) => setClientDraft((current) => ({ ...current, includeFilter: value }))} />
            <InputField label={t.excludeFilter} value={clientDraft.excludeFilter} onChange={(value) => setClientDraft((current) => ({ ...current, excludeFilter: value }))} />
            <InputField label={t.maxLatency} suffix="ms" type="number" value={clientDraft.maxLatencyMs} onChange={(value) => setClientDraft((current) => ({ ...current, maxLatencyMs: value }))} />
            <SelectField
              label={t.sortStrategy}
              value={clientDraft.sortStrategy}
              onChange={(value) => setClientDraft((current) => ({ ...current, sortStrategy: value as SubscriptionClientSortStrategy }))}
              options={[
                { label: 'latency', value: 'latency' },
                { label: 'region', value: 'region' },
                { label: 'name', value: 'name' },
                { label: 'manual', value: 'manual' }
              ]}
            />
          </div>
          <InputField label={t.routingRule} value={clientDraft.routingRule} onChange={(value) => setClientDraft((current) => ({ ...current, routingRule: value }))} />
          <InputField label={t.templateName} value={clientDraft.templateName} onChange={(value) => setClientDraft((current) => ({ ...current, templateName: value }))} />
          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.formats}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              {clientFormatOptions.map((option) => (
                <label key={option.value} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 break-words text-xs font-bold uppercase text-slate-700 dark:text-white/70">{option.label[language]}</span>
                  <GlassToggle aria-label={option.label[language]} checked={clientDraft.formats.includes(option.value)} onChange={() => toggleFormat(option.value)} />
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-xs font-bold text-slate-700 dark:text-white/70">{t.enabled}</span>
            <GlassToggle
              aria-label={t.enabled}
              checked={clientDraft.enabled}
              onChange={() => setClientDraft((current) => ({ ...current, enabled: !current.enabled }))}
            />
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.preview}</p>
            <div className="space-y-1 font-mono text-[11px] text-slate-600 dark:text-white/60">
              <p>{t.accessToken}: {accessTokenPreview}</p>
              <p>{t.securePath}: {securePathPreview}</p>
              {clientDraft.formats.map((format) => (
                <p key={format}>{getClientFormatLabel(format, language)}: {subscriptionUrls[format]}</p>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.matchedNodes}</p>
            {matchedInventoryNodes.length > 0 ? <TagList tags={matchedInventoryNodes.slice(0, 8).map((node) => node.name)} /> : <EmptyState label={t.noInventory} />}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy} type="submit">{t.save}</GlowButton>
          </div>
        </form>
      </ConfigDrawer>

      <ConfigDrawer
        open={drawer.type === 'profile'}
        title={profileT.drawerTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={saveProfile}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField
              label={profileT.profileName}
              value={profileDraft.name}
              onChange={(value) => setProfileDraft((current) => ({ ...current, name: value }))}
            />
            <SelectField
              label={profileT.profileClient}
              value={profileDraft.client}
              onChange={(value) => setProfileDraft((current) => ({ ...current, client: value as SubscriptionExportProfile['client'] }))}
              options={[
                { label: 'Mihomo', value: 'mihomo' },
                { label: 'Clash', value: 'clash' },
                { label: 'Sing-box', value: 'sing-box' },
                { label: 'Surge', value: 'surge' }
              ]}
            />
          </div>

          <InputField
            label={t.templateName}
            value={profileDraft.templateName}
            onChange={(value) => setProfileDraft((current) => ({ ...current, templateName: value }))}
          />

          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{profileT.sourceScope}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                <span className="text-xs font-bold text-slate-700 dark:text-white/70">{profileT.allSources}</span>
                <GlassToggle
                  aria-label={profileT.allSources}
                  checked={profileDraft.sourceIds.length === 0}
                  onChange={() => setProfileDraft((current) => ({ ...current, sourceIds: [] }))}
                />
              </label>
              {sources.map((source) => (
                <label key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 truncate text-xs font-bold text-slate-700 dark:text-white/70">{source.name}</span>
                  <GlassToggle
                    aria-label={`${profileT.sourceScope}: ${source.name}`}
                    checked={profileDraft.sourceIds.includes(source.id)}
                    onChange={() => toggleProfileSource(source.id)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField
              label={t.filter}
              value={profileDraft.includeFilter}
              onChange={(value) => setProfileDraft((current) => ({ ...current, includeFilter: value }))}
            />
            <InputField
              label={t.excludeFilter}
              value={profileDraft.excludeFilter}
              onChange={(value) => setProfileDraft((current) => ({ ...current, excludeFilter: value }))}
            />
            <InputField
              label={t.regionFilter}
              value={profileDraft.regionFilter}
              onChange={(value) => setProfileDraft((current) => ({ ...current, regionFilter: value }))}
            />
            <InputField
              label={profileT.proxyGroupName}
              value={profileDraft.proxyGroupName}
              onChange={(value) => setProfileDraft((current) => ({ ...current, proxyGroupName: value }))}
            />
            <SelectField
              label={profileT.proxyGroupStrategy}
              value={profileDraft.proxyGroupStrategy}
              onChange={(value) => setProfileDraft((current) => ({ ...current, proxyGroupStrategy: value as ProxyGroupTemplate['strategy'] }))}
              options={[
                { label: 'select', value: 'select' },
                { label: 'url-test', value: 'url-test' },
                { label: 'fallback', value: 'fallback' },
                { label: 'load-balance', value: 'load-balance' }
              ]}
            />
            <InputField
              label={profileT.proxyGroupTags}
              value={profileDraft.proxyGroupFilterTags}
              onChange={(value) => setProfileDraft((current) => ({ ...current, proxyGroupFilterTags: value }))}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{profileT.outputFormats}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              {clientFormatOptions.map((option) => (
                <label key={option.outputFormat} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 break-words text-xs font-bold uppercase text-slate-700 dark:text-white/70">{option.label[language]}</span>
                  <GlassToggle
                    aria-label={`${profileT.outputFormats}: ${option.label[language]}`}
                    checked={profileDraft.outputFormats.includes(option.outputFormat)}
                    onChange={() => toggleProfileOutputFormat(option.outputFormat)}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-xs font-bold text-slate-700 dark:text-white/70">{profileT.includeTrafficHeaders}</span>
            <GlassToggle
              aria-label={profileT.includeTrafficHeaders}
              checked={profileDraft.includeTrafficHeaders}
              onChange={() => setProfileDraft((current) => ({ ...current, includeTrafficHeaders: !current.includeTrafficHeaders }))}
            />
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy} type="submit">{t.save}</GlowButton>
          </div>
        </form>
      </ConfigDrawer>

      <ConfigDrawer
        description={t.sourceDrawerHint}
        open={drawer.type === 'source'}
        title={t.sourceDrawerTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={saveSource}>
          <InputField
            label={t.sourceDisplayName}
            value={sourceDraft.name}
            onChange={(value) => setSourceDraft((current) => ({ ...current, name: value }))}
          />
          <SelectField
            label={t.sourceKind}
            value={sourceDraft.kind}
            onChange={(value) => setSourceDraft((current) => ({ ...current, kind: value as SubscriptionSourceKind }))}
            options={[
              { label: 'Clash', value: 'clash' },
              { label: 'Mihomo Provider', value: 'mihomo-provider' },
              { label: 'V2Ray URI', value: 'v2ray-uri' },
              { label: 'Sing-box', value: 'sing-box' }
            ]}
          />
          <InputField label={t.sourceUrl} value={sourceDraft.url} onChange={(value) => setSourceDraft((current) => ({ ...current, url: value }))} />
          <InputField label={t.userAgent} value={sourceDraft.userAgent} onChange={(value) => setSourceDraft((current) => ({ ...current, userAgent: value }))} />
          <InputField label={t.refreshInterval} suffix="min" type="number" value={sourceDraft.refreshInterval} onChange={(value) => setSourceDraft((current) => ({ ...current, refreshInterval: value }))} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.filter} value={sourceDraft.includeFilter} onChange={(value) => setSourceDraft((current) => ({ ...current, includeFilter: value }))} />
            <InputField label={t.excludeFilter} value={sourceDraft.excludeFilter} onChange={(value) => setSourceDraft((current) => ({ ...current, excludeFilter: value }))} />
          </div>
          <SelectField
            label={t.sourceDedupe}
            value={sourceDraft.dedupeKey}
            onChange={(value) => setSourceDraft((current) => ({ ...current, dedupeKey: value as SubscriptionSource['dedupeKey'] }))}
            options={[
              { label: 'server-port', value: 'server-port' },
              { label: 'uuid', value: 'uuid' },
              { label: 'name-region', value: 'name-region' }
            ]}
          />
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs" type="submit">{t.save}</GlowButton>
          </div>
        </form>
      </ConfigDrawer>
    </div>
  );
}

function ProviderTable({ providers, language }: { providers: ProxyProviderConfig[]; language: AppLanguage }) {
  const t = copy[language];

  return (
    <Table minWidth="900px">
      <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
        <tr>
          <th className="px-5 py-3">{t.providerName}</th>
          <th className="px-5 py-3">{t.filter}</th>
          <th className="px-5 py-3">{t.excludeFilter}</th>
          <th className="px-5 py-3">{t.processMode}</th>
          <th className="px-5 py-3">{t.overrideRule}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-white/10">
        {providers.map((provider) => (
          <tr key={provider.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
            <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{provider.name}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.filter}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.excludeFilter}</td>
            <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{provider.processMode}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.overrideRule}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function DataSection({ children, hint, title }: { children: ReactNode; hint?: string; title: string }) {
  return (
    <section className="stagger-3 island-card overflow-hidden">
      <div className="border-b border-slate-200 p-5 dark:border-white/10">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>
        {hint ? <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Table({ children, minWidth }: { children: ReactNode; minWidth: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function WorkspaceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950'
          : 'rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-xs font-bold text-slate-500 transition hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Shuffle;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </div>
  );
}

function IconButton({
  children,
  danger = false,
  label,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={
        danger
          ? 'rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-400/30 dark:hover:bg-rose-400/10'
          : 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  onChange,
  suffix,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  suffix?: string;
  type?: 'number' | 'text';
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-slate-400 dark:text-white/35">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <select
        aria-label={label}
        className="glass-select-control mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
          {tag}
        </span>
      ))}
    </div>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-white/60"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">{label}</div>;
}
