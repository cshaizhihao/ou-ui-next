import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Copy,
  Cpu,
  Database,
  Download,
  FileSearch,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  RadioTower,
  RotateCw,
  Search,
  ServerCog
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { Agent } from '../../domain/agent';
import type { AuditLog } from '../../domain/audit';
import type { ManagedNode } from '../../domain/node';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { SystemAlert } from '../../domain/system-alert';
import type { DeployTask } from '../../domain/task';
import type { TrafficRollup, TrafficRollupCompaction } from '../../domain/traffic';
import { cn } from '../../lib/cn';
import type {
  TrafficRollupRetentionPolicyReadModel,
  TrafficRollupRetentionPolicyUpdateInput
} from '../../services/api/control-plane-api';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { formatBytes, formatDateTime, formatNumber, formatPercent } from '../shared/format';
import type { SubscriptionBundle } from '../subscriptions/subscription-mixer-page';

type DashboardPageProps = {
  agents: Agent[];
  nodes: ManagedNode[];
  tasks: DeployTask[];
  auditLogs: AuditLog[];
  forwardingRules: ForwardingRuleView[];
  subscriptions: SubscriptionBundle[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
  trafficRollupCompactions: TrafficRollupCompaction[];
  trafficRollupExportBusy?: boolean;
  trafficRollupRetentionPolicy?: TrafficRollupRetentionPolicyReadModel;
  trafficRollupRetentionBusy?: boolean;
  systemAlerts: SystemAlert[];
  language: AppLanguage;
  onExportTrafficRollups?: (dimension: TrafficRollup['dimension']) => void;
  onExportTrafficRollupCompactions?: (dimension: TrafficRollup['dimension']) => void;
  onUpdateTrafficRollupRetentionPolicy?: (input: TrafficRollupRetentionPolicyUpdateInput) => void;
  onOpenHostWorkspace?: () => void;
  onRefresh: () => void;
};

const BYTES_PER_GB = 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOST_PROBE_LIMIT = 6;

const copy = {
  zh: {
    cards: {
      onlineAgents: '主机代理在线',
      nodeHealth: '节点健康',
      taskPipeline: '执行中变更',
      systemAlerts: '系统告警',
      totalTraffic: '实时总吞吐',
      forwardingEnabled: (count: string) => `转发 ${count} 条启用`,
      releaseTasks: (count: string) => `${count} 个执行记录`,
      activeAlerts: (count: string) => `${count} 条活动告警`
    },
    title: '系统总览',
    subtitle: '主控与受控主机控制面，优先呈现主机探针、客户节点、端口转发与告警状态。',
    refresh: '刷新视图',
    hostProbeTitle: '主机探针',
    hostProbeSubtitle: '优先查看受控主机 Agent 遥测、运行服务、流量与延迟状态。',
    hostProbeEmpty: '暂无主机探针，主机代理完成注册后会显示实时遥测。',
    hostProbeShowing: (shown: string, total: string) => `显示 ${shown}/${total} 台`,
    manageHosts: '管理主机',
    runtimeHostName: '运行时主机名',
    lastReport: '最近上报',
    loadAverageLabel: '负载',
    serviceHealthLabel: '服务健康',
    serviceHealthy: '全部正常',
    serviceIssue: '异常',
    serviceMissing: '缺失',
    serviceInactive: '未运行',
    serviceFailed: '失败',
    serviceUnknown: '未知',
    serviceWaiting: '等待遥测',
    waitingTelemetry: '等待 Agent 遥测',
    cpuCores: '核',
    memory: '内存',
    disk: '磁盘',
    monthly: '月度',
    usageLedgerTitle: '用量账本',
    usageLedgerSubtitle: '按主机、转发规则与 Xray 客户聚合当前采样，并保留归档导出与留存策略入口。',
    searchUsageLedger: '搜索用量账本',
    searchUsageLedgerPlaceholder: '搜索客户、主机、规则、周期、Agent 或元数据',
    usageDimension: '用量维度',
    allUsageDimensions: '全部维度',
    usageDimensionLabels: {
      agent: '主机',
      'forward-rule': '转发规则',
      'xray-client': 'Xray 客户'
    },
    matchingUsage: '当前匹配',
    usageTotal: '计费流量',
    usageIngress: '入站',
    usageEgress: '出站',
    usageSamples: '样本',
    usageArchive: '归档',
    usageLatestSample: '最新样本',
    usageNoMatches: '没有匹配的用量记录。',
    exportUsageSamples: '导出用量样本',
    exportUsageArchive: '导出用量归档',
    usageRetentionTitle: '用量留存',
    usageRetentionDays: '用量留存天数',
    usageRetentionRecords: '每范围记录数',
    saveUsageRetention: '保存用量留存',
    usageRetentionSaveReason: 'Operator updated traffic usage retention policy',
    confirmUsageRetentionSave: (days: number, count: number, language: AppLanguage) =>
      `确认保存流量用量留存策略：保留 ${formatNumber(days, language)} 天、每范围 ${formatNumber(count, language)} 条？`,
    usageRetentionAge: (days: string) => `${days} 天`,
    usageRetentionLimit: (count: string) => `${count} 条/范围`,
    usageRetentionSourceLabels: {
      'runtime-config': '运行时默认',
      'control-plane': '控制面覆盖'
    },
    viewUsageEvidence: '查看用量证据',
    usageEvidenceTitle: '用量证据',
    usageEvidenceDescription: '集中查看用量聚合、原始样本与压缩归档记录。',
    usageEvidenceSummary: '用量摘要',
    usageEvidenceContext: '上下文',
    usageEvidenceSamples: '原始样本',
    usageEvidenceCompactions: '压缩归档',
    copyUsageEvidence: '复制用量证据',
    noUsageEvidence: '暂无用量证据',
    latency: '延迟',
    packetLoss: '丢包率',
    online: '在线',
    expiry: '到期',
    sampleStatus: '采样',
    sampleHealthy: '正常',
    sampleGap: '缺口',
    sampleGapMissing: '无样本',
    unitDays: '天',
    unitGb: 'GB',
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
    },
    topologyTitle: '流量拓扑',
    topologyDescription: '主控、受控主机与端口转发链路之间的实时流向预览。',
    topologyAria: '实时流量拓扑',
    topologyMaster: '主控',
    topologyManagedHosts: '受控主机',
    topologyForwarding: '端口转发',
    topologyIdle: '等待受控主机接入',
    activeAlerts: '活动告警',
    alertsEmpty: '暂无活动系统告警。',
    searchAlerts: '搜索告警',
    searchAlertsPlaceholder: '搜索资源、消息、任务、回滚、去重键或元数据',
    alertSeverity: '告警级别',
    allAlertSeverities: '全部级别',
    alertSeverityFilterLabels: {
      critical: '仅严重',
      warning: '仅警告'
    },
    matchingAlerts: '当前匹配',
    noMatchingAlerts: '没有匹配的活动告警。',
    viewAlertEvidence: '查看告警证据',
    copyVisibleAlertEvidence: '复制当前告警证据',
    copyVisibleAlertRecoveryPlans: '复制当前恢复计划',
    alertEvidenceTitle: '告警证据',
    alertEvidenceDescription: '集中查看告警上下文、资源、去重键与元数据。',
    alertSummary: '告警摘要',
    alertContext: '告警上下文',
    alertMetadata: '元数据',
    alertRecoveryPlan: '恢复计划',
    alertFailureReason: '失败原因',
    alertSourceTask: '源任务',
    alertRollbackTask: '回滚任务',
    alertNextStep: '下一步',
    copyAlertEvidence: '复制告警证据',
    copyAlertRecoveryPlan: '复制恢复计划',
    noMetadata: '暂无元数据',
    id: 'ID',
    kind: '类型',
    severity: '级别',
    status: '状态',
    resource: '资源',
    resourceType: '资源类型',
    resourceId: '资源 ID',
    observedAt: '观测时间',
    dedupeKey: '去重键',
    message: '消息',
    latestAudit: '最新审计',
    auditEmpty: '等待第一条变更审计事件。',
    alertKindLabels: {
      'agent.telemetry_sampling_gap': '采样缺口',
      'agent.offline': '主机离线',
      'agent.runtime_service_unhealthy': '服务异常',
      'agent.high_latency': '高延迟',
      'command_outbox.overdue': '命令超时',
      'command_outbox.dead_letter': '命令死信',
      'runtime.apply_health_failed': '应用健康失败',
      'runtime.reload_failed': '重载失败',
      'audit.write_failed': '审计写入失败',
      'external_archive.sink_failed': '外部归档失败',
      'system_alert_notification.overdue': '通知超时',
      'system_alert_notification.dead_letter': '通知死信',
      'subscription_source.sync_warning': '订阅源告警',
      'subscription_source.sync_failed': '订阅源失败',
      'quota.exceeded': '配额超限'
    },
    alertSeverityLabels: {
      warning: '警告',
      critical: '严重'
    },
    deadLetterReasonLabels: {
      prefix: '死信原因',
      ack: 'ACK',
      result: '结果',
      unknown: '未知',
      other: '其它'
    }
  },
  en: {
    cards: {
      onlineAgents: 'Online Agents',
      nodeHealth: 'Node Health',
      taskPipeline: 'Active Changes',
      systemAlerts: 'System Alerts',
      totalTraffic: 'Live throughput',
      forwardingEnabled: (count: string) => `${count} forwarding rules active`,
      releaseTasks: (count: string) => `${count} execution records`,
      activeAlerts: (count: string) => `${count} active alerts`
    },
    title: 'System Dashboard',
    subtitle: 'Control plane overview focused on host probes, customer nodes, forwarding, and alert state.',
    refresh: 'Refresh View',
    hostProbeTitle: 'Host Probes',
    hostProbeSubtitle: 'Prioritized Agent telemetry, runtime services, traffic, and latency for managed hosts.',
    hostProbeEmpty: 'No host probes yet. Telemetry appears after a host Agent registers.',
    hostProbeShowing: (shown: string, total: string) => `Showing ${shown}/${total} hosts`,
    manageHosts: 'Manage Hosts',
    runtimeHostName: 'Runtime Hostname',
    lastReport: 'Last Report',
    loadAverageLabel: 'Load',
    serviceHealthLabel: 'Service Health',
    serviceHealthy: 'All Healthy',
    serviceIssue: 'Issues',
    serviceMissing: 'Missing',
    serviceInactive: 'Inactive',
    serviceFailed: 'Failed',
    serviceUnknown: 'Unknown',
    serviceWaiting: 'Waiting',
    waitingTelemetry: 'Waiting for Agent telemetry',
    cpuCores: 'cores',
    memory: 'Memory',
    disk: 'Disk',
    monthly: 'Monthly',
    usageLedgerTitle: 'Usage Ledger',
    usageLedgerSubtitle: 'Aggregate retained samples across hosts, forwarding rules, and Xray clients with archive export and retention controls.',
    searchUsageLedger: 'Search Usage Ledger',
    searchUsageLedgerPlaceholder: 'Search customer, host, rule, period, Agent, or metadata',
    usageDimension: 'Usage Dimension',
    allUsageDimensions: 'All dimensions',
    usageDimensionLabels: {
      agent: 'Hosts',
      'forward-rule': 'Forwarding',
      'xray-client': 'Xray Clients'
    },
    matchingUsage: 'Matching',
    usageTotal: 'Metered',
    usageIngress: 'Ingress',
    usageEgress: 'Egress',
    usageSamples: 'Samples',
    usageArchive: 'Archive',
    usageLatestSample: 'Latest Sample',
    usageNoMatches: 'No matching usage records.',
    exportUsageSamples: 'Export Usage Samples',
    exportUsageArchive: 'Export Usage Archive',
    usageRetentionTitle: 'Usage Retention',
    usageRetentionDays: 'Usage Retention Days',
    usageRetentionRecords: 'Records Per Scope',
    saveUsageRetention: 'Save Usage Retention',
    usageRetentionSaveReason: 'Operator updated traffic usage retention policy',
    confirmUsageRetentionSave: (days: number, count: number, language: AppLanguage) =>
      `Save traffic usage retention policy: retain ${formatNumber(days, language)} days with ${formatNumber(count, language)} records per scope?`,
    usageRetentionAge: (days: string) => `${days} days`,
    usageRetentionLimit: (count: string) => `${count} / scope`,
    usageRetentionSourceLabels: {
      'runtime-config': 'Runtime default',
      'control-plane': 'Control-plane override'
    },
    viewUsageEvidence: 'View Usage Evidence',
    usageEvidenceTitle: 'Usage Evidence',
    usageEvidenceDescription: 'Inspect the usage aggregate, retained samples, and compacted archive records.',
    usageEvidenceSummary: 'Usage Summary',
    usageEvidenceContext: 'Context',
    usageEvidenceSamples: 'Retained Samples',
    usageEvidenceCompactions: 'Compacted Archive',
    copyUsageEvidence: 'Copy Usage Evidence',
    noUsageEvidence: 'No usage evidence',
    latency: 'Latency',
    packetLoss: 'Packet Loss',
    online: 'Online',
    expiry: 'Expires',
    sampleStatus: 'Sampling',
    sampleHealthy: 'Normal',
    sampleGap: 'Gap',
    sampleGapMissing: 'No Sample',
    unitDays: 'days',
    unitGb: 'GB',
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
    },
    topologyTitle: 'Traffic Topology',
    topologyDescription: 'Real-time flow preview across the control plane, managed hosts, and port forwarding links.',
    topologyAria: 'Real-time traffic topology',
    topologyMaster: 'Control Plane',
    topologyManagedHosts: 'Managed Hosts',
    topologyForwarding: 'Port Forwarding',
    topologyIdle: 'Waiting for managed host enrollment',
    activeAlerts: 'Active Alerts',
    alertsEmpty: 'No active system alerts.',
    searchAlerts: 'Search Alerts',
    searchAlertsPlaceholder: 'Search resource, message, task, rollback, dedupe key, or metadata',
    alertSeverity: 'Alert Severity',
    allAlertSeverities: 'All severities',
    alertSeverityFilterLabels: {
      critical: 'Critical only',
      warning: 'Warning only'
    },
    matchingAlerts: 'Matching',
    noMatchingAlerts: 'No matching active alerts.',
    viewAlertEvidence: 'View Alert Evidence',
    copyVisibleAlertEvidence: 'Copy Visible Alert Evidence',
    copyVisibleAlertRecoveryPlans: 'Copy Visible Recovery Plans',
    alertEvidenceTitle: 'Alert Evidence',
    alertEvidenceDescription: 'Inspect alert context, resource, dedupe key, and metadata.',
    alertSummary: 'Alert Summary',
    alertContext: 'Alert Context',
    alertMetadata: 'Metadata',
    alertRecoveryPlan: 'Recovery Plan',
    alertFailureReason: 'Failure Reason',
    alertSourceTask: 'Source Task',
    alertRollbackTask: 'Rollback Task',
    alertNextStep: 'Next Step',
    copyAlertEvidence: 'Copy Alert Evidence',
    copyAlertRecoveryPlan: 'Copy Recovery Plan',
    noMetadata: 'No metadata',
    id: 'ID',
    kind: 'Kind',
    severity: 'Severity',
    status: 'Status',
    resource: 'Resource',
    resourceType: 'Resource Type',
    resourceId: 'Resource ID',
    observedAt: 'Observed At',
    dedupeKey: 'Dedupe Key',
    message: 'Message',
    latestAudit: 'Latest Audit',
    auditEmpty: 'Waiting for the first change audit event.',
    alertKindLabels: {
      'agent.telemetry_sampling_gap': 'Sampling Gap',
      'agent.offline': 'Agent Offline',
      'agent.runtime_service_unhealthy': 'Runtime Service',
      'agent.high_latency': 'High Latency',
      'command_outbox.overdue': 'Command Overdue',
      'command_outbox.dead_letter': 'Command Dead Letter',
      'runtime.apply_health_failed': 'Apply Health Failed',
      'runtime.reload_failed': 'Reload Failed',
      'audit.write_failed': 'Audit Write Failed',
      'external_archive.sink_failed': 'Archive Sink Failed',
      'system_alert_notification.overdue': 'Notification Overdue',
      'system_alert_notification.dead_letter': 'Notification Dead Letter',
      'subscription_source.sync_warning': 'Source Sync Warning',
      'subscription_source.sync_failed': 'Source Sync Failed',
      'quota.exceeded': 'Quota Exceeded'
    },
    alertSeverityLabels: {
      warning: 'Warning',
      critical: 'Critical'
    },
    deadLetterReasonLabels: {
      prefix: 'Dead-letter reasons',
      ack: 'ACK',
      result: 'Result',
      unknown: 'Unknown',
      other: 'Other'
    }
  }
} as const;

type DashboardCopy = (typeof copy)[AppLanguage];
type AlertSeverityFilter = 'all' | SystemAlert['severity'];
type UsageDimensionFilter = 'all' | TrafficRollup['dimension'];

type UsageLedgerRow = {
  id: string;
  dimension: TrafficRollup['dimension'];
  subjectId: string;
  subjectLabel: string;
  agentId: string;
  periodKey: string;
  accountingMode: TrafficRollup['accountingMode'];
  ingressBytes: number;
  egressBytes: number;
  meteredBytes: number;
  sampleCount: number;
  archiveCount: number;
  latestObservedAt: string;
  searchText: string;
};

type AlertRecoveryPlan = {
  failureReason?: string;
  sourceTaskId?: string;
  rollbackTaskId?: string;
  nextStep: string;
};

const alertSeverities: SystemAlert['severity'][] = ['critical', 'warning'];
const usageDimensions: TrafficRollup['dimension'][] = ['agent', 'forward-rule', 'xray-client'];

function bytesFromGb(gb: number) {
  return Math.max(Number.isFinite(gb) ? gb : 0, 0) * BYTES_PER_GB;
}

function gbWithSingleDecimalFromBytes(bytes: number | undefined, fallback = 0) {
  if (!Number.isFinite(bytes)) {
    return fallback;
  }

  return Math.max(Math.round((((bytes ?? 0) / BYTES_PER_GB) + Number.EPSILON) * 10) / 10, 0);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function formatResetDayCompact(day: number, language: AppLanguage) {
  return language === 'zh' ? `${day}号` : `D${day}`;
}

function getMonthlyMeteredUsageBytes(agent: Agent, accountingMode: Agent['trafficPolicy']['accountingMode']) {
  const ingressBytes = Number.isFinite(agent.telemetry.monthlyIngressBytes)
    ? agent.telemetry.monthlyIngressBytes ?? 0
    : 0;
  const egressBytes = Number.isFinite(agent.telemetry.monthlyEgressBytes)
    ? agent.telemetry.monthlyEgressBytes ?? 0
    : 0;

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

function getMonthlyUsedBytes(agent: Agent) {
  const accountingMode = agent.trafficPolicy?.accountingMode ?? 'both';
  const manualUsedBytes = bytesFromGb(gbWithSingleDecimalFromBytes(agent.trafficPolicy?.manualUsedTrafficBytes, 0));
  const meteredUsedBytes = getMonthlyMeteredUsageBytes(agent, accountingMode);
  const reportedTotalBytes = Number.isFinite(agent.telemetry.monthlyTrafficUsedBytes)
    ? agent.telemetry.monthlyTrafficUsedBytes
    : 0;

  return Math.max(reportedTotalBytes, manualUsedBytes + meteredUsedBytes);
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

function formatSamplingStatus(agent: Agent, language: AppLanguage, t: DashboardCopy) {
  if (!agent.telemetry.sampleGapDetected) {
    return t.sampleHealthy;
  }

  const label = agent.telemetry.sampleGapReason === 'no_telemetry_sample' ? t.sampleGapMissing : t.sampleGap;
  return `${label} ${formatCompactSeconds(agent.telemetry.sampleGapSeconds, language)}`;
}

function hasTelemetryReport(agent: Agent) {
  return Boolean(agent.telemetry.reportedAt);
}

function runtimeServiceIssueCount(agent: Agent) {
  return (agent.telemetry.runtimeServices ?? []).filter(
    (service) => service.required && service.status !== 'active'
  ).length;
}

function formatRuntimeServiceHealth(agent: Agent, t: DashboardCopy) {
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

function formatLoadAverage(agent: Agent) {
  const values = [agent.telemetry.loadAverage1m, agent.telemetry.loadAverage5m, agent.telemetry.loadAverage15m];

  if (values.every((value) => !Number.isFinite(value))) {
    return '-';
  }

  return values.map((value) => (Number.isFinite(value) ? (value ?? 0).toFixed(2) : '-')).join(' / ');
}

function remainingDaysUntil(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const remaining = Date.parse(value) - Date.now();
  return Math.max(Math.ceil(remaining / DAY_MS), 0);
}

function latencyToneClass(
  latencyMs: number,
  probeConfig?: Agent['probeConfig'],
  latencyStatus?: Agent['telemetry']['latencyStatus']
) {
  if (latencyStatus === 'green') {
    return 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]';
  }

  if (latencyStatus === 'yellow') {
    return 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.4)]';
  }

  if (latencyStatus === 'red') {
    return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]';
  }

  const greenMax = probeConfig?.latencyGreenMaxMs ?? 100;
  const yellowMax = Math.max(probeConfig?.latencyYellowMaxMs ?? 200, greenMax);

  if (!Number.isFinite(latencyMs) || latencyMs < 1) {
    return 'bg-slate-300 shadow-none dark:bg-white/20';
  }

  if (latencyMs <= greenMax) {
    return 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]';
  }

  if (latencyMs <= yellowMax) {
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

function normalizeSamples(samples: number[] | undefined, fallback: number) {
  const next = (samples && samples.length > 0 ? samples : [fallback]).slice(-10);

  while (next.length < 10) {
    next.unshift(fallback);
  }

  return next;
}

function readAlertMetadataNumber(metadata: SystemAlert['metadata'], key: string) {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatDeadLetterDiagnostics(
  alert: SystemAlert,
  language: AppLanguage,
  labels: DashboardCopy['deadLetterReasonLabels']
) {
  if (alert.kind !== 'command_outbox.dead_letter') {
    return undefined;
  }

  const parts = [
    { label: labels.ack, count: readAlertMetadataNumber(alert.metadata, 'deadLetterAckTimeoutCount') },
    { label: labels.result, count: readAlertMetadataNumber(alert.metadata, 'deadLetterResultTimeoutCount') },
    { label: labels.unknown, count: readAlertMetadataNumber(alert.metadata, 'deadLetterUnknownReasonCount') },
    { label: labels.other, count: readAlertMetadataNumber(alert.metadata, 'deadLetterOtherReasonCount') }
  ].filter((part) => part.count > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return `${labels.prefix}: ${parts.map((part) => `${part.label} ${formatNumber(part.count, language)}`).join(' / ')}`;
}

function normalizeAlertSearch(value: string) {
  return value.trim().toLowerCase();
}

function stringifyAlertValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function createAlertSearchText(alert: SystemAlert, t: DashboardCopy) {
  return [
    alert.id,
    alert.kind,
    t.alertKindLabels[alert.kind],
    alert.severity,
    t.alertSeverityLabels[alert.severity],
    alert.status,
    alert.title,
    alert.message,
    alert.resourceType,
    alert.resourceId,
    alert.resourceLabel,
    alert.observedAt,
    alert.dedupeKey,
    alert.metadata
  ]
    .map(stringifyAlertValue)
    .join(' ')
    .toLowerCase();
}

function filterSystemAlerts(
  alerts: SystemAlert[],
  search: string,
  severityFilter: AlertSeverityFilter,
  t: DashboardCopy
) {
  const normalizedSearch = normalizeAlertSearch(search);

  return alerts.filter((alert) => {
    const severityMatches = severityFilter === 'all' || alert.severity === severityFilter;
    const searchMatches = !normalizedSearch || createAlertSearchText(alert, t).includes(normalizedSearch);

    return severityMatches && searchMatches;
  });
}

function maxIsoTimestamp(left: string, right: string) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);

  if (Number.isNaN(leftMs)) {
    return right;
  }

  if (Number.isNaN(rightMs)) {
    return left;
  }

  return rightMs > leftMs ? right : left;
}

function createUsageLedgerSearchText(values: unknown[]) {
  return values.map(stringifyAlertValue).join(' ').toLowerCase();
}

function createUsageLedgerRows(rollups: TrafficRollup[], compactions: TrafficRollupCompaction[]) {
  const archivedCounts = new Map<string, number>();

  for (const compaction of compactions) {
    const key = `${compaction.dimension}:${compaction.agentId}:${compaction.subjectId}`;
    archivedCounts.set(key, (archivedCounts.get(key) ?? 0) + compaction.sampleCount);
  }

  const rows = new Map<string, UsageLedgerRow>();

  for (const rollup of rollups) {
    const key = `${rollup.dimension}:${rollup.agentId}:${rollup.subjectId}:${rollup.periodKey}`;
    const current = rows.get(key);

    if (!current) {
      rows.set(key, {
        id: key,
        dimension: rollup.dimension,
        subjectId: rollup.subjectId,
        subjectLabel: rollup.subjectLabel,
        agentId: rollup.agentId,
        periodKey: rollup.periodKey,
        accountingMode: rollup.accountingMode,
        ingressBytes: rollup.ingressBytes,
        egressBytes: rollup.egressBytes,
        meteredBytes: rollup.meteredBytes,
        sampleCount: 1,
        archiveCount: archivedCounts.get(`${rollup.dimension}:${rollup.agentId}:${rollup.subjectId}`) ?? 0,
        latestObservedAt: rollup.observedAt,
        searchText: createUsageLedgerSearchText([
          rollup.id,
          rollup.dimension,
          rollup.subjectId,
          rollup.subjectLabel,
          rollup.agentId,
          rollup.periodKey,
          rollup.accountingMode,
          rollup.observedAt,
          rollup.sampledAt,
          rollup.metadata
        ])
      });
      continue;
    }

    rows.set(key, {
      ...current,
      subjectLabel: rollup.subjectLabel || current.subjectLabel,
      accountingMode: rollup.accountingMode,
      ingressBytes: current.ingressBytes + rollup.ingressBytes,
      egressBytes: current.egressBytes + rollup.egressBytes,
      meteredBytes: current.meteredBytes + rollup.meteredBytes,
      sampleCount: current.sampleCount + 1,
      latestObservedAt: maxIsoTimestamp(current.latestObservedAt, rollup.observedAt),
      searchText: `${current.searchText} ${createUsageLedgerSearchText([
        rollup.id,
        rollup.subjectId,
        rollup.subjectLabel,
        rollup.agentId,
        rollup.periodKey,
        rollup.metadata
      ])}`
    });
  }

  return [...rows.values()].sort((left, right) => {
    const observedDelta = Date.parse(right.latestObservedAt) - Date.parse(left.latestObservedAt);
    return observedDelta || right.meteredBytes - left.meteredBytes || left.subjectLabel.localeCompare(right.subjectLabel);
  });
}

function filterUsageLedgerRows(rows: UsageLedgerRow[], search: string, dimension: UsageDimensionFilter) {
  const normalizedSearch = normalizeAlertSearch(search);

  return rows.filter((row) => {
    const dimensionMatches = dimension === 'all' || row.dimension === dimension;
    const searchMatches = !normalizedSearch || row.searchText.includes(normalizedSearch);

    return dimensionMatches && searchMatches;
  });
}

function formatUsageLedgerSubjectLabel(row: UsageLedgerRow, t: DashboardCopy) {
  return row.dimension === 'agent' ? `${t.usageDimensionLabels[row.dimension]} ${row.subjectLabel}` : row.subjectLabel;
}

function findUsageLedgerRollups(row: UsageLedgerRow, rollups: TrafficRollup[]) {
  return rollups.filter(
    (rollup) =>
      rollup.dimension === row.dimension
      && rollup.agentId === row.agentId
      && rollup.subjectId === row.subjectId
      && rollup.periodKey === row.periodKey
  );
}

function findUsageLedgerCompactions(row: UsageLedgerRow, compactions: TrafficRollupCompaction[]) {
  return compactions.filter(
    (compaction) =>
      compaction.dimension === row.dimension
      && compaction.agentId === row.agentId
      && compaction.subjectId === row.subjectId
  );
}

function createUsageEvidence(row: UsageLedgerRow, rollups: TrafficRollup[], compactions: TrafficRollupCompaction[]) {
  const rowRollups = findUsageLedgerRollups(row, rollups);
  const rowCompactions = findUsageLedgerCompactions(row, compactions);

  return {
    row: {
      id: row.id,
      dimension: row.dimension,
      subjectId: row.subjectId,
      subjectLabel: row.subjectLabel,
      agentId: row.agentId,
      periodKey: row.periodKey,
      accountingMode: row.accountingMode,
      ingressBytes: row.ingressBytes,
      egressBytes: row.egressBytes,
      meteredBytes: row.meteredBytes,
      sampleCount: row.sampleCount,
      archiveCount: row.archiveCount,
      latestObservedAt: row.latestObservedAt
    },
    rollupIds: rowRollups.map((rollup) => rollup.id),
    compactionIds: rowCompactions.map((compaction) => compaction.id),
    rollups: rowRollups,
    compactions: rowCompactions
  };
}

function createUsageEvidenceText(row: UsageLedgerRow, rollups: TrafficRollup[], compactions: TrafficRollupCompaction[]) {
  return JSON.stringify(createUsageEvidence(row, rollups, compactions), null, 2);
}

function copyUsageEvidence(row: UsageLedgerRow, rollups: TrafficRollup[], compactions: TrafficRollupCompaction[]) {
  void navigator.clipboard?.writeText(createUsageEvidenceText(row, rollups, compactions));
}

function createAlertEvidenceText(alert: SystemAlert) {
  return JSON.stringify(alert, null, 2);
}

function copyAlertEvidence(alert: SystemAlert) {
  void navigator.clipboard?.writeText(createAlertEvidenceText(alert));
}

function readAlertMetadataText(metadata: SystemAlert['metadata'], key: string) {
  const value = metadata?.[key];

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return stringifyAlertValue(value);
}

function createAlertRecoveryPlan(alert: SystemAlert): AlertRecoveryPlan | undefined {
  const failureReason = readAlertMetadataText(alert.metadata, 'failureReason');
  const sourceTaskId = readAlertMetadataText(alert.metadata, 'taskId');
  const rollbackTaskId = readAlertMetadataText(alert.metadata, 'rollbackTaskId');

  if (alert.kind === 'runtime.apply_health_failed') {
    return {
      failureReason,
      sourceTaskId,
      rollbackTaskId,
      nextStep: 'Verify rollback task status, inspect the failed source task, then redeploy after the probe target is healthy.'
    };
  }

  if (alert.kind === 'runtime.reload_failed') {
    return {
      failureReason,
      sourceTaskId,
      nextStep: 'Inspect the reload task result, validate runtime health checks, then retry reload after fixing the failed check.'
    };
  }

  if (alert.kind === 'command_outbox.dead_letter') {
    return {
      failureReason: readAlertMetadataText(alert.metadata, 'deadLetterReasonSummary'),
      nextStep: 'Review overdue command acknowledgements and results, then retry only the affected runtime command after the Agent reconnects.'
    };
  }

  if (alert.kind === 'agent.high_latency') {
    const latencyMs = readAlertMetadataText(alert.metadata, 'latencyMs');
    const yellowMax = readAlertMetadataText(alert.metadata, 'latencyYellowMaxMs');

    return {
      failureReason: latencyMs && yellowMax ? `latency ${latencyMs}ms above yellow threshold ${yellowMax}ms` : undefined,
      nextStep: 'Check route quality, probe target reachability, and current traffic saturation before moving traffic away or redeploying.'
    };
  }

  return undefined;
}

function createAlertRecoveryPlanText(alert: SystemAlert, plan: AlertRecoveryPlan) {
  return [
    `Alert: ${alert.id}`,
    `Kind: ${alert.kind}`,
    `Resource: ${alert.resourceLabel}`,
    plan.failureReason ? `Failure Reason: ${plan.failureReason}` : undefined,
    plan.sourceTaskId ? `Source Task: ${plan.sourceTaskId}` : undefined,
    plan.rollbackTaskId ? `Rollback Task: ${plan.rollbackTaskId}` : undefined,
    `Next Step: ${plan.nextStep}`
  ].filter(Boolean).join('\n');
}

function copyAlertRecoveryPlan(alert: SystemAlert, plan: AlertRecoveryPlan) {
  void navigator.clipboard?.writeText(createAlertRecoveryPlanText(alert, plan));
}

function createAlertRecoveryPlanEntries(alerts: SystemAlert[]) {
  return alerts.flatMap((alert) => {
    const plan = createAlertRecoveryPlan(alert);

    return plan ? [{ alert, plan }] : [];
  });
}

function copyAlertRecoveryPlans(alerts: SystemAlert[]) {
  const planEntries = createAlertRecoveryPlanEntries(alerts);

  if (planEntries.length === 0) {
    return;
  }

  void navigator.clipboard?.writeText(
    planEntries.map(({ alert, plan }) => createAlertRecoveryPlanText(alert, plan)).join('\n\n')
  );
}

function createAlertEvidenceSetPayload(alerts: SystemAlert[]) {
  return {
    alertCount: alerts.length,
    alerts
  };
}

function copyAlertEvidenceSet(alerts: SystemAlert[]) {
  if (alerts.length === 0) {
    return;
  }

  void navigator.clipboard?.writeText(JSON.stringify(createAlertEvidenceSetPayload(alerts), null, 2));
}

function AlertEvidenceField({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/70">{value}</p>
    </div>
  );
}

function AlertEvidenceDrawer({
  alert,
  language,
  open,
  onClose
}: {
  alert?: SystemAlert;
  language: AppLanguage;
  open: boolean;
  onClose: () => void;
}) {
  const t = copy[language];
  const metadataEntries = Object.entries(alert?.metadata ?? {}).filter(([, value]) => value !== undefined);
  const recoveryPlan = alert ? createAlertRecoveryPlan(alert) : undefined;

  return (
    <ConfigDrawer
      description={alert ? `${t.alertKindLabels[alert.kind]} · ${alert.resourceLabel}` : t.alertEvidenceDescription}
      open={open}
      title={t.alertEvidenceTitle}
      onClose={onClose}
    >
      {alert ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-blue-500 dark:text-primary" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.alertSummary}
              </p>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{alert.title}</p>
            <p className="mt-2 break-words text-xs leading-5 text-slate-500 dark:text-white/55">{alert.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-[10px] font-bold uppercase',
                  alert.severity === 'critical'
                    ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200'
                    : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-200'
                )}
              >
                {t.alertSeverityLabels[alert.severity]}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                {alert.status}
              </span>
            </div>
          </div>

          {recoveryPlan ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-400/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">
                  {t.alertRecoveryPlan}
                </p>
                <button
                  className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white/70 px-3 text-xs font-bold text-blue-700 transition hover:bg-white dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15"
                  onClick={() => copyAlertRecoveryPlan(alert, recoveryPlan)}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copyAlertRecoveryPlan}
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <AlertEvidenceField label={t.alertFailureReason} value={recoveryPlan.failureReason} />
                <AlertEvidenceField label={t.alertSourceTask} value={recoveryPlan.sourceTaskId} />
                <AlertEvidenceField label={t.alertRollbackTask} value={recoveryPlan.rollbackTaskId} />
                <AlertEvidenceField label={t.alertNextStep} value={recoveryPlan.nextStep} />
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.alertContext}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <AlertEvidenceField label={t.id} value={alert.id} />
              <AlertEvidenceField label={t.kind} value={alert.kind} />
              <AlertEvidenceField label={t.severity} value={alert.severity} />
              <AlertEvidenceField label={t.status} value={alert.status} />
              <AlertEvidenceField label={t.resourceType} value={alert.resourceType} />
              <AlertEvidenceField label={t.resourceId} value={alert.resourceId} />
              <AlertEvidenceField label={t.resource} value={alert.resourceLabel} />
              <AlertEvidenceField label={t.observedAt} value={formatDateTime(alert.observedAt, language)} />
              <AlertEvidenceField label={t.dedupeKey} value={alert.dedupeKey} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.alertMetadata}
            </p>
            {metadataEntries.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {metadataEntries.map(([key, value]) => (
                  <AlertEvidenceField key={key} label={key} value={stringifyAlertValue(value)} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{t.noMetadata}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-600 dark:bg-white dark:text-slate-900 dark:hover:bg-primary"
              onClick={() => copyAlertEvidence(alert)}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyAlertEvidence}
            </button>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

function UsageEvidenceDrawer({
  compactions,
  language,
  open,
  row,
  rollups,
  onClose
}: {
  compactions: TrafficRollupCompaction[];
  language: AppLanguage;
  open: boolean;
  row?: UsageLedgerRow;
  rollups: TrafficRollup[];
  onClose: () => void;
}) {
  const t = copy[language];
  const rowRollups = row ? findUsageLedgerRollups(row, rollups) : [];
  const rowCompactions = row ? findUsageLedgerCompactions(row, compactions) : [];

  return (
    <ConfigDrawer
      description={row ? `${t.usageDimensionLabels[row.dimension]} · ${row.subjectLabel}` : t.usageEvidenceDescription}
      open={open}
      title={t.usageEvidenceTitle}
      onClose={onClose}
    >
      {row ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500 dark:text-primary" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.usageEvidenceSummary}
              </p>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{row.subjectLabel}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <UsageInlineMetric label={t.usageTotal} value={formatBytes(row.meteredBytes)} />
              <UsageInlineMetric label={t.usageIngress} value={formatBytes(row.ingressBytes)} />
              <UsageInlineMetric label={t.usageEgress} value={formatBytes(row.egressBytes)} />
              <UsageInlineMetric label={t.usageSamples} value={formatNumber(row.sampleCount, language)} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.usageEvidenceContext}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <AlertEvidenceField label={t.id} value={row.id} />
              <AlertEvidenceField label={t.usageDimension} value={row.dimension} />
              <AlertEvidenceField label={t.resourceId} value={row.subjectId} />
              <AlertEvidenceField label="agentId" value={row.agentId} />
              <AlertEvidenceField label="periodKey" value={row.periodKey} />
              <AlertEvidenceField label="accountingMode" value={row.accountingMode} />
              <AlertEvidenceField label={t.usageLatestSample} value={formatDateTime(row.latestObservedAt, language)} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.usageEvidenceSamples}
            </p>
            {rowRollups.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {rowRollups.map((rollup) => (
                  <div key={rollup.id} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
                    <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/70">
                      {rollup.id}
                    </p>
                    <p className="mt-1 break-words text-[11px] text-slate-500 dark:text-white/45">
                      {formatDateTime(rollup.observedAt, language)} / {formatBytes(rollup.meteredBytes)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{t.noUsageEvidence}</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.usageEvidenceCompactions}
            </p>
            {rowCompactions.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {rowCompactions.map((compaction) => (
                  <div key={compaction.id} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
                    <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/70">
                      {compaction.id}
                    </p>
                    <p className="mt-1 break-words text-[11px] text-slate-500 dark:text-white/45">
                      {formatDateTime(compaction.bucketStartAt, language)} / {formatNumber(compaction.sampleCount, language)}{' '}
                      {t.usageSamples} / {formatBytes(compaction.meteredBytesTotal)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{t.noUsageEvidence}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-600 dark:bg-white dark:text-slate-900 dark:hover:bg-primary"
              onClick={() => copyUsageEvidence(row, rollups, compactions)}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyUsageEvidence}
            </button>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

function UsageLedgerPanel({
  busy = false,
  compactions,
  language,
  policy,
  retentionBusy = false,
  rollups,
  onExportCompactions,
  onExportRollups,
  onUpdateRetentionPolicy
}: {
  busy?: boolean;
  compactions: TrafficRollupCompaction[];
  language: AppLanguage;
  policy?: TrafficRollupRetentionPolicyReadModel;
  retentionBusy?: boolean;
  rollups: TrafficRollup[];
  onExportCompactions?: (dimension: TrafficRollup['dimension']) => void;
  onExportRollups?: (dimension: TrafficRollup['dimension']) => void;
  onUpdateRetentionPolicy?: (input: TrafficRollupRetentionPolicyUpdateInput) => void;
}) {
  const t = copy[language];
  const [usageSearch, setUsageSearch] = useState('');
  const [dimensionFilter, setDimensionFilter] = useState<UsageDimensionFilter>('all');
  const [selectedUsageRow, setSelectedUsageRow] = useState<UsageLedgerRow | undefined>();
  const [maxAgeDays, setMaxAgeDays] = useState(policy?.maxAgeDays ? String(policy.maxAgeDays) : '62');
  const [maxRecordsPerScope, setMaxRecordsPerScope] = useState(
    policy?.maxRecordsPerScope !== undefined ? String(policy.maxRecordsPerScope) : '200000'
  );
  const usageRows = useMemo(() => createUsageLedgerRows(rollups, compactions), [compactions, rollups]);
  const filteredRows = useMemo(
    () => filterUsageLedgerRows(usageRows, usageSearch, dimensionFilter),
    [dimensionFilter, usageRows, usageSearch]
  );
  const selectedDimension = dimensionFilter === 'all' ? undefined : dimensionFilter;
  const totalMeteredBytes = filteredRows.reduce((sum, row) => sum + row.meteredBytes, 0);
  const filteredSampleCount = filteredRows.reduce((sum, row) => sum + row.sampleCount, 0);
  const parsedMaxAgeDays = Number(maxAgeDays);
  const parsedMaxRecordsPerScope = Number(maxRecordsPerScope);
  const retentionInputValid =
    Number.isFinite(parsedMaxAgeDays)
    && parsedMaxAgeDays > 0
    && parsedMaxAgeDays <= 3650
    && Number.isFinite(parsedMaxRecordsPerScope)
    && Number.isInteger(parsedMaxRecordsPerScope)
    && parsedMaxRecordsPerScope >= 0
    && parsedMaxRecordsPerScope <= 1_000_000;

  useEffect(() => {
    if (!policy) {
      return;
    }

    setMaxAgeDays(String(policy.maxAgeDays));
    setMaxRecordsPerScope(String(policy.maxRecordsPerScope));
  }, [policy]);

  function handleRetentionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!onUpdateRetentionPolicy || !retentionInputValid) {
      return;
    }

    const confirmed =
      typeof window === 'undefined'
      || window.confirm(t.confirmUsageRetentionSave(parsedMaxAgeDays, parsedMaxRecordsPerScope, language));

    if (!confirmed) {
      return;
    }

    onUpdateRetentionPolicy({
      maxAgeDays: parsedMaxAgeDays,
      maxRecordsPerScope: parsedMaxRecordsPerScope,
      reason: t.usageRetentionSaveReason
    });
  }

  return (
    <>
      <GlassCard className="stagger-3 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                {t.usageLedgerTitle} · {formatBytes(totalMeteredBytes)}
              </h4>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-white/50">{t.usageLedgerSubtitle}</p>
          </div>
          {policy ? (
            <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/45">
              <span>{t.usageRetentionTitle}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.usageRetentionAge(formatNumber(policy.maxAgeDays, language))}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.usageRetentionLimit(formatNumber(policy.maxRecordsPerScope, language))}
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-600 dark:bg-primary/15 dark:text-primary">
                {t.usageRetentionSourceLabels[policy.source]}
              </span>
            </div>
          ) : null}
        </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_auto_auto]">
        <label className="relative block min-w-0">
          <span className="sr-only">{t.searchUsageLedger}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-white/35" />
          <input
            aria-label={t.searchUsageLedger}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white/70 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:focus:border-primary/60 dark:focus:ring-primary/10"
            onChange={(event) => setUsageSearch(event.target.value)}
            placeholder={t.searchUsageLedgerPlaceholder}
            type="search"
            value={usageSearch}
          />
        </label>
        <label className="min-w-0">
          <span className="sr-only">{t.usageDimension}</span>
          <select
            aria-label={t.usageDimension}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-600 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:focus:border-primary/60 dark:focus:ring-primary/10"
            onChange={(event) => setDimensionFilter(event.target.value as UsageDimensionFilter)}
            value={dimensionFilter}
          >
            <option value="all">{t.allUsageDimensions}</option>
            {usageDimensions.map((dimension) => (
              <option key={dimension} value={dimension}>
                {t.usageDimensionLabels[dimension]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
          disabled={busy || !selectedDimension || !onExportRollups}
          onClick={() => selectedDimension && onExportRollups?.(selectedDimension)}
          type="button"
        >
          <Download className="h-3.5 w-3.5" />
          {t.exportUsageSamples}
        </button>
        <button
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
          disabled={busy || !selectedDimension || !onExportCompactions}
          onClick={() => selectedDimension && onExportCompactions?.(selectedDimension)}
          type="button"
        >
          <Archive className="h-3.5 w-3.5" />
          {t.exportUsageArchive}
        </button>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40 lg:col-span-4">
          {t.matchingUsage} {formatNumber(filteredSampleCount, language)} / {formatNumber(rollups.length, language)}
        </p>
      </div>

      {policy && onUpdateRetentionPolicy ? (
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={handleRetentionSubmit}>
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.usageRetentionDays}
            <input
              aria-label={t.usageRetentionDays}
              className="w-32 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={retentionBusy}
              max="3650"
              min="0.01"
              onChange={(event) => setMaxAgeDays(event.target.value)}
              step="0.01"
              type="number"
              value={maxAgeDays}
            />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.usageRetentionRecords}
            <input
              aria-label={t.usageRetentionRecords}
              className="w-36 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={retentionBusy}
              max="1000000"
              min="0"
              onChange={(event) => setMaxRecordsPerScope(event.target.value)}
              step="1"
              type="number"
              value={maxRecordsPerScope}
            />
          </label>
          <button
            className="rounded-lg border border-blue-400/40 bg-blue-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(59,130,246,0.25)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-primary/50 dark:bg-primary dark:text-slate-950"
            disabled={retentionBusy || !retentionInputValid}
            type="submit"
          >
            {t.saveUsageRetention}
          </button>
        </form>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {filteredRows.slice(0, 6).map((row) => (
          <article key={row.id} className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-600 dark:bg-primary/15 dark:text-primary">
                    {t.usageDimensionLabels[row.dimension]}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                    {row.periodKey}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm font-bold text-slate-800 dark:text-white">
                  {formatUsageLedgerSubjectLabel(row, t)}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                  {row.subjectId} / {row.agentId}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <p className="font-mono text-base font-black text-slate-900 dark:text-white">{formatBytes(row.meteredBytes)}</p>
                <button
                  aria-label={`${t.viewUsageEvidence} ${row.id}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55 dark:hover:border-primary/40 dark:hover:text-primary"
                  onClick={() => setSelectedUsageRow(row)}
                  type="button"
                >
                  <FileSearch className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <UsageInlineMetric label={t.usageIngress} value={formatBytes(row.ingressBytes)} />
              <UsageInlineMetric label={t.usageEgress} value={formatBytes(row.egressBytes)} />
              <UsageInlineMetric label={t.usageSamples} value={formatNumber(row.sampleCount, language)} />
              <UsageInlineMetric label={t.usageArchive} value={formatNumber(row.archiveCount, language)} />
            </div>
            <p className="mt-3 break-words text-[11px] font-semibold text-slate-500 dark:text-white/45">
              {t.usageLatestSample} {formatDateTime(row.latestObservedAt, language)} / {row.accountingMode}
            </p>
          </article>
        ))}
      </div>
        {filteredRows.length === 0 ? <EmptySignal label={t.usageNoMatches} /> : null}
      </GlassCard>
      <UsageEvidenceDrawer
        compactions={compactions}
        language={language}
        open={Boolean(selectedUsageRow)}
        row={selectedUsageRow}
        rollups={rollups}
        onClose={() => setSelectedUsageRow(undefined)}
      />
    </>
  );
}

export function DashboardPage({
  agents,
  nodes,
  tasks,
  auditLogs,
  forwardingRules,
  trafficRollups,
  trafficRollupCompactions,
  trafficRollupExportBusy,
  trafficRollupRetentionPolicy,
  trafficRollupRetentionBusy,
  systemAlerts,
  language,
  onExportTrafficRollupCompactions,
  onExportTrafficRollups,
  onUpdateTrafficRollupRetentionPolicy,
  onOpenHostWorkspace,
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const [alertSearch, setAlertSearch] = useState('');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<AlertSeverityFilter>('all');
  const [selectedAlert, setSelectedAlert] = useState<SystemAlert | undefined>();
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const runningTasks = tasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const activeSystemAlerts = systemAlerts.filter((alert) => alert.status === 'active');
  const filteredSystemAlerts = useMemo(
    () => filterSystemAlerts(activeSystemAlerts, alertSearch, alertSeverityFilter, t),
    [activeSystemAlerts, alertSearch, alertSeverityFilter, t]
  );
  const filteredAlertRecoveryPlanCount = useMemo(
    () => createAlertRecoveryPlanEntries(filteredSystemAlerts).length,
    [filteredSystemAlerts]
  );
  const criticalSystemAlerts = activeSystemAlerts.filter((alert) => alert.severity === 'critical').length;
  const totalTraffic = agents.reduce((sum, agent) => sum + agent.telemetry.txBytes + agent.telemetry.rxBytes, 0);
  const activeForwarding = forwardingRules.filter((rule) => rule.enabled).length;
  const topologyActive = agents.length > 0 || nodes.length > 0 || activeForwarding > 0;
  const visibleHostProbes = agents.slice(0, HOST_PROBE_LIMIT);

  const cards = [
    {
      label: t.cards.onlineAgents,
      value: `${onlineAgents}/${agents.length}`,
      icon: Activity,
      detail: `${t.cards.totalTraffic} ${formatBytes(totalTraffic)}`
    },
    {
      label: t.cards.nodeHealth,
      value: `${healthyNodes}/${nodes.length}`,
      icon: RadioTower,
      detail: t.cards.forwardingEnabled(formatNumber(activeForwarding, language))
    },
    {
      label: t.cards.taskPipeline,
      value: formatNumber(runningTasks, language),
      icon: ClipboardCheck,
      detail: t.cards.releaseTasks(formatNumber(tasks.length, language))
    },
    {
      label: t.cards.systemAlerts,
      value: `${formatNumber(criticalSystemAlerts, language)}/${formatNumber(activeSystemAlerts.length, language)}`,
      icon: FileSearch,
      detail: t.cards.activeAlerts(formatNumber(activeSystemAlerts.length, language))
    }
  ];

  return (
    <div className="space-y-5">
      <section className="stagger-1">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500 dark:text-white/50">{t.subtitle}</p>
          </div>
          <GlowButton className="px-4 py-2 text-xs font-bold" onClick={onRefresh}>
            {t.refresh}
          </GlowButton>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <GlassCard key={card.label} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                      {card.label}
                    </p>
                    <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{card.value}</p>
                  </div>
                  <Icon className="h-5 w-5 flex-shrink-0 text-blue-500 dark:text-primary" />
                </div>
                <p className="mt-3 truncate text-xs text-slate-500 dark:text-white/50">{card.detail}</p>
              </GlassCard>
            );
          })}
        </div>
      </section>

      <section className="stagger-2 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.hostProbeTitle}</h4>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-white/45">{t.hostProbeSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onOpenHostWorkspace ? (
              <GlowButton className="px-3 py-1.5 text-[11px] font-bold" onClick={onOpenHostWorkspace}>
                {t.manageHosts}
              </GlowButton>
            ) : null}
            <span className="rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/45">
              {t.hostProbeShowing(formatNumber(visibleHostProbes.length, language), formatNumber(agents.length, language))}
            </span>
          </div>
        </div>

        {visibleHostProbes.length === 0 ? (
          <EmptySignal label={t.hostProbeEmpty} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleHostProbes.map((agent) => (
              <HostProbeCard key={agent.id} agent={agent} language={language} t={t} />
            ))}
          </div>
        )}
      </section>

      <UsageLedgerPanel
        busy={trafficRollupExportBusy}
        compactions={trafficRollupCompactions}
        language={language}
        policy={trafficRollupRetentionPolicy}
        retentionBusy={trafficRollupRetentionBusy}
        rollups={trafficRollups}
        onExportCompactions={onExportTrafficRollupCompactions}
        onExportRollups={onExportTrafficRollups}
        onUpdateRetentionPolicy={onUpdateTrafficRollupRetentionPolicy}
      />

      <section className="stagger-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.topologyTitle}</h4>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-white/50">{t.topologyDescription}</p>
            </div>
            <span className={`status-dot ${topologyActive ? 'status-online' : 'status-idle'}`} />
          </div>
          <svg className="h-28 w-full" role="img" aria-label={t.topologyAria} viewBox="0 0 720 120">
            <defs>
              <linearGradient id="dashboard-flow-gradient" x1="0" x2="1" y1="0" y2="0">
                <stop className="svg-flow-stop-1" offset="0%" stopColor="#00f0ff" />
                <stop className="svg-flow-stop-2" offset="100%" stopColor="#7000ff" />
              </linearGradient>
            </defs>
            <circle cx="64" cy="60" r="24" fill="url(#dashboard-flow-gradient)" opacity="0.2" />
            <circle cx="360" cy="60" r="24" fill="url(#dashboard-flow-gradient)" opacity="0.2" />
            <circle cx="656" cy="60" r="24" fill="url(#dashboard-flow-gradient)" opacity="0.2" />
            <path
              className={topologyActive ? 'svg-line-dash' : 'opacity-25'}
              d="M 88 60 C 180 10, 260 10, 336 60 S 540 110, 632 60"
              fill="none"
              stroke="url(#dashboard-flow-gradient)"
              strokeLinecap="round"
              strokeWidth="3"
            />
            <text x="64" y="98" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-white/50">
              {t.topologyMaster}
            </text>
            <text x="360" y="98" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-white/50">
              {t.topologyManagedHosts}
            </text>
            <text x="656" y="98" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-white/50">
              {t.topologyForwarding}
            </text>
          </svg>
          {!topologyActive ? <EmptySignal label={t.topologyIdle} /> : null}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="truncate text-sm font-bold text-slate-800 dark:text-white">{t.activeAlerts}</h4>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
              {formatNumber(activeSystemAlerts.length, language)}
            </span>
          </div>
          {activeSystemAlerts.length > 0 ? (
            <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]">
              <label className="relative block min-w-0">
                <span className="sr-only">{t.searchAlerts}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-white/35" />
                <input
                  aria-label={t.searchAlerts}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white/70 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:focus:border-primary/60 dark:focus:ring-primary/10"
                  onChange={(event) => setAlertSearch(event.target.value)}
                  placeholder={t.searchAlertsPlaceholder}
                  type="search"
                  value={alertSearch}
                />
              </label>
              <label className="min-w-0">
                <span className="sr-only">{t.alertSeverity}</span>
                <select
                  aria-label={t.alertSeverity}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-600 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:focus:border-primary/60 dark:focus:ring-primary/10"
                  onChange={(event) => setAlertSeverityFilter(event.target.value as AlertSeverityFilter)}
                  value={alertSeverityFilter}
                >
                  <option value="all">{t.allAlertSeverities}</option>
                  {alertSeverities.map((severity) => (
                    <option key={severity} value={severity}>
                      {t.alertSeverityFilterLabels[severity]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03] lg:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.matchingAlerts} {formatNumber(filteredSystemAlerts.length, language)} /{' '}
                  {formatNumber(activeSystemAlerts.length, language)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 text-[11px] font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:border-primary/40 dark:hover:text-primary"
                    disabled={filteredSystemAlerts.length === 0}
                    onClick={() => copyAlertEvidenceSet(filteredSystemAlerts)}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.copyVisibleAlertEvidence}
                  </button>
                  <button
                    className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white/70 px-2.5 text-[11px] font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:border-blue-300/40 dark:hover:bg-blue-400/15"
                    disabled={filteredAlertRecoveryPlanCount === 0}
                    onClick={() => copyAlertRecoveryPlans(filteredSystemAlerts)}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t.copyVisibleAlertRecoveryPlans}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            {filteredSystemAlerts.map((alert) => {
              const deadLetterDiagnostics = formatDeadLetterDiagnostics(alert, language, t.deadLetterReasonLabels);

              return (
                <div key={alert.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-xs font-semibold text-slate-700 dark:text-white/70">
                      {t.alertKindLabels[alert.kind]} / {alert.resourceLabel}
                    </p>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          alert.severity === 'critical'
                            ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200'
                            : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-200'
                        }`}
                      >
                        {t.alertSeverityLabels[alert.severity]}
                      </span>
                      <button
                        aria-label={`${t.viewAlertEvidence} ${alert.id}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55 dark:hover:border-primary/40 dark:hover:text-primary"
                        onClick={() => setSelectedAlert(alert)}
                        type="button"
                      >
                        <FileSearch className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {deadLetterDiagnostics ? (
                    <p className="mt-1 break-words text-[11px] font-semibold text-slate-500 dark:text-white/45">
                      {deadLetterDiagnostics}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {activeSystemAlerts.length === 0 ? <EmptySignal label={t.alertsEmpty} /> : null}
            {activeSystemAlerts.length > 0 && filteredSystemAlerts.length === 0 ? (
              <EmptySignal label={t.noMatchingAlerts} />
            ) : null}
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.latestAudit}
            </p>
            {auditLogs[0] ? (
              <p className="mt-2 break-words text-xs text-slate-600 dark:text-white/60">
                {formatDateTime(auditLogs[0].createdAt, language)} / {auditLogs[0].message}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.auditEmpty}</p>
            )}
          </div>
        </GlassCard>
      </section>
      <AlertEvidenceDrawer
        alert={selectedAlert}
        language={language}
        open={Boolean(selectedAlert)}
        onClose={() => setSelectedAlert(undefined)}
      />
    </div>
  );
}

function HostProbeCard({ agent, language, t }: { agent: Agent; language: AppLanguage; t: DashboardCopy }) {
  const telemetryReported = hasTelemetryReport(agent);
  const monthlyUsedBytes = getMonthlyUsedBytes(agent);
  const monthlyLimitBytes = Math.max(agent.monthlyTrafficLimitBytes, 0);
  const monthlyPercent = monthlyLimitBytes > 0 ? clampPercent((monthlyUsedBytes / monthlyLimitBytes) * 100) : 0;
  const diskPercent = clampPercent(agent.telemetry.diskPercent ?? 0);
  const latencySamples = normalizeSamples(agent.telemetry.latencySamplesMs, agent.telemetry.latencyMs);
  const packetLossPercent = agent.telemetry.packetLossPercent ?? 0;
  const packetLossSamples = normalizeSamples(agent.telemetry.packetLossSamplesPercent, packetLossPercent);
  const sampleGapDetected = agent.telemetry.sampleGapDetected ?? false;
  const sampleStatus =
    telemetryReported || sampleGapDetected ? formatSamplingStatus(agent, language, t) : t.waitingTelemetry;
  const serviceIssueCount = runtimeServiceIssueCount(agent);
  const serviceHealthSummary = telemetryReported ? formatRuntimeServiceHealth(agent, t) : t.serviceWaiting;
  const addressFamily = agent.publicAddress.includes(':') ? 'IPv6' : 'IPv4';
  const modeBadge = agent.connectionMode.slice(0, 1).toUpperCase();
  const statusTone =
    agent.status === 'online'
      ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
      : agent.status === 'degraded'
        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.75)]'
        : agent.status === 'provisioning'
          ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.75)]'
          : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.75)]';

  return (
    <article className="min-w-0 rounded-[8px] border border-white/[0.06] border-t-white/[0.14] bg-[linear-gradient(145deg,rgba(30,35,45,0.48)_0%,rgba(15,18,25,0.78)_100%)] p-4 text-white/85 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300">
            <Globe2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <h5 className="min-w-0 truncate text-sm font-semibold tracking-wide text-white/95">{agent.name}</h5>
          <span className="flex-shrink-0 rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-300">
            {addressFamily}
          </span>
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/15 text-[10px] font-bold text-cyan-300">
            {modeBadge}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/65">
            {t.statusLabels[agent.status]}
          </span>
          <span className={cn('h-2 w-2 rounded-full', statusTone)} title={t.statusLabels[agent.status]} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/45">
        <span className="font-bold uppercase tracking-[0.18em] text-white/35">{t.runtimeHostName}</span>
        <span className="min-w-0 break-all font-mono text-white/70">{agent.runtimeHostName ?? agent.id}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/[0.04] bg-white/[0.025] p-2 text-[10px]">
        <ProbeInlineMetric label={t.lastReport} value={telemetryReported ? formatDateTime(agent.telemetry.reportedAt!, language) : '-'} />
        <ProbeInlineMetric label={t.loadAverageLabel} value={telemetryReported ? formatLoadAverage(agent) : '-'} />
      </div>

      {telemetryReported ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            <ProbeBarMetric
              detail={`${agent.telemetry.cpuCores ?? 1}${t.cpuCores}`}
              icon={Cpu}
              label="CPU"
              percent={agent.telemetry.cpuPercent}
              tone="from-blue-500 to-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
              value={formatPercent(agent.telemetry.cpuPercent)}
            />
            <ProbeBarMetric
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
            <ProbeBarMetric
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
            <ProbeBarMetric
              detail={`${t.trafficModeCardLabels[agent.trafficPolicy.accountingMode]} · ${formatResetDayCompact(
                agent.trafficPolicy.monthlyResetDay,
                language
              )}`}
              icon={RotateCw}
              label={t.monthly}
              percent={monthlyPercent}
              tone="from-cyan-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]"
              value={`${formatBytes(monthlyUsedBytes)} / ${gbWithSingleDecimalFromBytes(monthlyLimitBytes)}${t.unitGb}`}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-5 border-y border-white/[0.04] py-3">
            <ProbeTrafficMetric
              icon={Cloud}
              label={t.cards.totalTraffic}
              tone="text-emerald-400"
              total={formatBytes(agent.telemetry.downloadTotalBytes ?? agent.telemetry.rxBytes)}
              value={formatRate(agent.telemetry.downloadSpeedBps)}
            />
            <ProbeTrafficMetric
              icon={Network}
              label={t.cards.totalTraffic}
              tone="text-blue-400"
              total={formatBytes(agent.telemetry.uploadTotalBytes ?? agent.telemetry.txBytes)}
              value={formatRate(agent.telemetry.uploadSpeedBps)}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-5">
            <ProbeSegmentMetric
              label={t.latency}
              icon={Network}
              samples={latencySamples}
              toneForValue={(value) => latencyToneClass(value, agent.probeConfig, agent.telemetry.latencyStatus)}
              value={`${Math.round(agent.telemetry.latencyMs)} ms`}
            />
            <ProbeSegmentMetric
              label={t.packetLoss}
              icon={Cloud}
              samples={packetLossSamples}
              toneForValue={lossToneClass}
              value={`${packetLossPercent.toFixed(1)} %`}
            />
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs font-semibold text-amber-100">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" strokeWidth={1.5} />
            {sampleGapDetected ? formatSamplingStatus(agent, language, t) : t.waitingTelemetry}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-white/[0.05] pt-3 text-[11px]">
        <ProbeFooterMetric
          icon={RotateCw}
          label={t.expiry}
          tone="text-orange-400"
          value={`${remainingDaysUntil(agent.expiresAt)}${t.unitDays}`}
        />
        <ProbeFooterMetric
          icon={sampleGapDetected ? AlertTriangle : Activity}
          label={t.sampleStatus}
          tone={!telemetryReported ? 'text-white/45' : sampleGapDetected ? 'text-amber-300' : 'text-emerald-300'}
          value={sampleStatus}
        />
        <ProbeFooterMetric
          icon={!telemetryReported ? Activity : serviceIssueCount > 0 ? AlertTriangle : CheckCircle2}
          label={t.serviceHealthLabel}
          tone={!telemetryReported ? 'text-white/45' : serviceIssueCount > 0 ? 'text-amber-300' : 'text-emerald-300'}
          value={serviceHealthSummary}
        />
        <ProbeFooterMetric
          icon={CheckCircle2}
          label={t.online}
          tone="text-blue-400"
          value={telemetryReported ? `${agent.telemetry.onlineDays ?? 0}${t.unitDays}` : '-'}
        />
      </div>
    </article>
  );
}

function EmptySignal({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
      {label}
    </div>
  );
}

function UsageInlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
      <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 truncate font-mono text-[11px] font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}

function ProbeInlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-bold uppercase tracking-[0.16em] text-white/35">{label}</p>
      <p className="mt-1 truncate font-mono text-white/70">{value}</p>
    </div>
  );
}

function ProbeBarMetric({
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
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5 text-white/50">
          <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.5} />
          <span className="truncate">{label}</span>
        </span>
        <span className="truncate font-mono font-semibold tabular-nums text-white/90">{value}</span>
      </div>
      <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-black/50 shadow-inner">
        <div className={cn('h-full rounded-full bg-gradient-to-r', tone)} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
      <div className="truncate text-right font-mono text-[10px] text-white/30">{detail}</div>
    </div>
  );
}

function ProbeTrafficMetric({
  icon: Icon,
  label,
  tone,
  total,
  value
}: {
  icon: typeof Cloud;
  label: string;
  tone: string;
  total: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-1 flex items-end justify-between gap-2">
        <Icon className={cn('h-4 w-4 flex-shrink-0', tone)} />
        <p className={cn('truncate font-mono text-sm font-bold tabular-nums', tone)}>
          {value.split(' ')[0]} <span className="font-sans text-[10px] opacity-70">{value.split(' ').slice(1).join(' ')}</span>
        </p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/30">
        <span className="truncate">{label}</span>
        <span className="truncate font-mono">{total}</span>
      </div>
    </div>
  );
}

function ProbeSegmentMetric({
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
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-white/50">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3 w-3 flex-shrink-0" strokeWidth={1.5} />
          <span className="truncate">{label}</span>
        </span>
        <span className="truncate font-mono font-bold text-white/90">{value}</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full items-center justify-between gap-[2px]">
        {samples.map((sample, index) => (
          <div key={`${sample}-${index}`} className={cn('h-full flex-1 rounded-[2px] opacity-80', toneForValue(sample))} />
        ))}
      </div>
    </div>
  );
}

function ProbeFooterMetric({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof Activity;
  label: string;
  tone: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-white/40">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.5} />
      <span className="truncate">{label}</span>
      <span className={cn('ml-1 max-w-[6rem] truncate font-semibold', tone)}>{value}</span>
    </div>
  );
}
