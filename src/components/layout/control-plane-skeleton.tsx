import type { AppLanguage } from '../../app/app-store';
import { cn } from '../../lib/cn';

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

const skeletonCardClasses = [
  'border-[#1E3AFF] bg-[#DCE1FF]/70 dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/14',
  'border-[#00A878] bg-[#00A878]/[0.12] dark:border-[#35E68E]/35 dark:bg-[#35E68E]/10',
  'border-[#FF3D18] bg-[#FF3D18]/[0.12] dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12',
  'border-[#D9FF00] bg-[#D9FF00]/[0.22] dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12'
] as const;

type ControlPlaneSkeletonProps = {
  language: AppLanguage;
};

export function ControlPlaneSkeleton({ language }: ControlPlaneSkeletonProps) {
  const t = copy[language];

  return (
    <section
      aria-label={t.title}
      aria-live="polite"
      className="ou-surface mb-6 border border-[#07111F] bg-[#FFFDF5] p-5 shadow-[0_24px_72px_-46px_rgba(5,5,5,0.18)] backdrop-blur-xl dark:border-[#E2E8F0]/14 dark:bg-[#101827]"
      role="status"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="ou-skeleton h-3 w-28 rounded-full" />
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-[#07111F] dark:text-[#F4F8FF]">{t.title}</h3>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-[#35405A] dark:text-[#D8E0FF]/72">{t.subtitle}</p>
        </div>
        <div className="ou-skeleton h-10 w-40 rounded-full" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className={cn('border p-4', skeletonCardClasses[index])}
            data-skeleton-card="true"
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
