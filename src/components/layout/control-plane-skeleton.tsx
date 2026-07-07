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
      className="ou-surface surface-shell mb-3 border p-3"
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--ou-success)] shadow-[0_0_14px_rgba(5,150,105,0.35)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--ou-text)]">{t.title}</h3>
          <div className="ou-skeleton mt-2 h-1.5 w-full max-w-sm bg-[var(--ou-primary-soft)]" />
        </div>
      </div>
    </section>
  );
}
