import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Cpu,
  FileSearch,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  RadioTower,
  RotateCw,
  ServerCog
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
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

export function DashboardPage({
  agents,
  nodes,
  tasks,
  auditLogs,
  forwardingRules,
  systemAlerts,
  language,
  onOpenHostWorkspace,
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const runningTasks = tasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const activeSystemAlerts = systemAlerts.filter((alert) => alert.status === 'active');
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
          <div className="space-y-3">
            {activeSystemAlerts.slice(0, 4).map((alert) => {
              const deadLetterDiagnostics = formatDeadLetterDiagnostics(alert, language, t.deadLetterReasonLabels);

              return (
                <div key={alert.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-xs font-semibold text-slate-700 dark:text-white/70">
                      {t.alertKindLabels[alert.kind]} / {alert.resourceLabel}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        alert.severity === 'critical'
                          ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-200'
                      }`}
                    >
                      {t.alertSeverityLabels[alert.severity]}
                    </span>
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
  const sampleStatus = telemetryReported ? formatSamplingStatus(agent, language, t) : t.waitingTelemetry;
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
            {t.waitingTelemetry}
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
