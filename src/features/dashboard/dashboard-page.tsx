import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Activity, Boxes, ClipboardCheck, Database, Download, FileSearch, RadioTower, Save, Shuffle } from 'lucide-react';
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
import type {
  TrafficRollupRetentionPolicyReadModel,
  TrafficRollupRetentionPolicyUpdateInput,
  TrafficRollupRetentionPolicyValues
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
  onRefresh: () => void;
};

type TrafficWorkspace = TrafficRollup['dimension'];

type TrafficSubjectStat = {
  key: string;
  label: string;
  hostLabel: string;
  secondaryLabel?: string;
  latestObservedAt: string;
  latestPeriodKey: string;
  accountingMode: TrafficRollup['accountingMode'];
  totalMeteredBytes: number;
  totalIngressBytes: number;
  totalEgressBytes: number;
  rollupCount: number;
};

const trafficWorkspaces = ['agent', 'forward-rule', 'xray-client'] as const;

const copy = {
  zh: {
    cards: {
      onlineAgents: '主机代理在线',
      nodeHealth: '节点健康',
      taskPipeline: '执行中变更',
      systemAlerts: '系统告警',
      totalTraffic: '总吞吐',
      trafficRollups: (count: string, bytes: string) => `历史统计 ${count} 条 / ${bytes}`,
      forwardingEnabled: (count: string) => `转发 ${count} 条启用`,
      releaseTasks: (count: string) => `${count} 个发布记录`,
      activeAlerts: (count: string) => `${count} 条活动告警`
    },
    title: '系统总览',
    subtitle: '主控与受控主机控制面，汇聚主机代理、客户节点、订阅、端口转发与审计信号。',
    refresh: '刷新视图',
    trafficHistoryTitle: '流量历史',
    trafficHistoryHint: '按受控主机、端口转发和客户节点聚合 Agent 实时回传的历史流量样本，用于核对月度计费与追溯最近一次上报。',
    trafficExport: '导出历史',
    trafficRetentionTitle: '流量历史留存',
    trafficRetentionEffective: '当前生效',
    trafficRetentionRuntimeDefault: '运行配置默认',
    trafficRetentionControlPlaneOverride: '控制面覆盖',
    trafficRetentionNoOverride: '未设置控制面覆盖',
    trafficRetentionAge: (days: number, language: AppLanguage) => `保留 ${formatNumber(days, language)} 天`,
    trafficRetentionLimit: (count: number, language: AppLanguage) => `每个 scope ${formatNumber(count, language)} 条`,
    trafficRetentionSourceLabels: {
      'runtime-config': '运行配置',
      'control-plane': '控制面配置'
    },
    trafficRetentionAgeLabel: '保留天数',
    trafficRetentionLimitLabel: '单 scope 上限',
    trafficRetentionSave: '保存策略',
    trafficRetentionSaveReason: '操作员更新流量历史留存策略',
    trafficArchiveTitle: '压缩归档',
    trafficArchiveHint: '留存策略移除的原始样本会按世界协调时每日压缩保留，方便追溯已剪枝的历史流量。',
    trafficArchiveExport: '导出归档',
    trafficArchiveBuckets: '归档桶',
    trafficArchiveSamples: '原始样本',
    trafficArchiveMetered: '累计计费',
    trafficArchiveLatest: '最新归档',
    trafficArchiveEmpty: '当前维度还没有压缩归档。',
    trafficWorkspaceLabels: {
      agent: '受控主机',
      'forward-rule': '端口转发',
      'xray-client': '客户节点'
    },
    trafficSummarySubjects: '统计对象',
    trafficSummarySamples: '历史样本',
    trafficSummaryMetered: '累计计费',
    trafficTableObject: '对象',
    trafficTableHost: '所属主机',
    trafficTableSamples: '样本数',
    trafficTableMetered: '累计计费',
    trafficTableIngress: '累计入站',
    trafficTableEgress: '累计出站',
    trafficTableAccountingMode: '计费方式',
    trafficTablePeriod: '最近周期',
    trafficTableReportedAt: '最近上报',
    trafficHistoryEmpty: '当前维度还没有真实流量历史样本。',
    trafficAccountingModes: {
      both: '双向',
      single: '单向',
      ingress: '仅入',
      egress: '仅出'
    },
    topologyTitle: '流量拓扑',
    topologyDescription: '主控、受控主机、Xray 入站与端口转发链路之间的实时流向预览。',
    topologyAria: '实时流量拓扑',
    topologyMaster: '主控',
    topologyManagedHosts: '受控主机',
    topologyForwarding: '端口转发',
    topologyIdle: '等待受控主机接入',
    nodeHeatTitle: '节点运行热区',
    nodeHeatEmpty: '暂无真实节点，主机代理完成注册后会显示运行热区。',
    unboundAgent: '未绑定主机代理',
    inbound: '入站',
    forwarding: '转发',
    modules: '模块',
    subscriptionSignals: '订阅与执行信号',
    subscriptionEmpty: '暂无订阅输出，创建订阅身份后会显示生成信号。',
    releaseHealth: '发布健康',
    preflight: '预检',
    snapshot: '快照',
    failed: '失败',
    health: '健康度',
    sourceUnit: '个源',
    latestAudit: '最新审计',
    auditEmpty: '等待第一条变更审计事件。',
    activeAlerts: '活动告警',
    alertsEmpty: '暂无活动系统告警。',
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
      totalTraffic: 'Total throughput',
      trafficRollups: (count: string, bytes: string) => `${count} rollups / ${bytes}`,
      forwardingEnabled: (count: string) => `${count} forwarding rules active`,
      releaseTasks: (count: string) => `${count} release records`,
      activeAlerts: (count: string) => `${count} active alerts`
    },
    title: 'System Dashboard',
    subtitle: 'Control plane for Agent, node, subscription, forwarding, and audit signals.',
    refresh: 'Refresh View',
    trafficHistoryTitle: 'Traffic History',
    trafficHistoryHint: 'Aggregate real Agent-reported traffic history by managed host, port-forwarding rule, and customer node to verify monthly billing and the latest runtime sample.',
    trafficExport: 'Export History',
    trafficRetentionTitle: 'Traffic History Retention',
    trafficRetentionEffective: 'Effective',
    trafficRetentionRuntimeDefault: 'Runtime Default',
    trafficRetentionControlPlaneOverride: 'Control-Plane Override',
    trafficRetentionNoOverride: 'No control-plane override',
    trafficRetentionAge: (days: number, language: AppLanguage) => `${formatNumber(days, language)} days`,
    trafficRetentionLimit: (count: number, language: AppLanguage) => `${formatNumber(count, language)} per scope`,
    trafficRetentionSourceLabels: {
      'runtime-config': 'Runtime Config',
      'control-plane': 'Control Plane'
    },
    trafficRetentionAgeLabel: 'Retention Days',
    trafficRetentionLimitLabel: 'Per-Scope Cap',
    trafficRetentionSave: 'Save Policy',
    trafficRetentionSaveReason: 'Operator updated traffic history retention policy',
    trafficArchiveTitle: 'Compacted Archive',
    trafficArchiveHint: 'Retention-pruned raw samples are compacted by UTC day so operators can inspect older traffic history.',
    trafficArchiveExport: 'Export Archive',
    trafficArchiveBuckets: 'Buckets',
    trafficArchiveSamples: 'Raw Samples',
    trafficArchiveMetered: 'Metered Total',
    trafficArchiveLatest: 'Latest Archive',
    trafficArchiveEmpty: 'No compacted archive for this dimension yet.',
    trafficWorkspaceLabels: {
      agent: 'Managed Hosts',
      'forward-rule': 'Port Forwarding',
      'xray-client': 'Customer Nodes'
    },
    trafficSummarySubjects: 'Subjects',
    trafficSummarySamples: 'Samples',
    trafficSummaryMetered: 'Metered Total',
    trafficTableObject: 'Object',
    trafficTableHost: 'Managed Host',
    trafficTableSamples: 'Samples',
    trafficTableMetered: 'Metered',
    trafficTableIngress: 'Ingress',
    trafficTableEgress: 'Egress',
    trafficTableAccountingMode: 'Accounting',
    trafficTablePeriod: 'Latest Period',
    trafficTableReportedAt: 'Reported',
    trafficHistoryEmpty: 'No real traffic history samples for this dimension yet.',
    trafficAccountingModes: {
      both: 'Both',
      single: 'One-way',
      ingress: 'Ingress',
      egress: 'Egress'
    },
    topologyTitle: 'Traffic Topology',
    topologyDescription: 'Real-time flow preview across the control plane, managed hosts, Xray inbounds, and port forwarding links.',
    topologyAria: 'Real-time traffic topology',
    topologyMaster: 'Control Plane',
    topologyManagedHosts: 'Managed Hosts',
    topologyForwarding: 'Port Forwarding',
    topologyIdle: 'Waiting for managed host enrollment',
    nodeHeatTitle: 'Node Runtime Heatmap',
    nodeHeatEmpty: 'No real nodes yet. Runtime heat appears after a host Agent registers.',
    unboundAgent: 'Unbound Agent',
    inbound: 'Inbounds',
    forwarding: 'Forwards',
    modules: 'Modules',
    subscriptionSignals: 'Subscription and Execution Signals',
    subscriptionEmpty: 'No subscription output yet. Signals appear after a client rule is created.',
    releaseHealth: 'Release Health',
    preflight: 'Preflight',
    snapshot: 'Snapshot',
    failed: 'Failed',
    health: 'Health',
    sourceUnit: 'sources',
    latestAudit: 'Latest Audit',
    auditEmpty: 'Waiting for the first change audit event.',
    activeAlerts: 'Active Alerts',
    alertsEmpty: 'No active system alerts.',
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

function readMetadataString(metadata: TrafficRollup['metadata'], key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readAlertMetadataNumber(metadata: SystemAlert['metadata'], key: string) {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatDeadLetterDiagnostics(
  alert: SystemAlert,
  language: AppLanguage,
  labels: (typeof copy)[AppLanguage]['deadLetterReasonLabels']
) {
  if (alert.kind !== 'command_outbox.dead_letter') {
    return undefined;
  }

  const parts = [
    {
      label: labels.ack,
      count: readAlertMetadataNumber(alert.metadata, 'deadLetterAckTimeoutCount')
    },
    {
      label: labels.result,
      count: readAlertMetadataNumber(alert.metadata, 'deadLetterResultTimeoutCount')
    },
    {
      label: labels.unknown,
      count: readAlertMetadataNumber(alert.metadata, 'deadLetterUnknownReasonCount')
    },
    {
      label: labels.other,
      count: readAlertMetadataNumber(alert.metadata, 'deadLetterOtherReasonCount')
    }
  ].filter((part) => part.count > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return `${labels.prefix}: ${parts.map((part) => `${part.label} ${formatNumber(part.count, language)}`).join(' / ')}`;
}

function createTrafficSubjectStats(
  trafficRollups: TrafficRollup[],
  agents: Agent[],
  nodes: ManagedNode[],
  forwardingRules: ForwardingRuleView[],
  fallbackHostLabel: string
): Record<TrafficWorkspace, TrafficSubjectStat[]> {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const forwardingRulesById = new Map(forwardingRules.map((rule) => [rule.id, rule]));
  const grouped = {
    agent: new Map<string, TrafficSubjectStat>(),
    'forward-rule': new Map<string, TrafficSubjectStat>(),
    'xray-client': new Map<string, TrafficSubjectStat>()
  } satisfies Record<TrafficWorkspace, Map<string, TrafficSubjectStat>>;

  for (const rollup of trafficRollups) {
    const target = grouped[rollup.dimension];
    const existing = target.get(rollup.subjectId);
    const agent = agentsById.get(rollup.agentId);
    const rule = forwardingRulesById.get(rollup.subjectId);
    const inboundId = readMetadataString(rollup.metadata, 'inboundId');
    const node = inboundId ? nodesById.get(inboundId) : undefined;
    const label =
      rollup.dimension === 'agent'
        ? agent?.name ?? rollup.subjectLabel
        : rollup.dimension === 'forward-rule'
          ? rule?.name ?? rollup.subjectLabel
          : node?.name ?? rollup.subjectLabel;
    const secondaryLabel =
      rollup.dimension === 'agent'
        ? agent?.publicAddress
        : rollup.dimension === 'forward-rule'
          ? rule?.ownerName
          : readMetadataString(rollup.metadata, 'clientEmail') ?? rollup.subjectLabel;
    const hostLabel = agent?.name ?? fallbackHostLabel;

    if (!existing) {
      target.set(rollup.subjectId, {
        key: `${rollup.dimension}:${rollup.subjectId}`,
        label,
        hostLabel,
        secondaryLabel,
        latestObservedAt: rollup.observedAt,
        latestPeriodKey: rollup.periodKey,
        accountingMode: rollup.accountingMode,
        totalMeteredBytes: rollup.meteredBytes,
        totalIngressBytes: rollup.ingressBytes,
        totalEgressBytes: rollup.egressBytes,
        rollupCount: 1
      });
      continue;
    }

    const nextObservedAt = rollup.observedAt > existing.latestObservedAt ? rollup.observedAt : existing.latestObservedAt;
    const newestRollup = rollup.observedAt >= existing.latestObservedAt;

    target.set(rollup.subjectId, {
      ...existing,
      label: newestRollup ? label : existing.label,
      hostLabel: newestRollup ? hostLabel : existing.hostLabel,
      secondaryLabel: newestRollup ? secondaryLabel : existing.secondaryLabel,
      latestObservedAt: nextObservedAt,
      latestPeriodKey: newestRollup ? rollup.periodKey : existing.latestPeriodKey,
      accountingMode: newestRollup ? rollup.accountingMode : existing.accountingMode,
      totalMeteredBytes: existing.totalMeteredBytes + rollup.meteredBytes,
      totalIngressBytes: existing.totalIngressBytes + rollup.ingressBytes,
      totalEgressBytes: existing.totalEgressBytes + rollup.egressBytes,
      rollupCount: existing.rollupCount + 1
    });
  }

  return {
    agent: [...grouped.agent.values()].sort(sortTrafficSubjectStats),
    'forward-rule': [...grouped['forward-rule'].values()].sort(sortTrafficSubjectStats),
    'xray-client': [...grouped['xray-client'].values()].sort(sortTrafficSubjectStats)
  };
}

function sortTrafficSubjectStats(left: TrafficSubjectStat, right: TrafficSubjectStat) {
  if (right.totalMeteredBytes !== left.totalMeteredBytes) {
    return right.totalMeteredBytes - left.totalMeteredBytes;
  }

  if (right.rollupCount !== left.rollupCount) {
    return right.rollupCount - left.rollupCount;
  }

  return right.latestObservedAt.localeCompare(left.latestObservedAt);
}

function getReleaseStatusClass(status?: string) {
  if (!status) {
    return 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50';
  }

  if (status.includes('failed')) {
    return 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200';
  }

  if (['applied', 'passed', 'verified', 'restored'].includes(status)) {
    return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200';
  }

  return 'bg-blue-50 text-blue-600 dark:bg-primary/15 dark:text-primary';
}

function pickTrafficRetentionValues(policy: TrafficRollupRetentionPolicyReadModel): TrafficRollupRetentionPolicyValues {
  return {
    maxAgeMs: policy.maxAgeMs,
    maxAgeDays: policy.maxAgeDays,
    maxRecordsPerScope: policy.maxRecordsPerScope
  };
}

function getRuntimeDefaultRetention(policy: TrafficRollupRetentionPolicyReadModel) {
  return policy.runtimeDefault ?? (policy.source === 'runtime-config' ? pickTrafficRetentionValues(policy) : undefined);
}

function getControlPlaneOverrideRetention(policy: TrafficRollupRetentionPolicyReadModel) {
  return policy.controlPlaneOverride
    ?? (policy.source === 'control-plane' ? pickTrafficRetentionValues(policy) : undefined);
}

function TrafficRetentionValue({
  label,
  language,
  muted = false,
  value
}: {
  label: string;
  language: AppLanguage;
  muted?: boolean;
  value?: TrafficRollupRetentionPolicyValues;
}) {
  const t = copy[language];

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white/45 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      {value ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-600 dark:text-white/65">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-white/10">
            {t.trafficRetentionAge(value.maxAgeDays, language)}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-white/10">
            {t.trafficRetentionLimit(value.maxRecordsPerScope, language)}
          </span>
        </div>
      ) : (
        <p className={`mt-2 text-xs font-semibold ${muted ? 'text-slate-400 dark:text-white/35' : 'text-slate-500 dark:text-white/45'}`}>
          {t.trafficRetentionNoOverride}
        </p>
      )}
    </div>
  );
}

function TrafficRetentionPanel({
  busy = false,
  language,
  policy,
  onUpdatePolicy
}: {
  busy?: boolean;
  language: AppLanguage;
  policy: TrafficRollupRetentionPolicyReadModel;
  onUpdatePolicy?: (input: TrafficRollupRetentionPolicyUpdateInput) => void;
}) {
  const t = copy[language];
  const [maxAgeDays, setMaxAgeDays] = useState(String(policy.maxAgeDays));
  const [maxRecordsPerScope, setMaxRecordsPerScope] = useState(String(policy.maxRecordsPerScope));
  const parsedMaxAgeDays = Number(maxAgeDays);
  const parsedMaxRecordsPerScope = Number(maxRecordsPerScope);
  const retentionInputValid =
    Number.isFinite(parsedMaxAgeDays)
    && parsedMaxAgeDays > 0
    && parsedMaxAgeDays <= 3650
    && Number.isFinite(parsedMaxRecordsPerScope)
    && Number.isInteger(parsedMaxRecordsPerScope)
    && parsedMaxRecordsPerScope >= 0
    && parsedMaxRecordsPerScope <= 10_000_000;
  const runtimeDefault = getRuntimeDefaultRetention(policy);
  const controlPlaneOverride = getControlPlaneOverrideRetention(policy);

  useEffect(() => {
    setMaxAgeDays(String(policy.maxAgeDays));
    setMaxRecordsPerScope(String(policy.maxRecordsPerScope));
  }, [policy.maxAgeDays, policy.maxRecordsPerScope]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!onUpdatePolicy || !retentionInputValid) {
      return;
    }

    onUpdatePolicy({
      maxAgeDays: parsedMaxAgeDays,
      maxRecordsPerScope: parsedMaxRecordsPerScope,
      reason: t.trafficRetentionSaveReason
    });
  }

  return (
    <form className="mb-4 border-b border-slate-200 pb-4 dark:border-white/10" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h5 className="text-sm font-bold text-slate-800 dark:text-white">{t.trafficRetentionTitle}</h5>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/45">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-600 dark:bg-primary/15 dark:text-primary">
            {t.trafficRetentionSourceLabels[policy.source]}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-white/70">
            {t.trafficRetentionEffective}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <TrafficRetentionValue label={t.trafficRetentionEffective} language={language} value={policy} />
        <TrafficRetentionValue
          label={t.trafficRetentionRuntimeDefault}
          language={language}
          value={runtimeDefault}
        />
        <TrafficRetentionValue
          label={t.trafficRetentionControlPlaneOverride}
          language={language}
          muted
          value={controlPlaneOverride}
        />
      </div>

      {onUpdatePolicy ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.trafficRetentionAgeLabel}
            <input
              className="w-28 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={busy}
              max="3650"
              min="0.01"
              step="0.01"
              type="number"
              value={maxAgeDays}
              onChange={(event) => setMaxAgeDays(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.trafficRetentionLimitLabel}
            <input
              className="w-36 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={busy}
              max="10000000"
              min="0"
              step="1"
              type="number"
              value={maxRecordsPerScope}
              onChange={(event) => setMaxRecordsPerScope(event.target.value)}
            />
          </label>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(59,130,246,0.25)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-primary/50 dark:bg-primary dark:text-slate-950"
            disabled={busy || !retentionInputValid}
            type="submit"
          >
            <Save className="h-3.5 w-3.5" />
            {t.trafficRetentionSave}
          </button>
        </div>
      ) : null}
    </form>
  );
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
  trafficRollups,
  trafficRollupCompactions,
  trafficRollupExportBusy = false,
  trafficRollupRetentionBusy = false,
  trafficRollupRetentionPolicy,
  systemAlerts,
  language,
  onExportTrafficRollups,
  onExportTrafficRollupCompactions,
  onUpdateTrafficRollupRetentionPolicy,
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const [trafficWorkspace, setTrafficWorkspace] = useState<TrafficWorkspace>('agent');
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const runningTasks = tasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const activeSystemAlerts = systemAlerts.filter((alert) => alert.status === 'active');
  const criticalSystemAlerts = activeSystemAlerts.filter((alert) => alert.severity === 'critical').length;
  const totalTraffic = agents.reduce((sum, agent) => sum + agent.telemetry.txBytes + agent.telemetry.rxBytes, 0);
  const rollupTraffic = trafficRollups.reduce((sum, rollup) => sum + rollup.meteredBytes, 0);
  const activeForwarding = forwardingRules.filter((rule) => rule.enabled).length;
  const topologyActive = agents.length > 0 || nodes.length > 0 || activeForwarding > 0;
  const latestRevision = configRevisions[0];
  const passedPreflights = preflightPlans.filter((plan) => plan.status === 'passed').length;
  const verifiedSnapshots = runtimeSnapshots.filter((snapshot) => snapshot.status === 'verified').length;
  const failedReleases =
    configRevisions.filter((revision) => revision.status === 'failed').length +
    preflightPlans.filter((plan) => plan.status === 'failed').length;
  const trafficStatsByWorkspace = useMemo(
    () => createTrafficSubjectStats(trafficRollups, agents, nodes, forwardingRules, t.unboundAgent),
    [agents, forwardingRules, nodes, t.unboundAgent, trafficRollups]
  );
  const trafficStats = trafficStatsByWorkspace[trafficWorkspace];
  const trafficSampleCount = trafficStats.reduce((sum, item) => sum + item.rollupCount, 0);
  const trafficMeteredBytes = trafficStats.reduce((sum, item) => sum + item.totalMeteredBytes, 0);
  const trafficArchiveCompactions = useMemo(
    () =>
      trafficRollupCompactions
        .filter((compaction) => compaction.dimension === trafficWorkspace)
        .sort((left, right) => {
          const bucketDelta = Date.parse(right.bucketStartAt) - Date.parse(left.bucketStartAt);
          return bucketDelta || left.id.localeCompare(right.id);
        }),
    [trafficRollupCompactions, trafficWorkspace]
  );
  const trafficArchiveSamples = trafficArchiveCompactions.reduce(
    (sum, compaction) => sum + compaction.sampleCount,
    0
  );
  const trafficArchiveMeteredBytes = trafficArchiveCompactions.reduce(
    (sum, compaction) => sum + compaction.meteredBytesTotal,
    0
  );
  const latestTrafficArchiveAt = trafficArchiveCompactions[0]?.bucketStartAt;

  const cards = [
    {
      label: t.cards.onlineAgents,
      value: `${onlineAgents}/${agents.length}`,
      icon: Activity,
      detail: `${t.cards.totalTraffic} ${formatBytes(totalTraffic)} / ${t.cards.trafficRollups(
        formatNumber(trafficRollups.length),
        formatBytes(rollupTraffic)
      )}`
    },
    {
      label: t.cards.nodeHealth,
      value: `${healthyNodes}/${nodes.length}`,
      icon: RadioTower,
      detail: t.cards.forwardingEnabled(formatNumber(activeForwarding))
    },
    {
      label: t.cards.taskPipeline,
      value: formatNumber(runningTasks),
      icon: ClipboardCheck,
      detail: t.cards.releaseTasks(formatNumber(tasks.length))
    },
    {
      label: t.cards.systemAlerts,
      value: `${formatNumber(criticalSystemAlerts)}/${formatNumber(activeSystemAlerts.length)}`,
      icon: FileSearch,
      detail: t.cards.activeAlerts(formatNumber(activeSystemAlerts.length))
    }
  ];

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
          </div>
          <GlowButton className="px-4 py-2 text-xs font-bold" onClick={onRefresh}>
            {t.refresh}
          </GlowButton>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <GlassCard key={card.label} className="tilt-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                      {card.label}
                    </p>
                    <p className="mt-3 text-3xl font-black text-slate-900 dark:text-white">{card.value}</p>
                  </div>
                  <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
                </div>
                <p className="mt-4 text-xs text-slate-500 dark:text-white/50">{card.detail}</p>
              </GlassCard>
            );
          })}
        </div>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.topologyTitle}</h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.topologyDescription}</p>
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
        {!topologyActive ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
            {t.topologyIdle}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.trafficHistoryTitle}</h4>
            <p className="mt-1 max-w-4xl text-xs text-slate-500 dark:text-white/50">{t.trafficHistoryHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onExportTrafficRollups ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
                disabled={trafficRollupExportBusy}
                type="button"
                onClick={() => onExportTrafficRollups(trafficWorkspace)}
              >
                <Download className="h-3.5 w-3.5" />
                {t.trafficExport}
              </button>
            ) : null}
            {trafficWorkspaces.map((workspace) => (
              <WorkspaceButton
                key={workspace}
                active={trafficWorkspace === workspace}
                label={`${t.trafficWorkspaceLabels[workspace]} · ${formatNumber(
                  trafficStatsByWorkspace[workspace].length,
                  language
                )}`}
                onClick={() => setTrafficWorkspace(workspace)}
              />
            ))}
          </div>
        </div>

        {trafficRollupRetentionPolicy ? (
          <TrafficRetentionPanel
            busy={trafficRollupRetentionBusy}
            language={language}
            policy={trafficRollupRetentionPolicy}
            onUpdatePolicy={onUpdateTrafficRollupRetentionPolicy}
          />
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TrafficSummaryMetric
            label={t.trafficSummarySubjects}
            value={formatNumber(trafficStats.length, language)}
          />
          <TrafficSummaryMetric
            label={t.trafficSummarySamples}
            value={formatNumber(trafficSampleCount, language)}
          />
          <TrafficSummaryMetric label={t.trafficSummaryMetered} value={formatBytes(trafficMeteredBytes)} />
        </div>

        {trafficStats.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
            {t.trafficHistoryEmpty}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left">
              <thead className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/35">
                <tr>
                  <th className="px-4 py-3">{t.trafficTableObject}</th>
                  <th className="px-4 py-3">{t.trafficTableHost}</th>
                  <th className="px-4 py-3">{t.trafficTableSamples}</th>
                  <th className="px-4 py-3">{t.trafficTableMetered}</th>
                  <th className="px-4 py-3">{t.trafficTableIngress}</th>
                  <th className="px-4 py-3">{t.trafficTableEgress}</th>
                  <th className="px-4 py-3">{t.trafficTableAccountingMode}</th>
                  <th className="px-4 py-3">{t.trafficTablePeriod}</th>
                  <th className="px-4 py-3">{t.trafficTableReportedAt}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700 dark:divide-white/10 dark:text-white/75">
                {trafficStats.map((stat) => (
                  <tr key={stat.key}>
                    <td className="px-4 py-4 align-top">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900 dark:text-white">{stat.label}</p>
                        {stat.secondaryLabel && stat.secondaryLabel !== stat.label ? (
                          <p className="mt-1 truncate text-xs text-slate-500 dark:text-white/45">{stat.secondaryLabel}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-slate-500 dark:text-white/45">{stat.hostLabel}</td>
                    <td className="px-4 py-4 align-top font-mono text-xs">{formatNumber(stat.rollupCount, language)}</td>
                    <td className="px-4 py-4 align-top font-semibold text-slate-900 dark:text-white">
                      {formatBytes(stat.totalMeteredBytes)}
                    </td>
                    <td className="px-4 py-4 align-top font-mono text-xs">{formatBytes(stat.totalIngressBytes)}</td>
                    <td className="px-4 py-4 align-top font-mono text-xs">{formatBytes(stat.totalEgressBytes)}</td>
                    <td className="px-4 py-4 align-top text-xs">{t.trafficAccountingModes[stat.accountingMode]}</td>
                    <td className="px-4 py-4 align-top font-mono text-xs">{stat.latestPeriodKey}</td>
                    <td className="px-4 py-4 align-top text-xs text-slate-500 dark:text-white/45">
                      {formatDateTime(stat.latestObservedAt, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white/45 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-bold text-slate-800 dark:text-white">{t.trafficArchiveTitle}</h5>
              <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-white/45">{t.trafficArchiveHint}</p>
            </div>
            {onExportTrafficRollupCompactions ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
                disabled={trafficRollupExportBusy}
                type="button"
                onClick={() => onExportTrafficRollupCompactions(trafficWorkspace)}
              >
                <Download className="h-3.5 w-3.5" />
                {t.trafficArchiveExport}
              </button>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <TrafficSummaryMetric
              label={t.trafficArchiveBuckets}
              value={formatNumber(trafficArchiveCompactions.length, language)}
            />
            <TrafficSummaryMetric
              label={t.trafficArchiveSamples}
              value={formatNumber(trafficArchiveSamples, language)}
            />
            <TrafficSummaryMetric
              label={t.trafficArchiveMetered}
              value={formatBytes(trafficArchiveMeteredBytes)}
            />
            <TrafficSummaryMetric
              label={t.trafficArchiveLatest}
              value={latestTrafficArchiveAt ? formatDateTime(latestTrafficArchiveAt, language) : t.trafficArchiveEmpty}
            />
          </div>
        </div>
      </GlassCard>

      <section className="stagger-2 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.nodeHeatTitle}</h4>
          </div>
          <div className="space-y-3">
            {nodes.length === 0 ? (
              <EmptySignal label={t.nodeHeatEmpty} />
            ) : null}
            {nodes.slice(0, 5).map((node) => {
              const agent = agents.find((item) => item.id === node.agentId);
              return (
                <div key={node.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{node.name}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                        {agent?.name ?? t.unboundAgent} / {node.entrypoint}
                      </p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-600 dark:bg-primary/15 dark:text-primary">
                      {node.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 dark:text-white/50 sm:grid-cols-3">
                    <span className="min-w-0 break-words">
                      {t.inbound} {formatNumber(node.activeInboundCount)}
                    </span>
                    <span className="min-w-0 break-words">
                      {t.forwarding} {formatNumber(node.activeForwardCount)}
                    </span>
                    <span className="min-w-0 break-words">
                      {t.modules} {formatNumber(node.modules.length)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.subscriptionSignals}</h4>
          </div>
          <div className="space-y-4">
            {subscriptions.length === 0 ? (
              <EmptySignal label={t.subscriptionEmpty} />
            ) : null}
            {subscriptions.slice(0, 3).map((subscription) => (
              <div key={subscription.id}>
                <div className="mb-1 flex justify-between text-xs font-bold text-slate-700 dark:text-white/80">
                  <span>{subscription.name}</span>
                  <span>{subscription.exportTargets.join(' / ')}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-blue-500 dark:bg-primary"
                    style={{ width: `${Math.min(subscription.healthScore, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                  {t.health} {formatPercent(subscription.healthScore)} / {subscription.sources.length} {t.sourceUnit}
                </p>
              </div>
            ))}

            <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.releaseHealth}
                </p>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${getReleaseStatusClass(
                    latestRevision?.status
                  )}`}
                >
                  {latestRevision?.status ?? 'idle'}
                </span>
              </div>
              <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/80">
                {latestRevision?.id ?? 'waiting-for-runtime-artifact'}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-slate-500 dark:text-white/50 sm:grid-cols-3">
                <span className="min-w-0 break-words">
                  {t.preflight} {formatNumber(passedPreflights)}/{formatNumber(preflightPlans.length)}
                </span>
                <span className="min-w-0 break-words">
                  {t.snapshot} {formatNumber(verifiedSnapshots)}
                </span>
                <span className="min-w-0 break-words">
                  {t.failed} {formatNumber(failedReleases)}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.activeAlerts}
              </p>
              {activeSystemAlerts.slice(0, 3).map((alert) => {
                const deadLetterDiagnostics = formatDeadLetterDiagnostics(alert, language, t.deadLetterReasonLabels);

                return (
                  <div key={alert.id} className="mt-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 dark:text-white/70">
                        {t.alertKindLabels[alert.kind]} / {alert.resourceLabel}
                      </span>
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
              {activeSystemAlerts.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.alertsEmpty}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.latestAudit}
              </p>
              {auditLogs.slice(0, 3).map((log) => (
                <p key={log.id} className="mt-2 text-xs text-slate-600 dark:text-white/60">
                  {formatDateTime(log.createdAt)} / {log.message}
                </p>
              ))}
              {auditLogs.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.auditEmpty}</p>
              ) : null}
            </div>
          </div>
        </GlassCard>
      </section>
    </div>
  );
}

function EmptySignal({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
      {label}
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

function TrafficSummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/45 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
