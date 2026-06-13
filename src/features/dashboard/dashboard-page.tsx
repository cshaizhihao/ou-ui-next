import {
  Activity,
  Archive,
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
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    controlPlanePath: ['Master', 'Agent', 'Customer Nodes', 'Forwarding', 'Subscriptions', 'Audit Evidence'],
    releaseEvidence: 'Release Evidence',
    releaseEvidenceSummary: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(preflightCount, language)} / Snapshot ${formatNumber(snapshotCount, language)}`,
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
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    controlPlanePath: ['Master Plane', 'Agent Runtime', 'Customer Node Mesh', 'Forwarding Fabric', 'Subscription Distribution', 'Audit Evidence Chain'],
    releaseEvidence: 'Release Evidence',
    releaseEvidenceSummary: (configCount: number, preflightCount: number, snapshotCount: number, language: AppLanguage) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(preflightCount, language)} / Snapshot ${formatNumber(snapshotCount, language)}`,
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
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const activeForwarding = forwardingRules.filter((rule) => rule.enabled).length;
  const visibleHostProbes = agents.slice(0, 3);
  const topologyActive = agents.length > 0 || nodes.length > 0 || activeForwarding > 0;
  const activeAlerts = systemAlerts.filter((alert) => alert.status === 'active').length;
  const latestTask = tasks[0];

  const cockpitCards = [
    {
      label: language === 'zh' ? '主机接入' : 'Host Access',
      value: `${onlineAgents}/${agents.length}`,
      detail: language === 'zh' ? '在线 Agent' : 'online agents',
      icon: Activity,
      tone: 'from-blue-500 to-cyan-400'
    },
    {
      label: language === 'zh' ? '客户节点' : 'Customer Nodes',
      value: `${healthyNodes}/${nodes.length}`,
      detail: language === 'zh' ? '健康节点' : 'healthy nodes',
      icon: RadioTower,
      tone: 'from-emerald-500 to-blue-400'
    },
    {
      label: language === 'zh' ? '端口转发' : 'Forwarding',
      value: formatNumber(activeForwarding, language),
      detail: language === 'zh' ? '启用规则' : 'active rules',
      icon: Network,
      tone: 'from-blue-500 to-cyan-400'
    },
    {
      label: language === 'zh' ? '订阅交付' : 'Subscriptions',
      value: formatNumber(subscriptions.length, language),
      detail: language === 'zh' ? '订阅包' : 'bundles',
      icon: Archive,
      tone: 'from-amber-400 to-orange-400'
    }
  ];

  return (
    <ResponsivePage className="dashboard-cockpit dashboard-control-plane min-h-[calc(100dvh-8.5rem)] overflow-hidden max-md:overflow-visible">
      <ResponsiveSection
        className="dashboard-control-plane grid min-h-[calc(100dvh-10rem)] grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)] gap-4 max-xl:grid-cols-1"
        compactOnMobile={false}
      >
        <section className="contents dashboard-control-plane" role="region" aria-label={t.controlPlaneOverviewAria}>
        <GlassCard className="dashboard-control-plane-surface relative isolate min-h-[34rem] self-start overflow-hidden !border-slate-200/90 !bg-white/95 p-0 !shadow-2xl !shadow-slate-950/10 dark:!border-white/[.1] dark:!bg-slate-950/92 dark:!shadow-blue-950/25">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(219,234,254,0.54)_46%,rgba(255,237,213,0.34))] dark:bg-[linear-gradient(135deg,rgba(2,6,23,0.18),rgba(15,23,42,0.88))]" aria-hidden="true" />
          <div className="relative z-10 flex h-full min-h-0 flex-col justify-between gap-8 p-7 max-md:p-5">
            <div className="max-w-3xl">
              <p className="text-sm font-black tracking-[0.01em] text-blue-700 dark:text-blue-100">
                {t.controlPlaneLabel}
              </p>
              <h3 className="mt-4 max-w-5xl text-balance text-5xl font-black leading-[0.94] tracking-[-0.04em] text-slate-950 md:text-6xl dark:text-white">
                {language === 'zh' ? '运营态势' : 'Operations Overview'}
              </h3>
              <p className="mt-5 max-w-[56ch] text-sm font-semibold leading-6 text-slate-600 dark:text-white/[.62]">
                {language === 'zh'
                  ? '实时查看核心资源、交付链路与服务状态。'
                  : 'Monitor core resources, delivery paths, and service readiness in real time.'}
              </p>
              <p className="mt-4 text-xs font-bold text-slate-500 dark:text-cyan-100/70">{topologyActive ? t.topologyDescription : t.topologyIdle}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="dashboard-control-plane-media relative min-h-48 overflow-hidden rounded-[1.5rem] border border-white/[.12] bg-slate-950 shadow-2xl shadow-blue-950/30">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_28%,rgba(37,99,235,0.34),transparent_32%),radial-gradient(circle_at_82%_22%,rgba(249,115,22,0.2),transparent_28%),linear-gradient(120deg,rgba(2,6,23,0.18),rgba(2,6,23,0.82))]" aria-hidden="true" />
                <div className="relative z-10 grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 lg:grid-cols-6">
                  {t.controlPlanePath.map((label) => (
                    <span key={label} className="rounded-lg border border-white/10 bg-white/[0.055] px-2 py-1.5 text-center text-[10px] font-black text-white/[.72]">
                      {label}
                    </span>
                  ))}
                </div>
                <svg className="relative z-10 h-40 w-full" role="img" aria-label={t.topologyAria} viewBox="0 0 720 164">
                  <defs>
                    <linearGradient id="dashboard-control-plane-flow" x1="0" x2="1" y1="0" y2="0">
                      <stop className="svg-flow-stop-1" offset="0%" stopColor="#2563eb" />
                      <stop className="svg-flow-stop-2" offset="58%" stopColor="#38bdf8" />
                      <stop className="svg-flow-stop-3" offset="100%" stopColor="#f97316" />
                    </linearGradient>
                  </defs>
                  <path className={topologyActive ? 'svg-line-dash' : 'opacity-25'} d="M 54 76 C 138 22, 196 130, 282 76 S 426 22, 510 76 S 610 124, 668 76" fill="none" stroke="url(#dashboard-control-plane-flow)" strokeLinecap="round" strokeWidth="4" />
                  {[54, 282, 510, 668].map((cx) => <circle key={cx} cx={cx} cy="76" r="26" fill="url(#dashboard-control-plane-flow)" opacity="0.18" />)}
                  {[54, 282, 510, 668].map((cx) => <circle key={`dot-${cx}`} cx={cx} cy="76" r="8" fill="#e0f2fe" />)}
                  <text x="54" y="132" textAnchor="middle" className="fill-white/[.65] text-[10px]">{t.topologyMaster}</text>
                  <text x="282" y="132" textAnchor="middle" className="fill-white/[.65] text-[10px]">{t.topologyManagedHosts}</text>
                  <text x="510" y="132" textAnchor="middle" className="fill-white/[.65] text-[10px]">{t.topologyForwarding}</text>
                  <text x="668" y="132" textAnchor="middle" className="fill-white/[.65] text-[10px]">{language === 'zh' ? '证据' : 'Evidence'}</text>
                </svg>
              </div>

              <GlowButton className="h-12 px-5 text-xs font-black tracking-widest" onClick={onRefresh}>
                {t.refresh}
              </GlowButton>
            </div>
          </div>
        </GlassCard>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
          <div className="dashboard-control-plane-bento grid-flow-dense grid grid-cols-4 gap-3 max-md:grid-cols-1">
            {cockpitCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={cn(
                    'group relative min-h-36 overflow-hidden rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-xl shadow-slate-950/10 transition duration-300 hover:-translate-y-1 hover:bg-white dark:border-white/10 dark:bg-white/[0.055] dark:shadow-slate-950/20 dark:hover:bg-white/[0.08]',
                    index === 0 ? 'col-span-2 row-span-2 max-md:col-span-1' : 'col-span-2 max-md:col-span-1'
                  )}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.tone}`} />
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/[.42]">{card.label}</p>
                      <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br ${card.tone} text-white shadow-lg shadow-blue-500/15 transition duration-300 group-hover:scale-105`}>
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <div>
                      <p className={cn('font-black tracking-[-0.04em] text-slate-950 dark:text-white', index === 0 ? 'text-5xl' : 'text-3xl')}>{card.value}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-white/[.48]">{card.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="col-span-2 min-h-28 rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-xl shadow-slate-950/10 max-md:col-span-1 dark:border-white/10 dark:bg-white/[0.055] dark:shadow-slate-950/20">
              <div className="flex h-full flex-col justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/[.42]">{t.releaseEvidence}</p>
                <div>
                  <p className="text-sm font-black text-slate-950 dark:text-white">
                    {t.releaseEvidenceSummary(configRevisions.length, preflightPlans.length, runtimeSnapshots.length, language)}
                  </p>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-white/[.48]">
                    {latestTask ? `${t.latestExecution}: ${latestTask.status}` : t.latestExecutionEmpty}
                  </p>
                </div>
              </div>
            </div>
            <div className="col-span-2 min-h-28 rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-xl shadow-slate-950/10 max-md:col-span-1 dark:border-white/10 dark:bg-white/[0.055] dark:shadow-slate-950/20">
              <div className="flex h-full flex-col justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/[.42]">{t.auditAlertEvidence}</p>
                <div>
                  <p className="text-sm font-black text-slate-950 dark:text-white">{t.auditAlertSummary(auditLogs.length, activeAlerts, language)}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-white/[.48]">{auditLogs[0]?.message ?? t.auditEmpty}</p>
                </div>
              </div>
            </div>
          </div>

          <GlassCard className="dashboard-control-plane-hosts flex min-h-0 flex-col overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-black text-slate-950 dark:text-white">{t.hostProbeTitle}</h4>
                <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-white/[.45]">{t.hostProbeSubtitle}</p>
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
        </div>
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
      ? 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)]'
      : agent.status === 'degraded'
        ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]'
        : 'bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.7)]';

  return (
    <article className="group min-h-0 rounded-2xl border border-slate-200/80 bg-white/75 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl dark:border-white/[0.08] dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', statusTone)} />
          <div className="min-w-0">
            <h5 className="truncate text-sm font-black text-slate-950 dark:text-white">{agent.name}</h5>
            <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {telemetryReported ? formatDateTime(agent.telemetry.reportedAt!, language) : t.waitingTelemetry}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200">
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

function CompactProbeBar({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 p-2 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
        <p className="truncate text-[10px] font-black text-slate-800 dark:text-white/80">{value}</p>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_10px_rgba(14,165,233,0.45)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EmptySignal({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
      {label}
    </div>
  );
}
