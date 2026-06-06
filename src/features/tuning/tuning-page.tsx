import { useState } from 'react';
import { Gauge, ServerCog, SlidersHorizontal, TerminalSquare } from 'lucide-react';
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
    currentParameters: '任务参数'
  },
  en: {
    title: 'System Tuning',
    subtitle:
      'Dispatch Agent tasks for BBR install/enable, TCP congestion control, sysctl values, and TCP buffer tuning, then wait for execution results.',
    risk: 'risk',
    dispatch: 'Dispatch to Agent',
    boundaryTitle: 'Execution Boundary',
    backendRequired: 'Agent execution',
    agentAckRequired: 'Result callback',
    previewOnly: 'Execution record',
    targetAgent: 'Target Host',
    noAgent: 'No Agent available',
    confirmTitle: 'Dispatch this system tuning task?',
    currentParameters: 'Task Parameters'
  }
} as const;

export function TuningPage({ agents, language, profiles, taskMutationBusy = false, onRunTask }: TuningPageProps) {
  const t = copy[language];
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const targetAgentId = agents.some((agent) => agent.id === selectedAgentId) ? selectedAgentId : agents[0]?.id ?? '';

  function dispatch(profile: TuningProfile) {
    if (!targetAgentId) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(`${t.confirmTitle}\n${profile.name}`);

    if (confirmed) {
      onRunTask(profile.id, targetAgentId);
    }
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
      </GlassCard>

      <section className="stagger-2 grid grid-cols-1 gap-5 xl:grid-cols-3">
        {profiles.map((profile) => (
          <GlassCard key={profile.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{profile.name}</h4>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-slate-500 dark:text-white/45">
                  {profile.target} · {t.risk} {profile.riskLevel}
                </p>
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

function Boundary({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <Icon className="mb-2 h-4 w-4 text-blue-500 dark:text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 text-xs font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}
