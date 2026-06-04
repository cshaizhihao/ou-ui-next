import { GitBranch, Network, ShieldCheck } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { RoutingPolicy } from '../../domain';
import { formatNumber } from '../shared/format';

export type { RoutingPolicy };

type RoutingPageProps = {
  policies: RoutingPolicy[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onRunTask: (id: string) => void;
};

const copy = {
  zh: {
    title: '分流策略',
    subtitle: '将域名、CIDR、GeoIP 与应用标签映射到直连、代理或拒绝策略。',
    matrixTitle: '策略清单',
    priority: '优先级',
    targetGroup: '目标组',
    hits: '命中',
    submitTitle: '策略提交',
    submitDescription:
      'V1.0 会先记录策略变更并等待 Agent 回执。真实内核路由、Xray route 编译和热重载必须由后端 Agent 回报结果后才能标记成功。',
    policyCount: '策略数量',
    highRiskRules: '高风险规则',
    compile: '编译分流策略'
  },
  en: {
    title: 'Routing Policy',
    subtitle: 'Map domains, CIDR ranges, GeoIP rules, and application tags to Direct, Proxy, or Reject policies.',
    matrixTitle: 'Policy List',
    priority: 'Priority',
    targetGroup: 'Target Group',
    hits: 'Hits',
    submitTitle: 'Policy Submission',
    submitDescription:
      'V1.0 records policy changes and waits for Agent acknowledgement. Kernel routes, Xray route compilation, and hot reloads are marked successful only after the backend receives an Agent result.',
    policyCount: 'Policy Count',
    highRiskRules: 'High-Risk Rules',
    compile: 'Compile Routing Policy'
  }
} as const;

export function RoutingPage({ policies, language, taskMutationBusy = false, onRunTask }: RoutingPageProps) {
  const t = copy[language];

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <GlassCard className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.matrixTitle}</h4>
          </div>
          <div className="space-y-3">
            {policies.map((policy) => (
              <div key={policy.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{policy.name}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                      {policy.match}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                      {policy.action}
                    </span>
                    <GlassToggle aria-label={`${policy.name} enabled`} checked={policy.enabled} readOnly />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 dark:text-white/50 md:grid-cols-3">
                  <span>
                    {t.priority} {policy.priority}
                  </span>
                  <span className="break-all">
                    {t.targetGroup} {policy.targetGroup}
                  </span>
                  <span>
                    {t.hits} {formatNumber(policy.hitCount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.submitTitle}</h4>
          </div>
          <p className="text-xs leading-6 text-slate-500 dark:text-white/50">{t.submitDescription}</p>
          <div className="mt-5 space-y-2">
            <Metric icon={Network} label={t.policyCount} value={formatNumber(policies.length)} />
            <Metric
              icon={ShieldCheck}
              label={t.highRiskRules}
              value={formatNumber(policies.filter((policy) => policy.riskLevel === 'high').length)}
            />
          </div>
          <GlowButton
            className="mt-5 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={taskMutationBusy}
            onClick={() => onRunTask('routing-policy-matrix')}
          >
            {t.compile}
          </GlowButton>
        </GlassCard>
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Network }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
