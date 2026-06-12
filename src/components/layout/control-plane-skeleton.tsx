import type { AppLanguage } from '../../app/app-store';

const copy = {
  zh: {
    title: '正在同步控制面',
    subtitle: '小秘书正在并行拉取主机、客户节点、转发、订阅和审计数据。'
  },
  en: {
    title: 'Syncing control plane',
    subtitle: 'Loading hosts, customer nodes, forwarding, subscriptions, and audit data in parallel.'
  }
} as const;

type ControlPlaneSkeletonProps = {
  language: AppLanguage;
};

export function ControlPlaneSkeleton({ language }: ControlPlaneSkeletonProps) {
  const t = copy[language];

  return (
    <section
      aria-label={t.title}
      aria-live="polite"
      className="mb-6 rounded-3xl border border-slate-200 bg-white/75 p-5 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04]"
      role="status"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="h-3 w-28 rounded-full skeleton-shimmer" />
          <h3 className="mt-3 text-lg font-black tracking-tight text-slate-950 dark:text-white">{t.title}</h3>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        </div>
        <div className="h-10 w-40 rounded-full skeleton-shimmer" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]"
            key={index}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-10 w-10 rounded-xl skeleton-shimmer" />
              <div className="h-5 w-20 rounded-full skeleton-shimmer" />
            </div>
            <div className="mt-5 h-4 w-32 rounded-full skeleton-shimmer" />
            <div className="mt-3 h-3 w-full rounded-full skeleton-shimmer" />
            <div className="mt-2 h-3 w-2/3 rounded-full skeleton-shimmer" />
          </div>
        ))}
      </div>
    </section>
  );
}
