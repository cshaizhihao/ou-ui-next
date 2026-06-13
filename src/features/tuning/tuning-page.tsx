import { type ReactNode, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  Network,
  Plus,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Trash2
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
    subtitle: 'BBR、TCP buffer 和 allowlist sysctl 调优通过 Agent 任务执行。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先确认调优 profile、目标 Agent、风险等级和审计任务，再下发内核或网络参数。',
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
    bbrPanel: 'BBR 配置',
    congestionControl: 'TCP 拥塞控制',
    defaultQdisc: '默认队列',
    applyBbr: '应用 BBR',
    tcpPanel: 'TCP 调优',
    tcpReceiveBuffer: 'TCP 接收缓冲',
    tcpWriteBuffer: 'TCP 发送缓冲',
    somaxconn: '连接队列',
    tcpMaxSynBacklog: 'SYN 队列',
    applyTcpTuning: '应用 TCP 调优',
    customSysctl: '自定义 sysctl',
    customSysctlKey: '自定义 sysctl 键',
    customSysctlValue: '自定义 sysctl 值',
    addSysctl: '添加 sysctl',
    applyCustomSysctl: '应用自定义 sysctl',
    removeSysctl: (key: string) => `移除 ${key}`,
    executionStatus: '执行状态',
    ready: '就绪',
    noExecution: '暂无调优执行记录',
    submittingChange: '变更提交中',
    taskSteps: '执行步骤',
    failure: '错误',
    systemTuningCockpit: '系统调优 cockpit',
    tuningControlRail: '调优控制轨',
    tuningExecutionWorkspace: '调优执行工作区',
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
    subtitle: 'BBR, TCP buffers, and allowlisted sysctl changes run as Agent tasks.',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: 'Check tuning profiles, target Agent, risk levels, and audit task state before dispatching kernel or network parameters.',
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
    bbrPanel: 'BBR Configuration',
    congestionControl: 'TCP congestion control',
    defaultQdisc: 'Default queue discipline',
    applyBbr: 'Apply BBR',
    tcpPanel: 'TCP Tuning',
    tcpReceiveBuffer: 'TCP receive buffer',
    tcpWriteBuffer: 'TCP write buffer',
    somaxconn: 'Connection backlog',
    tcpMaxSynBacklog: 'SYN backlog',
    applyTcpTuning: 'Apply TCP Tuning',
    customSysctl: 'Custom sysctl',
    customSysctlKey: 'Custom sysctl key',
    customSysctlValue: 'Custom sysctl value',
    addSysctl: 'Add sysctl',
    applyCustomSysctl: 'Apply Custom sysctl',
    removeSysctl: (key: string) => `Remove ${key}`,
    executionStatus: 'Execution Status',
    ready: 'Ready',
    noExecution: 'No tuning execution yet',
    submittingChange: 'Submitting change',
    taskSteps: 'Task Steps',
    failure: 'Error',
    systemTuningCockpit: 'System tuning cockpit',
    tuningControlRail: 'Tuning control rail',
    tuningExecutionWorkspace: 'Tuning execution workspace',
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

function findProfileByParameter(profiles: TuningProfile[], parameterKey: string) {
  return profiles.find((profile) => profile.parameters.some((parameter) => parameter.key === parameterKey));
}

function readParameter(profile: TuningProfile | undefined, parameterKey: string, fallback: string) {
  return profile?.parameters.find((parameter) => parameter.key === parameterKey)?.value ?? fallback;
}

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

function latestTuningTask(tasks: DeployTask[]) {
  return [...tasks]
    .filter((task) => task.operation === 'system.tune')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function getStatusTone(status: DeployTaskStatus) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200';
    case 'running':
    case 'retrying':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/65';
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

export function TuningPage({
  agents,
  language,
  profiles,
  tasks = [],
  taskMutationBusy = false,
  onRunTask
}: TuningPageProps) {
  const t = copy[language];
  const bbrTemplate = useMemo(() => findProfileByParameter(profiles, keys.congestionControl), [profiles]);
  const tcpTemplate = useMemo(() => findProfileByParameter(profiles, keys.tcpReceiveBuffer), [profiles]);
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [congestionControl, setCongestionControl] = useState(() =>
    readParameter(bbrTemplate, keys.congestionControl, defaults.congestionControl)
  );
  const [defaultQdisc, setDefaultQdisc] = useState(() =>
    readParameter(bbrTemplate, keys.defaultQdisc, defaults.defaultQdisc)
  );
  const [tcpReceiveBuffer, setTcpReceiveBuffer] = useState(() =>
    readParameter(tcpTemplate, keys.tcpReceiveBuffer, defaults.tcpReceiveBuffer)
  );
  const [tcpWriteBuffer, setTcpWriteBuffer] = useState(() =>
    readParameter(tcpTemplate, keys.tcpWriteBuffer, defaults.tcpWriteBuffer)
  );
  const [somaxconn, setSomaxconn] = useState(() => readParameter(tcpTemplate, keys.somaxconn, defaults.somaxconn));
  const [tcpMaxSynBacklog, setTcpMaxSynBacklog] = useState(() =>
    readParameter(tcpTemplate, keys.tcpMaxSynBacklog, defaults.tcpMaxSynBacklog)
  );
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [customParameters, setCustomParameters] = useState<TuningParameter[]>([]);
  const targetAgentId = agents.some((agent) => agent.id === selectedAgentId) ? selectedAgentId : agents[0]?.id ?? '';
  const targetAgent = agents.find((agent) => agent.id === targetAgentId);
  const targetAgentLabel = targetAgent ? `${targetAgent.name} / ${targetAgent.publicAddress}` : targetAgentId;
  const recentTask = useMemo(() => latestTuningTask(tasks), [tasks]);
  const highRiskProfileCount = profiles.filter((profile) => profile.riskLevel === 'high').length;
  const parameterCount = profiles.reduce((total, profile) => total + profile.parameters.length, 0);

  const bbrProfile = createProfile({
    id: 'tune-bbr-edge',
    name: 'BBR Edge Throughput',
    target: 'kernel',
    riskLevel: 'medium',
    template: bbrTemplate,
    parameters: [
      createParameter(keys.congestionControl, congestionControl),
      createParameter(keys.defaultQdisc, defaultQdisc)
    ]
  });
  const tcpProfile = createProfile({
    id: 'tune-runtime-reload',
    name: 'TCP Buffer and Backlog',
    target: 'network',
    riskLevel: 'medium',
    template: tcpTemplate,
    parameters: [
      createParameter(keys.tcpReceiveBuffer, tcpReceiveBuffer),
      createParameter(keys.tcpWriteBuffer, tcpWriteBuffer),
      createParameter(keys.somaxconn, somaxconn),
      createParameter(keys.tcpMaxSynBacklog, tcpMaxSynBacklog)
    ]
  });
  const customProfile = createProfile({
    id: 'custom-sysctl',
    name: t.customSysctl,
    target: 'network',
    riskLevel: 'high',
    parameters: customParameters
  });
  const dispatchDisabled = taskMutationBusy || !targetAgentId;

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

  function addCustomParameter() {
    const key = customKey.trim();
    const value = customValue.trim();

    if (!key || !value) {
      return;
    }

    setCustomParameters((current) => [
      ...current.filter((parameter) => parameter.key !== key),
      createParameter(key, value)
    ]);
    setCustomKey('');
    setCustomValue('');
  }

  function removeCustomParameter(key: string) {
    setCustomParameters((current) => current.filter((parameter) => parameter.key !== key));
  }

  return (
    <ResponsivePage className="space-y-5 md:space-y-6">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/86 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)] max-md:rounded-2xl max-md:bg-white/92 max-md:p-4 max-md:shadow-sm max-md:dark:bg-slate-950/88"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-blue-600 dark:text-primary">
              {t.operationalOverview}
            </p>
            <h3 className="mt-3 text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-2 max-w-4xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
            <div className="mt-4 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-blue-500 dark:text-primary" />
              <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.tuningPath}</p>
            </div>
            <TuningPath labels={[t.pathProfile, t.pathAgent, t.pathAuditTask]} />
            <p className="mt-3 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">
              {t.operationalOverviewHint}
            </p>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:w-[34rem] xl:grid-cols-1 2xl:grid-cols-2">
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
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-xs font-black text-orange-700 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">
              {t.auditState}: {recentTask ? t.statusLabels[recentTask.status] : t.ready}
            </div>
          </div>
        </div>
      </section>

      <WorkspaceCockpit aria-label={t.systemTuningCockpit} className="tuning-ops-cockpit stagger-2">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside
            aria-label={t.tuningControlRail}
            className="tuning-ops-rail border-b border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-4 xl:sticky xl:top-0">
              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-sm dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                    <ServerCog className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">{t.targetHost}</h4>
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-white/45">
                      {targetAgentLabel || t.noAgent}
                    </p>
                  </div>
                </div>
                <select
                  aria-label={t.targetHost}
                  className="ou-select mt-4 min-h-10 w-full rounded-lg border border-slate-200 bg-white/90 px-3 text-sm font-bold text-slate-800 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-black/20 dark:text-white dark:focus-visible:ring-primary/40"
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
                <div className="mt-4 grid gap-2">
                  <Metric label={t.hostStatus} value={targetAgent?.status === 'online' ? t.online : t.offline} />
                  {taskMutationBusy ? (
                    <div
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200"
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

              <TuningToolCard
                icon={Gauge}
                title={t.bbrPanel}
                buttonLabel={t.applyBbr}
                disabled={dispatchDisabled}
                onApply={() => dispatchProfile(bbrProfile)}
              >
                <TextInput label={t.congestionControl} value={congestionControl} onChange={setCongestionControl} />
                <TextInput label={t.defaultQdisc} value={defaultQdisc} onChange={setDefaultQdisc} />
              </TuningToolCard>

              <TuningToolCard
                icon={Network}
                title={t.tcpPanel}
                buttonLabel={t.applyTcpTuning}
                disabled={dispatchDisabled}
                onApply={() => dispatchProfile(tcpProfile)}
              >
                <TextInput label={t.tcpReceiveBuffer} value={tcpReceiveBuffer} onChange={setTcpReceiveBuffer} />
                <TextInput label={t.tcpWriteBuffer} value={tcpWriteBuffer} onChange={setTcpWriteBuffer} />
                <TextInput label={t.somaxconn} value={somaxconn} onChange={setSomaxconn} />
                <TextInput label={t.tcpMaxSynBacklog} value={tcpMaxSynBacklog} onChange={setTcpMaxSynBacklog} />
              </TuningToolCard>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.tuningExecutionWorkspace} className="tuning-ops-workspace min-h-0">
            <div className="space-y-4 p-4">
              <GlassCard className="tuning-ops-status-panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4 text-blue-500 dark:text-primary" />
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.tuningPath}</p>
                    </div>
                    <TuningPath labels={[t.pathProfile, t.pathAgent, t.pathAuditTask]} />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                    {t.auditState}: {recentTask ? t.statusLabels[recentTask.status] : t.ready}
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Metric label={t.riskProfiles} value={t.highRiskSummary(highRiskProfileCount, profiles.length)} />
                  <Metric label={t.parameters} value={String(parameterCount)} />
                  <Metric label={t.latestExecution} value={recentTask ? t.statusLabels[recentTask.status] : t.ready} />
                </div>
              </GlassCard>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(20rem,0.7fr)]">
                <GlassCard aria-label={t.customSysctl} className="tuning-ops-custom-panel stagger-2 p-5" role="region">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-blue-500 dark:text-primary" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.customSysctl}</h4>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <TextInput label={t.customSysctlKey} value={customKey} onChange={setCustomKey} />
                    <TextInput label={t.customSysctlValue} value={customValue} onChange={setCustomValue} />
                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary dark:focus-visible:ring-primary/40 md:col-span-2"
                      disabled={!customKey.trim() || !customValue.trim()}
                      onClick={addCustomParameter}
                      type="button"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.addSysctl}
                    </button>
                  </div>
                  {customParameters.length > 0 ? (
                    <div className="mt-4 grid gap-2">
                      {customParameters.map((parameter) => (
                        <article
                          aria-label={parameter.key}
                          className="tuning-ops-sysctl-row grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-slate-200 p-3 dark:border-white/10"
                          key={parameter.key}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[11px] font-bold text-slate-800 dark:text-white/80">
                              {parameter.key}
                            </p>
                            <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-white/45">
                              {parameter.value}
                            </p>
                          </div>
                          <button
                            aria-label={t.removeSysctl(parameter.key)}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                            onClick={() => removeCustomParameter(parameter.key)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <GlowButton
                    className="mt-5 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={dispatchDisabled || customParameters.length === 0}
                    onClick={() => dispatchProfile(customProfile)}
                  >
                    {t.applyCustomSysctl}
                  </GlowButton>
                </GlassCard>

                <ExecutionStatusCard language={language} task={recentTask} />
              </div>

              <GlassCard className="tuning-ops-status-panel stagger-2 p-5">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.executionStatus}</h4>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Boundary icon={ShieldCheck} label="BBR" value="install_or_enable_bbr" />
                  <Boundary icon={Network} label="TCP" value="apply_tcp_buffers" />
                  <Boundary icon={SlidersHorizontal} label="sysctl" value="apply_sysctl" />
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
    <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-blue-200 bg-white text-[11px] font-black text-blue-600 dark:border-primary/25 dark:bg-primary/10 dark:text-primary"
          >
            {index + 1}
          </span>
          <span className="truncate text-xs font-black text-slate-800 dark:text-white/80">{label}</span>
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
    <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-2 truncate text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0 text-blue-500 dark:text-primary" />
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <input
        aria-label={label}
        className="mt-1 min-h-7 w-full bg-transparent font-mono text-xs font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function TuningToolCard({
  title,
  buttonLabel,
  disabled,
  onApply,
  icon: Icon,
  children
}: {
  title: string;
  buttonLabel: string;
  disabled: boolean;
  onApply: () => void;
  icon: typeof Gauge;
  children: ReactNode;
}) {
  return (
    <GlassCard aria-label={title} className="tuning-ops-tool-panel stagger-2 p-5" role="group">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-blue-500 dark:text-primary" />
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
      <GlowButton className="mt-5 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} onClick={onApply}>
        {buttonLabel}
      </GlowButton>
    </GlassCard>
  );
}

function ExecutionStatusCard({ language, task }: { language: AppLanguage; task: DeployTask | undefined }) {
  const t = copy[language];

  return (
    <GlassCard aria-label={t.executionStatus} className="tuning-ops-status-panel stagger-2 p-5" role="region">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.executionStatus}</h4>
        </div>
        {task ? (
          <span
            className={`inline-flex min-h-8 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${getStatusTone(task.status)}`}
          >
            <StatusIcon status={task.status} />
            {t.statusLabels[task.status]}
          </span>
        ) : null}
      </div>
      {task ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-800 dark:text-white/80">{task.targetLabel}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">{task.updatedAt}</p>
          </div>
          {task.failureReason ? (
            <div
              className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200"
              role="alert"
            >
              <span className="uppercase tracking-widest">{t.failure}: </span>
              {task.failureReason}
            </div>
          ) : null}
          {task.steps.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.taskSteps}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {task.steps.map((step) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-white/10"
                    key={step.id}
                  >
                    <span className="text-xs font-semibold text-slate-700 dark:text-white/70">{step.label}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/45">
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-white/45">{t.noExecution}</p>
      )}
    </GlassCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function Boundary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <Icon className="mb-2 h-4 w-4 text-blue-500 dark:text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 font-mono text-xs font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}
