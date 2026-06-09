import { useMemo, useState } from 'react';
import { Copy, Gauge, Search, ServerCog, SlidersHorizontal, TerminalSquare } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { Agent, TuningProfile } from '../../domain';

export type { TuningProfile };

type TuningPageProps = {
  agents: Agent[];
  language: AppLanguage;
  profiles: TuningProfile[];
  taskMutationBusy?: boolean;
  onRunTask: (id: string, agentId: string) => void;
};

type TuningTargetFilter = TuningProfile['target'] | 'all';
type TuningRiskFilter = TuningProfile['riskLevel'] | 'all';

const copy = {
  zh: {
    title: '系统调优',
    subtitle: '通过 Agent 下发 BBR 安装/启用、TCP 拥塞控制、sysctl 与 TCP buffer 调优任务，并等待执行结果回传。',
    risk: '风险',
    dispatch: '下发到 Agent',
    boundaryTitle: '执行边界',
    backendRequired: 'Agent 执行',
    agentAckRequired: '结果回传',
    previewOnly: '执行记录',
    targetAgent: '目标主机',
    noAgent: '暂无可用 Agent',
    confirmTitle: '确认下发系统调优任务？',
    currentParameters: '任务参数',
    searchProfiles: '搜索模板',
    searchProfilesPlaceholder: '模板名称、参数、目标或风险',
    target: '目标',
    allTargets: '全部目标',
    allRisks: '全部风险',
    matchingProfiles: '匹配',
    noMatchingProfiles: '没有匹配的调优模板',
    enabledProfiles: '已启用模板',
    visibleParameters: '当前参数',
    selectProfile: '选择',
    selectVisibleProfiles: '选择当前模板',
    selectedProfiles: '已选模板',
    dispatchVisibleProfiles: '下发当前模板',
    dispatchSelectedProfiles: '下发已选模板',
    copySelectedDispatchPlan: '复制已选下发计划',
    confirmVisibleDispatch: (count: string, agent: string) => `确认下发 ${count} 个当前可见调优模板到 ${agent}？`,
    confirmSelectedDispatch: (count: string, agent: string) => `确认下发 ${count} 个已选调优模板到 ${agent}？`,
    targetLabels: {
      kernel: '内核',
      network: '网络',
      runtime: '运行时'
    },
    riskLabels: {
      low: '低',
      medium: '中',
      high: '高'
    }
  },
  en: {
    title: 'System Tuning',
    subtitle:
      'Dispatch Agent tasks for BBR install/enable, TCP congestion control, sysctl values, and TCP buffer tuning, then wait for execution results.',
    risk: 'Risk',
    dispatch: 'Dispatch to Agent',
    boundaryTitle: 'Execution Boundary',
    backendRequired: 'Agent execution',
    agentAckRequired: 'Result callback',
    previewOnly: 'Execution record',
    targetAgent: 'Target Host',
    noAgent: 'No Agent available',
    confirmTitle: 'Dispatch this system tuning task?',
    currentParameters: 'Task Parameters',
    searchProfiles: 'Search Profiles',
    searchProfilesPlaceholder: 'Profile name, parameter, target, or risk',
    target: 'Target',
    allTargets: 'All Targets',
    allRisks: 'All Risks',
    matchingProfiles: 'Matching',
    noMatchingProfiles: 'No matching tuning profiles',
    enabledProfiles: 'Enabled Profiles',
    visibleParameters: 'Visible Parameters',
    selectProfile: 'Select',
    selectVisibleProfiles: 'Select Visible Profiles',
    selectedProfiles: 'Selected Profiles',
    dispatchVisibleProfiles: 'Dispatch Visible Profiles',
    dispatchSelectedProfiles: 'Dispatch Selected Profiles',
    copySelectedDispatchPlan: 'Copy Selected Dispatch Plan',
    confirmVisibleDispatch: (count: string, agent: string) =>
      `Dispatch ${count} visible tuning profile${count === '1' ? '' : 's'} to ${agent}?`,
    confirmSelectedDispatch: (count: string, agent: string) =>
      `Dispatch ${count} selected tuning profile${count === '1' ? '' : 's'} to ${agent}?`,
    targetLabels: {
      kernel: 'Kernel',
      network: 'Network',
      runtime: 'Runtime'
    },
    riskLabels: {
      low: 'Low',
      medium: 'Medium',
      high: 'High'
    }
  }
} as const;

function createProfileSearchText(profile: TuningProfile) {
  return [
    profile.id,
    profile.name,
    profile.target,
    profile.riskLevel,
    ...profile.parameters.flatMap((parameter) => [parameter.key, parameter.value, parameter.status])
  ]
    .join(' ')
    .toLowerCase();
}

function filterTuningProfiles(
  profiles: TuningProfile[],
  query: string,
  targetFilter: TuningTargetFilter,
  riskFilter: TuningRiskFilter
) {
  const normalizedQuery = query.trim().toLowerCase();

  return profiles.filter((profile) => {
    const matchesQuery = normalizedQuery === '' || createProfileSearchText(profile).includes(normalizedQuery);
    const matchesTarget = targetFilter === 'all' || profile.target === targetFilter;
    const matchesRisk = riskFilter === 'all' || profile.riskLevel === riskFilter;

    return matchesQuery && matchesTarget && matchesRisk;
  });
}

function createTuningDispatchPlanText(profiles: TuningProfile[], targetAgentLabel: string) {
  const highRiskProfiles = profiles.filter((profile) => profile.riskLevel === 'high');
  const parameterCount = profiles.reduce((total, profile) => total + profile.parameters.length, 0);

  return [
    'Tuning Dispatch Plan',
    `Target Agent: ${targetAgentLabel}`,
    `Profile Count: ${profiles.length}`,
    `High Risk Profiles: ${highRiskProfiles.length}`,
    `Parameter Count: ${parameterCount}`,
    '',
    ...profiles.map((profile) =>
      [
        `- ${profile.name}`,
        `  ID: ${profile.id}`,
        `  Target: ${profile.target}`,
        `  Risk: ${profile.riskLevel}`,
        `  Enabled: ${profile.enabled ? 'yes' : 'no'}`,
        '  Parameters:',
        ...profile.parameters.map((parameter) => `    ${parameter.key}=${parameter.value} (${parameter.status})`)
      ].join('\n')
    )
  ].join('\n');
}

export function TuningPage({ agents, language, profiles, taskMutationBusy = false, onRunTask }: TuningPageProps) {
  const t = copy[language];
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [profileSearch, setProfileSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<TuningTargetFilter>('all');
  const [riskFilter, setRiskFilter] = useState<TuningRiskFilter>('all');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const targetAgentId = agents.some((agent) => agent.id === selectedAgentId) ? selectedAgentId : agents[0]?.id ?? '';
  const targetAgent = agents.find((agent) => agent.id === targetAgentId);
  const targetAgentLabel = targetAgent ? `${targetAgent.name} / ${targetAgent.publicAddress}` : targetAgentId;
  const filteredProfiles = useMemo(
    () => filterTuningProfiles(profiles, profileSearch, targetFilter, riskFilter),
    [profileSearch, profiles, riskFilter, targetFilter]
  );
  const selectedProfiles = filteredProfiles.filter((profile) => selectedProfileIds.includes(profile.id));
  const selectedVisibleProfileCount = filteredProfiles.filter((profile) => selectedProfileIds.includes(profile.id)).length;
  const enabledProfileCount = profiles.filter((profile) => profile.enabled).length;
  const visibleParameterCount = filteredProfiles.reduce((total, profile) => total + profile.parameters.length, 0);

  function toggleProfileSelection(profileId: string) {
    setSelectedProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId]
    );
  }

  function toggleVisibleProfileSelection() {
    const visibleIds = filteredProfiles.map((profile) => profile.id);

    setSelectedProfileIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function dispatch(profile: TuningProfile) {
    if (!targetAgentId) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(`${t.confirmTitle}\n${profile.name}`);

    if (confirmed) {
      onRunTask(profile.id, targetAgentId);
    }
  }

  function dispatchVisibleProfiles() {
    if (!targetAgentId || filteredProfiles.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmVisibleDispatch(String(filteredProfiles.length), targetAgentLabel));

    if (confirmed) {
      filteredProfiles.forEach((profile) => onRunTask(profile.id, targetAgentId));
    }
  }

  function dispatchSelectedProfiles() {
    if (!targetAgentId || selectedProfiles.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmSelectedDispatch(String(selectedProfiles.length), targetAgentLabel));

    if (confirmed) {
      selectedProfiles.forEach((profile) => onRunTask(profile.id, targetAgentId));
    }
  }

  function copySelectedDispatchPlan() {
    if (selectedProfiles.length === 0 || typeof navigator === 'undefined') {
      return;
    }

    void navigator.clipboard?.writeText(createTuningDispatchPlanText(selectedProfiles, targetAgentLabel));
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
          {t.subtitle}
        </p>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.targetAgent}</h4>
          </div>
          <select
            aria-label={t.targetAgent}
            className="glass-select-control min-w-[220px] rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-bold text-slate-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
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
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Metric label={t.enabledProfiles} value={`${enabledProfileCount}/${profiles.length}`} />
          <Metric label={t.visibleParameters} value={String(visibleParameterCount)} />
        </div>
      </GlassCard>

      <section className="stagger-2 island-card p-5">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)_minmax(10rem,0.32fr)]">
          <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.searchProfiles}
            </span>
            <div className="mt-1 flex min-h-7 items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
              <input
                aria-label={t.searchProfiles}
                className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                onChange={(event) => setProfileSearch(event.target.value)}
                placeholder={t.searchProfilesPlaceholder}
                type="search"
                value={profileSearch}
              />
            </div>
          </label>
          <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.target}
            </span>
            <select
              aria-label={t.target}
              className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
              onChange={(event) => setTargetFilter(event.target.value as TuningTargetFilter)}
              value={targetFilter}
            >
              <option value="all">{t.allTargets}</option>
              <option value="kernel">{t.targetLabels.kernel}</option>
              <option value="network">{t.targetLabels.network}</option>
              <option value="runtime">{t.targetLabels.runtime}</option>
            </select>
          </label>
          <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.risk}
            </span>
            <select
              aria-label={t.risk}
              className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
              onChange={(event) => setRiskFilter(event.target.value as TuningRiskFilter)}
              value={riskFilter}
            >
              <option value="all">{t.allRisks}</option>
              <option value="low">{t.riskLabels.low}</option>
              <option value="medium">{t.riskLabels.medium}</option>
              <option value="high">{t.riskLabels.high}</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
            {t.matchingProfiles} {filteredProfiles.length} / {profiles.length}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
              <input
                aria-label={t.selectVisibleProfiles}
                checked={filteredProfiles.length > 0 && selectedVisibleProfileCount === filteredProfiles.length}
                className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                onChange={toggleVisibleProfileSelection}
                type="checkbox"
              />
              {t.selectVisibleProfiles}
            </label>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.selectedProfiles} {selectedProfiles.length}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
            disabled={taskMutationBusy || !targetAgentId || filteredProfiles.length === 0}
            onClick={dispatchVisibleProfiles}
            type="button"
          >
            {t.dispatchVisibleProfiles}
          </button>
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
            disabled={taskMutationBusy || !targetAgentId || selectedProfiles.length === 0}
            onClick={dispatchSelectedProfiles}
            type="button"
          >
            {t.dispatchSelectedProfiles}
          </button>
          <button
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
            disabled={selectedProfiles.length === 0}
            onClick={copySelectedDispatchPlan}
            type="button"
          >
            <Copy className="h-3.5 w-3.5" />
            {t.copySelectedDispatchPlan}
          </button>
        </div>
      </section>

      {filteredProfiles.length === 0 ? (
        <div className="stagger-2 rounded-xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:text-white/45">
          {t.noMatchingProfiles}
        </div>
      ) : (
        <section className="stagger-2 grid grid-cols-1 gap-5 xl:grid-cols-3">
          {filteredProfiles.map((profile) => (
            <GlassCard key={profile.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    aria-label={`${t.selectProfile} ${profile.name}`}
                    checked={selectedProfileIds.includes(profile.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                    onChange={() => toggleProfileSelection(profile.id)}
                    type="checkbox"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4 shrink-0 text-blue-500 dark:text-primary" />
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{profile.name}</h4>
                    </div>
                    <p className="mt-1 text-[11px] uppercase tracking-widest text-slate-500 dark:text-white/45">
                      {t.targetLabels[profile.target]} · {t.risk} {t.riskLabels[profile.riskLevel]}
                    </p>
                  </div>
                </div>
                <GlassToggle aria-label={`${profile.name} enabled`} checked={profile.enabled} readOnly />
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.currentParameters}
                </p>
                {profile.parameters.map((parameter) => (
                  <div
                    key={parameter.key}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-white/10"
                  >
                    <div>
                      <p className="font-mono text-[11px] font-bold text-slate-800 dark:text-white/80">
                        {parameter.key}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500 dark:text-white/45">{parameter.value}</p>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-white/50">
                      {parameter.status}
                    </span>
                  </div>
                ))}
              </div>

              <GlowButton
                className="mt-5 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60"
                disabled={taskMutationBusy || !targetAgentId}
                onClick={() => dispatch(profile)}
              >
                {t.dispatch}
              </GlowButton>
            </GlassCard>
          ))}
        </section>
      )}

      <GlassCard className="stagger-2 p-5">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.boundaryTitle}</h4>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Boundary icon={Gauge} label="BBR" value={t.backendRequired} />
          <Boundary icon={Gauge} label="Nginx / Xray reload" value={t.agentAckRequired} />
          <Boundary icon={Gauge} label="Runtime Config Diff" value={t.previewOnly} />
        </div>
      </GlassCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function Boundary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <Icon className="mb-2 h-4 w-4 text-blue-500 dark:text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 text-xs font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}
