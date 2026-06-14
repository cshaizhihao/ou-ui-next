import type { AppLanguage } from '../../app/app-store';
const copy = {
  zh: {
    title: '同步中'
  },
  en: {
    title: 'Syncing'
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
      className="ou-surface mb-3 border border-[#07111F] bg-[#FFFDF5] p-3 shadow-[0_18px_44px_-38px_rgba(5,5,5,0.18)] backdrop-blur-xl dark:border-[#E2E8F0]/14 dark:bg-[#101827]"
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#00A878] shadow-[0_0_14px_rgba(0,168,120,0.58)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{t.title}</h3>
          <div className="ou-skeleton mt-2 h-1.5 w-full max-w-sm bg-[#DCE1FF]" />
        </div>
      </div>
    </section>
  );
}
