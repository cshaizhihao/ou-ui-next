import {
  Activity,
  Archive,
  ArrowRight,
  Network,
  RadioTower
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ResponsivePage, ResponsiveSection } from '../../components/layout/responsive-page';
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
import { formatDateTime, formatNumber, formatPercent } from '../shared/format';
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
  onOpenForwardingWorkspace?: () => void;
  onOpenReleaseEvidenceWorkspace?: () => void;
  onRefresh: () => void;
};

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
    hostProbeEmpty: '等待接入',
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
    connectivityTitle: '连通性',
    connectivityAria: '主机到已挂载主机到节点连通性',
    connectivityHost: '主机',
    connectivityMountedHost: '已挂载主机',
    connectivityNode: '节点',
    controlSurfaceRegion: '控制面',
    operationsRailRegion: '运维侧栏',
    hostTelemetryRegion: '主机遥测',
    releaseEvidenceRegion: '发布证据',
    auditAlertRegion: '审计与告警',
    responseActionsRegion: '首屏处置入口',
    responseActionsTitle: '首屏处置入口',
    responseActions: {
      hosts: '接入主机',
      forwarding: '配置转发',
      releaseEvidence: '查看发布证据'
    },
    productionReadinessRegion: '生产就绪门禁',
    productionReadinessTitle: '生产就绪门禁',
    productionReadinessGateCount: (count: number, language: AppLanguage) => `${formatNumber(count, language)} 条门禁`,
    productionReadinessStates: {
      ready: '就绪',
      issues: '关注',
      waiting: '等待'
    },
    productionReadinessGateLabels: {
      host: '主机通道',
      traffic: '流量链路',
      release: '发布证据',
      alerts: '告警压力'
    },
    productionReadinessValues: {
      trafficEnabled: '启用'
    },
    productionReadinessDetails: {
      host: (online: number, total: number, language: AppLanguage) =>
        `${formatNumber(online, language)}/${formatNumber(total, language)} 在线`,
      traffic: (forwardingCount: number, nodeCount: number, language: AppLanguage) =>
        `${formatNumber(forwardingCount, language)} 转发 · ${formatNumber(nodeCount, language)} 节点`,
      release: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
        `配置 ${formatNumber(configCount, language)} · 预检 ${formatNumber(preflightCount, language)} · 快照 ${formatNumber(snapshotCount, language)}`,
      alerts: (alertCount: number, language: AppLanguage) => `${formatNumber(alertCount, language)} 活动告警`
    },
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    releaseEvidence: 'Release Evidence',
    releaseEvidenceSummary: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(preflightCount, language)} / Snapshot ${formatNumber(snapshotCount, language)}`,
    latestConfigRevision: '最新配置版本',
    latestPreflightPlan: '最新预检计划',
    latestSnapshot: '最新快照',
    noReleaseEvidence: '暂无发布证据',
    rollbackBoundary: '回滚边界',
    rollbackReady: '回滚可用',
    rollbackLocked: '回滚不可用',
    rollbackWaiting: '等待执行记录',
    rollbackReadyDescription: '最近执行保留可回滚快照与审计线索。',
    rollbackLockedDescription: '最近执行未开放回滚，需进入发布证据工作区确认。',
    auditAlertEvidence: 'Audit & Alerts',
    auditAlertSummary: (auditCount: number, alertCount: number, language: AppLanguage) =>
      `Audit ${formatNumber(auditCount, language)} / Alerts ${formatNumber(alertCount, language)}`,
    latestExecution: '最近执行',
    latestExecutionEmpty: '等待发布任务',
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
    hostProbeEmpty: 'Waiting for host',
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
    connectivityTitle: 'Connectivity',
    connectivityAria: 'Host to mounted host to node connectivity',
    connectivityHost: 'Host',
    connectivityMountedHost: 'Mounted Host',
    connectivityNode: 'Node',
    controlSurfaceRegion: 'Control Surface',
    operationsRailRegion: 'Operations Rail',
    hostTelemetryRegion: 'Host Telemetry',
    releaseEvidenceRegion: 'Release Evidence',
    auditAlertRegion: 'Audit & Alerts',
    responseActionsRegion: 'First-screen Response',
    responseActionsTitle: 'First-screen Response',
    responseActions: {
      hosts: 'Enroll Hosts',
      forwarding: 'Configure Forwarding',
      releaseEvidence: 'Review Release Evidence'
    },
    productionReadinessRegion: 'Production readiness gates',
    productionReadinessTitle: 'Production readiness gates',
    productionReadinessGateCount: (count: number, language: AppLanguage) =>
      `${formatNumber(count, language)} ${count === 1 ? 'gate' : 'gates'}`,
    productionReadinessStates: {
      ready: 'Ready',
      issues: 'Review',
      waiting: 'Waiting'
    },
    productionReadinessGateLabels: {
      host: 'Host Channel',
      traffic: 'Traffic Path',
      release: 'Release Evidence',
      alerts: 'Alert Pressure'
    },
    productionReadinessValues: {
      trafficEnabled: 'Enabled'
    },
    productionReadinessDetails: {
      host: (online: number, total: number, language: AppLanguage) =>
        `${formatNumber(online, language)}/${formatNumber(total, language)} online`,
      traffic: (forwardingCount: number, nodeCount: number, language: AppLanguage) =>
        `${formatNumber(forwardingCount, language)} forwarding · ${formatNumber(nodeCount, language)} ${nodeCount === 1 ? 'node' : 'nodes'}`,
      release: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
        `Config ${formatNumber(configCount, language)} · Preflight ${formatNumber(preflightCount, language)} · Snapshot ${formatNumber(snapshotCount, language)}`,
      alerts: (alertCount: number, language: AppLanguage) =>
        `${formatNumber(alertCount, language)} active ${alertCount === 1 ? 'alert' : 'alerts'}`
    },
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    releaseEvidence: 'Release Evidence',
    releaseEvidenceSummary: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(preflightCount, language)} / Snapshot ${formatNumber(snapshotCount, language)}`,
    latestConfigRevision: 'Latest Config Revision',
    latestPreflightPlan: 'Latest Preflight Plan',
    latestSnapshot: 'Latest Snapshot',
    noReleaseEvidence: 'No release evidence available',
    rollbackBoundary: 'Rollback Boundary',
    rollbackReady: 'Rollback Ready',
    rollbackLocked: 'Rollback Locked',
    rollbackWaiting: 'Waiting for execution record',
    rollbackReadyDescription: 'Latest execution retains rollback snapshot and audit cues.',
    rollbackLockedDescription: 'Latest execution has no open rollback. Review release evidence before recovery.',
    auditAlertEvidence: 'Audit & Alerts',
    auditAlertSummary: (auditCount: number, alertCount: number, language: AppLanguage) =>
      `Audit ${formatNumber(auditCount, language)} / Alerts ${formatNumber(alertCount, language)}`,
    latestExecution: 'Latest Execution',
    latestExecutionEmpty: 'Waiting for release task',
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
type ResponseAction = {
  id: string;
  icon: typeof Activity;
  label: string;
  metric: string;
  tone: 'blue' | 'orange' | 'slate';
  onClick: () => void;
};

type ProductionReadinessState = 'ready' | 'issues' | 'waiting';
type ProductionReadinessGate = {
  id: string;
  label: string;
  value: string;
  detail: string;
  state: ProductionReadinessState;
  tone: 'blue' | 'green' | 'orange' | 'chartreuse';
};

const responseActionToneClasses = {
  blue: {
    card: 'border-[#1E3AFF] bg-[#DCE1FF] text-[#07111F] hover:bg-[#1E3AFF] hover:text-white dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/14 dark:text-[#F4F8FF] dark:hover:bg-[#6B7CFF] dark:hover:text-[#07111F]',
    icon: 'border-[#1E3AFF] bg-[#1E3AFF] text-white dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]'
  },
  orange: {
    card: 'border-[#FF3D18] bg-[#FFD8C6]/72 text-[#07111F] hover:bg-[#FF3D18] hover:text-white dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12 dark:text-[#F4F8FF] dark:hover:bg-[#FF6A3A] dark:hover:text-[#07111F]',
    icon: 'border-[#FF3D18] bg-[#FF3D18] text-white dark:border-[#FF6A3A] dark:bg-[#FF6A3A] dark:text-[#07111F]'
  },
  slate: {
    card: 'border-[#07111F] bg-[#D9FF00]/28 text-[#07111F] hover:bg-[#D9FF00] dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4F8FF] dark:hover:bg-[#EAFF5A] dark:hover:text-[#07111F]',
    icon: 'border-[#07111F] bg-[#07111F] text-[#D9FF00] dark:border-[#EAFF5A] dark:bg-[#EAFF5A] dark:text-[#07111F]'
  }
} as const;

const productionReadinessToneClasses = {
  blue: {
    item: 'border-[#1E3AFF] bg-[#DCE1FF]/72 dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/12',
    badge: 'border-[#1E3AFF] bg-[#1E3AFF] text-white dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]',
    rail: 'bg-[#1E3AFF]'
  },
  green: {
    item: 'border-[#00A878] bg-[#00A878]/[0.12] dark:border-[#35E68E]/35 dark:bg-[#35E68E]/10',
    badge: 'border-[#00A878] bg-[#00A878] text-white dark:border-[#35E68E] dark:bg-[#35E68E] dark:text-[#07111F]',
    rail: 'bg-[#00A878]'
  },
  orange: {
    item: 'border-[#FF3D18] bg-[#FF3D18]/[0.12] dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12',
    badge: 'border-[#FF3D18] bg-[#FF3D18] text-white dark:border-[#FF6A3A] dark:bg-[#FF6A3A] dark:text-[#07111F]',
    rail: 'bg-[#FF3D18]'
  },
  chartreuse: {
    item: 'border-[#D9FF00] bg-[#D9FF00]/[0.26] dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12',
    badge: 'border-[#07111F] bg-[#D9FF00] text-[#07111F] dark:border-[#EAFF5A] dark:bg-[#EAFF5A] dark:text-[#07111F]',
    rail: 'bg-[#D9FF00]'
  }
} as const;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function hasTelemetryReport(agent: Agent) {
  return Boolean(agent.telemetry.reportedAt);
}

export function DashboardPage({
  agents,
  nodes,
  tasks,
  auditLogs,
  forwardingRules,
  subscriptions,
  configRevisions,
  preflightPlans,
  runtimeSnapshots,
  systemAlerts,
  language,
  onOpenHostWorkspace,
  onOpenForwardingWorkspace,
  onOpenReleaseEvidenceWorkspace,
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const activeForwarding = forwardingRules.filter((rule) => rule.enabled).length;
  const visibleHostProbes = agents.slice(0, 3);
  const connectivityActive = agents.length > 0 || nodes.length > 0 || activeForwarding > 0;
  const activeAlerts = systemAlerts.filter((alert) => alert.status === 'active').length;
  const latestTask = tasks[0];
  const latestConfigRevision = getLatestReleaseRecord(configRevisions, (revision) => revision.createdAt);
  const latestPreflightPlan = getLatestReleaseRecord(preflightPlans, (plan) => plan.createdAt);
  const latestRuntimeSnapshot = getLatestReleaseRecord(runtimeSnapshots, (snapshot) => snapshot.capturedAt);
  const responseActions: ResponseAction[] = [];
  const productionReadinessGates = createProductionReadinessGates({
    activeAlerts,
    activeForwarding,
    configRevisions,
    language,
    nodes,
    onlineAgents,
    preflightPlans,
    runtimeSnapshots,
    t,
    totalAgents: agents.length
  });
  const productionReadinessState: ProductionReadinessState = productionReadinessGates.some((gate) => gate.state === 'issues')
    ? 'issues'
    : productionReadinessGates.some((gate) => gate.state === 'waiting')
      ? 'waiting'
      : 'ready';

  if (onOpenHostWorkspace) {
    responseActions.push({
      id: 'hosts',
      icon: Activity,
      label: t.responseActions.hosts,
      metric: `${formatNumber(onlineAgents, language)}/${formatNumber(agents.length, language)}`,
      tone: 'blue',
      onClick: onOpenHostWorkspace
    });
  }

  if (onOpenForwardingWorkspace) {
    responseActions.push({
      id: 'forwarding',
      icon: Network,
      label: t.responseActions.forwarding,
      metric: formatNumber(activeForwarding, language),
      tone: 'orange',
      onClick: onOpenForwardingWorkspace
    });
  }

  if (onOpenReleaseEvidenceWorkspace) {
    responseActions.push({
      id: 'releaseEvidence',
      icon: Archive,
      label: t.responseActions.releaseEvidence,
      metric: formatNumber(configRevisions.length + preflightPlans.length + runtimeSnapshots.length, language),
      tone: 'slate',
      onClick: onOpenReleaseEvidenceWorkspace
    });
  }

  const cockpitCards = [
    {
      label: language === 'zh' ? '主机接入' : 'Host Access',
      value: `${onlineAgents}/${agents.length}`,
      detail: language === 'zh' ? '在线 Agent' : 'online agents',
      icon: Activity,
      tone: 'from-[#1E3AFF] to-[#FF3D18]'
    },
    {
      label: language === 'zh' ? '客户节点' : 'Customer Nodes',
      value: `${healthyNodes}/${nodes.length}`,
      detail: language === 'zh' ? '健康节点' : 'healthy nodes',
      icon: RadioTower,
      tone: 'from-[#00A878] to-[#1E3AFF]'
    },
    {
      label: language === 'zh' ? '端口转发' : 'Forwarding',
      value: formatNumber(activeForwarding, language),
      detail: language === 'zh' ? '启用规则' : 'active rules',
      icon: Network,
      tone: 'from-[#D9FF00] to-[#FF3D18]'
    },
    {
      label: language === 'zh' ? '订阅交付' : 'Subscriptions',
      value: formatNumber(subscriptions.length, language),
      detail: language === 'zh' ? '订阅包' : 'bundles',
      icon: Archive,
      tone: 'from-[#07111F] to-[#1E3AFF]'
    }
  ];

  return (
    <ResponsivePage className="dashboard-cockpit dashboard-control-plane overflow-hidden max-md:overflow-visible">
      <ResponsiveSection
        aria-label={t.controlPlaneOverviewAria}
        className="dashboard-control-plane grid grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)] gap-3 max-xl:grid-cols-1"
        compactOnMobile={false}
      >
        <section aria-label={t.controlSurfaceRegion} className="grid min-w-0 gap-3">
          <GlassCard className="dashboard-control-plane-surface relative isolate min-h-0 self-start overflow-hidden !border-[#07111F] !bg-[#FFFDF5] p-0 !shadow-[0_16px_42px_-34px_rgba(7,17,31,0.32)] dark:!border-[#6B7CFF]/25 dark:!bg-[#07111F] dark:!shadow-black/40">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(30,58,255,0.26)_0%,rgba(30,58,255,0.26)_25%,transparent_25%),linear-gradient(225deg,rgba(255,61,24,0.2)_0%,rgba(255,61,24,0.2)_22%,transparent_22%),linear-gradient(315deg,rgba(217,255,0,0.22)_0%,rgba(217,255,0,0.22)_18%,transparent_18%),linear-gradient(180deg,#FFFDF5_0%,#FDFFF1_100%)] dark:bg-[linear-gradient(135deg,rgba(107,124,255,0.2)_0%,rgba(107,124,255,0.2)_25%,transparent_25%),linear-gradient(225deg,rgba(255,106,58,0.18)_0%,rgba(255,106,58,0.18)_22%,transparent_22%),linear-gradient(315deg,rgba(234,255,90,0.16)_0%,rgba(234,255,90,0.16)_18%,transparent_18%),linear-gradient(180deg,#07111F_0%,#101827_100%)]" aria-hidden="true" />
            <div className="relative z-10 flex h-full min-h-0 flex-col justify-between gap-4 p-3 md:p-4">
              <div className="max-w-3xl">
                <p className="text-sm font-black tracking-[0.01em] text-[#1E3AFF] dark:text-[#6B7CFF]">
                  {t.controlPlaneLabel}
                </p>
                <h3 className="mt-2 max-w-4xl text-balance text-4xl font-black leading-[0.96] tracking-[-0.035em] text-[#07111F] md:text-5xl dark:text-[#F4F8FF]">
                  {t.connectivityTitle}
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="dashboard-control-plane-media relative min-h-[10rem] overflow-hidden rounded-lg border border-[#07111F] bg-[#07111F] shadow-[0_14px_34px_-26px_rgba(0,0,0,0.62)] dark:border-[#6B7CFF]/30">
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(30,58,255,0.52)_0%,rgba(30,58,255,0.52)_30%,transparent_30%),linear-gradient(225deg,rgba(255,61,24,0.48)_0%,rgba(255,61,24,0.48)_24%,transparent_24%),linear-gradient(315deg,rgba(0,168,120,0.38)_0%,rgba(0,168,120,0.38)_20%,transparent_20%),linear-gradient(120deg,rgba(7,17,31,0.12),rgba(7,17,31,0.92))]" aria-hidden="true" />
                  <svg className="relative z-10 h-40 w-full" role="img" aria-label={t.connectivityAria} viewBox="0 0 720 190">
                    <defs>
                      <linearGradient id="dashboard-control-plane-flow" x1="0" x2="1" y1="0" y2="0">
                        <stop className="svg-flow-stop-1" offset="0%" stopColor="#6B7CFF" />
                        <stop className="svg-flow-stop-2" offset="58%" stopColor="#D9FF00" />
                        <stop className="svg-flow-stop-3" offset="100%" stopColor="#FF3D18" />
                      </linearGradient>
                    </defs>
                    <path
                      className={connectivityActive ? 'dashboard-connectivity-flow svg-line-dash' : 'dashboard-connectivity-flow opacity-35'}
                      d="M 120 92 C 205 38, 275 146, 360 92 S 515 38, 600 92"
                      fill="none"
                      stroke="url(#dashboard-control-plane-flow)"
                      strokeLinecap="round"
                      strokeWidth="5"
                    />
                    {[
                      { cx: 120, label: t.connectivityHost },
                      { cx: 360, label: t.connectivityMountedHost },
                      { cx: 600, label: t.connectivityNode }
                    ].map((node, index) => (
                      <g className="dashboard-connectivity-node" key={node.label}>
                        <circle cx={node.cx} cy="92" r="38" fill="url(#dashboard-control-plane-flow)" opacity={0.14 + index * 0.04} />
                        <circle cx={node.cx} cy="92" r="16" fill="#F4F8FF" />
                        <circle cx={node.cx} cy="92" r="8" fill={index === 0 ? '#6B7CFF' : index === 1 ? '#D9FF00' : '#FF3D18'} />
                        <text x={node.cx} y="154" textAnchor="middle" className="fill-[#f4f8ff] text-[13px] font-black">
                          {node.label}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>

                <GlowButton className="h-12 px-5 text-xs font-black tracking-widest" onClick={onRefresh}>
                  {t.refresh}
                </GlowButton>
              </div>
            </div>
          </GlassCard>

          <div className="dashboard-control-plane-metric-grid grid grid-cols-2 gap-2 xl:grid-cols-4 max-sm:grid-cols-1">
            {cockpitCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="group relative min-h-[78px] overflow-hidden rounded-lg border border-[#07111F] bg-[#FFFDF5] p-2.5 shadow-[0_12px_28px_-24px_rgba(7,17,31,0.3)] transition duration-200 hover:-translate-y-0.5 hover:bg-white dark:border-[#6B7CFF]/20 dark:bg-white/[0.045] dark:shadow-black/20 dark:hover:bg-white/[0.06]"
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.tone}`} />
                  <div className="flex h-full flex-col justify-between gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-[10px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/72">{card.label}</p>
                      <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-gradient-to-br ${card.tone} text-[#F4F8FF] shadow-sm shadow-black/20 transition duration-200 group-hover:scale-105`}>
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <div>
                      <p className="text-2xl font-black tracking-[-0.035em] text-[#07111F] dark:text-[#F4F8FF]">{card.value}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-[#536078] dark:text-[#B8C2E6]/68">{card.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {responseActions.length > 0 ? (
            <section aria-label={t.responseActionsRegion} className="dashboard-response-actions rounded-lg border border-[#07111F] bg-[#FFFDF5] p-3 shadow-[0_14px_32px_-28px_rgba(7,17,31,0.34)] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:shadow-black/20">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{t.responseActionsTitle}</h4>
                </div>
                <span className="rounded-full border border-[#07111F]/25 bg-[#D9FF00]/[0.24] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#07111F] dark:border-[#EAFF5A]/25 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]">
                  {formatNumber(responseActions.length, language)} routes
                </span>
              </div>
              <div className="dashboard-response-action-grid mt-2 grid gap-2 md:grid-cols-3">
                {responseActions.map((action) => (
                  <ResponseActionButton key={action.id} action={action} />
                ))}
              </div>
            </section>
          ) : null}
        </section>

        <section aria-label={t.operationsRailRegion} className="grid min-w-0 gap-3">
          <ProductionReadinessPanel
            gates={productionReadinessGates}
            language={language}
            state={productionReadinessState}
            t={t}
          />

          <section aria-label={t.hostTelemetryRegion} className="min-w-0">
            <GlassCard className="dashboard-control-plane-hosts flex min-h-0 flex-col overflow-hidden border-[#07111F] bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{t.hostProbeTitle}</h4>
                </div>
                {onOpenHostWorkspace ? (
                  <GlowButton className="px-3 py-1.5 text-[11px] font-bold" onClick={onOpenHostWorkspace}>
                    {t.manageHosts}
                  </GlowButton>
                ) : null}
              </div>

              <div className="grid min-h-0 flex-1 gap-3 overflow-hidden">
                {visibleHostProbes.length === 0 ? (
                  <EmptySignal label={t.hostProbeEmpty} />
                ) : (
                  visibleHostProbes.map((agent) => <CompactHostProbeCard key={agent.id} agent={agent} language={language} t={t} />)
                )}
              </div>
            </GlassCard>
          </section>

          <section aria-label={t.releaseEvidenceRegion} className="min-w-0">
            <GlassCard className="flex min-h-0 flex-col overflow-hidden border-[#07111F] bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-[#B8C2E6]/72">{t.releaseEvidence}</p>
                  <p className="mt-1 text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">
                    {t.releaseEvidenceSummary(configRevisions.length, preflightPlans.length, runtimeSnapshots.length, language)}
                  </p>
                </div>
                <span className="rounded-full border border-[#07111F]/25 bg-[#DCE1FF] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/14 dark:text-white">
                  {latestTask ? latestTask.status : t.latestExecutionEmpty}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <EvidenceChip label="Config" value={formatNumber(configRevisions.length, language)} />
                <EvidenceChip label="Preflight" value={formatNumber(preflightPlans.length, language)} />
                <EvidenceChip label="Snapshot" value={formatNumber(runtimeSnapshots.length, language)} />
              </div>
              <ReleaseRollbackBoundary task={latestTask} t={t} />
              <div className="mt-3 grid gap-2">
                <ReleaseEvidenceRow label={t.latestConfigRevision} record={latestConfigRevision} fallbackLabel={t.noReleaseEvidence} />
                <ReleaseEvidenceRow label={t.latestPreflightPlan} record={latestPreflightPlan} fallbackLabel={t.noReleaseEvidence} />
                <ReleaseEvidenceRow label={t.latestSnapshot} record={latestRuntimeSnapshot} fallbackLabel={t.noReleaseEvidence} />
              </div>
              <p className="mt-3 truncate text-xs font-semibold text-slate-500 dark:text-white/[.48]">
                {latestTask ? `${t.latestExecution}: ${latestTask.status}` : t.latestExecutionEmpty}
              </p>
            </GlassCard>
          </section>

          <section aria-label={t.auditAlertRegion} className="min-w-0">
            <GlassCard className="flex min-h-0 flex-col overflow-hidden border-[#07111F] bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/72">{t.auditAlertEvidence}</p>
                  <p className="text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{t.auditAlertSummary(auditLogs.length, activeAlerts, language)}</p>
                </div>
                <span className="rounded-full border border-[#07111F]/25 bg-[#D9FF00]/[0.22] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[#07111F] dark:border-[#EAFF5A]/20 dark:bg-[#EAFF5A]/10 dark:text-[#F4FFC5]">
                  {activeAlerts > 0 ? formatNumber(activeAlerts, language) : '0'}
                </span>
              </div>
              <p className="mt-3 truncate text-xs font-semibold text-[#536078] dark:text-[#B8C2E6]/68">{auditLogs[0]?.message ?? t.auditEmpty}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <EvidenceChip label="Audit" value={formatNumber(auditLogs.length, language)} />
                <EvidenceChip label="Alerts" value={formatNumber(activeAlerts, language)} />
              </div>
            </GlassCard>
          </section>
        </section>
      </ResponsiveSection>
    </ResponsivePage>
  );
}

function CompactHostProbeCard({ agent, language, t }: { agent: Agent; language: AppLanguage; t: DashboardCopy }) {
  const telemetryReported = hasTelemetryReport(agent);
  const cpuPercent = clampPercent(agent.telemetry.cpuPercent ?? 0);
  const memoryPercent = clampPercent(agent.telemetry.memoryPercent ?? 0);
  const diskPercent = clampPercent(agent.telemetry.diskPercent ?? 0);
  const statusTone =
    agent.status === 'online'
      ? 'bg-[#00A878] shadow-[0_0_12px_rgba(0,168,120,0.65)]'
      : agent.status === 'degraded'
        ? 'bg-[#D9FF00] shadow-[0_0_12px_rgba(217,255,0,0.65)]'
        : 'bg-[#536078] shadow-[0_0_12px_rgba(83,96,120,0.6)]';

  return (
    <article className="group min-h-0 rounded-lg border border-[#07111F] bg-[#FFFDF5] p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-26px_rgba(7,17,31,0.38)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', statusTone)} />
          <div className="min-w-0">
            <h5 className="truncate text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{agent.name}</h5>
            <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">
              {telemetryReported ? formatDateTime(agent.telemetry.reportedAt!, language) : t.waitingTelemetry}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-[#07111F] bg-[#1E3AFF] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#F4F8FF] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF] dark:text-[#07111F]">
          {t.statusLabels[agent.status]}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <CompactProbeBar label="CPU" value={formatPercent(cpuPercent)} percent={cpuPercent} />
        <CompactProbeBar label={t.memory} value={formatPercent(memoryPercent)} percent={memoryPercent} />
        <CompactProbeBar label={t.disk} value={formatPercent(diskPercent)} percent={diskPercent} />
      </div>
    </article>
  );
}

function ResponseActionButton({ action }: { action: ResponseAction }) {
  const Icon = action.icon;
  const tone = responseActionToneClasses[action.tone];

  return (
    <button
      className={cn(
        'group min-h-[68px] rounded-lg border p-2 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-24px_rgba(7,17,31,0.42)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/55 active:translate-y-0 dark:focus-visible:ring-[#6B7CFF]/60',
        tone.card
      )}
      onClick={action.onClick}
      type="button"
    >
      <span className="flex items-start justify-between gap-3">
        <span className={cn('grid h-7 w-7 flex-shrink-0 place-items-center rounded-md border shadow-sm transition duration-200 group-hover:scale-105', tone.icon)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="rounded-full border border-[#07111F]/25 bg-[#FFFDF5] px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:border-white/10 dark:bg-white/5 dark:text-white/60">
          {action.metric}
        </span>
      </span>
      <span className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-xs font-black">{action.label}</span>
        </span>
        <ArrowRight className="h-4 w-4 flex-shrink-0 transition duration-200 group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function createProductionReadinessGates({
  activeAlerts,
  activeForwarding,
  configRevisions,
  language,
  nodes,
  onlineAgents,
  preflightPlans,
  runtimeSnapshots,
  t,
  totalAgents
}: {
  activeAlerts: number;
  activeForwarding: number;
  configRevisions: RuntimeConfigRevision[];
  language: AppLanguage;
  nodes: ManagedNode[];
  onlineAgents: number;
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  t: DashboardCopy;
  totalAgents: number;
}): ProductionReadinessGate[] {
  const hostState: ProductionReadinessState =
    totalAgents === 0 ? 'waiting' : onlineAgents === totalAgents ? 'ready' : 'issues';
  const trafficState: ProductionReadinessState =
    activeForwarding > 0 && nodes.length > 0 ? 'ready' : activeForwarding > 0 || nodes.length > 0 ? 'issues' : 'waiting';
  const releaseState: ProductionReadinessState =
    configRevisions.length > 0 && preflightPlans.length > 0 && runtimeSnapshots.length > 0 ? 'ready' : 'waiting';
  const alertState: ProductionReadinessState = activeAlerts > 0 ? 'issues' : 'ready';

  return [
    {
      id: 'host',
      label: t.productionReadinessGateLabels.host,
      value: t.productionReadinessStates[hostState],
      detail: t.productionReadinessDetails.host(onlineAgents, totalAgents, language),
      state: hostState,
      tone: 'blue'
    },
    {
      id: 'traffic',
      label: t.productionReadinessGateLabels.traffic,
      value:
        trafficState === 'ready'
          ? t.productionReadinessValues.trafficEnabled
          : t.productionReadinessStates[trafficState],
      detail: t.productionReadinessDetails.traffic(activeForwarding, nodes.length, language),
      state: trafficState,
      tone: 'green'
    },
    {
      id: 'release',
      label: t.productionReadinessGateLabels.release,
      value: t.productionReadinessStates[releaseState],
      detail: t.productionReadinessDetails.release(configRevisions.length, preflightPlans.length, runtimeSnapshots.length, language),
      state: releaseState,
      tone: 'orange'
    },
    {
      id: 'alerts',
      label: t.productionReadinessGateLabels.alerts,
      value: t.productionReadinessStates[alertState],
      detail: t.productionReadinessDetails.alerts(activeAlerts, language),
      state: alertState,
      tone: 'chartreuse'
    }
  ];
}

function ProductionReadinessPanel({
  gates,
  language,
  state,
  t
}: {
  gates: ProductionReadinessGate[];
  language: AppLanguage;
  state: ProductionReadinessState;
  t: DashboardCopy;
}) {
  return (
    <section
      aria-label={t.productionReadinessRegion}
      className="dashboard-production-readiness motion-safe:animate-[ou-panel-in_180ms_ease-out] overflow-hidden rounded-lg border border-[#07111F] bg-[#FFFDF5] p-3 shadow-[0_14px_32px_-28px_rgba(7,17,31,0.34)] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:shadow-black/20"
      data-production-readiness-state={state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{t.productionReadinessTitle}</h4>
        </div>
        <span className="rounded-full border border-[#07111F]/25 bg-[#D9FF00]/[0.24] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#07111F] dark:border-[#EAFF5A]/25 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]">
          {t.productionReadinessGateCount(gates.length, language)}
        </span>
      </div>
      <div className="dashboard-production-readiness-grid mt-3 grid gap-2 sm:grid-cols-2">
        {gates.map((gate) => {
          const tone = productionReadinessToneClasses[gate.tone];

          return (
            <div
              className={cn(
                'group relative min-h-[72px] overflow-hidden rounded-lg border p-2 text-[#07111F] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-24px_rgba(7,17,31,0.42)] dark:text-[#F4F8FF]',
                tone.item
              )}
              data-production-readiness-gate-state={gate.state}
              key={gate.id}
            >
              <span className={cn('absolute inset-x-0 top-0 h-1', tone.rail)} aria-hidden="true" />
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[10px] font-black uppercase leading-4 tracking-widest text-[#536078] dark:text-[#B8C2E6]/72">
                  {gate.label}
                </p>
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', tone.badge)}>
                  {gate.value}
                </span>
              </div>
              <p className="mt-2 text-xs font-black leading-5 text-[#07111F] dark:text-[#F4F8FF]">{gate.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CompactProbeBar({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-[#EAF3D1]/70 p-2 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[9px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
        <p className="truncate text-[10px] font-black text-[#07111F] dark:text-[#F4F8FF]/86">{value}</p>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#BBC5FF]/60 dark:bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-[#1E3AFF] via-[#00A878] to-[#FF3D18] shadow-[0_0_10px_rgba(30,58,255,0.32)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EmptySignal({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#07111F] bg-[#FFFDF5]/78 p-4 text-xs font-semibold text-[#536078] dark:border-[#6B7CFF]/18 dark:bg-white/[0.03] dark:text-[#B8C2E6]/68">
      {label}
    </div>
  );
}

function getLatestReleaseRecord<T>(items: readonly T[], getTimestamp: (item: T) => string | undefined) {
  return items.reduce<T | undefined>((latest, current) => {
    if (!latest) {
      return current;
    }

    const latestTimestamp = getTimestamp(latest);
    const currentTimestamp = getTimestamp(current);

    if (!latestTimestamp) {
      return currentTimestamp ? current : latest;
    }

    if (!currentTimestamp) {
      return latest;
    }

    return currentTimestamp > latestTimestamp ? current : latest;
  }, undefined);
}

function getReleaseStatusTone(status?: string) {
  switch (status) {
    case 'applied':
    case 'passed':
    case 'verified':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-100';
    case 'preflight_ready':
    case 'captured':
      return 'bg-blue-50 text-blue-700 dark:bg-primary/15 dark:text-primary';
    case 'rolled_back':
    case 'restored':
      return 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-100';
    case 'failed':
    case 'expired':
      return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-100';
    case 'compiled':
    case 'pending':
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70';
  }
}

function ReleaseRollbackBoundary({ task, t }: { task?: DeployTask; t: DashboardCopy }) {
  const state = task ? (task.rollbackAvailable ? 'ready' : 'locked') : 'waiting';
  const statusLabel = task ? (task.rollbackAvailable ? t.rollbackReady : t.rollbackLocked) : t.rollbackWaiting;
  const description = task ? (task.rollbackAvailable ? t.rollbackReadyDescription : t.rollbackLockedDescription) : t.latestExecutionEmpty;
  const stateClasses =
    state === 'ready'
      ? 'border-[#07111F] bg-[#D9FF00]/40 text-[#07111F] dark:border-[#EAFF5A]/30 dark:bg-[#EAFF5A]/14 dark:text-[#F4FFC5]'
      : 'border-[#07111F]/25 bg-[#DCE1FF]/72 text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/12 dark:text-[#F4F8FF]';

  return (
    <div
      className={cn(
        'mt-3 rounded-2xl border px-3 py-2.5 motion-safe:animate-[ou-panel-in_180ms_ease-out]',
        stateClasses
      )}
      data-release-rollback-state={state}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{t.rollbackBoundary}</p>
          <p className="mt-1 text-sm font-black">{statusLabel}</p>
        </div>
        {task ? (
          <span className="rounded-full border border-[#07111F]/25 bg-[#FFFDF5] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#07111F] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#F4F8FF]/78">
            {task.status}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-4 opacity-80">{description}</p>
      {task ? (
        <div className="mt-2 grid gap-1 font-mono text-[10px] font-black uppercase tracking-widest opacity-78 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <span className="truncate">{task.id}</span>
          <span className="truncate sm:text-right">{task.operation}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReleaseEvidenceRow({
  label,
  record,
  fallbackLabel
}: {
  label: string;
  record?: { id: string; status: string };
  fallbackLabel: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/[.42]">{label}</p>
          <p className="mt-1 truncate text-sm font-black text-slate-950 dark:text-white">{record?.id ?? fallbackLabel}</p>
        </div>
        {record ? (
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${getReleaseStatusTone(record.status)}`}>
            {record.status}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EvidenceChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/[.42]">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}
