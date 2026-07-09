import { Activity, AlertTriangle, Archive, Clock3, Network, RadioTower } from 'lucide-react';
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
  tasks?: DeployTask[];
  auditLogs?: AuditLog[];
  forwardingRules: ForwardingRuleView[];
  subscriptions: SubscriptionBundle[];
  configRevisions?: RuntimeConfigRevision[];
  preflightPlans?: RuntimePreflightPlan[];
  runtimeSnapshots?: RuntimeSnapshot[];
  trafficRollups: TrafficRollup[];
  trafficRollupCompactions: TrafficRollupCompaction[];
  trafficRollupExportBusy?: boolean;
  trafficRollupRetentionPolicy?: TrafficRollupRetentionPolicyReadModel;
  trafficRollupRetentionBusy?: boolean;
  systemAlerts?: SystemAlert[];
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
    connectivityHostEvidence: (online: number, total: number, language: AppLanguage) =>
      `${formatNumber(online, language)}/${formatNumber(total, language)} 在线`,
    connectivityMountedHostEvidence: (count: number, language: AppLanguage) =>
      `${formatNumber(count, language)} 入口`,
    connectivityNodeEvidence: (healthy: number, total: number, language: AppLanguage) =>
      `${formatNumber(healthy, language)}/${formatNumber(total, language)} 健康`,
    controlSurfaceRegion: '控制面',
    operationsRailRegion: '运维侧栏',
    hostTelemetryRegion: '主机遥测',
    releaseEvidenceRegion: '发布证据',
    auditAlertRegion: '审计与告警',
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    operatorTriageTitle: '运维分诊',
    operatorTriageSubtitle: '按风险、等待证据和交付面影响排序。',
    triageOpenEvidence: '查看证据',
    triageOpenHosts: '管理主机',
    triageOpenForwarding: '检查转发',
    triageNoAction: '当前无操作',
    triageItems: {
      failedTasks: '失败任务',
      runtimeChanges: '运行中变更',
      agentCoverage: 'Agent 覆盖',
      nodeHealth: '节点健康',
      forwarding: '端口转发',
      subscriptionDelivery: '订阅交付'
    },
    triageMeta: {
      failedTasks: (count: string) => `${count} 条需要恢复`,
      runtimeChanges: (count: string) => `${count} 条等待 Agent evidence`,
      agentCoverage: (online: string, total: string) => `${online}/${total} 在线`,
      nodeHealth: (healthy: string, total: string) => `${healthy}/${total} 健康`,
      forwarding: (active: string, total: string) => `${active}/${total} 启用`,
      subscriptionDelivery: (count: string) => `${count} 个订阅包`
    },
    triageStateLabels: {
      ready: '正常',
      waiting: '等待',
      attention: '注意',
      blocked: '阻断'
    },
    triageEmptyTitle: '控制面暂无对象',
    triageEmptyDescription: '先接入 Agent，再创建客户节点、转发规则或订阅交付。'
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
    connectivityHostEvidence: (online: number, total: number, language: AppLanguage) =>
      `${formatNumber(online, language)}/${formatNumber(total, language)} online`,
    connectivityMountedHostEvidence: (count: number, language: AppLanguage) =>
      `${formatNumber(count, language)} ${count === 1 ? 'entry' : 'entries'}`,
    connectivityNodeEvidence: (healthy: number, total: number, language: AppLanguage) =>
      `${formatNumber(healthy, language)}/${formatNumber(total, language)} healthy`,
    controlSurfaceRegion: 'Control Surface',
    operationsRailRegion: 'Operations Rail',
    hostTelemetryRegion: 'Host Telemetry',
    releaseEvidenceRegion: 'Release Evidence',
    auditAlertRegion: 'Audit & Alerts',
    controlPlaneOverviewAria: 'Master Control Plane Overview',
    controlPlaneLabel: 'Master Control Plane',
    operatorTriageTitle: 'Operator Triage',
    operatorTriageSubtitle: 'Sorted by risk, waiting evidence, and delivery impact.',
    triageOpenEvidence: 'Review Evidence',
    triageOpenHosts: 'Manage Hosts',
    triageOpenForwarding: 'Inspect Forwarding',
    triageNoAction: 'No action',
    triageItems: {
      failedTasks: 'Failed Tasks',
      runtimeChanges: 'Running Changes',
      agentCoverage: 'Agent Coverage',
      nodeHealth: 'Node Health',
      forwarding: 'Forwarding',
      subscriptionDelivery: 'Subscription Delivery'
    },
    triageMeta: {
      failedTasks: (count: string) => `${count} need recovery`,
      runtimeChanges: (count: string) => `${count} waiting for Agent evidence`,
      agentCoverage: (online: string, total: string) => `${online}/${total} online`,
      nodeHealth: (healthy: string, total: string) => `${healthy}/${total} healthy`,
      forwarding: (active: string, total: string) => `${active}/${total} enabled`,
      subscriptionDelivery: (count: string) => `${count} bundles`
    },
    triageStateLabels: {
      ready: 'Ready',
      waiting: 'Waiting',
      attention: 'Attention',
      blocked: 'Blocked'
    },
    triageEmptyTitle: 'No control-plane objects yet',
    triageEmptyDescription: 'Enroll an Agent, then create customer nodes, forwarding rules, or subscription delivery.'
  }
} as const;
type DashboardCopy = (typeof copy)[AppLanguage];
type ConnectivityStageState = 'ready' | 'issues' | 'waiting';
type OperatorTriageState = 'ready' | 'waiting' | 'attention' | 'blocked';
type OperatorTriageItem = {
  id: string;
  label: string;
  value: string;
  meta: string;
  state: OperatorTriageState;
  icon: typeof AlertTriangle;
  actionLabel?: string;
  onAction?: () => void;
};
type ConnectivityStage = {
  id: 'host' | 'mounted-host' | 'node';
  cx: number;
  label: string;
  evidence: string;
  count: string;
  state: ConnectivityStageState;
  tone: string;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function hasTelemetryReport(agent: Agent) {
  return Boolean(agent.telemetry.reportedAt);
}

function resolveConnectivityStageState(total: number, ready: number): ConnectivityStageState {
  if (total <= 0) {
    return 'waiting';
  }

  return ready >= total ? 'ready' : 'issues';
}

function resolveMountedHostState(mountedHostCount: number): ConnectivityStageState {
  return mountedHostCount > 0 ? 'ready' : 'waiting';
}

function getConnectivityStageTone(state: ConnectivityStageState, fallback: string) {
  if (state === 'ready') {
    return fallback;
  }

  if (state === 'issues') {
    return 'var(--ou-danger)';
  }

  return 'var(--ou-text-muted)';
}

const dashboardToneClasses = {
  primary: 'ou-tone-primary',
  success: 'ou-tone-success',
  warning: 'ou-tone-warning',
  danger: 'ou-tone-danger'
} as const;

export function DashboardPage({
  agents,
  nodes,
  tasks = [],
  systemAlerts = [],
  forwardingRules,
  subscriptions,
  language,
  onOpenForwardingWorkspace,
  onOpenHostWorkspace,
  onOpenReleaseEvidenceWorkspace,
  onRefresh
}: DashboardPageProps) {
  const t = copy[language];
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const healthyNodes = nodes.filter((node) => node.status === 'healthy').length;
  const activeForwarding = forwardingRules.filter((rule) => rule.enabled).length;
  const failedTasks = tasks.filter((task) => task.status === 'failed').length;
  const runningTasks = tasks.filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'retrying').length;
  const activeAlerts = systemAlerts.filter((alert) => alert.status === 'active').length;
  const mountedHostCount = countMountedForwardingHosts(forwardingRules);
  const visibleHostProbes = agents.slice(0, 3);
  const connectivityActive = agents.length > 0 || nodes.length > 0 || activeForwarding > 0;
  const hostConnectivityState = resolveConnectivityStageState(agents.length, onlineAgents);
  const mountedHostConnectivityState = resolveMountedHostState(mountedHostCount);
  const nodeConnectivityState = resolveConnectivityStageState(nodes.length, healthyNodes);
  const connectivityStages: ConnectivityStage[] = [
    {
      id: 'host',
      cx: 120,
      label: t.connectivityHost,
      evidence: t.connectivityHostEvidence(onlineAgents, agents.length, language),
      count: `${onlineAgents}/${agents.length}`,
      state: hostConnectivityState,
      tone: getConnectivityStageTone(hostConnectivityState, 'var(--ou-primary)')
    },
    {
      id: 'mounted-host',
      cx: 360,
      label: t.connectivityMountedHost,
      evidence: t.connectivityMountedHostEvidence(mountedHostCount, language),
      count: String(mountedHostCount),
      state: mountedHostConnectivityState,
      tone: getConnectivityStageTone(mountedHostConnectivityState, 'var(--ou-warning)')
    },
    {
      id: 'node',
      cx: 600,
      label: t.connectivityNode,
      evidence: t.connectivityNodeEvidence(healthyNodes, nodes.length, language),
      count: `${healthyNodes}/${nodes.length}`,
      state: nodeConnectivityState,
      tone: getConnectivityStageTone(nodeConnectivityState, 'var(--ou-success)')
    }
  ];

  const cockpitCards = [
    {
      label: language === 'zh' ? '主机接入' : 'Host Access',
      value: `${onlineAgents}/${agents.length}`,
      detail: language === 'zh' ? '在线 Agent' : 'online agents',
      icon: Activity,
      tone: 'primary'
    },
    {
      label: language === 'zh' ? '客户节点' : 'Customer Nodes',
      value: `${healthyNodes}/${nodes.length}`,
      detail: language === 'zh' ? '健康节点' : 'healthy nodes',
      icon: RadioTower,
      tone: 'success'
    },
    {
      label: language === 'zh' ? '端口转发' : 'Forwarding',
      value: formatNumber(activeForwarding, language),
      detail: language === 'zh' ? '启用规则' : 'active rules',
      icon: Network,
      tone: 'warning'
    },
    {
      label: language === 'zh' ? '订阅交付' : 'Subscriptions',
      value: formatNumber(subscriptions.length, language),
      detail: language === 'zh' ? '订阅包' : 'bundles',
      icon: Archive,
      tone: 'danger'
    }
  ];
  const triageItems: OperatorTriageItem[] = createOperatorTriageItems({
    activeAlerts,
    activeForwarding,
    agentsTotal: agents.length,
    failedTasks,
    healthyNodes,
    language,
    nodesTotal: nodes.length,
    onlineAgents,
    runningTasks,
    subscriptionsTotal: subscriptions.length,
    totalForwarding: forwardingRules.length,
    t,
    onOpenForwardingWorkspace,
    onOpenHostWorkspace,
    onOpenReleaseEvidenceWorkspace
  });

  return (
    <ResponsivePage className="dashboard-cockpit dashboard-control-plane overflow-hidden max-md:overflow-visible">
      <ResponsiveSection
        aria-label={t.controlPlaneOverviewAria}
        className="dashboard-control-plane grid grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)] gap-3 max-xl:grid-cols-1"
        compactOnMobile={false}
      >
        <section aria-label={t.controlSurfaceRegion} className="grid min-w-0 gap-3">
          <GlassCard className="dashboard-control-plane-surface relative isolate min-h-0 self-start overflow-hidden border-[var(--ou-border)] bg-[var(--ou-surface)] p-0 shadow-[var(--ou-shadow)]">
            <div
              className="absolute inset-0 bg-[linear-gradient(180deg,var(--ou-surface)_0%,var(--ou-surface-subtle)_100%)]"
              aria-hidden="true"
            />
            <div className="relative z-10 flex min-h-0 flex-col gap-4 p-3 md:p-4">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold tracking-[0.01em] text-[var(--ou-primary)]">
                  {t.controlPlaneLabel}
                </p>
                <h3 className="mt-2 max-w-4xl text-balance text-4xl font-semibold leading-[0.96] text-[var(--ou-text)] md:text-5xl">
                  {t.connectivityTitle}
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="dashboard-control-plane-media relative min-h-[8.5rem] overflow-hidden rounded-lg border border-[var(--ou-border)] bg-[var(--ou-surface)] shadow-[var(--ou-shadow)]">
                  <div className="absolute inset-0 bg-[linear-gradient(var(--ou-grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--ou-grid-line)_1px,transparent_1px),linear-gradient(135deg,var(--ou-primary-softer),transparent_34%)] bg-[length:36px_36px,36px_36px,100%_100%]" aria-hidden="true" />
                  <svg
                    className="dashboard-connectivity-topology relative z-10 h-44 w-full"
                    data-connectivity-state={
                      connectivityStages.some((stage) => stage.state === 'issues')
                        ? 'issues'
                        : connectivityStages.some((stage) => stage.state === 'waiting')
                          ? 'waiting'
                          : 'ready'
                    }
                    role="img"
                    aria-label={t.connectivityAria}
                    viewBox="0 0 720 210"
                  >
                    <defs>
                      <linearGradient id="dashboard-control-plane-flow" x1="0" x2="1" y1="0" y2="0">
                        <stop className="svg-flow-stop-1" offset="0%" stopColor="var(--ou-primary)" />
                        <stop className="svg-flow-stop-2" offset="58%" stopColor="var(--ou-warning)" />
                        <stop className="svg-flow-stop-3" offset="100%" stopColor="var(--ou-danger)" />
                      </linearGradient>
                    </defs>
                    <path
                      className={connectivityActive ? 'dashboard-connectivity-flow svg-line-dash' : 'dashboard-connectivity-flow svg-line-dash opacity-35'}
                      d="M 120 92 C 205 38, 275 146, 360 92 S 515 38, 600 92"
                      fill="none"
                      stroke="url(#dashboard-control-plane-flow)"
                      strokeLinecap="round"
                      strokeWidth="5"
                    />
                    <circle className="dashboard-connectivity-packet dashboard-connectivity-packet-primary" r="7" fill="var(--ou-warning)" stroke="var(--ou-text)" strokeWidth="2">
                      <animateMotion dur="3.2s" keyPoints="0;1" keyTimes="0;1" repeatCount="indefinite">
                        <mpath href="#dashboard-connectivity-route" />
                      </animateMotion>
                    </circle>
                    <circle className="dashboard-connectivity-packet dashboard-connectivity-packet-secondary" r="5" fill="var(--ou-primary)" stroke="var(--ou-surface)" strokeWidth="2">
                      <animateMotion begin="1.1s" dur="3.2s" keyPoints="0;1" keyTimes="0;1" repeatCount="indefinite">
                        <mpath href="#dashboard-connectivity-route" />
                      </animateMotion>
                    </circle>
                    <path
                      d="M 120 92 C 205 38, 275 146, 360 92 S 515 38, 600 92"
                      fill="none"
                      id="dashboard-connectivity-route"
                      opacity="0"
                    />
                    {connectivityStages.map((node, index) => (
                      <g
                        className="dashboard-connectivity-node"
                        data-connectivity-count={node.count}
                        data-connectivity-stage={node.id}
                        data-connectivity-state={node.state}
                        key={node.id}
                      >
                        <circle cx={node.cx} cy="92" r="38" fill="url(#dashboard-control-plane-flow)" opacity={0.1 + index * 0.03} />
                        <circle cx={node.cx} cy="92" r="25" fill={node.tone} opacity="0.16" />
                        <circle cx={node.cx} cy="92" r="18" fill="var(--ou-surface)" stroke="var(--ou-border-strong)" strokeWidth="2" />
                        <circle cx={node.cx} cy="92" r="8" fill={node.tone} />
                        <text x={node.cx} y="98" textAnchor="middle" className="fill-[var(--ou-text)] font-mono text-[9px] font-black">
                          {node.count}
                        </text>
                        <text x={node.cx} y="154" textAnchor="middle" className="dashboard-connectivity-label fill-[var(--ou-text)] text-[13px] font-semibold">
                          {node.label}
                        </text>
                        <text x={node.cx} y="178" textAnchor="middle" className="dashboard-connectivity-evidence fill-[var(--ou-text-muted)] text-[11px] font-semibold">
                          {node.evidence}
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

          <div className="dashboard-control-plane-metric-grid grid grid-cols-2 gap-2 sm:grid-cols-4 max-sm:grid-cols-1">
            {cockpitCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="group relative min-h-[60px] overflow-hidden rounded-lg border border-[var(--ou-border)] bg-[var(--ou-surface)] p-2.5 shadow-[var(--ou-shadow)] transition duration-200 hover:-translate-y-0.5"
                  data-tone={card.tone}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 ${dashboardToneClasses[card.tone as keyof typeof dashboardToneClasses]}`} />
                  <div className="flex h-full flex-col justify-between gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-[var(--ou-text-muted)]">{card.label}</p>
                      <span className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-md border transition duration-200 group-hover:scale-105 ${dashboardToneClasses[card.tone as keyof typeof dashboardToneClasses]}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <div>
                      <p className="text-[1.45rem] font-semibold leading-none text-[var(--ou-text)]">{card.value}</p>
                      <p className="mt-1 truncate text-[11px] font-semibold text-[var(--ou-text-muted)]">{card.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </section>

        <section aria-label={t.operationsRailRegion} className="grid min-w-0 gap-3">
          <OperatorTriagePanel items={triageItems} language={language} t={t} />

          <section aria-label={t.hostTelemetryRegion} className="min-w-0">
            <GlassCard className="dashboard-control-plane-hosts flex min-h-0 flex-col overflow-hidden border-[var(--ou-border)] bg-[var(--ou-surface)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-[var(--ou-text)]">{t.hostProbeTitle}</h4>
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
        </section>
      </ResponsiveSection>
    </ResponsivePage>
  );
}

function createOperatorTriageItems({
  activeAlerts,
  activeForwarding,
  agentsTotal,
  failedTasks,
  healthyNodes,
  language,
  nodesTotal,
  onlineAgents,
  runningTasks,
  subscriptionsTotal,
  totalForwarding,
  t,
  onOpenForwardingWorkspace,
  onOpenHostWorkspace,
  onOpenReleaseEvidenceWorkspace
}: {
  activeAlerts: number;
  activeForwarding: number;
  agentsTotal: number;
  failedTasks: number;
  healthyNodes: number;
  language: AppLanguage;
  nodesTotal: number;
  onlineAgents: number;
  runningTasks: number;
  subscriptionsTotal: number;
  totalForwarding: number;
  t: DashboardCopy;
  onOpenForwardingWorkspace?: () => void;
  onOpenHostWorkspace?: () => void;
  onOpenReleaseEvidenceWorkspace?: () => void;
}): OperatorTriageItem[] {
  const number = (value: number) => formatNumber(value, language);
  const hasAgentGap = agentsTotal === 0 || onlineAgents < agentsTotal;
  const hasNodeGap = nodesTotal === 0 || healthyNodes < nodesTotal;

  return [
    {
      id: 'failed-tasks',
      icon: AlertTriangle,
      label: t.triageItems.failedTasks,
      value: number(failedTasks),
      meta: t.triageMeta.failedTasks(number(failedTasks)),
      state: failedTasks > 0 ? 'blocked' : activeAlerts > 0 ? 'attention' : 'ready',
      actionLabel: t.triageOpenEvidence,
      onAction: onOpenReleaseEvidenceWorkspace
    },
    {
      id: 'runtime-changes',
      icon: Clock3,
      label: t.triageItems.runtimeChanges,
      value: number(runningTasks),
      meta: t.triageMeta.runtimeChanges(number(runningTasks)),
      state: runningTasks > 0 ? 'waiting' : 'ready',
      actionLabel: t.triageOpenEvidence,
      onAction: onOpenReleaseEvidenceWorkspace
    },
    {
      id: 'agent-coverage',
      icon: Activity,
      label: t.triageItems.agentCoverage,
      value: `${onlineAgents}/${agentsTotal}`,
      meta: t.triageMeta.agentCoverage(number(onlineAgents), number(agentsTotal)),
      state: hasAgentGap ? 'attention' : 'ready',
      actionLabel: t.triageOpenHosts,
      onAction: onOpenHostWorkspace
    },
    {
      id: 'node-health',
      icon: RadioTower,
      label: t.triageItems.nodeHealth,
      value: `${healthyNodes}/${nodesTotal}`,
      meta: t.triageMeta.nodeHealth(number(healthyNodes), number(nodesTotal)),
      state: hasNodeGap ? 'attention' : 'ready',
      actionLabel: t.triageOpenHosts,
      onAction: onOpenHostWorkspace
    },
    {
      id: 'forwarding',
      icon: Network,
      label: t.triageItems.forwarding,
      value: `${activeForwarding}/${totalForwarding}`,
      meta: t.triageMeta.forwarding(number(activeForwarding), number(totalForwarding)),
      state: totalForwarding === 0 ? 'waiting' : activeForwarding < totalForwarding ? 'attention' : 'ready',
      actionLabel: t.triageOpenForwarding,
      onAction: onOpenForwardingWorkspace
    },
    {
      id: 'subscription-delivery',
      icon: Archive,
      label: t.triageItems.subscriptionDelivery,
      value: number(subscriptionsTotal),
      meta: t.triageMeta.subscriptionDelivery(number(subscriptionsTotal)),
      state: subscriptionsTotal === 0 ? 'waiting' : 'ready'
    }
  ];
}

function OperatorTriagePanel({ items, language, t }: { items: OperatorTriageItem[]; language: AppLanguage; t: DashboardCopy }) {
  const hasAnyObject = items.some((item) => item.value !== '0' && item.value !== '0/0');

  return (
    <section aria-label={t.operatorTriageTitle} className="dashboard-operator-triage rounded-lg border border-[var(--ou-border)] bg-[var(--ou-surface)] p-3 shadow-[var(--ou-shadow)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-[var(--ou-text)]">{t.operatorTriageTitle}</h4>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ou-text-muted)]">{t.operatorTriageSubtitle}</p>
        </div>
        <span className="ou-chip rounded-full border px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-[0.14em]">
          V2.1
        </span>
      </div>

      {!hasAnyObject ? (
        <div className="ou-empty-state rounded-lg border border-dashed border-[var(--ou-border)] bg-[var(--ou-surface-muted)] p-3">
          <p className="text-sm font-semibold text-[var(--ou-text)]">{t.triageEmptyTitle}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ou-text-muted)]">{t.triageEmptyDescription}</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const Icon = item.icon;
            const actionLabel = item.actionLabel ?? t.triageNoAction;

            return (
              <article
                className="dashboard-triage-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[var(--ou-border)] bg-[var(--ou-surface-subtle)] p-2.5"
                data-triage-state={item.state}
                key={item.id}
              >
                <span className="dashboard-triage-icon grid h-9 w-9 place-items-center rounded-md border" data-triage-state={item.state}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-semibold text-[var(--ou-text)]">{item.label}</p>
                    <span className="dashboard-triage-state rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em]" data-triage-state={item.state}>
                      {t.triageStateLabels[item.state]}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ou-text-muted)]">
                    {item.meta}
                  </p>
                </div>
                <div className="flex min-w-0 flex-col items-end gap-1">
                  <span className="font-mono text-base font-semibold leading-none text-[var(--ou-text)]">{item.value}</span>
                  <button
                    className="ou-mini-button min-h-8 rounded-md border px-2 text-[10px] font-bold text-[var(--ou-text)] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!item.onAction}
                    onClick={item.onAction}
                    type="button"
                  >
                    {actionLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ou-text-subtle)]">
        {language === 'zh' ? '按真实 read model 派生，不使用演示状态' : 'Derived from live read models, no demo-only state'}
      </p>
    </section>
  );
}

function CompactHostProbeCard({ agent, language, t }: { agent: Agent; language: AppLanguage; t: DashboardCopy }) {
  const telemetryReported = hasTelemetryReport(agent);
  const cpuPercent = clampPercent(agent.telemetry.cpuPercent ?? 0);
  const memoryPercent = clampPercent(agent.telemetry.memoryPercent ?? 0);
  const diskPercent = clampPercent(agent.telemetry.diskPercent ?? 0);
  const statusTone =
    agent.status === 'online'
      ? 'bg-[var(--ou-success)] shadow-[0_0_12px_rgba(5,150,105,0.45)]'
      : agent.status === 'degraded'
        ? 'bg-[var(--ou-warning)] shadow-[0_0_12px_rgba(202,138,4,0.42)]'
        : 'bg-[var(--ou-text-subtle)] shadow-[0_0_12px_rgba(82,97,116,0.32)]';

  return (
    <article className="group min-h-0 rounded-lg border border-[var(--ou-border)] bg-[var(--ou-surface)] p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[var(--ou-shadow-interactive)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', statusTone)} />
          <div className="min-w-0">
            <h5 className="truncate text-sm font-semibold text-[var(--ou-text)]">{agent.name}</h5>
            <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--ou-text-muted)]">
              {telemetryReported ? formatDateTime(agent.telemetry.reportedAt!, language) : t.waitingTelemetry}
            </p>
          </div>
        </div>
        <span className="ou-tone-primary rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
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

function countMountedForwardingHosts(forwardingRules: ForwardingRuleView[]) {
  const mountedHosts = new Set<string>();

  forwardingRules.forEach((rule) => {
    if (!rule.enabled) {
      return;
    }

    const entryIds = rule.entryNodeIds.length > 0
      ? rule.entryNodeIds
      : rule.bindings.length > 0
        ? rule.bindings.map((binding) => binding.agentId)
        : [rule.sourceAgentId];

    entryIds.forEach((agentId) => {
      if (agentId.trim().length > 0) {
        mountedHosts.add(agentId);
      }
    });
  });

  return mountedHosts.size;
}

function CompactProbeBar({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-[var(--ou-surface-muted)] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-[var(--ou-text-muted)]">{label}</p>
        <p className="truncate text-[10px] font-semibold text-[var(--ou-text)]">{value}</p>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--ou-border)]">
        <div className="ou-progress-runtime h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EmptySignal({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--ou-border)] bg-[var(--ou-surface-muted)] p-4 text-xs font-semibold text-[var(--ou-text-muted)]">
      {label}
    </div>
  );
}
