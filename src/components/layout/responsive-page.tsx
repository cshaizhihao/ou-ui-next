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
        'responsive-page min-h-0 space-y-4 md:h-[calc(100dvh-7.75rem)] md:overflow-y-auto md:pr-1 md:[scrollbar-width:thin] md:[scrollbar-color:var(--ou-primary)_transparent] max-md:space-y-3',
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
        compactOnMobile && 'max-md:border max-md:border-[var(--ou-border)] max-md:bg-[var(--ou-surface)] max-md:p-3 max-md:shadow-sm',
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
        'workspace-cockpit min-h-0 border',
        'overflow-visible',
        'max-md:border-[var(--ou-border)] max-md:bg-[var(--ou-surface)] max-md:shadow-sm',
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
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--ou-text-muted)] max-md:text-[9px]">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-base font-semibold tracking-tight text-[var(--ou-text)] max-md:text-sm">{title}</h3>
        </div>
        {description ? (
          <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--ou-text-muted)] max-md:line-clamp-2">
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
  blue: 'ou-tone-primary',
  emerald: 'ou-tone-success',
  amber: 'ou-tone-warning',
  red: 'ou-tone-danger',
  slate: 'border-[var(--ou-border)] bg-[var(--ou-surface-muted)] text-[var(--ou-text-muted)]'
} as const;

const metricToneState = {
  blue: 'primary',
  emerald: 'success',
  amber: 'warning',
  red: 'danger',
  slate: 'neutral'
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
          data-tone={metricToneState[item.tone ?? 'slate']}
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
