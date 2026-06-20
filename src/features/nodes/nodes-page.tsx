import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import QRCode from 'qrcode';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  Download,
  Globe2,
  HardDrive,
  KeyRound,
  MemoryStick,
  Network,
  Pencil,
  PieChart,
  Plus,
  RotateCw,
  RotateCcw,
  Search,
  Send,
  ServerCog,
  Terminal,
  Trash2,
  Upload,
  UserRound
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { ResponsivePage, ResponsiveSection } from '../../components/layout/responsive-page';
import { GlowButton } from '../../components/ui/glow-button';
import {
  AGENT_TRAFFIC_ACCOUNTING_MODES,
  AGENT_INSTALL_PROFILE,
  type Agent,
  type AgentInstallCommand,
  type AgentInstallMetadata,
  type AgentUpgradeCommand,
  type AgentTrafficAccountingMode,
  type ManagedNode,
  type QuotaPolicy,
  type XrayClientResetPolicy,
  type XrayInbound,
  type XrayInboundStatus,
  type XrayProtocol,
  type XrayStreamSettings
} from '../../domain';
import { normalizeXrayClientCredentials } from '../../domain/protocol-credentials';
import { buildXrayShareLink, extractShareHostLabel } from '../../domain/xray-share-link';
import {
  allocateStableHighListenPort,
  XRAY_HIGH_PORT_MAX,
  XRAY_HIGH_PORT_MIN
} from '../../domain/xray-port-allocation';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/copy';
import { formatBytes, formatDateTime, formatNumber, formatPercent } from '../shared/format';
import {
  createCustomerNodeEnabledUpdate,
  createCustomerNodeRenewalUpdate,
  createCustomerNodeTrafficUpdate
} from './customer-node-task-actions';
import { SimpleNodeTableActions } from './simple-node-table-actions';
import { SimpleNodeWizard } from './simple-node-wizard';

type Workspace = 'hosts' | 'customerNodes';
type WorkspaceMode = Workspace | 'all';
type HostStatusFilter = 'all' | Agent['status'];
type HostCapabilityFilter = 'all' | Agent['capabilities'][number];
type HostRuntimeHealthFilter = 'all' | 'issues' | 'sampling-gap' | 'no-telemetry';
type CustomerNodeProtocolFilter = 'all' | XrayProtocol;
type CustomerNodeStatusFilter = 'all' | XrayInboundStatus | 'client-disabled';
type CustomerNodeTrafficMultiplier = 0.5 | 1 | 1.5 | 2;
const hostStatuses: Agent['status'][] = ['online', 'degraded', 'offline', 'provisioning'];
const CUSTOMER_NODE_TRAFFIC_MULTIPLIERS: CustomerNodeTrafficMultiplier[] = [0.5, 1, 1.5, 2];

type NodesPageProps = {
  agents: Agent[];
  focusIntent?: NodesFocusIntent;
  inbounds: XrayInbound[];
  language: AppLanguage;
  nodes?: ManagedNode[];
  quotaPolicies?: QuotaPolicy[];
  returnFocusRef?: RefObject<HTMLElement | null>;
  workspaceMode?: WorkspaceMode;
  taskMutationBusy?: boolean;
  onDeployHostConfig: (agent: Agent) => void;
  onDeleteHost: (metadata: HostConfigMetadata) => Promise<boolean>;
  onDeleteCustomerNode: (metadata: CustomerNodeConfigMetadata) => void;
  onPreviewAgentInstallCommand: (metadata: AgentInstallMetadata) => Promise<AgentInstallCommand>;
  onPreviewAgentUpgradeCommand?: (agent: Agent, reason: string) => Promise<AgentUpgradeCommand>;
  onRemoteAgentUpgrade?: (agent: Agent, reason: string) => void;
  onResetCustomerNodeTraffic?: (policy: QuotaPolicy) => void;
  onSaveHostConfig: (metadata: HostConfigMetadata) => void;
  onSaveCustomerNode: (metadata: CustomerNodeConfigMetadata, action: 'create' | 'update') => void;
};

export type NodesFocusIntent =
  | { id: string; kind: 'host.deploy'; targetId: string }
  | { id: string; kind: 'customer-node.edit'; targetId: string };

export type HostConfigMetadata = {
  agentId: string;
  displayName: string;
  runtimeHostName?: string;
  maxTrafficGb: number;
  monthlyTrafficGb: number;
  trafficAccountingMode: AgentTrafficAccountingMode;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  expiresAt: string;
  pingTarget: string;
  pingIntervalSeconds: number;
};

type HostEdit = {
  name: string;
  runtimeHostName: string;
  maxTrafficGb: number;
  monthlyTrafficGb: number;
  trafficAccountingMode: AgentTrafficAccountingMode;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  expiresAt: string;
  pingTarget: string;
  pingIntervalSeconds: number;
};

export type CustomerNodeConfigMetadata = {
  nodeId: string;
  agentId: string;
  customerNodeName: string;
  customerName: string;
  serverAddress: string;
  xrayProtocol: XrayProtocol;
  listenPort: number;
  clientIdentity: string;
  clientEmail: string;
  clientCredential: string;
  clientLevel: number;
  clientComment: string;
  telegramId: string;
  resetPolicy: XrayClientResetPolicy;
  vmessSecurity: string;
  shadowsocksMethod: string;
  hysteriaAuth: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  fingerprint: string;
  alpn: string[];
  realityPublicKey: string;
  realityPrivateKey: string;
  realityTarget: string;
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: number;
  sniffingEnabled: boolean;
  ipLimit: number;
  trafficMultiplier: CustomerNodeTrafficMultiplier;
  trafficLimitGb: number;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  remainingDays: number;
  subscriptionRule: string;
  subscriptionClientId?: string;
  subId?: string;
  securePathPreview?: string;
  subscriptionUrlPreview?: Partial<Record<'uri' | 'v2ray' | 'clash' | 'mihomo' | 'sing-box' | 'shadowrocket' | 'stash', string>>;
  enabled?: boolean;
};

type CustomerNodeRecord = {
  id: string;
  agentId: string;
  nodeName: string;
  customerName: string;
  serverAddress: string;
  protocol: XrayProtocol;
  listenPort: number;
  clientIdentity: string;
  clientEmail: string;
  clientCredential: string;
  clientLevel: number;
  clientComment: string;
  telegramId: string;
  resetPolicy: XrayClientResetPolicy;
  vmessSecurity: string;
  shadowsocksMethod: string;
  hysteriaAuth: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  fingerprint: string;
  alpn: string[];
  realityPublicKey: string;
  realityPrivateKey: string;
  realityTarget: string;
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: number;
  sniffingEnabled: boolean;
  ipLimit: number;
  trafficMultiplier: CustomerNodeTrafficMultiplier;
  trafficLimitGb: number;
  trafficLimitBytes: number;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  usedTrafficBytes: number;
  remainingDays: number;
  expiresAt: string;
  quotaExceeded: boolean;
  clientExpired: boolean;
  runtimeDisabledByPolicy: boolean;
  guardrailReason: string;
  subscriptionRule: string;
  inboundStatus: XrayInboundStatus;
  enabled: boolean;
};

type CustomerDraft = {
  agentId: string;
  nodeName: string;
  customerName: string;
  protocolTemplate: CustomerProtocolTemplateId;
  serverAddress: string;
  protocol: XrayProtocol;
  listenPort: string;
  clientIdentity: string;
  clientEmail: string;
  clientCredential: string;
  clientLevel: string;
  clientComment: string;
  telegramId: string;
  resetPolicy: XrayClientResetPolicy;
  vmessSecurity: string;
  shadowsocksMethod: string;
  hysteriaAuth: string;
  streamNetwork: XrayStreamSettings['network'];
  security: XrayStreamSettings['security'];
  sni: string;
  path: string;
  flow: string;
  fingerprint: string;
  alpn: string;
  realityPublicKey: string;
  realityPrivateKey: string;
  realityTarget: string;
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: string;
  sniffingEnabled: boolean;
  ipLimit: string;
  trafficMultiplier: string;
  trafficLimitGb: string;
  monthlyResetDay: string;
  currentUsedTrafficGb: string;
  remainingDays: string;
  subscriptionRule: string;
};

type DrawerState =
  | { type: 'closed' }
  | { type: 'install' }
  | { type: 'editHost'; agentId: string }
  | { type: 'deleteHost'; agentId: string }
  | { type: 'customerNode'; nodeId?: string }
  | { type: 'customerLinks'; nodeId: string };

type CustomerProtocolTemplateId =
  | 'vless-reality-vision'
  | 'vless-reality-grpc'
  | 'vless-tls-ws'
  | 'trojan-tls'
  | 'shadowsocks-direct';

const copy = {
  zh: {
    title: '受控主机',
    subtitle: '',
    customerNodesPageTitle: '客户节点',
    customerNodesPageSubtitle: '',
    operationalOverview: '运营总览',
    operationalOverviewHint: '',
    emptyHostTitle: '主机空态',
    emptyHostAction: '先生成安装命令',
    hostsTab: '受控主机',
    customerNodesTab: '客户节点',
    installTitle: '主机代理一键安装',
    workflowTitle: '',
    workflowSteps: [],
    workflowDescriptions: [],
    installDescription: '',
    openInstall: '生成安装命令',
    hostName: '主机名称',
    tokenPolicy: '令牌策略',
    tokenPolicyValue: '短期令牌 / 指纹绑定 / 最小权限',
    capabilitySet: '安装能力',
    capabilitySetValue: '主机代理、协议运行时、转发执行器、遥测上报、命令通道',
    commandPreview: '命令预览',
    commandLoading: '正在生成安装命令...',
    commandUnavailable: '安装命令暂不可用，请检查控制面 API。',
    tokenExpires: '令牌过期',
    submitInstall: '复制安装命令',
    submitting: '复制中',
    hostSummary: '主机总数',
    onlineSummary: '在线主机',
    customerSummary: '客户节点',
    hostTableTitle: '主机探针',
    searchHosts: '搜索主机',
    searchHostsPlaceholder: '主机、地址、区域、能力、服务或异常详情',
    hostStatusFilter: '主机状态',
    hostStatusAll: '全部状态',
    hostCapabilityFilter: '能力',
    hostCapabilityAll: '全部能力',
    hostRuntimeHealthFilter: '运行时健康',
    hostRuntimeHealthAll: '全部健康',
    hostRuntimeHealthIssues: '服务异常',
    hostRuntimeHealthSamplingGap: '采样缺口',
    hostRuntimeHealthNoTelemetry: '无遥测',
    matchingHosts: '当前匹配',
    noMatchingHosts: '没有匹配的受控主机',
    hostAlias: '主机别名',
    runtimeHostName: '运行时主机名',
    endpoint: '接入端点',
    traffic: '流量额度',
    telemetry: '遥测',
    runtime: '运行时',
    actions: '操作',
    deployHostConfig: '应用主机设置',
    editHost: '编辑主机',
    deleteHost: '移除主机',
    deleteHostTitle: '移除受控主机',
    deleteHostDescription: '',
    confirmDelete: '确认删除',
    save: '保存',
    cancel: '取消',
    noAgent: '暂无受控主机',
    noNode: '未绑定运行节点',
    maxTraffic: '最大流量',
    monthlyTraffic: '月度总流量',
    trafficAccountingMode: '流量计算类型',
    monthlyResetDay: '流量重置日期',
    currentUsedTraffic: '当前已用流量',
    trafficSource: '流量统计来源',
    telemetrySourceValue: 'Agent 实时回传（以回传值为准）',
    sampleStatus: '采样',
    sampleHealthy: '正常',
    sampleGap: '缺口',
    sampleGapMissing: '无样本',
    samplingInterval: '采样间隔',
    hardwareProfile: '设备探测',
    monthlyTrafficSection: '月度流量策略',
    probeSection: '节点监测与遥测',
    platformLabel: '平台',
    versionLabel: '版本',
    capabilitiesLabel: '能力',
    cpuModelLabel: 'CPU 型号',
    kernelVersionLabel: '内核版本',
    virtualizationLabel: '虚拟化',
    primaryNicLabel: '主网卡',
    loadAverageLabel: '负载',
    serviceHealthLabel: '服务健康',
    serviceHealthy: '全部正常',
    serviceIssue: '异常',
    serviceMissing: '缺失',
    serviceInactive: '未运行',
    serviceFailed: '失败',
    serviceUnknown: '未知',
    serviceWaiting: '等待遥测',
    agentServiceLabel: 'Agent',
    xrayServiceLabel: 'Xray',
    forwardingServiceLabel: '端口转发',
    waitingTelemetry: '等待 Agent 遥测',
    agentReadinessTitle: 'Agent 纳管就绪度',
    agentReadinessAgentLink: 'Agent 通道',
    agentReadinessTelemetry: '遥测采样',
    agentReadinessRuntimeServices: '运行服务',
    agentReadinessReady: '就绪',
    agentReadinessIssues: '需处理',
    agentReadinessWaiting: '等待接入',
    agentRecoveryTitle: 'Agent 恢复',
    agentRecoveryPollOnlyDescription: '',
    agentRecoverySampleGapDescription: '',
    remoteUpgradeAgent: '远程升级 Agent',
    confirmRemoteUpgradeAgent: (name: string) => `确认远程升级 Agent ${name}？`,
    copyUpgradeCommand: '复制升级命令',
    upgradeCommandCopied: '升级命令已生成并复制',
    upgradeCommandError: '升级命令生成失败',
    hostGuardrailStoppedUnits: 'Guardrail 停用',
    hostGuardrailRestoredUnits: 'Guardrail 恢复',
    lastReport: '最近上报',
    expiresAt: '到期时间',
    pingTarget: '延迟监测目标',
    pingInterval: 'Ping 间隔',
    cpuCores: '核',
    memory: '内存',
    disk: '磁盘',
    monthly: '月度',
    download: '下载',
    upload: '上传',
    latency: '延迟',
    jitter: '抖动',
    packetLoss: '丢包率',
    expiry: '到期',
    online: '在线',
    customerNodesTitle: '客户节点配置',
    customerNodesHint: '',
    searchCustomerNodes: '搜索客户节点',
    searchCustomerNodesPlaceholder: '节点、客户、邮箱、订阅规则、端口、SNI 或路径',
    customerNodeProtocolFilter: '协议',
    customerNodeProtocolAll: '全部协议',
    customerNodeHostFilter: '所属主机',
    customerNodeHostAll: '全部主机',
    customerNodeStatusFilter: '节点状态',
    customerNodeStatusAll: '全部状态',
    customerNodeClientDisabled: '客户端停用',
    customerNodeStatusLabels: {
      enabled: '启用',
      disabled: '停用',
      applying: '应用中',
      error: '异常'
    },
    matchingCustomerNodes: '当前匹配',
    noMatchingCustomerNodes: '没有匹配的客户节点',
    addCustomerNode: '新增客户节点',
    editCustomerNode: '编辑客户节点',
    deleteCustomerNode: '删除客户节点',
    operatorCreateHint: '',
    protocolTemplate: '协议模板',
    protocolTemplateOptions: {
      'vless-reality-vision': 'VLESS Reality 推荐',
      'vless-reality-grpc': 'VLESS Reality gRPC',
      'vless-tls-ws': 'VLESS TLS WebSocket',
      'trojan-tls': 'Trojan TLS',
      'shadowsocks-direct': 'Shadowsocks'
    },
    customerRemark: '备注',
    generatedResult: '生成结果',
    oneNodeLink: '单节点分享链接',
    subscriptionLink: '订阅链接',
    subscriptionQrCode: '订阅二维码',
    customerNodeLinksTitle: '客户节点链接',
    viewCustomerNodeLinks: '查看链接和二维码',
    copyLink: '复制链接',
    copySingleNodeLink: '复制单节点链接',
    copySubscriptionLink: '复制订阅链接',
    selectVisibleCustomerNodes: '选择当前客户节点',
    selectCustomerNode: '选择',
    selectedCustomerNodes: '已选客户节点',
    bulkCopyCustomerNodeLinks: '批量复制链接',
    bulkResetCustomerNodeTraffic: '批量重置流量',
    bulkResetCustomerNodeUsedTraffic: '批量清已用流量',
    bulkEnableCustomerNodes: '批量启用',
    bulkDisableCustomerNodes: '批量停用',
    bulkAddCustomerNodeTrafficAmount: '批量增加流量 GB',
    bulkAddCustomerNodeTraffic: '批量加流量',
    bulkRenewCustomerNodeDays: '批量续期天数',
    bulkRenewCustomerNodes: '批量续期',
    bulkCustomerNodeResetPolicy: '批量重置周期',
    applyCustomerNodeResetPolicy: '应用重置周期',
    bulkDeleteCustomerNodes: '批量删除',
    customerNodeBulkImpactPreflight: '客户节点批量影响预检',
    customerNodeBulkImpactCustomers: '受影响客户',
    customerNodeBulkImpactHosts: '受控主机',
    customerNodeBulkImpactPorts: '入站端口',
    customerNodeBulkImpactUsedTraffic: '已用流量',
    customerNodeBulkImpactGuardrailRisks: '守护风险',
    customerNodeBulkImpactExpiring: '已过期/即将到期',
    customerNodeBulkImpactDisabled: '已停用',
    customerNodeBulkImpactCustomerPreview: '客户预览',
    customerNodeBulkImpactNodePreview: '节点预览',
    customerNodeBulkImpactRiskPreview: '风险提示',
    customerNodeBulkImpactNoRisk: '暂无守护或到期风险',
    confirmBulkDeleteCustomerNodes: (count: string) => `确认删除 ${count} 个节点`,
    confirmDeleteCustomerNode: (name: string) => `确认删除客户节点 ${name}？`,
    confirmBulkResetCustomerNodeTraffic: (count: string) => `确认重置 ${count} 个已选客户节点的流量？`,
    confirmBulkResetCustomerNodeUsedTraffic: (count: string) => `确认清零 ${count} 个已选客户节点的已用流量？`,
    confirmApplyCustomerNodeResetPolicy: (policy: string, count: string) =>
      `确认将 ${count} 个已选客户节点的重置周期改为${policy}？`,
    confirmBulkCustomerNodeEnabled: (action: string, count: string) => `确认${action} ${count} 个已选客户节点？`,
    confirmBulkAddCustomerNodeTraffic: (trafficGb: string, count: string) =>
      `确认给 ${count} 个已选客户节点增加 ${trafficGb} GB 流量？`,
    confirmBulkRenewCustomerNodes: (days: string, count: string) =>
      `确认给 ${count} 个已选客户节点续期 ${days} 天？`,
    confirmResetCustomerNodeTraffic: (name: string) => `确认重置 ${name} 的流量？`,
    addCustomerNodeTraffic: '加流量',
    renewCustomerNode: '续期',
    enableCustomerNode: '启用节点',
    disableCustomerNode: '停用节点',
    cloneCustomerNode: '克隆客户节点',
    resetCustomerNodeTraffic: '重置流量',
    regenerateReality: '重新生成 Reality 密钥',
    generatedProtocolMaterial: '协议参数已自动生成',
    advancedToggle: '高级配置',
    advancedFeatures: '高级功能',
    advancedHint: '',
    generatedCredential: '客户端凭证已自动生成',
    customerNodeName: '客户节点名称',
    customerName: '客户名称',
    serverAddress: '服务器地址',
    protocolConfig: '协议配置',
    customerProfileSection: '客户资料',
    protocolProfileSection: '协议专属配置',
    transportProfileSection: '传输与安全',
    advancedProfileSection: '高级选项',
    protocol: 'Xray 协议',
    listenPort: '入站端口',
    clientIdentity: '客户标识',
    clientEmail: '客户邮箱',
    clientCredential: '协议凭证',
    vmessSecurity: 'VMess 加密',
    shadowsocksMethod: 'Shadowsocks 方法',
    hysteriaAuth: 'Hysteria2 认证',
    clientLevel: '客户等级',
    clientComment: '备注',
    telegramId: 'Telegram ID',
    resetPolicy: '流量重置策略',
    streamNetwork: '传输层',
    security: '安全层',
    sni: '服务器名称',
    path: '路径 / 服务名',
    flow: '流控模式',
    fingerprint: '客户端指纹',
    alpn: 'ALPN',
    realityPublicKey: 'Reality 公钥',
    realityPrivateKey: 'Reality 私钥',
    realityTarget: 'Reality 伪装目标',
    realityShortId: 'Reality 短 ID',
    fallbackName: '回落名称',
    fallbackDestination: '回落目标',
    fallbackXver: '回落版本号',
    sniffingEnabled: '启用流量嗅探',
    ipLimit: 'IP 限制',
    trafficMultiplier: '流量倍率',
    protocolLink: '可用订阅链接',
    configPreview: 'Xray 入站配置',
    remainingTime: '剩余时间',
    subscriptionRule: '订阅规则',
    assignedHost: '所属主机',
    customerBasics: '基础信息',
    clientProfile: '客户身份',
    quotaPolicy: '额度策略',
    transportConfig: '传输配置',
    securityConfig: '安全配置',
    protocolSpecificConfig: '协议专属配置',
    vlessVisionSection: 'VLESS 入站',
    vmessSection: 'VMess 入站',
    trojanSection: 'Trojan 入站',
    shadowsocksSection: 'Shadowsocks 入站',
    hysteriaSection: 'Hysteria2 入站',
    advancedOptions: '高级选项',
    noCustomerNode: '暂无客户节点配置',
    unitGb: 'GB',
    unitDays: '天',
    unknownHost: '未分配主机',
    resetPolicyLabels: {
      never: '不自动重置',
      daily: '每日重置',
      weekly: '每周重置',
      monthly: '每月重置'
    },
    trafficModeLabels: {
      both: '双向（入站 + 出站）',
      single: '单向（单方向计费）',
      ingress: '只计算入站',
      egress: '只计算出站'
    },
    trafficModeCardLabels: {
      both: '双向',
      single: '单向',
      ingress: '仅入',
      egress: '仅出'
    },
    statusLabels: {
      online: '在线',
      degraded: '降级',
      offline: '离线',
      provisioning: '纳管中'
    }
  },
  en: {
    title: 'Managed Hosts',
    subtitle: '',
    customerNodesPageTitle: 'Customer Nodes',
    customerNodesPageSubtitle: '',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: '',
    emptyHostTitle: 'Host Empty State',
    emptyHostAction: 'Generate the install command first',
    hostsTab: 'Managed Hosts',
    customerNodesTab: 'Customer Nodes',
    installTitle: 'Host Agent One-Click Install',
    workflowTitle: '',
    workflowSteps: [],
    workflowDescriptions: [],
    installDescription: '',
    openInstall: 'Generate Install Command',
    hostName: 'Host Name',
    tokenPolicy: 'Token Policy',
    tokenPolicyValue: 'Short-lived token / fingerprint binding / least privilege',
    capabilitySet: 'Capability Set',
    capabilitySetValue: 'Host agent, protocol runtime, forwarding executor, telemetry, command transport',
    commandPreview: 'Command Preview',
    commandLoading: 'Generating install command...',
    commandUnavailable: 'Install command unavailable. Check the control-plane API.',
    tokenExpires: 'Token Expires',
    submitInstall: 'Copy Install Command',
    submitting: 'Copying',
    hostSummary: 'Total Hosts',
    onlineSummary: 'Online Hosts',
    customerSummary: 'Customer Nodes',
    hostTableTitle: 'Host Probes',
    searchHosts: 'Search Hosts',
    searchHostsPlaceholder: 'Host, address, region, capability, service, or issue detail',
    hostStatusFilter: 'Host Status',
    hostStatusAll: 'All Statuses',
    hostCapabilityFilter: 'Capability',
    hostCapabilityAll: 'All Capabilities',
    hostRuntimeHealthFilter: 'Runtime Health',
    hostRuntimeHealthAll: 'All Health',
    hostRuntimeHealthIssues: 'Service Issues',
    hostRuntimeHealthSamplingGap: 'Sampling Gap',
    hostRuntimeHealthNoTelemetry: 'No Telemetry',
    matchingHosts: 'Matching',
    noMatchingHosts: 'No matching managed hosts',
    hostAlias: 'Host Alias',
    runtimeHostName: 'Runtime Hostname',
    endpoint: 'Endpoint',
    traffic: 'Traffic Cap',
    telemetry: 'Telemetry',
    runtime: 'Runtime',
    actions: 'Actions',
    deployHostConfig: 'Apply Host Settings',
    editHost: 'Edit Host',
    deleteHost: 'Remove Host',
    deleteHostTitle: 'Remove Managed Host',
    deleteHostDescription: '',
    confirmDelete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    noAgent: 'No managed hosts yet',
    noNode: 'No runtime node bound',
    maxTraffic: 'Max Traffic',
    monthlyTraffic: 'Monthly Traffic',
    trafficAccountingMode: 'Traffic Accounting',
    monthlyResetDay: 'Reset Day',
    currentUsedTraffic: 'Current Used Traffic',
    trafficSource: 'Traffic Source',
    telemetrySourceValue: 'Agent live telemetry (source of truth)',
    sampleStatus: 'Sampling',
    sampleHealthy: 'Normal',
    sampleGap: 'Gap',
    sampleGapMissing: 'No Sample',
    samplingInterval: 'Sampling Interval',
    hardwareProfile: 'Hardware Detection',
    monthlyTrafficSection: 'Monthly Traffic Policy',
    probeSection: 'Health Checks & Telemetry',
    platformLabel: 'Platform',
    versionLabel: 'Version',
    capabilitiesLabel: 'Capabilities',
    cpuModelLabel: 'CPU Model',
    kernelVersionLabel: 'Kernel Version',
    virtualizationLabel: 'Virtualization',
    primaryNicLabel: 'Primary NIC',
    loadAverageLabel: 'Load',
    serviceHealthLabel: 'Service Health',
    serviceHealthy: 'All Healthy',
    serviceIssue: 'Issues',
    serviceMissing: 'Missing',
    serviceInactive: 'Inactive',
    serviceFailed: 'Failed',
    serviceUnknown: 'Unknown',
    serviceWaiting: 'Waiting',
    agentServiceLabel: 'Agent',
    xrayServiceLabel: 'Xray',
    forwardingServiceLabel: 'Forwarding',
    waitingTelemetry: 'Waiting for Agent telemetry',
    agentReadinessTitle: 'Agent onboarding readiness',
    agentReadinessAgentLink: 'Agent Link',
    agentReadinessTelemetry: 'Telemetry',
    agentReadinessRuntimeServices: 'Runtime Services',
    agentReadinessReady: 'Ready',
    agentReadinessIssues: 'Needs attention',
    agentReadinessWaiting: 'Waiting',
    agentRecoveryTitle: 'Agent Recovery',
    agentRecoveryPollOnlyDescription: '',
    agentRecoverySampleGapDescription: '',
    remoteUpgradeAgent: 'Remote Upgrade Agent',
    confirmRemoteUpgradeAgent: (name: string) => `Remote upgrade Agent ${name}?`,
    copyUpgradeCommand: 'Copy Upgrade Command',
    upgradeCommandCopied: 'Upgrade command generated and copied',
    upgradeCommandError: 'Upgrade command generation failed',
    hostGuardrailStoppedUnits: 'Guardrail Stopped',
    hostGuardrailRestoredUnits: 'Guardrail Restored',
    lastReport: 'Last Report',
    expiresAt: 'Expires At',
    pingTarget: 'Latency Check Target',
    pingInterval: 'Check Interval',
    cpuCores: 'cores',
    memory: 'Memory',
    disk: 'Disk',
    monthly: 'Monthly',
    download: 'Download',
    upload: 'Upload',
    latency: 'Latency',
    jitter: 'Jitter',
    packetLoss: 'Packet Loss',
    expiry: 'Expires',
    online: 'Online',
    customerNodesTitle: 'Customer Node Config',
    customerNodesHint: '',
    searchCustomerNodes: 'Search Customer Nodes',
    searchCustomerNodesPlaceholder: 'Node, customer, email, subscription rule, port, SNI, or path',
    customerNodeProtocolFilter: 'Protocol',
    customerNodeProtocolAll: 'All Protocols',
    customerNodeHostFilter: 'Assigned Host',
    customerNodeHostAll: 'All Hosts',
    customerNodeStatusFilter: 'Node Status',
    customerNodeStatusAll: 'All Statuses',
    customerNodeClientDisabled: 'Client Disabled',
    customerNodeStatusLabels: {
      enabled: 'Enabled',
      disabled: 'Disabled',
      applying: 'Applying',
      error: 'Error'
    },
    matchingCustomerNodes: 'Matching',
    noMatchingCustomerNodes: 'No matching customer nodes',
    addCustomerNode: 'Add Customer Node',
    editCustomerNode: 'Edit Customer Node',
    deleteCustomerNode: 'Delete Customer Node',
    operatorCreateHint: '',
    protocolTemplate: 'Protocol Template',
    protocolTemplateOptions: {
      'vless-reality-vision': 'VLESS Reality Recommended',
      'vless-reality-grpc': 'VLESS Reality gRPC',
      'vless-tls-ws': 'VLESS TLS WebSocket',
      'trojan-tls': 'Trojan TLS',
      'shadowsocks-direct': 'Shadowsocks'
    },
    customerRemark: 'Remark',
    generatedResult: 'Generated Result',
    oneNodeLink: 'Single-node Share Link',
    subscriptionLink: 'Subscription Link',
    subscriptionQrCode: 'Subscription QR Code',
    customerNodeLinksTitle: 'Customer Node Links',
    viewCustomerNodeLinks: 'View Links & QR',
    copyLink: 'Copy Link',
    copySingleNodeLink: 'Copy Single-node Link',
    copySubscriptionLink: 'Copy Subscription Link',
    selectVisibleCustomerNodes: 'Select Visible Customer Nodes',
    selectCustomerNode: 'Select',
    selectedCustomerNodes: 'Selected Customer Nodes',
    bulkCopyCustomerNodeLinks: 'Bulk Copy Links',
    bulkResetCustomerNodeTraffic: 'Bulk Reset Traffic',
    bulkResetCustomerNodeUsedTraffic: 'Bulk Reset Used Traffic',
    bulkEnableCustomerNodes: 'Bulk Enable',
    bulkDisableCustomerNodes: 'Bulk Disable',
    bulkAddCustomerNodeTrafficAmount: 'Bulk Add Traffic GB',
    bulkAddCustomerNodeTraffic: 'Bulk Add Traffic',
    bulkRenewCustomerNodeDays: 'Bulk Renew Days',
    bulkRenewCustomerNodes: 'Bulk Renew',
    bulkCustomerNodeResetPolicy: 'Bulk Reset Policy',
    applyCustomerNodeResetPolicy: 'Apply Reset Policy',
    bulkDeleteCustomerNodes: 'Bulk Delete',
    customerNodeBulkImpactPreflight: 'Customer Node Bulk Impact Preflight',
    customerNodeBulkImpactCustomers: 'Affected Customers',
    customerNodeBulkImpactHosts: 'Managed Hosts',
    customerNodeBulkImpactPorts: 'Inbound Ports',
    customerNodeBulkImpactUsedTraffic: 'Used Traffic',
    customerNodeBulkImpactGuardrailRisks: 'Guardrail Risks',
    customerNodeBulkImpactExpiring: 'Expired/Soon',
    customerNodeBulkImpactDisabled: 'Disabled',
    customerNodeBulkImpactCustomerPreview: 'Customer Preview',
    customerNodeBulkImpactNodePreview: 'Node Preview',
    customerNodeBulkImpactRiskPreview: 'Risk Notes',
    customerNodeBulkImpactNoRisk: 'No guardrail or expiry risks',
    confirmBulkDeleteCustomerNodes: (count: string) => `Confirm Delete ${count} Nodes`,
    confirmDeleteCustomerNode: (name: string) => `Delete customer node ${name}?`,
    confirmBulkResetCustomerNodeTraffic: (count: string) =>
      `Reset traffic for ${count} selected customer node${count === '1' ? '' : 's'}?`,
    confirmBulkResetCustomerNodeUsedTraffic: (count: string) =>
      `Reset used traffic for ${count} selected customer node${count === '1' ? '' : 's'}?`,
    confirmApplyCustomerNodeResetPolicy: (policy: string, count: string) =>
      `Apply ${policy} reset policy to ${count} selected customer node${count === '1' ? '' : 's'}?`,
    confirmBulkCustomerNodeEnabled: (action: string, count: string) =>
      `${action} ${count} selected customer node${count === '1' ? '' : 's'}?`,
    confirmBulkAddCustomerNodeTraffic: (trafficGb: string, count: string) =>
      `Add ${trafficGb} GB to ${count} selected customer node${count === '1' ? '' : 's'}?`,
    confirmBulkRenewCustomerNodes: (days: string, count: string) =>
      `Renew ${count} selected customer node${count === '1' ? '' : 's'} by ${days} days?`,
    confirmResetCustomerNodeTraffic: (name: string) => `Reset traffic for ${name}?`,
    addCustomerNodeTraffic: 'Add Traffic',
    renewCustomerNode: 'Renew',
    enableCustomerNode: 'Enable Node',
    disableCustomerNode: 'Disable Node',
    cloneCustomerNode: 'Clone Customer Node',
    resetCustomerNodeTraffic: 'Reset Traffic',
    regenerateReality: 'Regenerate Reality Keys',
    generatedProtocolMaterial: 'Protocol material is generated automatically',
    advancedToggle: 'Advanced Config',
    advancedFeatures: 'Advanced Features',
    advancedHint: '',
    generatedCredential: 'Client credential generated automatically',
    customerNodeName: 'Customer Node Name',
    customerName: 'Customer Name',
    serverAddress: 'Server Address',
    protocolConfig: 'Protocol Config',
    customerProfileSection: 'Customer Profile',
    protocolProfileSection: 'Protocol Specific',
    transportProfileSection: 'Transport & Security',
    advancedProfileSection: 'Advanced Options',
    protocol: 'Xray Protocol',
    listenPort: 'Inbound Port',
    clientIdentity: 'Client Identity',
    clientEmail: 'Client Email',
    clientCredential: 'Protocol Credential',
    vmessSecurity: 'VMess Security',
    shadowsocksMethod: 'Shadowsocks Method',
    hysteriaAuth: 'Hysteria2 Auth',
    clientLevel: 'Client Level',
    clientComment: 'Comment',
    telegramId: 'Telegram ID',
    resetPolicy: 'Traffic Reset Policy',
    streamNetwork: 'Transport',
    security: 'Security',
    sni: 'SNI / Host',
    path: 'Path / Service',
    flow: 'Flow',
    fingerprint: 'Fingerprint',
    alpn: 'ALPN',
    realityPublicKey: 'Reality Public Key',
    realityPrivateKey: 'Reality Private Key',
    realityTarget: 'Reality Target',
    realityShortId: 'Reality Short ID',
    fallbackName: 'Fallback Name',
    fallbackDestination: 'Fallback Target',
    fallbackXver: 'Fallback Xver',
    sniffingEnabled: 'Enable Sniffing',
    ipLimit: 'IP Limit',
    trafficMultiplier: 'Traffic Multiplier',
    protocolLink: 'Usable Subscription Link',
    configPreview: 'Xray Inbound Config',
    remainingTime: 'Remaining Time',
    subscriptionRule: 'Subscription Rule',
    assignedHost: 'Assigned Host',
    customerBasics: 'Basic Info',
    clientProfile: 'Client Identity',
    quotaPolicy: 'Quota Policy',
    transportConfig: 'Transport Config',
    securityConfig: 'Security Config',
    protocolSpecificConfig: 'Protocol Specific Config',
    vlessVisionSection: 'VLESS Inbound',
    vmessSection: 'VMess Inbound',
    trojanSection: 'Trojan Inbound',
    shadowsocksSection: 'Shadowsocks Inbound',
    hysteriaSection: 'Hysteria2 Inbound',
    advancedOptions: 'Advanced Options',
    noCustomerNode: 'No customer node configs yet',
    unitGb: 'GB',
    unitDays: 'days',
    unknownHost: 'Unassigned Host',
    resetPolicyLabels: {
      never: 'Never',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly'
    },
    trafficModeLabels: {
      both: 'Bi-directional (Ingress + Egress)',
      single: 'One-way (single-direction billing)',
      ingress: 'Ingress Only',
      egress: 'Egress Only'
    },
    trafficModeCardLabels: {
      both: 'Bi',
      single: 'One-way',
      ingress: 'Ingress',
      egress: 'Egress'
    },
    statusLabels: {
      online: 'Online',
      degraded: 'Degraded',
      offline: 'Offline',
      provisioning: 'Provisioning'
    }
  }
} as const;

type NodesCopy = (typeof copy)[AppLanguage];

const defaultInstallMetadata: AgentInstallMetadata = {
  installProfile: [...AGENT_INSTALL_PROFILE]
};

const CUSTOMER_TEMPLATE_OPTIONS: Array<{ value: CustomerProtocolTemplateId }> = [
  { value: 'vless-reality-vision' },
  { value: 'vless-reality-grpc' },
  { value: 'vless-tls-ws' },
  { value: 'trojan-tls' },
  { value: 'shadowsocks-direct' }
];

const DEFAULT_REALITY_SERVER_NAME = 'www.cloudflare.com';

function createCustomerDraft(agent?: Agent): CustomerDraft {
  const defaultIdentity = createClientIdentity('vless');
  const realityKeys = createRealityKeyPair();

  return {
    agentId: agent?.id ?? '',
    nodeName: '',
    customerName: '',
    protocolTemplate: 'vless-reality-vision',
    serverAddress: agent?.publicAddress ?? '',
    protocol: 'vless',
    listenPort: '',
    clientIdentity: defaultIdentity,
    clientEmail: '',
    clientCredential: defaultIdentity,
    clientLevel: '0',
    clientComment: '',
    telegramId: '',
    resetPolicy: 'monthly',
    vmessSecurity: 'auto',
    shadowsocksMethod: '2022-blake3-aes-128-gcm',
    hysteriaAuth: '',
    streamNetwork: 'tcp',
    security: 'reality',
    sni: DEFAULT_REALITY_SERVER_NAME,
    path: '',
    flow: 'xtls-rprx-vision',
    fingerprint: 'chrome',
    alpn: 'h2,http/1.1',
    realityPublicKey: realityKeys.publicKey,
    realityPrivateKey: realityKeys.privateKey,
    realityTarget: `${DEFAULT_REALITY_SERVER_NAME}:443`,
    realityShortId: createRealityShortId(),
    fallbackName: '',
    fallbackDestination: '',
    fallbackXver: '0',
    sniffingEnabled: true,
    ipLimit: '',
    trafficMultiplier: '1',
    trafficLimitGb: '100',
    monthlyResetDay: '1',
    currentUsedTrafficGb: '',
    remainingDays: '30',
    subscriptionRule: ''
  };
}

function parseCustomerNodeTrafficMultiplier(value: unknown): CustomerNodeTrafficMultiplier {
  const numericValue = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '1'));

  return CUSTOMER_NODE_TRAFFIC_MULTIPLIERS.includes(numericValue as CustomerNodeTrafficMultiplier)
    ? (numericValue as CustomerNodeTrafficMultiplier)
    : 1;
}

function normalizeHostSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function createHostSearchText(agent: Agent, labels: NodesCopy) {
  const services = agent.telemetry.runtimeServices ?? [];
  const hardware = agent.hardware ?? {};

  return [
    agent.id,
    agent.name,
    agent.runtimeHostName,
    agent.status,
    labels.statusLabels[agent.status],
    agent.region,
    agent.publicAddress,
    agent.connectionMode,
    agent.version,
    agent.platform,
    agent.lastHeartbeatAt,
    agent.probeConfig.pingTarget,
    agent.trafficPolicy.accountingMode,
    hardware.cpuModel,
    hardware.kernelVersion,
    hardware.virtualization,
    hardware.primaryNetworkInterface,
    ...agent.capabilities,
    ...services.flatMap((service) => [
      service.name,
      service.moduleKind,
      service.status,
      service.detail,
      service.required ? 'required' : 'optional',
      service.enabled ? 'enabled' : 'disabled'
    ]),
    ...(agent.telemetry.hostGuardrailStoppedUnits ?? []),
    ...(agent.telemetry.hostGuardrailRestoredUnits ?? []),
    agent.telemetry.guardrailReason,
    agent.telemetry.sampleGapReason
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function hostMatchesRuntimeHealthFilter(agent: Agent, filter: HostRuntimeHealthFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'issues') {
    return runtimeServiceIssueCount(agent) > 0;
  }

  if (filter === 'sampling-gap') {
    return agent.telemetry.sampleGapDetected === true;
  }

  return !hasTelemetryReport(agent);
}

function filterManagedHosts(
  agents: Agent[],
  query: string,
  statusFilter: HostStatusFilter,
  capabilityFilter: HostCapabilityFilter,
  runtimeHealthFilter: HostRuntimeHealthFilter,
  labels: NodesCopy
) {
  const normalizedQuery = normalizeHostSearch(query);

  return agents.filter((agent) => {
    if (statusFilter !== 'all' && agent.status !== statusFilter) {
      return false;
    }

    if (capabilityFilter !== 'all' && !agent.capabilities.includes(capabilityFilter)) {
      return false;
    }

    if (!hostMatchesRuntimeHealthFilter(agent, runtimeHealthFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createHostSearchText(agent, labels).includes(normalizedQuery);
  });
}

function createCustomerNodeSearchText(node: CustomerNodeRecord, hostName: string) {
  return [
    node.id,
    node.nodeName,
    node.customerName,
    node.agentId,
    hostName,
    node.serverAddress,
    node.protocol,
    String(node.listenPort),
    node.clientIdentity,
    node.clientEmail,
    node.clientComment,
    node.telegramId,
    node.resetPolicy,
    node.streamNetwork,
    node.security,
    node.sni,
    node.path,
    node.flow,
    node.fingerprint,
    ...node.alpn,
    node.realityTarget,
    node.fallbackName,
    node.fallbackDestination,
    node.subscriptionRule,
    node.enabled ? 'enabled' : 'disabled'
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function customerNodeMatchesStatusFilter(node: CustomerNodeRecord, statusFilter: CustomerNodeStatusFilter) {
  if (statusFilter === 'all') {
    return true;
  }

  if (statusFilter === 'client-disabled') {
    return !node.enabled;
  }

  return node.inboundStatus === statusFilter;
}

function filterCustomerNodes(
  nodes: CustomerNodeRecord[],
  query: string,
  protocolFilter: CustomerNodeProtocolFilter,
  hostFilter: string,
  statusFilter: CustomerNodeStatusFilter,
  hostNamesById: Map<string, string>
) {
  const normalizedQuery = normalizeHostSearch(query);

  return nodes.filter((node) => {
    if (protocolFilter !== 'all' && node.protocol !== protocolFilter) {
      return false;
    }

    if (hostFilter !== 'all' && node.agentId !== hostFilter) {
      return false;
    }

    if (!customerNodeMatchesStatusFilter(node, statusFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createCustomerNodeSearchText(node, hostNamesById.get(node.agentId) ?? '').includes(normalizedQuery);
  });
}

function createProtocolDraftPatch(protocol: XrayProtocol, current: CustomerDraft): Partial<CustomerDraft> {
  const nextIdentity = createClientIdentity(protocol);
  const currentEmail = current.clientEmail.trim();
  const currentFingerprint = current.fingerprint.trim();
  const currentRealityKey = current.realityPublicKey.trim();
  const currentRealityPrivateKey = current.realityPrivateKey.trim();
  const currentRealityTarget = current.realityTarget.trim();
  const currentRealityShortId = current.realityShortId.trim();
  const currentFallbackName = current.fallbackName.trim();
  const currentFallbackDestination = current.fallbackDestination.trim();
  const nextSecurity =
    protocol === 'shadowsocks'
      ? 'none'
      : protocol === 'hysteria'
        ? 'tls'
        : protocol === 'trojan'
          ? current.security === 'none'
            ? 'tls'
            : current.security
        : protocol === 'vmess'
          ? current.security === 'reality' || current.security === 'none'
            ? 'tls'
            : current.security
          : protocol === 'vless'
            ? current.security === 'none'
              ? 'reality'
              : current.security
            : current.security;
  const nextSni =
    protocol === 'shadowsocks'
      ? ''
      : current.sni.trim() || extractHostLabel(current.serverAddress) || (nextSecurity === 'reality' ? DEFAULT_REALITY_SERVER_NAME : '');
  const generatedRealityKeys =
    nextSecurity === 'reality' && (!currentRealityKey || !currentRealityPrivateKey) ? createRealityKeyPair() : undefined;

  return {
    protocol,
    listenPort: current.listenPort,
    clientIdentity: nextIdentity,
    clientCredential: nextIdentity,
    clientEmail: currentEmail,
    flow: protocol === 'vless' ? current.flow.trim() : '',
    vmessSecurity: protocol === 'vmess' ? current.vmessSecurity || 'auto' : current.vmessSecurity,
    shadowsocksMethod:
      protocol === 'shadowsocks' ? current.shadowsocksMethod || '2022-blake3-aes-128-gcm' : current.shadowsocksMethod,
    hysteriaAuth: protocol === 'hysteria' ? nextIdentity : current.hysteriaAuth,
    streamNetwork:
      protocol === 'hysteria'
        ? 'udp'
        : protocol === 'shadowsocks' || protocol === 'trojan' || protocol === 'vless'
          ? 'tcp'
          : protocol === 'vmess'
            ? 'ws'
            : current.streamNetwork,
    security: nextSecurity,
    sni: nextSni,
    path:
      protocol === 'vmess'
        ? current.path.trim()
        : protocol === 'vless'
          ? current.path.trim()
          : '',
    fingerprint: nextSecurity === 'none' ? '' : currentFingerprint || 'chrome',
    alpn: protocol === 'hysteria' ? 'h3' : nextSecurity === 'tls' ? current.alpn || 'h2,http/1.1' : current.alpn,
    realityPublicKey: nextSecurity === 'reality' ? currentRealityKey || generatedRealityKeys?.publicKey || '' : '',
    realityPrivateKey: nextSecurity === 'reality' ? currentRealityPrivateKey || generatedRealityKeys?.privateKey || '' : '',
    realityTarget: nextSecurity === 'reality' ? currentRealityTarget || (nextSni ? `${nextSni}:443` : '') : '',
    realityShortId: nextSecurity === 'reality' ? currentRealityShortId || createRealityShortId() : '',
    fallbackName: protocol === 'vless' ? currentFallbackName : '',
    fallbackDestination: protocol === 'vless' ? currentFallbackDestination : '',
    fallbackXver: protocol === 'vless' ? current.fallbackXver || '0' : '0',
    sniffingEnabled: protocol !== 'shadowsocks'
  };
}

function ensureRealityMaterial(current: CustomerDraft): CustomerDraft {
  const hasRealityKeyPair = Boolean(current.realityPublicKey.trim() && current.realityPrivateKey.trim());
  const realityKeys = hasRealityKeyPair ? undefined : createRealityKeyPair();
  const sni = current.sni.trim() || extractHostLabel(current.serverAddress) || DEFAULT_REALITY_SERVER_NAME;

  return {
    ...current,
    security: 'reality',
    sni,
    fingerprint: current.fingerprint.trim() || 'chrome',
    realityPublicKey: current.realityPublicKey.trim() || realityKeys?.publicKey || '',
    realityPrivateKey: current.realityPrivateKey.trim() || realityKeys?.privateKey || '',
    realityTarget: current.realityTarget.trim() || `${sni}:443`,
    realityShortId: current.realityShortId.trim() || createRealityShortId()
  };
}

function createCustomerTemplatePatch(
  templateId: CustomerProtocolTemplateId,
  current: CustomerDraft
): Partial<CustomerDraft> {
  const realityKeys = createRealityKeyPair();
  const currentServerAddress = current.serverAddress.trim();
  const host = extractHostLabel(currentServerAddress);
  const tlsServerName = host || DEFAULT_REALITY_SERVER_NAME;
  const nextProtocol =
    templateId === 'trojan-tls'
      ? 'trojan'
      : templateId === 'shadowsocks-direct'
        ? 'shadowsocks'
        : 'vless';
  const nextIdentity = createClientIdentity(nextProtocol);
  const common = {
    ...createProtocolDraftPatch(nextProtocol, current),
    protocolTemplate: templateId,
    clientIdentity: nextIdentity,
    clientCredential: nextIdentity,
    hysteriaAuth: current.hysteriaAuth,
    serverAddress: currentServerAddress
  };

  if (templateId === 'vless-reality-grpc') {
    return {
      ...common,
      protocol: 'vless',
      streamNetwork: 'grpc',
      security: 'reality',
      sni: DEFAULT_REALITY_SERVER_NAME,
      path: 'ou-ui-next',
      flow: '',
      fingerprint: 'chrome',
      alpn: 'h2,http/1.1',
      realityPublicKey: realityKeys.publicKey,
      realityPrivateKey: realityKeys.privateKey,
      realityTarget: `${DEFAULT_REALITY_SERVER_NAME}:443`,
      realityShortId: createRealityShortId(),
      sniffingEnabled: true
    };
  }

  if (templateId === 'vless-tls-ws') {
    return {
      ...common,
      protocol: 'vless',
      streamNetwork: 'ws',
      security: 'tls',
      sni: tlsServerName,
      path: '/ou-ui-next',
      flow: '',
      fingerprint: 'chrome',
      alpn: 'h2,http/1.1',
      realityPublicKey: '',
      realityPrivateKey: '',
      realityTarget: '',
      realityShortId: '',
      sniffingEnabled: true
    };
  }

  if (templateId === 'trojan-tls') {
    return {
      ...common,
      protocol: 'trojan',
      streamNetwork: 'tcp',
      security: 'tls',
      sni: tlsServerName,
      path: '',
      flow: '',
      fingerprint: 'chrome',
      alpn: 'h2,http/1.1',
      realityPublicKey: '',
      realityPrivateKey: '',
      realityTarget: '',
      realityShortId: '',
      sniffingEnabled: true
    };
  }

  if (templateId === 'shadowsocks-direct') {
    return {
      ...common,
      protocol: 'shadowsocks',
      streamNetwork: 'tcp',
      security: 'none',
      sni: '',
      path: '',
      flow: '',
      fingerprint: '',
      alpn: '',
      realityPublicKey: '',
      realityPrivateKey: '',
      realityTarget: '',
      realityShortId: '',
      sniffingEnabled: false
    };
  }

  return {
    ...common,
    protocol: 'vless',
    streamNetwork: 'tcp',
    security: 'reality',
    sni: DEFAULT_REALITY_SERVER_NAME,
    path: '',
    flow: 'xtls-rprx-vision',
    fingerprint: 'chrome',
    alpn: 'h2,http/1.1',
    realityPublicKey: realityKeys.publicKey,
    realityPrivateKey: realityKeys.privateKey,
    realityTarget: `${DEFAULT_REALITY_SERVER_NAME}:443`,
    realityShortId: createRealityShortId(),
    sniffingEnabled: true
  };
}

function resolveCustomerTemplateFromNode(node: CustomerNodeRecord): CustomerProtocolTemplateId {
  if (node.protocol === 'shadowsocks') {
    return 'shadowsocks-direct';
  }

  if (node.protocol === 'trojan') {
    return 'trojan-tls';
  }

  if (node.security === 'tls' && node.streamNetwork === 'ws') {
    return 'vless-tls-ws';
  }

  if (node.security === 'reality' && node.streamNetwork === 'grpc') {
    return 'vless-reality-grpc';
  }

  return 'vless-reality-vision';
}

function refreshRealityMaterial(current: CustomerDraft): CustomerDraft {
  const realityKeys = createRealityKeyPair();
  const sni = current.sni.trim() || DEFAULT_REALITY_SERVER_NAME;

  return {
    ...current,
    security: current.protocol === 'shadowsocks' ? 'none' : 'reality',
    sni,
    fingerprint: current.fingerprint.trim() || 'chrome',
    realityPublicKey: realityKeys.publicKey,
    realityPrivateKey: realityKeys.privateKey,
    realityTarget: `${sni}:443`,
    realityShortId: createRealityShortId()
  };
}

function getSecurityOptions(protocol: XrayProtocol, language: AppLanguage) {
  const labels =
    language === 'zh'
      ? {
          none: '无',
          tls: 'TLS',
          reality: 'Reality'
        }
      : {
          none: 'None',
          tls: 'TLS',
          reality: 'Reality'
        };

  if (protocol === 'shadowsocks') {
    return [{ label: labels.none, value: 'none' }];
  }

  if (protocol === 'hysteria') {
    return [{ label: labels.tls, value: 'tls' }];
  }

  if (protocol === 'vmess') {
    return [
      { label: labels.none, value: 'none' },
      { label: labels.tls, value: 'tls' }
    ];
  }

  if (protocol === 'trojan') {
    return [
      { label: labels.tls, value: 'tls' },
      { label: labels.reality, value: 'reality' }
    ];
  }

  return [
    { label: labels.none, value: 'none' },
    { label: labels.tls, value: 'tls' },
    { label: labels.reality, value: 'reality' }
  ];
}

function getVmessSecurityOptions(language: AppLanguage) {
  return language === 'zh'
    ? [
        { label: '自动', value: 'auto' },
        { label: 'AES-128-GCM', value: 'aes-128-gcm' },
        { label: 'AES-128-CTR', value: 'aes-128-ctr' },
        { label: 'ChaCha20-Poly1305', value: 'chacha20-poly1305' }
      ]
    : [
        { label: 'Auto', value: 'auto' },
        { label: 'AES-128-GCM', value: 'aes-128-gcm' },
        { label: 'AES-128-CTR', value: 'aes-128-ctr' },
        { label: 'ChaCha20-Poly1305', value: 'chacha20-poly1305' }
      ];
}

function createClientIdentity(protocol: XrayProtocol) {
  if (protocol === 'trojan') {
    return createRandomSecret('trojan-');
  }

  if (protocol === 'shadowsocks') {
    return createRandomSecret('ss-');
  }

  if (protocol === 'hysteria') {
    return createRandomSecret('hysteria-');
  }

  return createRandomUuid();
}

function createRandomSecret(prefix: string) {
  const seed = Array.from(readSecureRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${prefix}${seed.slice(0, 24)}`;
}

function createRandomUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = readSecureRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const seed = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-${seed.slice(12, 16)}-${seed.slice(16, 20)}-${seed.slice(20, 32)}`;
}

function readSecureRandomBytes(length: number) {
  const random = globalThis.crypto?.getRandomValues;

  if (!random) {
    throw new Error('A secure random number generator is required to create customer-node credentials.');
  }

  const bytes = new Uint8Array(length);
  random.call(globalThis.crypto, bytes);
  return bytes;
}

function encodeRawUrlBase64(bytes: Uint8Array) {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToLittleEndianBigInt(bytes: Uint8Array) {
  return bytes.reduceRight((value, byte) => (value << 8n) + BigInt(byte), 0n);
}

function littleEndianBigIntToBytes(value: bigint) {
  const bytes = new Uint8Array(32);
  let remaining = value;

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

function mod(value: bigint, modulo: bigint) {
  const result = value % modulo;
  return result >= 0n ? result : result + modulo;
}

function modPow(base: bigint, exponent: bigint, modulo: bigint) {
  let result = 1n;
  let currentBase = mod(base, modulo);
  let currentExponent = exponent;

  while (currentExponent > 0n) {
    if ((currentExponent & 1n) === 1n) {
      result = mod(result * currentBase, modulo);
    }

    currentBase = mod(currentBase * currentBase, modulo);
    currentExponent >>= 1n;
  }

  return result;
}

function clampX25519PrivateKey(bytes: Uint8Array) {
  const clamped = new Uint8Array(bytes);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  return clamped;
}

function x25519ScalarMult(privateKey: Uint8Array, publicU: Uint8Array) {
  const prime = (1n << 255n) - 19n;
  const scalar = bytesToLittleEndianBigInt(clampX25519PrivateKey(privateKey));
  const uBytes = new Uint8Array(publicU);
  uBytes[31] &= 127;
  const x1 = bytesToLittleEndianBigInt(uBytes);
  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;

  for (let bit = 254; bit >= 0; bit -= 1) {
    const currentBit = (scalar >> BigInt(bit)) & 1n;
    swap ^= currentBit;

    if (swap === 1n) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }

    swap = currentBit;

    const a = mod(x2 + z2, prime);
    const aa = mod(a * a, prime);
    const b = mod(x2 - z2, prime);
    const bb = mod(b * b, prime);
    const e = mod(aa - bb, prime);
    const c = mod(x3 + z3, prime);
    const d = mod(x3 - z3, prime);
    const da = mod(d * a, prime);
    const cb = mod(c * b, prime);

    x3 = mod((da + cb) * (da + cb), prime);
    z3 = mod(x1 * mod((da - cb) * (da - cb), prime), prime);
    x2 = mod(aa * bb, prime);
    z2 = mod(e * mod(aa + 121665n * e, prime), prime);
  }

  if (swap === 1n) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  return littleEndianBigIntToBytes(mod(x2 * modPow(z2, prime - 2n, prime), prime));
}

function createRealityKeyPair() {
  const privateKeyBytes = clampX25519PrivateKey(readSecureRandomBytes(32));
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;
  const publicKeyBytes = x25519ScalarMult(privateKeyBytes, basePoint);

  return {
    privateKey: encodeRawUrlBase64(privateKeyBytes),
    publicKey: encodeRawUrlBase64(publicKeyBytes)
  };
}

function createRealityShortId() {
  return createRandomSecret('').slice(0, 8);
}

const CUSTOMER_PROTOCOL_OPTIONS: Array<{ label: string; value: XrayProtocol }> = [
  { label: 'VLESS', value: 'vless' },
  { label: 'VMess', value: 'vmess' },
  { label: 'Trojan', value: 'trojan' },
  { label: 'Shadowsocks', value: 'shadowsocks' }
];

const RESET_POLICY_OPTIONS: XrayClientResetPolicy[] = ['never', 'daily', 'weekly', 'monthly'];

function createProtocolClient(protocol: XrayProtocol, identity: string) {
  if (protocol === 'trojan' || protocol === 'shadowsocks') {
    return { password: identity };
  }

  if (protocol === 'hysteria') {
    return { auth: identity };
  }

  return { id: identity };
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const extractHostLabel = extractShareHostLabel;

function createGrpcServiceName(path: string) {
  return path.replace(/^\/+/, '') || 'ou-ui-next';
}

function createCustomerDraftFallbackSeed(draft: CustomerDraft, options?: { nodeId?: string; agentId?: string }) {
  const nodeId = options?.nodeId?.trim() || `inbound-${(draft.nodeName.trim() || draft.customerName.trim() || 'customer-node')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
  const agentId = options?.agentId?.trim() || draft.agentId.trim() || 'agent';
  const customerName = draft.customerName.trim() || draft.clientEmail.trim() || draft.clientIdentity.trim() || 'customer';

  return `${nodeId}:${agentId}:${customerName}`;
}

function resolveCustomerNodeListenPort(
  draft: CustomerDraft,
  options?: {
    listenPort?: number;
    reusablePort?: number;
    usedPorts?: Iterable<number>;
    nodeId?: string;
    agentId?: string;
  }
) {
  if (typeof options?.listenPort === 'number' && Number.isFinite(options.listenPort) && options.listenPort > 0) {
    return options.listenPort;
  }

  const listenPort = Number.parseInt(draft.listenPort, 10);

  if (Number.isFinite(listenPort) && listenPort > 0) {
    return listenPort;
  }

  if (typeof options?.reusablePort === 'number' && isHighListenPort(options.reusablePort)) {
    return options.reusablePort;
  }

  const listenPortSeed = options?.agentId?.trim() || draft.agentId.trim() || 'agent';

  return allocateStableHighListenPort(listenPortSeed, options?.usedPorts);
}

function isHighListenPort(port: number) {
  return Number.isFinite(port) && port >= XRAY_HIGH_PORT_MIN && port <= XRAY_HIGH_PORT_MAX;
}

function findReusableCustomerNodePort(
  draft: CustomerDraft,
  nodes: CustomerNodeRecord[],
  options?: { nodeId?: string }
) {
  if (draft.listenPort.trim() !== '') {
    return undefined;
  }

  return nodes.find(
    (node) =>
      node.id !== options?.nodeId
      && node.agentId === draft.agentId
      && node.protocol === draft.protocol
      && isHighListenPort(node.listenPort)
      && node.enabled
      && node.inboundStatus !== 'disabled'
  );
}

function applyReusableCustomerNodePortProfile(draft: CustomerDraft, reusableNode: CustomerNodeRecord | undefined) {
  if (!reusableNode || draft.listenPort.trim() !== '') {
    return draft;
  }

  return {
    ...draft,
    streamNetwork: reusableNode.streamNetwork,
    security: reusableNode.security,
    sni: reusableNode.sni,
    path: reusableNode.path,
    fingerprint: reusableNode.fingerprint,
    alpn: reusableNode.alpn.join(','),
    realityPublicKey: reusableNode.realityPublicKey,
    realityPrivateKey: reusableNode.realityPrivateKey,
    realityTarget: reusableNode.realityTarget,
    realityShortId: reusableNode.realityShortId,
    fallbackName: reusableNode.fallbackName,
    fallbackDestination: reusableNode.fallbackDestination,
    fallbackXver: String(reusableNode.fallbackXver),
    sniffingEnabled: reusableNode.sniffingEnabled
  };
}

function buildShareLink(draft: CustomerDraft, port: number, options?: { nodeId?: string; agentId?: string }) {
  return buildXrayShareLink({
    protocol: draft.protocol as Parameters<typeof buildXrayShareLink>[0]['protocol'],
    clientIdentity: draft.clientIdentity,
    clientCredential: draft.clientCredential,
    hysteriaAuth: draft.hysteriaAuth,
    fallbackSeed: createCustomerDraftFallbackSeed(draft, options),
    serverAddress: draft.serverAddress,
    listenPort: port,
    security: draft.security,
    network: draft.streamNetwork,
    sni: draft.sni.trim() || extractHostLabel(draft.serverAddress),
    path: draft.path,
    flow: draft.flow,
    fingerprint: draft.fingerprint,
    realityPublicKey: draft.realityPublicKey,
    realityShortId: draft.realityShortId,
    vmessSecurity: draft.vmessSecurity,
    shadowsocksMethod: draft.shadowsocksMethod,
    label: draft.nodeName.trim() || draft.customerName.trim() || draft.clientIdentity.trim()
  });
}

function createStreamSettings(draft: CustomerDraft) {
  const sni = draft.sni.trim() || extractHostLabel(draft.serverAddress);
  const path = draft.path.trim();
  const streamSettings: Record<string, unknown> = {
    network: draft.streamNetwork,
    security: draft.security
  };

  if (draft.streamNetwork === 'ws' || draft.streamNetwork === 'httpupgrade' || draft.streamNetwork === 'splithttp') {
    streamSettings[draft.streamNetwork + 'Settings'] = {
      path: path || '/',
      headers: sni ? { Host: sni } : undefined
    };
  }

  if (draft.streamNetwork === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: createGrpcServiceName(path)
    };
  }

  if (draft.security === 'tls') {
    streamSettings.tlsSettings = {
      serverName: sni || undefined,
      alpn: splitCsv(draft.alpn)
    };
  }

  if (draft.security === 'reality') {
    streamSettings.realitySettings = {
      target: draft.realityTarget.trim() || (sni ? `${sni}:443` : undefined),
      serverNames: sni ? [sni] : [],
      privateKey: draft.realityPrivateKey.trim() || undefined,
      shortIds: draft.realityShortId.trim() ? [draft.realityShortId.trim()] : []
    };
  }

  return streamSettings;
}

function buildXrayArtifacts(
  draft: CustomerDraft,
  options?: {
    listenPort?: number;
    usedPorts?: Iterable<number>;
    nodeId?: string;
    agentId?: string;
  }
) {
  const remainingDays = Math.max(Number.parseInt(draft.remainingDays, 10) || 0, 0);
  const trafficLimitGb = Math.max(Number.parseInt(draft.trafficLimitGb, 10) || 0, 0);
  const expiresAt = Date.now() + remainingDays * 24 * 60 * 60 * 1000;
  const normalizedCredentials = normalizeXrayClientCredentials({
    protocol: draft.protocol,
    clientIdentity: draft.clientIdentity,
    clientCredential: draft.clientCredential,
    hysteriaAuth: draft.hysteriaAuth,
    fallbackSeed: createCustomerDraftFallbackSeed(draft, options)
  });
  const identity =
    draft.protocol === 'vless' || draft.protocol === 'vmess'
      ? normalizedCredentials.clientId
      : draft.protocol === 'hysteria'
        ? normalizedCredentials.auth
        : normalizedCredentials.password;
  const flow = draft.flow.trim();
  const port = resolveCustomerNodeListenPort(draft, options);
  const client = {
    email: draft.clientEmail.trim() || draft.customerName.trim() || draft.clientIdentity.trim(),
    enable: true,
    ...createProtocolClient(draft.protocol, identity),
    ...(flow ? { flow } : {}),
    limitIp: Math.max(Number.parseInt(draft.ipLimit, 10) || 0, 0),
    level: Math.max(Number.parseInt(draft.clientLevel, 10) || 0, 0),
    comment: draft.clientComment.trim() || undefined,
    tgId: draft.telegramId.trim() || undefined,
    reset: draft.resetPolicy,
    totalGB: trafficLimitGb * 1024 * 1024 * 1024,
    expiryTime: expiresAt,
    subId: draft.subscriptionRule.trim() || draft.clientIdentity.trim()
  };
  const protocolSettings =
    draft.protocol === 'shadowsocks'
      ? {
          method: draft.shadowsocksMethod.trim() || '2022-blake3-aes-128-gcm',
          password: identity,
          network: 'tcp,udp'
        }
      : draft.protocol === 'http' || draft.protocol === 'mixed'
        ? {
            accounts: [
              {
                user: draft.clientEmail.trim() || draft.customerName.trim() || draft.clientIdentity.trim(),
                pass: identity
              }
            ]
          }
        : draft.protocol === 'vless'
          ? {
              clients: [client],
              decryption: 'none',
              fallbacks: draft.fallbackDestination.trim()
                ? [
                    {
                      name: draft.fallbackName.trim() || undefined,
                      dest: draft.fallbackDestination.trim(),
                      xver: Math.max(Number.parseInt(draft.fallbackXver, 10) || 0, 0)
                    }
                  ]
                : []
            }
          : {
              clients: [client]
            };

  return {
    inboundConfig: JSON.stringify(
      {
        listenPort: port,
        protocol: draft.protocol,
        client,
        streamSettings: createStreamSettings(draft),
        settings: protocolSettings,
        sniffing: {
          enabled: draft.sniffingEnabled,
          destOverride: ['http', 'tls', 'quic']
        }
      },
      null,
      2
    ),
    shareLink: buildShareLink(draft, port, options)
  };
}

function mapInboundToCustomerNode(
  inbound: XrayInbound,
  nodeAgentIds: Map<string, string>,
  nodeServerAddresses: Map<string, string>,
  agentServerAddresses: Map<string, string>
): CustomerNodeRecord {
  const primaryClient = inbound.clients[0];
  const remainingDays = inbound.remainingDays
    ?? Math.max(Math.ceil((Date.parse(primaryClient?.expiresAt ?? new Date().toISOString()) - Date.now()) / (24 * 60 * 60 * 1000)), 0);
  const agentId = inbound.agentId ?? nodeAgentIds.get(inbound.nodeId) ?? inbound.nodeId;
  const serverAddress = (inbound.serverAddress ?? nodeServerAddresses.get(inbound.nodeId) ?? agentServerAddresses.get(agentId)) ?? '';
  const usedTrafficBytes = Math.max(primaryClient?.manualUsedTrafficBytes ?? primaryClient?.usedTrafficBytes ?? 0, 0);
  const trafficLimitBytes = Math.max(primaryClient?.trafficLimitBytes ?? 0, 0);
  const expiresAt = primaryClient?.expiresAt ?? '';

  return {
    id: inbound.id,
    agentId,
    nodeName: inbound.label,
    customerName: inbound.customerName ?? primaryClient?.email ?? 'Customer',
    serverAddress,
    protocol: inbound.protocol,
    listenPort: inbound.listenPort,
    clientIdentity: inbound.clientIdentity ?? primaryClient?.id ?? '',
    clientEmail: primaryClient?.email ?? '',
    clientCredential: primaryClient?.password ?? primaryClient?.auth ?? inbound.clientIdentity ?? primaryClient?.id ?? '',
    clientLevel: primaryClient?.level ?? 0,
    clientComment: primaryClient?.comment ?? '',
    telegramId: primaryClient?.tgId ?? '',
    resetPolicy: primaryClient?.resetPolicy ?? 'never',
    vmessSecurity: primaryClient?.security ?? 'auto',
    shadowsocksMethod: primaryClient?.method ?? '2022-blake3-aes-128-gcm',
    hysteriaAuth: primaryClient?.auth ?? '',
    streamNetwork: inbound.streamSettings.network,
    security: inbound.streamSettings.security,
    sni: inbound.streamSettings.sni ?? '',
    path: inbound.streamSettings.path ?? inbound.streamSettings.serviceName ?? inbound.path ?? '',
    flow: primaryClient?.flow ?? inbound.flow ?? '',
    fingerprint: inbound.streamSettings.fingerprint ?? inbound.reality.fingerprint ?? 'chrome',
    alpn: inbound.tls.alpn,
    realityPublicKey: inbound.reality.publicKey ?? '',
    realityPrivateKey: inbound.reality.privateKey ?? '',
    realityTarget: inbound.reality.target ?? '',
    realityShortId: inbound.reality.shortIds[0] ?? '',
    fallbackName: inbound.fallbacks[0]?.name ?? '',
    fallbackDestination: inbound.fallbacks[0]?.destination ?? '',
    fallbackXver: inbound.fallbacks[0]?.xver ?? 0,
    sniffingEnabled: inbound.sniffingEnabled,
    ipLimit: primaryClient?.ipLimit ?? 0,
    trafficMultiplier: parseCustomerNodeTrafficMultiplier(primaryClient?.trafficMultiplier),
    trafficLimitGb: Math.round(trafficLimitBytes / 1024 / 1024 / 1024),
    trafficLimitBytes,
    monthlyResetDay: primaryClient?.monthlyResetDay ?? 1,
    currentUsedTrafficGb: gbWithSingleDecimalFromBytes(usedTrafficBytes, 0),
    usedTrafficBytes,
    remainingDays,
    expiresAt,
    quotaExceeded: primaryClient?.quotaExceeded ?? (trafficLimitBytes > 0 && usedTrafficBytes >= trafficLimitBytes),
    clientExpired: primaryClient?.clientExpired ?? remainingDays <= 0,
    runtimeDisabledByPolicy: primaryClient?.runtimeDisabledByPolicy ?? false,
    guardrailReason: primaryClient?.guardrailReason ?? '',
    subscriptionRule: inbound.subscriptionRule ?? 'manual',
    inboundStatus: inbound.status,
    enabled: primaryClient?.enabled ?? inbound.status !== 'disabled'
  };
}

type CustomerNodeBulkImpactSummary = {
  customerLabels: string[];
  hostLabels: string[];
  portLabels: string[];
  nodeLabels: string[];
  usedTrafficBytes: number;
  guardrailRisks: string[];
  expiringNodeCount: number;
  disabledNodeCount: number;
};

function createCustomerNodeBulkImpactSummary(
  nodes: CustomerNodeRecord[],
  hostNamesById: Map<string, string>,
  labels: NodesCopy
): CustomerNodeBulkImpactSummary {
  const nowMs = Date.now();
  const soonMs = nowMs + 7 * DAY_MS;
  const customerLabels = new Set<string>();
  const hostLabels = new Set<string>();
  const portLabels = new Set<string>();
  const nodeLabels: string[] = [];
  const guardrailRisks: string[] = [];
  let usedTrafficBytes = 0;
  let expiringNodeCount = 0;
  let disabledNodeCount = 0;

  nodes.forEach((node) => {
    customerLabels.add(node.customerName || node.nodeName);
    hostLabels.add(hostNamesById.get(node.agentId) ?? labels.unknownHost);
    portLabels.add(`${node.protocol}:${node.listenPort}`);
    nodeLabels.push(node.nodeName);
    usedTrafficBytes += Math.max(node.usedTrafficBytes, 0);

    if (!node.enabled || node.inboundStatus === 'disabled') {
      disabledNodeCount += 1;
    }

    const expiresAtMs = Date.parse(node.expiresAt);
    const expiresSoon = Number.isFinite(expiresAtMs) && expiresAtMs <= soonMs;
    if (node.clientExpired || node.remainingDays <= 7 || expiresSoon) {
      expiringNodeCount += 1;
    }

    if (node.quotaExceeded || node.runtimeDisabledByPolicy) {
      const reason = node.guardrailReason || (node.quotaExceeded ? 'quota_exceeded' : 'runtime_disabled_by_policy');
      guardrailRisks.push(`${node.nodeName}: ${reason}`);
    }
  });

  return {
    customerLabels: Array.from(customerLabels),
    hostLabels: Array.from(hostLabels),
    portLabels: Array.from(portLabels),
    nodeLabels,
    usedTrafficBytes,
    guardrailRisks,
    expiringNodeCount,
    disabledNodeCount
  };
}

function createCustomerDraftFromNode(node: CustomerNodeRecord): CustomerDraft {
  return {
    agentId: node.agentId,
    nodeName: node.nodeName,
    customerName: node.customerName,
    protocolTemplate: resolveCustomerTemplateFromNode(node),
    serverAddress: node.serverAddress,
    protocol: node.protocol,
    listenPort: String(node.listenPort),
    clientIdentity: node.clientIdentity,
    clientEmail: node.clientEmail,
    clientCredential: node.clientCredential,
    clientLevel: String(node.clientLevel),
    clientComment: node.clientComment,
    telegramId: node.telegramId,
    resetPolicy: node.resetPolicy,
    vmessSecurity: node.vmessSecurity,
    shadowsocksMethod: node.shadowsocksMethod,
    hysteriaAuth: node.hysteriaAuth,
    streamNetwork: node.streamNetwork,
    security: node.security,
    sni: node.sni,
    path: node.path,
    flow: node.flow,
    fingerprint: node.fingerprint,
    alpn: node.alpn.join(','),
    realityPublicKey: node.realityPublicKey,
    realityPrivateKey: node.realityPrivateKey,
    realityTarget: node.realityTarget,
    realityShortId: node.realityShortId,
    fallbackName: node.fallbackName,
    fallbackDestination: node.fallbackDestination,
    fallbackXver: String(node.fallbackXver),
    sniffingEnabled: node.sniffingEnabled,
    ipLimit: String(node.ipLimit),
    trafficMultiplier: String(node.trafficMultiplier),
    trafficLimitGb: String(node.trafficLimitGb),
    monthlyResetDay: String(node.monthlyResetDay),
    currentUsedTrafficGb: String(node.currentUsedTrafficGb),
    remainingDays: String(node.remainingDays),
    subscriptionRule: node.subscriptionRule
  };
}

function createClonedCustomerDraftFromNode(node: CustomerNodeRecord): CustomerDraft {
  const draft = createCustomerDraftFromNode(node);

  return {
    ...draft,
    nodeName: `${draft.nodeName.trim() || node.nodeName} Copy`,
    listenPort: '',
    subscriptionRule: draft.subscriptionRule.trim() ? `${draft.subscriptionRule.trim()}-copy` : ''
  };
}

function createCustomerNodeLinkMaterial(node: CustomerNodeRecord, fallbackCustomerName: string) {
  const draft = createCustomerDraftFromNode(node);

  return {
    draft,
    shareLink: buildXrayArtifacts(draft, { nodeId: node.id, agentId: node.agentId }).shareLink,
    subscriptionLink: createCustomerSubscriptionMaterial(draft, fallbackCustomerName).subscriptionUrlPreview.clash
  };
}

function createCustomerNodeMetadataFromRecord(node: CustomerNodeRecord): CustomerNodeConfigMetadata {
  return {
    nodeId: node.id,
    agentId: node.agentId,
    customerNodeName: node.nodeName,
    customerName: node.customerName,
    serverAddress: node.serverAddress,
    xrayProtocol: node.protocol,
    listenPort: node.listenPort,
    clientIdentity: node.clientIdentity,
    clientEmail: node.clientEmail,
    clientCredential: node.clientCredential,
    clientLevel: node.clientLevel,
    clientComment: node.clientComment,
    telegramId: node.telegramId,
    resetPolicy: node.resetPolicy,
    vmessSecurity: node.vmessSecurity,
    shadowsocksMethod: node.shadowsocksMethod,
    hysteriaAuth: node.hysteriaAuth,
    streamNetwork: node.streamNetwork,
    security: node.security,
    sni: node.sni,
    path: node.path,
    flow: node.flow,
    fingerprint: node.fingerprint,
    alpn: node.alpn,
    realityPublicKey: node.realityPublicKey,
    realityPrivateKey: node.realityPrivateKey,
    realityTarget: node.realityTarget,
    realityShortId: node.realityShortId,
    fallbackName: node.fallbackName,
    fallbackDestination: node.fallbackDestination,
    fallbackXver: node.fallbackXver,
    sniffingEnabled: node.sniffingEnabled,
    ipLimit: node.ipLimit,
    trafficMultiplier: node.trafficMultiplier,
    trafficLimitGb: node.trafficLimitGb,
    monthlyResetDay: node.monthlyResetDay,
    currentUsedTrafficGb: node.currentUsedTrafficGb,
    remainingDays: node.remainingDays,
    subscriptionRule: node.subscriptionRule,
    enabled: node.enabled
  };
}

function findCustomerNodeQuotaPolicy(node: CustomerNodeRecord, quotaPolicies: QuotaPolicy[]) {
  const nodeId = node.id;
  const clientId = node.clientIdentity;
  const clientEmail = node.clientEmail;
  const candidates = new Set([
    `customer-node:${nodeId}:${clientId}`,
    `customer-node:${nodeId}:${clientEmail}`,
    `${nodeId}:${clientId}`,
    `${nodeId}:${clientEmail}`,
    nodeId
  ].filter(Boolean));

  return quotaPolicies.find((policy) => {
    if (policy.scope !== 'customer-node') {
      return false;
    }

    if (candidates.has(policy.id) || (policy.resourceId ? candidates.has(policy.resourceId) : false)) {
      return true;
    }

    return policy.id.includes(nodeId) && (policy.id.includes(clientId) || Boolean(clientEmail && policy.id.includes(clientEmail)));
  });
}

const BYTES_PER_GB = 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

function bytesFromGb(gb: number) {
  return Math.max(Number.isFinite(gb) ? gb : 0, 0) * BYTES_PER_GB;
}

function gbFromBytes(bytes: number | undefined, fallback = 0) {
  if (!Number.isFinite(bytes)) {
    return fallback;
  }

  return Math.max(Math.round((bytes ?? 0) / BYTES_PER_GB), 0);
}

function gbWithSingleDecimalFromBytes(bytes: number | undefined, fallback = 0) {
  if (!Number.isFinite(bytes)) {
    return fallback;
  }

  return Math.max(Math.round((((bytes ?? 0) / BYTES_PER_GB) + Number.EPSILON) * 10) / 10, 0);
}

function clampResetDay(value: number) {
  return Math.min(Math.max(Math.round(value), 1), 31);
}

function parseNonNegativeNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function formatResetDay(day: number, language: AppLanguage) {
  return language === 'zh' ? `每月 ${day} 号` : `Day ${day}`;
}

function formatResetDayCompact(day: number, language: AppLanguage) {
  return language === 'zh' ? `${day}号` : `D${day}`;
}

function getTrafficModeOptions(t: NodesCopy) {
  return AGENT_TRAFFIC_ACCOUNTING_MODES.map((mode) => ({
    label: t.trafficModeLabels[mode],
    value: mode
  }));
}

function getMonthlyMeteredUsageBytes(agent: Agent, accountingMode: AgentTrafficAccountingMode) {
  const monthlyIngressBytes = agent.telemetry.monthlyIngressBytes;
  const monthlyEgressBytes = agent.telemetry.monthlyEgressBytes;

  if (!Number.isFinite(monthlyIngressBytes) && !Number.isFinite(monthlyEgressBytes)) {
    return 0;
  }

  const ingressBytes = Number.isFinite(monthlyIngressBytes) ? monthlyIngressBytes ?? 0 : 0;
  const egressBytes = Number.isFinite(monthlyEgressBytes) ? monthlyEgressBytes ?? 0 : 0;

  switch (accountingMode) {
    case 'single':
      return Math.max(ingressBytes, egressBytes);
    case 'ingress':
      return ingressBytes;
    case 'egress':
      return egressBytes;
    case 'both':
    default:
      return ingressBytes + egressBytes;
  }
}

function getMonthlyUsedBytes(agent: Agent, hostEdit: HostEdit) {
  const manualUsedBytes = bytesFromGb(hostEdit.currentUsedTrafficGb);
  const meteredUsedBytes = getMonthlyMeteredUsageBytes(agent, hostEdit.trafficAccountingMode);
  const reportedTotalBytes = Number.isFinite(agent.telemetry.monthlyTrafficUsedBytes)
    ? agent.telemetry.monthlyTrafficUsedBytes
    : 0;

  return Math.max(reportedTotalBytes, manualUsedBytes + meteredUsedBytes);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function createFallbackExpiry(days = 90) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function normalizeExpiry(value: string | undefined, fallback = createFallbackExpiry()) {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function toDateInputValue(value: string | undefined) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateInputToIso(value: string) {
  return value ? new Date(`${value}T23:59:59.000Z`).toISOString() : createFallbackExpiry();
}

function remainingDaysUntil(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const remaining = Date.parse(value) - Date.now();
  return Math.max(Math.ceil(remaining / DAY_MS), 0);
}

function remainingDaysToDateInputValue(value: string) {
  const days = Math.max(Number.parseInt(value, 10) || 0, 0);
  const date = new Date(Date.now() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function dateInputToRemainingDays(value: string) {
  if (!value) {
    return '';
  }

  return String(remainingDaysUntil(dateInputToIso(value)));
}

function createCustomerSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function createStableSecret(value: string, length: number) {
  let output = '';
  let index = 0;

  while (output.length < length) {
    output += createStableHash(`${value}:${index}`);
    index += 1;
  }

  return output.slice(0, length);
}

function createBrowserPublicBaseUrl() {
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;
  const basePath = import.meta.env.BASE_URL ?? '/';
  return new URL(basePath, origin).toString().replace(/\/+$/, '');
}

function createDefaultCustomerNodeName(draft: CustomerDraft) {
  const template = draft.protocolTemplate.replace(/-/g, ' ');
  return [draft.customerName.trim(), template].filter(Boolean).join(' / ') || 'Customer Node';
}

function createDefaultSubscriptionRule(draft: CustomerDraft) {
  const customerSlug = createCustomerSlug(draft.customerName, 'customer');
  const credentialSlug = createCustomerSlug(draft.clientIdentity, 'client').slice(0, 24);
  return `sub:${customerSlug}:${credentialSlug}`;
}

function createCustomerSubscriptionMaterial(draft: CustomerDraft, customerFallback: string) {
  const customerName = draft.customerName.trim() || customerFallback;
  const clientIdentity = draft.clientIdentity.trim() || draft.clientCredential.trim() || 'client';
  const subId = draft.subscriptionRule.trim()
    || createDefaultSubscriptionRule({
      ...draft,
      customerName,
      clientIdentity
    });
  const subscriptionClientId = `sub-client-${createCustomerSlug(`${customerName}-${subId}`, 'customer-node')}`.slice(0, 160);
  const securePathPreview = `/${createStableSecret(`${subscriptionClientId}:${subId}:secure-path`, 24)}`;
  const publicBaseUrl = createBrowserPublicBaseUrl();
  const createUrl = (format: 'uri' | 'v2ray' | 'clash' | 'mihomo' | 'sing-box' | 'shadowrocket' | 'stash') =>
    `${publicBaseUrl}/sub${securePathPreview}/${format}/${encodeURIComponent(subId)}`;

  return {
    subscriptionClientId,
    subId,
    securePathPreview,
    subscriptionUrlPreview: {
      uri: createUrl('uri'),
      v2ray: createUrl('v2ray'),
      clash: createUrl('clash'),
      mihomo: createUrl('mihomo'),
      'sing-box': createUrl('sing-box'),
      shadowrocket: createUrl('shadowrocket'),
      stash: createUrl('stash')
    }
  };
}

function resolveHostEdit(agent: Agent, edit?: HostEdit): HostEdit {
  const maxTrafficGb = gbFromBytes(agent.maxTrafficBytes);
  const monthlyTrafficGb = gbFromBytes(agent.monthlyTrafficLimitBytes, maxTrafficGb);
  const trafficPolicy = agent.trafficPolicy ?? {
    accountingMode: 'both' as const,
    monthlyResetDay: 1,
    manualUsedTrafficBytes: 0,
    telemetrySource: 'agent' as const
  };

  return {
    name: agent.name,
    runtimeHostName: agent.runtimeHostName ?? agent.id,
    maxTrafficGb,
    monthlyTrafficGb,
    trafficAccountingMode: trafficPolicy.accountingMode,
    monthlyResetDay: clampResetDay(trafficPolicy.monthlyResetDay),
    currentUsedTrafficGb: gbWithSingleDecimalFromBytes(trafficPolicy.manualUsedTrafficBytes, 0),
    expiresAt: normalizeExpiry(agent.expiresAt),
    pingTarget: agent.probeConfig?.pingTarget ?? agent.publicAddress,
    pingIntervalSeconds: agent.probeConfig?.pingIntervalSeconds ?? 30,
    ...edit
  };
}

function latencyToneClass(
  latencyMs: number,
  probeConfig?: Agent['probeConfig'],
  latencyStatus?: Agent['telemetry']['latencyStatus']
) {
  if (latencyStatus === 'green') {
    return 'bg-[#00A878] shadow-[0_0_4px_rgba(0,168,120,0.45)]';
  }

  if (latencyStatus === 'yellow') {
    return 'bg-[#D9FF00] shadow-[0_0_4px_rgba(217,255,0,0.45)]';
  }

  if (latencyStatus === 'red') {
    return 'bg-[#DC2626] shadow-[0_0_4px_rgba(220,38,38,0.42)]';
  }

  const greenMax = probeConfig?.latencyGreenMaxMs ?? 100;
  const yellowMax = Math.max(probeConfig?.latencyYellowMaxMs ?? 200, greenMax);

  if (!Number.isFinite(latencyMs) || latencyMs < 1) {
    return 'bg-[#07111F]/24 shadow-none dark:bg-white/20';
  }

  if (latencyMs <= greenMax) {
    return 'bg-[#00A878] shadow-[0_0_4px_rgba(0,168,120,0.45)]';
  }

  if (latencyMs <= yellowMax) {
    return 'bg-[#D9FF00] shadow-[0_0_4px_rgba(217,255,0,0.45)]';
  }

  return 'bg-[#DC2626] shadow-[0_0_4px_rgba(220,38,38,0.42)]';
}

function lossToneClass(packetLossPercent: number) {
  if (packetLossPercent <= 1) {
    return 'bg-[#00A878] shadow-[0_0_4px_rgba(0,168,120,0.45)]';
  }

  if (packetLossPercent <= 5) {
    return 'bg-[#D9FF00] shadow-[0_0_4px_rgba(217,255,0,0.45)]';
  }

  return 'bg-[#DC2626] shadow-[0_0_4px_rgba(220,38,38,0.42)]';
}

function formatRate(value: number | undefined) {
  const rate = Number.isFinite(value) ? value ?? 0 : 0;

  if (rate >= 1000 * 1000) {
    return `${(rate / 1000 / 1000).toFixed(2)} Mbps`;
  }

  if (rate >= 1000) {
    return `${(rate / 1000).toFixed(2)} Kbps`;
  }

  return `${Math.round(rate)} bps`;
}

function formatCompactSeconds(value: number | undefined, language: AppLanguage) {
  const seconds = Math.max(Math.round(Number.isFinite(value) ? value ?? 0 : 0), 0);

  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return language === 'zh' ? `${hours.toFixed(hours >= 10 ? 0 : 1)}小时` : `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }

  if (seconds >= 60) {
    const minutes = seconds / 60;
    return language === 'zh' ? `${minutes.toFixed(minutes >= 10 ? 0 : 1)}分钟` : `${minutes.toFixed(minutes >= 10 ? 0 : 1)}min`;
  }

  return language === 'zh' ? `${seconds}秒` : `${seconds}s`;
}

function formatSamplingStatus(agent: Agent, language: AppLanguage, t: NodesCopy) {
  if (!agent.telemetry.sampleGapDetected) {
    return t.sampleHealthy;
  }

  const label = agent.telemetry.sampleGapReason === 'no_telemetry_sample' ? t.sampleGapMissing : t.sampleGap;
  return `${label} ${formatCompactSeconds(agent.telemetry.sampleGapSeconds, language)}`;
}

function hasTelemetryReport(agent: Agent) {
  return Boolean(agent.telemetry.reportedAt);
}

function getAgentRecoveryReason(agent: Agent) {
  return !hasTelemetryReport(agent) ? 'no_telemetry_sample' : agent.telemetry.sampleGapReason ?? 'telemetry_sampling_gap';
}

function runtimeServiceIssueCount(agent: Agent) {
  return (agent.telemetry.runtimeServices ?? []).filter(
    (service) => service.required && service.status !== 'active'
  ).length;
}

function formatRuntimeServiceStatusLabel(status: NonNullable<Agent['telemetry']['runtimeServices']>[number]['status'], t: NodesCopy) {
  if (status === 'missing') return t.serviceMissing;
  if (status === 'inactive') return t.serviceInactive;
  if (status === 'failed') return t.serviceFailed;
  if (status === 'unknown') return t.serviceUnknown;
  return t.sampleHealthy;
}

type RuntimeServiceBadgeKind = 'agent' | 'xray' | 'port-forwarding';

function findRuntimeService(agent: Agent, kind: RuntimeServiceBadgeKind) {
  const services = agent.telemetry.runtimeServices ?? [];

  return services.find((service) => service.moduleKind === kind);
}

function runtimeServiceBadgeTone(status: NonNullable<Agent['telemetry']['runtimeServices']>[number]['status'] | 'waiting') {
  if (status === 'active') {
    return 'border-[#00A878]/45 bg-[#00A878]/10 text-[#007D5E] dark:border-[#35E68E]/30 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]';
  }

  if (status === 'waiting' || status === 'unknown') {
    return 'border-[#07111F]/18 bg-[#EAF3D1]/60 text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.04] dark:text-white/55';
  }

  if (status === 'inactive' || status === 'missing') {
    return 'border-[#D9FF00] bg-[#D9FF00]/[0.18] text-[#07111F] dark:border-[#E9FF6A]/25 dark:bg-[#E9FF6A]/10 dark:text-[#F4FFC5]';
  }

  return 'border-[#DC2626]/35 bg-[#DC2626]/10 text-[#B91C1C] dark:border-[#FF8A8A]/25 dark:bg-[#FF8A8A]/10 dark:text-[#FFB4B4]';
}

function formatTelemetryTimestamp(agent: Agent, language: AppLanguage) {
  return agent.telemetry.reportedAt ? formatDateTime(agent.telemetry.reportedAt, language) : '-';
}

function formatRuntimeServiceHealth(agent: Agent, t: NodesCopy) {
  const services = agent.telemetry.runtimeServices ?? [];
  const issueCount = runtimeServiceIssueCount(agent);

  if (services.length === 0) {
    return '-';
  }

  if (issueCount === 0) {
    return `${t.serviceHealthy} / ${services.length}`;
  }

  return `${issueCount} ${t.serviceIssue} / ${services.length}`;
}

function formatRuntimeServiceDetails(agent: Agent, t: NodesCopy) {
  const services = agent.telemetry.runtimeServices ?? [];

  if (services.length === 0) {
    return '-';
  }

  return services
    .map((service) => `${service.name}: ${formatRuntimeServiceStatusLabel(service.status, t)}`)
    .join(' · ');
}

function readHostGuardrailUnits(agent: Agent) {
  return {
    stopped: agent.telemetry.hostGuardrailStoppedUnits ?? [],
    restored: agent.telemetry.hostGuardrailRestoredUnits ?? []
  };
}

function hasHostGuardrailEvidence(agent: Agent) {
  const units = readHostGuardrailUnits(agent);
  return units.stopped.length > 0 || units.restored.length > 0;
}

function formatHostGuardrailUnits(units: string[]) {
  return units.length > 0 ? units.join(' · ') : '-';
}

function formatLoadAverage(agent: Agent) {
  const values = [agent.telemetry.loadAverage1m, agent.telemetry.loadAverage5m, agent.telemetry.loadAverage15m];

  if (values.every((value) => !Number.isFinite(value))) {
    return '-';
  }

  return values.map((value) => (Number.isFinite(value) ? (value ?? 0).toFixed(2) : '-')).join(' / ');
}

function formatTelemetryPercentValue(agent: Agent, value: number | undefined) {
  return hasTelemetryReport(agent) ? formatPercent(value ?? 0) : '-';
}

function formatTelemetryBytesPair(agent: Agent, usedBytes: number | undefined, totalBytes: number | undefined) {
  return hasTelemetryReport(agent) ? `${formatBytes(usedBytes ?? 0)} / ${formatBytes(totalBytes ?? 0)}` : '-';
}

export function NodesPage({
  agents,
  focusIntent,
  inbounds,
  language,
  nodes = [],
  quotaPolicies = [],
  returnFocusRef,
  workspaceMode = 'all',
  taskMutationBusy = false,
  onDeployHostConfig,
  onDeleteHost,
  onDeleteCustomerNode,
  onPreviewAgentInstallCommand,
  onPreviewAgentUpgradeCommand,
  onRemoteAgentUpgrade,
  onResetCustomerNodeTraffic,
  onSaveHostConfig,
  onSaveCustomerNode
}: NodesPageProps) {
  const t = copy[language];
  const lockedWorkspace = workspaceMode === 'hosts' || workspaceMode === 'customerNodes' ? workspaceMode : undefined;
  const [unlockedWorkspace, setUnlockedWorkspace] = useState<Workspace>(lockedWorkspace ?? 'hosts');
  const activeWorkspace = lockedWorkspace ?? unlockedWorkspace;
  const showWorkspaceSwitcher = workspaceMode === 'all';
  const pageTitle = activeWorkspace === 'customerNodes' && !showWorkspaceSwitcher ? t.customerNodesPageTitle : t.title;
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [metadata] = useState<AgentInstallMetadata>(defaultInstallMetadata);
  const [installCommand, setInstallCommand] = useState<AgentInstallCommand>();
  const [upgradeCommands, setUpgradeCommands] = useState<Record<string, AgentUpgradeCommand>>({});
  const [upgradeBusyAgentIds, setUpgradeBusyAgentIds] = useState<string[]>([]);
  const [upgradeErrorAgentIds, setUpgradeErrorAgentIds] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState(false);
  const consumedFocusIntentIdRef = useRef<string | undefined>(undefined);
  const [hostEdits, setHostEdits] = useState<Record<string, HostEdit>>({});
  const [hostSearch, setHostSearch] = useState('');
  const [hostStatusFilter, setHostStatusFilter] = useState<HostStatusFilter>('all');
  const [hostCapabilityFilter, setHostCapabilityFilter] = useState<HostCapabilityFilter>('all');
  const [hostRuntimeHealthFilter, setHostRuntimeHealthFilter] = useState<HostRuntimeHealthFilter>('all');
  const [selectedHostPreviewId, setSelectedHostPreviewId] = useState<string | undefined>();
  const [hostAdvancedDetailsOpen, setHostAdvancedDetailsOpen] = useState(false);
  const [customerNodeSearch, setCustomerNodeSearch] = useState('');
  const [customerNodeProtocolFilter, setCustomerNodeProtocolFilter] = useState<CustomerNodeProtocolFilter>('all');
  const [customerNodeHostFilter, setCustomerNodeHostFilter] = useState('all');
  const [customerNodeStatusFilter, setCustomerNodeStatusFilter] = useState<CustomerNodeStatusFilter>('all');
  const [selectedCustomerNodeIds, setSelectedCustomerNodeIds] = useState<string[]>([]);
  const [bulkCustomerNodeTrafficGb, setBulkCustomerNodeTrafficGb] = useState('100');
  const [bulkCustomerNodeRenewDays, setBulkCustomerNodeRenewDays] = useState('30');
  const [bulkCustomerNodeResetPolicy, setBulkCustomerNodeResetPolicy] = useState<XrayClientResetPolicy>('monthly');
  const [bulkCustomerNodeDeleteConfirming, setBulkCustomerNodeDeleteConfirming] = useState(false);
  const [removedAgentIds, setRemovedAgentIds] = useState<string[]>([]);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(() => createCustomerDraft(agents[0]));
  const [customerQrDataUrl, setCustomerQrDataUrl] = useState('');
  const [customerLinkQrDataUrl, setCustomerLinkQrDataUrl] = useState('');
  const [customerAdvancedOpen, setCustomerAdvancedOpen] = useState(false);

  const visibleAgents = useMemo(
    () => agents.filter((agent) => !removedAgentIds.includes(agent.id)),
    [agents, removedAgentIds]
  );
  const hostCapabilityOptions = useMemo(
    () => [...new Set(visibleAgents.flatMap((agent) => agent.capabilities))].sort(),
    [visibleAgents]
  );
  const filteredHostAgents = useMemo(
    () =>
      filterManagedHosts(
        visibleAgents,
        hostSearch,
        hostStatusFilter,
        hostCapabilityFilter,
        hostRuntimeHealthFilter,
        t
      ),
    [hostCapabilityFilter, hostRuntimeHealthFilter, hostSearch, hostStatusFilter, t, visibleAgents]
  );
  const selectedHostPreview = filteredHostAgents.find((agent) => agent.id === selectedHostPreviewId) ?? filteredHostAgents[0];
  const selectedHostPreviewEdit = selectedHostPreview ? getHostEdit(selectedHostPreview) : undefined;
  const selectedHostPreviewHasTelemetry = selectedHostPreview ? hasTelemetryReport(selectedHostPreview) : false;
  const nodeAgentIds = useMemo(() => new Map(nodes.map((node) => [node.id, node.agentId])), [nodes]);
  const nodeServerAddresses = useMemo(
    () => new Map(nodes.map((node) => [node.id, extractHostLabel(node.entrypoint)])),
    [nodes]
  );
  const agentServerAddresses = useMemo(
    () => new Map(visibleAgents.map((agent) => [agent.id, agent.publicAddress])),
    [visibleAgents]
  );
  const customerNodes = useMemo(
    () => inbounds.map((inbound) => mapInboundToCustomerNode(inbound, nodeAgentIds, nodeServerAddresses, agentServerAddresses)),
    [agentServerAddresses, inbounds, nodeAgentIds, nodeServerAddresses]
  );
  const onlineHostCount = visibleAgents.filter((agent) => agent.status === 'online').length;
  const hostNamesById = useMemo(
    () => new Map(visibleAgents.map((agent) => [agent.id, resolveHostEdit(agent, hostEdits[agent.id]).name])),
    [hostEdits, visibleAgents]
  );
  const visibleCustomerNodes = useMemo(
    () => customerNodes.filter((node) => visibleAgents.some((agent) => agent.id === node.agentId)),
    [customerNodes, visibleAgents]
  );
  const customerNodeProtocolOptions = useMemo(
    () => [...new Set(visibleCustomerNodes.map((node) => node.protocol))].sort(),
    [visibleCustomerNodes]
  );
  const filteredCustomerNodes = useMemo(
    () =>
      filterCustomerNodes(
        visibleCustomerNodes,
        customerNodeSearch,
        customerNodeProtocolFilter,
        customerNodeHostFilter,
        customerNodeStatusFilter,
        hostNamesById
      ),
    [
      customerNodeHostFilter,
      customerNodeProtocolFilter,
      customerNodeSearch,
      customerNodeStatusFilter,
      hostNamesById,
      visibleCustomerNodes
    ]
  );
  const selectedCustomerNodes = useMemo(
    () => visibleCustomerNodes.filter((node) => selectedCustomerNodeIds.includes(node.id)),
    [selectedCustomerNodeIds, visibleCustomerNodes]
  );
  const customerNodeBulkImpactSummary = useMemo(
    () => createCustomerNodeBulkImpactSummary(selectedCustomerNodes, hostNamesById, t),
    [hostNamesById, selectedCustomerNodes, t]
  );
  const selectedVisibleCustomerNodeCount = useMemo(
    () => filteredCustomerNodes.filter((node) => selectedCustomerNodeIds.includes(node.id)).length,
    [filteredCustomerNodes, selectedCustomerNodeIds]
  );
  const selectedHost = drawer.type === 'editHost' || drawer.type === 'deleteHost'
    ? visibleAgents.find((agent) => agent.id === drawer.agentId)
    : undefined;
  const selectedHostHasTelemetry = selectedHost ? hasTelemetryReport(selectedHost) : false;
  const editingCustomerNode =
    drawer.type === 'customerNode' && drawer.nodeId
      ? customerNodes.find((node) => node.id === drawer.nodeId)
      : undefined;
  const linkDetailsCustomerNode =
    drawer.type === 'customerLinks'
      ? customerNodes.find((node) => node.id === drawer.nodeId)
      : undefined;
  const reusableCustomerNodePort = useMemo(
    () => findReusableCustomerNodePort(customerDraft, visibleCustomerNodes, { nodeId: editingCustomerNode?.id }),
    [customerDraft, editingCustomerNode?.id, visibleCustomerNodes]
  );
  const effectiveCustomerDraft = useMemo(
    () => applyReusableCustomerNodePortProfile(customerDraft, reusableCustomerNodePort),
    [customerDraft, reusableCustomerNodePort]
  );
  const customerListenPort = useMemo(
    () =>
      resolveCustomerNodeListenPort(effectiveCustomerDraft, {
        agentId: effectiveCustomerDraft.agentId,
        nodeId: editingCustomerNode?.id,
        reusablePort: reusableCustomerNodePort?.listenPort,
        usedPorts: visibleCustomerNodes
          .filter((node) => node.agentId === effectiveCustomerDraft.agentId && node.id !== editingCustomerNode?.id)
          .map((node) => node.listenPort)
      }),
    [effectiveCustomerDraft, editingCustomerNode?.id, reusableCustomerNodePort?.listenPort, visibleCustomerNodes]
  );
  const customerArtifacts = useMemo(
    () =>
      buildXrayArtifacts(effectiveCustomerDraft, {
        agentId: effectiveCustomerDraft.agentId,
        listenPort: customerListenPort,
        nodeId: editingCustomerNode?.id
      }),
    [effectiveCustomerDraft, customerListenPort, editingCustomerNode?.id]
  );
  const customerSubscriptionMaterial = createCustomerSubscriptionMaterial(effectiveCustomerDraft, t.customerName);
  const singleNodeShareLink = customerArtifacts.shareLink;
  const subscriptionLink = customerSubscriptionMaterial.subscriptionUrlPreview.clash;
  const customerNodeLinkMaterial = linkDetailsCustomerNode
    ? createCustomerNodeLinkMaterial(linkDetailsCustomerNode, t.customerName)
    : undefined;
  const protocolSectionTitle =
    customerDraft.protocol === 'vless'
      ? t.vlessVisionSection
      : customerDraft.protocol === 'vmess'
        ? t.vmessSection
        : customerDraft.protocol === 'trojan'
          ? t.trojanSection
          : customerDraft.protocol === 'shadowsocks'
            ? t.shadowsocksSection
            : t.hysteriaSection;
  const showTransportPath = ['ws', 'grpc', 'httpupgrade', 'splithttp'].includes(customerDraft.streamNetwork);
  const showSni = customerDraft.security !== 'none' || showTransportPath;
  const showTlsSettings = customerDraft.security === 'tls' && customerDraft.protocol !== 'hysteria';
  const showRealitySettings = customerDraft.security === 'reality';
  const credentialLabel =
    customerDraft.protocol === 'vless' || customerDraft.protocol === 'vmess'
      ? t.clientIdentity
      : customerDraft.protocol === 'hysteria'
        ? t.hysteriaAuth
        : t.clientCredential;

  useEffect(() => {
    let stale = false;

    if (!subscriptionLink) {
      setCustomerQrDataUrl('');
      return undefined;
    }

    QRCode.toDataURL(subscriptionLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 176
    })
      .then((dataUrl) => {
        if (!stale) {
          setCustomerQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!stale) {
          setCustomerQrDataUrl('');
        }
      });

    return () => {
      stale = true;
    };
  }, [subscriptionLink]);

  useEffect(() => {
    let stale = false;
    const link = customerNodeLinkMaterial?.subscriptionLink;

    if (!link) {
      setCustomerLinkQrDataUrl('');
      return undefined;
    }

    QRCode.toDataURL(link, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 176
    })
      .then((dataUrl) => {
        if (!stale) {
          setCustomerLinkQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!stale) {
          setCustomerLinkQrDataUrl('');
        }
      });

    return () => {
      stale = true;
    };
  }, [customerNodeLinkMaterial?.subscriptionLink]);

  useEffect(() => {
    if (drawer.type !== 'install') {
      return undefined;
    }

    let stale = false;
    setPreviewError(false);
    setInstallCommand(undefined);

    onPreviewAgentInstallCommand(metadata)
      .then((command) => {
        if (!stale) {
          setInstallCommand(command);
        }
      })
      .catch(() => {
        if (!stale) {
          setPreviewError(true);
          setInstallCommand(undefined);
        }
      });

    return () => {
      stale = true;
    };
  }, [drawer.type, metadata, onPreviewAgentInstallCommand]);

  useEffect(() => {
    if (visibleAgents.length === 0) {
      return;
    }

    setCustomerDraft((current) =>
      visibleAgents.some((agent) => agent.id === current.agentId)
        ? current
        : {
            ...current,
            agentId: visibleAgents[0].id,
            serverAddress: visibleAgents[0].publicAddress || current.serverAddress
          }
    );
  }, [visibleAgents]);

  function getHostEdit(agent: Agent) {
    return resolveHostEdit(agent, hostEdits[agent.id]);
  }

  function updateHost(agent: Agent, patch: Partial<HostEdit>) {
    setHostEdits((current) => ({
      ...current,
      [agent.id]: {
        ...getHostEdit(agent),
        ...patch
      }
    }));
  }

  function updateCustomerCredential(value: string) {
    setCustomerDraft((current) => ({
      ...current,
      clientCredential: value,
      clientIdentity: value,
      hysteriaAuth: current.protocol === 'hysteria' ? value : current.hysteriaAuth
    }));
  }

  function applyCustomerTemplate(value: string) {
    setCustomerDraft((current) => ({
      ...current,
      ...createCustomerTemplatePatch(value as CustomerProtocolTemplateId, current)
    }));
  }

  function updateCustomerSecurity(value: string) {
    const security = value as XrayStreamSettings['security'];

    setCustomerDraft((current) => {
      if (security === 'reality') {
        return ensureRealityMaterial(current);
      }

      return {
        ...current,
        security,
        fingerprint: security === 'none' ? '' : current.fingerprint.trim() || 'chrome',
        realityPublicKey: '',
        realityPrivateKey: '',
        realityTarget: '',
        realityShortId: ''
      };
    });
  }

  function regenerateRealityKeys() {
    setCustomerDraft((current) => refreshRealityMaterial(current));
  }

  const openCustomerDrawer = useCallback((node?: CustomerNodeRecord) => {
    if (node) {
      setCustomerDraft(createCustomerDraftFromNode(node));
      setCustomerAdvancedOpen(true);
      setDrawer({ type: 'customerNode', nodeId: node.id });
      return;
    }

    setCustomerDraft(createCustomerDraft(visibleAgents[0]));
    setCustomerAdvancedOpen(false);
    setDrawer({ type: 'customerNode' });
  }, [visibleAgents]);

  function cloneCustomerNode(node: CustomerNodeRecord) {
    setCustomerDraft(createClonedCustomerDraftFromNode(node));
    setCustomerAdvancedOpen(true);
    setDrawer({ type: 'customerNode' });
  }

  useEffect(() => {
    if (!focusIntent || consumedFocusIntentIdRef.current === focusIntent.id) {
      return;
    }

    if (focusIntent.kind === 'host.deploy') {
      const agent = visibleAgents.find((item) => item.id === focusIntent.targetId);

      if (!agent) {
        return;
      }

      consumedFocusIntentIdRef.current = focusIntent.id;
      setHostSearch('');
      setHostStatusFilter('all');
      setHostCapabilityFilter('all');
      setHostRuntimeHealthFilter('all');
      onDeployHostConfig(agent);
      return;
    }

    const node = visibleCustomerNodes.find((item) => item.id === focusIntent.targetId);

    if (!node) {
      return;
    }

    consumedFocusIntentIdRef.current = focusIntent.id;
    openCustomerDrawer(node);
  }, [focusIntent, onDeployHostConfig, openCustomerDrawer, visibleAgents, visibleCustomerNodes]);

  function handleInstallSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    copyInstallCommand();
  }

  function handleSaveHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    onSaveHostConfig({
      agentId: agent.id,
      displayName: hostEdit.name.trim() || agent.name,
      runtimeHostName: hostEdit.runtimeHostName.trim() || agent.runtimeHostName || agent.id,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0),
      monthlyTrafficGb: Math.max(hostEdit.monthlyTrafficGb, 0),
      trafficAccountingMode: hostEdit.trafficAccountingMode,
      monthlyResetDay: clampResetDay(hostEdit.monthlyResetDay),
      currentUsedTrafficGb: parseNonNegativeNumber(String(hostEdit.currentUsedTrafficGb)),
      expiresAt: normalizeExpiry(hostEdit.expiresAt),
      pingTarget: hostEdit.pingTarget.trim() || agent.publicAddress,
      pingIntervalSeconds: 30
    });
    setDrawer({ type: 'closed' });
  }

  function handleCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerDraft.agentId) {
      return;
    }

    const reusableNode = findReusableCustomerNodePort(customerDraft, visibleCustomerNodes, { nodeId: editingCustomerNode?.id });
    const draftWithReusablePortProfile = applyReusableCustomerNodePortProfile(customerDraft, reusableNode);
    const preparedDraft =
      draftWithReusablePortProfile.security === 'reality'
      && (!draftWithReusablePortProfile.realityPublicKey.trim()
        || !draftWithReusablePortProfile.realityPrivateKey.trim()
        || !draftWithReusablePortProfile.realityShortId.trim())
        ? ensureRealityMaterial(draftWithReusablePortProfile)
        : draftWithReusablePortProfile;

    if (preparedDraft !== customerDraft) {
      setCustomerDraft(preparedDraft);
    }

    const selectedAgent = visibleAgents.find((agent) => agent.id === preparedDraft.agentId);
    const resolvedSni =
      preparedDraft.protocol === 'shadowsocks'
        ? ''
        : preparedDraft.sni.trim() || extractHostLabel(preparedDraft.serverAddress);
    const resolvedRealityTarget =
      preparedDraft.realityTarget.trim() || (preparedDraft.security === 'reality' && resolvedSni ? `${resolvedSni}:443` : '');
    const resolvedClientIdentity = preparedDraft.clientIdentity.trim() || createClientIdentity(preparedDraft.protocol);
    const resolvedClientCredential = preparedDraft.clientCredential.trim() || resolvedClientIdentity;
    const resolvedCustomerName = preparedDraft.customerName.trim() || t.customerName;
    const resolvedNodeName = preparedDraft.nodeName.trim() || createDefaultCustomerNodeName(preparedDraft);
    const resolvedSubscriptionRule = preparedDraft.subscriptionRule.trim() || createDefaultSubscriptionRule({
      ...preparedDraft,
      customerName: resolvedCustomerName,
      clientIdentity: resolvedClientIdentity
    });
    const subscriptionMaterial = createCustomerSubscriptionMaterial(
      {
        ...preparedDraft,
        customerName: resolvedCustomerName,
        clientIdentity: resolvedClientIdentity,
        subscriptionRule: resolvedSubscriptionRule
      },
      t.customerName
    );
    const resolvedTrafficLimitGb = Math.max(Number.parseInt(preparedDraft.trafficLimitGb, 10) || 0, 0);
    const resolvedTrafficMultiplier = parseCustomerNodeTrafficMultiplier(preparedDraft.trafficMultiplier);
    const resolvedTrafficLimitBytes = bytesFromGb(resolvedTrafficLimitGb);
    const resolvedUsedTrafficGb = parseNonNegativeNumber(preparedDraft.currentUsedTrafficGb);
    const resolvedUsedTrafficBytes = bytesFromGb(resolvedUsedTrafficGb);
    const resolvedRemainingDays = Math.max(Number.parseInt(preparedDraft.remainingDays, 10) || 0, 0);
    const resolvedExpiresAt = new Date(Date.now() + resolvedRemainingDays * DAY_MS).toISOString();
    const resolvedListenPort = resolveCustomerNodeListenPort(preparedDraft, {
      agentId: preparedDraft.agentId,
      nodeId: editingCustomerNode?.id,
      reusablePort: reusableNode?.listenPort,
      usedPorts: visibleCustomerNodes
        .filter((node) => node.agentId === preparedDraft.agentId && node.id !== editingCustomerNode?.id)
        .map((node) => node.listenPort)
    });

    const nextNode: CustomerNodeRecord = {
      id: editingCustomerNode?.id ?? 'customer-node-' + Date.now(),
      agentId: preparedDraft.agentId,
      nodeName: resolvedNodeName,
      customerName: resolvedCustomerName,
      serverAddress: preparedDraft.serverAddress.trim() || (selectedAgent?.publicAddress || ''),
      protocol: preparedDraft.protocol,
      listenPort: resolvedListenPort,
      clientIdentity: resolvedClientIdentity,
      clientEmail: preparedDraft.clientEmail.trim() || resolvedCustomerName || resolvedClientIdentity,
      clientCredential: resolvedClientCredential,
      clientLevel: Math.max(Number.parseInt(preparedDraft.clientLevel, 10) || 0, 0),
      clientComment: preparedDraft.clientComment.trim(),
      telegramId: preparedDraft.telegramId.trim(),
      resetPolicy: preparedDraft.resetPolicy,
      vmessSecurity: preparedDraft.vmessSecurity.trim() || 'auto',
      shadowsocksMethod: preparedDraft.shadowsocksMethod.trim() || '2022-blake3-aes-128-gcm',
      hysteriaAuth: preparedDraft.hysteriaAuth.trim() || resolvedClientCredential,
      streamNetwork: preparedDraft.streamNetwork,
      security: preparedDraft.security,
      sni: resolvedSni,
      path: preparedDraft.path.trim(),
      flow: preparedDraft.flow.trim(),
      fingerprint: preparedDraft.fingerprint.trim() || (preparedDraft.security === 'reality' ? 'chrome' : ''),
      alpn: splitCsv(preparedDraft.alpn),
      realityPublicKey: preparedDraft.realityPublicKey.trim(),
      realityPrivateKey: preparedDraft.realityPrivateKey.trim(),
      realityTarget: resolvedRealityTarget,
      realityShortId: preparedDraft.realityShortId.trim(),
      fallbackName: preparedDraft.fallbackName.trim(),
      fallbackDestination: preparedDraft.fallbackDestination.trim(),
      fallbackXver: Math.max(Number.parseInt(preparedDraft.fallbackXver, 10) || 0, 0),
      sniffingEnabled: preparedDraft.sniffingEnabled,
      ipLimit: Math.max(Number.parseInt(preparedDraft.ipLimit, 10) || 0, 0),
      trafficMultiplier: resolvedTrafficMultiplier,
      trafficLimitGb: resolvedTrafficLimitGb,
      trafficLimitBytes: resolvedTrafficLimitBytes,
      monthlyResetDay: clampResetDay(Number.parseInt(preparedDraft.monthlyResetDay, 10) || 1),
      currentUsedTrafficGb: resolvedUsedTrafficGb,
      usedTrafficBytes: resolvedUsedTrafficBytes,
      remainingDays: resolvedRemainingDays,
      expiresAt: resolvedExpiresAt,
      quotaExceeded: resolvedTrafficLimitBytes > 0 && resolvedUsedTrafficBytes >= resolvedTrafficLimitBytes,
      clientExpired: resolvedRemainingDays <= 0,
      runtimeDisabledByPolicy: editingCustomerNode?.runtimeDisabledByPolicy ?? false,
      guardrailReason: editingCustomerNode?.guardrailReason ?? '',
      subscriptionRule: resolvedSubscriptionRule,
      inboundStatus: editingCustomerNode?.inboundStatus ?? 'enabled',
      enabled: editingCustomerNode?.enabled ?? true
    };
    const saveAction = editingCustomerNode ? 'update' : 'create';

    onSaveCustomerNode(
      {
        nodeId: nextNode.id,
        agentId: nextNode.agentId,
        customerNodeName: nextNode.nodeName,
        customerName: nextNode.customerName,
        serverAddress: nextNode.serverAddress,
        xrayProtocol: nextNode.protocol,
        listenPort: nextNode.listenPort,
        clientIdentity: nextNode.clientIdentity,
        clientEmail: nextNode.clientEmail,
        clientCredential: nextNode.clientCredential,
        clientLevel: nextNode.clientLevel,
        clientComment: nextNode.clientComment,
        telegramId: nextNode.telegramId,
        resetPolicy: nextNode.resetPolicy,
        vmessSecurity: nextNode.vmessSecurity,
        shadowsocksMethod: nextNode.shadowsocksMethod,
        hysteriaAuth: nextNode.hysteriaAuth,
        streamNetwork: nextNode.streamNetwork,
        security: nextNode.security,
        sni: nextNode.sni,
        path: nextNode.path,
        flow: nextNode.flow,
        fingerprint: nextNode.fingerprint,
        alpn: nextNode.alpn,
        realityPublicKey: nextNode.realityPublicKey,
        realityPrivateKey: nextNode.realityPrivateKey,
        realityTarget: nextNode.realityTarget,
        realityShortId: nextNode.realityShortId,
        fallbackName: nextNode.fallbackName,
        fallbackDestination: nextNode.fallbackDestination,
        fallbackXver: nextNode.fallbackXver,
        sniffingEnabled: nextNode.sniffingEnabled,
        ipLimit: nextNode.ipLimit,
        trafficMultiplier: nextNode.trafficMultiplier,
        trafficLimitGb: nextNode.trafficLimitGb,
        monthlyResetDay: nextNode.monthlyResetDay,
        currentUsedTrafficGb: nextNode.currentUsedTrafficGb,
        remainingDays: nextNode.remainingDays,
        subscriptionRule: nextNode.subscriptionRule,
        subscriptionClientId: subscriptionMaterial.subscriptionClientId,
        subId: subscriptionMaterial.subId,
        securePathPreview: subscriptionMaterial.securePathPreview,
        subscriptionUrlPreview: subscriptionMaterial.subscriptionUrlPreview,
        enabled: nextNode.enabled
      },
      saveAction
    );

    if (editingCustomerNode) {
      setDrawer({ type: 'closed' });
    }
  }

  async function handleDeleteHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    const deleted = await onDeleteHost({
      agentId: agent.id,
      displayName: hostEdit.name.trim() || agent.name,
      runtimeHostName: hostEdit.runtimeHostName.trim() || agent.runtimeHostName || agent.id,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0),
      monthlyTrafficGb: Math.max(hostEdit.monthlyTrafficGb, 0),
      trafficAccountingMode: hostEdit.trafficAccountingMode,
      monthlyResetDay: clampResetDay(hostEdit.monthlyResetDay),
      currentUsedTrafficGb: parseNonNegativeNumber(String(hostEdit.currentUsedTrafficGb)),
      expiresAt: normalizeExpiry(hostEdit.expiresAt),
      pingTarget: hostEdit.pingTarget.trim() || agent.publicAddress,
      pingIntervalSeconds: 30
    });

    if (deleted) {
      setRemovedAgentIds((current) => [...new Set([...current, agent.id])]);
      setDrawer({ type: 'closed' });
    }
  }

  function handleDeleteCustomerNode(node: CustomerNodeRecord) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmDeleteCustomerNode(node.nodeName));

    if (!confirmed) {
      return;
    }

    onDeleteCustomerNode(createCustomerNodeMetadataFromRecord(node));
  }

  function copyInstallCommand() {
    if (!installCommand?.command || typeof navigator === 'undefined') {
      return;
    }

    void copyText(installCommand.command);
  }

  async function copyAgentUpgradeCommand(agent: Agent) {
    const reason = getAgentRecoveryReason(agent);

    setUpgradeBusyAgentIds((current) => [...new Set([...current, agent.id])]);
    setUpgradeErrorAgentIds((current) => current.filter((agentId) => agentId !== agent.id));

    try {
      if (!onPreviewAgentUpgradeCommand) {
        throw new Error('Agent upgrade command API unavailable.');
      }

      const command = await onPreviewAgentUpgradeCommand(agent, reason);
      setUpgradeCommands((current) => ({ ...current, [agent.id]: command }));
      void copyText(command.command);
    } catch {
      setUpgradeErrorAgentIds((current) => [...new Set([...current, agent.id])]);
    } finally {
      setUpgradeBusyAgentIds((current) => current.filter((agentId) => agentId !== agent.id));
    }
  }

  function remoteUpgradeAgentWithConfirmation(agent: Agent) {
    if (!onRemoteAgentUpgrade) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRemoteUpgradeAgent(agent.name));

    if (!confirmed) {
      return;
    }

    onRemoteAgentUpgrade(agent, getAgentRecoveryReason(agent));
  }

  function toggleCustomerNodeSelection(nodeId: string) {
    setBulkCustomerNodeDeleteConfirming(false);
    setSelectedCustomerNodeIds((current) =>
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]
    );
  }

  function toggleVisibleCustomerNodeSelection() {
    setBulkCustomerNodeDeleteConfirming(false);
    const visibleIds = filteredCustomerNodes.map((node) => node.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedCustomerNodeIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function copyCustomerNodeShareLink(node: CustomerNodeRecord) {
    void copyText(createCustomerNodeLinkMaterial(node, t.customerName).shareLink);
  }

  function copyCustomerNodeSubscriptionLink(node: CustomerNodeRecord) {
    void copyText(createCustomerNodeLinkMaterial(node, t.customerName).subscriptionLink);
  }

  function copySelectedCustomerNodeLinks() {
    const links = selectedCustomerNodes.map((node) => [
      node.nodeName,
      createCustomerNodeLinkMaterial(node, t.customerName).shareLink,
      createCustomerNodeLinkMaterial(node, t.customerName).subscriptionLink
    ].join('\n'));

    if (links.length > 0) {
      void copyText(links.join('\n\n'));
    }
  }

  function updateSelectedCustomerNodeMetadata(updateMetadata: (metadata: CustomerNodeConfigMetadata) => CustomerNodeConfigMetadata) {
    setBulkCustomerNodeDeleteConfirming(false);
    selectedCustomerNodes.forEach((node) => {
      onSaveCustomerNode(updateMetadata(createCustomerNodeMetadataFromRecord(node)), 'update');
    });
  }

  function updateCustomerNodeMetadata(node: CustomerNodeRecord, updateMetadata: (metadata: CustomerNodeConfigMetadata) => CustomerNodeConfigMetadata) {
    setBulkCustomerNodeDeleteConfirming(false);
    onSaveCustomerNode(updateMetadata(createCustomerNodeMetadataFromRecord(node)), 'update');
  }

  function setCustomerNodeEnabled(node: CustomerNodeRecord, enabled: boolean) {
    const actionLabel = enabled ? t.enableCustomerNode : t.disableCustomerNode;
    const confirmed =
      typeof window === 'undefined' || window.confirm(t.confirmBulkCustomerNodeEnabled(actionLabel, '1'));

    if (!confirmed) {
      return;
    }

    updateCustomerNodeMetadata(node, (metadata) => createCustomerNodeEnabledUpdate(metadata, enabled));
  }

  function addTrafficToCustomerNode(node: CustomerNodeRecord) {
    updateCustomerNodeMetadata(node, (metadata) => createCustomerNodeTrafficUpdate(metadata, 100));
  }

  function renewCustomerNode(node: CustomerNodeRecord) {
    updateCustomerNodeMetadata(node, (metadata) => createCustomerNodeRenewalUpdate(metadata, 30));
  }

  function updateSelectedCustomerNodesEnabled(enabled: boolean) {
    if (selectedCustomerNodes.length === 0) {
      return;
    }

    const actionLabel = enabled ? t.bulkEnableCustomerNodes.replace(/^Bulk\s+/i, '') : t.bulkDisableCustomerNodes.replace(/^Bulk\s+/i, '');
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkCustomerNodeEnabled(actionLabel, String(selectedCustomerNodes.length)));

    if (!confirmed) {
      return;
    }

    updateSelectedCustomerNodeMetadata((metadata) => ({
      ...metadata,
      enabled
    }));
  }

  function addTrafficToSelectedCustomerNodes() {
    const trafficGb = Math.max(Number.parseInt(bulkCustomerNodeTrafficGb, 10) || 0, 0);

    if (trafficGb === 0) {
      return;
    }

    if (selectedCustomerNodes.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkAddCustomerNodeTraffic(String(trafficGb), String(selectedCustomerNodes.length)));

    if (!confirmed) {
      return;
    }

    updateSelectedCustomerNodeMetadata((metadata) => ({
      ...metadata,
      trafficLimitGb: metadata.trafficLimitGb + trafficGb
    }));
  }

  function renewSelectedCustomerNodes() {
    const days = Math.max(Number.parseInt(bulkCustomerNodeRenewDays, 10) || 0, 0);

    if (days === 0) {
      return;
    }

    if (selectedCustomerNodes.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkRenewCustomerNodes(String(days), String(selectedCustomerNodes.length)));

    if (!confirmed) {
      return;
    }

    updateSelectedCustomerNodeMetadata((metadata) => ({
      ...metadata,
      remainingDays: metadata.remainingDays + days
    }));
  }

  function resetSelectedCustomerNodeUsedTraffic() {
    if (selectedCustomerNodes.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkResetCustomerNodeUsedTraffic(String(selectedCustomerNodes.length)));

    if (!confirmed) {
      return;
    }

    updateSelectedCustomerNodeMetadata((metadata) => ({
      ...metadata,
      currentUsedTrafficGb: 0
    }));
  }

  function applySelectedCustomerNodeResetPolicy() {
    if (selectedCustomerNodes.length === 0) {
      return;
    }

    const policyLabel = t.resetPolicyLabels[bulkCustomerNodeResetPolicy].toLocaleLowerCase();
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmApplyCustomerNodeResetPolicy(policyLabel, String(selectedCustomerNodes.length)));

    if (!confirmed) {
      return;
    }

    updateSelectedCustomerNodeMetadata((metadata) => ({
      ...metadata,
      resetPolicy: bulkCustomerNodeResetPolicy
    }));
  }

  function deleteSelectedCustomerNodes() {
    selectedCustomerNodes.forEach((node) => {
      onDeleteCustomerNode(createCustomerNodeMetadataFromRecord(node));
    });
    setSelectedCustomerNodeIds([]);
    setBulkCustomerNodeDeleteConfirming(false);
  }

  function resetSelectedCustomerNodeTraffic() {
    if (!onResetCustomerNodeTraffic) {
      return;
    }

    const policies = selectedCustomerNodes
      .map((node) => findCustomerNodeQuotaPolicy(node, quotaPolicies))
      .filter((policy): policy is QuotaPolicy => Boolean(policy));

    if (policies.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkResetCustomerNodeTraffic(String(policies.length)));

    if (confirmed) {
      policies.forEach((policy) => onResetCustomerNodeTraffic(policy));
    }
  }

  function resetCustomerNodeTraffic(node: CustomerNodeRecord, policy: QuotaPolicy) {
    if (!onResetCustomerNodeTraffic) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmResetCustomerNodeTraffic(node.nodeName));

    if (confirmed) {
      onResetCustomerNodeTraffic(policy);
    }
  }

  return (
    <ResponsivePage>
      <section aria-label={t.operationalOverview} className="stagger-1 space-y-3">
        <ResponsiveSection>
          <h3 className="text-base font-bold text-[#07111F] dark:text-white">{pageTitle}</h3>
          <p className="mt-3 font-mono text-[10px] font-black uppercase tracking-[0.24em] text-[#1E3AFF] dark:text-[#DDE3FF]">
            {t.operationalOverview}
          </p>
        </ResponsiveSection>

        <section className="nodes-control-band island-card p-3">
          {showWorkspaceSwitcher || activeWorkspace === 'hosts' ? (
            <div className={cn('flex flex-wrap items-center gap-3', showWorkspaceSwitcher ? 'justify-between' : 'justify-end')}>
              {showWorkspaceSwitcher ? (
              <div className="nodes-workspace-switcher flex flex-wrap gap-2">
                <WorkspaceButton active={activeWorkspace === 'hosts'} label={t.hostsTab} onClick={() => setUnlockedWorkspace('hosts')} />
                <WorkspaceButton
                  active={activeWorkspace === 'customerNodes'}
                  label={t.customerNodesTab}
                  onClick={() => setUnlockedWorkspace('customerNodes')}
                />
              </div>
              ) : null}
              {activeWorkspace === 'hosts' ? (
                <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => setDrawer({ type: 'install' })}>
                  <Terminal className="h-3.5 w-3.5" />
                  {t.openInstall}
                </GlowButton>
              ) : null}
            </div>
          ) : null}

          <div className="nodes-summary-metric-grid mt-3 grid grid-cols-3 gap-2 max-md:grid-cols-1">
            <SummaryMetric icon={ServerCog} label={t.hostSummary} value={String(visibleAgents.length)} />
            <SummaryMetric icon={CheckCircle2} label={t.onlineSummary} value={String(onlineHostCount)} />
            <SummaryMetric icon={UserRound} label={t.customerSummary} value={String(visibleCustomerNodes.length)} />
          </div>
        </section>
      </section>

      {activeWorkspace === 'hosts' ? (
        <section className="stagger-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
              <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.hostTableTitle}</h4>
            </div>
          </div>
          {visibleAgents.length === 0 ? (
            <section aria-label={t.emptyHostTitle} className="island-card">
              <OperationalEmptyState actionLabel={t.emptyHostAction} label={t.noAgent} />
            </section>
          ) : (
            <div className="grid gap-3 xl:grid-cols-[17rem_minmax(0,1fr)]">
              <aside className="nodes-cockpit-rail island-card border-[#07111F] bg-[#FFFDF5] p-3 xl:sticky xl:top-0 xl:max-w-[18rem] xl:self-start" aria-label={language === 'zh' ? '主机资源' : 'Host resources'}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-[#FF3D18] dark:text-[#FFB197]">
                      {language === 'zh' ? '资源列表' : 'Resource Rail'}
                    </p>
                    <h5 className="mt-1 text-sm font-black text-[#07111F] dark:text-white">
                      {language === 'zh' ? '主机资源' : 'Host Resources'}
                    </h5>
                  </div>
                  <span className="rounded-full border border-[#1E3AFF] bg-[#DCE1FF] px-2.5 py-1 text-xs font-black text-[#1E3AFF] dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/14 dark:text-[#DDE3FF]">
                    {filteredHostAgents.length}/{visibleAgents.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 dark:border-[#6B7CFF]/25 dark:bg-[#101827]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.searchHosts}
                    </span>
                    <div className="mt-1 flex min-h-7 items-center gap-2">
                      <Search className="h-3.5 w-3.5 shrink-0 text-[#1E3AFF] dark:text-white/35" />
                      <input
                        aria-label={t.searchHosts}
                        className="w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/72 dark:text-white dark:placeholder:text-white/35"
                        onChange={(event) => setHostSearch(event.target.value)}
                        placeholder={t.searchHostsPlaceholder}
                        type="search"
                        value={hostSearch}
                      />
                    </div>
                  </label>
                  <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 dark:border-[#6B7CFF]/25 dark:bg-[#101827]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.hostStatusFilter}
                    </span>
                    <select
                      aria-label={t.hostStatusFilter}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                      onChange={(event) => setHostStatusFilter(event.target.value as HostStatusFilter)}
                      value={hostStatusFilter}
                    >
                      <option value="all">{t.hostStatusAll}</option>
                      {hostStatuses.map((status) => (
                        <option key={status} value={status}>
                          {t.statusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 dark:border-[#6B7CFF]/25 dark:bg-[#101827]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.hostCapabilityFilter}
                    </span>
                    <select
                      aria-label={t.hostCapabilityFilter}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                      onChange={(event) => setHostCapabilityFilter(event.target.value as HostCapabilityFilter)}
                      value={hostCapabilityFilter}
                    >
                      <option value="all">{t.hostCapabilityAll}</option>
                      {hostCapabilityOptions.map((capability) => (
                        <option key={capability} value={capability}>
                          {capability}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 dark:border-[#6B7CFF]/25 dark:bg-[#101827]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.hostRuntimeHealthFilter}
                    </span>
                    <select
                      aria-label={t.hostRuntimeHealthFilter}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                      onChange={(event) => setHostRuntimeHealthFilter(event.target.value as HostRuntimeHealthFilter)}
                      value={hostRuntimeHealthFilter}
                    >
                      <option value="all">{t.hostRuntimeHealthAll}</option>
                      <option value="issues">{t.hostRuntimeHealthIssues}</option>
                      <option value="sampling-gap">{t.hostRuntimeHealthSamplingGap}</option>
                      <option value="no-telemetry">{t.hostRuntimeHealthNoTelemetry}</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 space-y-2" role="list" aria-label={language === 'zh' ? '主机列表' : 'Host list'}>
                  {filteredHostAgents.slice(0, 8).map((agent) => {
                    const hostEdit = getHostEdit(agent);
                    const active = selectedHostPreview?.id === agent.id;

                    return (
                      <button
                        aria-label={`${language === 'zh' ? '选择主机' : 'Select host'} ${hostEdit.name}`}
                        aria-pressed={active}
                        className={cn(
                          'nodes-host-pill w-full border px-3 py-2 text-left transition duration-200 active:translate-y-px',
                          active
                            ? 'nodes-host-pill-active border-[#1E3AFF] bg-[#DCE1FF] text-[#07111F] dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/14 dark:text-white'
                            : 'border-transparent bg-transparent text-[#35405A] hover:border-[#1E3AFF] hover:bg-[#DCE1FF]/55 dark:text-white/70 dark:hover:border-[#6B7CFF]/25 dark:hover:bg-[#6B7CFF]/10'
                        )}
                        key={agent.id}
                        onClick={() => setSelectedHostPreviewId(agent.id)}
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-black">{agent.publicAddress}</span>
                          <span className={cn('h-2 w-2 rounded-full', agent.status === 'online' ? 'bg-[#00A878]' : agent.status === 'degraded' ? 'bg-[#FF3D18]' : 'bg-[#07111F] dark:bg-[#F4F8FF]')} />
                        </span>
                        <span className="mt-1 block truncate font-mono text-[11px] font-semibold opacity-70">{t.statusLabels[agent.status]}</span>
                      </button>
                    );
                  })}
                </div>

              </aside>
              <section className="min-w-0 space-y-3" aria-label={language === 'zh' ? '操作详情' : 'Action details'}>
                {selectedHostPreview && selectedHostPreviewEdit ? (
                  <section
                    aria-label={language === 'zh' ? '当前主机' : 'Selected host'}
                    className="nodes-current-host-hero island-card overflow-hidden border-[#1E3AFF] bg-[#DCE1FF]/70 p-3 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/12"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-[#1E3AFF] dark:text-[#DDE3FF]">
                          {language === 'zh' ? '当前主机' : 'Selected Host'}
                        </p>
                        <p className="mt-1 text-lg font-black text-[#07111F] [overflow-wrap:anywhere] dark:text-white">
                          {language === 'zh' ? `当前 · ${selectedHostPreviewEdit.name}` : `Selected · ${selectedHostPreviewEdit.name}`}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs font-bold text-[#35405A] dark:text-white/50">
                          {selectedHostPreview.publicAddress}
                        </p>
                      </div>
                      <span className="rounded-full border border-[#00A878] bg-[#FFFDF5] px-3 py-1 text-xs font-black text-[#007D5E] dark:border-[#35E68E]/35 dark:bg-[#101827] dark:text-[#9EF4C4]">
                        {t.statusLabels[selectedHostPreview.status]}
                      </span>
                    </div>
                    <div className="nodes-current-host-metric-grid mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <CompactInfoField label={t.latency} value={selectedHostPreviewHasTelemetry ? `${Math.round(selectedHostPreview.telemetry.latencyMs)} ms` : '-'} />
                      <CompactInfoField label={t.memory} value={selectedHostPreviewHasTelemetry ? formatTelemetryPercentValue(selectedHostPreview, selectedHostPreview.telemetry.memoryPercent) : '-'} />
                      <CompactInfoField label={t.serviceHealthLabel} value={selectedHostPreviewHasTelemetry ? t.statusLabels[selectedHostPreview.status] : t.serviceWaiting} />
                    </div>
                    <SelectedAgentReadiness agent={selectedHostPreview} t={t} />
                    <div className="nodes-current-host-inventory-grid mt-3 grid grid-cols-2 gap-2 xl:grid-cols-3 max-md:grid-cols-1">
                      <CompactInfoField
                        label={t.runtimeHostName}
                        value={selectedHostPreviewEdit?.runtimeHostName || selectedHostPreview.runtimeHostName || selectedHostPreview.id}
                      />
                      <CompactInfoField label={t.versionLabel} value={selectedHostPreview.version} />
                      <CompactInfoField label={t.platformLabel} value={selectedHostPreview.platform} />
                      <CompactInfoField label={t.capabilitiesLabel} value={selectedHostPreview.capabilities.join(' · ')} />
                      <CompactInfoField
                        label={t.sampleStatus}
                        value={
                          selectedHostPreviewHasTelemetry || selectedHostPreview.telemetry.sampleGapDetected
                            ? formatSamplingStatus(selectedHostPreview, language, t)
                            : t.waitingTelemetry
                        }
                      />
                      <CompactInfoField
                        label={t.lastReport}
                        value={formatTelemetryTimestamp(selectedHostPreview, language)}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button
                        aria-label={language === 'zh' ? '编辑当前主机' : 'Edit selected host'}
                        className="inline-flex min-h-9 items-center justify-center gap-2 border border-[#07111F]/25 bg-[#FFFDF5] px-3 text-xs font-bold text-[#35405A] transition hover:-translate-y-0.5 hover:border-[#1E3AFF] hover:bg-[#DCE1FF]/55 hover:text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:text-white/70 dark:hover:text-[#DDE3FF]"
                        onClick={() => setDrawer({ type: 'editHost', agentId: selectedHostPreview.id })}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t.editHost}
                      </button>
                      <GlowButton
                        className="gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={taskMutationBusy}
                        onClick={() => onDeployHostConfig(selectedHostPreview)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t.deployHostConfig}
                      </GlowButton>
                    </div>
                  </section>
                ) : null}
                {filteredHostAgents.length > 1 ? (
                  <section
                    aria-label={language === 'zh' ? '其他主机' : 'Other hosts'}
                    className="island-card divide-y divide-[#07111F]/12 overflow-hidden border-[#07111F] bg-[#FFFDF5] dark:border-[#6B7CFF]/25 dark:bg-[#101827] dark:divide-[#6B7CFF]/18"
                  >
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <h5 className="text-sm font-black text-[#07111F] dark:text-white">
                        {language === 'zh' ? '其他主机' : 'Other hosts'}
                      </h5>
                      <span className="text-xs font-bold text-[#35405A] dark:text-white/45">
                        {filteredHostAgents.length - 1}
                      </span>
                    </div>
                    {filteredHostAgents
                      .filter((agent) => agent.id !== selectedHostPreview?.id)
                      .slice(0, 6)
                      .map((agent) => (
                        <button
                          aria-label={`${language === 'zh' ? '切换到其他主机' : 'Switch to other host'} ${getHostEdit(agent).name}`}
                          className="nodes-host-thin-row flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[#DCE1FF]/55 active:translate-y-px dark:hover:bg-[#6B7CFF]/10"
                          key={agent.id}
                          onClick={() => setSelectedHostPreviewId(agent.id)}
                          type="button"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs font-black text-[#07111F] dark:text-white/85">{agent.publicAddress}</span>
                            <span className="mt-1 block truncate text-[11px] font-semibold text-[#35405A] dark:text-white/45">{agent.region}</span>
                          </span>
                          <span className="shrink-0 rounded-full border border-[#07111F]/20 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-black text-[#35405A] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:text-white/55">
                            {t.statusLabels[agent.status]}
                          </span>
                        </button>
                      ))}
                  </section>
                ) : null}
                <section
                  aria-label={language === 'zh' ? '高级详情' : 'Advanced details'}
                  className="nodes-advanced-details island-card overflow-hidden border-[#07111F] bg-[#FFFDF5] dark:border-[#6B7CFF]/25 dark:bg-[#101827]"
                  role="group"
                >
                  <div className="nodes-advanced-details-header flex flex-wrap items-center justify-between gap-3 p-3">
                    <div>
                      <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-[#FF3D18] dark:text-[#FFB197]">
                        {language === 'zh' ? '高级详情' : 'Advanced Details'}
                      </p>
                      <h5 className="mt-1 text-sm font-black text-[#07111F] dark:text-white">
                        {t.hostTableTitle}
                      </h5>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                        {t.matchingHosts} {filteredHostAgents.length} / {visibleAgents.length}
                      </p>
                      <button
                        aria-expanded={hostAdvancedDetailsOpen}
                        className="nodes-advanced-details-toggle inline-flex min-h-9 items-center justify-center gap-2 border border-[#D9FF00] bg-[#D9FF00]/[0.22] px-3 text-xs font-black text-[#07111F] transition hover:-translate-y-0.5 hover:border-[#D9FF00] hover:bg-[#D9FF00]/[0.3] active:translate-y-px dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5] dark:hover:bg-[#EAFF5A]/18"
                        onClick={() => setHostAdvancedDetailsOpen((open) => !open)}
                        type="button"
                      >
                        {hostAdvancedDetailsOpen
                          ? language === 'zh' ? '收起高级详情' : 'Collapse advanced details'
                          : language === 'zh' ? '展开高级详情' : 'Expand advanced details'}
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', hostAdvancedDetailsOpen ? 'rotate-180' : '')} />
                      </button>
                    </div>
                  </div>
                  {hostAdvancedDetailsOpen ? (
                    filteredHostAgents.length === 0 ? (
                      <section className="border-t border-[#07111F]/12 dark:border-[#6B7CFF]/18">
                        <EmptyState label={t.noMatchingHosts} />
                      </section>
                    ) : (
                      <div className="nodes-advanced-host-grid grid grid-cols-1 gap-3 border-t border-[#07111F]/12 p-3 dark:border-[#6B7CFF]/18 md:grid-cols-2">
                        {filteredHostAgents.map((agent) => (
                          <ManagedHostCard
                            key={agent.id}
                            agent={agent}
                            hostEdit={getHostEdit(agent)}
                            language={language}
                            t={t}
                            remoteUpgradeBusy={taskMutationBusy}
                            upgradeBusy={upgradeBusyAgentIds.includes(agent.id)}
                            upgradeCommand={upgradeCommands[agent.id]}
                            upgradeError={upgradeErrorAgentIds.includes(agent.id)}
                            onCopyUpgradeCommand={() => copyAgentUpgradeCommand(agent)}
                            onDelete={() => setDrawer({ type: 'deleteHost', agentId: agent.id })}
                            onDeploy={() => onDeployHostConfig(agent)}
                            onEdit={() => setDrawer({ type: 'editHost', agentId: agent.id })}
                            onRemoteUpgrade={onRemoteAgentUpgrade ? () => remoteUpgradeAgentWithConfirmation(agent) : undefined}
                          />
                        ))}
                      </div>
                    )
                  ) : null}
                </section>
              </section>
            </div>
          )}
        </section>
      ) : (
        <section aria-label={t.customerNodesTitle} className="stagger-3 island-card overflow-hidden">
          <div className="nodes-customer-workspace-header flex flex-wrap items-start justify-between gap-3 border-b border-[#07111F]/16 bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/18 dark:bg-[#101827]">
            <div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[#1E3AFF] dark:text-[#DCE1FF]" />
                <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.customerNodesTitle}</h4>
              </div>
            {t.customerNodesHint ? (
              <p className="mt-1 max-w-3xl text-xs leading-6 text-[#35405A] dark:text-white/45">{t.customerNodesHint}</p>
            ) : null}
            </div>
            <GlowButton
              className="gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={visibleAgents.length === 0}
              onClick={() => openCustomerDrawer()}
            >
              <Plus className="h-3.5 w-3.5" />
              {t.addCustomerNode}
            </GlowButton>
          </div>

          {visibleCustomerNodes.length > 0 ? (
            <div className="nodes-customer-filter-bar border-b border-[#07111F]/16 bg-[#EAF3D1]/45 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.025]">
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(18rem,1fr)_minmax(9rem,0.24fr)_minmax(9rem,0.26fr)_minmax(9rem,0.24fr)]">
                <label className="nodes-table-filter-field block border border-[#07111F]/18 bg-[#FFFDF5]/82 px-3 py-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                    {t.searchCustomerNodes}
                  </span>
                  <div className="mt-1 flex min-h-7 items-center gap-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[#1E3AFF] dark:text-[#DCE1FF]/70" />
                    <input
                      aria-label={t.searchCustomerNodes}
                      className="w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/65 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setCustomerNodeSearch(event.target.value)}
                      placeholder={t.searchCustomerNodesPlaceholder}
                      type="search"
                      value={customerNodeSearch}
                    />
                  </div>
                </label>
                <label className="nodes-table-filter-field block border border-[#07111F]/18 bg-[#FFFDF5]/82 px-3 py-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                    {t.customerNodeProtocolFilter}
                  </span>
                  <select
                    aria-label={t.customerNodeProtocolFilter}
                    className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                    onChange={(event) => setCustomerNodeProtocolFilter(event.target.value as CustomerNodeProtocolFilter)}
                    value={customerNodeProtocolFilter}
                  >
                    <option value="all">{t.customerNodeProtocolAll}</option>
                    {customerNodeProtocolOptions.map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {protocol.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nodes-table-filter-field block border border-[#07111F]/18 bg-[#FFFDF5]/82 px-3 py-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                    {t.customerNodeHostFilter}
                  </span>
                  <select
                    aria-label={t.customerNodeHostFilter}
                    className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                    onChange={(event) => setCustomerNodeHostFilter(event.target.value)}
                    value={customerNodeHostFilter}
                  >
                    <option value="all">{t.customerNodeHostAll}</option>
                    {visibleAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {getHostEdit(agent).name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nodes-table-filter-field block border border-[#07111F]/18 bg-[#FFFDF5]/82 px-3 py-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                    {t.customerNodeStatusFilter}
                  </span>
                  <select
                    aria-label={t.customerNodeStatusFilter}
                    className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                    onChange={(event) => setCustomerNodeStatusFilter(event.target.value as CustomerNodeStatusFilter)}
                    value={customerNodeStatusFilter}
                  >
                    <option value="all">{t.customerNodeStatusAll}</option>
                    <option value="enabled">{t.customerNodeStatusLabels.enabled}</option>
                    <option value="disabled">{t.customerNodeStatusLabels.disabled}</option>
                    <option value="applying">{t.customerNodeStatusLabels.applying}</option>
                    <option value="error">{t.customerNodeStatusLabels.error}</option>
                    <option value="client-disabled">{t.customerNodeClientDisabled}</option>
                  </select>
                </label>
              </div>
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                {t.matchingCustomerNodes} {filteredCustomerNodes.length} / {visibleCustomerNodes.length}
              </p>
            </div>
          ) : null}

          {visibleCustomerNodes.length === 0 ? (
            <EmptyState label={t.noCustomerNode} />
          ) : filteredCustomerNodes.length === 0 ? (
            <EmptyState label={t.noMatchingCustomerNodes} />
          ) : (
            <>
              <details className="border-b border-[#07111F]/16 bg-[#FFFDF5] px-3 py-2.5 dark:border-[#6B7CFF]/18 dark:bg-white/[0.015]">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.08em] text-[#35405A] dark:text-white/58">
                  {t.advancedFeatures}
                </summary>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-[#35405A] dark:text-white/60">
                      <input
                        aria-label={t.selectVisibleCustomerNodes}
                        checked={filteredCustomerNodes.length > 0 && selectedVisibleCustomerNodeCount === filteredCustomerNodes.length}
                        className="h-4 w-4 border-[#07111F]/35 text-[#1E3AFF] focus:ring-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-white/5 dark:text-[#DCE1FF]"
                        onChange={toggleVisibleCustomerNodeSelection}
                        type="checkbox"
                      />
                      {t.selectVisibleCustomerNodes}
                    </label>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                      {t.selectedCustomerNodes} {selectedCustomerNodes.length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex min-h-9 items-center justify-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/72 px-3 text-xs font-bold text-[#35405A] transition hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/60 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:bg-[#6B7CFF]/12 dark:hover:text-[#DCE1FF]"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={copySelectedCustomerNodeLinks}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.bulkCopyCustomerNodeLinks}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center gap-2 border border-[#1E3AFF]/35 bg-[#DCE1FF]/28 px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF]/60 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/30 dark:bg-[#6B7CFF]/10 dark:text-[#DCE1FF] dark:hover:bg-[#6B7CFF]/14"
                      disabled={selectedCustomerNodes.length === 0 || !onResetCustomerNodeTraffic}
                      onClick={resetSelectedCustomerNodeTraffic}
                      type="button"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t.bulkResetCustomerNodeTraffic}
                    </button>
                    <label className="inline-flex min-h-9 items-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/72 px-2.5 text-xs font-bold text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/55">
                      <span className="whitespace-nowrap">{t.bulkAddCustomerNodeTrafficAmount}</span>
                      <input
                        aria-label={t.bulkAddCustomerNodeTrafficAmount}
                        className="w-16 bg-transparent text-right text-xs font-black text-[#07111F] outline-none dark:text-white"
                        min={0}
                        onChange={(event) => setBulkCustomerNodeTrafficGb(event.target.value)}
                        type="number"
                        value={bulkCustomerNodeTrafficGb}
                      />
                    </label>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#1E3AFF]/35 bg-[#DCE1FF]/28 px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF]/60 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/30 dark:bg-[#6B7CFF]/10 dark:text-[#DCE1FF] dark:hover:bg-[#6B7CFF]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={addTrafficToSelectedCustomerNodes}
                      type="button"
                    >
                      {t.bulkAddCustomerNodeTraffic}
                    </button>
                    <label className="inline-flex min-h-9 items-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/72 px-2.5 text-xs font-bold text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/55">
                      <span className="whitespace-nowrap">{t.bulkRenewCustomerNodeDays}</span>
                      <input
                        aria-label={t.bulkRenewCustomerNodeDays}
                        className="w-16 bg-transparent text-right text-xs font-black text-[#07111F] outline-none dark:text-white"
                        min={0}
                        onChange={(event) => setBulkCustomerNodeRenewDays(event.target.value)}
                        type="number"
                        value={bulkCustomerNodeRenewDays}
                      />
                    </label>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#1E3AFF]/35 bg-[#DCE1FF]/28 px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF]/60 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/30 dark:bg-[#6B7CFF]/10 dark:text-[#DCE1FF] dark:hover:bg-[#6B7CFF]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={renewSelectedCustomerNodes}
                      type="button"
                    >
                      {t.bulkRenewCustomerNodes}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#1E3AFF]/35 bg-[#DCE1FF]/28 px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF]/60 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#6B7CFF]/30 dark:bg-[#6B7CFF]/10 dark:text-[#DCE1FF] dark:hover:bg-[#6B7CFF]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={resetSelectedCustomerNodeUsedTraffic}
                      type="button"
                    >
                      {t.bulkResetCustomerNodeUsedTraffic}
                    </button>
                    <label className="inline-flex min-h-9 items-center gap-2 border border-[#07111F]/18 bg-[#FFFDF5]/72 px-2.5 text-xs font-bold text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/55">
                      <span className="whitespace-nowrap">{t.bulkCustomerNodeResetPolicy}</span>
                      <select
                        aria-label={t.bulkCustomerNodeResetPolicy}
                        className="ou-select bg-transparent text-xs font-black text-[#07111F] outline-none dark:text-white"
                        onChange={(event) => setBulkCustomerNodeResetPolicy(event.target.value as XrayClientResetPolicy)}
                        value={bulkCustomerNodeResetPolicy}
                      >
                        {RESET_POLICY_OPTIONS.map((policy) => (
                          <option key={policy} value={policy}>
                            {t.resetPolicyLabels[policy]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#FF3D18]/45 bg-[#FFD8C6]/22 px-3 text-xs font-bold text-[#C92810] transition hover:bg-[#FFD8C6]/55 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#FFB299]/30 dark:bg-[#FFB299]/10 dark:text-[#FFB299] dark:hover:bg-[#FFB299]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={applySelectedCustomerNodeResetPolicy}
                      type="button"
                    >
                      {t.applyCustomerNodeResetPolicy}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#00A878]/45 bg-[#00A878]/10 px-3 text-xs font-bold text-[#007D5E] transition hover:bg-[#00A878]/16 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#35E68E]/30 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4] dark:hover:bg-[#35E68E]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={() => updateSelectedCustomerNodesEnabled(true)}
                      type="button"
                    >
                      {t.bulkEnableCustomerNodes}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#FF3D18]/45 bg-[#FFD8C6]/22 px-3 text-xs font-bold text-[#C92810] transition hover:bg-[#FFD8C6]/55 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#FFB299]/30 dark:bg-[#FFB299]/10 dark:text-[#FFB299] dark:hover:bg-[#FFB299]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={() => updateSelectedCustomerNodesEnabled(false)}
                      type="button"
                    >
                      {t.bulkDisableCustomerNodes}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#DC2626]/42 bg-[#DC2626]/8 px-3 text-xs font-bold text-[#B91C1C] transition hover:bg-[#DC2626]/12 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#FF8A8A]/28 dark:bg-[#FF8A8A]/10 dark:text-[#FFB4B4] dark:hover:bg-[#FF8A8A]/14"
                      disabled={selectedCustomerNodes.length === 0}
                      onClick={bulkCustomerNodeDeleteConfirming ? deleteSelectedCustomerNodes : () => setBulkCustomerNodeDeleteConfirming(true)}
                      type="button"
                    >
                      {bulkCustomerNodeDeleteConfirming
                        ? t.confirmBulkDeleteCustomerNodes(String(selectedCustomerNodes.length))
                        : t.bulkDeleteCustomerNodes}
                    </button>
                  </div>
                </div>
                {selectedCustomerNodes.length > 0 ? (
                  <CustomerNodeBulkImpactPreflight
                    language={language}
                    selectedCount={selectedCustomerNodes.length}
                    summary={customerNodeBulkImpactSummary}
                    t={t}
                  />
                ) : null}
              </details>
              <div className="overflow-x-auto">
                <table className="nodes-customer-node-table w-full min-w-[860px] table-fixed text-left">
                <thead className="bg-[#EAF3D1]/58 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:bg-white/[0.03] dark:text-white/42">
                  <tr>
                    <th className="w-10 px-3 py-2.5">{t.selectCustomerNode}</th>
                    <th className="w-[15rem] px-3 py-2.5">{t.customerNodeName}</th>
                    <th className="w-[12rem] px-3 py-2.5">{t.customerName}</th>
                    <th className="w-[11rem] px-3 py-2.5">{t.assignedHost}</th>
                    <th className="w-[12rem] px-3 py-2.5">{t.protocolConfig}</th>
                    <th className="w-[6rem] px-3 py-2.5">{t.maxTraffic}</th>
                    <th className="w-[6rem] px-3 py-2.5">{t.trafficMultiplier}</th>
                    <th className="w-[14rem] px-3 py-2.5">{t.subscriptionRule}</th>
                    <th className="w-[24rem] px-3 py-2.5 text-right">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#07111F]/12 dark:divide-[#6B7CFF]/18">
                  {filteredCustomerNodes.map((node) => {
                    const agent = visibleAgents.find((item) => item.id === node.agentId);
                    const quotaPolicy = findCustomerNodeQuotaPolicy(node, quotaPolicies);

                    return (
                      <tr key={node.id} className="nodes-customer-node-row transition-colors hover:bg-[#DCE1FF]/42 dark:hover:bg-[#6B7CFF]/10">
                        <td className="nodes-customer-node-row-cell px-3 py-2.5">
                          <input
                            aria-label={`${t.selectCustomerNode} ${node.nodeName}`}
                            checked={selectedCustomerNodeIds.includes(node.id)}
                            className="h-4 w-4 border-[#07111F]/35 text-[#1E3AFF] focus:ring-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-white/5 dark:text-[#DCE1FF]"
                            onChange={() => toggleCustomerNodeSelection(node.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5">
                          <p className="text-sm font-bold leading-5 text-[#07111F] [overflow-wrap:anywhere] dark:text-white">{node.nodeName}</p>
                          <p className="mt-1 text-[11px] text-[#35405A] dark:text-white/45">
                            {node.remainingDays} {t.unitDays}
                          </p>
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5 text-xs font-semibold leading-5 text-[#35405A] [overflow-wrap:anywhere] dark:text-white/70">
                          {node.customerName}
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5 text-xs font-semibold leading-5 text-[#35405A] [overflow-wrap:anywhere] dark:text-white/70">
                          {agent ? getHostEdit(agent).name : t.unknownHost}
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5">
                          <p className="font-mono text-xs font-semibold uppercase text-[#07111F] [overflow-wrap:anywhere] dark:text-white/75">
                            {node.protocol}:{node.listenPort}
                          </p>
                          <p className="mt-1 text-[11px] text-[#35405A] [overflow-wrap:anywhere] dark:text-white/45">
                            {node.streamNetwork} / {node.security} / IP {node.ipLimit}
                          </p>
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5 text-xs font-semibold text-[#35405A] dark:text-white/70">
                          {node.trafficLimitGb} {t.unitGb}
                        </td>
                        <td aria-label={`x${node.trafficMultiplier}`} className="nodes-customer-node-row-cell px-3 py-2.5 text-xs font-black text-[#07111F] dark:text-white/70">
                          x{node.trafficMultiplier}
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5">
                          <code className="block break-all border border-[#07111F]/14 bg-[#EAF3D1]/56 px-2.5 py-1 font-mono text-[11px] leading-5 text-[#35405A] dark:border-[#6B7CFF]/16 dark:bg-white/[0.04] dark:text-white/60">
                            {node.subscriptionRule}
                          </code>
                        </td>
                        <td className="nodes-customer-node-row-cell px-3 py-2.5">
                          <SimpleNodeTableActions
                            enabled={node.enabled}
                            labels={{
                              addTraffic: t.addCustomerNodeTraffic,
                              cloneNode: t.cloneCustomerNode,
                              copyShare: t.copySingleNodeLink,
                              copySubscription: t.copySubscriptionLink,
                              deleteNode: t.deleteCustomerNode,
                              disableNode: t.disableCustomerNode,
                              editNode: t.editCustomerNode,
                              enableNode: t.enableCustomerNode,
                              renewNode: t.renewCustomerNode,
                              resetTraffic: quotaPolicy && onResetCustomerNodeTraffic ? t.resetCustomerNodeTraffic : undefined,
                              viewLinks: t.viewCustomerNodeLinks
                            }}
                            onAddTraffic={() => addTrafficToCustomerNode(node)}
                            onClone={() => cloneCustomerNode(node)}
                            onCopyShare={() => copyCustomerNodeShareLink(node)}
                            onCopySubscription={() => copyCustomerNodeSubscriptionLink(node)}
                            onDelete={() => handleDeleteCustomerNode(node)}
                            onEdit={() => openCustomerDrawer(node)}
                            onRenew={() => renewCustomerNode(node)}
                            onResetTraffic={
                              quotaPolicy && onResetCustomerNodeTraffic
                                ? () => resetCustomerNodeTraffic(node, quotaPolicy)
                                : undefined
                            }
                            onSetEnabled={(enabled) => setCustomerNodeEnabled(node, enabled)}
                            onViewLinks={() => setDrawer({ type: 'customerLinks', nodeId: node.id })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>
      )}

      <ConfigDrawer
        returnFocusRef={returnFocusRef}
        description={t.installDescription}
        open={drawer.type === 'install'}
        title={t.installTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleInstallSubmit}>
          <InfoField label={t.tokenPolicy} value={t.tokenPolicyValue} />
          <InfoField label={t.capabilitySet} value={t.capabilitySetValue} />

          <div className="nodes-drawer-field border border-[#07111F]/18 bg-[#EAF3D1]/62 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
              <span>{t.commandPreview}</span>
              <button aria-label={t.commandPreview} className="border border-[#07111F]/18 bg-[#FFFDF5]/72 p-1 text-[#35405A] hover:border-[#1E3AFF]/45 hover:text-[#1E3AFF] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:text-[#DCE1FF]" onClick={copyInstallCommand} type="button">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#07111F] dark:text-white">
              <KeyRound className="h-3.5 w-3.5 text-[#1E3AFF]" />
              {installCommand?.agentId ?? t.commandLoading}
            </p>
            {installCommand ? (
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                {t.tokenExpires} {formatDateTime(installCommand.expiresAt, language)}
              </p>
            ) : null}
            <code className="block break-all font-mono text-[10px] leading-5 text-[#35405A] dark:text-white/70">
              {previewError ? t.commandUnavailable : installCommand?.command ?? t.commandLoading}
            </code>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton
              className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!installCommand?.command}
              type="submit"
            >
              {taskMutationBusy ? t.submitting : t.submitInstall}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>

      <ConfigDrawer
        returnFocusRef={returnFocusRef}
        open={drawer.type === 'editHost'}
        title={t.editHost}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {selectedHost ? (
          <div className="space-y-4">
            <InputField
              label={t.hostAlias}
              value={getHostEdit(selectedHost).name}
              onChange={(value) => updateHost(selectedHost, { name: value })}
            />
            <InputField
              label={t.runtimeHostName}
              value={getHostEdit(selectedHost).runtimeHostName}
              onChange={(value) => updateHost(selectedHost, { runtimeHostName: value })}
            />
            <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
              {t.monthlyTrafficSection}
            </p>
            <InputField
              label={t.maxTraffic}
              suffix={t.unitGb}
              type="number"
              value={String(getHostEdit(selectedHost).maxTrafficGb)}
              onChange={(value) =>
                updateHost(selectedHost, { maxTrafficGb: Math.max(Number.parseInt(value, 10) || 0, 0) })
              }
            />
            <InputField
              label={t.monthlyTraffic}
              suffix={t.unitGb}
              type="number"
              value={String(getHostEdit(selectedHost).monthlyTrafficGb)}
              onChange={(value) =>
                updateHost(selectedHost, { monthlyTrafficGb: Math.max(Number.parseInt(value, 10) || 0, 0) })
              }
            />
            <SelectField
              label={t.trafficAccountingMode}
              value={getHostEdit(selectedHost).trafficAccountingMode}
              onChange={(value) => updateHost(selectedHost, { trafficAccountingMode: value as AgentTrafficAccountingMode })}
              options={getTrafficModeOptions(t)}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SelectField
                label={t.monthlyResetDay}
                value={String(getHostEdit(selectedHost).monthlyResetDay)}
                onChange={(value) =>
                  updateHost(selectedHost, { monthlyResetDay: clampResetDay(Number.parseInt(value, 10) || 1) })
                }
                options={Array.from({ length: 31 }, (_, index) => {
                  const day = index + 1;
                  return { label: formatResetDay(day, language), value: String(day) };
                })}
              />
              <InputField
                label={t.currentUsedTraffic}
                suffix={t.unitGb}
                type="number"
                value={String(getHostEdit(selectedHost).currentUsedTrafficGb)}
                onChange={(value) =>
                  updateHost(selectedHost, { currentUsedTrafficGb: parseNonNegativeNumber(value) })
                }
              />
            </div>
            <InputField
              label={t.expiresAt}
              type="date"
              value={toDateInputValue(getHostEdit(selectedHost).expiresAt)}
              onChange={(value) => updateHost(selectedHost, { expiresAt: dateInputToIso(value) })}
            />
            <InputField
              label={t.pingTarget}
              value={getHostEdit(selectedHost).pingTarget}
              onChange={(value) => updateHost(selectedHost, { pingTarget: value })}
            />
            <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
              {t.probeSection}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoField label={t.trafficSource} value={t.telemetrySourceValue} />
              <InfoField label={t.lastReport} value={formatTelemetryTimestamp(selectedHost, language)} />
              <InfoField
                label={t.sampleStatus}
                value={
                  selectedHostHasTelemetry || selectedHost.telemetry.sampleGapDetected
                    ? formatSamplingStatus(selectedHost, language, t)
                    : t.waitingTelemetry
                }
              />
              <InfoField
                label={t.samplingInterval}
                value={formatCompactSeconds(
                  selectedHost.telemetry.expectedSamplingIntervalSeconds
                    ?? selectedHost.telemetry.sampleIntervalSeconds
                    ?? selectedHost.probeConfig.pingIntervalSeconds,
                  language
                )}
              />
              <InfoField label={t.platformLabel} value={selectedHost.platform} />
              <InfoField label={t.cpuModelLabel} value={selectedHost.hardware.cpuModel ?? '-'} />
              <InfoField label={t.kernelVersionLabel} value={selectedHost.hardware.kernelVersion ?? '-'} />
              <InfoField label={t.virtualizationLabel} value={selectedHost.hardware.virtualization ?? '-'} />
              <InfoField label={t.primaryNicLabel} value={selectedHost.hardware.primaryNetworkInterface ?? '-'} />
            </div>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
              {t.hardwareProfile}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoField
                label={language === 'zh' ? 'CPU 核数' : 'CPU Cores'}
                value={selectedHostHasTelemetry && selectedHost.telemetry.cpuCores ? String(selectedHost.telemetry.cpuCores) : '-'}
              />
              <InfoField label={t.loadAverageLabel} value={selectedHostHasTelemetry ? formatLoadAverage(selectedHost) : '-'} />
              <InfoField
                label={t.memory}
                value={
                  selectedHostHasTelemetry
                    ? `${formatTelemetryPercentValue(selectedHost, selectedHost.telemetry.memoryPercent)} · ${formatTelemetryBytesPair(selectedHost, selectedHost.telemetry.memoryUsedBytes, selectedHost.telemetry.memoryTotalBytes)}`
                    : '-'
                }
              />
              <InfoField
                label={t.disk}
                value={
                  selectedHostHasTelemetry
                    ? `${formatTelemetryPercentValue(selectedHost, clampPercent(selectedHost.telemetry.diskPercent ?? 0))} · ${formatTelemetryBytesPair(selectedHost, selectedHost.telemetry.diskUsedBytes, selectedHost.telemetry.diskTotalBytes)}`
                    : '-'
                }
              />
              <InfoField label={t.latency} value={selectedHostHasTelemetry ? `${Math.round(selectedHost.telemetry.latencyMs)} ms` : '-'} />
              <InfoField
                label={t.jitter}
                value={
                  selectedHostHasTelemetry && Number.isFinite(selectedHost.telemetry.jitterMs)
                    ? `${Math.round(selectedHost.telemetry.jitterMs ?? 0)} ms`
                    : '-'
                }
              />
              <InfoField label={t.packetLoss} value={selectedHostHasTelemetry ? formatPercent(selectedHost.telemetry.packetLossPercent) : '-'} />
              <InfoField label={t.online} value={selectedHostHasTelemetry ? `${selectedHost.telemetry.onlineDays ?? 0}${t.unitDays}` : '-'} />
              <InfoField label={t.serviceHealthLabel} value={selectedHostHasTelemetry ? formatRuntimeServiceHealth(selectedHost, t) : t.serviceWaiting} />
              <InfoField label={t.runtime} value={selectedHostHasTelemetry ? formatRuntimeServiceDetails(selectedHost, t) : '-'} />
              {hasHostGuardrailEvidence(selectedHost) ? (
                <>
                  <InfoField
                    label={t.hostGuardrailStoppedUnits}
                    value={formatHostGuardrailUnits(readHostGuardrailUnits(selectedHost).stopped)}
                  />
                  <InfoField
                    label={t.hostGuardrailRestoredUnits}
                    value={formatHostGuardrailUnits(readHostGuardrailUnits(selectedHost).restored)}
                  />
                </>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
              <GlowButton
                className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                disabled={taskMutationBusy}
                onClick={() => handleSaveHost(selectedHost)}
              >
                {t.save}
              </GlowButton>
            </div>
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        returnFocusRef={returnFocusRef}
        open={drawer.type === 'deleteHost'}
        title={t.deleteHostTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {selectedHost ? (
          <div className="space-y-4">
            <InfoField label={t.hostAlias} value={getHostEdit(selectedHost).name} />
            <div className="flex justify-end gap-3 pt-2">
              <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
              <button
                className="border border-[#DC2626]/50 bg-[#DC2626] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#FF8A8A]/35 dark:bg-[#B91C1C] dark:hover:bg-[#DC2626]"
                disabled={taskMutationBusy}
                onClick={() => handleDeleteHost(selectedHost)}
                type="button"
              >
                {t.confirmDelete}
              </button>
            </div>
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        returnFocusRef={returnFocusRef}
        open={drawer.type === 'customerLinks'}
        title={t.customerNodeLinksTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        {linkDetailsCustomerNode && customerNodeLinkMaterial ? (
          <div className="space-y-4">
            <div className="nodes-drawer-field border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
              <p className="text-sm font-bold text-[#07111F] [overflow-wrap:anywhere] dark:text-white">{linkDetailsCustomerNode.nodeName}</p>
              <p className="mt-1 text-xs font-semibold text-[#35405A] [overflow-wrap:anywhere] dark:text-white/45">
                {linkDetailsCustomerNode.customerName} · {linkDetailsCustomerNode.protocol.toUpperCase()}:{linkDetailsCustomerNode.listenPort}
              </p>
            </div>
            <CustomerNodeLinksPanel
              qrDataUrl={customerLinkQrDataUrl}
              shareLink={customerNodeLinkMaterial.shareLink}
              subscriptionLink={customerNodeLinkMaterial.subscriptionLink}
              t={t}
              onCopyShareLink={() => copyText(customerNodeLinkMaterial.shareLink)}
              onCopySubscriptionLink={() => copyText(customerNodeLinkMaterial.subscriptionLink)}
            />
          </div>
        ) : null}
      </ConfigDrawer>

      <ConfigDrawer
        returnFocusRef={returnFocusRef}
        open={drawer.type === 'customerNode'}
        title={editingCustomerNode ? t.editCustomerNode : t.addCustomerNode}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleCustomerSubmit}>
          <DrawerSection hint={t.operatorCreateHint || undefined} title={t.customerBasics}>
            <SimpleNodeWizard
              labels={{
                assignedHost: t.assignedHost,
                customerName: t.customerName,
                listenPort: t.listenPort,
                maxTraffic: t.maxTraffic,
                remainingTime: t.remainingTime,
                unitDays: t.unitDays,
                unitGb: t.unitGb
              }}
              servers={visibleAgents.map((agent) => ({
                address: agent.publicAddress,
                label: getHostEdit(agent).name,
                value: agent.id
              }))}
              value={{
                agentId: customerDraft.agentId,
                customerName: customerDraft.customerName,
                listenPort: customerDraft.listenPort,
                remainingDays: customerDraft.remainingDays,
                trafficLimitGb: customerDraft.trafficLimitGb
              }}
              onChange={(field, value) => {
                setCustomerDraft((current) => ({
                  ...current,
                  [field]: value,
                  ...(field === 'customerName' ? { nodeName: current.nodeName || value } : {})
                }));
              }}
              onServerChange={(server) =>
                setCustomerDraft((current) => ({
                  ...current,
                  agentId: server.value,
                  serverAddress: server.address || current.serverAddress
                }))
              }
            />
          </DrawerSection>
          <DrawerSection title={t.generatedResult}>
            <InfoField
              label={t.generatedProtocolMaterial}
              value={`${customerDraft.protocol.toUpperCase()} / ${customerDraft.streamNetwork} / ${customerDraft.security}`}
            />
            <InfoField label={t.generatedCredential} value={customerDraft.clientIdentity} />
            <CustomerNodeLinksPanel
              qrDataUrl={customerQrDataUrl}
              shareLink={singleNodeShareLink}
              subscriptionLink={subscriptionLink}
              t={t}
              onCopyShareLink={() => copyText(singleNodeShareLink)}
              onCopySubscriptionLink={() => copyText(subscriptionLink)}
            />
          </DrawerSection>
          <details
            className="nodes-drawer-field border border-[#07111F]/18 bg-[#FFFDF5]/72 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.025]"
            onToggle={(event) => setCustomerAdvancedOpen(event.currentTarget.open)}
            open={customerAdvancedOpen}
          >
            <summary className="cursor-pointer text-xs font-black text-[#07111F] dark:text-white">
              {t.advancedToggle}
            </summary>
            {customerAdvancedOpen ? (
            <div className="mt-3 space-y-3">
              {t.advancedHint ? (
                <p className="text-xs leading-6 text-[#35405A] dark:text-white/45">{t.advancedHint}</p>
              ) : null}
              <DrawerSection title={t.advancedProfileSection}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SelectField
                    label={t.protocolTemplate}
                    value={customerDraft.protocolTemplate}
                    onChange={applyCustomerTemplate}
                    options={CUSTOMER_TEMPLATE_OPTIONS.map((option) => ({
                      label: t.protocolTemplateOptions[option.value],
                      value: option.value
                    }))}
                  />
                  <InputField
                    label={t.customerRemark}
                    value={customerDraft.clientComment}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, clientComment: value }))}
                  />
                  <InputField
                    label={t.expiresAt}
                    type="date"
                    value={remainingDaysToDateInputValue(customerDraft.remainingDays)}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, remainingDays: dateInputToRemainingDays(value) }))}
                  />
                  <SelectField
                    label={t.monthlyResetDay}
                    value={customerDraft.monthlyResetDay}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, monthlyResetDay: value }))}
                    options={Array.from({ length: 31 }, (_, index) => {
                      const day = index + 1;
                      return { label: formatResetDay(day, language), value: String(day) };
                    })}
                  />
                </div>
              </DrawerSection>
              <DrawerSection title={t.protocolSpecificConfig}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
                  {protocolSectionTitle}
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InputField
                    label={t.customerNodeName}
                    value={customerDraft.nodeName}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, nodeName: value }))}
                  />
                  <InputField
                    label={t.serverAddress}
                    value={customerDraft.serverAddress}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, serverAddress: value }))}
                  />
                  <SelectField
                    label={t.protocol}
                    value={customerDraft.protocol}
                    onChange={(value) =>
                      setCustomerDraft((current) => ({
                        ...current,
                        protocolTemplate: current.protocolTemplate,
                        ...createProtocolDraftPatch(value as XrayProtocol, current)
                      }))
                    }
                    options={CUSTOMER_PROTOCOL_OPTIONS}
                  />
                  <InputField
                    label={t.listenPort}
                    type="number"
                    value={customerDraft.listenPort}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, listenPort: value }))}
                  />
                  <InputField
                    label={t.clientEmail}
                    value={customerDraft.clientEmail}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, clientEmail: value }))}
                  />
                  <InputField
                    label={credentialLabel}
                    value={customerDraft.protocol === 'hysteria' ? customerDraft.hysteriaAuth : customerDraft.clientCredential}
                    onChange={updateCustomerCredential}
                  />
                </div>
                {customerDraft.protocol === 'vless' ? (
                  <InputField
                    label={t.flow}
                    value={customerDraft.flow}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, flow: value }))}
                  />
                ) : null}
                {customerDraft.protocol === 'vmess' ? (
                  <SelectField
                    label={t.vmessSecurity}
                    value={customerDraft.vmessSecurity}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, vmessSecurity: value }))}
                    options={getVmessSecurityOptions(language)}
                  />
                ) : null}
                {customerDraft.protocol === 'shadowsocks' ? (
                  <InputField
                    label={t.shadowsocksMethod}
                    value={customerDraft.shadowsocksMethod}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, shadowsocksMethod: value }))}
                  />
                ) : null}
              </DrawerSection>
              <DrawerSection title={t.transportConfig}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SelectField
                    label={t.streamNetwork}
                    value={customerDraft.streamNetwork}
                    onChange={(value) =>
                      setCustomerDraft((current) => ({ ...current, streamNetwork: value as XrayStreamSettings['network'] }))
                    }
                    options={[
                      { label: 'TCP', value: 'tcp' },
                      { label: 'UDP', value: 'udp' },
                      { label: 'WebSocket', value: 'ws' },
                      { label: 'gRPC', value: 'grpc' },
                      { label: 'HTTP Upgrade', value: 'httpupgrade' },
                      { label: 'Split HTTP', value: 'splithttp' }
                    ]}
                  />
                  <SelectField
                    label={t.security}
                    value={customerDraft.security}
                    onChange={updateCustomerSecurity}
                    options={getSecurityOptions(customerDraft.protocol, language)}
                  />
                  {showSni ? (
                    <InputField
                      label={t.sni}
                      value={customerDraft.sni}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, sni: value }))}
                    />
                  ) : null}
                  {showTransportPath ? (
                    <InputField
                      label={t.path}
                      value={customerDraft.path}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, path: value }))}
                    />
                  ) : null}
                  {showTlsSettings ? (
                    <InputField
                      label={t.alpn}
                      value={customerDraft.alpn}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, alpn: value }))}
                    />
                  ) : null}
                </div>
                {showRealitySettings ? (
                  <div className="space-y-3">
                    <button
                      className="border border-[#07111F]/18 bg-[#FFFDF5]/72 px-4 py-2 text-xs font-bold text-[#35405A] transition hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/60 hover:text-[#1E3AFF] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:text-[#DCE1FF]"
                      onClick={regenerateRealityKeys}
                      type="button"
                    >
                      {t.regenerateReality}
                    </button>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <InputField
                        label={t.fingerprint}
                        value={customerDraft.fingerprint}
                        onChange={(value) => setCustomerDraft((current) => ({ ...current, fingerprint: value }))}
                      />
                      <InputField
                        label={t.realityShortId}
                        value={customerDraft.realityShortId}
                        onChange={(value) => setCustomerDraft((current) => ({ ...current, realityShortId: value }))}
                      />
                      <InputField
                        label={t.realityPublicKey}
                        value={customerDraft.realityPublicKey}
                        onChange={(value) => setCustomerDraft((current) => ({ ...current, realityPublicKey: value }))}
                      />
                      <InputField
                        label={t.realityPrivateKey}
                        value={customerDraft.realityPrivateKey}
                        onChange={(value) => setCustomerDraft((current) => ({ ...current, realityPrivateKey: value }))}
                        type="password"
                      />
                      <InputField
                        label={t.realityTarget}
                        value={customerDraft.realityTarget}
                        onChange={(value) => setCustomerDraft((current) => ({ ...current, realityTarget: value }))}
                      />
                    </div>
                  </div>
                ) : null}
                {customerDraft.protocol === 'vless' ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InputField
                      label={t.fallbackName}
                      value={customerDraft.fallbackName}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, fallbackName: value }))}
                    />
                    <InputField
                      label={t.fallbackDestination}
                      value={customerDraft.fallbackDestination}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, fallbackDestination: value }))}
                    />
                    <InputField
                      label={t.fallbackXver}
                      type="number"
                      value={customerDraft.fallbackXver}
                      onChange={(value) => setCustomerDraft((current) => ({ ...current, fallbackXver: value }))}
                    />
                  </div>
                ) : null}
                <CheckboxField
                  checked={customerDraft.sniffingEnabled}
                  label={t.sniffingEnabled}
                  onChange={(value) => setCustomerDraft((current) => ({ ...current, sniffingEnabled: value }))}
                />
              </DrawerSection>
              <DrawerSection title={t.quotaPolicy}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InputField
                    label={t.currentUsedTraffic}
                    suffix={t.unitGb}
                    type="number"
                    value={customerDraft.currentUsedTrafficGb}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, currentUsedTrafficGb: value }))}
                  />
                  <SelectField
                    label={t.trafficMultiplier}
                    value={customerDraft.trafficMultiplier}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, trafficMultiplier: value }))}
                    options={CUSTOMER_NODE_TRAFFIC_MULTIPLIERS.map((multiplier) => ({
                      label: `x${multiplier}`,
                      value: String(multiplier)
                    }))}
                  />
                  <InputField
                    label={t.ipLimit}
                    type="number"
                    value={customerDraft.ipLimit}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, ipLimit: value }))}
                  />
                  <SelectField
                    label={t.resetPolicy}
                    value={customerDraft.resetPolicy}
                    onChange={(value) =>
                      setCustomerDraft((current) => ({ ...current, resetPolicy: value as XrayClientResetPolicy }))
                    }
                    options={RESET_POLICY_OPTIONS.map((policy) => ({ label: t.resetPolicyLabels[policy], value: policy }))}
                  />
                  <InputField
                    label={t.subscriptionRule}
                    value={customerDraft.subscriptionRule}
                    onChange={(value) => setCustomerDraft((current) => ({ ...current, subscriptionRule: value }))}
                  />
                </div>
              </DrawerSection>
              <DrawerSection title={t.configPreview}>
                <code className="nodes-drawer-field block whitespace-pre-wrap break-all border border-[#07111F]/18 bg-[#EAF3D1]/62 p-3 font-mono text-[10px] leading-5 text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/70">
                  {customerArtifacts.inboundConfig}
                </code>
              </DrawerSection>
            </div>
            ) : null}
          </details>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy || visibleAgents.length === 0} type="submit">
              {t.save}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>
    </ResponsivePage>
  );
}

function WorkspaceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'nodes-workspace-tab nodes-workspace-tab-active min-h-10 border border-[#07111F] bg-[#1E3AFF] px-4 py-2 text-xs font-black text-white shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/45 active:translate-y-0 dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF] dark:text-[#07111F]'
          : 'nodes-workspace-tab min-h-10 border border-[#07111F]/25 bg-[#FFFDF5] px-4 py-2 text-xs font-black text-[#35405A] transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[#1E3AFF] hover:bg-[#DCE1FF]/70 hover:text-[#1E3AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:translate-y-0 dark:border-[#6B7CFF]/18 dark:bg-white/[0.04] dark:text-white/58 dark:hover:border-[#6B7CFF]/35 dark:hover:bg-[#6B7CFF]/12 dark:hover:text-[#DDE3FF]'
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
  icon: typeof ServerCog;
}) {
  return (
    <div className="nodes-summary-metric min-h-[76px] border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</p>
          <p className="mt-1 text-lg font-black text-[#07111F] dark:text-white">{value}</p>
        </div>
        <Icon className="h-4 w-4 text-[#1E3AFF] dark:text-[#DCE1FF]" />
      </div>
    </div>
  );
}

function OperationalEmptyState({ actionLabel, label }: { actionLabel: string; label: string }) {
  return (
    <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="text-sm font-black text-[#07111F] dark:text-white">{label}</p>
      </div>
      <div className="border border-[#1E3AFF]/35 bg-[#DCE1FF] px-3 py-2 text-xs font-black text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/12 dark:text-[#DCE1FF]">
        {actionLabel}
      </div>
    </div>
  );
}

function CustomerNodeLinksPanel({
  qrDataUrl,
  shareLink,
  subscriptionLink,
  t,
  onCopyShareLink,
  onCopySubscriptionLink
}: {
  qrDataUrl: string;
  shareLink: string;
  subscriptionLink: string;
  t: NodesCopy;
  onCopyShareLink: () => void;
  onCopySubscriptionLink: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_196px]">
      <LinkMaterialCard label={t.oneNodeLink} value={shareLink} copyLabel={t.copyLink} onCopy={onCopyShareLink} />
      <LinkMaterialCard label={t.subscriptionLink} value={subscriptionLink} copyLabel={t.copyLink} onCopy={onCopySubscriptionLink} />
      <div className="nodes-drawer-field border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
          {t.subscriptionQrCode}
        </p>
        {qrDataUrl ? (
          <img
            alt={t.subscriptionQrCode}
            className="h-44 w-44 bg-white p-2"
            src={qrDataUrl}
          />
        ) : (
          <div className="grid h-44 w-44 place-items-center bg-[#EAF3D1]/70 text-[10px] font-bold text-[#35405A]/70 dark:bg-white/5 dark:text-white/35">
            QR
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerNodeBulkImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: CustomerNodeBulkImpactSummary;
  t: NodesCopy;
}) {
  const riskPreview = summary.guardrailRisks.slice(0, 3);

  return (
    <section
      aria-label={t.customerNodeBulkImpactPreflight}
      className="border-b border-[#FF3D18]/45 bg-[#FFD8C6]/45 px-3 py-3 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#C92810] dark:text-[#FFB299]">
            {t.customerNodeBulkImpactPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.hostLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.hostLabels.length > 4 ? (
              <span className="rounded-full border border-[#FF3D18]/45 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.hostLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[28rem]">
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactCustomers}
            value={formatNumber(summary.customerLabels.length, language)}
          />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactHosts}
            value={formatNumber(summary.hostLabels.length, language)}
          />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactPorts}
            value={formatNumber(summary.portLabels.length, language)}
          />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactUsedTraffic}
            value={formatBytes(summary.usedTrafficBytes)}
          />
          <CustomerNodeBulkImpactMetric label={t.selectedCustomerNodes} value={formatNumber(selectedCount, language)} />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactGuardrailRisks}
            value={formatNumber(summary.guardrailRisks.length, language)}
          />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactExpiring}
            value={formatNumber(summary.expiringNodeCount, language)}
          />
          <CustomerNodeBulkImpactMetric
            label={t.customerNodeBulkImpactDisabled}
            value={formatNumber(summary.disabledNodeCount, language)}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <CustomerNodeBulkImpactPreview
          title={t.customerNodeBulkImpactCustomerPreview}
          values={summary.customerLabels.slice(0, 5)}
        />
        <CustomerNodeBulkImpactPreview
          title={t.customerNodeBulkImpactNodePreview}
          values={summary.nodeLabels.slice(0, 5)}
        />
        <CustomerNodeBulkImpactPreview
          title={t.customerNodeBulkImpactRiskPreview}
          values={riskPreview.length > 0 ? riskPreview : [t.customerNodeBulkImpactNoRisk]}
          warning={riskPreview.length > 0}
        />
      </div>
    </section>
  );
}

function CustomerNodeBulkImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#1E3AFF]/35 bg-[#FFFDF5]/85 px-3 py-2 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-white">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function CustomerNodeBulkImpactPreview({
  title,
  values,
  warning = false
}: {
  title: string;
  values: string[];
  warning?: boolean;
}) {
  return (
    <div className={cn(
      'min-w-0 border bg-[#FFFDF5]/72 p-3 dark:bg-white/[0.025]',
      warning ? 'border-[#FF3D18]/45 dark:border-[#FFB299]/20' : 'border-[#D9FF00]/60 dark:border-[#E9FF6A]/20'
    )}>
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-[#C92810] dark:text-[#FFB299]' : 'mt-2 space-y-1 text-[#35405A] dark:text-white/70'}>
        {values.map((value) => (
          <p className="break-words text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function LinkMaterialCard({
  copyLabel,
  label,
  value,
  onCopy
}: {
  copyLabel: string;
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="nodes-drawer-field border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
          {label}
        </p>
        <button
          className="border border-[#07111F]/18 bg-[#FFFDF5]/72 px-3 py-1 text-[10px] font-bold text-[#35405A] transition hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/60 hover:text-[#1E3AFF] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:text-[#DCE1FF]"
          onClick={onCopy}
          type="button"
        >
          {copyLabel}
        </button>
      </div>
      <code className="block break-all font-mono text-[10px] leading-5 text-[#35405A] dark:text-white/70">
        {value}
      </code>
    </div>
  );
}

type AgentReadinessState = 'ready' | 'issues' | 'waiting';
type AgentReadinessTone = 'command' | 'healthy' | 'caution' | 'waiting';

function getAgentReadinessState(agent: Agent): AgentReadinessState {
  const telemetryReported = hasTelemetryReport(agent);

  if (!telemetryReported) {
    return 'waiting';
  }

  if (
    agent.status !== 'online' ||
    agent.telemetry.sampleGapDetected === true ||
    runtimeServiceIssueCount(agent) > 0
  ) {
    return 'issues';
  }

  return 'ready';
}

function SelectedAgentReadiness({
  agent,
  t
}: {
  agent: Agent;
  t: NodesCopy;
}) {
  const telemetryReported = hasTelemetryReport(agent);
  const sampleGapDetected = agent.telemetry.sampleGapDetected ?? false;
  const serviceIssueCount = runtimeServiceIssueCount(agent);
  const readinessState = getAgentReadinessState(agent);
  const telemetryValue = !telemetryReported ? t.serviceWaiting : sampleGapDetected ? t.sampleGap : t.sampleHealthy;
  const runtimeValue =
    !telemetryReported ? t.serviceWaiting : serviceIssueCount > 0 ? formatRuntimeServiceHealth(agent, t) : t.serviceHealthy;

  return (
    <section
      aria-label={t.agentReadinessTitle}
      className={cn(
        'mt-4 border border-[#07111F]/80 bg-[#FFFDF5] p-3 text-[#07111F] transition duration-200 motion-safe:animate-[ou-panel-in_180ms_ease-out] dark:border-[#6B7CFF]/25 dark:bg-[#101827] dark:text-white',
        readinessState === 'issues'
          ? 'shadow-[inset_0_3px_0_#D9FF00]'
          : readinessState === 'ready'
            ? 'shadow-[inset_0_3px_0_#00A878]'
            : 'shadow-[inset_0_3px_0_#1E3AFF]'
      )}
      data-agent-readiness-state={readinessState}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-black text-[#07111F] dark:text-white">{t.agentReadinessTitle}</p>
        <span
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-black',
            readinessState === 'issues'
              ? 'border-[#D9FF00] bg-[#D9FF00]/[0.24] text-[#07111F] dark:border-[#E9FF6A]/25 dark:bg-[#E9FF6A]/10 dark:text-[#F4FFC5]'
              : readinessState === 'ready'
                ? 'border-[#00A878] bg-[#00A878]/10 text-[#007D5E] dark:border-[#35E68E]/35 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]'
                : 'border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-[#6B7CFF]/12 dark:text-[#DCE1FF]'
          )}
        >
          {readinessState === 'issues'
            ? t.agentReadinessIssues
            : readinessState === 'ready'
              ? t.agentReadinessReady
              : t.agentReadinessWaiting}
        </span>
      </div>
      <div className="nodes-agent-readiness-grid mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
        <AgentReadinessGate
          icon={Network}
          label={t.agentReadinessAgentLink}
          tone={agent.status === 'online' ? 'command' : 'caution'}
          value={t.statusLabels[agent.status]}
        />
        <AgentReadinessGate
          icon={Activity}
          label={t.agentReadinessTelemetry}
          tone={!telemetryReported ? 'waiting' : sampleGapDetected ? 'caution' : 'healthy'}
          value={telemetryValue}
        />
        <AgentReadinessGate
          icon={ServerCog}
          label={t.agentReadinessRuntimeServices}
          tone={!telemetryReported ? 'waiting' : serviceIssueCount > 0 ? 'caution' : 'healthy'}
          value={runtimeValue}
        />
      </div>
    </section>
  );
}

function AgentReadinessGate({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof Activity;
  label: string;
  tone: AgentReadinessTone;
  value: string;
}) {
  const toneClass =
    tone === 'command'
      ? 'border-[#1E3AFF]/55 bg-[#DCE1FF]/70 text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/12 dark:text-[#DCE1FF]'
      : tone === 'healthy'
        ? 'border-[#00A878]/45 bg-[#00A878]/10 text-[#007D5E] dark:border-[#35E68E]/30 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]'
        : tone === 'caution'
          ? 'border-[#D9FF00] bg-[#D9FF00]/[0.22] text-[#07111F] dark:border-[#E9FF6A]/25 dark:bg-[#E9FF6A]/10 dark:text-[#F4FFC5]'
          : 'border-[#07111F]/25 bg-[#EAF3D1] text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.04] dark:text-white/55';

  return (
    <div className={cn('min-w-0 border p-3 transition duration-200 motion-safe:hover:-translate-y-0.5', toneClass)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <p className="min-w-0 text-[10px] font-black uppercase leading-4 tracking-[0.08em] [overflow-wrap:anywhere]">{label}</p>
      </div>
      <p className="mt-2 text-sm font-black leading-5 [overflow-wrap:anywhere]" title={value}>
        {value}
      </p>
    </div>
  );
}

function ManagedHostCard({
  agent,
  hostEdit,
  language,
  onCopyUpgradeCommand,
  onDelete,
  onDeploy,
  onEdit,
  onRemoteUpgrade,
  t,
  remoteUpgradeBusy,
  upgradeBusy,
  upgradeCommand,
  upgradeError
}: {
  agent: Agent;
  hostEdit: HostEdit;
  language: AppLanguage;
  onCopyUpgradeCommand: () => void;
  onDelete: () => void;
  onDeploy: () => void;
  onEdit: () => void;
  onRemoteUpgrade?: () => void;
  t: NodesCopy;
  remoteUpgradeBusy: boolean;
  upgradeBusy: boolean;
  upgradeCommand?: AgentUpgradeCommand;
  upgradeError: boolean;
}) {
  const monthlyLimitBytes = bytesFromGb(hostEdit.monthlyTrafficGb);
  const monthlyUsedBytes = getMonthlyUsedBytes(agent, hostEdit);
  const monthlyPercent = monthlyLimitBytes > 0 ? clampPercent((monthlyUsedBytes / monthlyLimitBytes) * 100) : 0;
  const diskPercent = clampPercent(agent.telemetry.diskPercent ?? 0);
  const telemetryReported = hasTelemetryReport(agent);
  const latencySamples = normalizeSamples(agent.telemetry.latencySamplesMs, agent.telemetry.latencyMs);
  const latencyToneForHost = (latencyMs: number) =>
    latencyToneClass(latencyMs, agent.probeConfig, agent.telemetry.latencyStatus);
  const jitterMs = agent.telemetry.jitterMs;
  const jitterSamples = normalizeSamples(agent.telemetry.jitterSamplesMs ?? [], jitterMs ?? 0);
  const packetLossPercent = agent.telemetry.packetLossPercent ?? 0;
  const packetLossSamples = normalizeSamples(agent.telemetry.packetLossSamplesPercent, packetLossPercent);
  const monthlyDetail = `${t.trafficModeCardLabels[hostEdit.trafficAccountingMode]} · ${formatResetDayCompact(hostEdit.monthlyResetDay, language)}`;
  const sampleGapDetected = agent.telemetry.sampleGapDetected ?? false;
  const shouldOfferRecovery = !telemetryReported || sampleGapDetected;
  const canRemoteUpgrade = agent.capabilities.includes('self-update') && Boolean(onRemoteUpgrade);
  const sampleStatus =
    telemetryReported || sampleGapDetected ? formatSamplingStatus(agent, language, t) : t.waitingTelemetry;
  const SampleStatusIcon = sampleGapDetected ? AlertTriangle : Activity;
  const serviceIssueCount = runtimeServiceIssueCount(agent);
  const ServiceHealthIcon = !telemetryReported ? Activity : serviceIssueCount > 0 ? AlertTriangle : CheckCircle2;
  const serviceHealthSummary = telemetryReported ? formatRuntimeServiceHealth(agent, t) : t.serviceWaiting;
  const statusTone =
    agent.status === 'online'
      ? 'bg-[#00A878] shadow-[0_0_10px_rgba(0,168,120,0.62)]'
      : agent.status === 'degraded'
        ? 'bg-[#D9FF00] shadow-[0_0_10px_rgba(217,255,0,0.62)]'
        : agent.status === 'provisioning'
          ? 'bg-[#1E3AFF] shadow-[0_0_10px_rgba(30,58,255,0.52)]'
          : 'bg-[#DC2626] shadow-[0_0_10px_rgba(220,38,38,0.68)]';
  const addressFamily = agent.publicAddress.includes(':') ? 'IPv6' : 'IPv4';
  const modeBadge = agent.connectionMode.slice(0, 1).toUpperCase();

  return (
    <article
      className="nodes-managed-host-card island-card group flex w-full cursor-pointer flex-col gap-3 p-3 text-[#35405A] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#1E3AFF] hover:shadow-[0_14px_34px_-28px_rgba(30,58,255,0.28)] dark:text-white/75 dark:hover:border-[#6B7CFF]/25 dark:hover:shadow-[0_16px_42px_-32px_rgba(30,58,255,0.4)]"
      onClick={onEdit}
    >
      <div className="flex items-center justify-between border-b border-[#07111F]/14 pb-2.5 dark:border-[#6B7CFF]/18">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center border border-[#1E3AFF]/35 bg-[#DCE1FF] text-[#1E3AFF] transition-colors group-hover:border-[#1E3AFF] group-hover:text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10 dark:text-[#9EACFF] dark:group-hover:border-[#6B7CFF]/35 dark:group-hover:text-[#DCE1FF]">
            <Globe2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <h3 className="max-w-[12rem] truncate text-sm font-semibold tracking-normal text-[#07111F] dark:text-white">{hostEdit.name}</h3>
          <span className="flex-shrink-0 rounded border border-[#1E3AFF]/35 bg-[#DCE1FF] px-1.5 py-0.5 font-mono text-[10px] text-[#1E3AFF] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10 dark:text-[#9EACFF]">
            {addressFamily}
          </span>
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-[#07111F]/18 bg-[#FFFDF5] text-[10px] font-bold text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.04] dark:text-white/65">
            {modeBadge}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/56 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:border-[#6B7CFF]/18 dark:bg-white/[0.04] dark:text-white/65">
            {t.statusLabels[agent.status]}
          </span>
          <span className={cn('h-2 w-2 rounded-full', statusTone)} title={t.statusLabels[agent.status]} />
          <button
            aria-label={t.deployHostConfig}
            className="text-[#35405A]/70 transition-colors hover:text-[#1E3AFF] dark:text-white/35 dark:hover:text-[#9EACFF]"
            onClick={(event) => {
              event.stopPropagation();
              onDeploy();
            }}
            type="button"
          >
            <Send className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            aria-label={t.editHost}
            className="text-[#35405A]/70 transition-colors hover:text-[#07111F] dark:text-white/35 dark:hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            type="button"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            aria-label={t.deleteHost}
            className="text-[#35405A]/62 transition-colors hover:text-[#B91C1C] dark:text-white/30 dark:hover:text-[#FFB4B4]"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            type="button"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#35405A] dark:text-white/45">
        <span className="font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{t.runtimeHostName}</span>
        <span className="break-all font-mono text-[#35405A] dark:text-white/70">{hostEdit.runtimeHostName}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 border border-[#07111F]/14 bg-[#EAF3D1]/48 p-2 text-[10px] dark:border-[#6B7CFF]/18 dark:bg-white/[0.03]">
        <div className="min-w-0">
          <p className="font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{t.lastReport}</p>
          <p className="mt-1 truncate font-mono text-[#35405A] dark:text-white/70">{formatTelemetryTimestamp(agent, language)}</p>
        </div>
        <div className="min-w-0">
          <p className="font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{t.loadAverageLabel}</p>
          <p className="mt-1 truncate font-mono text-[#35405A] dark:text-white/70">{telemetryReported ? formatLoadAverage(agent) : '-'}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <RuntimeServiceBadge
          label={t.agentServiceLabel}
          service={findRuntimeService(agent, 'agent')}
          telemetryReported={telemetryReported}
          t={t}
        />
        <RuntimeServiceBadge
          label={t.xrayServiceLabel}
          service={findRuntimeService(agent, 'xray')}
          telemetryReported={telemetryReported}
          t={t}
        />
        <RuntimeServiceBadge
          label={t.forwardingServiceLabel}
          service={findRuntimeService(agent, 'port-forwarding')}
          telemetryReported={telemetryReported}
          t={t}
        />
      </div>

      {agent.status === 'provisioning' ? (
        <div className="border border-[#1E3AFF]/35 bg-[#DCE1FF]/70 p-2.5 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#35405A] dark:text-white/50">
            <span className="font-bold uppercase tracking-[0.14em] text-[#1E3AFF] dark:text-[#9EACFF]">{t.versionLabel}</span>
            <span className="font-mono text-[#07111F] dark:text-white/85">{agent.version}</span>
            <span className="text-[#1E3AFF]/35 dark:text-[#9EACFF]/35">/</span>
            <span className="font-bold uppercase tracking-[0.14em] text-[#1E3AFF] dark:text-[#9EACFF]">{t.platformLabel}</span>
            <span className="font-mono text-[#07111F] dark:text-white/85">{agent.platform}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#35405A] dark:text-white/50">
            <span className="font-bold uppercase tracking-[0.14em] text-[#1E3AFF] dark:text-[#9EACFF]">{t.capabilitiesLabel}</span>
            {agent.capabilities.map((capability) => (
              <span
                key={capability}
                className="rounded-full border border-[#1E3AFF]/35 bg-[#FFFDF5] px-2 py-0.5 font-mono text-[10px] text-[#1E3AFF] dark:border-[#6B7CFF]/20 dark:bg-white/[0.05] dark:text-[#DCE1FF]"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {telemetryReported ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <HostMetric
              detail={`${agent.telemetry.cpuCores ?? 1}${t.cpuCores}`}
              icon={Cpu}
              label="CPU"
              percent={agent.telemetry.cpuPercent}
              tone="from-[#1E3AFF] to-[#6B7CFF] shadow-[0_0_8px_rgba(30,58,255,0.34)]"
              value={formatPercent(agent.telemetry.cpuPercent)}
            />
            <HostMetric
              detail={
                agent.telemetry.memoryUsedBytes && agent.telemetry.memoryTotalBytes
                  ? `${formatBytes(agent.telemetry.memoryUsedBytes)} / ${formatBytes(agent.telemetry.memoryTotalBytes)}`
                  : formatPercent(agent.telemetry.memoryPercent)
              }
              icon={MemoryStick}
              label={t.memory}
              percent={agent.telemetry.memoryPercent}
              tone="from-[#1E3AFF] to-[#00A878] shadow-[0_0_8px_rgba(30,58,255,0.28)]"
              value={formatPercent(agent.telemetry.memoryPercent)}
            />
            <HostMetric
              detail={
                agent.telemetry.diskUsedBytes && agent.telemetry.diskTotalBytes
                  ? `${formatBytes(agent.telemetry.diskUsedBytes)} / ${formatBytes(agent.telemetry.diskTotalBytes)}`
                  : formatPercent(diskPercent)
              }
              icon={HardDrive}
              label={t.disk}
              percent={diskPercent}
              tone="from-[#00A878] to-[#D9FF00] shadow-[0_0_8px_rgba(0,168,120,0.34)]"
              value={formatPercent(diskPercent)}
            />
            <HostMetric
              detail={monthlyDetail}
              icon={PieChart}
              label={t.monthly}
              percent={monthlyPercent}
              tone="from-[#1E3AFF] to-[#FF3D18] shadow-[0_0_8px_rgba(255,61,24,0.28)]"
              value={`${formatBytes(monthlyUsedBytes)} / ${hostEdit.monthlyTrafficGb}${t.unitGb}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 border-y border-[#07111F]/14 py-3 dark:border-[#6B7CFF]/18">
            <TrafficMetric
              icon={Download}
              label={t.download}
              tone="text-[#00A878]"
              total={formatBytes(agent.telemetry.downloadTotalBytes ?? agent.telemetry.rxBytes)}
              value={formatRate(agent.telemetry.downloadSpeedBps)}
            />
            <TrafficMetric
              icon={Upload}
              label={t.upload}
              tone="text-[#1E3AFF]"
              total={formatBytes(agent.telemetry.uploadTotalBytes ?? agent.telemetry.txBytes)}
              value={formatRate(agent.telemetry.uploadSpeedBps)}
            />
          </div>

          <div className={cn('grid gap-x-4', Number.isFinite(jitterMs) ? 'grid-cols-3' : 'grid-cols-2')}>
            <SegmentMetric
              label={t.latency}
              icon={Network}
              samples={latencySamples}
              toneForValue={latencyToneForHost}
              value={`${agent.telemetry.latencyMs} ms`}
            />
            {Number.isFinite(jitterMs) ? (
              <SegmentMetric
                label={t.jitter}
                icon={Activity}
                samples={jitterSamples}
                toneForValue={latencyToneForHost}
                value={`${Math.round(jitterMs ?? 0)} ms`}
              />
            ) : null}
            <SegmentMetric
              label={t.packetLoss}
              icon={Cloud}
              samples={packetLossSamples}
              toneForValue={lossToneClass}
              value={`${packetLossPercent.toFixed(1)} %`}
            />
          </div>
        </>
      ) : (
        <div className="border border-[#D9FF00] bg-[#D9FF00]/[0.16] p-3 text-xs font-semibold text-[#07111F] dark:border-[#E9FF6A]/25 dark:bg-[#E9FF6A]/10 dark:text-[#F4FFC5]">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" strokeWidth={1.5} />
            {sampleGapDetected ? formatSamplingStatus(agent, language, t) : t.waitingTelemetry}
          </div>
        </div>
      )}

      {shouldOfferRecovery ? (
        <div
          className="space-y-2 border-t border-[#D9FF00]/55 pt-3 dark:border-[#E9FF6A]/20"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#07111F] dark:text-[#F4FFC5]">
                {t.agentRecoveryTitle}
              </p>
            </div>
            {canRemoteUpgrade ? (
              <button
                aria-label={t.remoteUpgradeAgent}
                className="inline-flex flex-shrink-0 items-center gap-1.5 border border-[#1E3AFF]/35 bg-[#DCE1FF] px-2.5 py-1.5 text-[10px] font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF]/75 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/10 dark:text-[#DCE1FF] dark:hover:bg-[#6B7CFF]/15"
                disabled={remoteUpgradeBusy}
                onClick={() => onRemoteUpgrade?.()}
                type="button"
              >
                <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                {remoteUpgradeBusy ? t.submitting : t.remoteUpgradeAgent}
              </button>
            ) : (
              <button
                aria-label={t.copyUpgradeCommand}
                className="inline-flex flex-shrink-0 items-center gap-1.5 border border-[#D9FF00] bg-[#D9FF00]/[0.18] px-2.5 py-1.5 text-[10px] font-bold text-[#07111F] transition hover:bg-[#D9FF00]/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#E9FF6A]/25 dark:bg-[#E9FF6A]/10 dark:text-[#F4FFC5] dark:hover:bg-[#E9FF6A]/15"
                disabled={upgradeBusy}
                onClick={() => onCopyUpgradeCommand()}
                type="button"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                {upgradeBusy ? t.submitting : t.copyUpgradeCommand}
              </button>
            )}
          </div>
          {upgradeError ? <p className="text-[11px] font-semibold text-[#B91C1C] dark:text-[#FFB4B4]">{t.upgradeCommandError}</p> : null}
          {upgradeCommand ? (
            <>
              <p className="text-[11px] font-semibold text-[#007D5E] dark:text-[#9EF4C4]">{t.upgradeCommandCopied}</p>
              <code className="block max-h-20 overflow-auto break-all border-l border-[#D9FF00] pl-2 font-mono text-[10px] leading-5 text-[#35405A] dark:border-[#E9FF6A]/20 dark:text-white/65">
                {upgradeCommand.command}
              </code>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-[#07111F]/16 pt-3 text-[11px] dark:border-[#6B7CFF]/18">
        <div className="flex items-center gap-1.5 text-[#35405A] dark:text-white/45">
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.expiry}
          <span className="ml-1 font-semibold text-[#C92810] dark:text-[#FFB299]">
            {remainingDaysUntil(hostEdit.expiresAt)}
            {t.unitDays}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[#35405A] dark:text-white/45">
          <SampleStatusIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.sampleStatus}
          <span
            className={cn(
              'ml-1 max-w-[5rem] truncate font-semibold',
              !telemetryReported ? 'text-[#35405A] dark:text-white/45' : sampleGapDetected ? 'text-[#07111F] dark:text-[#F4FFC5]' : 'text-[#007D5E] dark:text-[#9EF4C4]'
            )}
          >
            {sampleStatus}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[#35405A] dark:text-white/45">
          <ServiceHealthIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.serviceHealthLabel}
          <span
            className={cn(
              'ml-1 max-w-[6rem] truncate font-semibold',
              !telemetryReported ? 'text-[#35405A] dark:text-white/45' : serviceIssueCount > 0 ? 'text-[#07111F] dark:text-[#F4FFC5]' : 'text-[#007D5E] dark:text-[#9EF4C4]'
            )}
          >
            {serviceHealthSummary}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[#35405A] dark:text-white/45">
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.online}
          <span className="ml-1 font-semibold text-[#1E3AFF] dark:text-[#DCE1FF]">
            {telemetryReported ? `${agent.telemetry.onlineDays ?? 0}${t.unitDays}` : '-'}
          </span>
        </div>
      </div>
    </article>
  );
}

function normalizeSamples(samples: number[] | undefined, fallback: number) {
  const next = (samples && samples.length > 0 ? samples : [fallback]).slice(-10);

  while (next.length < 10) {
    next.unshift(fallback);
  }

  return next;
}

function HostMetric({
  detail,
  label,
  percent,
  tone,
  value,
  icon: Icon
}: {
  detail: string;
  label: string;
  percent: number;
  tone: string;
  value: string;
  icon: typeof Cpu;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-[#35405A] dark:text-white/50">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          {label}
        </span>
        <span className="font-mono font-semibold tabular-nums text-[#07111F] dark:text-white/90">{value}</span>
      </div>
      <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-[#07111F]/14 shadow-inner dark:bg-black/45">
        <div className={cn('h-full rounded-full bg-gradient-to-r', tone)} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
      <div className="break-words text-right font-mono text-[10px] text-[#35405A] dark:text-white/35">{detail}</div>
    </div>
  );
}

function TrafficMetric({
  icon: Icon,
  label,
  tone,
  total,
  value
}: {
  icon: typeof Download;
  label: string;
  tone: string;
  total: string;
  value: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-end justify-between">
        <Icon className={cn('h-4 w-4', tone)} />
        <p className={cn('font-mono text-sm font-bold tabular-nums', tone)}>
          {value.split(' ')[0]} <span className="font-sans text-[10px] opacity-70">{value.split(' ').slice(1).join(' ')}</span>
        </p>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[#35405A] dark:text-white/35">
        <Cloud className="h-3 w-3" strokeWidth={1.5} />
        <span className="font-mono" aria-label={label}>
          {total}
        </span>
      </div>
    </div>
  );
}

function SegmentMetric({
  icon: Icon,
  label,
  samples,
  toneForValue,
  value
}: {
  icon: typeof Network;
  label: string;
  samples: number[];
  toneForValue: (value: number) => string;
  value: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#35405A] dark:text-white/50">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3" strokeWidth={1.5} />
          {label}
        </span>
        <span className="font-mono font-bold text-[#07111F] dark:text-white/90">{value}</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full items-center justify-between gap-[2px]">
        {samples.map((sample, index) => (
          <div key={`${sample}-${index}`} className={cn('h-full flex-1 rounded-[2px] opacity-80', toneForValue(sample))} />
        ))}
      </div>
    </div>
  );
}

function RuntimeServiceBadge({
  label,
  service,
  telemetryReported,
  t
}: {
  label: string;
  service?: NonNullable<Agent['telemetry']['runtimeServices']>[number];
  telemetryReported: boolean;
  t: NodesCopy;
}) {
  const status = telemetryReported ? service?.status ?? 'unknown' : 'waiting';
  const statusLabel = status === 'waiting' ? t.serviceWaiting : formatRuntimeServiceStatusLabel(status, t);

  return (
    <div className={cn('min-w-0 border px-2 py-1.5', runtimeServiceBadgeTone(status))}>
      <p className="truncate text-[10px] font-bold uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-0.5 truncate text-[10px] font-semibold">{statusLabel}</p>
    </div>
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
  type?: 'date' | 'number' | 'password' | 'text';
  value: string;
}) {
  return (
    <label className="nodes-drawer-field block border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          autoComplete={type === 'password' ? 'off' : undefined}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/65 [overflow-wrap:anywhere] dark:text-white dark:placeholder:text-white/35"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-[#35405A]/72 dark:text-white/42">{suffix}</span> : null}
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
    <label className="nodes-drawer-field block border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</span>
      <select
        aria-label={label}
        className="ou-select mt-2 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
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

function CheckboxField({
  checked,
  hint,
  label,
  onChange
}: {
  checked: boolean;
  hint?: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="nodes-drawer-field flex cursor-pointer items-start gap-3 border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <input
        checked={checked}
        className="mt-0.5 h-4 w-4 border-[#07111F]/35 text-[#1E3AFF] focus:ring-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-white/5 dark:text-[#DCE1FF]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">
          {label}
        </span>
        {hint ? <span className="mt-1 block text-xs leading-5 text-[#35405A] dark:text-white/45">{hint}</span> : null}
      </span>
    </label>
  );
}

function DrawerSection({
  children,
  hint,
  title
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <section className="space-y-3 border-t border-[#07111F]/14 pt-4 first:border-t-0 first:pt-0 dark:border-[#6B7CFF]/18">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{title}</h4>
        {hint ? <p className="mt-1 text-xs leading-6 text-[#35405A] dark:text-white/45">{hint}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="nodes-drawer-field border border-[#07111F]/18 bg-[#FFFDF5]/76 p-3 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</p>
      <p className="mt-1 break-words font-semibold text-[#35405A] dark:text-white/70">{value}</p>
    </div>
  );
}

function CompactInfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="nodes-compact-info-field min-h-[58px] border border-[#07111F]/18 bg-[#FFFDF5]/74 px-3 py-2 dark:border-[#6B7CFF]/18 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase leading-4 tracking-[0.08em] text-[#35405A] dark:text-white/42">{label}</p>
      <p className="mt-1 break-words text-xs font-black leading-5 text-[#07111F] dark:text-white/78">{value}</p>
    </div>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="border border-[#07111F]/18 bg-[#FFFDF5]/72 px-4 py-2 text-xs font-bold text-[#35405A] transition hover:border-[#1E3AFF]/55 hover:bg-[#DCE1FF]/60 hover:text-[#1E3AFF] dark:border-[#6B7CFF]/18 dark:bg-white/[0.035] dark:text-white/60 dark:hover:text-[#DCE1FF]"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="nodes-empty-state p-3 text-center text-sm font-semibold text-[#35405A] dark:text-white/50">
      {label}
    </div>
  );
}
