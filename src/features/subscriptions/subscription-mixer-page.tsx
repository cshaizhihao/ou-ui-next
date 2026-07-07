import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import QRCode from 'qrcode';
import {
  Copy,
  Download,
  FileSliders,
  Layers3,
  ListTree,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import {
  ResponsivePage,
  ResponsiveSection,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
import { EditableCardFrame, EditableCardStage } from '../../components/layout/editable-card-frame';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import { applySubscriptionSourceRules, selectSubscriptionInventoryNodes } from '../../domain';
import { copyText as copyToClipboard } from '../../lib/copy';
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

type SubscriptionDeliveryState = 'ready' | 'warning' | 'blocked';

type SubscriptionDeliveryBrief = {
  state: SubscriptionDeliveryState;
  statusLabel: string;
  reasonText: string;
  reasons: string[];
  nextAction: string;
  outputFormats: SubscriptionClientOutputFormat[];
  outputFormatLabel: string;
  usageValue: string;
  requestLimitValue: string;
  portalUrl: string;
};

type SubscriptionDeliveryCheckState = 'idle' | 'running' | 'passed' | 'warning' | 'failed';

type SubscriptionDeliveryCheckTargetKind = 'portal' | 'format';

type SubscriptionDeliveryCheckTarget = {
  id: string;
  kind: SubscriptionDeliveryCheckTargetKind;
  label: string;
  url: string;
  status?: number;
  ok?: boolean;
  contentType?: string;
  subscriptionUserinfo?: string;
  nodeCount?: string;
  selectedNodeCount?: string;
  convertedUriCount?: string;
  unconvertedNodeCount?: string;
  conversionWarning?: string;
  producer?: string;
  error?: string;
};

type SubscriptionDeliveryCheckResult = {
  clientId: string;
  state: SubscriptionDeliveryCheckState;
  checkedAt?: string;
  summary: string;
  targets: SubscriptionDeliveryCheckTarget[];
};

type SourceSyncDiagnosisState = 'ready' | 'warning' | 'failed' | 'paused' | 'syncing';

type SourceSyncWarningDetail = {
  raw: string;
  label: string;
  nextAction: string;
  severity: 'warning' | 'failed';
};

type SourceSyncDiagnosis = {
  state: SourceSyncDiagnosisState;
  stateLabel: string;
  summary: string;
  nextAction: string;
  warnings: SourceSyncWarningDetail[];
  budgetWarnings: string[];
  fetchBudgetLabel: string;
  byteBudgetLabel: string;
  remoteLabel: string;
  rulesLabel: string;
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

export type SubscriptionClientOutputFormat =
  | 'clash'
  | 'mihomo'
  | 'v2ray'
  | 'sing-box'
  | 'uri'
  | 'shadowrocket'
  | 'stash';

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
  | { type: 'source-diagnostics'; sourceId: string }
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
  accessTokenPreview: string;
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
  outputFormats: SubscriptionClientOutputFormat[];
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

type ExportGroupDraft = {
  id: string;
  name: string;
  strategy: ProxyGroupTemplate['strategy'];
  filterTags: string;
  nodeIds: string[];
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
  proxyGroups: ExportGroupDraft[];
  includeTrafficHeaders: boolean;
};

const copy = {
  zh: {
    title: '订阅管理',
    clientsTab: '订阅身份',
    sourcesTab: '外部订阅源',
    inventoryTab: '节点库存',
    providersTab: '代理集合',
    exportsTab: '导出文件',
    tableLabel: (title: string) => `${title} 数据表`,
    addClient: '新增订阅身份',
    importSource: '导入订阅源',
    clientCount: '订阅身份',
    inventoryCount: '节点库存',
    exportCount: '导出文件',
    clientTitle: '客户订阅规则',
    clientHint: '',
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
    portalLink: '门户链接',
    copyPortalLink: '复制门户链接',
    openPortalLink: '打开门户链接',
    subscriptionUsageHeader: 'Subscription-Userinfo',
    copySubscriptionUsageHeader: '复制订阅用量头',
    subscriptionAccessStats: '访问统计',
    copySubscriptionDiagnostics: '复制订阅诊断',
    rotateAccessCredential: '轮换公开路径',
    confirmRotateAccessCredential: (name: string) => `确认轮换 ${name} 的公开路径？旧订阅地址将失效；不会生成新的 raw token。`,
    lastOnline: '上次在线',
    lastGenerated: '上次生成',
    generatedNodes: '生成节点',
    requestLimitShort: '请求上限',
    quotaReset: '重置窗口',
    guardrailStatus: '守护状态',
    subscriptionDeliveryBrief: '交付状态',
    subscriptionDeliveryState: '访问状态',
    subscriptionDeliveryNextAction: '下一步',
    subscriptionDeliveryFormats: '输出格式',
    subscriptionDeliveryUsage: '用量',
    subscriptionDeliveryReady: '可交付',
    subscriptionDeliveryWarning: '需关注',
    subscriptionDeliveryBlocked: '已阻断',
    subscriptionDeliveryReasonReady: '门户和订阅输出可交付。',
    subscriptionDeliveryReasonDisabled: '订阅身份已停用。',
    subscriptionDeliveryReasonRuntimePolicy: '运行策略已暂停交付',
    subscriptionDeliveryReasonQuota: '订阅流量额度已用尽。',
    subscriptionDeliveryReasonExpired: '订阅身份已过期。',
    subscriptionDeliveryReasonRequestLimit: '请求上限为 0，公开访问会被限流。',
    subscriptionDeliveryReasonNoNodes: '当前没有可生成节点。',
    subscriptionDeliveryReasonNoFormats: '未选择任何公开输出格式。',
    subscriptionDeliveryNextReady: '可以复制门户或客户端格式链接交付给客户。',
    subscriptionDeliveryNextWarning: '先检查生成节点、输出格式或来源过滤，再交付给客户。',
    subscriptionDeliveryNextBlocked: '先恢复启用状态、额度、到期时间或运行策略，再交付链接。',
    subscriptionDeliveryCheck: '交付诊断',
    runSubscriptionDeliveryCheck: '运行交付诊断',
    copySubscriptionDeliveryCheck: '复制交付诊断',
    subscriptionDeliveryCheckIdle: '未运行',
    subscriptionDeliveryCheckRunning: '诊断中',
    subscriptionDeliveryCheckPassed: '通过',
    subscriptionDeliveryCheckWarning: '有警告',
    subscriptionDeliveryCheckFailed: '失败',
    subscriptionDeliveryCheckCheckedAt: '检查时间',
    subscriptionDeliveryCheckPortal: 'Portal',
    subscriptionDeliveryCheckTargetStatus: 'HTTP',
    subscriptionDeliveryCheckContentType: 'Content-Type',
    subscriptionDeliveryCheckNodes: '节点',
    subscriptionDeliveryCheckSelected: '已选择',
    subscriptionDeliveryCheckConverted: '已转换',
    subscriptionDeliveryCheckUnconverted: '未转换',
    subscriptionDeliveryCheckProducer: '生成器',
    subscriptionDeliveryCheckUserinfo: 'Userinfo',
    subscriptionDeliveryCheckError: '错误',
    subscriptionDeliveryCheckNoResult: '尚未运行交付诊断。',
    subscriptionDeliveryCheckSummaryPassed: 'Portal 和已选订阅输出均已响应。',
    subscriptionDeliveryCheckSummaryWarning: '订阅输出可访问，但存在格式转换或节点警告。',
    subscriptionDeliveryCheckSummaryFailed: '至少一个 Portal 或订阅输出请求失败。',
    subscriptionDeliveryRecovery: '交付排查',
    subscriptionDeliveryRecoveryReady: '当前交付诊断没有需要排查的节点或来源问题。',
    subscriptionDeliveryRecoveryNoNodes: '当前订阅规则没有命中可交付库存节点。',
    subscriptionDeliveryRecoveryRequestFailed: 'Portal 或订阅输出请求失败。',
    subscriptionDeliveryRecoveryConversion: '输出存在未转换节点或格式转换告警。',
    subscriptionDeliveryRecoverySourceWarnings: '关联来源存在同步告警。',
    subscriptionDeliveryRecoveryNextAction: '排查路径',
    subscriptionDeliveryRecoveryMatchedInventory: '命中库存',
    subscriptionDeliveryRecoverySourceCoverage: '来源覆盖',
    subscriptionDeliveryRecoveryFailedTargets: '失败目标',
    subscriptionDeliveryRecoverySourceIssues: '异常来源',
    viewDeliveryInventory: '查看命中库存',
    viewDeliveryMatchedNodes: '打开命中节点',
    openSourceDiagnosisFor: (name: string) => `同步诊断 ${name}`,
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
    sourceImpactNodes: '库存节点',
    sourceImpactRiskSources: '异常来源',
    sourceImpactWarnings: '同步警告',
    sourceImpactFetchBudget: '抓取预算',
    sourceImpactSourcePreview: '来源预览',
    sourceImpactNodePreview: '节点预览',
    sourceImpactRiskPreview: '风险提示',
    sourceImpactNoRisk: '暂无同步警告或异常来源',
    sourceSyncDiagnosis: '同步诊断',
    viewSourceSyncDiagnosis: '查看同步诊断',
    copySourceSyncDiagnosis: '复制同步诊断',
    sourceSyncDiagnosisState: '诊断状态',
    sourceSyncDiagnosisNextAction: '下一步',
    sourceSyncDiagnosisWarnings: '同步问题',
    sourceSyncDiagnosisNoWarnings: '暂无同步问题。',
    sourceSyncDiagnosisBudget: '抓取预算',
    sourceSyncDiagnosisRemote: '远端配置',
    sourceSyncDiagnosisRules: '来源规则',
    sourceSyncDiagnosisReady: '正常',
    sourceSyncDiagnosisWarning: '有警告',
    sourceSyncDiagnosisFailed: '失败',
    sourceSyncDiagnosisPaused: '已暂停',
    sourceSyncDiagnosisSyncing: '同步中',
    sourceSyncDiagnosisSummaryReady: '订阅源最近同步没有返回警告。',
    sourceSyncDiagnosisSummaryWarning: '订阅源可用，但同步结果存在需要处理的问题。',
    sourceSyncDiagnosisSummaryFailed: '订阅源同步失败，需要先修复远端或抓取配置。',
    sourceSyncDiagnosisSummaryPaused: '订阅源已暂停，不会继续刷新节点。',
    sourceSyncDiagnosisSummarySyncing: '订阅源正在同步，等待最新结果回写。',
    sourceSyncDiagnosisNextReady: '可以继续使用该来源生成库存和订阅输出。',
    sourceSyncDiagnosisNextWarning: '按问题列表处理协议、过滤、去重或远端响应，再重新同步。',
    sourceSyncDiagnosisNextFailed: '先检查远端地址、鉴权、超时和响应大小，再重新同步。',
    sourceSyncDiagnosisNextPaused: '恢复来源同步后再观察节点和告警状态。',
    sourceSyncDiagnosisNextSyncing: '等待同步完成后查看最新诊断。',
    sourceSyncWarningUnsupportedProtocolNext: '移除不兼容节点，或先把该协议标记为 Preview/转换能力后再交付。',
    sourceSyncWarningInvalidNodesNext: '检查远端订阅格式和必需字段。',
    sourceSyncWarningFilteredNodesNext: '调整 include/exclude/region 规则，或确认过滤结果符合预期。',
    sourceSyncWarningDedupedNodesNext: '检查同源重复节点，必要时调整去重策略。',
    sourceSyncWarningCrossSourceDuplicatesNext: '检查其它来源的重复节点，必要时调整来源优先级或去重键。',
    sourceSyncWarningSyncFailedNext: '检查远端响应、网络、超时、响应大小和鉴权。',
    sourceSyncWarningEmptyNext: '确认远端订阅包含可支持节点，或放宽过滤规则。',
    sourceSyncWarningMockNext: '连接真实 Control Plane 后重新同步。',
    sourceSyncWarningBudgetNext: '等待预算窗口刷新，或提高抓取预算。',
    sourceSyncWarningGenericNext: '查看同步任务和系统告警中的上下文。',
    exportImpactPreflight: '生成影响预检',
    exportImpactFiles: '导出文件',
    exportImpactClients: '订阅身份',
    exportImpactFormats: '输出格式',
    exportImpactProviders: '代理集合引用',
    exportImpactExportPreview: '导出预览',
    exportImpactClientPreview: '身份预览',
    exportImpactFormatPreview: '格式预览',
    providerImpactPreflight: '代理集合生成影响预检',
    providerImpactProviders: '代理集合',
    providerImpactRelatedExports: '关联导出文件',
    providerImpactProviderPreview: '代理集合预览',
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
    clientsTab: 'Identities',
    sourcesTab: 'External Sources',
    inventoryTab: 'Node Inventory',
    providersTab: 'Proxy Providers',
    exportsTab: 'Export Files',
    tableLabel: (title: string) => `${title} Data Table`,
    addClient: 'Add Identity',
    importSource: 'Import Source',
    clientCount: 'Identities',
    inventoryCount: 'Node Inventory',
    exportCount: 'Export Files',
    clientTitle: 'Client Subscription Rules',
    clientHint: '',
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
    portalLink: 'Portal Link',
    copyPortalLink: 'Copy Portal Link',
    openPortalLink: 'Open Portal Link',
    subscriptionUsageHeader: 'Subscription-Userinfo',
    copySubscriptionUsageHeader: 'Copy Usage Header',
    subscriptionAccessStats: 'Access Statistics',
    copySubscriptionDiagnostics: 'Copy Subscription Diagnostics',
    rotateAccessCredential: 'Rotate Public Path',
    confirmRotateAccessCredential: (name: string) =>
      `Rotate public path for ${name}? Existing subscription URLs will stop working; no new raw token is generated.`,
    lastOnline: 'Last Online',
    lastGenerated: 'Last Generated',
    generatedNodes: 'Generated Nodes',
    requestLimitShort: 'Request Limit',
    quotaReset: 'Quota Reset',
    guardrailStatus: 'Guardrail',
    subscriptionDeliveryBrief: 'Delivery Status',
    subscriptionDeliveryState: 'Access State',
    subscriptionDeliveryNextAction: 'Next Action',
    subscriptionDeliveryFormats: 'Output Formats',
    subscriptionDeliveryUsage: 'Usage',
    subscriptionDeliveryReady: 'Ready',
    subscriptionDeliveryWarning: 'Attention',
    subscriptionDeliveryBlocked: 'Blocked',
    subscriptionDeliveryReasonReady: 'Portal and subscription outputs are deliverable.',
    subscriptionDeliveryReasonDisabled: 'The subscription identity is disabled.',
    subscriptionDeliveryReasonRuntimePolicy: 'Runtime policy has suspended delivery',
    subscriptionDeliveryReasonQuota: 'The subscription traffic quota is exhausted.',
    subscriptionDeliveryReasonExpired: 'The subscription identity is expired.',
    subscriptionDeliveryReasonRequestLimit: 'Request limit is 0; public access will be rate limited.',
    subscriptionDeliveryReasonNoNodes: 'No generated nodes are available.',
    subscriptionDeliveryReasonNoFormats: 'No public output format is selected.',
    subscriptionDeliveryNextReady: 'Copy the portal or client format links to deliver this subscription.',
    subscriptionDeliveryNextWarning: 'Check generated nodes, output formats, or source filters before delivery.',
    subscriptionDeliveryNextBlocked: 'Restore enabled state, quota, expiry, or runtime policy before sharing links.',
    subscriptionDeliveryCheck: 'Delivery Check',
    runSubscriptionDeliveryCheck: 'Run Delivery Check',
    copySubscriptionDeliveryCheck: 'Copy Delivery Check',
    subscriptionDeliveryCheckIdle: 'Not Run',
    subscriptionDeliveryCheckRunning: 'Checking',
    subscriptionDeliveryCheckPassed: 'Passed',
    subscriptionDeliveryCheckWarning: 'Warning',
    subscriptionDeliveryCheckFailed: 'Failed',
    subscriptionDeliveryCheckCheckedAt: 'Checked At',
    subscriptionDeliveryCheckPortal: 'Portal',
    subscriptionDeliveryCheckTargetStatus: 'HTTP',
    subscriptionDeliveryCheckContentType: 'Content-Type',
    subscriptionDeliveryCheckNodes: 'Nodes',
    subscriptionDeliveryCheckSelected: 'Selected',
    subscriptionDeliveryCheckConverted: 'Converted',
    subscriptionDeliveryCheckUnconverted: 'Unconverted',
    subscriptionDeliveryCheckProducer: 'Producer',
    subscriptionDeliveryCheckUserinfo: 'Userinfo',
    subscriptionDeliveryCheckError: 'Error',
    subscriptionDeliveryCheckNoResult: 'Delivery check has not run yet.',
    subscriptionDeliveryCheckSummaryPassed: 'Portal and selected subscription outputs responded successfully.',
    subscriptionDeliveryCheckSummaryWarning: 'Subscription outputs are reachable, but conversion or node warnings were returned.',
    subscriptionDeliveryCheckSummaryFailed: 'At least one portal or subscription output request failed.',
    subscriptionDeliveryRecovery: 'Delivery Recovery',
    subscriptionDeliveryRecoveryReady: 'The delivery check has no node or source issues to investigate.',
    subscriptionDeliveryRecoveryNoNodes: 'The subscription rules did not match deliverable inventory nodes.',
    subscriptionDeliveryRecoveryRequestFailed: 'Portal or subscription output request failed.',
    subscriptionDeliveryRecoveryConversion: 'Output returned unconverted nodes or conversion warnings.',
    subscriptionDeliveryRecoverySourceWarnings: 'Related sources have sync warnings.',
    subscriptionDeliveryRecoveryNextAction: 'Recovery Path',
    subscriptionDeliveryRecoveryMatchedInventory: 'Matched Inventory',
    subscriptionDeliveryRecoverySourceCoverage: 'Source Coverage',
    subscriptionDeliveryRecoveryFailedTargets: 'Failed Targets',
    subscriptionDeliveryRecoverySourceIssues: 'Source Issues',
    viewDeliveryInventory: 'View Matched Inventory',
    viewDeliveryMatchedNodes: 'Open Matched Nodes',
    openSourceDiagnosisFor: (name: string) => `Sync Diagnosis ${name}`,
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
    sourceImpactNodes: 'Inventory Nodes',
    sourceImpactRiskSources: 'Risk Sources',
    sourceImpactWarnings: 'Sync Warnings',
    sourceImpactFetchBudget: 'Fetch Budget',
    sourceImpactSourcePreview: 'Source Preview',
    sourceImpactNodePreview: 'Node Preview',
    sourceImpactRiskPreview: 'Risk Notes',
    sourceImpactNoRisk: 'No sync warnings or source risks',
    sourceSyncDiagnosis: 'Sync Diagnosis',
    viewSourceSyncDiagnosis: 'View Sync Diagnosis',
    copySourceSyncDiagnosis: 'Copy Sync Diagnosis',
    sourceSyncDiagnosisState: 'Diagnosis State',
    sourceSyncDiagnosisNextAction: 'Next Action',
    sourceSyncDiagnosisWarnings: 'Sync Issues',
    sourceSyncDiagnosisNoWarnings: 'No sync issues.',
    sourceSyncDiagnosisBudget: 'Fetch Budget',
    sourceSyncDiagnosisRemote: 'Remote Config',
    sourceSyncDiagnosisRules: 'Source Rules',
    sourceSyncDiagnosisReady: 'Ready',
    sourceSyncDiagnosisWarning: 'Warning',
    sourceSyncDiagnosisFailed: 'Failed',
    sourceSyncDiagnosisPaused: 'Paused',
    sourceSyncDiagnosisSyncing: 'Syncing',
    sourceSyncDiagnosisSummaryReady: 'The source returned no warnings during the latest sync.',
    sourceSyncDiagnosisSummaryWarning: 'The source is usable, but the sync result has issues to resolve.',
    sourceSyncDiagnosisSummaryFailed: 'The source sync failed; fix the remote or fetch settings first.',
    sourceSyncDiagnosisSummaryPaused: 'The source is paused and will not refresh nodes.',
    sourceSyncDiagnosisSummarySyncing: 'The source is syncing; wait for the latest result.',
    sourceSyncDiagnosisNextReady: 'Keep using this source for inventory and subscription output.',
    sourceSyncDiagnosisNextWarning: 'Resolve protocol, filter, dedupe, or remote-response issues, then sync again.',
    sourceSyncDiagnosisNextFailed: 'Check remote URL, auth, timeout, and response size before syncing again.',
    sourceSyncDiagnosisNextPaused: 'Resume source sync before relying on node and warning state.',
    sourceSyncDiagnosisNextSyncing: 'Wait for sync completion before reading the latest diagnosis.',
    sourceSyncWarningUnsupportedProtocolNext: 'Remove incompatible nodes or keep the protocol as Preview until conversion is supported.',
    sourceSyncWarningInvalidNodesNext: 'Check the remote subscription format and required fields.',
    sourceSyncWarningFilteredNodesNext: 'Adjust include/exclude/region rules, or confirm the filtered result is expected.',
    sourceSyncWarningDedupedNodesNext: 'Review same-source duplicate nodes and adjust the dedupe policy if needed.',
    sourceSyncWarningCrossSourceDuplicatesNext: 'Review duplicates from other sources and adjust source priority or dedupe key.',
    sourceSyncWarningSyncFailedNext: 'Check remote response, network, timeout, response size, and auth.',
    sourceSyncWarningEmptyNext: 'Confirm the remote subscription contains supported nodes or loosen filters.',
    sourceSyncWarningMockNext: 'Sync again with a real Control Plane connection.',
    sourceSyncWarningBudgetNext: 'Wait for the budget window to refresh or raise the fetch budget.',
    sourceSyncWarningGenericNext: 'Check related sync tasks and system alerts for context.',
    exportImpactPreflight: 'Generation Impact Preflight',
    exportImpactFiles: 'Export Files',
    exportImpactClients: 'Identities',
    exportImpactFormats: 'Output Formats',
    exportImpactProviders: 'Provider References',
    exportImpactExportPreview: 'Export Preview',
    exportImpactClientPreview: 'Identity Preview',
    exportImpactFormatPreview: 'Format Preview',
    providerImpactPreflight: 'Provider Generation Impact Preflight',
    providerImpactProviders: 'Proxy Providers',
    providerImpactRelatedExports: 'Related Export Files',
    providerImpactProviderPreview: 'Provider Preview',
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
    proxyGroupNodes: '组内节点',
    addGroup: '新增组',
    addSelectedNodes: '加入已选节点',
    editLayout: '编辑布局',
    exitEditLayout: '退出编辑',
    noProxyGroupNodes: '未指定节点',
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
    proxyGroupNodes: 'Group Nodes',
    addGroup: 'Add Group',
    addSelectedNodes: 'Add Selected Nodes',
    editLayout: 'Edit Layout',
    exitEditLayout: 'Exit Edit',
    noProxyGroupNodes: 'No pinned nodes',
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
    accessTokenPreview: createAccessTokenPreview('sub_hkg_premium_01'),
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
    outputFormats: ['clash', 'mihomo', 'v2ray', 'sing-box', 'uri'],
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
    proxyGroups: [
      {
        id: 'proxy-group-premium-auto',
        name: 'Premium Auto',
        strategy: 'url-test',
        filterTags: 'premium,streaming',
        nodeIds: []
      }
    ],
    includeTrafficHeaders: true
  };
}

function createDraftFromExportProfile(profile: SubscriptionExportProfile): ExportProfileDraft {
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
    proxyGroups:
      profile.proxyGroups.length > 0
        ? profile.proxyGroups.map((group) => ({
            id: group.id,
            name: group.name,
            strategy: group.strategy,
            filterTags: group.filterTags.join(','),
            nodeIds: group.nodeIds ?? []
          }))
        : createDefaultExportProfileDraft().proxyGroups,
    includeTrafficHeaders: profile.includeTrafficHeaders
  };
}

function createExportProfileMetadataFromDraft(draft: ExportProfileDraft): SubscriptionExportProfileMetadata {
  const profileName = draft.name.trim() || 'Mihomo Premium Profile';
  const proxyGroups = draft.proxyGroups.length > 0 ? draft.proxyGroups : createDefaultExportProfileDraft().proxyGroups;

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
    proxyGroups: proxyGroups.map((group, index) => {
      const groupName = group.name.trim() || `${profileName} ${index + 1}`;
      const groupId = group.id.trim() || createProxyGroupId(groupName);

      return {
        id: groupId,
        name: groupName,
        strategy: group.strategy,
        filterTags: splitComma(group.filterTags),
        nodeIds: group.nodeIds.length > 0 ? group.nodeIds : undefined
      };
    }),
    includeTrafficHeaders: draft.includeTrafficHeaders
  };
}

function createProxyGroupId(name: string) {
  return `proxy-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default'}`;
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

const profileOutputFormatOptions = [
  ...clientFormatOptions.map((option) => ({ outputFormat: option.outputFormat, label: option.label })),
  { outputFormat: 'shadowrocket', label: { zh: 'Shadowrocket', en: 'Shadowrocket' } },
  { outputFormat: 'stash', label: { zh: 'Stash', en: 'Stash' } }
] as const satisfies Array<{
  outputFormat: SubscriptionClientOutputFormat;
  label: Record<AppLanguage, string>;
}>;

const legacyFormatLabels: Partial<Record<SubscriptionClientFormat, Record<AppLanguage, string>>> = {};
const neutralActionButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/86 px-3 text-xs font-bold text-[#35405A] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-[#1E3AFF]/45 hover:bg-[#DCE1FF]/52 hover:text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/16 dark:bg-white/[0.04] dark:text-white/64 dark:hover:border-[#6B7CFF]/34 dark:hover:bg-[#1E3AFF]/12 dark:hover:text-[#DDE3FF] dark:focus-visible:ring-[#6B7CFF]/45';
const compactNeutralActionButtonClass =
  'inline-flex min-h-8 items-center justify-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/86 px-3 text-xs font-bold text-[#35405A] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-[#1E3AFF]/45 hover:bg-[#DCE1FF]/52 hover:text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/16 dark:bg-white/[0.04] dark:text-white/64 dark:hover:border-[#6B7CFF]/34 dark:hover:bg-[#1E3AFF]/12 dark:hover:text-[#DDE3FF] dark:focus-visible:ring-[#6B7CFF]/45';
const dangerActionButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-2 border border-[#DC2626]/42 bg-[#FEE2E2]/72 px-3 text-xs font-bold text-[#7F1D1D] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:bg-[#FECACA]/78 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#DC2626]/34 dark:bg-[#DC2626]/14 dark:text-[#FECACA] dark:hover:bg-[#DC2626]/22 dark:focus-visible:ring-[#DC2626]/45';
const blueActionButtonClass =
  'inline-flex min-h-9 items-center justify-center border border-[#1E3AFF]/45 bg-[#DCE1FF]/72 px-3 text-xs font-bold text-[#07111F] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:bg-[#DCE1FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/35 dark:bg-[#1E3AFF]/16 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF]/24 dark:focus-visible:ring-[#6B7CFF]/45';
const blueSoftActionButtonClass =
  'inline-flex min-h-9 items-center justify-center border border-[#1E3AFF]/35 bg-[#DCE1FF]/52 px-3 text-xs font-bold text-[#07111F] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/28 dark:bg-[#1E3AFF]/12 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF]/20 dark:focus-visible:ring-[#6B7CFF]/45';
const emeraldActionButtonClass =
  'inline-flex min-h-9 items-center justify-center border border-[#00A878]/38 bg-[#00A878]/12 px-3 text-xs font-bold text-[#07111F] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:bg-[#00A878]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00A878]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#00A878]/30 dark:bg-[#00A878]/14 dark:text-[#C7FFE9] dark:hover:bg-[#00A878]/22 dark:focus-visible:ring-[#00A878]/45';
const signalActionButtonClass =
  'inline-flex min-h-9 items-center justify-center border border-[#FF3D18]/38 bg-[#FFD8C6]/62 px-3 text-xs font-bold text-[#07111F] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:bg-[#FFD8C6]/86 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3D18]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/14 dark:text-[#FFD8C6] dark:hover:bg-[#FF3D18]/22 dark:focus-visible:ring-[#FF6A3A]/45';
const compactCommandActionButtonClass =
  'inline-flex min-h-8 items-center justify-center gap-2 border border-[#1E3AFF]/45 bg-[#DCE1FF]/72 px-3 text-xs font-bold text-[#07111F] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:bg-[#DCE1FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/35 dark:bg-[#1E3AFF]/16 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF]/24 dark:focus-visible:ring-[#6B7CFF]/45';
const subscriptionDrawerCommandPanelClass =
  'border border-[#1E3AFF]/35 bg-[#DCE1FF]/70 p-3 text-[#07111F] transition duration-200 ease-out dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/12 dark:text-[#DDE3FF]';
const subscriptionDrawerNeutralPanelClass =
  'border border-[#07111F]/18 bg-[#FFFDF5]/86 p-3 text-[#07111F] transition duration-200 ease-out dark:border-white/10 dark:bg-white/[0.035] dark:text-white';
const subscriptionDrawerMutedPanelClass =
  'border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 text-[#07111F] transition duration-200 ease-out dark:border-white/10 dark:bg-white/[0.03] dark:text-white';
const subscriptionDrawerSignalPanelClass =
  'border border-[#FF3D18]/35 bg-[#FFD8C6]/62 p-3 text-[#07111F] transition duration-200 ease-out dark:border-[#FF6A3A]/28 dark:bg-[#FF3D18]/12 dark:text-[#FFD8C6]';
const subscriptionLayoutStorageKey = 'ou-ui-next:subscription-profile-layouts';

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

function createRotatedAccessTokenPreview() {
  const token = createRandomSecret(18);
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

function getClientOutputFormatLabel(format: SubscriptionClientOutputFormat, language: AppLanguage) {
  return profileOutputFormatOptions.find((option) => option.outputFormat === format)?.label[language] ?? format;
}

function readClientOutputFormats(client: SubscriptionClientIdentity) {
  return client.outputFormats && client.outputFormats.length > 0 ? client.outputFormats : createOutputFormats(client.formats);
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

  const countedWarningMatch = /^subscription_source\.(unsupported_protocol_nodes|invalid_nodes|filtered_nodes|deduped_nodes):(\d+)$/.exec(warning);

  if (countedWarningMatch) {
    const [, kind, rawCount] = countedWarningMatch;
    const count = Number(rawCount);

    if (kind === 'unsupported_protocol_nodes') {
      return language === 'zh'
        ? `不兼容协议节点 ${formatNumber(count, language)} 个`
        : `${formatNumber(count, language)} incompatible protocol nodes`;
    }

    if (kind === 'invalid_nodes') {
      return language === 'zh'
        ? `字段缺失或无法解析节点 ${formatNumber(count, language)} 个`
        : `${formatNumber(count, language)} nodes missing required fields`;
    }

    if (kind === 'filtered_nodes') {
      return language === 'zh'
        ? `被订阅源规则过滤 ${formatNumber(count, language)} 个节点`
        : `${formatNumber(count, language)} nodes filtered by source rules`;
    }

    return language === 'zh'
      ? `同源重复节点去重 ${formatNumber(count, language)} 个`
      : `${formatNumber(count, language)} same-source duplicate nodes removed`;
  }

  if (warning.startsWith('subscription_source.sync_failed:')) {
    const reason = warning.replace(/^subscription_source\.sync_failed:/, '').trim();
    return language === 'zh'
      ? `同步失败${reason ? `：${reason}` : '，请检查订阅源'}`
      : `Sync failed${reason ? `: ${reason}` : '; check the source'}`;
  }

  if (warning === 'subscription_source.empty_or_unsupported') {
    return language === 'zh' ? '未解析到可用节点' : 'No usable nodes parsed';
  }

  if (warning === 'subscription_source.mock_sync_has_no_remote_fetch') {
    return language === 'zh' ? '模拟模式未远程抓取' : 'Mock mode did not fetch remotely';
  }

  return language === 'zh' ? '同步告警' : 'Sync warning';
}

function createSourceSyncWarningDetail(
  warning: string,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
): SourceSyncWarningDetail {
  const label = formatSourceSyncWarning(warning, language);
  const nextAction =
    /^subscription_source\.unsupported_protocol_nodes:/.test(warning)
      ? t.sourceSyncWarningUnsupportedProtocolNext
      : /^subscription_source\.invalid_nodes:/.test(warning)
        ? t.sourceSyncWarningInvalidNodesNext
        : /^subscription_source\.filtered_nodes:/.test(warning)
          ? t.sourceSyncWarningFilteredNodesNext
          : /^subscription_source\.deduped_nodes:/.test(warning)
            ? t.sourceSyncWarningDedupedNodesNext
            : /^subscription_source\.cross_source_duplicates:/.test(warning)
              ? t.sourceSyncWarningCrossSourceDuplicatesNext
              : warning.startsWith('subscription_source.sync_failed:')
                ? t.sourceSyncWarningSyncFailedNext
                : warning === 'subscription_source.empty_or_unsupported'
                  ? t.sourceSyncWarningEmptyNext
                  : warning === 'subscription_source.mock_sync_has_no_remote_fetch'
                    ? t.sourceSyncWarningMockNext
                    : t.sourceSyncWarningGenericNext;

  return {
    raw: warning,
    label,
    nextAction,
    severity: warning.startsWith('subscription_source.sync_failed:') ? 'failed' : 'warning'
  };
}

function createSourceSyncBudgetWarnings(
  source: SubscriptionSource,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
) {
  const warnings: string[] = [];

  if (!source.syncBudget) {
    return warnings;
  }

  const maxFetchesPerDay = source.syncBudget.maxFetchesPerDay ?? 0;
  const maxBytesPerDay = source.syncBudget.maxBytesPerDay ?? 0;

  if (maxFetchesPerDay > 0 && source.syncBudget.usedFetches >= maxFetchesPerDay) {
    warnings.push(
      language === 'zh'
        ? `抓取次数预算已用尽：${formatNumber(source.syncBudget.usedFetches, language)} / ${formatNumber(maxFetchesPerDay, language)} ${t.budgetFetchUnit}`
        : `Fetch budget exhausted: ${formatNumber(source.syncBudget.usedFetches, language)} / ${formatNumber(maxFetchesPerDay, language)} ${t.budgetFetchUnit}`
    );
  }

  if (maxBytesPerDay > 0 && source.syncBudget.usedBytes >= maxBytesPerDay) {
    warnings.push(
      language === 'zh'
        ? `抓取字节预算已用尽：${formatBytes(source.syncBudget.usedBytes)} / ${formatBytes(maxBytesPerDay)}`
        : `Byte budget exhausted: ${formatBytes(source.syncBudget.usedBytes)} / ${formatBytes(maxBytesPerDay)}`
    );
  }

  return warnings;
}

function getSourceSyncDiagnosisStateLabel(
  state: SourceSyncDiagnosisState,
  t: (typeof copy)[AppLanguage]
) {
  const labels = {
    ready: t.sourceSyncDiagnosisReady,
    warning: t.sourceSyncDiagnosisWarning,
    failed: t.sourceSyncDiagnosisFailed,
    paused: t.sourceSyncDiagnosisPaused,
    syncing: t.sourceSyncDiagnosisSyncing
  } satisfies Record<SourceSyncDiagnosisState, string>;

  return labels[state];
}

function getSourceSyncDiagnosisSummary(
  state: SourceSyncDiagnosisState,
  t: (typeof copy)[AppLanguage]
) {
  const summaries = {
    ready: t.sourceSyncDiagnosisSummaryReady,
    warning: t.sourceSyncDiagnosisSummaryWarning,
    failed: t.sourceSyncDiagnosisSummaryFailed,
    paused: t.sourceSyncDiagnosisSummaryPaused,
    syncing: t.sourceSyncDiagnosisSummarySyncing
  } satisfies Record<SourceSyncDiagnosisState, string>;

  return summaries[state];
}

function getSourceSyncDiagnosisNextAction(
  state: SourceSyncDiagnosisState,
  t: (typeof copy)[AppLanguage]
) {
  const nextActions = {
    ready: t.sourceSyncDiagnosisNextReady,
    warning: t.sourceSyncDiagnosisNextWarning,
    failed: t.sourceSyncDiagnosisNextFailed,
    paused: t.sourceSyncDiagnosisNextPaused,
    syncing: t.sourceSyncDiagnosisNextSyncing
  } satisfies Record<SourceSyncDiagnosisState, string>;

  return nextActions[state];
}

function createSourceSyncDiagnosis(
  source: SubscriptionSource,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
): SourceSyncDiagnosis {
  const warnings = (source.syncWarnings ?? []).map((warning) => createSourceSyncWarningDetail(warning, language, t));
  const budgetWarnings = createSourceSyncBudgetWarnings(source, language, t);
  const state: SourceSyncDiagnosisState =
    source.status === 'failed' || warnings.some((warning) => warning.severity === 'failed')
      ? 'failed'
      : source.status === 'paused'
        ? 'paused'
        : source.status === 'syncing'
          ? 'syncing'
          : source.status === 'warning' || warnings.length > 0 || budgetWarnings.length > 0
            ? 'warning'
            : 'ready';
  const fetchBudgetLabel = source.syncBudget
    ? `${formatNumber(source.syncBudget.usedFetches, language)} / ${
        source.syncBudget.maxFetchesPerDay ? formatNumber(source.syncBudget.maxFetchesPerDay, language) : t.budgetUnlimited
      } ${t.budgetFetchUnit}`
    : '-';
  const byteBudgetLabel = source.syncBudget
    ? `${formatBytes(source.syncBudget.usedBytes)} / ${
        source.syncBudget.maxBytesPerDay ? formatBytes(source.syncBudget.maxBytesPerDay) : t.budgetUnlimited
      }`
    : '-';
  const remoteLabel = [
    source.kind,
    source.userAgent || 'OU-UI-Next/1.0',
    `${source.fetchTimeoutSeconds ?? 20}s`,
    source.maxBodyBytes ? formatBytes(source.maxBodyBytes) : t.budgetUnlimited
  ].join(' / ');
  const rulesLabel = [
    `include=${source.includeFilter || '*'}`,
    `exclude=${source.excludeFilter || '-'}`,
    `dedupe=${source.dedupeKey}`
  ].join(' / ');

  return {
    state,
    stateLabel: getSourceSyncDiagnosisStateLabel(state, t),
    summary: getSourceSyncDiagnosisSummary(state, t),
    nextAction: getSourceSyncDiagnosisNextAction(state, t),
    warnings,
    budgetWarnings,
    fetchBudgetLabel,
    byteBudgetLabel,
    remoteLabel,
    rulesLabel
  };
}

function redactSourceDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.username) {
      url.username = 'redacted';
    }

    if (url.password) {
      url.password = 'redacted';
    }

    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/token|key|secret|password|passwd|auth|access/i.test(key)) {
        url.searchParams.set(key, 'REDACTED');
      }
    });

    return url.toString();
  } catch {
    return value.replace(/((?:token|key|secret|password|passwd|auth|access)[^=&\s]*=)[^&\s]+/gi, '$1REDACTED');
  }
}

function createSourceSyncDiagnosisText(
  source: SubscriptionSource,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
) {
  const diagnosis = createSourceSyncDiagnosis(source, language, t);
  const lines = [
    `Source Sync Diagnosis: ${diagnosis.stateLabel}`,
    `Source ID: ${source.id}`,
    `Source Name: ${source.name}`,
    `Source URL: ${redactSourceDiagnosticUrl(source.url)}`,
    `Status: ${source.status}`,
    `Kind: ${source.kind}`,
    `Nodes: ${source.nodeCount}`,
    `Last Sync: ${source.lastSyncAt}`,
    `Next Action: ${diagnosis.nextAction}`,
    `Fetch Budget: ${diagnosis.fetchBudgetLabel}`,
    `Byte Budget: ${diagnosis.byteBudgetLabel}`,
    `Remote Config: ${diagnosis.remoteLabel}`,
    `Source Rules: ${diagnosis.rulesLabel}`
  ];
  const warningLines = [
    ...diagnosis.warnings.map((warning) => `- ${warning.label} | Next: ${warning.nextAction} | Raw: ${warning.raw}`),
    ...diagnosis.budgetWarnings.map((warning) => `- ${warning} | Next: ${t.sourceSyncWarningBudgetNext}`)
  ];

  lines.push('Warnings:', ...(warningLines.length > 0 ? warningLines : ['- none']));

  return lines.join('\n');
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
  const outputFormats = draft.outputFormats.length > 0 ? draft.outputFormats : createOutputFormats(draft.formats);
  const accessTokenPreview = draft.accessTokenPreview || createAccessTokenPreview(subId);
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
    subscriptionUrlPreview: subscriptionUrls,
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
    accessTokenPreview: client.accessTokenPreview,
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
    outputFormats: readClientOutputFormats(client),
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
    uri: `${prefix}/uri/${subId}${suffix ? `?${suffix}` : ''}`,
    v2ray: `${prefix}/v2ray/${subId}${suffix ? `?${suffix}` : ''}`,
    clash: `${prefix}/clash/${subId}${suffix ? `?${suffix}` : ''}`,
    mihomo: `${prefix}/mihomo/${subId}${suffix ? `?${suffix}` : ''}`,
    'sing-box': `${prefix}/sing-box/${subId}${suffix ? `?${suffix}` : ''}`,
    shadowrocket: `${prefix}/shadowrocket/${subId}${suffix ? `?${suffix}` : ''}`,
    stash: `${prefix}/stash/${subId}${suffix ? `?${suffix}` : ''}`
  } satisfies Record<SubscriptionClientOutputFormat, string>;
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

function createClientSubscriptionUrl(client: SubscriptionClientIdentity, outputFormat: SubscriptionClientOutputFormat) {
  const securePathPreview =
    client.securePathPreview || `/${client.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  const subId = encodeURIComponent(client.subId);

  return `${createBrowserPublicBaseUrl()}/sub${securePathPreview}/${outputFormat}/${subId}`;
}

function createClientSubscriptionPortalUrl(client: SubscriptionClientIdentity) {
  const securePathPreview =
    client.securePathPreview || `/${client.accessTokenPreview.replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}`;
  const subId = encodeURIComponent(client.subId);

  return `${createBrowserPublicBaseUrl()}/portal${securePathPreview}/${subId}`;
}

function createClientAllFormatSubscriptionLinks(client: SubscriptionClientIdentity, language: AppLanguage) {
  return readClientOutputFormats(client).map((format) => `${getClientOutputFormatLabel(format, language)}: ${createClientSubscriptionUrl(client, format)}`);
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

function isSubscriptionExpired(client: SubscriptionClientIdentity) {
  const expiresAt = Date.parse(client.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isSubscriptionQuotaExceeded(client: SubscriptionClientIdentity) {
  return Boolean(
    client.quotaExceeded ||
      (client.trafficLimitBytes > 0 && client.usedTrafficBytes >= client.trafficLimitBytes)
  );
}

function createSubscriptionDeliveryBrief(
  client: SubscriptionClientIdentity,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
): SubscriptionDeliveryBrief {
  const outputFormats = readClientOutputFormats(client);
  const blockingReasons: string[] = [];
  const warningReasons: string[] = [];
  const requestLimit = client.requestLimitPerHour ?? 360;

  if (!client.enabled) {
    blockingReasons.push(t.subscriptionDeliveryReasonDisabled);
  }

  if (client.runtimeDisabledByPolicy) {
    blockingReasons.push(
      client.guardrailReason
        ? `${t.subscriptionDeliveryReasonRuntimePolicy}: ${client.guardrailReason}`
        : t.subscriptionDeliveryReasonRuntimePolicy
    );
  }

  if (isSubscriptionQuotaExceeded(client)) {
    blockingReasons.push(t.subscriptionDeliveryReasonQuota);
  }

  if (isSubscriptionExpired(client)) {
    blockingReasons.push(t.subscriptionDeliveryReasonExpired);
  }

  if (requestLimit <= 0) {
    blockingReasons.push(t.subscriptionDeliveryReasonRequestLimit);
  }

  if (client.generatedNodeCount <= 0) {
    warningReasons.push(t.subscriptionDeliveryReasonNoNodes);
  }

  if (outputFormats.length === 0) {
    warningReasons.push(t.subscriptionDeliveryReasonNoFormats);
  }

  const state: SubscriptionDeliveryState =
    blockingReasons.length > 0 ? 'blocked' : warningReasons.length > 0 ? 'warning' : 'ready';
  const statusLabel = {
    ready: t.subscriptionDeliveryReady,
    warning: t.subscriptionDeliveryWarning,
    blocked: t.subscriptionDeliveryBlocked
  } satisfies Record<SubscriptionDeliveryState, string>;
  const nextAction = {
    ready: t.subscriptionDeliveryNextReady,
    warning: t.subscriptionDeliveryNextWarning,
    blocked: t.subscriptionDeliveryNextBlocked
  } satisfies Record<SubscriptionDeliveryState, string>;
  const reasons = [...blockingReasons, ...warningReasons];

  return {
    state,
    statusLabel: statusLabel[state],
    reasonText: reasons[0] ?? t.subscriptionDeliveryReasonReady,
    reasons,
    nextAction: nextAction[state],
    outputFormats,
    outputFormatLabel: outputFormats.map((format) => getClientOutputFormatLabel(format, language)).join(', ') || '-',
    usageValue:
      client.trafficLimitBytes > 0
        ? `${formatBytes(client.usedTrafficBytes)} / ${formatBytes(client.trafficLimitBytes)}`
        : `${formatBytes(client.usedTrafficBytes)} / -`,
    requestLimitValue: `${formatNumber(requestLimit, language)} req/h`,
    portalUrl: createClientSubscriptionPortalUrl(client)
  };
}

function createSubscriptionDeliveryCheckTargets(
  client: SubscriptionClientIdentity,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
): SubscriptionDeliveryCheckTarget[] {
  return [
    {
      id: 'portal',
      kind: 'portal',
      label: t.subscriptionDeliveryCheckPortal,
      url: createClientSubscriptionPortalUrl(client)
    },
    ...readClientOutputFormats(client).map((format) => ({
      id: format,
      kind: 'format' as const,
      label: getClientOutputFormatLabel(format, language),
      url: createClientSubscriptionUrl(client, format)
    }))
  ];
}

function readResponseHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  return value && value.trim().length > 0 ? value : undefined;
}

function formatUnknownDeliveryCheckError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function checkSubscriptionDeliveryTarget(
  target: SubscriptionDeliveryCheckTarget
): Promise<SubscriptionDeliveryCheckTarget> {
  try {
    const response = await fetch(target.url, { cache: 'no-store', method: 'GET' });
    let error: string | undefined;

    if (!response.ok) {
      try {
        error = (await response.text()).slice(0, 180) || response.statusText;
      } catch {
        error = response.statusText;
      }
    }

    return {
      ...target,
      status: response.status,
      ok: response.ok,
      contentType: readResponseHeader(response.headers, 'content-type'),
      subscriptionUserinfo: readResponseHeader(response.headers, 'subscription-userinfo'),
      nodeCount: readResponseHeader(response.headers, 'x-ou-ui-node-count'),
      selectedNodeCount: readResponseHeader(response.headers, 'x-ou-ui-selected-node-count'),
      convertedUriCount: readResponseHeader(response.headers, 'x-ou-ui-converted-uri-count'),
      unconvertedNodeCount: readResponseHeader(response.headers, 'x-ou-ui-unconverted-node-count'),
      conversionWarning: readResponseHeader(response.headers, 'x-ou-ui-conversion-warning'),
      producer: readResponseHeader(response.headers, 'x-ou-ui-producer'),
      error
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      error: formatUnknownDeliveryCheckError(error)
    };
  }
}

function hasSubscriptionDeliveryCheckWarning(target: SubscriptionDeliveryCheckTarget) {
  const unconverted = Number.parseInt(target.unconvertedNodeCount ?? '0', 10);
  return Boolean(target.conversionWarning || (Number.isFinite(unconverted) && unconverted > 0));
}

function createSubscriptionDeliveryCheckResult(
  clientId: string,
  targets: SubscriptionDeliveryCheckTarget[],
  t: (typeof copy)[AppLanguage]
): SubscriptionDeliveryCheckResult {
  const hasFailure = targets.some((target) => !target.ok);
  const hasWarning = targets.some(hasSubscriptionDeliveryCheckWarning);
  const state: SubscriptionDeliveryCheckState = hasFailure ? 'failed' : hasWarning ? 'warning' : 'passed';
  const summary = {
    passed: t.subscriptionDeliveryCheckSummaryPassed,
    warning: t.subscriptionDeliveryCheckSummaryWarning,
    failed: t.subscriptionDeliveryCheckSummaryFailed
  } satisfies Record<Exclude<SubscriptionDeliveryCheckState, 'idle' | 'running'>, string>;

  return {
    clientId,
    state,
    checkedAt: new Date().toISOString(),
    summary: summary[state],
    targets
  };
}

function getSubscriptionDeliveryCheckStateLabel(
  state: SubscriptionDeliveryCheckState,
  t: (typeof copy)[AppLanguage]
) {
  const labels = {
    idle: t.subscriptionDeliveryCheckIdle,
    running: t.subscriptionDeliveryCheckRunning,
    passed: t.subscriptionDeliveryCheckPassed,
    warning: t.subscriptionDeliveryCheckWarning,
    failed: t.subscriptionDeliveryCheckFailed
  } satisfies Record<SubscriptionDeliveryCheckState, string>;

  return labels[state];
}

function createSubscriptionDeliveryCheckText(result: SubscriptionDeliveryCheckResult) {
  const stateLabels = {
    idle: 'Not Run',
    running: 'Running',
    passed: 'Passed',
    warning: 'Warning',
    failed: 'Failed'
  } satisfies Record<SubscriptionDeliveryCheckState, string>;
  const lines = [
    `Delivery Check: ${stateLabels[result.state]}`,
    `Checked At: ${result.checkedAt ?? '-'}`,
    `Summary: ${result.summary}`
  ];

  for (const target of result.targets) {
    lines.push(
      '',
      `${target.label}: ${target.status ? `HTTP ${target.status}` : 'Network Error'}${target.ok ? ' ok' : ' failed'}`,
      `URL: ${target.url}`,
      `Content-Type: ${target.contentType ?? '-'}`,
      `Subscription-Userinfo: ${target.subscriptionUserinfo ?? '-'}`,
      `Nodes: ${target.nodeCount ?? '-'}`,
      `Selected Nodes: ${target.selectedNodeCount ?? '-'}`,
      `Converted URIs: ${target.convertedUriCount ?? '-'}`,
      `Unconverted Nodes: ${target.unconvertedNodeCount ?? '-'}`,
      `Conversion Warning: ${target.conversionWarning ?? '-'}`,
      `Producer: ${target.producer ?? '-'}`,
      `Error: ${target.error ?? '-'}`
    );
  }

  return lines.join('\n');
}

function createSubscriptionDiagnosticsText(client: SubscriptionClientIdentity) {
  const requestLimitPerHour = client.requestLimitPerHour ?? 360;
  const deliveryBrief = createSubscriptionDeliveryBrief(client, 'en', copy.en);

  return [
    `Sub ID: ${client.subId}`,
    `Display Name: ${client.displayName}`,
    `Email: ${client.email}`,
    `Group: ${client.group}`,
    `Protocol: ${client.protocol}`,
    `Delivery Status: ${deliveryBrief.statusLabel}`,
    `Delivery Reason: ${deliveryBrief.reasonText}`,
    `Delivery Next Action: ${deliveryBrief.nextAction}`,
    `Delivery Formats: ${deliveryBrief.outputFormatLabel}`,
    `Portal URL: ${deliveryBrief.portalUrl}`,
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

function createSubscriptionQrFilename(client: SubscriptionClientIdentity, format: SubscriptionClientOutputFormat) {
  const subSlug = createDownloadSlug(client.subId, 'subscription');
  const formatSlug = createDownloadSlug(format, 'link');

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

function findClientConfiguredSources(client: SubscriptionClientIdentity, sources: SubscriptionSource[]) {
  const sourceIds = new Set(client.sourceIds);

  return sources.filter((source) => sourceIds.has(source.id));
}

function hasSourceSyncIssue(source: SubscriptionSource) {
  return (
    source.status === 'warning' ||
    source.status === 'failed' ||
    source.status === 'paused' ||
    Boolean(source.syncWarnings?.length)
  );
}

function mergeDeliveryRecoverySources(
  matchedSources: Array<{ id: string; source?: SubscriptionSource; nodeCount: number }>,
  configuredSources: SubscriptionSource[]
) {
  const sourcesById = new Map<string, { source: SubscriptionSource; nodeCount: number }>();

  matchedSources.forEach((item) => {
    if (item.source) {
      sourcesById.set(item.source.id, { source: item.source, nodeCount: item.nodeCount });
    }
  });
  configuredSources.forEach((source) => {
    sourcesById.set(source.id, {
      source,
      nodeCount: sourcesById.get(source.id)?.nodeCount ?? 0
    });
  });

  return Array.from(sourcesById.values());
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
  const [profileLayoutEditing, setProfileLayoutEditing] = useState(false);
  const [deliveryChecks, setDeliveryChecks] = useState<Record<string, SubscriptionDeliveryCheckResult>>({});
  const profileLayoutStorageKey = `${subscriptionLayoutStorageKey}:${profileDraft.profileId || 'draft'}`;
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
  const linkDrawerDeliveryCheck = linkDrawerClient ? deliveryChecks[linkDrawerClient.id] : undefined;
  const linkDrawerMatchedNodes = useMemo(
    () => (linkDrawerClient ? findClientMatchingInventoryNodes(inventoryNodes, linkDrawerClient) : []),
    [inventoryNodes, linkDrawerClient]
  );
  const linkDrawerMatchedSources = useMemo(
    () => findMatchedSources(linkDrawerMatchedNodes, sources),
    [linkDrawerMatchedNodes, sources]
  );
  const linkDrawerConfiguredSources = useMemo(
    () => (linkDrawerClient ? findClientConfiguredSources(linkDrawerClient, sources) : []),
    [linkDrawerClient, sources]
  );
  const sourceDiagnosticsDrawerSource =
    drawer.type === 'source-diagnostics' ? sources.find((source) => source.id === drawer.sourceId) : undefined;
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
  const accessTokenPreview = clientDraft.accessTokenPreview || createAccessTokenPreview(clientDraft.subId.trim() || 'manual');
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

  function addSelectedInventoryNodesToProfileGroup() {
    if (selectedInventoryNodes.length === 0) {
      return;
    }

    const selectedTags = Array.from(new Set(selectedInventoryNodes.flatMap((node) => node.tags))).slice(0, 12);
    const selectedGroupName = language === 'zh' ? '已选库存节点' : 'Selected Inventory Nodes';
    const selectedGroup: ExportGroupDraft = {
      id: createProxyGroupId(`${selectedGroupName}-${Date.now()}`),
      name: selectedGroupName,
      strategy: 'select',
      filterTags: selectedTags.join(','),
      nodeIds: selectedInventoryNodes.map((node) => node.id)
    };

    setProfileDraft((current) => ({
      ...current,
      proxyGroups:
        current.profileId === '' && current.proxyGroups.length === 1 && current.proxyGroups[0]?.id === 'proxy-group-premium-auto'
          ? [selectedGroup]
          : [...current.proxyGroups, selectedGroup]
    }));
  }

  function addManualProfileGroup() {
    setProfileDraft((current) => {
      const nextIndex = current.proxyGroups.length + 1;
      const groupName = language === 'zh' ? `自定义组 ${nextIndex}` : `Custom Group ${nextIndex}`;

      return {
        ...current,
        proxyGroups: [
          ...current.proxyGroups,
          {
            id: createProxyGroupId(`${groupName}-${Date.now()}`),
            name: groupName,
            strategy: 'select',
            filterTags: '',
            nodeIds: []
          }
        ]
      };
    });
  }

  function updateProfileGroup(groupId: string, updater: (group: ExportGroupDraft) => ExportGroupDraft) {
    setProfileDraft((current) => ({
      ...current,
      proxyGroups: current.proxyGroups.map((group) => (group.id === groupId ? updater(group) : group))
    }));
  }

  function assignSelectedInventoryNodesToProfileGroup(groupId: string) {
    if (selectedInventoryNodes.length === 0) {
      return;
    }

    const selectedNodeIds = selectedInventoryNodes.map((node) => node.id);
    const selectedTags = Array.from(new Set(selectedInventoryNodes.flatMap((node) => node.tags))).slice(0, 12);

    setProfileDraft((current) => ({
      ...current,
      proxyGroups: current.proxyGroups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        const nextNodeIds = Array.from(new Set([...group.nodeIds, ...selectedNodeIds]));
        const nextFilterTags = Array.from(new Set(splitComma(group.filterTags).concat(selectedTags))).join(',');

        return {
          ...group,
          filterTags: nextFilterTags,
          nodeIds: nextNodeIds
        };
      })
    }));
  }

  function removeNodeFromProfileGroup(groupId: string, nodeId: string) {
    setProfileDraft((current) => ({
      ...current,
      proxyGroups: current.proxyGroups.map((group) =>
        group.id === groupId ? { ...group, nodeIds: group.nodeIds.filter((item) => item !== nodeId) } : group
      )
    }));
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

  function openSourceDiagnosticsDrawer(source: SubscriptionSource) {
    setDrawer({ type: 'source-diagnostics', sourceId: source.id });
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
      void copyToClipboard(links.join('\n'));
    }
  }

  function copySelectedAllFormatSubscriptionUrls() {
    const links = selectedClients.map((client) => [
      client.displayName,
      ...createClientAllFormatSubscriptionLinks(client, language)
    ].join('\n'));

    if (links.length > 0) {
      void copyToClipboard(links.join('\n\n'));
    }
  }

  function copySelectedSubscriptionDiagnostics() {
    const diagnostics = selectedClients.map(createSubscriptionDiagnosticsText);

    if (diagnostics.length > 0) {
      void copyToClipboard(diagnostics.join('\n\n'));
    }
  }

  function copySelectedInventoryNodeRawUrls() {
    const links = selectedInventoryNodes.flatMap((node) => (node.rawUrl ? [node.rawUrl] : []));

    if (links.length > 0) {
      void copyToClipboard(links.join('\n'));
    }
  }

  function copySelectedExportFileSubscriptionUrls() {
    const links = selectedExportFiles.map((file) => {
      const client = clients.find((item) => item.id === file.subscriptionClientId);

      return `${file.name}\n${createExportFileSubscriptionUrl(file, client)}`;
    });

    if (links.length > 0) {
      void copyToClipboard(links.join('\n\n'));
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
      void copyToClipboard(links.join('\n\n'));
    }
  }

  function copyProviderUrl(provider: ProxyProviderConfig) {
    void copyToClipboard(`${provider.name}\n${createProxyProviderUrl(provider)}`);
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
    void copyToClipboard(createClientAllFormatSubscriptionText(client, language));
  }

  function rotateClientAccessCredential(client: SubscriptionClientIdentity) {
    const confirmed =
      typeof window === 'undefined' || window.confirm(t.confirmRotateAccessCredential(client.displayName));

    if (!confirmed) {
      return;
    }

    const draft = {
      ...createDraftFromClient(client),
      accessTokenPreview: createRotatedAccessTokenPreview(),
      securePathPreview: createSecurePathPreview()
    };
    const metadata = createClientMetadataFromDraft(draft, client.generatedNodeCount, client.id);

    onSaveClient(metadata, 'update');
  }

  async function runSubscriptionDeliveryCheck(client: SubscriptionClientIdentity) {
    const targets = createSubscriptionDeliveryCheckTargets(client, language, t);

    setDeliveryChecks((current) => ({
      ...current,
      [client.id]: {
        clientId: client.id,
        state: 'running',
        summary: t.subscriptionDeliveryCheckRunning,
        targets
      }
    }));

    const checkedTargets: SubscriptionDeliveryCheckTarget[] = [];

    for (const target of targets) {
      checkedTargets.push(await checkSubscriptionDeliveryTarget(target));
    }

    setDeliveryChecks((current) => ({
      ...current,
      [client.id]: createSubscriptionDeliveryCheckResult(client.id, checkedTargets, t)
    }));
  }

  function copyNodeRawUrl(node: SubscriptionInventoryNode) {
    if (node.rawUrl) {
      void copyToClipboard(node.rawUrl);
    }
  }

  function copyMatchedNodeRawUrls(nodes: SubscriptionInventoryNode[]) {
    const links = nodes.flatMap((node) => (node.rawUrl ? [node.rawUrl] : []));

    if (links.length > 0) {
      void copyToClipboard(links.join('\n'));
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

    void copyToClipboard(createExportFileSubscriptionUrl(file, client));
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
    const outputFormat = mapClientFormatToOutputFormat(format);

    setClientDraft((current) => ({
      ...current,
      formats: current.formats.includes(format)
        ? current.formats.filter((item) => item !== format)
        : [...current.formats, format],
      outputFormats: current.formats.includes(format)
        ? current.outputFormats.filter((item) => item !== outputFormat)
        : Array.from(new Set([...current.outputFormats, outputFormat]))
    }));
  }

  function toggleClientOutputFormat(format: SubscriptionClientOutputFormat) {
    setClientDraft((current) => ({
      ...current,
      outputFormats: current.outputFormats.includes(format)
        ? current.outputFormats.filter((item) => item !== format)
        : [...current.outputFormats, format]
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
        <div className="flex flex-wrap items-end justify-between gap-3 border border-[#07111F]/18 bg-[#FFFDF5]/78 p-3 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right max-md:w-full max-md:text-left">
            <div className="border border-[#1E3AFF]/30 bg-[#DCE1FF]/55 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#35405A] dark:text-white/58">{t.clientCount}</p>
              <p className="mt-1 text-base font-black text-[#07111F] dark:text-white">{formatNumber(clients.length, language)}</p>
            </div>
            <div className="border border-[#00A878]/35 bg-[#00A878]/[0.10] px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#35405A] dark:text-white/58">{t.inventoryCount}</p>
              <p className="mt-1 text-base font-black text-[#07111F] dark:text-white">{formatNumber(inventoryNodes.length, language)}</p>
            </div>
            <div className="border border-[#FF3D18]/30 bg-[#FFD8C6]/42 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#35405A] dark:text-white/58">{t.exportCount}</p>
              <p className="mt-1 text-base font-black text-[#07111F] dark:text-white">{formatNumber(exportFiles.length, language)}</p>
            </div>
          </div>
        </div>
      </ResponsiveSection>

      <WorkspaceCockpit aria-label="订阅工作台" className="subscription-workbench subscription-ops-cockpit stagger-2">
        <div className="subscription-workbench-grid grid min-h-0 grid-cols-1 gap-0">
          <WorkspaceCockpitScroller aria-label={t.inventoryTab} className="subscription-workbench-inventory subscription-ops-workspace min-h-0 max-md:pb-0">
            <div className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceButton active={activeWorkspace === 'clients'} label={t.clientsTab} onClick={() => setActiveWorkspace('clients')} />
                <WorkspaceButton active={activeWorkspace === 'sources'} label={t.sourcesTab} onClick={() => setActiveWorkspace('sources')} />
                <WorkspaceButton active={activeWorkspace === 'inventory'} label={t.inventoryTab} onClick={() => setActiveWorkspace('inventory')} />
                <WorkspaceButton active={activeWorkspace === 'providers'} label={t.providersTab} onClick={() => setActiveWorkspace('providers')} />
                <WorkspaceButton active={activeWorkspace === 'profiles'} label={profileT.tab} onClick={() => setActiveWorkspace('profiles')} />
                <WorkspaceButton active={activeWorkspace === 'exports'} label={t.exportsTab} onClick={() => setActiveWorkspace('exports')} />
                <div className="ml-auto flex flex-wrap gap-2">
                  <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={openSourceDrawer}>
                    <Download className="h-3.5 w-3.5" />
                    {t.importSource}
                  </GlowButton>
                  <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => openClientDrawer()}>
                    <Plus className="h-3.5 w-3.5" />
                    {t.addClient}
                  </GlowButton>
                  <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => openProfileDrawer()}>
                    <FileSliders className="h-3.5 w-3.5" />
                    {profileT.add}
                  </GlowButton>
                </div>
              </div>
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
                    className={blueSoftActionButtonClass}
                    disabled={selectedClients.length === 0}
                    onClick={renewSelectedClients}
                    type="button"
                  >
                    {t.bulkRenewClients}
                  </button>
                  <button
                    className={blueSoftActionButtonClass}
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
                    className={signalActionButtonClass}
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
                <Table label={t.tableLabel(t.clientsTab)} minWidth="920px">
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="w-12 px-3 py-2.5">{t.selectClient}</th>
                      <th className="px-3 py-2.5">{t.subId}</th>
                      <th className="px-3 py-2.5">{t.email}</th>
                      <th className="px-3 py-2.5">{t.protocol}</th>
                      <th className="px-3 py-2.5">{t.trafficLimit}</th>
                      <th className="px-3 py-2.5">{t.selectedTags}</th>
                      <th className="px-3 py-2.5">{t.formats}</th>
                      <th className="px-3 py-2.5 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {filteredClients.map((client) => (
                      <tr
                        key={client.id}
                        className="subscription-ops-client-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]"
                      >
                        <td className="px-3 py-2.5">
                          <input
                            aria-label={`${t.selectClient} ${client.displayName}`}
                            checked={selectedClientIds.includes(client.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                            onChange={() => toggleClientSelection(client.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{client.displayName}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-white/70">{client.customerName ?? client.email}</p>
                          <p className="mt-1 font-mono text-[11px] font-bold text-slate-500 dark:text-white/45">{client.subId}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {client.enabled ? t.enabled : t.disabled} / {client.group} / {formatNumber(client.generatedNodeCount, language)} {t.matchedNodes}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">{client.email}</td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-bold uppercase text-slate-800 dark:text-white/80">{client.protocol}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">IP {client.ipLimit}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatNumber(client.requestLimitPerHour ?? 360, language)} req/h</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-semibold text-slate-700 dark:text-white/70">
                            {formatBytes(client.usedTrafficBytes)} / {formatBytes(client.trafficLimitBytes)}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatDateTime(client.expiresAt, language)}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <TagList tags={client.selectedTags} />
                        </td>
                        <td className="px-3 py-2.5">
                          <TagList tags={client.formats.map((format) => getClientFormatLabel(format, language))} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-2">
                            <IconButton label={t.copySubscriptionLink} onClick={() => copyToClipboard(createDefaultSubscriptionUrl(client))}>
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
                  <Table label={t.tableLabel(t.sourcesTab)} minWidth="1120px">
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-3 py-2.5">{t.selectSource}</th>
                        <th className="px-3 py-2.5">{t.sourceName}</th>
                        <th className="px-3 py-2.5">{t.sourceUrl}</th>
                        <th className="px-3 py-2.5">{t.syncPolicy}</th>
                        <th className="px-3 py-2.5">{t.syncBudget}</th>
                        <th className="px-3 py-2.5">{t.dedupePolicy}</th>
                        <th className="px-3 py-2.5">{t.sourceNodes}</th>
                        <th className="px-3 py-2.5">{t.sourceTraffic}</th>
                        <th className="px-3 py-2.5">{t.lastSync}</th>
                        <th className="px-3 py-2.5">{t.sourceStatus}</th>
                        <th className="px-3 py-2.5 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredSources.map((source) => (
                        <tr key={source.id} className="subscription-ops-source-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-3 py-2.5">
                            <input
                              aria-label={`${t.selectSource} ${source.name}`}
                              checked={selectedSourceIds.includes(source.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleSourceSelection(source.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white">{source.name}</td>
                          <td className="px-3 py-2.5">
                            <p className="font-mono text-[11px] text-slate-500 dark:text-white/45">{source.url}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400 dark:text-white/35">{source.userAgent ?? 'OU-UI-Next/1.0'}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">
                            {formatNumber(source.refreshIntervalMinutes ?? source.rateLimitPerMinute, language)} min
                          </td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">
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
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-white/60">{source.dedupeKey}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">{formatNumber(source.nodeCount, language)}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">
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
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">{formatDateTime(source.lastSyncAt, language)}</td>
                          <td className="px-3 py-2.5 text-xs font-bold uppercase text-slate-500 dark:text-white/50">
                            <p>{source.status}</p>
                            {source.syncWarnings?.length ? (
                              <div className="mt-1 space-y-1 normal-case text-orange-600 dark:text-orange-300/80">
                                {source.syncWarnings.slice(0, 2).map((warning) => (
                                  <p key={warning}>{formatSourceSyncWarning(warning, language)}</p>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-end gap-2">
                              <IconButton label={t.viewSourceSyncDiagnosis} onClick={() => openSourceDiagnosticsDrawer(source)}>
                                <ListTree className="h-3.5 w-3.5" />
                              </IconButton>
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
                <Table label={t.tableLabel(t.inventoryTab)} minWidth="1040px">
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="w-12 px-3 py-2.5">{t.selectInventoryNode}</th>
                      <th className="px-3 py-2.5">{t.nodeName}</th>
                      <th className="px-3 py-2.5">{t.protocol}</th>
                      <th className="px-3 py-2.5">{t.server}</th>
                      <th className="px-3 py-2.5">{t.tags}</th>
                      <th className="px-3 py-2.5">{t.origin}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {filteredInventoryNodes.map((node) => (
                      <tr key={node.id} className="subscription-ops-inventory-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-3 py-2.5">
                          <input
                            aria-label={`${t.selectInventoryNode} ${node.name}`}
                            checked={selectedInventoryNodeIds.includes(node.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                            onChange={() => toggleInventoryNodeSelection(node.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{node.name}</p>
                          <p className="mt-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-white/45">{node.status ?? 'unknown'} / {formatNumber(node.latencyMs, language)} ms</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{node.protocol}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700 dark:text-white/70">{node.server}:{node.port}</td>
                        <td className="px-3 py-2.5"><TagList tags={node.tags} /></td>
                        <td className="px-3 py-2.5">
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
                  <Table label={t.tableLabel(profileT.tab)} minWidth="1040px">
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-3 py-2.5">{profileT.selectProfile}</th>
                        <th className="px-3 py-2.5">{profileT.profileName}</th>
                        <th className="px-3 py-2.5">{profileT.profileClient}</th>
                        <th className="px-3 py-2.5">{profileT.outputFormats}</th>
                        <th className="px-3 py-2.5">{profileT.proxyGroups}</th>
                        <th className="px-3 py-2.5">{t.filter}</th>
                        <th className="px-3 py-2.5 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredExportProfiles.map((profile) => (
                        <tr key={profile.id} className="subscription-ops-profile-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-3 py-2.5">
                            <input
                              aria-label={`${profileT.selectProfile} ${profile.name}`}
                              checked={selectedProfileIds.includes(profile.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleProfileSelection(profile.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{profile.name}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{profile.templateName}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{profile.client}</td>
                          <td className="px-3 py-2.5"><TagList tags={profile.outputFormats} /></td>
                          <td className="px-3 py-2.5">
                            <TagList tags={profile.proxyGroups.map((group) => `${group.name}:${group.strategy}`)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-[11px] text-slate-500 dark:text-white/45">{profile.includeFilter || '-'}</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{profile.excludeFilter || '-'}</p>
                          </td>
                          <td className="px-3 py-2.5">
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
                  <Table label={t.tableLabel(t.exportsTab)} minWidth="1080px">
                    <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                      <tr>
                        <th className="w-12 px-3 py-2.5">{t.selectExportFile}</th>
                        <th className="px-3 py-2.5">{t.exportName}</th>
                        <th className="px-3 py-2.5">{t.template}</th>
                        <th className="px-3 py-2.5">{t.formats}</th>
                        <th className="px-3 py-2.5">{t.tags}</th>
                        <th className="px-3 py-2.5">{t.trafficLimit}</th>
                        <th className="px-3 py-2.5">{t.accessToken}</th>
                        <th className="px-3 py-2.5 text-right">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                      {filteredExportFiles.map((file) => (
                        <tr key={file.id} className="subscription-ops-export-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-3 py-2.5">
                            <input
                              aria-label={`${t.selectExportFile} ${file.name}`}
                              checked={selectedExportFileIds.includes(file.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                              onChange={() => toggleExportFileSelection(file.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{file.name}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.subId}</p>
                            {file.exportProfileName ? (
                              <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">{file.exportProfileName}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-700 dark:text-white/70">{file.templateName}</td>
                          <td className="px-3 py-2.5"><TagList tags={file.formats.map((format) => getClientFormatLabel(format, language))} /></td>
                          <td className="px-3 py-2.5"><TagList tags={file.selectedTags} /></td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-white/70">
                            <p>{formatBytes(file.trafficLimitBytes)}</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatDateTime(file.expiresAt, language)}</p>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.accessTokenPreview}</td>
                          <td className="px-3 py-2.5 text-right">
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
          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.outputFormat}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              {profileOutputFormatOptions.map((option) => (
                <label key={option.outputFormat} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 break-words text-xs font-bold uppercase text-slate-700 dark:text-white/70">{option.label[language]}</span>
                  <GlassToggle
                    aria-label={`${t.outputFormat}: ${option.label[language]}`}
                    checked={clientDraft.outputFormats.includes(option.outputFormat)}
                    onChange={() => toggleClientOutputFormat(option.outputFormat)}
                  />
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
              {clientDraft.outputFormats.map((format) => (
                <p key={format}>{getClientOutputFormatLabel(format, language)}: {subscriptionUrls[format]}</p>
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
            <SubscriptionDeliveryBriefPanel
              brief={createSubscriptionDeliveryBrief(linkDrawerClient, language, t)}
              t={t}
            />
            <SubscriptionDeliveryCheckPanel
              language={language}
              onCopy={() => {
                if (linkDrawerDeliveryCheck) {
                  void copyToClipboard(createSubscriptionDeliveryCheckText(linkDrawerDeliveryCheck));
                }
              }}
              onRun={() => {
                void runSubscriptionDeliveryCheck(linkDrawerClient);
              }}
              result={linkDrawerDeliveryCheck}
              t={t}
            />
            <SubscriptionDeliveryRecoveryPanel
              client={linkDrawerClient}
              configuredSources={linkDrawerConfiguredSources}
              language={language}
              matchedNodes={linkDrawerMatchedNodes}
              matchedSources={linkDrawerMatchedSources}
              onOpenMatchedNodes={() => openMatchedNodesDrawer(linkDrawerClient)}
              onOpenSourceDiagnosis={openSourceDiagnosticsDrawer}
              onViewInventory={() => viewClientInInventory(linkDrawerClient)}
              result={linkDrawerDeliveryCheck}
              t={t}
            />
            <div className={subscriptionDrawerNeutralPanelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-white">
                  {t.portalLink}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={compactNeutralActionButtonClass}
                    onClick={() => copyToClipboard(createClientSubscriptionPortalUrl(linkDrawerClient))}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.copyPortalLink}
                  </button>
                  <button
                    className={compactCommandActionButtonClass}
                    onClick={() => openExternalLink(createClientSubscriptionPortalUrl(linkDrawerClient))}
                    type="button"
                  >
                    {t.openPortalLink}
                  </button>
                </div>
              </div>
              <p className="mt-3 break-all border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 font-mono text-[11px] leading-5 text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70">
                {createClientSubscriptionPortalUrl(linkDrawerClient)}
              </p>
            </div>
            <div className={subscriptionDrawerCommandPanelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-[#DDE3FF]">
                  {t.subscriptionUsageHeader}
                </p>
                <button
                  className={compactCommandActionButtonClass}
                  onClick={() => copyToClipboard(createSubscriptionUsageHeaderLine(linkDrawerClient))}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copySubscriptionUsageHeader}
                </button>
              </div>
              <p className="mt-3 break-all border border-[#07111F]/14 bg-[#FFFDF5]/86 p-3 font-mono text-[11px] leading-5 text-[#07111F] dark:border-white/10 dark:bg-[#07111F]/24 dark:text-[#F7F8E8]">
                {createSubscriptionUsageHeaderValue(linkDrawerClient)}
              </p>
            </div>
            <div className={subscriptionDrawerNeutralPanelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-white">
                  {t.subscriptionAccessStats}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={compactNeutralActionButtonClass}
                    disabled={taskMutationBusy}
                    onClick={() => rotateClientAccessCredential(linkDrawerClient)}
                    type="button"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t.rotateAccessCredential}
                  </button>
                  <button
                    className={compactNeutralActionButtonClass}
                    onClick={() => copyToClipboard(createSubscriptionDiagnosticsText(linkDrawerClient))}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.copySubscriptionDiagnostics}
                  </button>
                </div>
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
                  tone="signal"
                  value={createSubscriptionGuardrailStatus(linkDrawerClient)}
                />
              </div>
            </div>
            {readClientOutputFormats(linkDrawerClient).map((format) => {
              const label = getClientOutputFormatLabel(format, language);
              const url = createClientSubscriptionUrl(linkDrawerClient, format);
              const qrLabel = t.qrCodeLabel(label);

              return (
                <div key={format} className={subscriptionDrawerNeutralPanelClass}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-white">{label}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={compactNeutralActionButtonClass}
                        onClick={() => copyToClipboard(url)}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.copyFormatLink(label)}
                      </button>
                      <button
                        className={compactCommandActionButtonClass}
                        onClick={() => openExternalLink(url)}
                        type="button"
                      >
                        {t.openFormatLink(label)}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <p className="break-all border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 font-mono text-[11px] leading-5 text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70">
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
        open={drawer.type === 'source-diagnostics'}
        returnFocusRef={returnFocusRef}
        title={sourceDiagnosticsDrawerSource ? `${sourceDiagnosticsDrawerSource.name} ${t.sourceSyncDiagnosis}` : t.sourceSyncDiagnosis}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {sourceDiagnosticsDrawerSource ? (
          <SourceSyncDiagnosisPanel
            diagnosis={createSourceSyncDiagnosis(sourceDiagnosticsDrawerSource, language, t)}
            language={language}
            onCopy={() => {
              void copyToClipboard(createSourceSyncDiagnosisText(sourceDiagnosticsDrawerSource, language, t));
            }}
            onSync={() => syncSource(sourceDiagnosticsDrawerSource)}
            source={sourceDiagnosticsDrawerSource}
            t={t}
          />
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
            <div className={subscriptionDrawerMutedPanelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[#35405A] dark:text-white/65">
                  {t.matchedNodesSummary(
                    formatNumber(nodeDrawerMatches.length, language),
                    formatNumber(inventoryNodes.length, language)
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={compactCommandActionButtonClass}
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
            </div>

            {nodeDrawerSources.length > 0 ? (
              <div className={subscriptionDrawerSignalPanelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-[#FFD8C6]">{t.matchedSources}</p>
                  <button
                    className={compactCommandActionButtonClass}
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
                    <div key={item.id} className={subscriptionDrawerMutedPanelClass}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#07111F] dark:text-white">
                            {item.source?.name ?? item.id}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold uppercase text-[#35405A] dark:text-white/55">
                            {(item.source?.status ?? t.missingSource)} / {formatNumber(item.nodeCount, language)} {t.matchedNodes}
                          </p>
                          {item.source ? (
                            <p className="mt-1 text-[11px] text-[#35405A] dark:text-white/55">
                              {t.lastSync}: {formatDateTime(item.source.lastSyncAt, language)}
                            </p>
                          ) : null}
                        </div>
                        <span className="rounded-full border border-[#07111F]/14 bg-[#FFFDF5] px-2.5 py-1 text-[10px] font-bold uppercase text-[#35405A] dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60">
                          {item.id}
                        </span>
                      </div>
                      {item.source ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            className={compactNeutralActionButtonClass}
                            onClick={() => {
                              if (item.source) {
                                openSourceDiagnosticsDrawer(item.source);
                              }
                            }}
                            type="button"
                          >
                            <ListTree className="h-3.5 w-3.5" />
                            {t.viewSourceSyncDiagnosis}
                          </button>
                        </div>
                      ) : null}
                      {item.source?.syncWarnings?.length ? (
                        <div className="mt-2 space-y-1 text-xs font-semibold text-[#FF3D18] dark:text-[#FFD8C6]">
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
              <div className={subscriptionDrawerNeutralPanelClass}>
                <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-white">{t.relatedExportFiles}</p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {nodeDrawerExportFiles.map((file) => (
                    <div key={file.id} className={subscriptionDrawerMutedPanelClass}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#07111F] dark:text-white">{file.name}</p>
                          <p className="mt-1 font-mono text-[11px] text-[#35405A] dark:text-white/55">{file.templateName}</p>
                          {file.exportProfileName ? (
                            <p className="mt-1 text-[11px] font-semibold text-[#35405A] dark:text-white/55">{file.exportProfileName}</p>
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
                      <p className="mt-2 text-[11px] font-semibold text-[#35405A] dark:text-white/55">
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
                  <div key={node.id} className={subscriptionDrawerNeutralPanelClass}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-[#07111F] dark:text-white">{node.name}</p>
                        <p className="mt-1 font-mono text-xs text-[#35405A] dark:text-white/70">
                          {node.protocol.toUpperCase()} / {node.server}:{node.port}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold uppercase text-[#35405A] dark:text-white/55">
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
                    <p className="mt-3 break-all border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 font-mono text-[11px] leading-5 text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70">
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
        headerActions={
          <button
            aria-pressed={profileLayoutEditing}
            className={profileLayoutEditing ? blueActionButtonClass : compactCommandActionButtonClass}
            onClick={() => setProfileLayoutEditing((current) => !current)}
            type="button"
          >
            {profileLayoutEditing ? profileT.exitEditLayout : profileT.editLayout}
          </button>
        }
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
                { label: 'Surge', value: 'surge' },
                { label: 'Shadowrocket', value: 'shadowrocket' },
                { label: 'Stash', value: 'stash' }
              ]}
            />
          </div>

          <InputField
            label={t.templateName}
            value={profileDraft.templateName}
            onChange={(value) => setProfileDraft((current) => ({ ...current, templateName: value }))}
          />

          <div className={subscriptionDrawerNeutralPanelClass}>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/55">{profileT.sourceScope}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between border border-[#07111F]/14 px-3 py-2 dark:border-white/10">
                <span className="text-xs font-bold text-[#07111F] dark:text-white/70">{profileT.allSources}</span>
                <GlassToggle
                  aria-label={profileT.allSources}
                  checked={profileDraft.sourceIds.length === 0}
                  onChange={() => setProfileDraft((current) => ({ ...current, sourceIds: [] }))}
                />
              </label>
              {sources.map((source) => (
                <label key={source.id} className="flex items-center justify-between gap-3 border border-[#07111F]/14 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 truncate text-xs font-bold text-[#07111F] dark:text-white/70">{source.name}</span>
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
          </div>

          <div className={subscriptionDrawerCommandPanelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1E3AFF] dark:text-[#9EACFF]">{profileT.proxyGroups}</p>
              <div className="flex flex-wrap gap-2">
                <button className={compactCommandActionButtonClass} onClick={addManualProfileGroup} type="button">
                  <Plus className="h-3.5 w-3.5" />
                  {profileT.addGroup}
                </button>
                <button
                  className={compactCommandActionButtonClass}
                  disabled={selectedInventoryNodes.length === 0}
                  onClick={addSelectedInventoryNodesToProfileGroup}
                  type="button"
                >
                  <Layers3 className="h-3.5 w-3.5" />
                  {profileT.addSelectedNodes}
                </button>
              </div>
            </div>
            <div
              className={
                profileLayoutEditing
                  ? 'mt-3 overflow-auto border border-[#07111F]/16 bg-[#FFFDF5]/58 p-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.03]'
                  : 'mt-3'
              }
            >
              <EditableCardStage
                className={profileLayoutEditing ? 'profile-layout-stage' : 'profile-layout-stage flex flex-col gap-3'}
                defaultLayouts={Object.fromEntries(
                  profileDraft.proxyGroups.map((group, index) => [
                    group.id,
                    {
                      x: 0,
                      y: index * 24,
                      width: 360,
                      height: 260
                    }
                  ])
                )}
                constrainToLayouts={profileLayoutEditing}
                padding={24}
                storageKey={profileLayoutStorageKey}
              >
                {profileDraft.proxyGroups.map((group, index) => (
                  <EditableCardFrame
                    className="border border-[#07111F]/16 bg-[#FFFDF5]/74 p-3 transition duration-200 ease-out motion-safe:animate-[ou-panel-in_180ms_ease-out] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] max-md:!left-0 max-md:!top-auto max-md:!h-auto max-md:!w-full max-md:!transform-none max-md:!relative"
                    defaultLayout={{
                      x: 0,
                      y: index * 24,
                      width: 360,
                      height: 260
                    }}
                    isEditable={profileLayoutEditing}
                    key={group.id}
                    layoutKey={group.id}
                    storageKey={profileLayoutStorageKey}
                    title={group.name || profileT.proxyGroupName}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#07111F]/12 pb-2 dark:border-white/10">
                      <p className="min-w-0 break-words text-xs font-black text-[#07111F] dark:text-white">{group.name || profileT.proxyGroupName}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={compactCommandActionButtonClass}
                          disabled={selectedInventoryNodes.length === 0}
                          onClick={() => assignSelectedInventoryNodesToProfileGroup(group.id)}
                          aria-label={`${profileT.addSelectedNodes}: ${group.name || profileT.proxyGroupName}`}
                          type="button"
                        >
                          <Layers3 className="h-3.5 w-3.5" />
                          {profileT.addSelectedNodes}
                        </button>
                        <span className="border border-[#1E3AFF]/24 bg-[#DCE1FF]/58 px-2 py-1 text-[10px] font-bold uppercase text-[#1E3AFF] dark:border-[#6B7CFF]/24 dark:bg-[#1E3AFF]/14 dark:text-[#DDE3FF]">
                          {group.strategy} / {group.nodeIds.length}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <InputField
                        label={profileT.proxyGroupName}
                        value={group.name}
                        onChange={(value) => updateProfileGroup(group.id, (current) => ({ ...current, name: value }))}
                      />
                      <SelectField
                        label={profileT.proxyGroupStrategy}
                        value={group.strategy}
                        onChange={(value) =>
                          updateProfileGroup(group.id, (current) => ({
                            ...current,
                            strategy: value as ProxyGroupTemplate['strategy']
                          }))
                        }
                        options={[
                          { label: 'select', value: 'select' },
                          { label: 'url-test', value: 'url-test' },
                          { label: 'fallback', value: 'fallback' },
                          { label: 'load-balance', value: 'load-balance' }
                        ]}
                      />
                      <InputField
                        label={profileT.proxyGroupTags}
                        value={group.filterTags}
                        onChange={(value) => updateProfileGroup(group.id, (current) => ({ ...current, filterTags: value }))}
                      />
                    </div>
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/55">{profileT.proxyGroupNodes}</p>
                      {group.nodeIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {group.nodeIds.map((nodeId) => {
                            const node = inventoryNodes.find((item) => item.id === nodeId);

                            return (
                              <span
                                className="inline-flex max-w-full items-center gap-2 border border-[#1E3AFF]/30 bg-[#DCE1FF]/62 px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#6B7CFF]/22 dark:bg-[#1E3AFF]/14 dark:text-[#DDE3FF]"
                                key={nodeId}
                              >
                                {node?.name ?? nodeId}
                                <button
                                  aria-label={`Remove ${node?.name ?? nodeId}`}
                                  className="rounded-full border border-[#07111F]/14 px-1.5 py-0.5 text-[10px] font-black uppercase text-[#35405A] transition hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 dark:border-white/10 dark:text-white/55 dark:hover:bg-white/[0.06]"
                                  onClick={() => removeNodeFromProfileGroup(group.id, nodeId)}
                                  type="button"
                                >
                                  x
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-[#35405A] dark:text-white/55">{profileT.noProxyGroupNodes}</p>
                      )}
                    </div>
                  </EditableCardFrame>
                ))}
              </EditableCardStage>
            </div>
          </div>

          <div className={subscriptionDrawerNeutralPanelClass}>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/55">{profileT.outputFormats}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              {profileOutputFormatOptions.map((option) => (
                <label key={option.outputFormat} className="flex min-h-12 items-center justify-between gap-3 border border-[#07111F]/14 px-3 py-2 dark:border-white/10">
                  <span className="min-w-0 break-words text-xs font-bold uppercase text-[#07111F] dark:text-white/70">{option.label[language]}</span>
                  <GlassToggle
                    aria-label={`${profileT.outputFormats}: ${option.label[language]}`}
                    checked={profileDraft.outputFormats.includes(option.outputFormat)}
                    onChange={() => toggleProfileOutputFormat(option.outputFormat)}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 border border-[#07111F]/14 p-3 dark:border-white/10">
            <span className="text-xs font-bold text-[#07111F] dark:text-white/70">{profileT.includeTrafficHeaders}</span>
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

function SubscriptionDiagnosticField({ label, tone, value }: { label: string; tone?: 'signal'; value: string }) {
  const fieldClass =
    tone === 'signal'
      ? 'border-[#FF3D18]/35 bg-[#FFD8C6]/62 dark:border-[#FF6A3A]/28 dark:bg-[#FF3D18]/12'
      : 'border-[#07111F]/14 bg-[#FDFFF1]/80 dark:border-white/10 dark:bg-white/[0.03]';
  const labelClass =
    tone === 'signal'
      ? 'text-[#07111F] dark:text-[#FFD8C6]'
      : 'text-[#35405A] dark:text-white/55';

  return (
    <div className={`min-w-0 border p-3 ${fieldClass}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>{label}</p>
      <p className="mt-1 break-words font-mono text-[11px] font-bold leading-5 text-[#07111F] dark:text-white/75">{value}</p>
    </div>
  );
}

function SubscriptionDeliveryBriefPanel({
  brief,
  t
}: {
  brief: SubscriptionDeliveryBrief;
  t: (typeof copy)[AppLanguage];
}) {
  const panelClass = {
    ready: subscriptionDrawerCommandPanelClass,
    warning: subscriptionDrawerMutedPanelClass,
    blocked: subscriptionDrawerSignalPanelClass
  } satisfies Record<SubscriptionDeliveryState, string>;
  const badgeClass = {
    ready: 'border-[#00A878]/35 bg-[#00A878]/12 text-[#006B50] dark:border-[#35E68E]/25 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]',
    warning: 'border-[#FFB020]/40 bg-[#FFF3C4]/70 text-[#8A5A00] dark:border-[#FFD166]/28 dark:bg-[#FFD166]/10 dark:text-[#FFD166]',
    blocked: 'border-[#FF3D18]/40 bg-[#FFF1EC]/80 text-[#9F2A13] dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/14 dark:text-[#FFD8C6]'
  } satisfies Record<SubscriptionDeliveryState, string>;

  return (
    <section
      aria-label={t.subscriptionDeliveryBrief}
      className={panelClass[brief.state]}
      data-subscription-delivery-state={brief.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest">
            {t.subscriptionDeliveryBrief}
          </p>
          <p className="mt-2 break-words text-sm font-black">
            {brief.reasonText}
          </p>
        </div>
        <span className={`border px-2.5 py-1 text-[10px] font-black uppercase ${badgeClass[brief.state]}`}>
          {brief.statusLabel}
        </span>
      </div>
      <p className="mt-3 border border-current/18 bg-white/45 px-2.5 py-2 text-[11px] font-semibold leading-5 dark:bg-white/[0.04]">
        <span className="font-black uppercase tracking-widest">{t.subscriptionDeliveryNextAction}: </span>
        {brief.nextAction}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <SubscriptionDiagnosticField label={t.subscriptionDeliveryState} value={brief.statusLabel} />
        <SubscriptionDiagnosticField label={t.subscriptionDeliveryFormats} value={brief.outputFormatLabel} />
        <SubscriptionDiagnosticField label={t.subscriptionDeliveryUsage} value={brief.usageValue} />
        <SubscriptionDiagnosticField label={t.requestLimitShort} value={brief.requestLimitValue} />
      </div>
      {brief.reasons.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {brief.reasons.map((reason) => (
            <span className="border border-current/18 bg-white/42 px-2 py-1 text-[10px] font-bold dark:bg-white/[0.04]" key={reason}>
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SubscriptionDeliveryCheckPanel({
  language,
  onCopy,
  onRun,
  result,
  t
}: {
  language: AppLanguage;
  onCopy: () => void;
  onRun: () => void;
  result?: SubscriptionDeliveryCheckResult;
  t: (typeof copy)[AppLanguage];
}) {
  const state = result?.state ?? 'idle';
  const canCopy = Boolean(result?.checkedAt);
  const isRunning = state === 'running';
  const panelClass = {
    idle: subscriptionDrawerNeutralPanelClass,
    running: subscriptionDrawerCommandPanelClass,
    passed: subscriptionDrawerCommandPanelClass,
    warning: subscriptionDrawerMutedPanelClass,
    failed: subscriptionDrawerSignalPanelClass
  } satisfies Record<SubscriptionDeliveryCheckState, string>;
  const badgeClass = {
    idle: 'border-[#07111F]/18 bg-white/60 text-[#35405A] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60',
    running: 'border-[#1E3AFF]/35 bg-[#DCE1FF]/76 text-[#07111F] dark:border-[#6B7CFF]/28 dark:bg-[#1E3AFF]/16 dark:text-[#DDE3FF]',
    passed: 'border-[#00A878]/35 bg-[#00A878]/12 text-[#006B50] dark:border-[#35E68E]/25 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]',
    warning: 'border-[#FFB020]/40 bg-[#FFF3C4]/70 text-[#8A5A00] dark:border-[#FFD166]/28 dark:bg-[#FFD166]/10 dark:text-[#FFD166]',
    failed: 'border-[#FF3D18]/40 bg-[#FFF1EC]/80 text-[#9F2A13] dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/14 dark:text-[#FFD8C6]'
  } satisfies Record<SubscriptionDeliveryCheckState, string>;

  return (
    <section
      aria-label={t.subscriptionDeliveryCheck}
      aria-live="polite"
      className={panelClass[state]}
      data-subscription-delivery-check-state={state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest">
            {t.subscriptionDeliveryCheck}
          </p>
          <p className="mt-2 break-words text-sm font-black">
            {result?.summary ?? t.subscriptionDeliveryCheckNoResult}
          </p>
        </div>
        <span className={`border px-2.5 py-1 text-[10px] font-black uppercase ${badgeClass[state]}`}>
          {getSubscriptionDeliveryCheckStateLabel(state, t)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={compactCommandActionButtonClass}
          disabled={isRunning}
          onClick={onRun}
          type="button"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${isRunning ? 'motion-safe:animate-spin' : ''}`} />
          {t.runSubscriptionDeliveryCheck}
        </button>
        <button
          className={compactNeutralActionButtonClass}
          disabled={!canCopy}
          onClick={onCopy}
          type="button"
        >
          <Copy className="h-3.5 w-3.5" />
          {t.copySubscriptionDeliveryCheck}
        </button>
      </div>
      {result?.checkedAt ? (
        <p className="mt-3 border border-current/18 bg-white/45 px-2.5 py-2 font-mono text-[11px] font-semibold leading-5 dark:bg-white/[0.04]">
          <span className="font-black uppercase tracking-widest">{t.subscriptionDeliveryCheckCheckedAt}: </span>
          {formatDateTime(result.checkedAt, language)}
        </p>
      ) : null}
      {result?.targets.length ? (
        <div className="mt-3 space-y-2">
          {result.targets.map((target) => (
            <div
              className={`border p-2.5 ${
                target.ok === false
                  ? 'border-[#FF3D18]/35 bg-[#FFF1EC]/76 dark:border-[#FF6A3A]/24 dark:bg-[#FF3D18]/10'
                  : hasSubscriptionDeliveryCheckWarning(target)
                    ? 'border-[#FFB020]/35 bg-[#FFF8DD]/76 dark:border-[#FFD166]/24 dark:bg-[#FFD166]/10'
                    : 'border-[#07111F]/14 bg-white/45 dark:border-white/10 dark:bg-white/[0.035]'
              }`}
              key={target.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-widest">{target.label}</p>
                <span className="border border-current/18 bg-white/48 px-2 py-1 font-mono text-[10px] font-black dark:bg-white/[0.04]">
                  {target.status ? `HTTP ${target.status}` : target.ok === false ? t.subscriptionDeliveryCheckFailed : '-'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckContentType}
                  value={target.contentType ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckUserinfo}
                  value={target.subscriptionUserinfo ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckNodes}
                  value={target.nodeCount ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckSelected}
                  value={target.selectedNodeCount ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckConverted}
                  value={target.convertedUriCount ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckUnconverted}
                  tone={hasSubscriptionDeliveryCheckWarning(target) ? 'signal' : undefined}
                  value={target.unconvertedNodeCount ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckProducer}
                  value={target.producer ?? '-'}
                />
                <SubscriptionDiagnosticField
                  label={t.subscriptionDeliveryCheckError}
                  tone={target.ok === false ? 'signal' : undefined}
                  value={target.error ?? target.conversionWarning ?? '-'}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SubscriptionDeliveryRecoveryPanel({
  client,
  configuredSources,
  language,
  matchedNodes,
  matchedSources,
  onOpenMatchedNodes,
  onOpenSourceDiagnosis,
  onViewInventory,
  result,
  t
}: {
  client: SubscriptionClientIdentity;
  configuredSources: SubscriptionSource[];
  language: AppLanguage;
  matchedNodes: SubscriptionInventoryNode[];
  matchedSources: Array<{ id: string; source?: SubscriptionSource; nodeCount: number }>;
  onOpenMatchedNodes: () => void;
  onOpenSourceDiagnosis: (source: SubscriptionSource) => void;
  onViewInventory: () => void;
  result?: SubscriptionDeliveryCheckResult;
  t: (typeof copy)[AppLanguage];
}) {
  const failedTargets = result?.targets.filter((target) => target.ok === false) ?? [];
  const warningTargets = result?.targets.filter(hasSubscriptionDeliveryCheckWarning) ?? [];
  const recoverySources = mergeDeliveryRecoverySources(matchedSources, configuredSources);
  const issueSources = recoverySources.filter((item) => hasSourceSyncIssue(item.source));
  const noDeliverableNodes = matchedNodes.length === 0 || client.generatedNodeCount <= 0;
  const shouldShow =
    failedTargets.length > 0 ||
    warningTargets.length > 0 ||
    noDeliverableNodes ||
    issueSources.length > 0 ||
    result?.state === 'failed' ||
    result?.state === 'warning';

  if (!shouldShow) {
    return null;
  }

  const summary = failedTargets.length
    ? t.subscriptionDeliveryRecoveryRequestFailed
    : warningTargets.length
      ? t.subscriptionDeliveryRecoveryConversion
      : noDeliverableNodes
        ? t.subscriptionDeliveryRecoveryNoNodes
        : issueSources.length
          ? t.subscriptionDeliveryRecoverySourceWarnings
          : t.subscriptionDeliveryRecoveryReady;

  return (
    <section
      aria-label={t.subscriptionDeliveryRecovery}
      className={subscriptionDrawerSignalPanelClass}
      data-subscription-delivery-recovery-state={failedTargets.length > 0 ? 'failed' : 'warning'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest">{t.subscriptionDeliveryRecovery}</p>
          <p className="mt-2 break-words text-sm font-black">{summary}</p>
        </div>
        <span className="border border-current/18 bg-white/45 px-2.5 py-1 text-[10px] font-black uppercase dark:bg-white/[0.04]">
          {t.subscriptionDeliveryRecoveryNextAction}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={compactCommandActionButtonClass} onClick={onViewInventory} type="button">
          <ListTree className="h-3.5 w-3.5" />
          {t.viewDeliveryInventory}
        </button>
        <button className={compactNeutralActionButtonClass} onClick={onOpenMatchedNodes} type="button">
          <Layers3 className="h-3.5 w-3.5" />
          {t.viewDeliveryMatchedNodes}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <SubscriptionDiagnosticField
          label={t.subscriptionDeliveryRecoveryMatchedInventory}
          value={formatNumber(matchedNodes.length, language)}
        />
        <SubscriptionDiagnosticField
          label={t.subscriptionDeliveryRecoverySourceCoverage}
          value={`${formatNumber(recoverySources.length, language)} / ${formatNumber(client.sourceIds.length, language)}`}
        />
        <SubscriptionDiagnosticField
          label={t.subscriptionDeliveryRecoveryFailedTargets}
          tone={failedTargets.length > 0 ? 'signal' : undefined}
          value={formatNumber(failedTargets.length, language)}
        />
        <SubscriptionDiagnosticField
          label={t.subscriptionDeliveryRecoverySourceIssues}
          tone={issueSources.length > 0 ? 'signal' : undefined}
          value={formatNumber(issueSources.length, language)}
        />
      </div>
      {warningTargets.length > 0 || failedTargets.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...failedTargets, ...warningTargets].map((target) => (
            <span className="border border-current/18 bg-white/42 px-2 py-1 text-[10px] font-bold dark:bg-white/[0.04]" key={target.id}>
              {target.label}: {target.error ?? target.conversionWarning ?? target.unconvertedNodeCount ?? target.status ?? '-'}
            </span>
          ))}
        </div>
      ) : null}
      {recoverySources.length > 0 ? (
        <div className="mt-3 space-y-2">
          {recoverySources.map((item) => {
            const diagnosis = createSourceSyncDiagnosis(item.source, language, t);

            return (
              <div
                className={`border p-2.5 ${
                  hasSourceSyncIssue(item.source)
                    ? 'border-[#FFB020]/35 bg-[#FFF8DD]/76 dark:border-[#FFD166]/24 dark:bg-[#FFD166]/10'
                    : 'border-[#07111F]/14 bg-white/45 dark:border-white/10 dark:bg-white/[0.035]'
                }`}
                key={item.source.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-[#07111F] dark:text-white">{item.source.name}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase text-[#35405A] dark:text-white/55">
                      {diagnosis.stateLabel} / {formatNumber(item.nodeCount, language)} {t.matchedNodes}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-[#35405A] dark:text-white/60">
                      {diagnosis.warnings[0]?.label ?? diagnosis.budgetWarnings[0] ?? diagnosis.summary}
                    </p>
                  </div>
                  <button
                    className={compactNeutralActionButtonClass}
                    onClick={() => onOpenSourceDiagnosis(item.source)}
                    type="button"
                  >
                    <ListTree className="h-3.5 w-3.5" />
                    {t.openSourceDiagnosisFor(item.source.name)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function SourceSyncDiagnosisPanel({
  diagnosis,
  language,
  onCopy,
  onSync,
  source,
  t
}: {
  diagnosis: SourceSyncDiagnosis;
  language: AppLanguage;
  onCopy: () => void;
  onSync: () => void;
  source: SubscriptionSource;
  t: (typeof copy)[AppLanguage];
}) {
  const panelClass = {
    ready: subscriptionDrawerCommandPanelClass,
    warning: subscriptionDrawerMutedPanelClass,
    failed: subscriptionDrawerSignalPanelClass,
    paused: subscriptionDrawerMutedPanelClass,
    syncing: subscriptionDrawerCommandPanelClass
  } satisfies Record<SourceSyncDiagnosisState, string>;
  const badgeClass = {
    ready: 'border-[#00A878]/35 bg-[#00A878]/12 text-[#006B50] dark:border-[#35E68E]/25 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]',
    warning: 'border-[#FFB020]/40 bg-[#FFF3C4]/70 text-[#8A5A00] dark:border-[#FFD166]/28 dark:bg-[#FFD166]/10 dark:text-[#FFD166]',
    failed: 'border-[#FF3D18]/40 bg-[#FFF1EC]/80 text-[#9F2A13] dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/14 dark:text-[#FFD8C6]',
    paused: 'border-[#07111F]/18 bg-white/60 text-[#35405A] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60',
    syncing: 'border-[#1E3AFF]/35 bg-[#DCE1FF]/76 text-[#07111F] dark:border-[#6B7CFF]/28 dark:bg-[#1E3AFF]/16 dark:text-[#DDE3FF]'
  } satisfies Record<SourceSyncDiagnosisState, string>;
  const budgetIssues = diagnosis.budgetWarnings.map((warning) => ({
    label: warning,
    nextAction: t.sourceSyncWarningBudgetNext,
    severity: 'warning' as const
  }));
  const issues = [...diagnosis.warnings, ...budgetIssues];

  return (
    <div className="space-y-3">
      <section
        aria-label={t.sourceSyncDiagnosis}
        className={panelClass[diagnosis.state]}
        data-source-sync-diagnosis-state={diagnosis.state}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest">{t.sourceSyncDiagnosis}</p>
            <p className="mt-2 break-words text-sm font-black">{diagnosis.summary}</p>
          </div>
          <span className={`border px-2.5 py-1 text-[10px] font-black uppercase ${badgeClass[diagnosis.state]}`}>
            {diagnosis.stateLabel}
          </span>
        </div>
        <p className="mt-3 border border-current/18 bg-white/45 px-2.5 py-2 text-[11px] font-semibold leading-5 dark:bg-white/[0.04]">
          <span className="font-black uppercase tracking-widest">{t.sourceSyncDiagnosisNextAction}: </span>
          {diagnosis.nextAction}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={compactCommandActionButtonClass} onClick={onSync} type="button">
            <RefreshCcw className="h-3.5 w-3.5" />
            {t.syncNow}
          </button>
          <button className={compactNeutralActionButtonClass} onClick={onCopy} type="button">
            <Copy className="h-3.5 w-3.5" />
            {t.copySourceSyncDiagnosis}
          </button>
        </div>
      </section>

      <section className={subscriptionDrawerNeutralPanelClass}>
        <p className="text-xs font-black uppercase tracking-widest text-[#07111F] dark:text-white">
          {t.sourceSyncDiagnosisRemote}
        </p>
        <p className="mt-3 break-all border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 font-mono text-[11px] leading-5 text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70">
          {source.url}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <SubscriptionDiagnosticField label={t.sourceSyncDiagnosisState} value={diagnosis.stateLabel} />
          <SubscriptionDiagnosticField label={t.sourceStatus} value={source.status} />
          <SubscriptionDiagnosticField label={t.sourceNodes} value={formatNumber(source.nodeCount, language)} />
          <SubscriptionDiagnosticField label={t.lastSync} value={formatDateTime(source.lastSyncAt, language)} />
          <SubscriptionDiagnosticField
            label={t.sourceSyncDiagnosisBudget}
            value={`${diagnosis.fetchBudgetLabel} / ${diagnosis.byteBudgetLabel}`}
          />
          <SubscriptionDiagnosticField label={t.sourceSyncDiagnosisRemote} value={diagnosis.remoteLabel} />
          <SubscriptionDiagnosticField label={t.sourceSyncDiagnosisRules} value={diagnosis.rulesLabel} />
          <SubscriptionDiagnosticField label={t.providerAccount} value={source.providerAccountId || '-'} />
        </div>
      </section>

      <section className={issues.length > 0 ? subscriptionDrawerSignalPanelClass : subscriptionDrawerMutedPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-widest">{t.sourceSyncDiagnosisWarnings}</p>
          <span className="border border-current/18 bg-white/45 px-2.5 py-1 text-[10px] font-black uppercase dark:bg-white/[0.04]">
            {formatNumber(issues.length, language)}
          </span>
        </div>
        {issues.length > 0 ? (
          <div className="mt-3 space-y-2">
            {issues.map((issue) => (
              <div
                className={`border p-2.5 ${
                  issue.severity === 'failed'
                    ? 'border-[#FF3D18]/35 bg-[#FFF1EC]/76 dark:border-[#FF6A3A]/24 dark:bg-[#FF3D18]/10'
                    : 'border-[#FFB020]/35 bg-[#FFF8DD]/76 dark:border-[#FFD166]/24 dark:bg-[#FFD166]/10'
                }`}
                key={issue.label}
              >
                <p className="text-xs font-black text-[#07111F] dark:text-white">{issue.label}</p>
                <p className="mt-2 text-[11px] font-semibold leading-5 text-[#35405A] dark:text-white/60">
                  <span className="font-black uppercase tracking-widest">{t.sourceSyncDiagnosisNextAction}: </span>
                  {issue.nextAction}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-[#35405A] dark:text-white/60">
            {t.sourceSyncDiagnosisNoWarnings}
          </p>
        )}
      </section>
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
    <Table label={t.tableLabel(t.providersTab)} minWidth="1280px">
      <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
        <tr>
          <th className="w-12 px-3 py-2.5">{t.selectProvider}</th>
          <th className="px-3 py-2.5">{t.providerName}</th>
          <th className="px-3 py-2.5">{t.providerUrl}</th>
          <th className="px-3 py-2.5">{t.filter}</th>
          <th className="px-3 py-2.5">{t.excludeFilter}</th>
          <th className="px-3 py-2.5">{t.regionFilter}</th>
          <th className="px-3 py-2.5">{t.processMode}</th>
          <th className="px-3 py-2.5">{t.overrideRule}</th>
          <th className="px-3 py-2.5">{t.actions}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-white/10">
        {providers.map((provider) => (
          <tr key={provider.id} className="subscription-ops-provider-row transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
            <td className="px-3 py-2.5">
              <input
                aria-label={`${t.selectProvider} ${provider.name}`}
                checked={selectedProviderIds.includes(provider.id)}
                className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                onChange={() => onToggleProviderSelection(provider.id)}
                type="checkbox"
              />
            </td>
            <td className="px-3 py-2.5">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{provider.name}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">{provider.externalSubscriptionId}</p>
            </td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-white/60">{createProxyProviderUrl(provider)}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.filter}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.excludeFilter}</td>
            <td className="px-3 py-2.5"><TagList tags={splitComma(provider.geoIpFilter)} /></td>
            <td className="px-3 py-2.5 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{provider.processMode}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.overrideRule}</td>
            <td className="px-3 py-2.5">
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

function DataSection({ children, hint, title }: { children: ReactNode; hint?: string; title: string }) {
  return (
    <section className="stagger-3 island-card overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>
        {hint ? <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Table({ children, label, minWidth }: { children: ReactNode; label: string; minWidth: string }) {
  return (
    <div
      aria-label={label}
      className="subscription-data-table-region overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40"
      role="region"
      tabIndex={0}
    >
      <table className="subscription-data-table w-full text-left" style={{ minWidth }}>
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
          ? 'border border-[#1E3AFF] bg-[#1E3AFF] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_18px_-14px_rgba(30,58,255,0.8)] transition duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/45 active:translate-y-0 dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]'
          : 'border border-[#07111F]/18 bg-[#FFFDF5]/72 px-4 py-2 text-xs font-bold text-[#35405A] transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-[#1E3AFF]/45 hover:bg-[#DCE1FF]/58 hover:text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 dark:border-[#6B7CFF]/16 dark:bg-white/[0.04] dark:text-white/55 dark:hover:border-[#6B7CFF]/32 dark:hover:bg-[#1E3AFF]/12 dark:hover:text-[#DDE3FF]'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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
      className="border-b border-[#FF3D18]/45 bg-[#FFD8C6]/45 px-3 py-3 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#C92810] dark:text-[#FFB299]">
            {t.bulkImpactPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.customerLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.customerLabels.length > 4 ? (
              <span className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.customerLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="subscription-bulk-impact-metric-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[26rem]">
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
      <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
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
      className="border-b border-[#FF3D18]/45 bg-[#FFD8C6]/45 px-3 py-3 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#C92810] dark:text-[#FFB299]">
            {t.sourceImpactPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.sourceLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.sourceLabels.length > 4 ? (
              <span className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.sourceLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="subscription-source-impact-metric-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[26rem]">
          <BulkImpactMetric label={t.selectedSources} value={formatNumber(selectedCount, language)} />
          <BulkImpactMetric label={t.sourceImpactNodes} value={formatNumber(summary.nodeCount, language)} />
          <BulkImpactMetric label={t.sourceImpactRiskSources} value={formatNumber(summary.riskSourceCount, language)} />
          <BulkImpactMetric label={t.sourceImpactWarnings} value={formatNumber(summary.warningCount, language)} />
          <BulkImpactMetric label={t.sourceImpactFetchBudget} value={fetchBudgetLabel} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
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
      className="subscription-export-generation-preflight border-b border-[#1E3AFF]/35 bg-[#DCE1FF]/45 px-3 py-3 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-[#9EACFF]">
            {t.exportImpactPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.exportLabels.slice(0, 4).map((label) => (
              <span
                className="max-w-full rounded-full border border-[#1E3AFF]/35 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold leading-5 text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.exportLabels.length > 4 ? (
              <span className="rounded-full border border-[#1E3AFF]/35 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.exportLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="subscription-export-impact-metric-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[26rem]">
          <BulkImpactMetric label={t.exportImpactFiles} value={formatNumber(summary.fileCount, language)} />
          <BulkImpactMetric label={t.exportImpactClients} value={formatNumber(summary.clientCount, language)} />
          <BulkImpactMetric label={t.exportImpactFormats} value={formatNumber(summary.formatCount, language)} />
          <BulkImpactMetric label={t.exportImpactProviders} value={formatNumber(summary.providerReferenceCount, language)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
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
      className="subscription-provider-generation-preflight border-b border-[#1E3AFF]/35 bg-[#DCE1FF]/45 px-3 py-3 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-[#9EACFF]">
            {t.providerImpactPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.providerLabels.slice(0, 4).map((label) => (
              <span
                className="max-w-full rounded-full border border-[#1E3AFF]/35 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold leading-5 text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.providerLabels.length > 4 ? (
              <span className="rounded-full border border-[#1E3AFF]/35 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.providerLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="subscription-provider-impact-metric-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[26rem]">
          <BulkImpactMetric label={t.providerImpactProviders} value={formatNumber(summary.providerCount, language)} />
          <BulkImpactMetric label={t.providerImpactRelatedExports} value={formatNumber(summary.fileCount, language)} />
          <BulkImpactMetric label={t.exportImpactClients} value={formatNumber(summary.clientCount, language)} />
          <BulkImpactMetric label={t.exportImpactFormats} value={formatNumber(summary.formatCount, language)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        <BulkImpactPreview title={t.providerImpactProviderPreview} values={summary.providerLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactExportPreview} values={summary.exportLabels.slice(0, 5)} />
        <BulkImpactPreview title={t.exportImpactFormatPreview} values={[summary.formatLabels.join(' / ')]} />
      </div>
    </section>
  );
}

function BulkImpactMetric({ label, tone, value }: { label: string; tone?: 'signal'; value: string }) {
  const metricClass =
    tone === 'signal'
      ? 'border-[#FF3D18]/40 bg-[#FFD8C6]/55 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10'
      : 'border-[#1E3AFF]/30 bg-[#FFFDF5]/85 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]';
  const labelClass =
    tone === 'signal'
      ? 'text-[#C92810] dark:text-[#FFB299]'
      : 'text-[#35405A] dark:text-white/40';

  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2 ${metricClass}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-white">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function BulkImpactPreview({ title, values, warning = false }: { title: string; values: string[]; warning?: boolean }) {
  const previewClass = warning
    ? 'border-[#FF3D18]/35 bg-[#FFD8C6]/35 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10'
    : 'border-[#1E3AFF]/25 bg-[#FFFDF5]/75 dark:border-[#6B7CFF]/20 dark:bg-white/[0.025]';
  const valueClass = warning
    ? 'border-[#FF3D18]/25 bg-[#FFFDF5]/80 text-[#C92810] dark:border-[#FFB299]/15 dark:bg-white/[0.035] dark:text-[#FFB299]'
    : 'border-[#1E3AFF]/18 bg-[#EAF3D1]/60 text-[#35405A] dark:border-[#6B7CFF]/15 dark:bg-white/[0.035] dark:text-white/72';

  return (
    <div className={`subscription-distribution-evidence-card min-w-0 border p-2.5 ${previewClass}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-[#C92810] dark:text-[#FFB299]' : 'mt-2 space-y-1.5'}>
        {values.map((value) => (
          <p
            className={`whitespace-normal break-all rounded-md border px-2.5 py-2 text-xs font-bold leading-5 ${valueClass}`}
            key={value}
            title={value}
          >
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
    <div className="flex flex-col items-center gap-2 border border-[#07111F]/14 bg-[#FDFFF1]/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      {dataUrl ? (
        <img alt={alt} className="h-32 w-32 bg-white p-2 shadow-sm" height={128} src={dataUrl} width={128} />
      ) : (
        <div className="grid h-32 w-32 place-items-center bg-white p-2 text-center text-[10px] font-bold text-[#35405A] shadow-sm">
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
          ? 'rounded-full border border-red-200 p-2 text-red-500 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:border-red-400/30 dark:hover:bg-red-400/10 dark:focus-visible:ring-red-400/40'
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
        <span key={tag} className="rounded-full border border-[#1E3AFF]/24 bg-[#DCE1FF]/62 px-2.5 py-1 text-[10px] font-bold text-[#1E3AFF] dark:border-[#6B7CFF]/28 dark:bg-[#1E3AFF]/16 dark:text-[#DDE3FF]">
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
  return <div className="subscription-empty-state p-3 text-center text-sm font-semibold text-[#35405A] dark:text-white/55">{label}</div>;
}
