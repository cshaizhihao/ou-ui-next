import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type ResponsivePageProps = {
  children: ReactNode;
  className?: string;
};

export function ResponsivePage({ children, className }: ResponsivePageProps) {
  return (
    <div
      className={cn(
        'responsive-page min-h-0 space-y-4 md:h-[calc(100dvh-7.75rem)] md:overflow-y-auto md:pr-1 md:[scrollbar-width:thin] md:[scrollbar-color:rgba(59,130,246,0.35)_transparent] max-md:space-y-3',
        className
      )}
    >
      {children}
    </div>
  );
}

type ResponsiveSectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  compactOnMobile?: boolean;
};

export function ResponsiveSection({ children, className, compactOnMobile = true, ...props }: ResponsiveSectionProps) {
  return (
    <section
      {...props}
      className={cn(
        'responsive-section min-w-0',
        compactOnMobile && 'max-md:rounded-2xl max-md:border max-md:border-slate-200 max-md:bg-white/86 max-md:p-3 max-md:shadow-sm max-md:backdrop-blur-xl max-md:dark:border-white/10 max-md:dark:bg-slate-950/88',
        className
      )}
    >
      {children}
    </section>
  );
}

type WorkspaceCockpitProps = {
  children: ReactNode;
  className?: string;
};

export function WorkspaceCockpit({ children, className }: WorkspaceCockpitProps) {
  return (
    <div
      className={cn(
        'workspace-cockpit min-h-0 rounded-[1.5rem] border border-slate-200/80 bg-white/86 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)]',
        'md:max-h-[calc(100dvh-15.5rem)] md:overflow-hidden',
        'max-md:rounded-2xl max-md:border-slate-200 max-md:bg-white/92 max-md:shadow-sm max-md:dark:border-white/10 max-md:dark:bg-slate-950/88',
        className
      )}
    >
      {children}
    </div>
  );
}

export function WorkspaceCockpitScroller({ children, className }: WorkspaceCockpitProps) {
  return (
    <div
      className={cn(
        'workspace-cockpit-scroller min-h-0',
        'md:max-h-[calc(100dvh-15.5rem)] md:overflow-y-auto md:[scrollbar-width:thin]',
        'md:[scrollbar-color:rgba(59,130,246,0.35)_transparent]',
        'max-md:overflow-visible',
        className
      )}
    >
      {children}
    </div>
  );
}

type MobileSummaryRailProps = {
  children: ReactNode;
  className?: string;
};

export function MobileSummaryRail({ children, className }: MobileSummaryRailProps) {
  return (
    <div
      className={cn(
        'mobile-summary-rail grid gap-3 max-md:auto-cols-[82%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {children}
    </div>
  );
}

type SectionHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function ResponsiveSectionHeader({ action, className, description, eyebrow, icon, title }: SectionHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3 max-md:mb-3 max-md:items-start', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-500 dark:text-primary max-md:text-[9px]">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-white max-md:text-sm">{title}</h3>
        </div>
        {description ? (
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500 dark:text-white/50 max-md:line-clamp-2">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:w-full max-md:[&>*]:flex-1">{action}</div> : null}
    </div>
  );
}

type MetricStripItem = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'blue' | 'emerald' | 'amber' | 'red' | 'slate';
};

type MobileMetricStripProps = {
  items: MetricStripItem[];
  className?: string;
};

const metricToneClasses = {
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-primary/20 dark:bg-primary/10 dark:text-primary',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200',
  slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75'
} as const;

export function MobileMetricStrip({ className, items }: MobileMetricStripProps) {
  return (
    <div className={cn('hidden max-md:grid max-md:grid-cols-2 max-md:gap-2', className)}>
      {items.map((item) => (
        <div className={cn('min-w-0 rounded-2xl border p-3', metricToneClasses[item.tone ?? 'slate'])} key={item.label}>
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{item.label}</p>
          <p className="mt-1 truncate text-lg font-semibold">{item.value}</p>
          {item.detail ? <p className="mt-1 truncate text-[11px] font-medium opacity-65">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}
