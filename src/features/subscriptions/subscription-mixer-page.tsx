import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Copy,
  Download,
  FileSliders,
  Layers3,
  ListTree,
  Pencil,
  Plus,
  RefreshCcw,
  Shuffle,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import {
  MobileSummaryRail,
  ResponsivePage,
  ResponsiveSection,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
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
  focusIntent?: SubscriptionMixerFocusIntent;
  returnFocusRef?: RefObject<HTMLElement | null>;
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

export type SubscriptionMixerFocusIntent = {
  id: string;
  kind: 'subscription.links';
  targetId: string;
};

export type SubscriptionSourceImportMetadata = {
  sourceId: string;
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  providerAccountId: string;
  userAgent: string;
  refreshIntervalMinutes: number;
  fetchTimeoutSeconds: number;
  maxBodyBytes: number;
  syncBudgetMaxFetchesPerDay: number;
  syncBudgetMaxBytesPerDay: number;
  includeFilter: string;
  excludeFilter: string;
  dedupeKey: SubscriptionSource['dedupeKey'];
  syncPolicy: {
    userAgent: string;
    refreshIntervalMinutes: number;
    fetchTimeoutSeconds: number;
    maxBodyBytes: number;
  };
  syncBudget: {
    providerAccountId: string;
    maxFetchesPerDay: number;
    maxBytesPerDay: number;
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
  trafficFilter: TrafficFilterValue;
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
    trafficFilter: TrafficFilterValue;
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
type DrawerState =
  | { type: 'closed' }
  | { type: 'client'; id?: string }
  | { type: 'source' }
  | { type: 'profile'; id?: string }
  | { type: 'links'; clientId: string }
  | { type: 'nodes'; clientId: string };
export type TrafficFilterValue = '' | 'available' | 'quota-exceeded' | 'high' | 'low' | 'limited' | 'unlimited';

type InventoryFilters = {
  query: string;
  sourceId: string;
  clientId: string;
  protocol: string;
  region: string;
  tags: string;
};

type ExportFileFilters = {
  query: string;
  format: string;
};

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
  trafficFilter: TrafficFilterValue;
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
  providerAccountId: string;
  userAgent: string;
  refreshInterval: string;
  fetchTimeoutSeconds: string;
  maxBodyMb: string;
  syncBudgetFetchesPerDay: string;
  syncBudgetMbPerDay: string;
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
    title: '订阅管理',
    subtitle: '按 3X-UI 的客户订阅身份和 miaomiaowu 的订阅链路拆分：订阅身份、外部订阅源、节点库存、代理集合和导出文件独立维护。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先看订阅规模、库存覆盖、导出配置、可发布导出和风险来源，再进入工作区或批量操作。',
    operationalOverviewSteps: ['审阅订阅规模', '核对库存覆盖', '确认导出配置', '检查发布链路'],
    clientsTab: '订阅身份',
    sourcesTab: '外部订阅源',
    inventoryTab: '节点库存',
    providersTab: '代理集合',
    exportsTab: '导出文件',
    tableLabel: (title: string) => `${title} 数据表`,
    tableScrollHint: '表格可横向滚动，键盘聚焦后可用方向键或触控板查看隐藏列。',
    addClient: '新增订阅身份',
    importSource: '导入订阅源',
    clientCount: '订阅身份',
    inventoryCount: '节点库存',
    exportCount: '导出文件',
    quickLinksTitle: '订阅链接',
    quickLinkNodeCount: (count: string) => `${count} 个节点`,
    quickLinkQrLabel: (name: string) => `${name} 订阅二维码`,
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
    trafficFilter: '流量条件',
    trafficFilterAny: '不限',
    trafficFilterAvailable: '未超额',
    trafficFilterExceeded: '已超额',
    trafficFilterHigh: '高使用率',
    trafficFilterLow: '低使用率',
    trafficFilterLimited: '有限额',
    trafficFilterUnlimited: '不限额',
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
    copySubscriptionLink: '复制订阅链接',
    copyAllSubscriptionLinks: '复制全部格式链接',
    viewSubscriptionLinks: '查看订阅链接',
    viewMatchedNodes: '查看命中节点',
    matchedNodesTitle: (name: string) => `${name} 命中节点`,
    matchedNodesSummary: (matched: string, total: string) => `当前命中 ${matched} / ${total}`,
    matchedSources: '命中来源',
    syncMatchedSources: '同步命中来源',
    missingSource: '未登记来源',
    relatedExportFiles: '关联导出文件',
    viewInInventory: '在库存中查看',
    copyNodeLink: '复制节点链接',
    copyAllNodeLinks: '复制全部节点链接',
    noNodeLink: '无节点链接',
    selectInventoryNode: '选择',
    selectVisibleInventoryNodes: '选择当前库存节点',
    selectedInventoryNodes: '已选库存节点',
    bulkCopyInventoryNodeLinks: '批量复制节点链接',
    subscriptionLinksTitle: (name: string) => `${name} 订阅链接`,
    subscriptionUsageHeader: 'Subscription-Userinfo',
    copySubscriptionUsageHeader: '复制订阅用量头',
    subscriptionAccessStats: '访问统计',
    copySubscriptionDiagnostics: '复制订阅诊断',
    lastOnline: '上次在线',
    lastGenerated: '上次生成',
    generatedNodes: '生成节点',
    requestLimitShort: '请求上限',
    quotaReset: '重置窗口',
    guardrailStatus: '守护状态',
    copyFormatLink: (format: string) => `复制 ${format} 链接`,
    openFormatLink: (format: string) => `打开 ${format} 链接`,
    qrCodeLabel: (format: string) => `${format} 订阅二维码`,
    downloadQrCode: (format: string) => `下载 ${format} 二维码`,
    qrCodeUnavailable: '二维码生成中',
    bulkCopySubscriptionLinks: '批量复制订阅链接',
    bulkCopyAllSubscriptionLinks: '批量复制全部格式链接',
    bulkCopySubscriptionDiagnostics: '批量复制订阅诊断',
    bulkEnableClients: '批量启用',
    bulkDisableClients: '批量停用',
    bulkAddTrafficAmount: '批量加流量 GB',
    bulkAddTraffic: '批量加流量',
    bulkRenewDays: '批量续期天数',
    bulkRenewClients: '批量续期',
    bulkResetUsedTraffic: '批量重置已用流量',
    bulkDeleteClients: '批量删除',
    confirmBulkClientEnabled: (action: string, count: string) => `确认${action} ${count} 个已选订阅身份？`,
    confirmBulkAddClientTraffic: (trafficGb: string, count: string) =>
      `确认给 ${count} 个已选订阅身份增加 ${trafficGb} GB 流量？`,
    confirmBulkRenewClients: (days: string, count: string) =>
      `确认给 ${count} 个已选订阅身份续期 ${days} 天？`,
    confirmBulkResetClientUsedTraffic: (count: string) => `确认清零 ${count} 个已选订阅身份的已用流量？`,
    confirmBulkDeleteClients: (count: string) => `确认删除 ${count} 个订阅身份`,
    confirmDeleteClient: (name: string) => `确认删除 ${name} 订阅身份？`,
    selectClient: '选择',
    selectVisibleClients: '选择当前结果',
    selectedClients: '已选订阅身份',
    bulkImpactPreflight: '批量影响预检',
    bulkImpactHint: '基于当前订阅规则、节点库存和守护状态预估批量操作影响；执行前请核对客户、节点、来源和风险。',
    bulkImpactCustomers: '受影响客户',
    bulkImpactNodes: '命中节点',
    bulkImpactSources: '覆盖来源',
    bulkImpactUsedTraffic: '已用流量',
    bulkImpactGuardrailRisks: '守护风险',
    bulkImpactExpiring: '已过期/即将到期',
    bulkImpactDisabled: '已停用',
    bulkImpactCustomerPreview: '客户预览',
    bulkImpactNodePreview: '节点预览',
    bulkImpactRiskPreview: '风险提示',
    bulkImpactNoRisk: '暂无守护或到期风险',
    sourceImpactPreflight: '订阅源影响预检',
    sourceImpactHint:
      '批量同步会触发远端抓取、解析和库存刷新；批量删除会停止来源后续同步。执行前请核对来源、节点、预算和警告。',
    sourceImpactNodes: '库存节点',
    sourceImpactRiskSources: '异常来源',
    sourceImpactWarnings: '同步警告',
    sourceImpactFetchBudget: '抓取预算',
    sourceImpactSourcePreview: '来源预览',
    sourceImpactNodePreview: '节点预览',
    sourceImpactRiskPreview: '风险提示',
    sourceImpactNoRisk: '暂无同步警告或异常来源',
    exportImpactPreflight: '生成影响预检',
    exportImpactHint: '批量生成会刷新导出配置产物并影响客户订阅入口。执行前请核对文件、身份、格式和代理集合引用。',
    exportImpactFiles: '导出文件',
    exportImpactClients: '订阅身份',
    exportImpactFormats: '输出格式',
    exportImpactProviders: '代理集合引用',
    exportImpactExportPreview: '导出预览',
    exportImpactClientPreview: '身份预览',
    exportImpactFormatPreview: '格式预览',
    providerImpactPreflight: '代理集合生成影响预检',
    providerImpactHint: '批量生成关联导出会刷新引用所选代理集合的导出文件。执行前请核对集合、关联导出、身份和格式。',
    providerImpactProviders: '代理集合',
    providerImpactRelatedExports: '关联导出文件',
    providerImpactProviderPreview: '代理集合预览',
    pipelineReadiness: '订阅链路就绪',
    pipelineReadinessHint: '端到端检查来源、库存、代理集合、导出文件和订阅身份是否形成可发布链路。',
    pipelineCompleteness: '链路完整度',
    pipelinePublishableExports: '可发布导出',
    pipelineUsableNodes: '可用节点',
    pipelineRiskSources: '异常来源',
    pipelineStageSummary: (sources: string, nodes: string, providers: string, exports: string, clients: string) =>
      `来源 ${sources} · 库存 ${nodes} · 代理集合 ${providers} · 导出 ${exports} · 身份 ${clients}`,
    selectSource: '选择',
    selectVisibleSources: '选择当前订阅源',
    selectedSources: '已选订阅源',
    bulkSyncSources: '批量同步',
    bulkDeleteSources: '批量删除订阅源',
    confirmBulkDeleteSources: (count: string) => `确认删除 ${count} 个订阅源`,
    confirmDeleteSource: (name: string) => `确认删除外部订阅源 ${name}？`,
    confirmSyncSource: (name: string) => `确认同步外部订阅源 ${name}？`,
    confirmSyncSources: (count: string) => `确认同步 ${count} 个已选外部订阅源？`,
    confirmGenerateExportFile: (name: string) => `确认生成导出文件 ${name}？`,
    confirmGenerateExportFiles: (count: string) => `确认生成 ${count} 个已选导出文件？`,
    syncNow: '立即同步',
    save: '保存',
    cancel: '取消',
    preview: '订阅地址预览',
    securePath: '安全路径',
    outputFormat: '输出格式',
    syncPolicy: '同步策略',
    syncBudget: '同步预算',
    dedupePolicy: '去重策略',
    protocolFilter: '协议过滤',
    noClients: '暂无订阅身份',
    clientSearch: '搜索订阅身份',
    clientSearchPlaceholder: '搜索客户、邮箱、Sub ID、标签或分组',
    clientSearchResult: '当前匹配',
    clientFilterEmpty: '没有匹配的订阅身份',
    sourceSearch: '搜索订阅源',
    sourceSearchPlaceholder: '搜索源名、地址、服务商账户、过滤规则或状态',
    sourceSearchResult: '当前匹配',
    sourceFilterEmpty: '没有匹配的订阅源',
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
    inventorySearch: '搜索库存节点',
    inventorySearchPlaceholder: '搜索节点名、服务器、标签、来源或状态',
    inventorySearchResult: '当前匹配',
    inventorySource: '库存订阅源',
    inventoryClientRule: '客户订阅规则',
    inventoryProtocol: '库存协议',
    inventoryRegion: '库存地区',
    inventoryTags: '库存标签',
    allInventorySources: '全部来源',
    allInventoryClients: '不套用客户规则',
    allInventoryProtocols: '全部协议',
    inventoryFilterEmpty: '没有匹配的库存节点',
    noInventory: '暂无节点库存',
    providerName: '代理集合',
    providerSearch: '搜索代理集合',
    providerSearchPlaceholder: '搜索集合、来源、过滤、地区、处理模式或覆盖规则',
    providerSearchResult: '当前匹配',
    providerFilterEmpty: '没有匹配的代理集合',
    providerUrl: '代理集合地址',
    selectProvider: '选择',
    selectVisibleProviders: '选择当前代理集合',
    selectedProviders: '已选代理集合',
    bulkCopyProviderUrls: '批量复制集合地址',
    bulkGenerateProviderExports: '批量生成关联导出',
    copyProviderUrl: '复制集合地址',
    generateProviderExports: '生成关联导出',
    filter: '包含过滤',
    excludeFilter: '排除过滤',
    processMode: '处理模式',
    overrideRule: '覆盖规则',
    noProviders: '暂无代理集合',
    exportName: '导出文件',
    template: '模板',
    accessToken: '访问令牌',
    exportSearch: '搜索导出文件',
    exportSearchPlaceholder: '搜索客户、配置、模板、Sub ID、标签或格式',
    exportSearchResult: '当前匹配',
    exportFormat: '导出格式',
    allExportFormats: '全部格式',
    exportFilterEmpty: '没有匹配的导出文件',
    copyExportLink: '复制导出链接',
    selectExportFile: '选择',
    selectVisibleExportFiles: '选择当前导出文件',
    selectedExportFiles: '已选导出文件',
    bulkCopyExportLinks: '批量复制导出链接',
    bulkGenerateExportFiles: '批量生成',
    generate: '生成',
    noExports: '暂无导出文件',
    unitGb: 'GB',
    unitDays: '天',
    sourceDrawerTitle: '导入外部订阅源',
    sourceDrawerHint: '源会先登记为外部订阅，再同步进节点库存，之后由代理集合和导出文件引用。',
    sourceKind: '源类型',
    sourceDisplayName: '源名称',
    providerAccount: '服务商账户',
    userAgent: 'User-Agent',
    refreshInterval: '刷新间隔',
    fetchTimeout: '抓取超时',
    maxBodySize: '响应上限',
    dailyFetchBudget: '每日抓取',
    dailyByteBudget: '每日字节',
    budgetUnlimited: '不限',
    budgetFetchUnit: '次',
    sourceDedupe: '去重策略',
    matchedNodes: '命中节点'
  },
  en: {
    title: 'Subscription Management',
    subtitle: 'Split subscriptions into 3X-UI-style client identities and miaomiaowu-style source, inventory, provider, and export-file layers.',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint:
      'Review subscription scale, inventory coverage, export profiles, publishable exports, and risk sources before you enter a workspace or batch anything.',
    operationalOverviewSteps: ['Review scale', 'Check inventory', 'Confirm exports', 'Verify readiness'],
    clientsTab: 'Identities',
    sourcesTab: 'External Sources',
    inventoryTab: 'Node Inventory',
    providersTab: 'Proxy Providers',
    exportsTab: 'Export Files',
    tableLabel: (title: string) => `${title} Data Table`,
    tableScrollHint: 'Table can scroll horizontally; focus it with the keyboard, then use arrow keys or a trackpad to reveal hidden columns.',
    addClient: 'Add Identity',
    importSource: 'Import Source',
    clientCount: 'Identities',
    inventoryCount: 'Node Inventory',
    exportCount: 'Export Files',
    quickLinksTitle: 'Subscription Links',
    quickLinkNodeCount: (count: string) => `${count} nodes`,
    quickLinkQrLabel: (name: string) => `${name} Subscription QR Code`,
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
    trafficFilter: 'Traffic Condition',
    trafficFilterAny: 'Any',
    trafficFilterAvailable: 'Under Quota',
    trafficFilterExceeded: 'Quota Exceeded',
    trafficFilterHigh: 'High Usage',
    trafficFilterLow: 'Low Usage',
    trafficFilterLimited: 'Limited',
    trafficFilterUnlimited: 'Unlimited',
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
    copySubscriptionLink: 'Copy Subscription Link',
    copyAllSubscriptionLinks: 'Copy All Format Links',
    viewSubscriptionLinks: 'View Subscription Links',
    viewMatchedNodes: 'View Matched Nodes',
    matchedNodesTitle: (name: string) => `${name} Matched Nodes`,
    matchedNodesSummary: (matched: string, total: string) => `Matched ${matched} / ${total}`,
    matchedSources: 'Matched Sources',
    syncMatchedSources: 'Sync Matched Sources',
    missingSource: 'Unregistered Source',
    relatedExportFiles: 'Related Export Files',
    viewInInventory: 'View In Inventory',
    copyNodeLink: 'Copy Node Link',
    copyAllNodeLinks: 'Copy All Node Links',
    noNodeLink: 'No Node Link',
    selectInventoryNode: 'Select',
    selectVisibleInventoryNodes: 'Select Visible Inventory Nodes',
    selectedInventoryNodes: 'Selected Inventory Nodes',
    bulkCopyInventoryNodeLinks: 'Bulk Copy Node Links',
    subscriptionLinksTitle: (name: string) => `${name} Subscription Links`,
    subscriptionUsageHeader: 'Subscription-Userinfo',
    copySubscriptionUsageHeader: 'Copy Usage Header',
    subscriptionAccessStats: 'Access Statistics',
    copySubscriptionDiagnostics: 'Copy Subscription Diagnostics',
    lastOnline: 'Last Online',
    lastGenerated: 'Last Generated',
    generatedNodes: 'Generated Nodes',
    requestLimitShort: 'Request Limit',
    quotaReset: 'Quota Reset',
    guardrailStatus: 'Guardrail',
    copyFormatLink: (format: string) => `Copy ${format} Link`,
    openFormatLink: (format: string) => `Open ${format} Link`,
    qrCodeLabel: (format: string) => `${format} Subscription QR Code`,
    downloadQrCode: (format: string) => `Download ${format} QR Code`,
    qrCodeUnavailable: 'Generating QR code',
    bulkCopySubscriptionLinks: 'Bulk Copy Subscription Links',
    bulkCopyAllSubscriptionLinks: 'Bulk Copy All Format Links',
    bulkCopySubscriptionDiagnostics: 'Bulk Copy Subscription Diagnostics',
    bulkEnableClients: 'Bulk Enable',
    bulkDisableClients: 'Bulk Disable',
    bulkAddTrafficAmount: 'Bulk Add Traffic GB',
    bulkAddTraffic: 'Bulk Add Traffic',
    bulkRenewDays: 'Bulk Renew Days',
    bulkRenewClients: 'Bulk Renew',
    bulkResetUsedTraffic: 'Bulk Reset Used Traffic',
    bulkDeleteClients: 'Bulk Delete',
    confirmBulkClientEnabled: (action: string, count: string) =>
      `${action} ${count} selected subscription ${count === '1' ? 'identity' : 'identities'}?`,
    confirmBulkAddClientTraffic: (trafficGb: string, count: string) =>
      `Add ${trafficGb} GB to ${count} selected subscription ${count === '1' ? 'identity' : 'identities'}?`,
    confirmBulkRenewClients: (days: string, count: string) =>
      `Renew ${count} selected subscription ${count === '1' ? 'identity' : 'identities'} by ${days} days?`,
    confirmBulkResetClientUsedTraffic: (count: string) =>
      `Reset used traffic for ${count} selected subscription ${count === '1' ? 'identity' : 'identities'}?`,
    confirmBulkDeleteClients: (count: string) => `Confirm Delete ${count} Identities`,
    confirmDeleteClient: (name: string) => `Delete ${name} subscription identity?`,
    selectClient: 'Select',
    selectVisibleClients: 'Select Visible Identities',
    selectedClients: 'Selected Identities',
    bulkImpactPreflight: 'Bulk Impact Preflight',
    bulkImpactHint: 'Estimate bulk-action impact from current subscription rules, node inventory, and guardrail state before executing changes.',
    bulkImpactCustomers: 'Affected Customers',
    bulkImpactNodes: 'Matched Nodes',
    bulkImpactSources: 'Covered Sources',
    bulkImpactUsedTraffic: 'Used Traffic',
    bulkImpactGuardrailRisks: 'Guardrail Risks',
    bulkImpactExpiring: 'Expired/Soon',
    bulkImpactDisabled: 'Disabled',
    bulkImpactCustomerPreview: 'Customer Preview',
    bulkImpactNodePreview: 'Node Preview',
    bulkImpactRiskPreview: 'Risk Notes',
    bulkImpactNoRisk: 'No guardrail or expiry risks',
    sourceImpactPreflight: 'Source Impact Preflight',
    sourceImpactHint:
      'Bulk sync triggers remote fetch, parsing, and inventory refresh; bulk delete stops future sync for selected sources. Review sources, nodes, budgets, and warnings before execution.',
    sourceImpactNodes: 'Inventory Nodes',
    sourceImpactRiskSources: 'Risk Sources',
    sourceImpactWarnings: 'Sync Warnings',
    sourceImpactFetchBudget: 'Fetch Budget',
    sourceImpactSourcePreview: 'Source Preview',
    sourceImpactNodePreview: 'Node Preview',
    sourceImpactRiskPreview: 'Risk Notes',
    sourceImpactNoRisk: 'No sync warnings or source risks',
    exportImpactPreflight: 'Generation Impact Preflight',
    exportImpactHint:
      'Bulk generation refreshes export artifacts and affects customer subscription entry points. Review files, identities, formats, and proxy-provider references before execution.',
    exportImpactFiles: 'Export Files',
    exportImpactClients: 'Identities',
    exportImpactFormats: 'Output Formats',
    exportImpactProviders: 'Provider References',
    exportImpactExportPreview: 'Export Preview',
    exportImpactClientPreview: 'Identity Preview',
    exportImpactFormatPreview: 'Format Preview',
    providerImpactPreflight: 'Provider Generation Impact Preflight',
    providerImpactHint:
      'Bulk related-export generation refreshes export files that reference the selected proxy providers. Review providers, related exports, identities, and formats before execution.',
    providerImpactProviders: 'Proxy Providers',
    providerImpactRelatedExports: 'Related Export Files',
    providerImpactProviderPreview: 'Provider Preview',
    pipelineReadiness: 'Subscription Pipeline Ready',
    pipelineReadinessHint: 'End-to-end check that sources, inventory, proxy providers, export files, and identities form a publishable path.',
    pipelineCompleteness: 'Pipeline Completeness',
    pipelinePublishableExports: 'Publishable Exports',
    pipelineUsableNodes: 'Usable Nodes',
    pipelineRiskSources: 'Risk Sources',
    pipelineStageSummary: (sources: string, nodes: string, providers: string, exports: string, clients: string) =>
      `Sources ${sources} · Inventory ${nodes} · Providers ${providers} · Exports ${exports} · Identities ${clients}`,
    selectSource: 'Select',
    selectVisibleSources: 'Select Visible Sources',
    selectedSources: 'Selected Sources',
    bulkSyncSources: 'Bulk Sync',
    bulkDeleteSources: 'Bulk Delete Sources',
    confirmBulkDeleteSources: (count: string) => `Confirm Delete ${count} Sources`,
    confirmDeleteSource: (name: string) => `Delete external subscription source ${name}?`,
    confirmSyncSource: (name: string) => `Sync external subscription source ${name}?`,
    confirmSyncSources: (count: string) =>
      `Sync ${count} selected external subscription source${count === '1' ? '' : 's'}?`,
    confirmGenerateExportFile: (name: string) => `Generate export file ${name}?`,
    confirmGenerateExportFiles: (count: string) =>
      `Generate ${count} selected export file${count === '1' ? '' : 's'}?`,
    syncNow: 'Sync Now',
    save: 'Save',
    cancel: 'Cancel',
    preview: 'Subscription URL Preview',
    securePath: 'Secure Path',
    outputFormat: 'Output Format',
    syncPolicy: 'Sync Policy',
    syncBudget: 'Sync Budget',
    dedupePolicy: 'Dedupe Policy',
    protocolFilter: 'Protocol Filter',
    noClients: 'No subscription identities yet',
    clientSearch: 'Search Subscription Identities',
    clientSearchPlaceholder: 'Search customer, email, Sub ID, tags, or group',
    clientSearchResult: 'Matching',
    clientFilterEmpty: 'No matching subscription identities',
    sourceSearch: 'Search Subscription Sources',
    sourceSearchPlaceholder: 'Search name, URL, provider account, rules, or status',
    sourceSearchResult: 'Matching',
    sourceFilterEmpty: 'No matching subscription sources',
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
    inventorySearch: 'Search Inventory Nodes',
    inventorySearchPlaceholder: 'Search node name, server, tag, source, or status',
    inventorySearchResult: 'Matching',
    inventorySource: 'Inventory Source',
    inventoryClientRule: 'Inventory Client Rule',
    inventoryProtocol: 'Inventory Protocol',
    inventoryRegion: 'Inventory Region',
    inventoryTags: 'Inventory Tags',
    allInventorySources: 'All Sources',
    allInventoryClients: 'No Client Rule',
    allInventoryProtocols: 'All Protocols',
    inventoryFilterEmpty: 'No matching inventory nodes',
    noInventory: 'No inventory nodes yet',
    providerName: 'Proxy Provider',
    providerSearch: 'Search Proxy Providers',
    providerSearchPlaceholder: 'Search provider, source, filter, region, process mode, or override rule',
    providerSearchResult: 'Matching',
    providerFilterEmpty: 'No matching proxy providers',
    providerUrl: 'Proxy Provider URL',
    selectProvider: 'Select',
    selectVisibleProviders: 'Select Visible Proxy Providers',
    selectedProviders: 'Selected Proxy Providers',
    bulkCopyProviderUrls: 'Bulk Copy Provider URLs',
    bulkGenerateProviderExports: 'Bulk Generate Related Exports',
    copyProviderUrl: 'Copy Proxy Provider URL',
    generateProviderExports: 'Generate Related Exports',
    filter: 'Include Filter',
    excludeFilter: 'Exclude Filter',
    processMode: 'Process Mode',
    overrideRule: 'Override Rule',
    noProviders: 'No proxy providers yet',
    exportName: 'Export File',
    template: 'Template',
    accessToken: 'Access Token',
    exportSearch: 'Search Export Files',
    exportSearchPlaceholder: 'Search client, profile, template, Sub ID, tags, or formats',
    exportSearchResult: 'Matching',
    exportFormat: 'Export Format',
    allExportFormats: 'All Formats',
    exportFilterEmpty: 'No matching export files',
    copyExportLink: 'Copy Export Link',
    selectExportFile: 'Select',
    selectVisibleExportFiles: 'Select Visible Export Files',
    selectedExportFiles: 'Selected Export Files',
    bulkCopyExportLinks: 'Bulk Copy Export Links',
    bulkGenerateExportFiles: 'Bulk Generate',
    generate: 'Generate',
    noExports: 'No export files yet',
    unitGb: 'GB',
    unitDays: 'days',
    sourceDrawerTitle: 'Import External Source',
    sourceDrawerHint: 'Sources are registered first, synchronized into inventory, then referenced by proxy providers and export files.',
    sourceKind: 'Source Kind',
    sourceDisplayName: 'Source Name',
    providerAccount: 'Provider Account',
    userAgent: 'User-Agent',
    refreshInterval: 'Refresh Interval',
    fetchTimeout: 'Fetch Timeout',
    maxBodySize: 'Body Limit',
    dailyFetchBudget: 'Daily Fetches',
    dailyByteBudget: 'Daily Bytes',
    budgetUnlimited: 'unlimited',
    budgetFetchUnit: 'fetches',
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
    search: '搜索导出配置',
    searchPlaceholder: '搜索配置、客户端、模板、来源、过滤、代理组或格式',
    searchResult: '当前匹配',
    filterEmpty: '没有匹配的导出配置',
    selectProfile: '选择',
    selectVisibleProfiles: '选择当前导出配置',
    selectedProfiles: '已选导出配置',
    bulkDeleteProfiles: '批量删除配置',
    confirmBulkDeleteProfiles: (count: string) => `确认删除 ${count} 个配置`,
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
    search: 'Search Export Profiles',
    searchPlaceholder: 'Search profile, client, template, source, filter, proxy group, or format',
    searchResult: 'Matching',
    filterEmpty: 'No matching export profiles',
    selectProfile: 'Select',
    selectVisibleProfiles: 'Select Visible Export Profiles',
    selectedProfiles: 'Selected Export Profiles',
    bulkDeleteProfiles: 'Bulk Delete Profiles',
    confirmBulkDeleteProfiles: (count: string) => `Confirm Delete ${count} Profiles`,
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
    trafficFilter: 'available',
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
const neutralActionButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary dark:focus-visible:ring-primary/40';
const compactNeutralActionButtonClass =
  'inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary dark:focus-visible:ring-primary/40';
const dangerActionButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10 dark:focus-visible:ring-rose-400/40';
const blueActionButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-blue-200 px-3 text-xs font-bold text-blue-700 transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-blue-400/30 dark:text-blue-300 dark:hover:bg-blue-400/10 dark:focus-visible:ring-blue-400/40';
const skyActionButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 transition hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-sky-400/30 dark:text-sky-300 dark:hover:bg-sky-400/10 dark:focus-visible:ring-sky-400/40';
const emeraldActionButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-emerald-200 px-3 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-400/10 dark:focus-visible:ring-emerald-400/40';
const amberActionButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-amber-200 px-3 text-xs font-bold text-amber-700 transition hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-400/30 dark:text-amber-300 dark:hover:bg-amber-400/10 dark:focus-visible:ring-amber-400/40';

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

function isTrafficFilterValue(value: string): value is TrafficFilterValue {
  return ['', 'available', 'quota-exceeded', 'high', 'low', 'limited', 'unlimited'].includes(value.toLowerCase());
}

function createEffectiveRoutingRule(routingRule: string, trafficFilter: TrafficFilterValue) {
  const baseRule = routingRule.trim();

  if (!trafficFilter || /\btraffic:/i.test(baseRule)) {
    return baseRule;
  }

  const trafficRule = `traffic:${trafficFilter}`;
  return baseRule ? `${baseRule} AND ${trafficRule}` : trafficRule;
}

function splitTrafficFilterFromRoutingRule(routingRule: string): { routingRule: string; trafficFilter: TrafficFilterValue } {
  const trimmed = routingRule.trim();
  const suffixMatch = /\s+AND\s+traffic:(available|quota-exceeded|high|low|limited|unlimited)\s*$/i.exec(trimmed);

  if (suffixMatch?.[1] && isTrafficFilterValue(suffixMatch[1])) {
    return {
      routingRule: trimmed.slice(0, suffixMatch.index).trim(),
      trafficFilter: suffixMatch[1].toLowerCase() as TrafficFilterValue
    };
  }

  const onlyMatch = /^traffic:(available|quota-exceeded|high|low|limited|unlimited)\s*$/i.exec(trimmed);

  if (onlyMatch?.[1] && isTrafficFilterValue(onlyMatch[1])) {
    return {
      routingRule: '',
      trafficFilter: onlyMatch[1].toLowerCase() as TrafficFilterValue
    };
  }

  return {
    routingRule: trimmed,
    trafficFilter: ''
  };
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
  const routingRule = createEffectiveRoutingRule(draft.routingRule, draft.trafficFilter);
  const subscriptionUrls = buildSubscriptionUrls({ ...draft, routingRule, securePathPreview });

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
    routingRule,
    trafficFilter: draft.trafficFilter,
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
      routingRule,
      trafficFilter: draft.trafficFilter,
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
  const routing = splitTrafficFilterFromRoutingRule(client.routingRule);

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
    routingRule: routing.routingRule,
    trafficFilter: routing.trafficFilter,
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
    providerAccountId: '',
    userAgent: 'OU-UI-Next/1.0',
    refreshInterval: '60',
    fetchTimeoutSeconds: '20',
    maxBodyMb: '5',
    syncBudgetFetchesPerDay: '',
    syncBudgetMbPerDay: '',
    includeFilter: 'premium|streaming',
    excludeFilter: 'expired|test',
    dedupeKey: 'server-port'
  };
}

function createSourceFromDraft(draft: SourceDraft): SubscriptionSource {
  const refreshIntervalMinutes = Math.max(Number.parseInt(draft.refreshInterval, 10) || 60, 1);
  const fetchTimeoutSeconds = Math.max(Number.parseInt(draft.fetchTimeoutSeconds, 10) || 20, 1);
  const maxBodyBytes = Math.max(Number.parseInt(draft.maxBodyMb, 10) || 5, 1) * 1024 * 1024;

  return {
    id: `source-${Date.now()}`,
    kind: draft.kind,
    name: draft.name.trim() || 'Manual Source',
    url: draft.url.trim() || 'https://provider.example.com/sub.yaml',
    ...(draft.providerAccountId.trim() ? { providerAccountId: draft.providerAccountId.trim() } : {}),
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: draft.dedupeKey,
    lastSyncAt: new Date().toISOString(),
    rateLimitPerMinute: refreshIntervalMinutes,
    userAgent: draft.userAgent.trim() || 'OU-UI-Next/1.0',
    refreshIntervalMinutes,
    fetchTimeoutSeconds,
    maxBodyBytes,
    includeFilter: draft.includeFilter.trim(),
    excludeFilter: draft.excludeFilter.trim()
  };
}

function buildSubscriptionUrls(draft: ClientDraft) {
  const subId = encodeURIComponent(draft.subId.trim() || 'manual');
  const securePath = draft.securePathPreview || createSecurePathPreview();
  const query = new URLSearchParams();
  const routingRule = createEffectiveRoutingRule(draft.routingRule, draft.trafficFilter);

  if (draft.selectedTags.trim()) {
    query.set('tags', draft.selectedTags.trim());
  }

  if (routingRule) {
    query.set('rule', routingRule);
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

function createBrowserPublicBaseUrl() {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;
  const basePath = import.meta.env.BASE_URL ?? '/';

  return new URL(basePath, origin).toString().replace(/\/+$/, '');
}

function createDefaultSubscriptionUrl(client: SubscriptionClientIdentity) {
  const securePathPreview =
    client.securePathPreview || `/${client.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  const subId = encodeURIComponent(client.subId);

  return `${createBrowserPublicBaseUrl()}/sub${securePathPreview}/uri/${subId}`;
}

function createClientSubscriptionUrl(client: SubscriptionClientIdentity, format: SubscriptionClientFormat) {
  const outputFormat = mapClientFormatToOutputFormat(format);
  const securePathPreview =
    client.securePathPreview || `/${client.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  const subId = encodeURIComponent(client.subId);

  return `${createBrowserPublicBaseUrl()}/sub${securePathPreview}/${outputFormat}/${subId}`;
}

function createClientAllFormatSubscriptionLinks(client: SubscriptionClientIdentity, language: AppLanguage) {
  return client.formats.map((format) => `${getClientFormatLabel(format, language)}: ${createClientSubscriptionUrl(client, format)}`);
}

function createClientAllFormatSubscriptionText(client: SubscriptionClientIdentity, language: AppLanguage) {
  return createClientAllFormatSubscriptionLinks(client, language).join('\n');
}

function createSubscriptionUsageHeaderValue(client: SubscriptionClientIdentity) {
  const expireSeconds = Math.max(Math.floor(Date.parse(client.expiresAt) / 1000) || 0, 0);

  return [
    'upload=0',
    `download=${Math.max(Math.round(client.usedTrafficBytes), 0)}`,
    `total=${Math.max(Math.round(client.trafficLimitBytes), 0)}`,
    `expire=${expireSeconds}`
  ].join('; ');
}

function createSubscriptionUsageHeaderLine(client: SubscriptionClientIdentity) {
  return `Subscription-Userinfo: ${createSubscriptionUsageHeaderValue(client)}`;
}

function createSubscriptionGuardrailStatus(client: SubscriptionClientIdentity) {
  if (client.runtimeDisabledByPolicy) {
    return client.guardrailReason || 'runtime_disabled_by_policy';
  }

  if (client.quotaExceeded) {
    return client.guardrailReason || 'quota_exceeded';
  }

  return client.enabled ? 'active' : 'disabled';
}

function createSubscriptionDiagnosticsText(client: SubscriptionClientIdentity) {
  const requestLimitPerHour = client.requestLimitPerHour ?? 360;

  return [
    `Sub ID: ${client.subId}`,
    `Display Name: ${client.displayName}`,
    `Email: ${client.email}`,
    `Group: ${client.group}`,
    `Protocol: ${client.protocol}`,
    createSubscriptionUsageHeaderLine(client),
    `Generated Nodes: ${client.generatedNodeCount}`,
    `Request Limit: ${requestLimitPerHour} req/h`,
    `IP Limit: ${client.ipLimit}`,
    `Last Online: ${client.lastOnlineAt ?? '-'}`,
    `Last Generated: ${client.lastGeneratedAt ?? '-'}`,
    `Quota Reset: ${client.quotaResetAt ?? '-'}`,
    `Quota Reset Baseline Used: ${Math.max(Math.round(client.quotaResetBaselineUsedTrafficBytes ?? 0), 0)} bytes`,
    `Guardrail: ${createSubscriptionGuardrailStatus(client)}`
  ].join('\n');
}

function createDownloadSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createSubscriptionQrFilename(client: SubscriptionClientIdentity, format: SubscriptionClientFormat) {
  const subSlug = createDownloadSlug(client.subId, 'subscription');
  const formatSlug = createDownloadSlug(mapClientFormatToOutputFormat(format), 'link');

  return `${subSlug}-${formatSlug}-qr.png`;
}

function mapExportFileFormatToPublicFormat(format: SubscriptionClientFormat): SubscriptionClientOutputFormat {
  return mapClientFormatToOutputFormat(format);
}

function selectExportFileCopyFormat(file: SubscriptionExportFile): SubscriptionClientOutputFormat {
  const preferredFormats: SubscriptionClientFormat[] = ['mihomo', 'clash', 'plain', 'sing-box', 'json'];
  const format = preferredFormats.find((item) => file.formats.includes(item)) ?? file.formats[0] ?? 'plain';

  return mapExportFileFormatToPublicFormat(format);
}

function createExportFileSubscriptionUrl(file: SubscriptionExportFile, client?: SubscriptionClientIdentity) {
  const securePathPreview =
    client?.securePathPreview || `/${file.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  const subId = encodeURIComponent(file.subId);
  const format = selectExportFileCopyFormat(file);

  return `${createBrowserPublicBaseUrl()}/sub${securePathPreview}/${format}/${subId}`;
}

function createProxyProviderUrl(provider: ProxyProviderConfig) {
  return `${createBrowserPublicBaseUrl()}/proxy-providers/${encodeURIComponent(provider.id)}.yaml`;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function openExternalLink(value: string) {
  globalThis.open?.(value, '_blank', 'noopener,noreferrer');
}

function normalizeSearchQuery(value: string) {
  return value.trim().toLowerCase();
}

function filterSubscriptionClients(clients: SubscriptionClientIdentity[], query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return clients;
  }

  return clients.filter((client) => {
    const searchableFields = [
      client.displayName,
      client.customerName ?? '',
      client.email,
      client.subId,
      client.protocol,
      client.group,
      client.includeFilter,
      client.excludeFilter,
      client.routingRule,
      client.templateName,
      ...client.selectedTags,
      ...client.regionFilter,
      ...client.formats
    ];

    return searchableFields.join(' ').toLowerCase().includes(normalizedQuery);
  });
}

function filterSubscriptionSources(sources: SubscriptionSource[], query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return sources;
  }

  return sources.filter((source) => {
    const searchableFields = [
      source.name,
      source.url,
      source.kind,
      source.status,
      source.providerAccountId ?? '',
      source.userAgent ?? '',
      source.includeFilter ?? '',
      source.excludeFilter ?? '',
      source.dedupeKey
    ];

    return searchableFields.join(' ').toLowerCase().includes(normalizedQuery);
  });
}

function filterSubscriptionExportFiles(files: SubscriptionExportFile[], filters: ExportFileFilters) {
  const normalizedQuery = normalizeSearchQuery(filters.query);
  const normalizedFormat = filters.format.toLowerCase();

  return files.filter((file) => {
    if (normalizedFormat && !file.formats.some((format) => format.toLowerCase() === normalizedFormat)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchableFields = [
      file.name,
      file.subId,
      file.subscriptionClientId,
      file.exportProfileId ?? '',
      file.exportProfileName ?? '',
      file.templateName,
      file.accessTokenPreview,
      ...file.selectedTags,
      ...file.selectedProviderIds,
      ...file.formats
    ];

    return searchableFields.join(' ').toLowerCase().includes(normalizedQuery);
  });
}

function filterSubscriptionExportProfiles(profiles: SubscriptionExportProfile[], query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return profiles;
  }

  return profiles.filter((profile) => {
    const searchableFields = [
      profile.name,
      profile.client,
      profile.templateName,
      profile.includeFilter,
      profile.excludeFilter,
      profile.updatedAt,
      ...profile.sourceIds,
      ...profile.regionFilter,
      ...profile.outputFormats,
      ...profile.proxyGroups.flatMap((group) => [group.name, group.strategy, ...group.filterTags])
    ];

    return searchableFields.join(' ').toLowerCase().includes(normalizedQuery);
  });
}

function filterProxyProviders(providers: ProxyProviderConfig[], query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return providers;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return providers.filter((provider) => {
    const searchableFields = [
      provider.id,
      provider.name,
      provider.externalSubscriptionId,
      provider.filter,
      provider.excludeFilter,
      provider.geoIpFilter,
      provider.processMode,
      provider.overrideRule
    ];

    const searchText = searchableFields.join(' ').toLowerCase();

    return queryTokens.every((token) => searchText.includes(token));
  });
}

function createInventorySearchText(node: SubscriptionInventoryNode) {
  return [
    node.name,
    node.protocol,
    node.server,
    node.port,
    node.sourceId,
    node.status ?? '',
    node.customerName ?? '',
    node.hostId ?? '',
    node.hostName ?? '',
    node.probeAgentId ?? '',
    node.inboundTag ?? '',
    node.rawUrl ?? '',
    ...node.tags
  ].join(' ');
}

function createClientInventoryRules(client: SubscriptionClientIdentity) {
  return {
    sourceIds: client.sourceIds,
    selectedTags: client.selectedTags,
    includeFilter: client.includeFilter,
    excludeFilter: client.excludeFilter,
    regionFilter: client.regionFilter,
    routingRule: client.routingRule,
    protocol: client.protocol,
    maxLatencyMs: client.maxLatencyMs,
    sortStrategy: client.sortStrategy
  };
}

function filterInventoryNodes(
  nodes: SubscriptionInventoryNode[],
  filters: InventoryFilters,
  client?: SubscriptionClientIdentity
) {
  const clientScopedNodes = client ? selectSubscriptionInventoryNodes(nodes, createClientInventoryRules(client)) : nodes;
  const sourceId = normalizeSearchQuery(filters.sourceId);
  const protocol = normalizeSearchQuery(filters.protocol);
  const regions = splitComma(filters.region).map(normalizeSearchQuery);
  const tags = splitComma(filters.tags).map(normalizeSearchQuery);
  const query = normalizeSearchQuery(filters.query);

  return clientScopedNodes.filter((node) => {
    const nodeTags = node.tags.map(normalizeSearchQuery);
    const sourceMatched = !sourceId || normalizeSearchQuery(node.sourceId) === sourceId;
    const protocolMatched = !protocol || normalizeSearchQuery(node.protocol) === protocol;
    const regionMatched =
      regions.length === 0 ||
      regions.every((region) =>
        nodeTags.some((tag) => tag === region || tag === `region:${region}` || tag === `geo:${region}` || tag.includes(region))
      );
    const tagsMatched =
      tags.length === 0 || tags.every((tag) => nodeTags.some((nodeTag) => nodeTag.includes(tag)));
    const queryMatched = !query || createInventorySearchText(node).toLowerCase().includes(query);

    return sourceMatched && protocolMatched && regionMatched && tagsMatched && queryMatched;
  });
}

function findMatchingInventoryNodes(nodes: SubscriptionInventoryNode[], draft: ClientDraft) {
  return selectSubscriptionInventoryNodes(nodes, {
    sourceIds: draft.sourceIds,
    selectedTags: splitComma(draft.selectedTags),
    includeFilter: draft.includeFilter,
    excludeFilter: draft.excludeFilter,
    regionFilter: splitComma(draft.regionFilter),
    routingRule: createEffectiveRoutingRule(draft.routingRule, draft.trafficFilter),
    protocol: draft.protocol,
    maxLatencyMs: Math.max(Number.parseInt(draft.maxLatencyMs, 10) || 0, 0),
    sortStrategy: draft.sortStrategy
  });
}

function findClientMatchingInventoryNodes(nodes: SubscriptionInventoryNode[], client: SubscriptionClientIdentity) {
  return selectSubscriptionInventoryNodes(nodes, createClientInventoryRules(client));
}

function findMatchedSources(nodes: SubscriptionInventoryNode[], sources: SubscriptionSource[]) {
  const sourceIds = Array.from(new Set(nodes.map((node) => node.sourceId)));

  return sourceIds.map((sourceId) => ({
    id: sourceId,
    source: sources.find((source) => source.id === sourceId),
    nodeCount: nodes.filter((node) => node.sourceId === sourceId).length
  }));
}

type BulkClientImpactSummary = {
  customerLabels: string[];
  matchedNodes: SubscriptionInventoryNode[];
  matchedSources: Array<{ id: string; source?: SubscriptionSource; nodeCount: number }>;
  usedTrafficBytes: number;
  guardrailRisks: string[];
  expiringClientCount: number;
  disabledClientCount: number;
};

type SourceImpactSummary = {
  sourceLabels: string[];
  nodeLabels: string[];
  riskLabels: string[];
  nodeCount: number;
  riskSourceCount: number;
  warningCount: number;
  usedFetches: number;
  maxFetches: number;
};

type ExportGenerationImpactSummary = {
  exportLabels: string[];
  clientLabels: string[];
  formatLabels: string[];
  fileCount: number;
  clientCount: number;
  formatCount: number;
  providerReferenceCount: number;
};

type ProviderGenerationImpactSummary = ExportGenerationImpactSummary & {
  providerLabels: string[];
  providerCount: number;
};

type PipelineReadinessSummary = {
  completeStages: number;
  totalStages: number;
  publishableExportCount: number;
  usableNodeCount: number;
  riskSourceCount: number;
  stageCounts: {
    sources: number;
    nodes: number;
    providers: number;
    exports: number;
    clients: number;
  };
  exportLabels: string[];
};

function createBulkClientImpactSummary(
  clients: SubscriptionClientIdentity[],
  nodes: SubscriptionInventoryNode[],
  sources: SubscriptionSource[]
): BulkClientImpactSummary {
  const nowMs = Date.now();
  const soonMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const matchedNodesById = new Map<string, SubscriptionInventoryNode>();
  const customerLabels = new Set<string>();
  const guardrailRisks: string[] = [];
  let usedTrafficBytes = 0;
  let expiringClientCount = 0;
  let disabledClientCount = 0;

  clients.forEach((client) => {
    customerLabels.add(client.customerName ?? client.displayName);
    usedTrafficBytes += Math.max(client.usedTrafficBytes, 0);

    if (!client.enabled) {
      disabledClientCount += 1;
    }

    const expiresAtMs = Date.parse(client.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= soonMs) {
      expiringClientCount += 1;
    }

    if (client.quotaExceeded || client.runtimeDisabledByPolicy) {
      guardrailRisks.push(`${client.displayName}: ${createSubscriptionGuardrailStatus(client)}`);
    }

    findClientMatchingInventoryNodes(nodes, client).forEach((node) => {
      matchedNodesById.set(node.id, node);
    });
  });

  const matchedNodes = Array.from(matchedNodesById.values());

  return {
    customerLabels: Array.from(customerLabels),
    matchedNodes,
    matchedSources: findMatchedSources(matchedNodes, sources),
    usedTrafficBytes,
    guardrailRisks,
    expiringClientCount,
    disabledClientCount
  };
}

function createExportGenerationImpactSummary(
  files: SubscriptionExportFile[],
  clients: SubscriptionClientIdentity[],
  language: AppLanguage
): ExportGenerationImpactSummary {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const clientLabelsById = new Map<string, string>();
  const formatLabelsByValue = new Map<string, string>();
  const providerIds = new Set<string>();
  const exportLabels = files.map((file) => {
    const client = clientsById.get(file.subscriptionClientId);

    clientLabelsById.set(file.subscriptionClientId, client?.displayName ?? file.subId);
    file.formats.forEach((format) => {
      formatLabelsByValue.set(format, getClientFormatLabel(format, language));
    });
    file.selectedProviderIds.forEach((providerId) => providerIds.add(providerId));

    return `${file.name} · ${file.templateName}`;
  });

  return {
    exportLabels,
    clientLabels: Array.from(clientLabelsById.values()),
    formatLabels: Array.from(formatLabelsByValue.values()),
    fileCount: files.length,
    clientCount: clientLabelsById.size,
    formatCount: formatLabelsByValue.size,
    providerReferenceCount: providerIds.size
  };
}

function createPipelineReadinessSummary({
  clients,
  exportFiles,
  inventoryNodes,
  language,
  providers,
  sources
}: {
  clients: SubscriptionClientIdentity[];
  exportFiles: SubscriptionExportFile[];
  inventoryNodes: SubscriptionInventoryNode[];
  language: AppLanguage;
  providers: ProxyProviderConfig[];
  sources: SubscriptionSource[];
}): PipelineReadinessSummary {
  const clientIds = new Set(clients.map((client) => client.id));
  const providerIds = new Set(providers.map((provider) => provider.id));
  const publishableExports = exportFiles.filter(
    (file) =>
      clientIds.has(file.subscriptionClientId) &&
      file.formats.length > 0 &&
      file.selectedProviderIds.length > 0 &&
      file.selectedProviderIds.every((providerId) => providerIds.has(providerId))
  );
  const usableNodeCount = inventoryNodes.filter(
    (node) => node.rawUrl && !['disabled', 'expired', 'quota-exceeded', 'error'].includes(node.status ?? '')
  ).length;
  const riskSourceCount = sources.filter((source) => source.status === 'warning' || source.status === 'failed' || source.status === 'paused').length;
  const stageCounts = {
    sources: sources.length,
    nodes: usableNodeCount,
    providers: providers.length,
    exports: publishableExports.length,
    clients: clients.length
  };
  const completeStages = Object.values(stageCounts).filter((count) => count > 0).length;

  return {
    completeStages,
    totalStages: 5,
    publishableExportCount: publishableExports.length,
    usableNodeCount,
    riskSourceCount,
    stageCounts,
    exportLabels: publishableExports.slice(0, 5).map((file) => `${file.name} · ${file.formats.map((format) => getClientFormatLabel(format, language)).join(' / ')}`)
  };
}

function createProviderGenerationImpactSummary(
  providers: ProxyProviderConfig[],
  files: SubscriptionExportFile[],
  clients: SubscriptionClientIdentity[],
  language: AppLanguage
): ProviderGenerationImpactSummary {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const relatedFiles = files.filter((file) => file.selectedProviderIds.some((providerId) => providerIds.has(providerId)));
  const exportSummary = createExportGenerationImpactSummary(relatedFiles, clients, language);

  return {
    ...exportSummary,
    providerLabels: providers.map((provider) => `${provider.name} · ${provider.processMode} · ${provider.externalSubscriptionId}`),
    providerCount: providers.length
  };
}

function createSourceImpactSummary(
  sources: SubscriptionSource[],
  nodes: SubscriptionInventoryNode[],
  language: AppLanguage
): SourceImpactSummary {
  const nodeCountsBySourceId = new Map<string, number>();
  const riskLabels: string[] = [];
  let nodeCount = 0;
  let riskSourceCount = 0;
  let warningCount = 0;
  let usedFetches = 0;
  let maxFetches = 0;

  nodes.forEach((node) => {
    nodeCountsBySourceId.set(node.sourceId, (nodeCountsBySourceId.get(node.sourceId) ?? 0) + 1);
  });

  const sourceLabels = sources.map((source) => `${source.name} · ${source.status} · ${source.kind}`);
  const nodeLabels = sources.map((source) => {
    const sourceNodeCount = nodeCountsBySourceId.get(source.id) ?? Math.max(source.nodeCount, 0);

    nodeCount += sourceNodeCount;

    return `${source.name} · ${formatNumber(sourceNodeCount, language)}`;
  });

  sources.forEach((source) => {
    if (source.status === 'warning' || source.status === 'failed' || source.status === 'paused') {
      riskSourceCount += 1;
      riskLabels.push(`${source.name}: ${source.status}`);
    }

    source.syncWarnings?.forEach((warning) => {
      warningCount += 1;
      riskLabels.push(`${source.name}: ${formatSourceSyncWarning(warning, language)}`);
    });

    usedFetches += Math.max(source.syncBudget?.usedFetches ?? 0, 0);
    maxFetches += Math.max(source.syncBudget?.maxFetchesPerDay ?? 0, 0);
  });

  return {
    sourceLabels,
    nodeLabels,
    riskLabels,
    nodeCount,
    riskSourceCount,
    warningCount,
    usedFetches,
    maxFetches
  };
}

function findClientExportFiles(files: SubscriptionExportFile[], client: SubscriptionClientIdentity) {
  return files.filter((file) => file.subscriptionClientId === client.id);
}

export function SubscriptionMixerPage({
  focusIntent,
  returnFocusRef,
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
  const trafficFilterOptions: Array<{ label: string; value: TrafficFilterValue }> = [
    { label: t.trafficFilterAny, value: '' },
    { label: t.trafficFilterAvailable, value: 'available' },
    { label: t.trafficFilterExceeded, value: 'quota-exceeded' },
    { label: t.trafficFilterHigh, value: 'high' },
    { label: t.trafficFilterLow, value: 'low' },
    { label: t.trafficFilterLimited, value: 'limited' },
    { label: t.trafficFilterUnlimited, value: 'unlimited' }
  ];
  const clients = subscriptionClients;
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('clients');
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedInventoryNodeIds, setSelectedInventoryNodeIds] = useState<string[]>([]);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [selectedExportFileIds, setSelectedExportFileIds] = useState<string[]>([]);
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [profileSearch, setProfileSearch] = useState('');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [profileDeleteConfirming, setProfileDeleteConfirming] = useState(false);
  const [sourceDeleteConfirming, setSourceDeleteConfirming] = useState(false);
  const [bulkTrafficGb, setBulkTrafficGb] = useState('100');
  const [bulkRenewDays, setBulkRenewDays] = useState('30');
  const [sourceSearch, setSourceSearch] = useState('');
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({
    query: '',
    sourceId: '',
    clientId: '',
    protocol: '',
    region: '',
    tags: ''
  });
  const [exportFileFilters, setExportFileFilters] = useState<ExportFileFilters>({
    query: '',
    format: ''
  });
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [customSources, setCustomSources] = useState<SubscriptionSource[]>([]);
  const [clientDraft, setClientDraft] = useState<ClientDraft>(createDefaultClientDraft);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>(createDefaultSourceDraft);
  const [profileDraft, setProfileDraft] = useState<ExportProfileDraft>(createDefaultExportProfileDraft);
  const filteredClients = useMemo(() => filterSubscriptionClients(clients, clientSearch), [clientSearch, clients]);
  const selectedClients = useMemo(
    () => clients.filter((client) => selectedClientIds.includes(client.id)),
    [clients, selectedClientIds]
  );
  const selectedVisibleClientCount = useMemo(
    () => filteredClients.filter((client) => selectedClientIds.includes(client.id)).length,
    [filteredClients, selectedClientIds]
  );
  const bundleSources = useMemo(() => mapBundleSources(subscriptions), [subscriptions]);
  const sources = useMemo(() => mergeSubscriptionSources(subscriptionSources, customSources, bundleSources), [
    bundleSources,
    customSources,
    subscriptionSources
  ]);
  const filteredSources = useMemo(() => filterSubscriptionSources(sources, sourceSearch), [sourceSearch, sources]);
  const selectedSources = useMemo(
    () => sources.filter((source) => selectedSourceIds.includes(source.id)),
    [selectedSourceIds, sources]
  );
  const selectedVisibleSourceCount = useMemo(
    () => filteredSources.filter((source) => selectedSourceIds.includes(source.id)).length,
    [filteredSources, selectedSourceIds]
  );
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
  const bulkClientImpactSummary = useMemo(
    () => createBulkClientImpactSummary(selectedClients, inventoryNodes, sources),
    [inventoryNodes, selectedClients, sources]
  );
  const pipelineReadinessSummary = useMemo(
    () =>
      createPipelineReadinessSummary({
        clients,
        exportFiles: subscriptionExportFiles,
        inventoryNodes,
        language,
        providers: proxyProviders,
        sources
      }),
    [clients, inventoryNodes, language, proxyProviders, sources, subscriptionExportFiles]
  );
  const sourceImpactSummary = useMemo(
    () => createSourceImpactSummary(selectedSources, subscriptionInventoryNodes, language),
    [language, selectedSources, subscriptionInventoryNodes]
  );
  const selectedInventoryClient = useMemo(
    () => clients.find((client) => client.id === inventoryFilters.clientId),
    [clients, inventoryFilters.clientId]
  );
  const inventoryProtocols = useMemo(() => {
    const protocols = new Set(inventoryNodes.map((node) => node.protocol).filter(Boolean));
    return Array.from(protocols).sort((left, right) => left.localeCompare(right));
  }, [inventoryNodes]);
  const filteredInventoryNodes = useMemo(
    () => filterInventoryNodes(inventoryNodes, inventoryFilters, selectedInventoryClient),
    [inventoryFilters, inventoryNodes, selectedInventoryClient]
  );
  const selectedInventoryNodes = useMemo(
    () => inventoryNodes.filter((node) => selectedInventoryNodeIds.includes(node.id)),
    [inventoryNodes, selectedInventoryNodeIds]
  );
  const selectedVisibleInventoryNodeCount = useMemo(
    () => filteredInventoryNodes.filter((node) => selectedInventoryNodeIds.includes(node.id)).length,
    [filteredInventoryNodes, selectedInventoryNodeIds]
  );
  const [providerSearch, setProviderSearch] = useState('');
  const providers = proxyProviders;
  const filteredProviders = useMemo(() => filterProxyProviders(providers, providerSearch), [providerSearch, providers]);
  const selectedProviders = useMemo(
    () => providers.filter((provider) => selectedProviderIds.includes(provider.id)),
    [providers, selectedProviderIds]
  );
  const selectedVisibleProviderCount = useMemo(
    () => filteredProviders.filter((provider) => selectedProviderIds.includes(provider.id)).length,
    [filteredProviders, selectedProviderIds]
  );
  const exportFiles = subscriptionExportFiles;
  const exportFileFormats = useMemo(() => {
    const formats = new Set(exportFiles.flatMap((file) => file.formats));

    return Array.from(formats).sort((left, right) => getClientFormatLabel(left, language).localeCompare(getClientFormatLabel(right, language)));
  }, [exportFiles, language]);
  const filteredExportFiles = useMemo(
    () => filterSubscriptionExportFiles(exportFiles, exportFileFilters),
    [exportFileFilters, exportFiles]
  );
  const selectedExportFiles = useMemo(
    () => exportFiles.filter((file) => selectedExportFileIds.includes(file.id)),
    [exportFiles, selectedExportFileIds]
  );
  const providerGenerationImpactSummary = useMemo(
    () => createProviderGenerationImpactSummary(selectedProviders, exportFiles, clients, language),
    [clients, exportFiles, language, selectedProviders]
  );
  const exportGenerationImpactSummary = useMemo(
    () => createExportGenerationImpactSummary(selectedExportFiles, clients, language),
    [clients, language, selectedExportFiles]
  );
  const controlRailMetrics = useMemo(
    () => [
      {
        icon: Shuffle,
        label: t.clientCount,
        value: formatNumber(clients.length, language)
      },
      {
        icon: Layers3,
        label: t.inventoryCount,
        value: formatNumber(inventoryNodes.length, language)
      },
      {
        icon: FileSliders,
        label: profileT.tab,
        value: formatNumber(subscriptionExportProfiles.length, language)
      }
    ],
    [clients.length, inventoryNodes.length, language, profileT.tab, subscriptionExportProfiles.length, t.clientCount, t.inventoryCount]
  );
  const selectedVisibleExportFileCount = useMemo(
    () => filteredExportFiles.filter((file) => selectedExportFileIds.includes(file.id)).length,
    [filteredExportFiles, selectedExportFileIds]
  );
  const exportProfiles = subscriptionExportProfiles;
  const filteredExportProfiles = useMemo(
    () => filterSubscriptionExportProfiles(exportProfiles, profileSearch),
    [exportProfiles, profileSearch]
  );
  const selectedProfiles = useMemo(
    () => exportProfiles.filter((profile) => selectedProfileIds.includes(profile.id)),
    [exportProfiles, selectedProfileIds]
  );
  const selectedVisibleProfileCount = useMemo(
    () => filteredExportProfiles.filter((profile) => selectedProfileIds.includes(profile.id)).length,
    [filteredExportProfiles, selectedProfileIds]
  );
  const editingClient =
    drawer.type === 'client' && drawer.id ? subscriptionClients.find((client) => client.id === drawer.id) : undefined;
  const editingProfile =
    drawer.type === 'profile' && drawer.id ? subscriptionExportProfiles.find((profile) => profile.id === drawer.id) : undefined;
  const linkDrawerClient =
    drawer.type === 'links' ? subscriptionClients.find((client) => client.id === drawer.clientId) : undefined;
  const nodeDrawerClient =
    drawer.type === 'nodes' ? subscriptionClients.find((client) => client.id === drawer.clientId) : undefined;
  const nodeDrawerMatches = useMemo(
    () => (nodeDrawerClient ? findClientMatchingInventoryNodes(inventoryNodes, nodeDrawerClient) : []),
    [inventoryNodes, nodeDrawerClient]
  );
  const nodeDrawerSources = useMemo(
    () => findMatchedSources(nodeDrawerMatches, sources),
    [nodeDrawerMatches, sources]
  );
  const nodeDrawerExportFiles = useMemo(
    () => (nodeDrawerClient ? findClientExportFiles(exportFiles, nodeDrawerClient) : []),
    [exportFiles, nodeDrawerClient]
  );
  const subscriptionUrls = buildSubscriptionUrls(clientDraft);
  const accessTokenPreview = createAccessTokenPreview(clientDraft.subId.trim() || 'manual');
  const securePathPreview = clientDraft.securePathPreview;
  const matchedInventoryNodes = useMemo(() => findMatchingInventoryNodes(inventoryNodes, clientDraft), [clientDraft, inventoryNodes]);

  function openClientDrawer(client?: SubscriptionClientIdentity) {
    setClientDraft(client ? createDraftFromClient(client) : createDefaultClientDraft());
    setDrawer({ type: 'client', id: client?.id });
  }

  function openProfileDrawer(profile?: SubscriptionExportProfile) {
    setProfileDeleteConfirming(false);
    setProfileDraft(profile ? createDraftFromExportProfile(profile) : createDefaultExportProfileDraft());
    setDrawer({ type: 'profile', id: profile?.id });
  }

  function openSubscriptionLinkDrawer(client: SubscriptionClientIdentity) {
    setDrawer({ type: 'links', clientId: client.id });
  }

  useEffect(() => {
    if (!focusIntent || focusIntent.kind !== 'subscription.links') {
      return;
    }

    const client = clients.find((item) => item.id === focusIntent.targetId);

    if (!client) {
      return;
    }

    setClientSearch('');
    setActiveWorkspace('clients');
    setDrawer({ type: 'links', clientId: client.id });
  }, [clients, focusIntent]);

  function openMatchedNodesDrawer(client: SubscriptionClientIdentity) {
    setDrawer({ type: 'nodes', clientId: client.id });
  }

  function viewClientInInventory(client: SubscriptionClientIdentity) {
    setInventoryFilters({
      query: '',
      sourceId: '',
      clientId: client.id,
      protocol: '',
      region: '',
      tags: ''
    });
    setActiveWorkspace('inventory');
    setDrawer({ type: 'closed' });
  }

  function toggleClientSelection(clientId: string) {
    setBulkDeleteConfirming(false);
    setSelectedClientIds((current) =>
      current.includes(clientId) ? current.filter((id) => id !== clientId) : [...current, clientId]
    );
  }

  function toggleVisibleClientSelection() {
    setBulkDeleteConfirming(false);
    const visibleIds = filteredClients.map((client) => client.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedClientIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function toggleSourceSelection(sourceId: string) {
    setSourceDeleteConfirming(false);
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }

  function toggleVisibleSourceSelection() {
    setSourceDeleteConfirming(false);
    const visibleIds = filteredSources.map((source) => source.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedSourceIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function toggleInventoryNodeSelection(nodeId: string) {
    setSelectedInventoryNodeIds((current) =>
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]
    );
  }

  function toggleVisibleInventoryNodeSelection() {
    const visibleIds = filteredInventoryNodes.map((node) => node.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedInventoryNodeIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function toggleProviderSelection(providerId: string) {
    setSelectedProviderIds((current) =>
      current.includes(providerId) ? current.filter((id) => id !== providerId) : [...current, providerId]
    );
  }

  function toggleVisibleProviderSelection() {
    const visibleIds = filteredProviders.map((provider) => provider.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedProviderIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function toggleExportFileSelection(fileId: string) {
    setSelectedExportFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    );
  }

  function toggleVisibleExportFileSelection() {
    const visibleIds = filteredExportFiles.map((file) => file.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedExportFileIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function toggleProfileSelection(profileId: string) {
    setProfileDeleteConfirming(false);
    setSelectedProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId]
    );
  }

  function toggleVisibleProfileSelection() {
    setProfileDeleteConfirming(false);
    const visibleIds = filteredExportProfiles.map((profile) => profile.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedProfileIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function copySelectedSubscriptionUrls() {
    const links = selectedClients.map(createDefaultSubscriptionUrl);

    if (links.length > 0) {
      copyText(links.join('\n'));
    }
  }

  function copySelectedAllFormatSubscriptionUrls() {
    const links = selectedClients.map((client) => [
      client.displayName,
      ...createClientAllFormatSubscriptionLinks(client, language)
    ].join('\n'));

    if (links.length > 0) {
      copyText(links.join('\n\n'));
    }
  }

  function copySelectedSubscriptionDiagnostics() {
    const diagnostics = selectedClients.map(createSubscriptionDiagnosticsText);

    if (diagnostics.length > 0) {
      copyText(diagnostics.join('\n\n'));
    }
  }

  function copySelectedInventoryNodeRawUrls() {
    const links = selectedInventoryNodes.flatMap((node) => (node.rawUrl ? [node.rawUrl] : []));

    if (links.length > 0) {
      copyText(links.join('\n'));
    }
  }

  function copySelectedExportFileSubscriptionUrls() {
    const links = selectedExportFiles.map((file) => {
      const client = clients.find((item) => item.id === file.subscriptionClientId);

      return `${file.name}\n${createExportFileSubscriptionUrl(file, client)}`;
    });

    if (links.length > 0) {
      copyText(links.join('\n\n'));
    }
  }

  function generateSelectedExportFiles() {
    generateExportFiles(selectedExportFiles);
  }

  function generateExportFile(file: SubscriptionExportFile) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmGenerateExportFile(file.name));

    if (!confirmed) {
      return;
    }

    onGenerateExportFile(file);
  }

  function generateExportFiles(files: SubscriptionExportFile[]) {
    const uniqueFiles = Array.from(new Map(files.map((file) => [file.id, file])).values());

    if (uniqueFiles.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmGenerateExportFiles(formatNumber(uniqueFiles.length, language)));

    if (!confirmed) {
      return;
    }

    uniqueFiles.forEach((file) => {
      onGenerateExportFile(file);
    });
  }

  function copySelectedProviderUrls() {
    const links = selectedProviders.map((provider) => `${provider.name}\n${createProxyProviderUrl(provider)}`);

    if (links.length > 0) {
      copyText(links.join('\n\n'));
    }
  }

  function copyProviderUrl(provider: ProxyProviderConfig) {
    copyText(`${provider.name}\n${createProxyProviderUrl(provider)}`);
  }

  function generateProviderExportFiles(provider: ProxyProviderConfig) {
    generateExportFiles(exportFiles.filter((file) => file.selectedProviderIds.includes(provider.id)));
  }

  function generateSelectedProviderExportFiles() {
    const selectedIdSet = new Set(selectedProviderIds);
    const relatedExportFiles = exportFiles.filter((file) =>
      file.selectedProviderIds.some((providerId) => selectedIdSet.has(providerId))
    );

    generateExportFiles(relatedExportFiles);
  }

  function deleteExportProfile(profile: SubscriptionExportProfile) {
    setProfileDeleteConfirming(false);
    onDeleteExportProfile(createExportProfileMetadataFromDraft(createDraftFromExportProfile(profile)));
    setSelectedProfileIds((current) => current.filter((id) => id !== profile.id));
  }

  function deleteSelectedProfiles() {
    selectedProfiles.forEach((profile) => {
      onDeleteExportProfile(createExportProfileMetadataFromDraft(createDraftFromExportProfile(profile)));
    });
    setSelectedProfileIds([]);
    setProfileDeleteConfirming(false);
  }

  function copyClientAllFormatSubscriptionUrls(client: SubscriptionClientIdentity) {
    copyText(createClientAllFormatSubscriptionText(client, language));
  }

  function copyNodeRawUrl(node: SubscriptionInventoryNode) {
    if (node.rawUrl) {
      copyText(node.rawUrl);
    }
  }

  function copyMatchedNodeRawUrls(nodes: SubscriptionInventoryNode[]) {
    const links = nodes.flatMap((node) => (node.rawUrl ? [node.rawUrl] : []));

    if (links.length > 0) {
      copyText(links.join('\n'));
    }
  }

  function syncMatchedSources() {
    syncSources(nodeDrawerSources.flatMap((item) => (item.source ? [item.source] : [])));
  }

  function syncSelectedSources() {
    setSourceDeleteConfirming(false);
    syncSources(selectedSources);
  }

  function syncSource(source: SubscriptionSource) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmSyncSource(source.name));

    if (!confirmed) {
      return;
    }

    void onSyncSource(source);
  }

  function syncSources(sourcesToSync: SubscriptionSource[]) {
    const uniqueSources = Array.from(new Map(sourcesToSync.map((source) => [source.id, source])).values());

    if (uniqueSources.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmSyncSources(formatNumber(uniqueSources.length, language)));

    if (!confirmed) {
      return;
    }

    uniqueSources.forEach((source) => {
      void onSyncSource(source);
    });
  }

  async function deleteSelectedSources() {
    const deletionResults = await Promise.all(
      selectedSources.map(async (source) => ({
        accepted: await onDeleteSource(source),
        source
      }))
    );
    const acceptedIds = deletionResults
      .filter((result) => result.accepted)
      .map((result) => result.source.id);

    if (acceptedIds.length > 0) {
      const acceptedIdSet = new Set(acceptedIds);

      setCustomSources((current) => current.filter((item) => !acceptedIdSet.has(item.id)));
      setSelectedSourceIds((current) => current.filter((id) => !acceptedIdSet.has(id)));
    }

    setSourceDeleteConfirming(false);
  }

  function copyExportFileSubscriptionUrl(file: SubscriptionExportFile) {
    const client = clients.find((item) => item.id === file.subscriptionClientId);

    copyText(createExportFileSubscriptionUrl(file, client));
  }

  function updateSelectedClientDrafts(updateDraft: (draft: ClientDraft) => ClientDraft) {
    setBulkDeleteConfirming(false);
    selectedClients.forEach((client) => {
      const draft = updateDraft(createDraftFromClient(client));

      onSaveClient(createClientMetadataFromDraft(draft, client.generatedNodeCount, client.id), 'update');
    });
  }

  function updateSelectedClientsEnabled(enabled: boolean) {
    if (selectedClients.length === 0) {
      return;
    }

    const actionLabel = enabled ? t.enabled : t.disabled;
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkClientEnabled(actionLabel, formatNumber(selectedClients.length, language)));

    if (!confirmed) {
      return;
    }

    updateSelectedClientDrafts((draft) => ({
      ...draft,
      enabled
    }));
  }

  function addTrafficToSelectedClients() {
    const trafficGb = Math.max(Number.parseInt(bulkTrafficGb, 10) || 0, 0);

    if (trafficGb === 0) {
      return;
    }

    if (selectedClients.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        t.confirmBulkAddClientTraffic(String(trafficGb), formatNumber(selectedClients.length, language))
      );

    if (!confirmed) {
      return;
    }

    updateSelectedClientDrafts((draft) => ({
      ...draft,
      trafficLimitGb: String((Number.parseInt(draft.trafficLimitGb, 10) || 0) + trafficGb)
    }));
  }

  function renewSelectedClients() {
    const days = Math.max(Number.parseInt(bulkRenewDays, 10) || 0, 0);

    if (days === 0) {
      return;
    }

    if (selectedClients.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkRenewClients(String(days), formatNumber(selectedClients.length, language)));

    if (!confirmed) {
      return;
    }

    updateSelectedClientDrafts((draft) => ({
      ...draft,
      remainingDays: String((Number.parseInt(draft.remainingDays, 10) || 0) + days)
    }));
  }

  function resetSelectedClientsUsedTraffic() {
    if (selectedClients.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkResetClientUsedTraffic(formatNumber(selectedClients.length, language)));

    if (!confirmed) {
      return;
    }

    updateSelectedClientDrafts((draft) => ({
      ...draft,
      usedTrafficGb: '0'
    }));
  }

  function deleteSelectedClients() {
    selectedClients.forEach((client) => {
      onDeleteClient(createClientMetadataFromDraft(createDraftFromClient(client), client.generatedNodeCount, client.id));
    });
    setSelectedClientIds([]);
    setBulkDeleteConfirming(false);
  }

  function deleteClient(client: SubscriptionClientIdentity) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmDeleteClient(client.displayName));

    if (!confirmed) {
      return;
    }

    onDeleteClient(createClientMetadataFromDraft(createDraftFromClient(client), client.generatedNodeCount, client.id));
    setSelectedClientIds((current) => current.filter((id) => id !== client.id));
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
    setProfileDeleteConfirming(false);
    setDrawer({ type: 'closed' });
    setActiveWorkspace('profiles');
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = createSourceFromDraft(sourceDraft);
    const syncBudgetMaxFetchesPerDay = Math.max(Number.parseInt(sourceDraft.syncBudgetFetchesPerDay, 10) || 0, 0);
    const syncBudgetMaxBytesPerDay = Math.max(Number.parseInt(sourceDraft.syncBudgetMbPerDay, 10) || 0, 0) * 1024 * 1024;

    const accepted = await onImportSource({
      sourceId: nextSource.id,
      kind: sourceDraft.kind,
      name: nextSource.name,
      url: nextSource.url,
      providerAccountId: sourceDraft.providerAccountId.trim(),
      userAgent: sourceDraft.userAgent.trim() || 'OU-UI-Next/1.0',
      refreshIntervalMinutes: nextSource.rateLimitPerMinute,
      fetchTimeoutSeconds: nextSource.fetchTimeoutSeconds ?? 20,
      maxBodyBytes: nextSource.maxBodyBytes ?? 5 * 1024 * 1024,
      syncBudgetMaxFetchesPerDay,
      syncBudgetMaxBytesPerDay,
      includeFilter: sourceDraft.includeFilter.trim(),
      excludeFilter: sourceDraft.excludeFilter.trim(),
      dedupeKey: nextSource.dedupeKey,
      syncPolicy: {
        userAgent: sourceDraft.userAgent.trim() || 'OU-UI-Next/1.0',
        refreshIntervalMinutes: nextSource.rateLimitPerMinute,
        fetchTimeoutSeconds: nextSource.fetchTimeoutSeconds ?? 20,
        maxBodyBytes: nextSource.maxBodyBytes ?? 5 * 1024 * 1024
      },
      syncBudget: {
        providerAccountId: sourceDraft.providerAccountId.trim(),
        maxFetchesPerDay: syncBudgetMaxFetchesPerDay,
        maxBytesPerDay: syncBudgetMaxBytesPerDay
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
    setSourceDeleteConfirming(false);
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmDeleteSource(source.name));

    if (!confirmed) {
      return;
    }

    const accepted = await onDeleteSource(source);

    if (!accepted) {
      return;
    }

    setCustomSources((current) => current.filter((item) => item.id !== source.id));
    setSelectedSourceIds((current) => current.filter((id) => id !== source.id));
  }

  return (
    <ResponsivePage>
      <ResponsiveSection className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-[11px] font-black text-slate-600 [scrollbar-width:none] dark:text-white/65 max-md:-mx-1 max-md:px-1 max-md:[&::-webkit-scrollbar]:hidden">
          {(language === 'zh' ? ['导入节点源', '绑定订阅身份', '选择客户端格式', '复制导出链接'] : ['Import sources', 'Bind clients', 'Choose formats', 'Copy exports']).map((step, index) => (
            <span className="shrink-0 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]" key={step}>
              {index + 1}. {step}
            </span>
          ))}
        </div>
      </ResponsiveSection>

      <WorkspaceCockpit aria-label="订阅控制 cockpit">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside aria-label="订阅控制 rail" className="border-b border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r">
            <div className="flex flex-col gap-4 xl:sticky xl:top-0">
              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.operationalOverview}</p>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.operationalOverviewHint}</p>
                <MobileSummaryRail className="mt-3">
                  {t.operationalOverviewSteps.map((step, index) => (
                    <span
                      className="shrink-0 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-[11px] font-black text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65"
                      key={step}
                    >
                      {index + 1}. {step}
                    </span>
                  ))}
                </MobileSummaryRail>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {controlRailMetrics.map((metric) => (
                  <SummaryMetric key={metric.label} icon={metric.icon} label={metric.label} value={metric.value} />
                ))}
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

              <div className="flex flex-wrap gap-2">
                <WorkspaceButton active={activeWorkspace === 'clients'} label={t.clientsTab} onClick={() => setActiveWorkspace('clients')} />
                <WorkspaceButton active={activeWorkspace === 'sources'} label={t.sourcesTab} onClick={() => setActiveWorkspace('sources')} />
                <WorkspaceButton active={activeWorkspace === 'inventory'} label={t.inventoryTab} onClick={() => setActiveWorkspace('inventory')} />
                <WorkspaceButton active={activeWorkspace === 'providers'} label={t.providersTab} onClick={() => setActiveWorkspace('providers')} />
                <WorkspaceButton active={activeWorkspace === 'profiles'} label={profileT.tab} onClick={() => setActiveWorkspace('profiles')} />
                <WorkspaceButton active={activeWorkspace === 'exports'} label={t.exportsTab} onClick={() => setActiveWorkspace('exports')} />
              </div>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label="订阅工作区" className="min-h-0">
            <div className="space-y-4 p-4">
              <SubscriptionQuickLinks
                clients={clients}
                language={language}
                onCopyLink={(client) => copyText(createDefaultSubscriptionUrl(client))}
                onOpenLinks={openSubscriptionLinkDrawer}
                t={t}
              />

              <section className="stagger-2 rounded-xl border border-blue-200 bg-blue-50/45 p-4 dark:border-blue-300/15 dark:bg-blue-400/[0.04]">
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <SummaryMetric icon={Shuffle} label={t.clientCount} value={formatNumber(clients.length, language)} />
                  <SummaryMetric icon={Layers3} label={t.inventoryCount} value={formatNumber(inventoryNodes.length, language)} />
                  <SummaryMetric icon={FileSliders} label={profileT.tab} value={formatNumber(exportProfiles.length, language)} />
                </div>
                <PipelineReadinessPanel language={language} summary={pipelineReadinessSummary} t={t} />
              </section>

            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>

      {activeWorkspace === 'clients' ? (
        <DataSection title={t.clientTitle} hint={t.clientHint}>
          {clients.length === 0 ? (
            <EmptyState label={t.noClients} />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                <input
                  aria-label={t.clientSearch}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder={t.clientSearchPlaceholder}
                  type="search"
                  value={clientSearch}
                />
                <p className="whitespace-nowrap text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.clientSearchResult} {formatNumber(filteredClients.length, language)} / {formatNumber(clients.length, language)}
                </p>
              </div>
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                    <input
                      aria-label={t.selectVisibleClients}
                      checked={filteredClients.length > 0 && selectedVisibleClientCount === filteredClients.length}
                      className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                      onChange={toggleVisibleClientSelection}
                      type="checkbox"
                    />
                    {t.selectVisibleClients}
                  </label>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.selectedClients} {formatNumber(selectedClients.length, language)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={neutralActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={copySelectedSubscriptionUrls}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.bulkCopySubscriptionLinks}
                  </button>
                  <button
                    className={neutralActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={copySelectedAllFormatSubscriptionUrls}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.bulkCopyAllSubscriptionLinks}
                  </button>
                  <button
                    className={neutralActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={copySelectedSubscriptionDiagnostics}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.bulkCopySubscriptionDiagnostics}
                  </button>
                  <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                    <span className="whitespace-nowrap">{t.bulkAddTrafficAmount}</span>
                    <input
                      aria-label={t.bulkAddTrafficAmount}
                      className="w-16 bg-transparent text-right text-xs font-black text-slate-800 outline-none dark:text-white"
                      min={0}
                      onChange={(event) => setBulkTrafficGb(event.target.value)}
                      type="number"
                      value={bulkTrafficGb}
                    />
                  </label>
                  <button
                    className={blueActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={addTrafficToSelectedClients}
                    type="button"
                  >
                    {t.bulkAddTraffic}
                  </button>
                  <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                    <span className="whitespace-nowrap">{t.bulkRenewDays}</span>
                    <input
                      aria-label={t.bulkRenewDays}
                      className="w-16 bg-transparent text-right text-xs font-black text-slate-800 outline-none dark:text-white"
                      min={0}
                      onChange={(event) => setBulkRenewDays(event.target.value)}
                      type="number"
                      value={bulkRenewDays}
                    />
                  </label>
                  <button
                    className={skyActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={renewSelectedClients}
                    type="button"
                  >
                    {t.bulkRenewClients}
                  </button>
                  <button
                    className={skyActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={resetSelectedClientsUsedTraffic}
                    type="button"
                  >
                    {t.bulkResetUsedTraffic}
                  </button>
                  <button
                    className={emeraldActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={() => updateSelectedClientsEnabled(true)}
                    type="button"
                  >
                    {t.bulkEnableClients}
                  </button>
                  <button
                    className={amberActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={() => updateSelectedClientsEnabled(false)}
                    type="button"
                  >
                    {t.bulkDisableClients}
                  </button>
                  <button
                    className={dangerActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={bulkDeleteConfirming ? deleteSelectedClients : () => setBulkDeleteConfirming(true)}
                    type="button"
                  >
                    {bulkDeleteConfirming
                      ? t.confirmBulkDeleteClients(formatNumber(selectedClients.length, language))
                      : t.bulkDeleteClients}
                  </button>
                </div>
              </div>
              {selectedClients.length > 0 ? (
                <BulkClientImpactPreflight
                  language={language}
                  selectedCount={selectedClients.length}
                  summary={bulkClientImpactSummary}
                  t={t}
                />
              ) : null}
              {filteredClients.length === 0 ? (
                <EmptyState label={t.clientFilterEmpty} />
              ) : (
                <Table label={t.tableLabel(t.clientsTab)} minWidth="980px" scrollHint={t.tableScrollHint}>
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="w-12 px-5 py-3">{t.selectClient}</th>
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
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4">
                          <input
                            aria-label={`${t.selectClient} ${client.displayName}`}
                            checked={selectedClientIds.includes(client.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                            onChange={() => toggleClientSelection(client.id)}
                            type="checkbox"
                          />
                        </td>
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
                            <IconButton label={t.copySubscriptionLink} onClick={() => copyText(createDefaultSubscriptionUrl(client))}>
                              <Copy className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={t.copyAllSubscriptionLinks} onClick={() => copyClientAllFormatSubscriptionUrls(client)}>
                              <Copy className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={t.viewSubscriptionLinks} onClick={() => openSubscriptionLinkDrawer(client)}>
                              <FileSliders className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={t.viewMatchedNodes} onClick={() => openMatchedNodesDrawer(client)}>
                              <ListTree className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={t.edit} onClick={() => openClientDrawer(client)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              danger
                              label={t.delete}
                              onClick={() => deleteClient(client)}
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
            </>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'sources' ? (
        <DataSection title={t.sourcesTab}>
          {sources.length === 0 ? (
            <EmptyState label={t.noSources} />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                <input
                  aria-label={t.sourceSearch}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => setSourceSearch(event.target.value)}
                  placeholder={t.sourceSearchPlaceholder}
                  type="search"
                  value={sourceSearch}
                />
                <p className="whitespace-nowrap text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.sourceSearchResult} {formatNumber(filteredSources.length, language)} / {formatNumber(sources.length, language)}
                </p>
              </div>
              {filteredSources.length === 0 ? (
                <EmptyState label={t.sourceFilterEmpty} />
              ) : (
                <>
                  <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                        <input
                          aria-label={t.selectVisibleSources}
                          checked={filteredSources.length > 0 && selectedVisibleSourceCount === filteredSources.length}
                          className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                          onChange={toggleVisibleSourceSelection}
                          type="checkbox"
                        />
                        {t.selectVisibleSources}
                      </label>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.selectedSources} {formatNumber(selectedSources.length, language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={neutralActionButtonClass}
                        disabled={selectedSources.length === 0 || taskMutationBusy}
                        onClick={syncSelectedSources}
                        type="button"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.bulkSyncSources}
                      </button>
                      <button
                        className={dangerActionButtonClass}
                        disabled={selectedSources.length === 0 || taskMutationBusy}
                        onClick={sourceDeleteConfirming ? () => void deleteSelectedSources() : () => setSourceDeleteConfirming(true)}
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {sourceDeleteConfirming
                          ? t.confirmBulkDeleteSources(formatNumber(selectedSources.length, language))
                          : t.bulkDeleteSources}
                      </button>
                    </div>
                  </div>
                  {selectedSources.length > 0 ? (
                    <SourceImpactPreflight
                      language={language}
                      selectedCount={selectedSources.length}
                      summary={sourceImpactSummary}
                      t={t}
                    />
                  ) : null}
                  <Table label={t.tableLabel(t.sourcesTab)} minWidth="1120px" scrollHint={t.tableScrollHint}>
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-5 py-3">{t.selectSource}</th>
                        <th className="px-5 py-3">{t.sourceName}</th>
                        <th className="px-5 py-3">{t.sourceUrl}</th>
                        <th className="px-5 py-3">{t.syncPolicy}</th>
                        <th className="px-5 py-3">{t.syncBudget}</th>
                        <th className="px-5 py-3">{t.dedupePolicy}</th>
                        <th className="px-5 py-3">{t.sourceNodes}</th>
                        <th className="px-5 py-3">{t.sourceTraffic}</th>
                        <th className="px-5 py-3">{t.lastSync}</th>
                        <th className="px-5 py-3">{t.sourceStatus}</th>
                        <th className="px-5 py-3 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredSources.map((source) => (
                        <tr key={source.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-4">
                            <input
                              aria-label={`${t.selectSource} ${source.name}`}
                              checked={selectedSourceIds.includes(source.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleSourceSelection(source.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{source.name}</td>
                          <td className="px-5 py-4">
                            <p className="font-mono text-[11px] text-slate-500 dark:text-white/45">{source.url}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/35">{source.userAgent ?? 'OU-UI-Next/1.0'}</p>
                          </td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                            {formatNumber(source.refreshIntervalMinutes ?? source.rateLimitPerMinute, language)} min
                          </td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                            {source.syncBudget ? (
                              <>
                                <p>
                                  {formatNumber(source.syncBudget.usedFetches, language)}
                                  {' / '}
                                  {source.syncBudget.maxFetchesPerDay
                                    ? formatNumber(source.syncBudget.maxFetchesPerDay, language)
                                    : t.budgetUnlimited}{' '}
                                  {t.budgetFetchUnit}
                                </p>
                                <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-white/40">
                                  {formatBytes(source.syncBudget.usedBytes)}
                                  {' / '}
                                  {source.syncBudget.maxBytesPerDay ? formatBytes(source.syncBudget.maxBytesPerDay) : t.budgetUnlimited}
                                </p>
                                {source.providerAccountId ? (
                                  <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/35">{source.providerAccountId}</p>
                                ) : null}
                              </>
                            ) : (
                              '-'
                            )}
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
                              <IconButton label={t.syncNow} onClick={() => syncSource(source)}>
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
                </>
              )}
            </>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'inventory' ? (
        <DataSection title={t.inventoryTab}>
          {inventoryNodes.length === 0 ? (
            <EmptyState label={t.noInventory} />
          ) : (
            <>
              <div className="border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(11rem,1fr)_minmax(13rem,1.1fr)_minmax(9rem,0.8fr)_minmax(9rem,0.8fr)_minmax(9rem,0.8fr)]">
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventorySearch}</span>
                    <input
                      aria-label={t.inventorySearch}
                      className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, query: event.target.value }))}
                      placeholder={t.inventorySearchPlaceholder}
                      type="search"
                      value={inventoryFilters.query}
                    />
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventorySource}</span>
                    <select
                      aria-label={t.inventorySource}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, sourceId: event.target.value }))}
                      value={inventoryFilters.sourceId}
                    >
                      <option value="">{t.allInventorySources}</option>
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventoryClientRule}</span>
                    <select
                      aria-label={t.inventoryClientRule}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, clientId: event.target.value }))}
                      value={inventoryFilters.clientId}
                    >
                      <option value="">{t.allInventoryClients}</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventoryProtocol}</span>
                    <select
                      aria-label={t.inventoryProtocol}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, protocol: event.target.value }))}
                      value={inventoryFilters.protocol}
                    >
                      <option value="">{t.allInventoryProtocols}</option>
                      {inventoryProtocols.map((protocol) => (
                        <option key={protocol} value={protocol}>
                          {protocol.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventoryRegion}</span>
                    <input
                      aria-label={t.inventoryRegion}
                      className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, region: event.target.value }))}
                      placeholder="hk,sg"
                      value={inventoryFilters.region}
                    />
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.inventoryTags}</span>
                    <input
                      aria-label={t.inventoryTags}
                      className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setInventoryFilters((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="premium,streaming"
                      value={inventoryFilters.tags}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.inventorySearchResult} {formatNumber(filteredInventoryNodes.length, language)} / {formatNumber(inventoryNodes.length, language)}
                  </p>
                  {selectedInventoryClient ? (
                    <p className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                      {selectedInventoryClient.displayName}
                    </p>
                  ) : null}
                </div>
              </div>
              {filteredInventoryNodes.length === 0 ? (
                <EmptyState label={t.inventoryFilterEmpty} />
              ) : (
                <>
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                      <input
                        aria-label={t.selectVisibleInventoryNodes}
                        checked={filteredInventoryNodes.length > 0 && selectedVisibleInventoryNodeCount === filteredInventoryNodes.length}
                        className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                        onChange={toggleVisibleInventoryNodeSelection}
                        type="checkbox"
                      />
                      {t.selectVisibleInventoryNodes}
                    </label>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                      {t.selectedInventoryNodes} {formatNumber(selectedInventoryNodes.length, language)}
                    </p>
                  </div>
                  <button
                    className={neutralActionButtonClass}
                    disabled={selectedInventoryNodes.length === 0}
                    onClick={copySelectedInventoryNodeRawUrls}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.bulkCopyInventoryNodeLinks}
                  </button>
                </div>
                <Table label={t.tableLabel(t.inventoryTab)} minWidth="1040px" scrollHint={t.tableScrollHint}>
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="w-12 px-5 py-3">{t.selectInventoryNode}</th>
                      <th className="px-5 py-3">{t.nodeName}</th>
                      <th className="px-5 py-3">{t.protocol}</th>
                      <th className="px-5 py-3">{t.server}</th>
                      <th className="px-5 py-3">{t.tags}</th>
                      <th className="px-5 py-3">{t.origin}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {filteredInventoryNodes.map((node) => (
                      <tr key={node.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4">
                          <input
                            aria-label={`${t.selectInventoryNode} ${node.name}`}
                            checked={selectedInventoryNodeIds.includes(node.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                            onChange={() => toggleInventoryNodeSelection(node.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{node.name}</p>
                          <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-white/45">{node.status ?? 'unknown'} / {formatNumber(node.latencyMs, language)} ms</p>
                        </td>
                        <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{node.protocol}</td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{node.server}:{node.port}</td>
                        <td className="px-5 py-4"><TagList tags={node.tags} /></td>
                        <td className="px-5 py-4">
                          <p className="font-mono text-[11px] text-slate-500 dark:text-white/45">{node.sourceId}</p>
                          {node.inboundTag ? <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/35">{node.inboundTag}</p> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                </>
              )}
            </>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'providers' ? (
        <DataSection title={t.providersTab}>
          {providers.length === 0 ? (
            <EmptyState label={t.noProviders} />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                <input
                  aria-label={t.providerSearch}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => setProviderSearch(event.target.value)}
                  placeholder={t.providerSearchPlaceholder}
                  type="search"
                  value={providerSearch}
                />
                <p className="whitespace-nowrap text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.providerSearchResult} {formatNumber(filteredProviders.length, language)} / {formatNumber(providers.length, language)}
                </p>
              </div>
              {filteredProviders.length === 0 ? (
                <EmptyState label={t.providerFilterEmpty} />
              ) : (
                <>
                  <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                        <input
                          aria-label={t.selectVisibleProviders}
                          checked={filteredProviders.length > 0 && selectedVisibleProviderCount === filteredProviders.length}
                          className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                          onChange={toggleVisibleProviderSelection}
                          type="checkbox"
                        />
                        {t.selectVisibleProviders}
                      </label>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.selectedProviders} {formatNumber(selectedProviders.length, language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={neutralActionButtonClass}
                        disabled={selectedProviders.length === 0}
                        onClick={copySelectedProviderUrls}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.bulkCopyProviderUrls}
                      </button>
                      <GlowButton
                        className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={selectedProviders.length === 0 || taskMutationBusy}
                        onClick={generateSelectedProviderExportFiles}
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.bulkGenerateProviderExports}
                      </GlowButton>
                    </div>
                  </div>
                  {selectedProviders.length > 0 ? (
                    <ProviderGenerationImpactPreflight
                      language={language}
                      summary={providerGenerationImpactSummary}
                      t={t}
                    />
                  ) : null}
                  <ProviderTable
                    language={language}
                    onCopyProviderUrl={copyProviderUrl}
                    onGenerateProviderExportFiles={generateProviderExportFiles}
                    onToggleProviderSelection={toggleProviderSelection}
                    providers={filteredProviders}
                    selectedProviderIds={selectedProviderIds}
                    taskMutationBusy={taskMutationBusy}
                  />
                </>
              )}
            </>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'profiles' ? (
        <DataSection title={profileT.tab}>
          {exportProfiles.length === 0 ? (
            <EmptyState label={profileT.noProfiles} />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                <input
                  aria-label={profileT.search}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => {
                    setProfileDeleteConfirming(false);
                    setProfileSearch(event.target.value);
                  }}
                  placeholder={profileT.searchPlaceholder}
                  type="search"
                  value={profileSearch}
                />
                <p className="whitespace-nowrap text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {profileT.searchResult} {formatNumber(filteredExportProfiles.length, language)} / {formatNumber(exportProfiles.length, language)}
                </p>
              </div>
              {filteredExportProfiles.length === 0 ? (
                <EmptyState label={profileT.filterEmpty} />
              ) : (
                <>
                  <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                        <input
                          aria-label={profileT.selectVisibleProfiles}
                          checked={filteredExportProfiles.length > 0 && selectedVisibleProfileCount === filteredExportProfiles.length}
                          className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                          onChange={toggleVisibleProfileSelection}
                          type="checkbox"
                        />
                        {profileT.selectVisibleProfiles}
                      </label>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {profileT.selectedProfiles} {formatNumber(selectedProfiles.length, language)}
                      </p>
                    </div>
                    <button
                      className={dangerActionButtonClass}
                      disabled={selectedProfiles.length === 0 || taskMutationBusy}
                      onClick={profileDeleteConfirming ? deleteSelectedProfiles : () => setProfileDeleteConfirming(true)}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {profileDeleteConfirming
                        ? profileT.confirmBulkDeleteProfiles(formatNumber(selectedProfiles.length, language))
                        : profileT.bulkDeleteProfiles}
                    </button>
                  </div>
                  <Table label={t.tableLabel(profileT.tab)} minWidth="1040px" scrollHint={t.tableScrollHint}>
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-5 py-3">{profileT.selectProfile}</th>
                        <th className="px-5 py-3">{profileT.profileName}</th>
                        <th className="px-5 py-3">{profileT.profileClient}</th>
                        <th className="px-5 py-3">{profileT.outputFormats}</th>
                        <th className="px-5 py-3">{profileT.proxyGroups}</th>
                        <th className="px-5 py-3">{t.filter}</th>
                        <th className="px-5 py-3 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredExportProfiles.map((profile) => (
                        <tr key={profile.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-4">
                            <input
                              aria-label={`${profileT.selectProfile} ${profile.name}`}
                              checked={selectedProfileIds.includes(profile.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleProfileSelection(profile.id)}
                              type="checkbox"
                            />
                          </td>
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
                              <IconButton danger label={t.delete} onClick={() => deleteExportProfile(profile)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'exports' ? (
        <DataSection title={t.exportsTab}>
          {exportFiles.length === 0 ? (
            <EmptyState label={t.noExports} />
          ) : (
            <>
              <div className="border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(12rem,0.35fr)]">
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.exportSearch}</span>
                    <input
                      aria-label={t.exportSearch}
                      className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setExportFileFilters((current) => ({ ...current, query: event.target.value }))}
                      placeholder={t.exportSearchPlaceholder}
                      type="search"
                      value={exportFileFilters.query}
                    />
                  </label>
                  <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.exportFormat}</span>
                    <select
                      aria-label={t.exportFormat}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                      onChange={(event) => setExportFileFilters((current) => ({ ...current, format: event.target.value }))}
                      value={exportFileFilters.format}
                    >
                      <option value="">{t.allExportFormats}</option>
                      {exportFileFormats.map((format) => (
                        <option key={format} value={format}>
                          {getClientFormatLabel(format, language)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.exportSearchResult} {formatNumber(filteredExportFiles.length, language)} / {formatNumber(exportFiles.length, language)}
                </p>
              </div>
              {filteredExportFiles.length === 0 ? (
                <EmptyState label={t.exportFilterEmpty} />
              ) : (
                <>
                  <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.015] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                        <input
                          aria-label={t.selectVisibleExportFiles}
                          checked={filteredExportFiles.length > 0 && selectedVisibleExportFileCount === filteredExportFiles.length}
                          className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                          onChange={toggleVisibleExportFileSelection}
                          type="checkbox"
                        />
                        {t.selectVisibleExportFiles}
                      </label>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.selectedExportFiles} {formatNumber(selectedExportFiles.length, language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={neutralActionButtonClass}
                        disabled={selectedExportFiles.length === 0}
                        onClick={copySelectedExportFileSubscriptionUrls}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.bulkCopyExportLinks}
                      </button>
                      <GlowButton
                        className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={selectedExportFiles.length === 0 || taskMutationBusy}
                        onClick={generateSelectedExportFiles}
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.bulkGenerateExportFiles}
                      </GlowButton>
                    </div>
                  </div>
                  {selectedExportFiles.length > 0 ? (
                    <ExportGenerationImpactPreflight
                      language={language}
                      summary={exportGenerationImpactSummary}
                      t={t}
                    />
                  ) : null}
                  <Table label={t.tableLabel(t.exportsTab)} minWidth="1080px" scrollHint={t.tableScrollHint}>
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-5 py-3">{t.selectExportFile}</th>
                        <th className="px-5 py-3">{t.exportName}</th>
                        <th className="px-5 py-3">{t.template}</th>
                        <th className="px-5 py-3">{t.formats}</th>
                        <th className="px-5 py-3">{t.tags}</th>
                        <th className="px-5 py-3">{t.trafficLimit}</th>
                        <th className="px-5 py-3">{t.accessToken}</th>
                        <th className="px-5 py-3 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredExportFiles.map((file) => (
                        <tr key={file.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-4">
                            <input
                              aria-label={`${t.selectExportFile} ${file.name}`}
                              checked={selectedExportFileIds.includes(file.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleExportFileSelection(file.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{file.name}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.subId}</p>
                            {file.exportProfileName ? (
                              <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">{file.exportProfileName}</p>
                            ) : null}
                          </td>
                          <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{file.templateName}</td>
                          <td className="px-5 py-4"><TagList tags={file.formats.map((format) => getClientFormatLabel(format, language))} /></td>
                          <td className="px-5 py-4"><TagList tags={file.selectedTags} /></td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                            <p>{formatBytes(file.trafficLimitBytes)}</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatDateTime(file.expiresAt, language)}</p>
                          </td>
                          <td className="px-5 py-4 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.accessTokenPreview}</td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                className={neutralActionButtonClass}
                                onClick={() => copyExportFileSubscriptionUrl(file)}
                                type="button"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                {t.copyExportLink}
                              </button>
                              <GlowButton
                                className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={taskMutationBusy}
                                onClick={() => generateExportFile(file)}
                              >
                                <RefreshCcw className="h-3.5 w-3.5" />
                                {t.generate}
                              </GlowButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </DataSection>
      ) : null}

      <ConfigDrawer
        open={drawer.type === 'client'}
        returnFocusRef={returnFocusRef}
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
              label={t.trafficFilter}
              value={clientDraft.trafficFilter}
              onChange={(value) => setClientDraft((current) => ({ ...current, trafficFilter: isTrafficFilterValue(value) ? value : '' }))}
              options={trafficFilterOptions}
            />
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
        open={drawer.type === 'links'}
        returnFocusRef={returnFocusRef}
        title={linkDrawerClient ? t.subscriptionLinksTitle(linkDrawerClient.displayName) : t.preview}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {linkDrawerClient ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-400/25 dark:bg-blue-400/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-blue-800 dark:text-blue-200">
                  {t.subscriptionUsageHeader}
                </p>
                <button
                  className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white/70 px-3 text-xs font-bold text-blue-700 transition hover:bg-white dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15"
                  onClick={() => copyText(createSubscriptionUsageHeaderLine(linkDrawerClient))}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copySubscriptionUsageHeader}
                </button>
              </div>
              <p className="mt-3 break-all rounded-lg bg-white/75 p-3 font-mono text-[11px] leading-5 text-blue-900 dark:bg-black/20 dark:text-blue-100">
                {createSubscriptionUsageHeaderValue(linkDrawerClient)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/75 p-3 dark:border-white/10 dark:bg-black/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-white/75">
                  {t.subscriptionAccessStats}
                </p>
                <button
                  className={compactNeutralActionButtonClass}
                  onClick={() => copyText(createSubscriptionDiagnosticsText(linkDrawerClient))}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copySubscriptionDiagnostics}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <SubscriptionDiagnosticField
                  label={t.lastOnline}
                  value={linkDrawerClient.lastOnlineAt ? formatDateTime(linkDrawerClient.lastOnlineAt, language) : '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.lastGenerated}
                  value={linkDrawerClient.lastGeneratedAt ? formatDateTime(linkDrawerClient.lastGeneratedAt, language) : '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.generatedNodes}
                  value={formatNumber(linkDrawerClient.generatedNodeCount, language)}
                />
                <SubscriptionDiagnosticField
                  label={t.requestLimitShort}
                  value={`${formatNumber(linkDrawerClient.requestLimitPerHour ?? 360, language)} req/h`}
                />
                <SubscriptionDiagnosticField
                  label={t.quotaReset}
                  value={linkDrawerClient.quotaResetAt ? formatDateTime(linkDrawerClient.quotaResetAt, language) : '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.guardrailStatus}
                  value={createSubscriptionGuardrailStatus(linkDrawerClient)}
                />
              </div>
            </div>
            {linkDrawerClient.formats.map((format) => {
              const label = getClientFormatLabel(format, language);
              const url = createClientSubscriptionUrl(linkDrawerClient, format);
              const qrLabel = t.qrCodeLabel(label);

              return (
                <div key={format} className="rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-white/75">{label}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={compactNeutralActionButtonClass}
                        onClick={() => copyText(url)}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.copyFormatLink(label)}
                      </button>
                      <button
                        className="inline-flex min-h-8 items-center justify-center rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 transition hover:bg-sky-50 dark:border-sky-400/30 dark:text-sky-300 dark:hover:bg-sky-400/10"
                        onClick={() => openExternalLink(url)}
                        type="button"
                      >
                        {t.openFormatLink(label)}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <p className="break-all rounded-lg bg-slate-50/80 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-white/[0.03] dark:text-white/55">
                      {url}
                    </p>
                    <SubscriptionQrCode
                      alt={qrLabel}
                      downloadLabel={t.downloadQrCode(label)}
                      filename={createSubscriptionQrFilename(linkDrawerClient, format)}
                      pendingLabel={t.qrCodeUnavailable}
                      url={url}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        open={drawer.type === 'nodes'}
        returnFocusRef={returnFocusRef}
        title={nodeDrawerClient ? t.matchedNodesTitle(nodeDrawerClient.displayName) : t.matchedNodes}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {nodeDrawerClient ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/45">
                {t.matchedNodesSummary(
                  formatNumber(nodeDrawerMatches.length, language),
                  formatNumber(inventoryNodes.length, language)
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 text-xs font-bold text-blue-700 transition hover:bg-white dark:border-blue-400/30 dark:text-blue-300 dark:hover:bg-blue-400/10"
                  onClick={() => viewClientInInventory(nodeDrawerClient)}
                  type="button"
                >
                  <ListTree className="h-3.5 w-3.5" />
                  {t.viewInInventory}
                </button>
                <button
                  className={compactNeutralActionButtonClass}
                  disabled={!nodeDrawerMatches.some((node) => node.rawUrl)}
                  onClick={() => copyMatchedNodeRawUrls(nodeDrawerMatches)}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copyAllNodeLinks}
                </button>
              </div>
            </div>

            {nodeDrawerSources.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-white/75">{t.matchedSources}</p>
                  <button
                    className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-sky-400/30 dark:text-sky-300 dark:hover:bg-sky-400/10"
                    disabled={!nodeDrawerSources.some((item) => item.source)}
                    onClick={syncMatchedSources}
                    type="button"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t.syncMatchedSources}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {nodeDrawerSources.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            {item.source?.name ?? item.id}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-white/45">
                            {(item.source?.status ?? t.missingSource)} / {formatNumber(item.nodeCount, language)} {t.matchedNodes}
                          </p>
                          {item.source ? (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                              {t.lastSync}: {formatDateTime(item.source.lastSyncAt, language)}
                            </p>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/45">
                          {item.id}
                        </span>
                      </div>
                      {item.source?.syncWarnings?.length ? (
                        <div className="mt-2 space-y-1 text-xs font-semibold text-amber-600 dark:text-amber-300/80">
                          {item.source.syncWarnings.slice(0, 2).map((warning) => (
                            <p key={warning}>{formatSourceSyncWarning(warning, language)}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {nodeDrawerExportFiles.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20">
                <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-white/75">{t.relatedExportFiles}</p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {nodeDrawerExportFiles.map((file) => (
                    <div key={file.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{file.name}</p>
                          <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.templateName}</p>
                          {file.exportProfileName ? (
                            <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">{file.exportProfileName}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={compactNeutralActionButtonClass}
                            onClick={() => copyExportFileSubscriptionUrl(file)}
                            type="button"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {t.copyExportLink}
                          </button>
                          <GlowButton
                            className="px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={taskMutationBusy}
                            onClick={() => generateExportFile(file)}
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            {t.generate}
                          </GlowButton>
                        </div>
                      </div>
                      <div className="mt-3">
                        <TagList tags={file.formats.map((format) => getClientFormatLabel(format, language))} />
                      </div>
                      <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-white/45">
                        {formatBytes(file.trafficLimitBytes)} / {formatDateTime(file.expiresAt, language)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {nodeDrawerMatches.length === 0 ? (
              <EmptyState label={t.noInventory} />
            ) : (
              <div className="space-y-3">
                {nodeDrawerMatches.map((node) => (
                  <div key={node.id} className="rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white">{node.name}</p>
                        <p className="mt-1 font-mono text-xs text-slate-600 dark:text-white/60">
                          {node.protocol.toUpperCase()} / {node.server}:{node.port}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-white/45">
                          {node.status ?? 'unknown'} / {formatNumber(node.latencyMs, language)} ms / {node.sourceId}
                        </p>
                      </div>
                      <button
                        className={compactNeutralActionButtonClass}
                        disabled={!node.rawUrl}
                        onClick={() => copyNodeRawUrl(node)}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.copyNodeLink}
                      </button>
                    </div>
                    <div className="mt-3">
                      <TagList tags={node.tags} />
                    </div>
                    <p className="mt-3 break-all rounded-lg bg-slate-50/80 p-3 font-mono text-[11px] leading-5 text-slate-600 dark:bg-white/[0.03] dark:text-white/55">
                      {node.rawUrl || t.noNodeLink}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        open={drawer.type === 'profile'}
        returnFocusRef={returnFocusRef}
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
        returnFocusRef={returnFocusRef}
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
          <InputField
            label={t.providerAccount}
            value={sourceDraft.providerAccountId}
            onChange={(value) => setSourceDraft((current) => ({ ...current, providerAccountId: value }))}
          />
          <InputField label={t.userAgent} value={sourceDraft.userAgent} onChange={(value) => setSourceDraft((current) => ({ ...current, userAgent: value }))} />
          <InputField label={t.refreshInterval} suffix="min" type="number" value={sourceDraft.refreshInterval} onChange={(value) => setSourceDraft((current) => ({ ...current, refreshInterval: value }))} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField
              label={t.fetchTimeout}
              suffix="s"
              type="number"
              value={sourceDraft.fetchTimeoutSeconds}
              onChange={(value) => setSourceDraft((current) => ({ ...current, fetchTimeoutSeconds: value }))}
            />
            <InputField
              label={t.maxBodySize}
              suffix="MiB"
              type="number"
              value={sourceDraft.maxBodyMb}
              onChange={(value) => setSourceDraft((current) => ({ ...current, maxBodyMb: value }))}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField
              label={t.dailyFetchBudget}
              type="number"
              value={sourceDraft.syncBudgetFetchesPerDay}
              onChange={(value) => setSourceDraft((current) => ({ ...current, syncBudgetFetchesPerDay: value }))}
            />
            <InputField
              label={t.dailyByteBudget}
              suffix="MiB"
              type="number"
              value={sourceDraft.syncBudgetMbPerDay}
              onChange={(value) => setSourceDraft((current) => ({ ...current, syncBudgetMbPerDay: value }))}
            />
          </div>
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
    </ResponsivePage>
  );
}

function SubscriptionDiagnosticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-words font-mono text-[11px] font-bold leading-5 text-slate-800 dark:text-white/75">{value}</p>
    </div>
  );
}

function ProviderTable({
  language,
  onCopyProviderUrl,
  onGenerateProviderExportFiles,
  onToggleProviderSelection,
  providers,
  selectedProviderIds,
  taskMutationBusy
}: {
  language: AppLanguage;
  onCopyProviderUrl: (provider: ProxyProviderConfig) => void;
  onGenerateProviderExportFiles: (provider: ProxyProviderConfig) => void;
  onToggleProviderSelection: (providerId: string) => void;
  providers: ProxyProviderConfig[];
  selectedProviderIds: string[];
  taskMutationBusy: boolean;
}) {
  const t = copy[language];

  return (
    <Table label={t.tableLabel(t.providersTab)} minWidth="1280px" scrollHint={t.tableScrollHint}>
      <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
        <tr>
          <th className="w-12 px-5 py-3">{t.selectProvider}</th>
          <th className="px-5 py-3">{t.providerName}</th>
          <th className="px-5 py-3">{t.providerUrl}</th>
          <th className="px-5 py-3">{t.filter}</th>
          <th className="px-5 py-3">{t.excludeFilter}</th>
          <th className="px-5 py-3">{t.regionFilter}</th>
          <th className="px-5 py-3">{t.processMode}</th>
          <th className="px-5 py-3">{t.overrideRule}</th>
          <th className="px-5 py-3">{t.actions}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-white/10">
        {providers.map((provider) => (
          <tr key={provider.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
            <td className="px-5 py-4">
              <input
                aria-label={`${t.selectProvider} ${provider.name}`}
                checked={selectedProviderIds.includes(provider.id)}
                className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                onChange={() => onToggleProviderSelection(provider.id)}
                type="checkbox"
              />
            </td>
            <td className="px-5 py-4">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{provider.name}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{provider.externalSubscriptionId}</p>
            </td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{createProxyProviderUrl(provider)}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.filter}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.excludeFilter}</td>
            <td className="px-5 py-4"><TagList tags={splitComma(provider.geoIpFilter)} /></td>
            <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{provider.processMode}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.overrideRule}</td>
            <td className="px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <button
                  aria-label={`${t.copyProviderUrl} ${provider.name}`}
                  className={compactNeutralActionButtonClass}
                  onClick={() => onCopyProviderUrl(provider)}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copyProviderUrl}
                </button>
                <GlowButton
                  aria-label={`${t.generateProviderExports} ${provider.name}`}
                  className="px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={taskMutationBusy}
                  onClick={() => onGenerateProviderExportFiles(provider)}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t.generateProviderExports}
                </GlowButton>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SubscriptionQuickLinks({
  clients,
  language,
  onCopyLink,
  onOpenLinks,
  t
}: {
  clients: SubscriptionClientIdentity[];
  language: AppLanguage;
  onCopyLink: (client: SubscriptionClientIdentity) => void;
  onOpenLinks: (client: SubscriptionClientIdentity) => void;
  t: (typeof copy)[AppLanguage];
}) {
  if (clients.length === 0) {
    return null;
  }

  return (
    <section aria-label={t.quickLinksTitle} className="stagger-2 grid grid-cols-1 gap-4 xl:grid-cols-2">
      {clients.map((client) => {
        const url = createDefaultSubscriptionUrl(client);
        const formatLabel = getClientFormatLabel('plain', language);

        return (
          <article
            aria-label={client.displayName}
            className="rounded-lg border border-slate-200 bg-white/75 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
            key={client.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-black text-slate-900 dark:text-white">
                    {client.displayName} · {formatLabel}
                  </h4>
                  <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-200">
                    {client.enabled ? t.enabled : t.disabled}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-600 dark:text-white/55">
                  <span>{client.customerName ?? client.email}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t.quickLinkNodeCount(formatNumber(client.generatedNodeCount, language))}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  aria-label={`${t.copySubscriptionLink} ${client.displayName}`}
                  className={compactNeutralActionButtonClass}
                  onClick={() => onCopyLink(client)}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copySubscriptionLink}
                </button>
                <button
                  aria-label={`${t.viewSubscriptionLinks} ${client.displayName}`}
                  className={compactNeutralActionButtonClass}
                  onClick={() => onOpenLinks(client)}
                  type="button"
                >
                  <FileSliders className="h-3.5 w-3.5" />
                  {t.viewSubscriptionLinks}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {formatLabel}
                  </p>
                  <p className="mt-1 break-all rounded-lg bg-slate-50/80 p-3 font-mono text-[11px] leading-5 text-slate-700 dark:bg-white/[0.035] dark:text-white/65">
                    {url}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <MiniMetric label={t.usedTraffic} value={`${formatBytes(client.usedTrafficBytes)} / ${formatBytes(client.trafficLimitBytes)}`} />
                  <MiniMetric label={t.expires} value={formatDateTime(client.expiresAt, language)} />
                  <MiniMetric label={t.formats} value={client.formats.map((format) => getClientFormatLabel(format, language)).join(', ')} />
                </div>
              </div>
              <SubscriptionQrCode
                alt={t.quickLinkQrLabel(client.displayName)}
                downloadLabel={t.downloadQrCode(formatLabel)}
                filename={createSubscriptionQrFilename(client, 'plain')}
                pendingLabel={t.qrCodeUnavailable}
                url={url}
              />
            </div>
          </article>
        );
      })}
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white/70 p-2 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-slate-800 dark:text-white/80" title={value}>
        {value}
      </p>
    </div>
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

function Table({ children, label, minWidth, scrollHint }: { children: ReactNode; label: string; minWidth: string; scrollHint: string }) {
  return (
    <div
      aria-label={label}
      className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40"
      role="region"
      tabIndex={0}
    >
      <p className="sr-only">{scrollHint}</p>
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
  icon: LucideIcon;
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

function PipelineReadinessPanel({
  language,
  summary,
  t
}: {
  language: AppLanguage;
  summary: PipelineReadinessSummary;
  t: (typeof copy)[AppLanguage];
}) {
  const stageSummary = t.pipelineStageSummary(
    formatNumber(summary.stageCounts.sources, language),
    formatNumber(summary.stageCounts.nodes, language),
    formatNumber(summary.stageCounts.providers, language),
    formatNumber(summary.stageCounts.exports, language),
    formatNumber(summary.stageCounts.clients, language)
  );

  return (
    <section
      aria-label={t.pipelineReadiness}
      className="mt-4 rounded-xl border border-blue-200 bg-blue-50/45 p-4 dark:border-blue-300/15 dark:bg-blue-400/[0.04]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">{t.pipelineReadiness}</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">{t.pipelineReadinessHint}</p>
          <p className="mt-3 text-xs font-bold text-slate-700 dark:text-white/70">{stageSummary}</p>
          {summary.exportLabels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.exportLabels.map((label) => (
                <span
                  className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/70"
                  key={label}
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[34rem]">
          <BulkImpactMetric
            label={t.pipelineCompleteness}
            value={`${formatNumber(summary.completeStages, language)} / ${formatNumber(summary.totalStages, language)}`}
          />
          <BulkImpactMetric label={t.pipelinePublishableExports} value={formatNumber(summary.publishableExportCount, language)} />
          <BulkImpactMetric label={t.pipelineUsableNodes} value={formatNumber(summary.usableNodeCount, language)} />
          <BulkImpactMetric label={t.pipelineRiskSources} value={formatNumber(summary.riskSourceCount, language)} />
        </div>
      </div>
    </section>
  );
}

function BulkClientImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: BulkClientImpactSummary;
  t: (typeof copy)[AppLanguage];
}) {
  const nodePreview = summary.matchedNodes.slice(0, 4);
  const riskPreview = summary.guardrailRisks.slice(0, 3);

  return (
    <section
      aria-label={t.bulkImpactPreflight}
      className="border-b border-slate-200 bg-blue-50/45 px-4 py-4 dark:border-white/10 dark:bg-blue-400/[0.04]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">
            {t.bulkImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">{t.bulkImpactHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.customerLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.customerLabels.length > 4 ? (
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.customerLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[34rem]">
          <BulkImpactMetric label={t.bulkImpactCustomers} value={formatNumber(summary.customerLabels.length, language)} />
          <BulkImpactMetric label={t.bulkImpactNodes} value={formatNumber(summary.matchedNodes.length, language)} />
          <BulkImpactMetric label={t.bulkImpactSources} value={formatNumber(summary.matchedSources.length, language)} />
          <BulkImpactMetric label={t.bulkImpactUsedTraffic} value={formatBytes(summary.usedTrafficBytes)} />
          <BulkImpactMetric label={t.selectedClients} value={formatNumber(selectedCount, language)} />
          <BulkImpactMetric label={t.bulkImpactGuardrailRisks} value={formatNumber(summary.guardrailRisks.length, language)} />
          <BulkImpactMetric label={t.bulkImpactExpiring} value={formatNumber(summary.expiringClientCount, language)} />
          <BulkImpactMetric label={t.bulkImpactDisabled} value={formatNumber(summary.disabledClientCount, language)} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BulkImpactPreview title={t.bulkImpactCustomerPreview} values={summary.customerLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.bulkImpactNodePreview} values={nodePreview.map((node) => node.name)} />
        <BulkImpactPreview title={t.bulkImpactRiskPreview} values={riskPreview.length > 0 ? riskPreview : [t.bulkImpactNoRisk]} warning={riskPreview.length > 0} />
      </div>
    </section>
  );
}

function SourceImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: SourceImpactSummary;
  t: (typeof copy)[AppLanguage];
}) {
  const riskPreview = summary.riskLabels.slice(0, 5);
  const fetchBudgetLabel =
    summary.maxFetches > 0
      ? `${formatNumber(summary.usedFetches, language)} / ${formatNumber(summary.maxFetches, language)}`
      : t.budgetUnlimited;

  return (
    <section
      aria-label={t.sourceImpactPreflight}
      className="border-b border-slate-200 bg-blue-50/45 px-4 py-4 dark:border-white/10 dark:bg-blue-400/[0.04]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">
            {t.sourceImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">{t.sourceImpactHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.sourceLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.sourceLabels.length > 4 ? (
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.sourceLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[34rem]">
          <BulkImpactMetric label={t.selectedSources} value={formatNumber(selectedCount, language)} />
          <BulkImpactMetric label={t.sourceImpactNodes} value={formatNumber(summary.nodeCount, language)} />
          <BulkImpactMetric label={t.sourceImpactRiskSources} value={formatNumber(summary.riskSourceCount, language)} />
          <BulkImpactMetric label={t.sourceImpactWarnings} value={formatNumber(summary.warningCount, language)} />
          <BulkImpactMetric label={t.sourceImpactFetchBudget} value={fetchBudgetLabel} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BulkImpactPreview title={t.sourceImpactSourcePreview} values={summary.sourceLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.sourceImpactNodePreview} values={summary.nodeLabels.slice(0, 5)} />
        <BulkImpactPreview
          title={t.sourceImpactRiskPreview}
          values={riskPreview.length > 0 ? riskPreview : [t.sourceImpactNoRisk]}
          warning={riskPreview.length > 0}
        />
      </div>
    </section>
  );
}

function ExportGenerationImpactPreflight({
  language,
  summary,
  t
}: {
  language: AppLanguage;
  summary: ExportGenerationImpactSummary;
  t: (typeof copy)[AppLanguage];
}) {
  return (
    <section
      aria-label={t.exportImpactPreflight}
      className="border-b border-slate-200 bg-blue-50/45 px-4 py-4 dark:border-white/10 dark:bg-blue-400/[0.04]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">
            {t.exportImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">{t.exportImpactHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.exportLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.exportLabels.length > 4 ? (
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.exportLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[34rem]">
          <BulkImpactMetric label={t.exportImpactFiles} value={formatNumber(summary.fileCount, language)} />
          <BulkImpactMetric label={t.exportImpactClients} value={formatNumber(summary.clientCount, language)} />
          <BulkImpactMetric label={t.exportImpactFormats} value={formatNumber(summary.formatCount, language)} />
          <BulkImpactMetric label={t.exportImpactProviders} value={formatNumber(summary.providerReferenceCount, language)} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BulkImpactPreview title={t.exportImpactExportPreview} values={summary.exportLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactClientPreview} values={summary.clientLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactFormatPreview} values={[summary.formatLabels.join(' / ')]} />
      </div>
    </section>
  );
}

function ProviderGenerationImpactPreflight({
  language,
  summary,
  t
}: {
  language: AppLanguage;
  summary: ProviderGenerationImpactSummary;
  t: (typeof copy)[AppLanguage];
}) {
  return (
    <section
      aria-label={t.providerImpactPreflight}
      className="border-b border-slate-200 bg-blue-50/45 px-4 py-4 dark:border-white/10 dark:bg-blue-400/[0.04]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">
            {t.providerImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">{t.providerImpactHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.providerLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.providerLabels.length > 4 ? (
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-blue-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.providerLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[34rem]">
          <BulkImpactMetric label={t.providerImpactProviders} value={formatNumber(summary.providerCount, language)} />
          <BulkImpactMetric label={t.providerImpactRelatedExports} value={formatNumber(summary.fileCount, language)} />
          <BulkImpactMetric label={t.exportImpactClients} value={formatNumber(summary.clientCount, language)} />
          <BulkImpactMetric label={t.exportImpactFormats} value={formatNumber(summary.formatCount, language)} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BulkImpactPreview title={t.providerImpactProviderPreview} values={summary.providerLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactExportPreview} values={summary.exportLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactFormatPreview} values={[summary.formatLabels.join(' / ')]} />
      </div>
    </section>
  );
}

function BulkImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-blue-200 bg-white/80 px-3 py-2 dark:border-blue-300/15 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-slate-900 dark:text-white">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function BulkImpactPreview({ title, values, warning = false }: { title: string; values: string[]; warning?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-blue-200 bg-white/70 p-3 dark:border-blue-300/15 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-amber-700 dark:text-amber-200' : 'mt-2 space-y-1 text-slate-700 dark:text-white/70'}>
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function SubscriptionQrCode({
  alt,
  downloadLabel,
  filename,
  pendingLabel,
  url
}: {
  alt: string;
  downloadLabel: string;
  filename: string;
  pendingLabel: string;
  url: string;
}) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let stale = false;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    setDataUrl('');

    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 160
    })
      .then((nextDataUrl) => {
        updateTimer = setTimeout(() => {
          if (!stale) {
            setDataUrl(nextDataUrl);
          }
        }, 0);
      })
      .catch(() => {
        updateTimer = setTimeout(() => {
          if (!stale) {
            setDataUrl('');
          }
        }, 0);
      });

    return () => {
      stale = true;
      if (updateTimer) {
        clearTimeout(updateTimer);
      }
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {dataUrl ? (
        <img alt={alt} className="h-32 w-32 rounded bg-white p-2 shadow-sm" height={128} src={dataUrl} width={128} />
      ) : (
        <div className="grid h-32 w-32 place-items-center rounded bg-white p-2 text-center text-[10px] font-bold text-slate-400 shadow-sm">
          {pendingLabel}
        </div>
      )}
      <a
        aria-disabled={!dataUrl}
        className={`${compactNeutralActionButtonClass} aria-disabled:pointer-events-none aria-disabled:opacity-50`}
        download={filename}
        href={dataUrl || '#'}
      >
        <Download className="h-3.5 w-3.5" />
        {downloadLabel}
      </a>
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
          ? 'rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-400/30 dark:hover:bg-rose-400/10 dark:focus-visible:ring-rose-400/40'
          : 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary dark:focus-visible:ring-primary/40'
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
        className="ou-select mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
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
