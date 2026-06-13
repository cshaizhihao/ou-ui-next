import type { AppLanguage } from '../../app/app-store';

const copy = {
  zh: {
    title: '正在同步控制面',
    subtitle: '正在并行拉取主机、客户节点、端口转发、订阅和审计证据。'
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
      className="ou-surface mb-6 border border-black/15 bg-white/92 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-black/72"
      role="status"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="ou-skeleton h-3 w-28 rounded-full" />
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-black dark:text-white">{t.title}</h3>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-black/62 dark:text-white/58">{t.subtitle}</p>
        </div>
        <div className="ou-skeleton h-10 w-40 rounded-full" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="border border-black/15 bg-white/[0.72] p-4 dark:border-white/10 dark:bg-white/[0.03]"
            key={index}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="ou-skeleton h-10 w-10 rounded-xl" />
              <div className="ou-skeleton h-5 w-20 rounded-full" />
            </div>
            <div className="ou-skeleton mt-5 h-4 w-32 rounded-full" />
            <div className="ou-skeleton mt-3 h-3 w-full rounded-full" />
            <div className="ou-skeleton mt-2 h-3 w-2/3 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
