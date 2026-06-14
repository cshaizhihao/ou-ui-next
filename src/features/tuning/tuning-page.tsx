import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  Network,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import {
  ResponsivePage,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { Agent, TuningProfile } from '../../domain';
import type { DeployTask, DeployTaskStatus } from '../../domain/task';
import { formatNumber } from '../shared/format';

export type { TuningProfile };

type TuningParameter = TuningProfile['parameters'][number];

type TuningPageProps = {
  agents: Agent[];
  language: AppLanguage;
  profiles: TuningProfile[];
  tasks?: DeployTask[];
  taskMutationBusy?: boolean;
  onRunTask: (id: string, agentId: string, profile?: TuningProfile) => void;
};

const parameterStatus: TuningParameter['status'] = 'backend_required';
type TuningReleaseGateState = 'ready' | 'issues' | 'waiting';

const keys = {
  congestionControl: 'net.ipv4.tcp_congestion_control',
  defaultQdisc: 'net.core.default_qdisc',
  tcpReceiveBuffer: 'net.ipv4.tcp_rmem',
  tcpWriteBuffer: 'net.ipv4.tcp_wmem',
  somaxconn: 'net.core.somaxconn',
  tcpMaxSynBacklog: 'net.ipv4.tcp_max_syn_backlog'
} as const;

const defaults = {
  congestionControl: 'bbr',
  defaultQdisc: 'fq',
  tcpReceiveBuffer: '4096 87380 67108864',
  tcpWriteBuffer: '4096 65536 67108864',
  somaxconn: '65535',
  tcpMaxSynBacklog: '65535'
} as const;

const copy = {
  zh: {
    title: '系统调优',
    subtitle: 'BBR 探测 / TCP 状态 / 预设下发',
    operationalOverview: '运营总览',
    operationalOverviewHint: '',
    tuningPath: '调优链路',
    pathProfile: 'Profile',
    pathAgent: 'Agent',
    pathAuditTask: '审计任务',
    auditState: '审计状态',
    riskProfiles: '风险 Profile',
    highRiskSummary: (high: number, total: number) => `${high} 高 / ${total}`,
    parameters: '参数',
    latestExecution: '最近执行',
    targetHost: '目标主机',
    noAgent: '暂无可用 Agent',
    hostStatus: '主机状态',
    online: '在线',
    offline: '离线',
    detectionPanel: '主机调优探测',
    bbrDetected: 'BBR 已安装',
    bbrMissing: 'BBR 未确认',
    tcpStatus: 'TCP 状态',
    tcpReady: '预设可下发',
    tcpWaiting: '等待 Agent 探测',
    kernelVersion: '内核版本',
    tuningPreset: '调优预设',
    tuningPresetPanel: '调优预设面板',
    tuningPresetHint: '',
    dispatchTuningPreset: '下发调优预设',
    presetRisk: '风险',
    presetParameterCount: '参数',
    presetNames: {
      'bbr-fq': 'BBR + FQ 预设',
      'tcp-balanced': 'TCP 均衡预设',
      'tcp-high-throughput': 'TCP 高吞吐预设'
    },
    presetDescriptions: {
      'bbr-fq': '',
      'tcp-balanced': '',
      'tcp-high-throughput': ''
    },
    somaxconn: '连接队列',
    tcpMaxSynBacklog: 'SYN 队列',
    presetPlan: '预设执行计划',
    presetPlanEmpty: '等待选择调优预设',
    executionStatus: '执行状态',
    ready: '就绪',
    noExecution: '暂无调优执行记录',
    submittingChange: '变更提交中',
    taskSteps: '执行步骤',
    failure: '错误',
    systemTuningCockpit: '系统调优 cockpit',
    tuningControlRail: '调优控制轨',
    tuningExecutionWorkspace: '调优执行工作区',
    systemTuningReleaseGates: '系统调优发布门禁',
    systemTuningReleaseGatesHint: '',
    agentTargetGate: 'Agent 目标',
    agentTargetGateDetail: (agentLabel: string, status: string) => `${agentLabel} / ${status}`,
    tcpProfileGate: 'TCP Profile',
    tcpProfileGateDetail: (parameterTotal: number, language: AppLanguage) =>
      `${formatNumber(parameterTotal, language)} 个 TCP 参数进入执行计划`,
    executionHealthGate: '执行健康',
    executionHealthGateDetail: (statusLabel: string) => `最近执行状态：${statusLabel}`,
    dispatchReadinessGate: '下发准备度',
    dispatchReadinessGateDetail: '可下发',
    gateStateLabel: {
      ready: '就绪',
      issues: '异常',
      waiting: '等待'
    },
    confirmDispatch: (name: string, agent: string) => `确认下发 ${name} 到 ${agent}？`,
    statusLabels: {
      queued: '已排队',
      running: '执行中',
      succeeded: '已成功',
      failed: '失败',
      retrying: '重试中',
      rolled_back: '已回滚',
      canceled: '已取消'
    }
  },
  en: {
    title: 'System Tuning',
    subtitle: 'BBR probe / TCP state / preset dispatch',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: '',
    tuningPath: 'Tuning path',
    pathProfile: 'Profile',
    pathAgent: 'Agent',
    pathAuditTask: 'Audit Task',
    auditState: 'Audit State',
    riskProfiles: 'Risk Profiles',
    highRiskSummary: (high: number, total: number) => `${high} High / ${total}`,
    parameters: 'Parameters',
    latestExecution: 'Latest Execution',
    targetHost: 'Target Host',
    noAgent: 'No Agent available',
    hostStatus: 'Host Status',
    online: 'Online',
    offline: 'Offline',
    detectionPanel: 'Host Tuning Probe',
    bbrDetected: 'BBR Installed',
    bbrMissing: 'BBR Unconfirmed',
    tcpStatus: 'TCP Status',
    tcpReady: 'Preset Ready',
    tcpWaiting: 'Waiting for Agent probe',
    kernelVersion: 'Kernel Version',
    tuningPreset: 'Tuning Preset',
    tuningPresetPanel: 'Tuning Preset Panel',
    tuningPresetHint: '',
    dispatchTuningPreset: 'Dispatch Tuning Preset',
    presetRisk: 'Risk',
    presetParameterCount: 'Parameters',
    presetNames: {
      'bbr-fq': 'BBR + FQ Preset',
      'tcp-balanced': 'TCP Balanced Preset',
      'tcp-high-throughput': 'TCP High Throughput Preset'
    },
    presetDescriptions: {
      'bbr-fq': '',
      'tcp-balanced': '',
      'tcp-high-throughput': ''
    },
    somaxconn: 'Connection backlog',
    tcpMaxSynBacklog: 'SYN backlog',
    presetPlan: 'Preset Execution Plan',
    presetPlanEmpty: 'Waiting for tuning preset',
    executionStatus: 'Execution Status',
    ready: 'Ready',
    noExecution: 'No tuning execution yet',
    submittingChange: 'Submitting change',
    taskSteps: 'Task Steps',
    failure: 'Error',
    systemTuningCockpit: 'System tuning cockpit',
    tuningControlRail: 'Tuning control rail',
    tuningExecutionWorkspace: 'Tuning execution workspace',
    systemTuningReleaseGates: 'System Tuning Release Gates',
    systemTuningReleaseGatesHint: '',
    agentTargetGate: 'Agent Target',
    agentTargetGateDetail: (agentLabel: string, status: string) => `${agentLabel} / ${status}`,
    tcpProfileGate: 'TCP Profile',
    tcpProfileGateDetail: (parameterTotal: number, language: AppLanguage) =>
      `${formatNumber(parameterTotal, language)} TCP parameters in execution plan`,
    executionHealthGate: 'Execution Health',
    executionHealthGateDetail: (statusLabel: string) => `Latest execution state: ${statusLabel}`,
    dispatchReadinessGate: 'Dispatch Readiness',
    dispatchReadinessGateDetail: 'Ready to dispatch',
    gateStateLabel: {
      ready: 'Ready',
      issues: 'Issues',
      waiting: 'Waiting'
    },
    confirmDispatch: (name: string, agent: string) => `Dispatch ${name} to ${agent}?`,
    statusLabels: {
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Succeeded',
      failed: 'Failed',
      retrying: 'Retrying',
      rolled_back: 'Rolled back',
      canceled: 'Canceled'
    }
  }
} as const;

type TuningCopy = (typeof copy)[AppLanguage];
type TuningReleaseGate = {
  detail: string;
  label: string;
  state: TuningReleaseGateState;
  value: string;
};
type TuningPresetId = 'bbr-fq' | 'tcp-balanced' | 'tcp-high-throughput';
type TuningPresetDefinition = {
  id: TuningPresetId;
  target: TuningProfile['target'];
  riskLevel: TuningProfile['riskLevel'];
  parameters: Array<{ key: string; value: string }>;
};

const tuningPresetDefinitions: TuningPresetDefinition[] = [
  {
    id: 'bbr-fq',
    target: 'kernel',
    riskLevel: 'medium',
    parameters: [
      { key: keys.congestionControl, value: defaults.congestionControl },
      { key: keys.defaultQdisc, value: defaults.defaultQdisc }
    ]
  },
  {
    id: 'tcp-balanced',
    target: 'network',
    riskLevel: 'medium',
    parameters: [
      { key: keys.congestionControl, value: defaults.congestionControl },
      { key: keys.defaultQdisc, value: defaults.defaultQdisc },
      { key: keys.tcpReceiveBuffer, value: defaults.tcpReceiveBuffer },
      { key: keys.tcpWriteBuffer, value: defaults.tcpWriteBuffer },
      { key: keys.somaxconn, value: defaults.somaxconn },
      { key: keys.tcpMaxSynBacklog, value: defaults.tcpMaxSynBacklog }
    ]
  },
  {
    id: 'tcp-high-throughput',
    target: 'network',
    riskLevel: 'high',
    parameters: [
      { key: keys.congestionControl, value: defaults.congestionControl },
      { key: keys.defaultQdisc, value: defaults.defaultQdisc },
      { key: keys.tcpReceiveBuffer, value: '4096 87380 134217728' },
      { key: keys.tcpWriteBuffer, value: '4096 65536 134217728' },
      { key: keys.somaxconn, value: defaults.somaxconn },
      { key: keys.tcpMaxSynBacklog, value: defaults.tcpMaxSynBacklog }
    ]
  }
];

function createParameter(key: string, value: string): TuningParameter {
  return {
    key,
    value: value.trim(),
    status: parameterStatus
  };
}

function createProfile(input: {
  id: string;
  name: string;
  target: TuningProfile['target'];
  riskLevel: TuningProfile['riskLevel'];
  parameters: TuningParameter[];
  template?: TuningProfile;
}): TuningProfile {
  return {
    id: input.template?.id ?? input.id,
    name: input.template?.name ?? input.name,
    enabled: input.template?.enabled ?? true,
    target: input.target,
    riskLevel: input.template?.riskLevel ?? input.riskLevel,
    parameters: input.parameters
  };
}

function createPresetProfile(preset: TuningPresetDefinition, t: TuningCopy): TuningProfile {
  return createProfile({
    id: preset.id,
    name: t.presetNames[preset.id],
    target: preset.target,
    riskLevel: preset.riskLevel,
    parameters: preset.parameters.map((parameter) => createParameter(parameter.key, parameter.value))
  });
}

function latestTuningTask(tasks: DeployTask[]) {
  return [...tasks]
    .filter((task) => task.operation === 'system.tune')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function getStatusTone(status: DeployTaskStatus) {
  switch (status) {
    case 'succeeded':
      return 'border-[#00A878] bg-[#00A878]/[0.12] text-[#006B50] dark:border-[#35E68E]/25 dark:bg-[#00A878]/[0.14] dark:text-[#9EF4C4]';
    case 'failed':
      return 'border-[#FF3D18] bg-[#FFD8C6]/72 text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]';
    case 'running':
    case 'retrying':
      return 'border-[#FF3D18] bg-[#FFD8C6]/72 text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]';
    default:
      return 'border-[#07111F]/20 bg-[#FFFDF5] text-[#35405A] dark:border-white/10 dark:bg-white/5 dark:text-white/65';
  }
}

function StatusIcon({ status }: { status: DeployTaskStatus }) {
  if (status === 'succeeded') {
    return <CheckCircle2 className="h-4 w-4" />;
  }

  if (status === 'failed') {
    return <AlertTriangle className="h-4 w-4" />;
  }

  if (status === 'running' || status === 'retrying') {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  return <Clock3 className="h-4 w-4" />;
}

function createTuningReleaseGates({
  dispatchDisabled,
  language,
  presetProfile,
  recentTask,
  targetAgent,
  targetAgentLabel,
  t
}: {
  dispatchDisabled: boolean;
  language: AppLanguage;
  presetProfile: TuningProfile;
  recentTask: DeployTask | undefined;
  targetAgent: Agent | undefined;
  targetAgentLabel: string;
  t: TuningCopy;
}): TuningReleaseGate[] {
  const agentStatusLabel = targetAgent?.status === 'online' ? t.online : t.offline;
  const agentState: TuningReleaseGateState =
    targetAgent?.status === 'online' ? 'ready' : targetAgent ? 'issues' : 'waiting';
  const tcpParameterTotal = presetProfile.parameters.length;
  const tcpState: TuningReleaseGateState =
    tcpParameterTotal > 0 && presetProfile.parameters.every((parameter) => parameter.value.trim().length > 0)
      ? 'ready'
      : 'issues';
  const executionState: TuningReleaseGateState =
    recentTask?.status === 'failed' || recentTask?.status === 'canceled'
      ? 'issues'
      : recentTask?.status === 'running' || recentTask?.status === 'retrying' || recentTask?.status === 'queued'
        ? 'waiting'
        : 'ready';
  const dispatchState: TuningReleaseGateState = dispatchDisabled ? 'waiting' : 'ready';
  const latestExecutionLabel = recentTask ? t.statusLabels[recentTask.status] : t.ready;

  return [
    {
      detail: t.agentTargetGateDetail(targetAgentLabel || t.noAgent, agentStatusLabel),
      label: t.agentTargetGate,
      state: agentState,
      value: t.gateStateLabel[agentState]
    },
    {
      detail: t.tcpProfileGateDetail(tcpParameterTotal, language),
      label: t.tcpProfileGate,
      state: tcpState,
      value: t.gateStateLabel[tcpState]
    },
    {
      detail: t.executionHealthGateDetail(latestExecutionLabel),
      label: t.executionHealthGate,
      state: executionState,
      value: t.gateStateLabel[executionState]
    },
    {
      detail: t.dispatchReadinessGateDetail,
      label: t.dispatchReadinessGate,
      state: dispatchState,
      value: t.gateStateLabel[dispatchState]
    }
  ];
}

export function TuningPage({
  agents,
  language,
  profiles,
  tasks = [],
  taskMutationBusy = false,
  onRunTask
}: TuningPageProps) {
  const t = copy[language];
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [selectedPresetId, setSelectedPresetId] = useState<TuningPresetId>('bbr-fq');
  const targetAgentId = agents.some((agent) => agent.id === selectedAgentId) ? selectedAgentId : agents[0]?.id ?? '';
  const targetAgent = agents.find((agent) => agent.id === targetAgentId);
  const targetAgentLabel = targetAgent ? `${targetAgent.name} / ${targetAgent.publicAddress}` : targetAgentId;
  const recentTask = useMemo(() => latestTuningTask(tasks), [tasks]);
  const highRiskProfileCount = profiles.filter((profile) => profile.riskLevel === 'high').length;
  const parameterCount = profiles.reduce((total, profile) => total + profile.parameters.length, 0);
  const selectedPresetDefinition =
    tuningPresetDefinitions.find((preset) => preset.id === selectedPresetId) ?? tuningPresetDefinitions[0];
  const presetProfile = createPresetProfile(selectedPresetDefinition, t);
  const dispatchDisabled = taskMutationBusy || !targetAgentId;
  const releaseGates = createTuningReleaseGates({
    dispatchDisabled,
    language,
    presetProfile,
    recentTask,
    targetAgent,
    targetAgentLabel,
    t
  });
  const bbrService = targetAgent?.telemetry.runtimeServices?.find((service) => service.moduleKind === 'bbr');
  const bbrInstalled = Boolean(targetAgent?.capabilities.includes('bbr') || bbrService?.status === 'active');
  const tcpProbeReady = Boolean(targetAgent?.telemetry.reportedAt || targetAgent?.lastHeartbeatAt);

  function dispatchProfile(profile: TuningProfile) {
    if (dispatchDisabled) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' || window.confirm(t.confirmDispatch(profile.name, targetAgentLabel));

    if (confirmed) {
      onRunTask(profile.id, targetAgentId, profile);
    }
  }

  return (
    <ResponsivePage className="space-y-3 md:space-y-4">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 overflow-hidden border border-[#07111F]/25 bg-[#FFFDF5]/92 p-3 shadow-[0_14px_38px_-30px_rgba(7,17,31,0.28)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)] max-md:bg-white/92 max-md:shadow-sm max-md:dark:bg-slate-950/88"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[#1E3AFF] dark:text-primary">
              {t.operationalOverview}
            </p>
            <h3 className="mt-2 text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
            <p className="mt-2 max-w-4xl text-xs leading-6 text-[#35405A] dark:text-white/50">{t.subtitle}</p>
            <div className="mt-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
              <p className="text-sm font-semibold text-[#07111F] dark:text-white">{t.tuningPath}</p>
            </div>
            <TuningPath labels={[t.pathProfile, t.pathAgent, t.pathAuditTask]} />
            {t.operationalOverviewHint ? (
              <p className="mt-2 max-w-3xl text-xs leading-6 text-[#35405A] dark:text-white/50">
                {t.operationalOverviewHint}
              </p>
            ) : null}
          </div>

          <div className="tuning-summary-grid grid min-w-0 gap-2 sm:grid-cols-2 xl:w-[28rem] xl:grid-cols-2">
            <TuningSummaryCard
              icon={ShieldCheck}
              label={t.riskProfiles}
              value={t.highRiskSummary(highRiskProfileCount, profiles.length)}
            />
            <TuningSummaryCard icon={SlidersHorizontal} label={t.parameters} value={String(parameterCount)} />
            <TuningSummaryCard
              icon={TerminalSquare}
              label={t.latestExecution}
              value={recentTask ? t.statusLabels[recentTask.status] : t.ready}
            />
            <div className="tuning-summary-card min-h-[64px] border border-[#FF3D18] bg-[#FFD8C6]/72 p-2.5 text-xs font-black text-[#B93C17] shadow-sm dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]">
              {t.auditState}: {recentTask ? t.statusLabels[recentTask.status] : t.ready}
            </div>
          </div>
        </div>
      </section>

      <WorkspaceCockpit aria-label={t.systemTuningCockpit} className="tuning-ops-cockpit stagger-2">
        <div className="tuning-ops-cockpit-grid grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label={t.tuningControlRail}
            className="tuning-ops-rail border-b border-[#07111F]/20 bg-[#EAF3D1]/45 p-3 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-3 xl:sticky xl:top-0">
              <div className="border border-[#07111F]/18 bg-[#FFFDF5]/82 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center border border-[#1E3AFF] bg-[#DCE1FF]/70 text-[#1E3AFF] shadow-sm dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                    <ServerCog className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-bold text-[#07111F] dark:text-white">{t.targetHost}</h4>
                    <p className="mt-1 truncate text-[11px] font-semibold text-[#35405A] dark:text-white/45">
                      {targetAgentLabel || t.noAgent}
                    </p>
                  </div>
                </div>
                <select
                  aria-label={t.targetHost}
                  className="ou-select mt-3 min-h-10 w-full border border-[#07111F]/20 bg-[#FFFDF5] px-3 text-sm font-bold text-[#07111F] outline-none transition focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 dark:border-white/10 dark:bg-black/20 dark:text-white dark:focus-visible:ring-primary/40"
                  disabled={agents.length === 0}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  value={targetAgentId}
                >
                  {agents.length === 0 ? <option value="">{t.noAgent}</option> : null}
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} / {agent.publicAddress}
                    </option>
                  ))}
                </select>
                <div className="mt-3 grid gap-2">
                  <Metric label={t.hostStatus} value={targetAgent?.status === 'online' ? t.online : t.offline} />
                  {taskMutationBusy ? (
                    <div
                      className="flex min-h-[64px] items-center gap-2 border border-[#FF3D18] bg-[#FFD8C6]/72 px-3 py-2 text-xs font-bold text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]"
                      role="status"
                    >
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t.submittingChange}
                    </div>
                  ) : (
                    <Metric label={t.executionStatus} value={recentTask ? t.statusLabels[recentTask.status] : t.ready} />
                  )}
                </div>
              </div>

              <TuningReleaseGatePanel gates={releaseGates} t={t} />

              <TuningProbePanel
                bbrInstalled={bbrInstalled}
                kernelVersion={targetAgent?.hardware.kernelVersion}
                tcpProbeReady={tcpProbeReady}
                t={t}
              />

              <TuningPresetCard
                disabled={dispatchDisabled}
                onApply={() => dispatchProfile(presetProfile)}
                onPresetChange={setSelectedPresetId}
                presetId={selectedPresetId}
                t={t}
              />
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.tuningExecutionWorkspace} className="tuning-ops-workspace min-h-0">
            <div className="tuning-ops-workspace-stack space-y-3 p-3">
              <GlassCard className="tuning-ops-status-panel p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                      <p className="text-sm font-semibold text-[#07111F] dark:text-white">{t.tuningPath}</p>
                    </div>
                    <TuningPath labels={[t.pathProfile, t.pathAgent, t.pathAuditTask]} />
                  </div>
                  <div className="min-h-[44px] border border-[#07111F]/18 bg-[#EAF3D1]/65 px-3 py-2.5 text-xs font-black text-[#07111F] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                    {t.auditState}: {recentTask ? t.statusLabels[recentTask.status] : t.ready}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Metric label={t.riskProfiles} value={t.highRiskSummary(highRiskProfileCount, profiles.length)} />
                  <Metric label={t.parameters} value={String(parameterCount)} />
                  <Metric label={t.latestExecution} value={recentTask ? t.statusLabels[recentTask.status] : t.ready} />
                </div>
              </GlassCard>

              <div className="tuning-ops-action-grid grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
                <PresetPlanCard profile={presetProfile} t={t} />
                <ExecutionStatusCard language={language} task={recentTask} />
              </div>

              <GlassCard className="tuning-ops-status-panel stagger-2 p-3">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.executionStatus}</h4>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Boundary icon={ShieldCheck} label="BBR" value="install_or_enable_bbr" />
                  <Boundary icon={Network} label="TCP" value="apply_tcp_buffers" />
                </div>
              </GlassCard>
            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>
    </ResponsivePage>
  );
}

function TuningPath({ labels }: { labels: string[] }) {
  return (
    <ol className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center border border-[#1E3AFF] bg-[#DCE1FF] text-[11px] font-black text-[#1E3AFF] dark:border-primary/25 dark:bg-primary/10 dark:text-primary"
          >
            {index + 1}
          </span>
          <span className="truncate text-xs font-black text-[#07111F] dark:text-white/80">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function TuningSummaryCard({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="tuning-summary-card min-h-[64px] border border-[#07111F]/18 bg-[#FFFDF5]/74 p-2.5 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</p>
          <p className="mt-1 truncate text-base font-black text-[#07111F] dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0 text-[#1E3AFF] dark:text-primary" />
      </div>
    </div>
  );
}

function TuningProbePanel({
  bbrInstalled,
  kernelVersion,
  tcpProbeReady,
  t
}: {
  bbrInstalled: boolean;
  kernelVersion?: string;
  tcpProbeReady: boolean;
  t: TuningCopy;
}) {
  return (
    <section
      aria-label={t.detectionPanel}
      className="tuning-ops-tool-panel border border-[#07111F]/18 bg-[#FFFDF5]/82 p-3 dark:border-white/10 dark:bg-white/[0.03]"
      role="region"
    >
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
        <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.detectionPanel}</h4>
      </div>
      <div className="mt-3 grid gap-2">
        <Metric label="BBR" value={bbrInstalled ? t.bbrDetected : t.bbrMissing} />
        <Metric label={t.tcpStatus} value={tcpProbeReady ? t.tcpReady : t.tcpWaiting} />
        <Metric label={t.kernelVersion} value={kernelVersion?.trim() || '-'} />
      </div>
    </section>
  );
}

function PresetPlanCard({ profile, t }: { profile: TuningProfile; t: TuningCopy }) {
  return (
    <GlassCard aria-label={t.presetPlan} className="tuning-ops-plan-panel stagger-2 p-3" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
          <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.presetPlan}</h4>
        </div>
        <span className="border border-[#FF3D18] bg-[#FFD8C6]/72 px-2.5 py-1 text-[10px] font-black uppercase text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]">
          {t.presetRisk}: {profile.riskLevel}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {profile.parameters.length > 0 ? (
          profile.parameters.map((parameter) => (
            <article
              aria-label={parameter.key}
              className="tuning-ops-plan-row min-h-[54px] border border-[#07111F]/18 px-3 py-2 dark:border-white/10"
              key={parameter.key}
            >
              <p className="break-all font-mono text-[11px] font-bold text-[#07111F] dark:text-white/80">
                {parameter.key}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-[#35405A] dark:text-white/45">
                {parameter.value}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm font-semibold text-[#35405A] dark:text-white/45">{t.presetPlanEmpty}</p>
        )}
      </div>
    </GlassCard>
  );
}

function TuningPresetCard({
  disabled,
  onApply,
  onPresetChange,
  presetId,
  t
}: {
  disabled: boolean;
  onApply: () => void;
  onPresetChange: (presetId: TuningPresetId) => void;
  presetId: TuningPresetId;
  t: TuningCopy;
}) {
  const selectedPreset = tuningPresetDefinitions.find((preset) => preset.id === presetId) ?? tuningPresetDefinitions[0];

  return (
    <GlassCard aria-label={t.tuningPresetPanel} className="tuning-ops-tool-panel stagger-2 p-3" role="group">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
        <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.tuningPresetPanel}</h4>
      </div>
      {t.tuningPresetHint ? (
        <p className="mt-2 text-xs leading-5 text-[#35405A] dark:text-white/50">{t.tuningPresetHint}</p>
      ) : null}
      <label className="mt-3 block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
          {t.tuningPreset}
        </span>
        <select
          aria-label={t.tuningPreset}
          className="ou-select mt-1 min-h-8 w-full bg-transparent text-sm font-bold text-[#07111F] outline-none dark:text-white"
          onChange={(event) => onPresetChange(event.target.value as TuningPresetId)}
          value={presetId}
        >
          {tuningPresetDefinitions.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t.presetNames[preset.id]}
            </option>
          ))}
        </select>
      </label>
      {t.presetDescriptions[selectedPreset.id] ? (
        <p className="mt-2 text-[11px] leading-5 text-[#35405A] dark:text-white/45">
          {t.presetDescriptions[selectedPreset.id]}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label={t.presetRisk} value={selectedPreset.riskLevel} />
        <Metric label={t.presetParameterCount} value={String(selectedPreset.parameters.length)} />
      </div>
      <GlowButton className="mt-3 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} onClick={onApply}>
        {t.dispatchTuningPreset}
      </GlowButton>
    </GlassCard>
  );
}

function TuningReleaseGatePanel({ gates, t }: { gates: TuningReleaseGate[]; t: TuningCopy }) {
  return (
    <section
      aria-label={t.systemTuningReleaseGates}
      className="tuning-release-gate-panel overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_14px_34px_-30px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/30 dark:bg-white/[0.035]"
      role="region"
    >
      <div className="border-b border-[#07111F] bg-[#1E3AFF] px-3 py-2.5 text-white shadow-[inset_0_-3px_0_#D9FF00] dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/80">
        <p className="text-xs font-black uppercase tracking-widest">{t.systemTuningReleaseGates}</p>
        {t.systemTuningReleaseGatesHint ? (
          <p className="mt-1 text-[11px] leading-5 text-white/82">{t.systemTuningReleaseGatesHint}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 divide-y divide-[#07111F]/20 dark:divide-[#6B7CFF]/20">
        {gates.map((gate) => (
          <TuningReleaseGateRow gate={gate} key={gate.label} />
        ))}
      </div>
    </section>
  );
}

function TuningReleaseGateRow({ gate }: { gate: TuningReleaseGate }) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.12] text-[#006B50] dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]',
    issues: 'border-[#FF3D18] bg-[#FF3D18]/[0.13] text-[#C92810] dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.24] text-[#425200] dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]'
  } satisfies Record<TuningReleaseGateState, string>;

  return (
    <article
      aria-label={gate.label}
      className="group relative min-h-[76px] px-3 py-2.5 transition-[background-color,transform] duration-200 ease-out hover:bg-[#EAF3D1]/70 motion-reduce:transition-none dark:hover:bg-white/[0.055]"
      role="group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#07111F] dark:text-white">{gate.label}</p>
          <p className="mt-1 text-[11px] leading-5 text-[#35405A] dark:text-white/55">{gate.detail}</p>
        </div>
        <span className={`shrink-0 border px-2.5 py-1 text-xs font-black ${stateClass[gate.state]}`}>
          {gate.value}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-75 bg-[#1E3AFF] transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
      />
    </article>
  );
}

function ExecutionStatusCard({ language, task }: { language: AppLanguage; task: DeployTask | undefined }) {
  const t = copy[language];

  return (
    <GlassCard aria-label={t.executionStatus} className="tuning-ops-status-panel stagger-2 p-3" role="region">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
          <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.executionStatus}</h4>
        </div>
        {task ? (
          <span
            className={`inline-flex min-h-8 items-center gap-2 border px-3 text-xs font-bold ${getStatusTone(task.status)}`}
          >
            <StatusIcon status={task.status} />
            {t.statusLabels[task.status]}
          </span>
        ) : null}
      </div>
      {task ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-bold text-[#07111F] dark:text-white/80">{task.targetLabel}</p>
            <p className="mt-1 text-[11px] font-semibold text-[#35405A] dark:text-white/45">{task.updatedAt}</p>
          </div>
          {task.failureReason ? (
            <div
              className="border border-[#FF3D18] bg-[#FFD8C6]/72 p-3 text-xs font-bold text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]"
              role="alert"
            >
              <span className="uppercase tracking-widest">{t.failure}: </span>
              {task.failureReason}
            </div>
          ) : null}
          {task.steps.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                {t.taskSteps}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {task.steps.map((step) => (
                  <div
                    className="flex items-center justify-between gap-3 border border-[#07111F]/18 p-3 dark:border-white/10"
                    key={step.id}
                  >
                    <span className="text-xs font-semibold text-[#35405A] dark:text-white/70">{step.label}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-[#35405A] dark:text-white/45">{t.noExecution}</p>
      )}
    </GlassCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      aria-label={label}
      className="tuning-ops-metric flex min-h-[64px] items-center justify-between border border-[#07111F]/18 px-3 py-2 dark:border-white/10"
      role="group"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</span>
      <span className="text-sm font-black text-[#07111F] dark:text-white">{value}</span>
    </div>
  );
}

function Boundary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="min-h-[64px] border border-[#07111F]/18 p-3 dark:border-white/10">
      <Icon className="mb-2 h-4 w-4 text-[#1E3AFF] dark:text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</p>
      <p className="mt-1 font-mono text-xs font-bold text-[#07111F] dark:text-white/80">{value}</p>
    </div>
  );
}
