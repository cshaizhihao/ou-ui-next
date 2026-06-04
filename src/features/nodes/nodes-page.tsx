import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarDays,
  CheckCircle2,
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
  Send,
  ServerCog,
  Terminal,
  Trash2,
  Upload,
  UserRound
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlowButton } from '../../components/ui/glow-button';
import {
  AGENT_TRAFFIC_ACCOUNTING_MODES,
  AGENT_INSTALL_PROFILE,
  type Agent,
  type AgentInstallCommand,
  type AgentInstallMetadata,
  type AgentTrafficAccountingMode,
  type XrayClientResetPolicy,
  type XrayInbound,
  type XrayProtocol,
  type XrayStreamSettings
} from '../../domain';
import { cn } from '../../lib/cn';
import { formatBytes, formatDateTime, formatPercent } from '../shared/format';

type NodesPageProps = {
  agents: Agent[];
  inbounds: XrayInbound[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onDeployHostConfig: (agent: Agent) => void;
  onDeleteHost: (metadata: HostConfigMetadata) => void;
  onDeleteCustomerNode: (metadata: CustomerNodeConfigMetadata) => void;
  onPreviewAgentInstallCommand: (metadata: AgentInstallMetadata) => Promise<AgentInstallCommand>;
  onSaveHostConfig: (metadata: HostConfigMetadata) => void;
  onSaveCustomerNode: (metadata: CustomerNodeConfigMetadata, action: 'create' | 'update') => void;
};

export type HostConfigMetadata = {
  agentId: string;
  hostName: string;
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
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: number;
  sniffingEnabled: boolean;
  ipLimit: number;
  trafficLimitGb: number;
  remainingDays: number;
  subscriptionRule: string;
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
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: number;
  sniffingEnabled: boolean;
  ipLimit: number;
  trafficLimitGb: number;
  remainingDays: number;
  subscriptionRule: string;
};

type CustomerDraft = {
  agentId: string;
  nodeName: string;
  customerName: string;
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
  realityShortId: string;
  fallbackName: string;
  fallbackDestination: string;
  fallbackXver: string;
  sniffingEnabled: boolean;
  ipLimit: string;
  trafficLimitGb: string;
  remainingDays: string;
  subscriptionRule: string;
};

type DrawerState =
  | { type: 'closed' }
  | { type: 'install' }
  | { type: 'editHost'; agentId: string }
  | { type: 'deleteHost'; agentId: string }
  | { type: 'customerNode'; nodeId?: string };

type Workspace = 'hosts' | 'customerNodes';

const copy = {
  zh: {
    title: '受控主机',
    subtitle: '主控端可纳管任意数量服务器。受控主机只负责服务器接入、运行时上报和命令通道；客户节点、客户归属、流量额度和订阅规则在独立工作区维护。',
    hostsTab: '受控主机',
    customerNodesTab: '客户节点',
    installTitle: '主机代理一键安装',
    installDescription: '安装命令只负责把服务器接入主控端，并初始化主机代理、协议运行时、转发执行器、遥测上报与命令通道。',
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
    hostTableTitle: '已纳管主机',
    hostAlias: '主机别名',
    endpoint: '接入端点',
    traffic: '流量额度',
    telemetry: '遥测',
    runtime: '运行时',
    actions: '操作',
    deployHostConfig: '下发主机配置',
    editHost: '编辑主机',
    deleteHost: '移除主机',
    deleteHostTitle: '移除受控主机',
    deleteHostDescription: '移除后该主机下的客户节点绑定会一并移除。实际生产环境中这里应触发可审计的停用/删除任务。',
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
    currentUsedTrafficHint: '可用于补录历史用量或修正 Agent 初次接管前的统计。',
    trafficSource: '流量统计来源',
    telemetrySourceValue: 'Agent 实时回传（以回传值为准）',
    hardwareProfile: '设备探测',
    monthlyTrafficSection: '月度流量策略',
    probeSection: '节点监测与遥测',
    platformLabel: '平台',
    cpuModelLabel: 'CPU 型号',
    kernelVersionLabel: '内核版本',
    virtualizationLabel: '虚拟化',
    primaryNicLabel: '主网卡',
    lastReport: '最近上报',
    expiresAt: '到期时间',
    pingTarget: '延迟监测目标',
    pingInterval: 'Ping 间隔',
    pingIntervalHint: '后台每 30 秒监测一次，延迟 1-100 绿 / 101-200 黄 / 200+ 红',
    cpuCores: '核',
    memory: '内存',
    disk: '磁盘',
    monthly: '月度',
    download: '下载',
    upload: '上传',
    latency: '延迟',
    packetLoss: '丢包率',
    expiry: '到期',
    online: '在线',
    customerNodesTitle: '客户节点配置',
    customerNodesHint: '一个受控主机可以承载多个客户节点。每个客户节点都要生成有效的协议入站和 client 配置，避免把客户业务写死在主机接入命令中。',
    addCustomerNode: '新增客户节点',
    editCustomerNode: '编辑客户节点',
    deleteCustomerNode: '删除客户节点',
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
    clientEmail: '客户 Email',
    clientCredential: '协议凭证',
    vmessSecurity: 'VMess 加密',
    shadowsocksMethod: 'Shadowsocks 方法',
    hysteriaAuth: 'Hysteria2 Auth',
    clientLevel: '客户等级',
    clientComment: '备注',
    telegramId: 'Telegram ID',
    resetPolicy: '流量重置策略',
    streamNetwork: '传输层',
    security: '安全层',
    sni: 'SNI / Host',
    path: '路径 / 服务名',
    flow: 'Flow',
    fingerprint: 'Fingerprint',
    alpn: 'ALPN',
    realityPublicKey: 'Reality Public Key',
    realityShortId: 'Reality Short ID',
    fallbackName: 'Fallback 名称',
    fallbackDestination: 'Fallback 目标',
    fallbackXver: 'Fallback Xver',
    sniffingEnabled: '启用 Sniffing',
    ipLimit: 'IP 限制',
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
    subtitle: 'Master can manage any number of servers. Managed hosts handle server enrollment, runtime telemetry, and command transport; customer nodes, quota, ownership, and subscription rules live in a separate workspace.',
    hostsTab: 'Managed Hosts',
    customerNodesTab: 'Customer Nodes',
    installTitle: 'Host Agent One-Click Install',
    installDescription: 'The command only enrolls a server into Master and initializes the host agent, protocol runtime, forwarding executor, telemetry, and command transport.',
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
    hostTableTitle: 'Managed Hosts',
    hostAlias: 'Host Alias',
    endpoint: 'Endpoint',
    traffic: 'Traffic Cap',
    telemetry: 'Telemetry',
    runtime: 'Runtime',
    actions: 'Actions',
    deployHostConfig: 'Deploy Host Config',
    editHost: 'Edit Host',
    deleteHost: 'Remove Host',
    deleteHostTitle: 'Remove Managed Host',
    deleteHostDescription: 'Removing this host also removes customer-node bindings under it. In production this should become an auditable disable/delete task.',
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
    currentUsedTrafficHint: 'Use this to backfill history or correct the first Agent takeover.',
    trafficSource: 'Traffic Source',
    telemetrySourceValue: 'Agent live telemetry (source of truth)',
    hardwareProfile: 'Hardware Detection',
    monthlyTrafficSection: 'Monthly Traffic Policy',
    probeSection: 'Node Monitoring & Telemetry',
    platformLabel: 'Platform',
    cpuModelLabel: 'CPU Model',
    kernelVersionLabel: 'Kernel Version',
    virtualizationLabel: 'Virtualization',
    primaryNicLabel: 'Primary NIC',
    lastReport: 'Last Report',
    expiresAt: 'Expires At',
    pingTarget: 'Latency Monitor Target',
    pingInterval: 'Ping Interval',
    pingIntervalHint: 'Runs every 30 seconds; latency bands are 1-100 green / 101-200 yellow / 200+ red',
    cpuCores: 'cores',
    memory: 'Memory',
    disk: 'Disk',
    monthly: 'Monthly',
    download: 'Download',
    upload: 'Upload',
    latency: 'Latency',
    packetLoss: 'Packet Loss',
    expiry: 'Expires',
    online: 'Online',
    customerNodesTitle: 'Customer Node Config',
    customerNodesHint: 'A single managed host can serve multiple customer nodes. Each customer node generates a real protocol inbound and client config instead of being hard-coded into the host enrollment command.',
    addCustomerNode: 'Add Customer Node',
    editCustomerNode: 'Edit Customer Node',
    deleteCustomerNode: 'Delete Customer Node',
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
    realityShortId: 'Reality Short ID',
    fallbackName: 'Fallback Name',
    fallbackDestination: 'Fallback Target',
    fallbackXver: 'Fallback Xver',
    sniffingEnabled: 'Enable Sniffing',
    ipLimit: 'IP Limit',
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

function createCustomerDraft(agent?: Agent): CustomerDraft {
  const defaultIdentity = createClientIdentity('vless');

  return {
    agentId: agent?.id ?? '',
    nodeName: '',
    customerName: '',
    serverAddress: agent?.publicAddress ?? '',
    protocol: 'vless',
    listenPort: '443',
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
    sni: '',
    path: '',
    flow: '',
    fingerprint: 'chrome',
    alpn: 'h2,http/1.1',
    realityPublicKey: '',
    realityShortId: createRealityShortId(),
    fallbackName: '',
    fallbackDestination: '',
    fallbackXver: '0',
    sniffingEnabled: true,
    ipLimit: '',
    trafficLimitGb: '',
    remainingDays: '',
    subscriptionRule: ''
  };
}

function createProtocolDraftPatch(protocol: XrayProtocol, current: CustomerDraft): Partial<CustomerDraft> {
  const nextIdentity = createClientIdentity(protocol);
  const currentEmail = current.clientEmail.trim();
  const currentFingerprint = current.fingerprint.trim();
  const currentRealityKey = current.realityPublicKey.trim();
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

  return {
    protocol,
    listenPort:
      protocol === 'shadowsocks'
        ? '8388'
        : protocol === 'vless' || protocol === 'vmess' || protocol === 'trojan' || protocol === 'hysteria'
          ? '443'
          : current.listenPort,
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
    sni: protocol === 'shadowsocks' ? '' : current.sni.trim() || extractHostLabel(current.serverAddress),
    path:
      protocol === 'vmess'
        ? current.path.trim()
        : protocol === 'vless'
          ? current.path.trim()
          : '',
    fingerprint: nextSecurity === 'none' ? '' : currentFingerprint || 'chrome',
    alpn: protocol === 'hysteria' ? 'h3' : nextSecurity === 'tls' ? current.alpn || 'h2,http/1.1' : current.alpn,
    realityPublicKey: nextSecurity === 'reality' ? currentRealityKey : '',
    realityShortId: nextSecurity === 'reality' ? currentRealityShortId || createRealityShortId() : '',
    fallbackName: protocol === 'vless' ? currentFallbackName : '',
    fallbackDestination: protocol === 'vless' ? currentFallbackDestination : '',
    fallbackXver: protocol === 'vless' ? current.fallbackXver || '0' : '0',
    sniffingEnabled: protocol !== 'shadowsocks'
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
  const seed =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

  return `${prefix}${seed.slice(0, 24)}`;
}

function createRandomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const seed =
    `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.padEnd(
      32,
      '0'
    );

  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-${seed.slice(12, 16)}-${seed.slice(16, 20)}-${seed.slice(20, 32)}`;
}

function createRealityShortId() {
  return createRandomSecret('').slice(0, 8);
}

const CUSTOMER_PROTOCOL_OPTIONS: Array<{ label: string; value: XrayProtocol }> = [
  { label: 'VLESS', value: 'vless' },
  { label: 'VMess', value: 'vmess' },
  { label: 'Trojan', value: 'trojan' },
  { label: 'Shadowsocks', value: 'shadowsocks' },
  { label: 'Hysteria2', value: 'hysteria' }
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

function extractHostLabel(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '');
  const withoutPath = withoutScheme.split(/[/?#]/, 1)[0];
  const hostWithPort = withoutPath.includes('@') ? withoutPath.split('@').pop() ?? '' : withoutPath;

  return hostWithPort.replace(/:\d+$/, '');
}

function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function createShareQuery(draft: CustomerDraft) {
  const query = new URLSearchParams();
  const sni = draft.sni.trim() || extractHostLabel(draft.serverAddress);
  const path = draft.path.trim();

  if (draft.protocol === 'vless') {
    query.set('encryption', 'none');
  }

  query.set('type', draft.streamNetwork);

  if (draft.security !== 'none') {
    query.set('security', draft.security);
  }

  if (sni) {
    query.set('sni', sni);
    query.set('host', sni);
  }

  if (path && ['ws', 'grpc', 'httpupgrade', 'splithttp'].includes(draft.streamNetwork)) {
    query.set(draft.streamNetwork === 'grpc' ? 'serviceName' : 'path', path);
  }

  if (draft.flow.trim() && draft.protocol === 'vless') {
    query.set('flow', draft.flow.trim());
  }

  return query.toString();
}

function buildShareLink(draft: CustomerDraft, identity: string, port: number) {
  const server = extractHostLabel(draft.serverAddress) || draft.serverAddress.trim();
  const tag = encodeURIComponent(draft.nodeName.trim() || draft.customerName.trim() || draft.clientIdentity.trim() || 'node');
  const query = createShareQuery(draft);

  if (draft.protocol === 'vmess') {
    const vmessPayload = {
      v: '2',
      ps: draft.nodeName.trim() || 'OU-UI Next',
      add: server,
      port: String(port),
      id: identity,
      aid: '0',
      scy: draft.vmessSecurity.trim() || 'auto',
      net: draft.streamNetwork,
      type: 'none',
      host: draft.sni.trim(),
      path: draft.path.trim(),
      tls: draft.security === 'none' ? '' : draft.security,
      sni: draft.sni.trim()
    };

    return 'vmess://' + encodeUtf8Base64(JSON.stringify(vmessPayload));
  }

  if (draft.protocol === 'shadowsocks') {
    const credential = encodeUtf8Base64((draft.shadowsocksMethod.trim() || '2022-blake3-aes-128-gcm') + ':' + identity);
    return 'ss://' + credential + '@' + server + ':' + port + '#' + tag;
  }

  if (draft.protocol === 'trojan') {
    return 'trojan://' + encodeURIComponent(identity) + '@' + server + ':' + port + (query ? '?' + query : '') + '#' + tag;
  }

  if (draft.protocol === 'hysteria') {
    return 'hysteria2://' + encodeURIComponent(identity) + '@' + server + ':' + port + (query ? '?' + query : '') + '#' + tag;
  }

  return 'vless://' + identity + '@' + server + ':' + port + (query ? '?' + query : '') + '#' + tag;
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
      serviceName: path.replace(/^\//, '')
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
      serverName: sni || undefined,
      publicKey: draft.realityPublicKey.trim() || undefined,
      fingerprint: draft.fingerprint.trim() || 'chrome',
      shortIds: draft.realityShortId.trim() ? [draft.realityShortId.trim()] : []
    };
  }

  return streamSettings;
}

function buildXrayArtifacts(draft: CustomerDraft) {
  const remainingDays = Math.max(Number.parseInt(draft.remainingDays, 10) || 0, 0);
  const trafficLimitGb = Math.max(Number.parseInt(draft.trafficLimitGb, 10) || 0, 0);
  const expiresAt = Date.now() + remainingDays * 24 * 60 * 60 * 1000;
  const identity = draft.clientCredential.trim() || draft.clientIdentity.trim();
  const flow = draft.flow.trim();
  const port = Math.max(Number.parseInt(draft.listenPort, 10) || 1, 1);
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
    shareLink: buildShareLink(draft, identity, port)
  };
}

function mapInboundToCustomerNode(inbound: XrayInbound): CustomerNodeRecord {
  const primaryClient = inbound.clients[0];
  const remainingDays = inbound.remainingDays
    ?? Math.max(Math.ceil((Date.parse(primaryClient?.expiresAt ?? new Date().toISOString()) - Date.now()) / (24 * 60 * 60 * 1000)), 0);

  return {
    id: inbound.id,
    agentId: inbound.agentId ?? inbound.nodeId,
    nodeName: inbound.label,
    customerName: inbound.customerName ?? primaryClient?.email ?? 'Customer',
    serverAddress: inbound.serverAddress ?? '',
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
    realityShortId: inbound.reality.shortIds[0] ?? '',
    fallbackName: inbound.fallbacks[0]?.name ?? '',
    fallbackDestination: inbound.fallbacks[0]?.destination ?? '',
    fallbackXver: inbound.fallbacks[0]?.xver ?? 0,
    sniffingEnabled: inbound.sniffingEnabled,
    ipLimit: primaryClient?.ipLimit ?? 0,
    trafficLimitGb: Math.round((primaryClient?.trafficLimitBytes ?? 0) / 1024 / 1024 / 1024),
    remainingDays,
    subscriptionRule: inbound.subscriptionRule ?? 'manual'
  };
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

function getMonthlyRealtimeUsageBytes(agent: Agent, accountingMode: AgentTrafficAccountingMode) {
  const monthlyIngressBytes = agent.telemetry.monthlyIngressBytes;
  const monthlyEgressBytes = agent.telemetry.monthlyEgressBytes;

  if (!Number.isFinite(monthlyIngressBytes) && !Number.isFinite(monthlyEgressBytes)) {
    return agent.telemetry.monthlyTrafficUsedBytes ?? 0;
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
  return Math.max(
    bytesFromGb(hostEdit.currentUsedTrafficGb),
    getMonthlyRealtimeUsageBytes(agent, hostEdit.trafficAccountingMode)
  );
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
    maxTrafficGb,
    monthlyTrafficGb,
    trafficAccountingMode: trafficPolicy.accountingMode,
    monthlyResetDay: clampResetDay(trafficPolicy.monthlyResetDay),
    currentUsedTrafficGb: gbWithSingleDecimalFromBytes(trafficPolicy.manualUsedTrafficBytes, 0),
    expiresAt: agent.expiresAt ?? createFallbackExpiry(),
    pingTarget: agent.probeConfig?.pingTarget ?? agent.publicAddress,
    pingIntervalSeconds: agent.probeConfig?.pingIntervalSeconds ?? 30,
    ...edit
  };
}

function latencyToneClass(latencyMs: number) {
  if (latencyMs <= 100) {
    return 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]';
  }

  if (latencyMs <= 200) {
    return 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.4)]';
  }

  return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]';
}

function lossToneClass(packetLossPercent: number) {
  if (packetLossPercent <= 1) {
    return 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]';
  }

  if (packetLossPercent <= 5) {
    return 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.4)]';
  }

  return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]';
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

export function NodesPage({
  agents,
  inbounds,
  language,
  taskMutationBusy = false,
  onDeployHostConfig,
  onDeleteHost,
  onDeleteCustomerNode,
  onPreviewAgentInstallCommand,
  onSaveHostConfig,
  onSaveCustomerNode
}: NodesPageProps) {
  const t = copy[language];
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('hosts');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [metadata] = useState<AgentInstallMetadata>(defaultInstallMetadata);
  const [installCommand, setInstallCommand] = useState<AgentInstallCommand>();
  const [previewError, setPreviewError] = useState(false);
  const [hostEdits, setHostEdits] = useState<Record<string, HostEdit>>({});
  const [removedAgentIds, setRemovedAgentIds] = useState<string[]>([]);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(() => createCustomerDraft(agents[0]));

  const visibleAgents = useMemo(
    () => agents.filter((agent) => !removedAgentIds.includes(agent.id)),
    [agents, removedAgentIds]
  );
  const customerNodes = useMemo(() => inbounds.map(mapInboundToCustomerNode), [inbounds]);
  const onlineHostCount = visibleAgents.filter((agent) => agent.status === 'online').length;
  const visibleCustomerNodes = customerNodes.filter((node) => visibleAgents.some((agent) => agent.id === node.agentId));
  const selectedHost = drawer.type === 'editHost' || drawer.type === 'deleteHost'
    ? visibleAgents.find((agent) => agent.id === drawer.agentId)
    : undefined;
  const editingCustomerNode =
    drawer.type === 'customerNode' && drawer.nodeId
      ? customerNodes.find((node) => node.id === drawer.nodeId)
      : undefined;
  const customerArtifacts = buildXrayArtifacts(customerDraft);
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

  function openCustomerDrawer(node?: CustomerNodeRecord) {
    if (node) {
      setCustomerDraft({
        agentId: node.agentId,
        nodeName: node.nodeName,
        customerName: node.customerName,
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
        realityShortId: node.realityShortId,
        fallbackName: node.fallbackName,
        fallbackDestination: node.fallbackDestination,
        fallbackXver: String(node.fallbackXver),
        sniffingEnabled: node.sniffingEnabled,
        ipLimit: String(node.ipLimit),
        trafficLimitGb: String(node.trafficLimitGb),
        remainingDays: String(node.remainingDays),
        subscriptionRule: node.subscriptionRule
      });
      setDrawer({ type: 'customerNode', nodeId: node.id });
      return;
    }

    setCustomerDraft(createCustomerDraft(visibleAgents[0]));
    setDrawer({ type: 'customerNode' });
  }

  function handleInstallSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    copyInstallCommand();
  }

  function handleSaveHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    onSaveHostConfig({
      agentId: agent.id,
      hostName: hostEdit.name.trim() || agent.name,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0),
      monthlyTrafficGb: Math.max(hostEdit.monthlyTrafficGb, 0),
      trafficAccountingMode: hostEdit.trafficAccountingMode,
      monthlyResetDay: clampResetDay(hostEdit.monthlyResetDay),
      currentUsedTrafficGb: parseNonNegativeNumber(String(hostEdit.currentUsedTrafficGb)),
      expiresAt: hostEdit.expiresAt,
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

    const selectedAgent = visibleAgents.find((agent) => agent.id === customerDraft.agentId);

    const nextNode: CustomerNodeRecord = {
      id: editingCustomerNode?.id ?? 'customer-node-' + Date.now(),
      agentId: customerDraft.agentId,
      nodeName: customerDraft.nodeName.trim() || t.customerNodeName,
      customerName: customerDraft.customerName.trim() || t.customerName,
      serverAddress: customerDraft.serverAddress.trim() || (selectedAgent?.publicAddress || ''),
      protocol: customerDraft.protocol,
      listenPort: Math.max(Number.parseInt(customerDraft.listenPort, 10) || 1, 1),
      clientIdentity: customerDraft.clientIdentity.trim() || createClientIdentity(customerDraft.protocol),
      clientEmail: customerDraft.clientEmail.trim() || customerDraft.customerName.trim() || customerDraft.clientIdentity.trim(),
      clientCredential: customerDraft.clientCredential.trim() || customerDraft.clientIdentity.trim() || createClientIdentity(customerDraft.protocol),
      clientLevel: Math.max(Number.parseInt(customerDraft.clientLevel, 10) || 0, 0),
      clientComment: customerDraft.clientComment.trim(),
      telegramId: customerDraft.telegramId.trim(),
      resetPolicy: customerDraft.resetPolicy,
      vmessSecurity: customerDraft.vmessSecurity.trim() || 'auto',
      shadowsocksMethod: customerDraft.shadowsocksMethod.trim() || '2022-blake3-aes-128-gcm',
      hysteriaAuth: customerDraft.hysteriaAuth.trim() || customerDraft.clientCredential.trim() || customerDraft.clientIdentity.trim(),
      streamNetwork: customerDraft.streamNetwork,
      security: customerDraft.security,
      sni: customerDraft.sni.trim(),
      path: customerDraft.path.trim(),
      flow: customerDraft.flow.trim(),
      fingerprint: customerDraft.fingerprint.trim() || (customerDraft.security === 'reality' ? 'chrome' : ''),
      alpn: splitCsv(customerDraft.alpn),
      realityPublicKey: customerDraft.realityPublicKey.trim(),
      realityShortId: customerDraft.realityShortId.trim(),
      fallbackName: customerDraft.fallbackName.trim(),
      fallbackDestination: customerDraft.fallbackDestination.trim(),
      fallbackXver: Math.max(Number.parseInt(customerDraft.fallbackXver, 10) || 0, 0),
      sniffingEnabled: customerDraft.sniffingEnabled,
      ipLimit: Math.max(Number.parseInt(customerDraft.ipLimit, 10) || 0, 0),
      trafficLimitGb: Math.max(Number.parseInt(customerDraft.trafficLimitGb, 10) || 0, 0),
      remainingDays: Math.max(Number.parseInt(customerDraft.remainingDays, 10) || 0, 0),
      subscriptionRule: customerDraft.subscriptionRule.trim()
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
        realityShortId: nextNode.realityShortId,
        fallbackName: nextNode.fallbackName,
        fallbackDestination: nextNode.fallbackDestination,
        fallbackXver: nextNode.fallbackXver,
        sniffingEnabled: nextNode.sniffingEnabled,
        ipLimit: nextNode.ipLimit,
        trafficLimitGb: nextNode.trafficLimitGb,
        remainingDays: nextNode.remainingDays,
        subscriptionRule: nextNode.subscriptionRule
      },
      saveAction
    );

    setDrawer({ type: 'closed' });
  }

  function handleDeleteHost(agent: Agent) {
    const hostEdit = getHostEdit(agent);

    onDeleteHost({
      agentId: agent.id,
      hostName: hostEdit.name.trim() || agent.name,
      maxTrafficGb: Math.max(hostEdit.maxTrafficGb, 0),
      monthlyTrafficGb: Math.max(hostEdit.monthlyTrafficGb, 0),
      trafficAccountingMode: hostEdit.trafficAccountingMode,
      monthlyResetDay: clampResetDay(hostEdit.monthlyResetDay),
      currentUsedTrafficGb: parseNonNegativeNumber(String(hostEdit.currentUsedTrafficGb)),
      expiresAt: hostEdit.expiresAt,
      pingTarget: hostEdit.pingTarget.trim() || agent.publicAddress,
      pingIntervalSeconds: 30
    });
    setRemovedAgentIds((current) => [...new Set([...current, agent.id])]);
    setDrawer({ type: 'closed' });
  }

  function handleDeleteCustomerNode(node: CustomerNodeRecord) {
    onDeleteCustomerNode({
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
      realityShortId: node.realityShortId,
      fallbackName: node.fallbackName,
      fallbackDestination: node.fallbackDestination,
      fallbackXver: node.fallbackXver,
      sniffingEnabled: node.sniffingEnabled,
      ipLimit: node.ipLimit,
      trafficLimitGb: node.trafficLimitGb,
      remainingDays: node.remainingDays,
      subscriptionRule: node.subscriptionRule
    });
  }

  function copyInstallCommand() {
    if (!installCommand?.command || typeof navigator === 'undefined') {
      return;
    }

    void navigator.clipboard?.writeText(installCommand.command);
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
            <WorkspaceButton active={activeWorkspace === 'hosts'} label={t.hostsTab} onClick={() => setActiveWorkspace('hosts')} />
            <WorkspaceButton
              active={activeWorkspace === 'customerNodes'}
              label={t.customerNodesTab}
              onClick={() => setActiveWorkspace('customerNodes')}
            />
          </div>
          <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => setDrawer({ type: 'install' })}>
            <Terminal className="h-3.5 w-3.5" />
            {t.openInstall}
          </GlowButton>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={ServerCog} label={t.hostSummary} value={String(visibleAgents.length)} />
          <SummaryMetric icon={CheckCircle2} label={t.onlineSummary} value={String(onlineHostCount)} />
          <SummaryMetric icon={UserRound} label={t.customerSummary} value={String(visibleCustomerNodes.length)} />
        </div>
      </section>

      {activeWorkspace === 'hosts' ? (
        <section className="stagger-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.hostTableTitle}</h4>
            </div>
          </div>
          {visibleAgents.length === 0 ? (
            <section className="island-card">
              <EmptyState label={t.noAgent} />
            </section>
          ) : (
            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-3 xl:grid-cols-2">
              {visibleAgents.map((agent) => (
                <ManagedHostCard
                  key={agent.id}
                  agent={agent}
                  hostEdit={getHostEdit(agent)}
                  language={language}
                  t={t}
                  onDelete={() => setDrawer({ type: 'deleteHost', agentId: agent.id })}
                  onDeploy={() => onDeployHostConfig(agent)}
                  onEdit={() => setDrawer({ type: 'editHost', agentId: agent.id })}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="stagger-3 island-card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-white/10">
            <div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.customerNodesTitle}</h4>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{t.customerNodesHint}</p>
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

          {visibleCustomerNodes.length === 0 ? (
            <EmptyState label={t.noCustomerNode} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                  <tr>
                    <th className="px-5 py-3">{t.customerNodeName}</th>
                    <th className="px-5 py-3">{t.customerName}</th>
                    <th className="px-5 py-3">{t.assignedHost}</th>
                    <th className="px-5 py-3">{t.protocolConfig}</th>
                    <th className="px-5 py-3">{t.maxTraffic}</th>
                    <th className="px-5 py-3">{t.subscriptionRule}</th>
                    <th className="px-5 py-3 text-right">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {visibleCustomerNodes.map((node) => {
                    const agent = visibleAgents.find((item) => item.id === node.agentId);

                    return (
                      <tr key={node.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{node.nodeName}</p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {node.remainingDays} {t.unitDays}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {node.customerName}
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {agent ? getHostEdit(agent).name : t.unknownHost}
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-mono text-xs font-semibold uppercase text-slate-700 dark:text-white/70">
                            {node.protocol}:{node.listenPort}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {node.streamNetwork} / {node.security} / IP {node.ipLimit}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">
                          {node.trafficLimitGb} {t.unitGb}
                        </td>
                        <td className="px-5 py-4">
                          <code className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-white/10 dark:text-white/60">
                            {node.subscriptionRule}
                          </code>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <IconButton label={t.editCustomerNode} onClick={() => openCustomerDrawer(node)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton danger label={t.deleteCustomerNode} onClick={() => handleDeleteCustomerNode(node)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ConfigDrawer
        description={t.installDescription}
        open={drawer.type === 'install'}
        title={t.installTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleInstallSubmit}>
          <InfoField label={t.tokenPolicy} value={t.tokenPolicyValue} />
          <InfoField label={t.capabilitySet} value={t.capabilitySetValue} />

          <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              <span>{t.commandPreview}</span>
              <button aria-label={t.commandPreview} className="rounded-full p-1 hover:bg-white/70 dark:hover:bg-white/10" onClick={copyInstallCommand} type="button">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" />
              {installCommand?.agentId ?? t.commandLoading}
            </p>
            {installCommand ? (
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.tokenExpires} {formatDateTime(installCommand.expiresAt, language)}
              </p>
            ) : null}
            <code className="block break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
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
            <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
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
            <p className="text-[10px] leading-5 text-slate-500 dark:text-white/40">{t.currentUsedTrafficHint}</p>
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
            <InfoField label={t.pingInterval} value={t.pingIntervalHint} />
            <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.probeSection}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoField label={t.trafficSource} value={t.telemetrySourceValue} />
              <InfoField
                label={t.lastReport}
                value={selectedHost.telemetry.reportedAt ? formatDateTime(selectedHost.telemetry.reportedAt, language) : '-'}
              />
              <InfoField label={t.platformLabel} value={selectedHost.platform} />
              <InfoField label={t.cpuModelLabel} value={selectedHost.hardware.cpuModel ?? '-'} />
              <InfoField label={t.kernelVersionLabel} value={selectedHost.hardware.kernelVersion ?? '-'} />
              <InfoField label={t.virtualizationLabel} value={selectedHost.hardware.virtualization ?? '-'} />
              <InfoField label={t.primaryNicLabel} value={selectedHost.hardware.primaryNetworkInterface ?? '-'} />
            </div>
            <p className="pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.hardwareProfile}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoField
                label={language === 'zh' ? 'CPU 核数' : 'CPU Cores'}
                value={selectedHost.telemetry.cpuCores ? String(selectedHost.telemetry.cpuCores) : '-'}
              />
              <InfoField
                label={t.memory}
                value={`${formatPercent(selectedHost.telemetry.memoryPercent)} · ${formatBytes(selectedHost.telemetry.memoryUsedBytes)} / ${formatBytes(selectedHost.telemetry.memoryTotalBytes)}`}
              />
              <InfoField
                label={t.disk}
                value={`${formatPercent(clampPercent(selectedHost.telemetry.diskPercent ?? 0))} · ${formatBytes(selectedHost.telemetry.diskUsedBytes)} / ${formatBytes(selectedHost.telemetry.diskTotalBytes)}`}
              />
              <InfoField label={t.latency} value={`${Math.round(selectedHost.telemetry.latencyMs)} ms`} />
              <InfoField label={t.packetLoss} value={formatPercent(selectedHost.telemetry.packetLossPercent)} />
              <InfoField label={t.online} value={`${selectedHost.telemetry.onlineDays ?? 0}${t.unitDays}`} />
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
        description={t.deleteHostDescription}
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
                className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-400"
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
        open={drawer.type === 'customerNode'}
        title={editingCustomerNode ? t.editCustomerNode : t.addCustomerNode}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleCustomerSubmit}>
          <DrawerSection title={t.customerBasics}>
            <SelectField
              label={t.assignedHost}
              value={customerDraft.agentId}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, agentId: value }))}
              options={visibleAgents.map((agent) => ({ label: getHostEdit(agent).name, value: agent.id }))}
            />
            <InputField
              label={t.customerNodeName}
              value={customerDraft.nodeName}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, nodeName: value }))}
            />
            <InputField
              label={t.customerName}
              value={customerDraft.customerName}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, customerName: value }))}
            />
            <InputField
              label={t.serverAddress}
              value={customerDraft.serverAddress}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, serverAddress: value }))}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SelectField
                label={t.protocol}
                value={customerDraft.protocol}
                onChange={(value) =>
                  setCustomerDraft((current) => ({
                    ...current,
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
            </div>
          </DrawerSection>
          <DrawerSection title={t.clientProfile}>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InputField
                label={t.clientLevel}
                type="number"
                value={customerDraft.clientLevel}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, clientLevel: value }))}
              />
              <InputField
                label={t.telegramId}
                value={customerDraft.telegramId}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, telegramId: value }))}
              />
            </div>
            <InputField
              label={t.clientComment}
              value={customerDraft.clientComment}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, clientComment: value }))}
            />
            <SelectField
              label={t.resetPolicy}
              value={customerDraft.resetPolicy}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, resetPolicy: value as XrayClientResetPolicy }))}
              options={RESET_POLICY_OPTIONS.map((policy) => ({ label: t.resetPolicyLabels[policy], value: policy }))}
            />
          </DrawerSection>
          <DrawerSection title={t.protocolSpecificConfig}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {protocolSectionTitle}
            </p>
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
            {customerDraft.protocol === 'hysteria' ? (
              <InputField
                label={t.alpn}
                value={customerDraft.alpn}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, alpn: value }))}
              />
            ) : null}
          </DrawerSection>
          <DrawerSection title={t.transportConfig}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.securityConfig}
            </p>
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
                onChange={(value) =>
                  setCustomerDraft((current) => ({ ...current, security: value as XrayStreamSettings['security'] }))
                }
                options={getSecurityOptions(customerDraft.protocol, language)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            </div>
            {showRealitySettings ? (
              <InputField
                label={t.fingerprint}
                value={customerDraft.fingerprint}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, fingerprint: value }))}
              />
            ) : null}
            {showTlsSettings ? (
              <InputField
                label={t.alpn}
                value={customerDraft.alpn}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, alpn: value }))}
              />
            ) : null}
            {showRealitySettings ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <InputField
                  label={t.realityPublicKey}
                  value={customerDraft.realityPublicKey}
                  onChange={(value) => setCustomerDraft((current) => ({ ...current, realityPublicKey: value }))}
                />
                <InputField
                  label={t.realityShortId}
                  value={customerDraft.realityShortId}
                  onChange={(value) => setCustomerDraft((current) => ({ ...current, realityShortId: value }))}
                />
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
              </div>
            ) : null}
            {customerDraft.protocol === 'vless' ? (
              <InputField
                label={t.fallbackXver}
                type="number"
                value={customerDraft.fallbackXver}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, fallbackXver: value }))}
              />
            ) : null}
            <CheckboxField
              checked={customerDraft.sniffingEnabled}
              label={t.sniffingEnabled}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, sniffingEnabled: value }))}
            />
          </DrawerSection>
          <DrawerSection title={t.quotaPolicy}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InputField
                label={t.maxTraffic}
                suffix={t.unitGb}
                type="number"
                value={customerDraft.trafficLimitGb}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, trafficLimitGb: value }))}
              />
              <InputField
                label={t.remainingTime}
                suffix={t.unitDays}
                type="number"
                value={customerDraft.remainingDays}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, remainingDays: value }))}
              />
              <InputField
                label={t.ipLimit}
                type="number"
                value={customerDraft.ipLimit}
                onChange={(value) => setCustomerDraft((current) => ({ ...current, ipLimit: value }))}
              />
            </div>
            <InputField
              label={t.subscriptionRule}
              value={customerDraft.subscriptionRule}
              onChange={(value) => setCustomerDraft((current) => ({ ...current, subscriptionRule: value }))}
            />
          </DrawerSection>
          <DrawerSection title={t.advancedOptions}>
            <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.protocolLink}
              </p>
              <code className="mb-4 block break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
                {customerArtifacts.shareLink}
              </code>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.configPreview}
              </p>
              <code className="block whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-slate-700 dark:text-white/70">
                {customerArtifacts.inboundConfig}
              </code>
            </div>
          </DrawerSection>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy || visibleAgents.length === 0} type="submit">
              {t.save}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>
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
  icon: typeof ServerCog;
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

function ManagedHostCard({
  agent,
  hostEdit,
  language,
  onDelete,
  onDeploy,
  onEdit,
  t
}: {
  agent: Agent;
  hostEdit: HostEdit;
  language: AppLanguage;
  onDelete: () => void;
  onDeploy: () => void;
  onEdit: () => void;
  t: NodesCopy;
}) {
  const monthlyLimitBytes = bytesFromGb(hostEdit.monthlyTrafficGb);
  const monthlyUsedBytes = getMonthlyUsedBytes(agent, hostEdit);
  const monthlyPercent = monthlyLimitBytes > 0 ? clampPercent((monthlyUsedBytes / monthlyLimitBytes) * 100) : 0;
  const diskPercent = clampPercent(agent.telemetry.diskPercent ?? 0);
  const latencySamples = normalizeSamples(agent.telemetry.latencySamplesMs, agent.telemetry.latencyMs);
  const packetLossPercent = agent.telemetry.packetLossPercent ?? 0;
  const packetLossSamples = normalizeSamples(agent.telemetry.packetLossSamplesPercent, packetLossPercent);
  const monthlyDetail = `${t.trafficModeCardLabels[hostEdit.trafficAccountingMode]} · ${formatResetDayCompact(hostEdit.monthlyResetDay, language)}`;
  const statusTone =
    agent.status === 'online'
      ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
      : agent.status === 'degraded'
        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.75)]'
        : agent.status === 'provisioning'
          ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.75)]'
          : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.75)]';
  const addressFamily = agent.publicAddress.includes(':') ? 'IPv6' : 'IPv4';
  const modeBadge = agent.connectionMode.slice(0, 1).toUpperCase();

  return (
    <article
      className="tilt-card group flex w-full max-w-[24rem] cursor-pointer flex-col gap-4 rounded-[16px] border border-white/[0.04] border-t-white/[0.12] bg-[linear-gradient(145deg,rgba(30,35,45,0.45)_0%,rgba(15,18,25,0.75)_100%)] p-5 text-white/85 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-2xl transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:border-white/10 hover:border-t-white/25 hover:shadow-[0_20px_40px_-8px_rgba(0,240,255,0.08)]"
      onClick={onEdit}
    >
      <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 transition-colors group-hover:text-white">
            <Globe2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <h3 className="max-w-[140px] truncate text-[15px] font-semibold tracking-wide text-white/95">{hostEdit.name}</h3>
          <span className="flex-shrink-0 rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">
            {addressFamily}
          </span>
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/15 text-[10px] font-bold text-cyan-300">
            {modeBadge}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusTone)} title={t.statusLabels[agent.status]} />
          <button
            aria-label={t.deployHostConfig}
            className="text-white/30 transition-colors hover:text-cyan-300"
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
            className="text-white/30 transition-colors hover:text-white"
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
            className="text-white/25 transition-colors hover:text-red-300"
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

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <HostMetric
          detail={`${agent.telemetry.cpuCores ?? 1}${t.cpuCores}`}
          icon={Cpu}
          label="CPU"
          percent={agent.telemetry.cpuPercent}
          tone="from-blue-500 to-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
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
          tone="from-purple-500 to-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.6)]"
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
          tone="from-emerald-500 to-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
          value={formatPercent(diskPercent)}
        />
        <HostMetric
          detail={monthlyDetail}
          icon={PieChart}
          label={t.monthly}
          percent={monthlyPercent}
          tone="from-cyan-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]"
          value={`${formatBytes(monthlyUsedBytes)} / ${hostEdit.monthlyTrafficGb}${t.unitGb}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-6 border-y border-white/[0.04] py-4">
        <TrafficMetric
          icon={Download}
          label={t.download}
          tone="text-emerald-400"
          total={formatBytes(agent.telemetry.downloadTotalBytes ?? agent.telemetry.rxBytes)}
          value={formatRate(agent.telemetry.downloadSpeedBps)}
        />
        <TrafficMetric
          icon={Upload}
          label={t.upload}
          tone="text-blue-400"
          total={formatBytes(agent.telemetry.uploadTotalBytes ?? agent.telemetry.txBytes)}
          value={formatRate(agent.telemetry.uploadSpeedBps)}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-6">
        <SegmentMetric
          label={t.latency}
          icon={Network}
          samples={latencySamples}
          toneForValue={latencyToneClass}
          value={`${agent.telemetry.latencyMs} ms`}
        />
        <SegmentMetric
          label={t.packetLoss}
          icon={Cloud}
          samples={packetLossSamples}
          toneForValue={lossToneClass}
          value={`${packetLossPercent.toFixed(1)} %`}
        />
      </div>

      <div className="flex items-center justify-between border-t border-dashed border-white/[0.04] pt-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-white/40">
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.expiry}
          <span className="ml-1 font-semibold text-orange-400">
            {remainingDaysUntil(hostEdit.expiresAt)}
            {t.unitDays}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-white/40">
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.online}
          <span className="ml-1 font-semibold text-blue-400">
            {agent.telemetry.onlineDays ?? 0}
            {t.unitDays}
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
        <span className="flex items-center gap-1.5 text-white/50">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          {label}
        </span>
        <span className="font-mono font-semibold tabular-nums text-white/90">{value}</span>
      </div>
      <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-black/50 shadow-inner">
        <div className={cn('h-full rounded-full bg-gradient-to-r', tone)} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
      <div className="text-right font-mono text-[10px] text-white/30">{detail}</div>
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
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/30">
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
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3" strokeWidth={1.5} />
          {label}
        </span>
        <span className="font-mono font-bold text-white/90">{value}</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full items-center justify-between gap-[2px]">
        {samples.map((sample, index) => (
          <div key={`${sample}-${index}`} className={cn('h-full flex-1 rounded-[2px] opacity-80', toneForValue(sample))} />
        ))}
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
  type?: 'date' | 'number' | 'text';
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
        className="mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
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
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <input
        checked={checked}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500 dark:border-white/20 dark:bg-white/5 dark:text-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
          {label}
        </span>
        {hint ? <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-white/45">{hint}</span> : null}
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
    <section className="space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-white/10">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</h4>
        {hint ? <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-white/45">{hint}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-700 dark:text-white/70">{value}</p>
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
  return (
    <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">
      {label}
    </div>
  );
}
