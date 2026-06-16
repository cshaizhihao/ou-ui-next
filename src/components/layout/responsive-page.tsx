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
        'responsive-page min-h-0 space-y-4 md:h-[calc(100dvh-7.75rem)] md:overflow-y-auto md:pr-1 md:[scrollbar-width:thin] md:[scrollbar-color:rgba(30,58,255,0.38)_transparent] max-md:space-y-3',
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
        compactOnMobile && 'max-md:border max-md:border-[#07111F]/18 max-md:bg-[#FFFDF5] max-md:p-3 max-md:shadow-sm max-md:dark:border-[#6B7CFF]/22 max-md:dark:bg-[#101827]',
        className
      )}
    >
      {children}
    </section>
  );
}

type WorkspaceCockpitProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function WorkspaceCockpit({ children, className, ...props }: WorkspaceCockpitProps) {
  return (
    <section
      {...props}
      className={cn(
        'workspace-cockpit min-h-0 border border-[#07111F]/18 bg-[#FFFDF5] shadow-[0_18px_55px_-40px_rgba(7,17,31,0.32)] dark:border-[#6B7CFF]/18 dark:bg-[#101827] dark:shadow-[0_22px_70px_-48px_rgba(0,0,0,0.72)]',
        'overflow-visible',
        'max-md:border-[#07111F]/18 max-md:bg-[#FFFDF5] max-md:shadow-sm max-md:dark:border-[#6B7CFF]/22 max-md:dark:bg-[#101827]',
        className
      )}
    >
      {children}
    </section>
  );
}

export function WorkspaceCockpitScroller({ children, className, ...props }: WorkspaceCockpitProps) {
  return (
    <section
      {...props}
      className={cn(
        'workspace-cockpit-scroller min-h-0 overflow-visible max-md:pb-[calc(7rem+env(safe-area-inset-bottom))]',
        className
      )}
    >
      {children}
    </section>
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
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-black/55 dark:text-white/50 max-md:text-[9px]">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-base font-semibold tracking-tight text-black dark:text-white max-md:text-sm">{title}</h3>
        </div>
        {description ? (
          <p className="mt-1 max-w-4xl text-xs leading-5 text-black/60 dark:text-white/50 max-md:line-clamp-2">
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
  blue: 'border-[#1E3AFF]/55 bg-[#DCE1FF]/80 text-[#07111F] dark:border-[#6B7CFF]/35 dark:bg-[#1E3AFF]/18 dark:text-[#DDE3FF]',
  emerald: 'border-[#00A878]/45 bg-[#00A878]/12 text-[#07111F] dark:border-[#00A878]/35 dark:bg-[#00A878]/14 dark:text-[#C7FFE9]',
  amber: 'border-[#D9FF00]/70 bg-[#D9FF00]/24 text-[#07111F] dark:border-[#D9FF00]/42 dark:bg-[#D9FF00]/16 dark:text-[#F2FF9D]',
  red: 'border-[#DC2626]/45 bg-[#FEE2E2]/80 text-[#7F1D1D] dark:border-[#DC2626]/35 dark:bg-[#DC2626]/16 dark:text-[#FECACA]',
  slate: 'border-[#07111F]/18 bg-[#FFFDF5]/86 text-[#07111F]/76 dark:border-[#6B7CFF]/16 dark:bg-[#192238] dark:text-white/75'
} as const;

export function MobileMetricStrip({ className, items }: MobileMetricStripProps) {
  return (
    <div className={cn('hidden max-md:grid max-md:grid-cols-2 max-md:gap-2', className)}>
      {items.map((item) => (
        <div
          className={cn(
            'min-w-0 border p-3 transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_12px_28px_-24px_rgba(7,17,31,0.42)]',
            metricToneClasses[item.tone ?? 'slate']
          )}
          key={item.label}
        >
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{item.label}</p>
          <p className="mt-1 truncate text-lg font-semibold">{item.value}</p>
          {item.detail ? <p className="mt-1 truncate text-[11px] font-medium opacity-65">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}
