import { Gauge, SlidersHorizontal, TerminalSquare } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { TuningProfile } from '../../domain';

export type { TuningProfile };

type TuningPageProps = {
  language: AppLanguage;
  profiles: TuningProfile[];
  taskMutationBusy?: boolean;
  onRunTask: (id: string) => void;
};

const copy = {
  zh: {
    title: '系统调优',
    subtitle: 'BBR、队列规则、MTU、文件句柄与运行时重载策略会写入执行记录，并等待 Agent 回传结果。',
    risk: '风险',
    dispatch: '下发调优任务',
    boundaryTitle: '执行边界',
    backendRequired: '后端执行',
    agentAckRequired: 'Agent 回执',
    previewOnly: '仅预览'
  },
  en: {
    title: 'System Tuning',
    subtitle:
      'BBR, queue discipline, MTU, file descriptors, and runtime reload policies are recorded as execution changes and wait for Agent results.',
    risk: 'risk',
    dispatch: 'Dispatch Tuning Change',
    boundaryTitle: 'Execution Boundary',
    backendRequired: 'Backend required',
    agentAckRequired: 'Agent ack required',
    previewOnly: 'Preview only'
  }
} as const;

export function TuningPage({ language, profiles, taskMutationBusy = false, onRunTask }: TuningPageProps) {
  const t = copy[language];

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
          {t.subtitle}
        </p>
      </section>

      <section className="stagger-2 grid grid-cols-1 gap-5 xl:grid-cols-3">
        {profiles.map((profile) => (
          <GlassCard key={profile.id} className="tilt-card p-5">
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
              disabled={taskMutationBusy}
              onClick={() => onRunTask(profile.id)}
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
