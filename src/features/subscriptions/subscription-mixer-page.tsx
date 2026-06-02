import { Download, Layers3, ListFilter, Shuffle } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { SubscriptionBundle } from '../../domain';
import { formatDateTime, formatNumber, formatPercent } from '../shared/format';

export type { SubscriptionBundle };

type SubscriptionMixerPageProps = {
  subscriptions: SubscriptionBundle[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onRunTask: (id: string) => void;
};

const copy = {
  zh: {
    title: '聚合订阅',
    subtitle: '聚合外部订阅源，执行去重、过滤、代理组模板和 Clash / Surge / Sing-box 导出。',
    strategySuffix: '策略',
    outputPrefix: '输出',
    nodeUnit: '节点',
    sources: '订阅源',
    sourceUnit: '个',
    dedupe: '去重',
    enabled: '开启',
    disabled: '关闭',
    health: '健康度',
    sync: '同步',
    generate: '生成订阅'
  },
  en: {
    title: 'Subscription Mixer',
    subtitle: 'Import external feeds, deduplicate nodes, filter routes, apply proxy-group templates, and export Clash / Surge / Sing-box profiles.',
    strategySuffix: 'strategy',
    outputPrefix: 'Output',
    nodeUnit: 'nodes',
    sources: 'Sources',
    sourceUnit: 'sources',
    dedupe: 'Dedupe',
    enabled: 'Enabled',
    disabled: 'Disabled',
    health: 'Health',
    sync: 'Synced',
    generate: 'Generate Subscription'
  }
} as const;

export function SubscriptionMixerPage({
  subscriptions,
  language,
  taskMutationBusy = false,
  onRunTask
}: SubscriptionMixerPageProps) {
  const t = copy[language];

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {subscriptions.map((bundle) => (
          <GlassCard key={bundle.id} className="tilt-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Shuffle className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{bundle.name}</h4>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                  {bundle.strategy} {t.strategySuffix} / {t.outputPrefix} {formatNumber(bundle.generatedNodeCount)}{' '}
                  {t.nodeUnit}
                </p>
              </div>
              <GlassToggle aria-label={`${bundle.name} enabled`} checked={bundle.enabled} readOnly />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Stat icon={Layers3} label={t.sources} value={`${bundle.sources.length} ${t.sourceUnit}`} />
              <Stat icon={ListFilter} label={t.dedupe} value={bundle.dedupe ? t.enabled : t.disabled} />
              <Stat icon={Download} label={t.health} value={formatPercent(bundle.healthScore)} />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {bundle.exportTargets.map((target) => (
                <span
                  key={target}
                  className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary"
                >
                  {target}
                </span>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              {bundle.sources.map((source) => (
                <div key={source.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white/80">{source.name}</p>
                      <p className="mt-1 max-w-full break-all font-mono text-[10px] text-slate-500 dark:text-white/40">
                        {source.url}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-white/50">
                      {source.status}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-white/45">
                    {formatNumber(source.nodeCount)} {t.nodeUnit} / {t.sync} {formatDateTime(source.lastSyncAt)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <GlowButton
                className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                disabled={taskMutationBusy}
                onClick={() => onRunTask(bundle.id)}
              >
                {t.generate}
              </GlowButton>
            </div>
          </GlassCard>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Layers3 }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <Icon className="mb-2 h-4 w-4 text-blue-500 dark:text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
